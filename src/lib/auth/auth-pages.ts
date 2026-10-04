import { applySecurityHeaders } from '@/lib/auth/response-security';

const PAGE_CSP = `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/**
 * The only pages the sign-in flow ever shows: an error with a way to try again
 * (standard 008, 8.4.4), and "权限不足" for someone who is not an administrator.
 */
export function authPage(
  status: number,
  title: string,
  message: string,
  { retry = true }: { retry?: boolean } = {},
) {
  const body =
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title}</title>` +
    '<body style="font-family:system-ui;text-align:center;margin-top:20vh;padding:0 16px">' +
    `<h1>${title}</h1><p>${message}</p>` +
    (retry ? '<p><a href="/auth/login">重试</a></p>' : '') +
    '</body></html>';
  const response = new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  applySecurityHeaders(response.headers, PAGE_CSP);
  return response;
}
