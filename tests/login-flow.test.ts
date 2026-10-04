import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { identitySessions, oidcLogins } from '@/lib/db/schema';
import {
  createCallbackHandler,
  createLoginHandler,
} from '@/lib/auth/login-flow';
import { clearDiscoveryCache, type OidcConfig } from '@/lib/auth/oidc';
import { IDENTITY_COOKIE_NAME, readIdentity } from '@/lib/auth/identity';
import type { AppDatabase } from '@/lib/db';
import { createTestDb } from './helpers/test-db';

const cleanups: Array<() => Promise<void>> = [];
test.after(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
});

const CONFIG: OidcConfig = {
  issuer: 'https://auth.example.com',
  clientId: 'moli-diary',
  clientSecret: 'test-secret',
  origin: 'https://diary.example.com',
};
const METADATA = {
  issuer: CONFIG.issuer,
  authorization_endpoint: 'https://auth.example.com/api/oidc/authorization',
  token_endpoint: 'https://auth.example.com/api/oidc/token',
  jwks_uri: 'https://auth.example.com/jwks.json',
};
const NOW = new Date('2026-10-04T12:00:00Z');
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
test.before(async () => {
  keys = await generateKeyPair('RS256');
});

async function setup(idTokenClaims: Record<string, unknown> = {}) {
  clearDiscoveryCache();
  const fixture = await createTestDb();
  cleanups.push(fixture.cleanup);
  const db = fixture.db as unknown as AppDatabase;
  const errors: unknown[] = [];
  let nonce = '';
  const fetchFn = (async (url: string) => {
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Response.json(METADATA);
    }
    const sign = new SignJWT({
      nonce,
      preferred_username: 'Someone',
      groups: ['admins'],
      ...idTokenClaims,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(CONFIG.issuer)
      .setAudience(CONFIG.clientId)
      .setIssuedAt(Math.floor(NOW.getTime() / 1_000))
      .setExpirationTime(Math.floor(NOW.getTime() / 1_000) + 3_600);
    return Response.json({ id_token: await sign.sign(keys.privateKey) });
  }) as never;
  const deps = {
    db,
    config: CONFIG,
    fetchFn,
    keys: () => keys.publicKey,
    now: () => NOW,
    reportError: (error: unknown) => errors.push(error),
  };
  return {
    db,
    errors,
    login: createLoginHandler(deps),
    callback: createCallbackHandler(deps),
    setNonce: (value: string) => (nonce = value),
  };
}

async function startLogin(
  flow: Awaited<ReturnType<typeof setup>>,
  returnTo?: string,
) {
  const address = new URL('https://diary.example.com/auth/login');
  if (returnTo) address.searchParams.set('returnTo', returnTo);
  const response = await flow.login(new Request(address));
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get('location')!);
  const [row] = await flow.db.select().from(oidcLogins);
  flow.setNonce(row.nonce);
  return { target, row, state: target.searchParams.get('state')! };
}

function callbackRequest(params: Record<string, string>) {
  const address = new URL('https://diary.example.com/auth/callback');
  for (const [key, value] of Object.entries(params)) {
    address.searchParams.set(key, value);
  }
  return new Request(address);
}

test('login sends the browser to Authelia and remembers the attempt', async () => {
  const flow = await setup();
  const { target, row } = await startLogin(flow, '/entries/1');
  assert.equal(
    target.origin + target.pathname,
    METADATA.authorization_endpoint,
  );
  assert.equal(row.returnTo, '/entries/1');
  assert.ok(row.expiresAt.getTime() > NOW.getTime());
  assert.notEqual(row.stateHash, target.searchParams.get('state'));
});

test('login ignores a return address that leaves the site', async () => {
  const flow = await setup();
  const { row } = await startLogin(flow, 'https://evil.example.com/');
  assert.equal(row.returnTo, '/');
});

test('an administrator comes back signed in, at the page they wanted', async () => {
  const flow = await setup();
  const { state, row } = await startLogin(flow, '/settings');
  const response = await flow.callback(
    callbackRequest({ code: 'code-1', state }),
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    'https://diary.example.com/settings',
  );
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, new RegExp(`^${IDENTITY_COOKIE_NAME}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.ok(!cookie.includes('id_token'));
  const token = cookie.split(';')[0].split('=')[1];
  assert.equal(
    (
      await readIdentity(flow.db, token, {
        production: true,
        configured: true,
        now: NOW,
      })
    )?.username,
    'someone',
  );
  // The attempt is used up.
  assert.equal((await flow.db.select().from(oidcLogins)).length, 0);
  assert.equal(row.stateHash.length > 0, true);
});

test('a state works once', async () => {
  const flow = await setup();
  const { state } = await startLogin(flow);
  assert.equal(
    (await flow.callback(callbackRequest({ code: 'c', state }))).status,
    303,
  );
  const replay = await flow.callback(callbackRequest({ code: 'c', state }));
  assert.equal(replay.status, 400);
  assert.equal((await flow.db.select().from(identitySessions)).length, 1);
});

test('someone who is not an administrator gets 权限不足 and no session', async () => {
  const flow = await setup({ groups: ['users'] });
  const { state } = await startLogin(flow);
  const response = await flow.callback(callbackRequest({ code: 'c', state }));
  assert.equal(response.status, 403);
  assert.match(await response.text(), /权限不足/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await flow.db.select().from(identitySessions)).length, 0);
});

test('a forged state, a missing code or an error from Authelia is refused', async () => {
  const flow = await setup();
  await startLogin(flow);
  for (const params of <Record<string, string>[]>[
    { code: 'c', state: 'forged' },
    { state: 'forged' },
    { code: 'c' },
    { error: 'access_denied', code: 'c', state: 'x' },
  ]) {
    const response = await flow.callback(callbackRequest(params));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal((await flow.db.select().from(identitySessions)).length, 0);
});

test('a token with the wrong nonce is refused and nothing is signed in', async () => {
  const flow = await setup({ nonce: 'someone-elses-nonce' });
  const { state } = await startLogin(flow);
  const response = await flow.callback(callbackRequest({ code: 'c', state }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(flow.errors.length, 1);
  assert.equal((await flow.db.select().from(identitySessions)).length, 0);
});

test('an expired attempt is refused', async () => {
  const flow = await setup();
  const { state } = await startLogin(flow);
  await flow.db
    .update(oidcLogins)
    .set({ expiresAt: new Date(NOW.getTime() - 1) });
  assert.equal(
    (await flow.callback(callbackRequest({ code: 'c', state }))).status,
    400,
  );
});

test('without OIDC settings nothing signs in and the secret is never mentioned', async () => {
  const fixture = await createTestDb();
  cleanups.push(fixture.cleanup);
  const deps = {
    db: fixture.db as unknown as AppDatabase,
    config: null,
    reportError: () => {},
  };
  for (const handler of [
    createLoginHandler(deps),
    createCallbackHandler(deps),
  ]) {
    const response = await handler(
      new Request('https://diary.example.com/auth/login'),
    );
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('secret'));
  }
});

test('Authelia being unreachable gives a retry page, not a crash', async () => {
  clearDiscoveryCache();
  const fixture = await createTestDb();
  cleanups.push(fixture.cleanup);
  const response = await createLoginHandler({
    db: fixture.db as unknown as AppDatabase,
    config: CONFIG,
    fetchFn: (async () => {
      throw new Error('connection refused');
    }) as never,
    reportError: () => {},
  })(new Request('https://diary.example.com/auth/login'));
  assert.equal(response.status, 502);
  assert.match(await response.text(), /\/auth\/login/);
});
