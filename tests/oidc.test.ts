import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import {
  clearDiscoveryCache,
  createAuthorizationRequest,
  discover,
  exchangeCode,
  isAdminGroups,
  readOidcConfig,
  redirectUri,
  safeReturnPath,
  verifyIdToken,
  type OidcConfig,
  type OidcMetadata,
} from '@/lib/auth/oidc';

const CONFIG: OidcConfig = {
  issuer: 'https://auth.example.com',
  clientId: 'moli-diary',
  clientSecret: 'test-secret',
  origin: 'https://diary.example.com',
};
const METADATA: OidcMetadata = {
  issuer: CONFIG.issuer,
  authorization_endpoint: 'https://auth.example.com/api/oidc/authorization',
  token_endpoint: 'https://auth.example.com/api/oidc/token',
  jwks_uri: 'https://auth.example.com/jwks.json',
};
const NOW = new Date('2026-10-04T12:00:00Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1_000);

let signer: Awaited<ReturnType<typeof generateKeyPair>>;
let stranger: Awaited<ReturnType<typeof generateKeyPair>>;
test.before(async () => {
  signer = await generateKeyPair('RS256');
  stranger = await generateKeyPair('RS256');
});

type Claims = Record<string, unknown>;

async function token(
  claims: Claims = {},
  {
    key = signer.privateKey,
    alg = 'RS256',
    issuedAt = NOW,
    expiresAt = new Date(NOW.getTime() + 3_600_000),
    issuer = CONFIG.issuer,
    audience = CONFIG.clientId,
  }: {
    key?: unknown;
    alg?: string;
    issuedAt?: Date;
    expiresAt?: Date;
    issuer?: string;
    audience?: string;
  } = {},
) {
  return new SignJWT({
    nonce: 'nonce-1',
    preferred_username: 'Someone',
    groups: ['admins'],
    ...claims,
  })
    .setProtectedHeader({ alg })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(seconds(issuedAt))
    .setExpirationTime(seconds(expiresAt))
    .sign(key as never);
}

const verify = (idToken: string, nonce = 'nonce-1') =>
  verifyIdToken(idToken, {
    config: CONFIG,
    nonce,
    keys: signer.publicKey,
    now: NOW,
  });

test('a good ID Token gives the lower-case user name and the groups', async () => {
  const result = await verify(await token());
  assert.deepEqual(result, { username: 'someone', groups: ['admins'] });
  assert.equal(isAdminGroups(result.groups), true);
  assert.equal(isAdminGroups(['users']), false);
  assert.deepEqual(
    (await verify(await token({ groups: 'admins' }))).groups,
    [],
  );
});

test('every check of standard 008 (8.5.3) refuses what it should', async () => {
  const rejected = async (idToken: string, nonce?: string) =>
    assert.rejects(verify(idToken, nonce), { name: 'OidcError' });

  await rejected(await token(), 'another-nonce');
  await rejected(await token({}, { key: stranger.privateKey }));
  await rejected(await token({}, { issuer: 'https://evil.example.com' }));
  await rejected(await token({}, { audience: 'another-client' }));
  await rejected(
    await token({}, { expiresAt: new Date(NOW.getTime() - 1_000) }),
  );
  await rejected(
    await token({}, { issuedAt: new Date(NOW.getTime() - 10 * 60_000) }),
  );
  await rejected(await token({ preferred_username: undefined }));
  await rejected(await token({ preferred_username: '  ' }));
  await rejected(await token({ preferred_username: 42 }));
  await rejected(`${await token()}tampered`);
  await rejected('not-a-jwt');
  // Only RS256 is accepted; an unsigned token is never trusted.
  const unsigned = [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        iss: CONFIG.issuer,
        aud: CONFIG.clientId,
        nonce: 'nonce-1',
        preferred_username: 'someone',
        exp: seconds(new Date(NOW.getTime() + 3_600_000)),
        iat: seconds(NOW),
      }),
    ).toString('base64url'),
    '',
  ].join('.');
  await rejected(unsigned);
});

