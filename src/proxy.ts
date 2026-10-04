import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  readSession,
  renewSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  shouldRenewSession,
} from '@/lib/auth/session';
import { loginPath, unlockPath, stripLegacyLocalePath } from '@/lib/pathname';
import {
  IDENTITY_COOKIE_NAME,
  identityCookieOptions,
  readIdentity,
  renewIdentitySession,
  shouldRenewIdentity,
} from '@/lib/auth/identity';
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  createRequestNonce,
} from '@/lib/auth/response-security';

type ProxyDecisionInput = {
  pathname: string;
  signedIn: boolean;
  hasSession: boolean;
};

type ProxyDecision =
  { type: 'login' } | { type: 'redirect'; location: string } | { type: 'next' };

// /healthz answers the deploy script and uptime monitors, which have no
// session. The rest are served from the app root (the manifest by Next's metadata
// file, the icons from public/): the manifest and icons are fetched without credentials during a PWA install, so
// redirecting them to /unlock would break "add to home screen" outright.
const PUBLIC_ASSET_PATHS = new Set([
  '/healthz',
  '/favicon.ico',
  '/favicon.svg',
  '/robots.txt',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon.png',
  '/icon-192.png',
  '/maskable-512.png',
  '/apple-icon.png',
]);

export function shouldBypassProxy(pathname: string) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/_next/image/') ||
    pathname.startsWith('/api/') ||
    // The sign-in flow runs before there is any session to check.
    pathname.startsWith('/auth/') ||
    PUBLIC_ASSET_PATHS.has(pathname)
  );
}

export function evaluateProxyRequest({
  pathname,
  signedIn,
  hasSession,
}: ProxyDecisionInput): ProxyDecision {
  if (shouldBypassProxy(pathname)) return { type: 'next' };

  const normalizedPath = stripLegacyLocalePath(pathname);
  if (normalizedPath !== pathname)
    return { type: 'redirect', location: normalizedPath };
  // Signing in is Authelia's job: the app has no page of its own for it
  // (standard 008, 8.4.4), it just sends the browser there.
  if (!signedIn) return { type: 'login' };
  if (pathname === unlockPath()) {
    return hasSession ? { type: 'redirect', location: '/' } : { type: 'next' };
  }
  return hasSession
    ? { type: 'next' }
    : { type: 'redirect', location: unlockPath() };
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (shouldBypassProxy(pathname)) return NextResponse.next();

  const identityToken = request.cookies.get(IDENTITY_COOKIE_NAME)?.value;
  const identity = await readIdentity(db, identityToken);
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = identity ? await readSession(db, cookie) : null;
  const decision = evaluateProxyRequest({
    pathname,
    signedIn: Boolean(identity),
    hasSession: Boolean(session),
  });
  const nonce = createRequestNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  let response: NextResponse;
  if (decision.type === 'login') {
    const target = new URL(loginPath(), request.url);
    target.searchParams.set(
      'returnTo',
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    response = NextResponse.redirect(target);
  } else if (decision.type === 'redirect') {
    response = NextResponse.redirect(new URL(decision.location, request.url));
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (identity && identityToken && shouldRenewIdentity(identity)) {
    response.cookies.set(
      IDENTITY_COOKIE_NAME,
      identityToken,
      identityCookieOptions(await renewIdentitySession(db, identityToken)),
    );
  }
  if (session && cookie && shouldRenewSession(session)) {
    // Sliding expiry: an active reader never hits the 7-day wall.
    response.cookies.set(
      SESSION_COOKIE_NAME,
      cookie,
      sessionCookieOptions(await renewSession(db, session)),
    );
  } else if (identity && !session && cookie) {
    // Locked elsewhere, expired or tampered: drop it so the browser stops
    // sending it.
    response.cookies.set(
      SESSION_COOKIE_NAME,
      '',
      sessionCookieOptions(new Date(0)),
    );
  }

  applySecurityHeaders(response.headers, contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
