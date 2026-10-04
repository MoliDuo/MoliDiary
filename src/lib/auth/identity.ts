/**
 * Who is asking, as told by the Authelia gateway in front of the app
 * (Moli standard 008, P2). The gateway sets `Remote-User` and `Remote-Groups`
 * after it has checked the person; the container publishes no port, so a
 * request cannot reach the app any other way and the headers can be believed.
 *
 * This says who the person is. Whether the diary can be read is a separate
 * question, answered by the unlock session (lib/auth/session.ts).
 */

export type GatewayAccess = 'admin' | 'forbidden';

const ADMIN_GROUP = 'admins';

/**
 * Only the `admins` group gets in; the user name is never compared. Outside
 * production there is no gateway, so local development is let through.
 */
export function checkGatewayAccess(
  headers: Headers,
  production = process.env.NODE_ENV === 'production',
): GatewayAccess {
  if (!production) return 'admin';
  if (!headers.get('remote-user')?.trim()) return 'forbidden';
  const groups = (headers.get('remote-groups') ?? '')
    .split(',')
    .map((group) => group.trim());
  return groups.includes(ADMIN_GROUP) ? 'admin' : 'forbidden';
}