test('the authorization request carries PKCE S256 and fresh random values', () => {
  const first = createAuthorizationRequest(CONFIG, METADATA);
  const second = createAuthorizationRequest(CONFIG, METADATA);
  const url = new URL(first.url);
  assert.equal(url.origin + url.pathname, METADATA.authorization_endpoint);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'moli-diary');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://diary.example.com/auth/callback',
  );
  assert.equal(url.searchParams.get('scope'), 'openid profile email groups');
  assert.equal(url.searchParams.get('state'), first.state);
  assert.equal(url.searchParams.get('nonce'), first.nonce);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    url.searchParams.get('code_challenge'),
    createHash('sha256').update(first.codeVerifier).digest('base64url'),
  );
  assert.ok(first.state.length >= 16);
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.nonce, second.nonce);
  assert.ok(!first.url.includes(first.codeVerifier));
  assert.ok(!first.url.includes('test-secret'));
});

test('the code is exchanged with client_secret_post and only the ID Token is kept', async () => {
  let seen: { url: string; body: URLSearchParams } | undefined;
  const idToken = await exchangeCode(
    CONFIG,
    METADATA,
    'code-1',
    'verifier-1',
    (async (url: string, init: RequestInit) => {
      seen = { url, body: init.body as URLSearchParams };
      return Response.json({
        id_token: 'jwt',
        access_token: 'ignored',
        refresh_token: 'ignored',
      });
    }) as never,
  );
  assert.equal(idToken, 'jwt');
  assert.equal(seen?.url, METADATA.token_endpoint);
  assert.equal(seen?.body.get('grant_type'), 'authorization_code');
  assert.equal(seen?.body.get('code'), 'code-1');
  assert.equal(seen?.body.get('code_verifier'), 'verifier-1');
  assert.equal(seen?.body.get('client_id'), 'moli-diary');
  assert.equal(seen?.body.get('client_secret'), 'test-secret');
  assert.equal(seen?.body.get('redirect_uri'), redirectUri(CONFIG));

  await assert.rejects(
    exchangeCode(
      CONFIG,
      METADATA,
      'c',
      'v',
      (async () => new Response('no', { status: 400 })) as never,
    ),
    { name: 'OidcError' },
  );
  await assert.rejects(
    exchangeCode(CONFIG, METADATA, 'c', 'v', (async () =>
      Response.json({ access_token: 'x' })) as never),
    { name: 'OidcError' },
  );
});

test('discovery is cached, and refused when the issuer does not match', async () => {
  clearDiscoveryCache();
  let calls = 0;
  const good = (async (url: string) => {
    calls += 1;
    assert.equal(
      url,
      'https://auth.example.com/.well-known/openid-configuration',
    );
    return Response.json(METADATA);
  }) as never;
  assert.deepEqual(await discover(CONFIG.issuer, good, 0), METADATA);
  await discover(CONFIG.issuer, good, 1_000);
  assert.equal(calls, 1);
  await discover(CONFIG.issuer, good, 2 * 3_600_000);
  assert.equal(calls, 2);

  clearDiscoveryCache();
  await assert.rejects(
    discover(CONFIG.issuer, (async () =>
      Response.json({
        ...METADATA,
        issuer: 'https://evil.example.com',
      })) as never),
    { name: 'OidcError' },
  );
  await assert.rejects(
    discover(
      CONFIG.issuer,
      (async () => new Response('x', { status: 500 })) as never,
    ),
    { name: 'OidcError' },
  );
  clearDiscoveryCache();
});

test('the return address can only be a path inside this app', () => {
  assert.equal(safeReturnPath('/entries/1?tab=a'), '/entries/1?tab=a');
  assert.equal(safeReturnPath('/'), '/');
  for (const bad of [
    undefined,
    null,
    '',
    'entries',
    'https://evil.example.com/',
    '//evil.example.com/',
    '/\\evil.example.com',
    '/\nSet-Cookie: x=1',
    '/auth/login',
    '/auth/callback?code=1',
    'javascript:alert(1)',
  ]) {
    assert.equal(safeReturnPath(bad), '/', String(bad));
  }
});

test('settings are read from the environment, and any gap means not configured', () => {
  const full = {
    OIDC_ISSUER: 'https://auth.example.com/',
    OIDC_CLIENT_ID: 'moli-diary',
    OIDC_CLIENT_SECRET: 'test-secret',
    APP_ORIGIN: 'https://diary.example.com/',
  };
  assert.deepEqual(readOidcConfig(full), CONFIG);
  for (const key of Object.keys(full)) {
    assert.equal(readOidcConfig({ ...full, [key]: undefined }), null);
    assert.equal(readOidcConfig({ ...full, [key]: ' ' }), null);
  }
});
