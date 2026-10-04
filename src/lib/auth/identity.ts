import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db, type AppDatabase } from '@/lib/db';
import { identitySessions, oidcLogins } from '@/lib/db/schema';
import { readOidcConfig } from '@/lib/auth/oidc';

/**
 * Who is signed in, as Authelia told us (Moli standard 008, P1). Only
 * administrators ever get a session here, so a valid one means "an
 * administrator". It says nothing about the diary: reading that also needs the
 * unlock session (lib/auth/session.ts), opened with the PIN.
 */

export const IDENTITY_DURATION_SECONDS = 7 * 24 * 60 * 60;
/** Extend a session once it has less than this left. */
const IDENTITY_RENEW_THRESHOLD_SECONDS = 3 * 24 * 60 * 60;

export const IDENTITY_COOKIE_NAME =
  process.env.NODE_ENV === 'production'
    ? '__Host-diary-identity'
    : 'diary-identity';

export type Identity = { username: string; expiresAt: Date | null };

/** Stored hashed, so the table alone is not a list of working cookies. */
function hashToken(token: string) {
  return createHash('sha256')
    .update(`diary/identity/${token}`)
    .digest('base64url');
}

function identityExpiry(now = new Date()) {
  return new Date(now.getTime() + IDENTITY_DURATION_SECONDS * 1_000);
}

export function identityCookieOptions(expires: Date) {
  return {
    expires,
    httpOnly: true,
    // Lax, not Strict: the redirect back from Authelia is a cross-site
    // navigation, and a Strict cookie would not travel with it.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    priority: 'high' as const,
  };
}

export function shouldRenewIdentity(
  identity: Identity | null | undefined,
  now = new Date(),
) {
  if (!identity?.expiresAt) return false;
  const remaining = identity.expiresAt.getTime() - now.getTime();
  return remaining > 0 && remaining < IDENTITY_RENEW_THRESHOLD_SECONDS * 1_000;
}

export async function createIdentitySession(
  database: AppDatabase,
  username: string,
  now = new Date(),
) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = identityExpiry(now);
  await database
    .insert(identitySessions)
    .values({ idHash: hashToken(token), username, expiresAt });
  return { token, expiresAt };
}

/**
 * The signed-in administrator for a cookie value. Outside production, with no
 * OIDC settings at all, there is no Authelia to ask and development is let
 * through; production without settings never is.
 */
export async function readIdentity(
  database: AppDatabase,
  token: string | null | undefined,
  {
    now = new Date(),
    production = process.env.NODE_ENV === 'production',
    configured = readOidcConfig() !== null,
  }: { now?: Date; production?: boolean; configured?: boolean } = {},
): Promise<Identity | null> {
  if (!production && !configured) {
    return { username: 'dev', expiresAt: null };
  }
  if (!token || token.length > 128) return null;
  const [row] = await database
    .select({
      username: identitySessions.username,
      expiresAt: identitySessions.expiresAt,
    })
    .from(identitySessions)
    .where(
      and(
        eq(identitySessions.idHash, hashToken(token)),
        gt(identitySessions.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Slides the expiry forward; the cookie keeps the same value. */
export async function renewIdentitySession(
  database: AppDatabase,
  token: string,
  now = new Date(),
) {
  const expiresAt = identityExpiry(now);
  await database
    .update(identitySessions)
    .set({ expiresAt })
    .where(eq(identitySessions.idHash, hashToken(token)));
  return expiresAt;
}

export async function deleteExpiredIdentityData(
  database: AppDatabase = db,
  now = new Date(),
) {
  await database
    .delete(identitySessions)
    .where(lt(identitySessions.expiresAt, now));
  await database.delete(oidcLogins).where(lt(oidcLogins.expiresAt, now));
}

export async function getIdentity(database: AppDatabase = db) {
  return readIdentity(
    database,
    (await cookies()).get(IDENTITY_COOKIE_NAME)?.value,
  );
}
