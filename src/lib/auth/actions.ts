'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import type { ActionResult } from '@/lib/actions/result';
import { messages } from '@/lib/messages';
import { createAuthActions } from './action-core';
import { createLoginAttemptKey } from './security';
import { unlockForSession } from './session-unlock';
import {
  createSession,
  destroySession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from './session';
import {
  clearLoginFailures,
  getLoginRateLimit,
  recordLoginFailure,
} from './rate-limit';

async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(expiresAt),
  );
}

async function clearSessionCookie() {
  (await cookies()).set(
    SESSION_COOKIE_NAME,
    '',
    sessionCookieOptions(new Date(0)),
  );
}

const authActions = createAuthActions({
  openKey: (password) => unlockForSession(password),
  getRateLimit: getLoginRateLimit,
  recordFailure: recordLoginFailure,
  clearFailures: clearLoginFailures,
  createSession: (dataKey) => createSession(db, dataKey),
  setSessionCookie,
  destroySession: async () =>
    destroySession(db, (await cookies()).get(SESSION_COOKIE_NAME)?.value),
  clearSessionCookie,
});

export async function handleUnlockAttempt(
  attempt: () => Promise<ActionResult>,
  reportError: (error: unknown) => void = (error) =>
    console.error('Unlock action failed:', error),
): Promise<ActionResult> {
  try {
    return await attempt();
  } catch (error) {
    reportError(error);
    return { ok: false, error: messages.unlock.unexpectedError };
  }
}

export async function unlock(
  _previousState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const result = await handleUnlockAttempt(async () => {
    const requestHeaders = await headers();
    // Only believed when a reverse proxy we run sits in front and overwrites
    // the header; otherwise any client could pick its own rate-limit bucket.
    const forwardedFor =
      process.env.TRUST_PROXY === 'true'
        ? requestHeaders.get('x-forwarded-for')
        : null;
    const unlockResult = await authActions.unlock(
      formData,
      createLoginAttemptKey(forwardedFor),
    );
    return unlockResult;
  });
  if (!result.ok) return result;
  redirect('/');
}

export async function lock() {
  return authActions.lock();
}
