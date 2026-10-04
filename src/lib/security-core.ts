import type { AppDatabase } from '@/lib/db';
import type { ActionResult } from '@/lib/actions/result';
import {
  changePassword,
  createCredentialSlot,
  deleteCredentialSlot,
  listApiTokens,
} from '@/lib/crypto/key-slots';
import { forgetCredentials, formatCredential } from '@/lib/auth/credentials';

export const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 1024;
const STRONG_PIN_LENGTH = 12;

/**
 * A short PIN is still what the diary is encrypted with, and the salt and
 * wrapped key sit in the database, so a copy of it can be guessed offline.
 * Null when the PIN is long enough that this is not a worry.
 */
export function pinStrengthNote(pin: string) {
  if (pin.length === 0 || pin.length >= STRONG_PIN_LENGTH) return null;
  return /^\d+$/.test(pin)
    ? '纯数字的短 PIN 只能挡住别人用你的浏览器，挡不住拿到数据库的人。想要真正加密，请用 12 位以上。'
    : '较短的 PIN 挡不住拿到数据库的人离线猜测。想要真正加密，请用 12 位以上。';
}

export const MAX_TOKEN_LABEL_LENGTH = 60;
const MAX_API_TOKENS = 20;

type LoginLimit = { blocked: boolean; retryAfterSeconds: number };

type SecurityActionDeps = {
  db: AppDatabase;
  /** The signed-in browser session and the data key it opened. */
  authorize: () => Promise<{ sessionId: string; dataKey: Buffer }>;
  getRateLimit: (key: string) => Promise<LoginLimit>;
  recordFailure: (key: string) => Promise<LoginLimit>;
  clearFailures: (key: string) => Promise<void>;
  revalidatePath: (path: string) => void;
};

export type CreatedApiToken = { id: string; label: string; token: string };

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export function createSecurityActions({
  db,
  authorize,
  getRateLimit,
  recordFailure,
  clearFailures,
  revalidatePath,
}: SecurityActionDeps) {
  return {
    async changePassword(
      _previous: ActionResult | undefined,
      formData: FormData,
    ): Promise<ActionResult> {
      const { sessionId } = await authorize();
      const current = field(formData, 'currentPassword');
      const next = field(formData, 'newPassword');
      const confirm = field(formData, 'confirmPassword');

      if (next.length < MIN_PASSWORD_LENGTH) {
        return {
          ok: false,
          error: `新 PIN 至少需要 ${MIN_PASSWORD_LENGTH} 位`,
        };
      }
      if (next.length > MAX_PASSWORD_LENGTH) {
        return { ok: false, error: '新 PIN 太长' };
      }
      if (next !== confirm) {
        return { ok: false, error: '两次输入的新 PIN 不一致' };
      }
      if (next === current) {
        return { ok: false, error: '新 PIN 不能与当前 PIN 相同' };
      }

      // A borrowed session should not become a password-guessing oracle.
      const limitKey = `change-password:${sessionId}`;
      const limit = await getRateLimit(limitKey);
      if (limit.blocked) {
        return {
          ok: false,
          error: '尝试次数过多，请稍后再试',
          retryAfterSeconds: limit.retryAfterSeconds,
        };
      }
      if (
        current.length === 0 ||
        current.length > MAX_PASSWORD_LENGTH ||
        !(await changePassword(db, current, next, { keepSessionId: sessionId }))
      ) {
        const failed = await recordFailure(limitKey);
        return {
          ok: false,
          error: '当前 PIN 不正确',
          retryAfterSeconds: failed.blocked
            ? failed.retryAfterSeconds
            : undefined,
        };
      }
      await clearFailures(limitKey);
      forgetCredentials(db);
      return { ok: true, data: undefined };
    },

    async createApiToken(
      _previous: ActionResult<CreatedApiToken> | undefined,
      formData: FormData,
    ): Promise<ActionResult<CreatedApiToken>> {
      const { dataKey } = await authorize();
      const label = field(formData, 'label').trim();
      if (!label) return { ok: false, error: '请填写令牌名称' };
      if (label.length > MAX_TOKEN_LABEL_LENGTH) {
        return {
          ok: false,
          error: `名称不能超过 ${MAX_TOKEN_LABEL_LENGTH} 个字符`,
        };
      }
      if ((await listApiTokens(db)).length >= MAX_API_TOKENS) {
        return { ok: false, error: '令牌数量已达上限，请先撤销不用的令牌' };
      }
      const { id, secret } = await createCredentialSlot(
        db,
        dataKey,
        'api_token',
        { label },
      );
      revalidatePath('/settings');
      return {
        ok: true,
        data: { id, label, token: formatCredential('api_token', id, secret) },
      };
    },

    async revokeApiToken(id: string): Promise<ActionResult> {
      await authorize();
      if (typeof id !== 'string' || !id) {
        return { ok: false, error: '令牌不存在' };
      }
      const removed = await deleteCredentialSlot(db, 'api_token', id);
      forgetCredentials(db, [id]);
      revalidatePath('/settings');
      return removed
        ? { ok: true, data: undefined }
        : { ok: false, error: '令牌不存在或已撤销' };
    },
  };
}
