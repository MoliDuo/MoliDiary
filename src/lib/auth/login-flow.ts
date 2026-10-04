import { and, eq, gt } from 'drizzle-orm';
import type { AppDatabase } from '@/lib/db';
import { oidcLogins } from '@/lib/db/schema';
import {
  createAuthorizationRequest,
  discover,
  exchangeCode,
  hashState,
  isAdminGroups,
  LOGIN_LIFETIME_MS,
  readOidcConfig,
  remoteKeys,
  safeReturnPath,
  verifyIdToken,
  type FetchFn,
  type OidcConfig,
  type OidcMetadata,
  type VerificationKeys,
} from '@/lib/auth/oidc';
import {
  createIdentitySession,
  IDENTITY_COOKIE_NAME,
  identityCookieOptions,
} from '@/lib/auth/identity';
import { authPage } from '@/lib/auth/auth-pages';

type FlowDeps = {
  db: AppDatabase;
  config?: OidcConfig | null;
  fetchFn?: FetchFn;
  keys?: (metadata: OidcMetadata) => VerificationKeys;
  now?: () => Date;
  reportError?: (error: unknown) => void;
};

const NOT_CONFIGURED = '登录尚未配置，请联系管理员。';

function configured(deps: FlowDeps) {
  return deps.config === undefined ? readOidcConfig() : deps.config;
}

/** GET /auth/login: remember this attempt, then send the browser to Authelia. */
export function createLoginHandler(deps: FlowDeps) {
  const { db, fetchFn, now = () => new Date() } = deps;
  const reportError =
    deps.reportError ?? ((error) => console.error('Sign-in failed:', error));
  return async function GET(request: Request) {
    const config = configured(deps);
    if (!config) {
      reportError(new Error('OIDC settings are missing'));
      return authPage(503, '无法登录', NOT_CONFIGURED, { retry: false });
    }
    try {
      const metadata = await discover(config.issuer, fetchFn);
      const started = createAuthorizationRequest(config, metadata);
      await db.insert(oidcLogins).values({
        stateHash: hashState(started.state),
        nonce: started.nonce,
        codeVerifier: started.codeVerifier,
        returnTo: safeReturnPath(
          new URL(request.url).searchParams.get('returnTo'),
        ),
        expiresAt: new Date(now().getTime() + LOGIN_LIFETIME_MS),
      });
      return Response.redirect(started.url, 302);
    } catch (error) {
      reportError(error);
      return authPage(502, '无法登录', '暂时联系不上登录服务，请稍后重试。');
    }
  };
}

/** GET /auth/callback: check Authelia's answer, then start our own session. */
export function createCallbackHandler(deps: FlowDeps) {
  const { db, fetchFn, now = () => new Date() } = deps;
  const keysFor = deps.keys ?? remoteKeys;
  const reportError =
    deps.reportError ?? ((error) => console.error('Sign-in failed:', error));
  return async function GET(request: Request) {
    const config = configured(deps);
    if (!config) {
      reportError(new Error('OIDC settings are missing'));
      return authPage(503, '无法登录', NOT_CONFIGURED, { retry: false });
    }
    const params = new URL(request.url).searchParams;
    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      return authPage(400, '登录失败', 'Authelia 没有完成登录，请重试。');
    }
    try {
      // Deleting is the check: a state works once, and only before it expires.
      const [login] = await db
        .delete(oidcLogins)
        .where(
          and(
            eq(oidcLogins.stateHash, hashState(state)),
            gt(oidcLogins.expiresAt, now()),
          ),
        )
        .returning();
      if (!login) {
        return authPage(400, '登录失败', '这次登录已失效，请重试。');
      }
      const metadata = await discover(config.issuer, fetchFn);
      const idToken = await exchangeCode(
        config,
        metadata,
        code,
        login.codeVerifier,
        fetchFn,
      );
      const { username, groups } = await verifyIdToken(idToken, {
        config,
        nonce: login.nonce,
        keys: keysFor(metadata),
        now: now(),
      });
      if (!isAdminGroups(groups)) {
        return authPage(403, '权限不足', '只有管理员可以访问 Moli Diary。', {
          retry: false,
        });
      }
      const session = await createIdentitySession(db, username, now());
      const response = new Response(null, {
        status: 303,
        headers: {
          Location: new URL(login.returnTo, config.origin).toString(),
        },
      });
      const cookie = IDENTITY_COOKIE_NAME;
      const options = identityCookieOptions(session.expiresAt);
      response.headers.append(
        'Set-Cookie',
        [
          `${cookie}=${session.token}`,
          `Path=${options.path}`,
          `Expires=${options.expires.toUTCString()}`,
          'HttpOnly',
          ...(options.secure ? ['Secure'] : []),
          'SameSite=Lax',
          'Priority=High',
        ].join('; '),
      );
      return response;
    } catch (error) {
      reportError(error);
      return authPage(400, '登录失败', '登录没有通过验证，请重试。');
    }
  };
}
