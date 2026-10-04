import { eq, lt, sql } from 'drizzle-orm';
import { db, type AppDatabase } from '@/lib/db';
import { authAttempts } from '@/lib/db/schema';

const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_MAX_FAILURES = 5;
const ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export async function getLoginRateLimit(
  key: string,
  now = new Date(),
  database: AppDatabase = db,
) {
  const attempt = await database.query.authAttempts.findFirst({
    where: eq(authAttempts.key, key),
    columns: { blockedUntil: true },
  });
  const retryAfterMs = attempt?.blockedUntil
    ? attempt.blockedUntil.getTime() - now.getTime()
    : 0;
  return {
    blocked: retryAfterMs > 0,
    retryAfterSeconds: retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1_000) : 0,
  };
}

export async function recordLoginFailure(
  key: string,
  now = new Date(),
  database: AppDatabase = db,
) {
  const resetBefore = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const blockUntil = new Date(now.getTime() + LOGIN_WINDOW_MS);
  const result = (await database.execute(sql`
    INSERT INTO ${authAttempts} (
      "key", "failures", "window_started_at", "blocked_until", "updated_at"
    ) VALUES (${key}, 1, ${now}, NULL, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN ${authAttempts.windowStartedAt} <= ${resetBefore} THEN 1
        ELSE ${authAttempts.failures} + 1
      END,
      "window_started_at" = CASE
        WHEN ${authAttempts.windowStartedAt} <= ${resetBefore} THEN ${now}
        ELSE ${authAttempts.windowStartedAt}
      END,
      "blocked_until" = CASE
        WHEN ${authAttempts.windowStartedAt} <= ${resetBefore} THEN NULL
        WHEN ${authAttempts.failures} + 1 >= ${LOGIN_MAX_FAILURES} THEN ${blockUntil}
        ELSE ${authAttempts.blockedUntil}
      END,
      "updated_at" = ${now}
    RETURNING "failures", "blocked_until"
  `)) as unknown as {
    rows: Array<{ failures: number; blocked_until: Date | string | null }>;
  };
  const row = result.rows[0];
  const blockedUntil = row?.blocked_until ? new Date(row.blocked_until) : null;
  return {
    failures: Number(row?.failures ?? 1),
    blocked: Boolean(blockedUntil && blockedUntil > now),
    retryAfterSeconds: blockedUntil
      ? Math.max(0, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000))
      : 0,
  };
}

export async function clearLoginFailures(
  key: string,
  database: AppDatabase = db,
) {
  await database.delete(authAttempts).where(eq(authAttempts.key, key));
}

export async function cleanupLoginAttempts(
  now = new Date(),
  database: AppDatabase = db,
) {
  await database
    .delete(authAttempts)
    .where(
      lt(
        authAttempts.updatedAt,
        new Date(now.getTime() - ATTEMPT_RETENTION_MS),
      ),
    );
}
