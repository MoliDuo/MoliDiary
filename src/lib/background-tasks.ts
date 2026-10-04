import { failOrphanedPendingEntries } from '@/lib/ai/orphaned-pending';
import { cleanupLoginAttempts } from '@/lib/auth/rate-limit';
import { deleteExpiredSessions } from '@/lib/crypto/key-slots';
import { db } from '@/lib/db';
import { purgeExpiredEntries } from '@/lib/trash/purge';

export const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1_000;

type Task = { name: string; run: () => Promise<unknown> };

/** Runs every task, logging a failure without stopping the rest. */
export async function runTasks(tasks: Task[]) {
  for (const task of tasks) {
    try {
      await task.run();
    } catch (error) {
      console.error(`Background task "${task.name}" failed:`, error);
    }
  }
}

export const housekeepingTasks: Task[] = [
  { name: 'expired sessions', run: () => deleteExpiredSessions(db) },
  { name: 'login attempts', run: () => cleanupLoginAttempts() },
  { name: 'trash purge', run: () => purgeExpiredEntries() },
];

const globalForTasks = globalThis as typeof globalThis & {
  __limenBackgroundTasks?: NodeJS.Timeout;
};

/**
 * Called once from instrumentation when the server starts: fails the jobs the
 * last process took with it, then sweeps expired rows now and every hour.
 */
export function startBackgroundTasks() {
  if (globalForTasks.__limenBackgroundTasks) return;

  const sweep = () => runTasks(housekeepingTasks);
  void runTasks([
    { name: 'orphaned AI jobs', run: () => failOrphanedPendingEntries() },
  ]).then(sweep);

  const timer = setInterval(sweep, HOUSEKEEPING_INTERVAL_MS);
  timer.unref();
  globalForTasks.__limenBackgroundTasks = timer;
}
