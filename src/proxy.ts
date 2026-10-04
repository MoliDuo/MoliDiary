import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  readSession,
  renewSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  shouldRenewSession,
} from '@/lib/auth/session';
import { unlockPath, stripLegacyLocalePath } from '@/lib/pathname';
import { checkGatewayAccess, type GatewayAccess } from '@/lib/auth/identity';
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  createRequestNonce,
} from '@/lib/auth/response-security';

type ProxyDecisionInput = {
  pathname: string;
  access: GatewayAccess;
  hasSession: boolean;
};

type ProxyDecision =
  | { type: 'forbidden' }
  | { type: 'redirect'; location: string }
  | { type: 'next' };

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

const FORBIDDEN_PAGE =
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>权限不足</title><body style="font-family:system-ui;text-align:center;margin-top:20vh">' +
  '<h1>权限不足</h1><p>只有管理员可以访问 Moli Diary。</p></body></html>';

export function shouldBypassProxy(pathname: string) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/_next/image/') ||
    pathname.startsWith('/api/') ||
    PUBLIC_ASSET_PATHS.has(pathname)
  );
}

export function evaluateProxyRequest({
  pathname,
  access,
  hasSession,
}: ProxyDecisionInput): ProxyDecision {
  if (shouldBypassProxy(pathname)) return { type: 'next' };

  const normalizedPath = stripLegacyLocalePath(pathname);
  if (normalizedPath !== pathname)
    return { type: 'redirect', location: normalizedPath };
  // The gateway has already sent anyone who is not signed in to Authelia, so
  // what reaches here is either an administrator or someone who must not see
  // the diary at all (standard 008, 8.4.2a).
  if (access !== 'admin') return { type: 'forbidden' };
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

  const access = checkGatewayAccess(request.headers);
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = access === 'admin' ? await readSession(db, cookie) : null;
  const decision = evaluateProxyRequest({
    pathname,
    access,
    hasSession: Boolean(session),
  });
  const nonce = createRequestNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  let response: NextResponse;
  if (decision.type === 'forbidden') {
    response = new NextResponse(FORBIDDEN_PAGE, {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } else if (decision.type === 'redirect') {
    response = NextResponse.redirect(new URL(decision.location, request.url));
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (session && cookie && shouldRenewSession(session)) {
    // Sliding expiry: an active reader never hits the 7-day wall.
    response.cookies.set(
      SESSION_COOKIE_NAME,
      cookie,
      sessionCookieOptions(await renewSession(db, session)),
    );
  } else if (access === 'admin' && !session && cookie) {
    // Signed out elsewhere, expired or tampered: drop it so the browser stops
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
