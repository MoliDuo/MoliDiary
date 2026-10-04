import type { ActionResult } from '@/lib/actions/result';

type UnlockLimit = { blocked: boolean; retryAfterSeconds: number };

/**
 * What the password opened: the data key, nothing (wrong password), or
 * 'uninitialized' when the database has no password yet.
 */
export type UnlockResult = Buffer | null | 'uninitialized';

type AuthActionDeps = {
  openKey: (password: string) => Promise<UnlockResult>;
  getRateLimit: (key: string) => Promise<UnlockLimit>;
  recordFailure: (key: string) => Promise<UnlockLimit & { failures: number }>;
  clearFailures: (key: string) => Promise<void>;
  createSession: (
    dataKey: Buffer,
  ) => Promise<{ token: string; expiresAt: Date }>;
  setSessionCookie: (token: string, expiresAt: Date) => Promise<void>;
  destroySession: () => Promise<void>;
  clearSessionCookie: () => Promise<void>;
};

const INVALID_PASSWORD_MESSAGE = '密码错误或请求过于频繁';
export const UNINITIALIZED_MESSAGE =
  '尚未设置密码，请先在服务器上运行 npm run crypto -- init';

// scrypt memory is the cost here; there is no reason to hash a novel.
const MAX_PASSWORD_LENGTH = 1024;

export function createAuthActions({
  openKey,
  getRateLimit,
  recordFailure,
  clearFailures,
  createSession,
  setSessionCookie,
  destroySession,
  clearSessionCookie,
}: AuthActionDeps) {
  return {
    async unlock(formData: FormData, clientKey: string): Promise<ActionResult> {
      const limit = await getRateLimit(clientKey);
      if (limit.blocked) {
        return {
          ok: false,
          error: INVALID_PASSWORD_MESSAGE,
          retryAfterSeconds: limit.retryAfterSeconds,
        };
      }

      const password = formData.get('password');
      const unlocked =
        typeof password === 'string' &&
        password.length > 0 &&
        password.length <= MAX_PASSWORD_LENGTH
          ? await openKey(password)
          : null;
      if (unlocked === 'uninitialized') {
        return { ok: false, error: UNINITIALIZED_MESSAGE };
      }
      if (!unlocked) {
        const failed = await recordFailure(clientKey);
        return {
          ok: false,
          error: INVALID_PASSWORD_MESSAGE,
          retryAfterSeconds: failed.blocked
            ? failed.retryAfterSeconds
            : undefined,
        };
      }

      await clearFailures(clientKey);
      const session = await createSession(unlocked);
      await setSessionCookie(session.token, session.expiresAt);
      return { ok: true, data: undefined };
    },

    async lock(): Promise<ActionResult> {
      await destroySession();
      await clearSessionCookie();
      return { ok: true, data: undefined };
    },
  };
}
