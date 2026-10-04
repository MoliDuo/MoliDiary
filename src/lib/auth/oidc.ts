import { createHash, randomBytes } from 'node:crypto';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type CryptoKey,
  type KeyObject,
} from 'jose';

/**
 * Signing in through Authelia (Moli standard 008, P1): authorization code with
 * PKCE, the client secret in the token request body (`client_secret_post`),
 * and the ID Token checked here rather than trusted from a userinfo call.
 */

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Public origin of this app, e.g. https://diary.example.com. */
  origin: string;
};

export type OidcMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

const ADMIN_GROUP = 'admins';
const SCOPE = 'openid profile email groups';
export const LOGIN_LIFETIME_MS = 10 * 60 * 1_000;
/** An ID Token issued longer ago than this is treated as a replay. */
const MAX_TOKEN_AGE = '5m';
const REQUEST_TIMEOUT_MS = 10_000;

export type FetchFn = typeof fetch;
export type VerificationKeys = JWTVerifyGetKey | CryptoKey | KeyObject;

class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

/** Null when any setting is missing; the secret is never logged. */
export function readOidcConfig(
  env: Record<string, string | undefined> = process.env,
): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim().replace(/\/+$/, '');
  const clientId = env.OIDC_CLIENT_ID?.trim();
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim();
  const origin = env.APP_ORIGIN?.trim().replace(/\/+$/, '');
  if (!issuer || !clientId || !clientSecret || !origin) return null;
  return { issuer, clientId, clientSecret, origin };
}

export function redirectUri(config: OidcConfig) {
  return `${config.origin}/auth/callback`;
}

export function hashState(state: string) {
  return createHash('sha256')
    .update(`diary/oidc-state/${state}`)
    .digest('base64url');
}

/**
 * Only a path inside this app. Anything that could leave the site (a scheme,
 * `//host`, a backslash) falls back to the front page (8.4.5).
 */
export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || /[\\\u0000-\u001f]/.test(value)) {
    return '/';
  }
  try {
    const url = new URL(value, 'http://return.invalid');
    if (url.origin !== 'http://return.invalid') return '/';
    if (url.pathname.startsWith('/auth/')) return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

let cachedMetadata: { issuer: string; value: OidcMetadata; at: number } | null =
  null;
const METADATA_TTL_MS = 60 * 60 * 1_000;

export async function discover(
  issuer: string,
  fetchFn: FetchFn = fetch,
  now = Date.now(),
): Promise<OidcMetadata> {
  if (
    cachedMetadata &&
    cachedMetadata.issuer === issuer &&
    now - cachedMetadata.at < METADATA_TTL_MS
  ) {
    return cachedMetadata.value;
  }
  const response = await fetchFn(`${issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new OidcError('discovery request failed');
  const value = (await response.json()) as Partial<OidcMetadata>;
  if (
    value.issuer !== issuer ||
    !value.authorization_endpoint ||
    !value.token_endpoint ||
    !value.jwks_uri
  ) {
    throw new OidcError('discovery document does not match the issuer');
  }
  cachedMetadata = { issuer, value: value as OidcMetadata, at: now };
  return value as OidcMetadata;
}

export function clearDiscoveryCache() {
  cachedMetadata = null;
}

/** Fresh `state`, `nonce` and PKCE verifier, and the address to send the browser to. */
export function createAuthorizationRequest(
  config: OidcConfig,
  metadata: OidcMetadata,
) {
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(config),
    scope: SCOPE,
    state,
    nonce,
    code_challenge: createHash('sha256')
      .update(codeVerifier)
      .digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { state, nonce, codeVerifier, url: url.toString() };
}

/** Trades the code for an ID Token. Nothing else in the answer is kept. */
export async function exchangeCode(
  config: OidcConfig,
  metadata: OidcMetadata,
  code: string,
  codeVerifier: string,
  fetchFn: FetchFn = fetch,
) {
  const response = await fetchFn(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(config),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new OidcError('token request was refused');
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string' || !body.id_token) {
    throw new OidcError('token response has no id_token');
  }
  return body.id_token;
}

export function remoteKeys(metadata: OidcMetadata): JWTVerifyGetKey {
  // Cached by jose; an unknown key id triggers one refresh.
  return createRemoteJWKSet(new URL(metadata.jwks_uri));
}

/**
 * Signature (RS256 only), issuer, audience, expiry, age and nonce are all
 * checked here; a missing user name is refused too. Returns the user name in
 * lower case (8.4.1) and the groups.
 */
export async function verifyIdToken(
  idToken: string,
  {
    config,
    nonce,
    keys,
    now = new Date(),
  }: { config: OidcConfig; nonce: string; keys: VerificationKeys; now?: Date },
) {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keys as JWTVerifyGetKey, {
      algorithms: ['RS256'],
      issuer: config.issuer,
      audience: config.clientId,
      maxTokenAge: MAX_TOKEN_AGE,
      requiredClaims: ['exp', 'iat'],
      currentDate: now,
    }));
  } catch (error) {
    throw new OidcError(
      `ID Token rejected: ${error instanceof Error ? error.name : 'unknown'}`,
    );
  }
  if (payload.nonce !== nonce) throw new OidcError('ID Token nonce mismatch');
  const username = payload.preferred_username;
  if (typeof username !== 'string' || !username.trim()) {
    throw new OidcError('ID Token has no preferred_username');
  }
  const claim: unknown = payload.groups;
  const groups = Array.isArray(claim)
    ? claim.filter((group): group is string => typeof group === 'string')
    : [];
  return { username: username.trim().toLowerCase(), groups };
}

export function isAdminGroups(groups: string[]) {
  return groups.includes(ADMIN_GROUP);
}
