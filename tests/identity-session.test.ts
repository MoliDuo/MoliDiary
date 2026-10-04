import test from 'node:test';
import assert from 'node:assert/strict';
import { identitySessions, oidcLogins } from '@/lib/db/schema';
import {
  createIdentitySession,
  deleteExpiredIdentityData,
  IDENTITY_DURATION_SECONDS,
  readIdentity,
  renewIdentitySession,
  shouldRenewIdentity,
} from '@/lib/auth/identity';
import type { AppDatabase } from '@/lib/db';
import { createTestDb } from './helpers/test-db';

const cleanups: Array<() => Promise<void>> = [];
test.after(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
});

async function freshDb() {
  const fixture = await createTestDb();
  cleanups.push(fixture.cleanup);
  return fixture.db as unknown as AppDatabase;
}

const PRODUCTION = { production: true, configured: true };
const NOW = new Date('2026-10-04T00:00:00Z');

test('a session made at sign-in is found by its cookie value and by nothing else', async () => {
  const db = await freshDb();
  const { token, expiresAt } = await createIdentitySession(db, 'someone', NOW);
  assert.equal(
    expiresAt.getTime(),
    NOW.getTime() + IDENTITY_DURATION_SECONDS * 1_000,
  );
  assert.equal(
    (await readIdentity(db, token, { ...PRODUCTION, now: NOW }))?.username,
    'someone',
  );
  for (const wrong of [undefined, '', 'nope', `${token}x`, 'a'.repeat(200)]) {
    assert.equal(
      await readIdentity(db, wrong, { ...PRODUCTION, now: NOW }),
      null,
    );
  }
});

test('the table does not hold the cookie value', async () => {
  const db = await freshDb();
  const { token } = await createIdentitySession(db, 'someone', NOW);
  const rows = await db.select().from(identitySessions);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].idHash, token);
  assert.ok(!JSON.stringify(rows).includes(token));
});

test('an expired session is refused, and renewing slides it forward', async () => {
  const db = await freshDb();
  const { token } = await createIdentitySession(db, 'someone', NOW);
  const later = new Date(NOW.getTime() + 6 * 24 * 3_600_000);
  const identity = await readIdentity(db, token, { ...PRODUCTION, now: later });
  assert.ok(identity);
  assert.equal(shouldRenewIdentity(identity, later), true);
  assert.equal(shouldRenewIdentity(identity, NOW), false);
  assert.equal(shouldRenewIdentity(null), false);
  assert.equal(
    shouldRenewIdentity({ username: 'dev', expiresAt: null }),
    false,
  );

  const renewed = await renewIdentitySession(db, token, later);
  const afterOriginalExpiry = new Date(NOW.getTime() + 8 * 24 * 3_600_000);
  assert.ok(renewed > afterOriginalExpiry);
  assert.ok(
    await readIdentity(db, token, { ...PRODUCTION, now: afterOriginalExpiry }),
  );
  assert.equal(
    await readIdentity(db, token, {
      ...PRODUCTION,
      now: new Date(renewed.getTime() + 1),
    }),
    null,
  );
});

test('development without OIDC settings is let through; production never is', async () => {
  const db = await freshDb();
  assert.deepEqual(
    await readIdentity(db, undefined, { production: false, configured: false }),
    { username: 'dev', expiresAt: null },
  );
  assert.equal(
    await readIdentity(db, undefined, { production: true, configured: false }),
    null,
  );
  assert.equal(
    await readIdentity(db, undefined, { production: false, configured: true }),
    null,
  );
});

test('cleanup removes expired sessions and stale sign-ins only', async () => {
  const db = await freshDb();
  const old = await createIdentitySession(db, 'old', NOW);
  const fresh = await createIdentitySession(
    db,
    'fresh',
    new Date(NOW.getTime() + 8 * 24 * 3_600_000),
  );
  await db.insert(oidcLogins).values([
    {
      stateHash: 'stale',
      nonce: 'n',
      codeVerifier: 'v',
      expiresAt: new Date(NOW.getTime() + 1_000),
    },
    {
      stateHash: 'live',
      nonce: 'n',
      codeVerifier: 'v',
      expiresAt: new Date(NOW.getTime() + 8 * 24 * 3_600_000),
    },
  ]);
  await deleteExpiredIdentityData(
    db,
    new Date(NOW.getTime() + 8 * 24 * 3_600_000 - 1),
  );
  const probe = new Date(NOW.getTime() + 8 * 24 * 3_600_000 - 1);
  assert.equal(
    await readIdentity(db, old.token, { ...PRODUCTION, now: probe }),
    null,
  );
  assert.ok(await readIdentity(db, fresh.token, { ...PRODUCTION, now: probe }));
  assert.deepEqual(
    (await db.select().from(oidcLogins)).map((row) => row.stateHash),
    ['live'],
  );
});
