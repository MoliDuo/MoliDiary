import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { db, type AppDatabase } from '@/lib/db';
import { updateCredentialSlot } from '@/lib/crypto/key-slots';
import { verifyCredential } from '@/lib/auth/credentials';

export function readBearerToken(header: string | null) {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Recording every call would be a write per request for no benefit. */
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1_000;

/** API clients authenticate with a token issued on the settings page. */
export async function authorizeApiRequest(
  request: Request,
  database: AppDatabase = db,
  now = new Date(),
) {
  const credential = await verifyCredential(
    database,
    'api_token',
    readBearerToken(request.headers.get('authorization')),
    now,
  );
  if (!credential) return false;
  if (
    !credential.lastUsedAt ||
    now.getTime() - credential.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS
  ) {
    await updateCredentialSlot(database, credential.slotId, {
      lastUsedAt: now,
    });
    credential.lastUsedAt = now;
  }
  return true;
}

/**
 * Hashed so auth_attempts does not hold raw addresses. There is no server
 * secret to key this with any more; anyone holding the database could
 * enumerate IPv4 space against it, which is why the rows are short-lived.
 */
const NON_CLIENT_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10], // CGNAT, which Tailscale uses
] as const) {
  NON_CLIENT_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  NON_CLIENT_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}
NON_CLIENT_ADDRESSES.addAddress('::1', 'ipv6');

function isClientAddress(address: string) {
  const family = isIP(address);
  return (
    family !== 0 &&
    !NON_CLIENT_ADDRESSES.check(address, family === 4 ? 'ipv4' : 'ipv6')
  );
}

/**
 * The client behind our own proxies, from an X-Forwarded-For chain.
 *
 * Each proxy appends the peer it saw, so the right end is trustworthy and the
 * left end is whatever the client sent. Walking in from the right and skipping
 * private addresses (the proxies and tunnel hops) lands on the first public
 * address a proxy of ours recorded; anything a client prepends is never
 * reached. With no public address in the chain, the nearest hop stands in.
 */
export function clientAddressFromForwardedFor(forwardedFor: string | null) {
  const hops = (forwardedFor ?? '')
    .split(',')
    .map((hop) => hop.trim().slice(0, 128))
    .filter(Boolean);
  return hops.findLast(isClientAddress) ?? hops.at(-1) ?? 'unknown';
}

/**
 * Hashed so auth_attempts does not hold raw addresses. There is no server
 * secret to key this with any more; anyone holding the database could
 * enumerate IPv4 space against it, which is why the rows are short-lived.
 */
export function createLoginAttemptKey(forwardedFor: string | null) {
  const clientAddress = clientAddressFromForwardedFor(forwardedFor);
  return createHash('sha256')
    .update(`limen/login-attempt/${clientAddress}`)
    .digest('base64url');
}
