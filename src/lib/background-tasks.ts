import { failOrphanedPendingEntries } from '@/lib/ai/orphaned-pending';
import { cleanupLoginAttempts } from '@/lib/auth/rate-limit';
import { deleteExpiredSessions } from '@/lib/crypto/key-slots';
import { getAIWorker } from '@/lib/ai/worker';
import { db, pool } from '@/lib/db';
import { purgeExpiredEntries } from '@/lib/trash/purge';

const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1_000;

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

const housekeepingTasks: Task[] = [
  { name: 'expired sessions', run: () => deleteExpiredSessions(db) },
  { name: 'login attempts', run: () => cleanupLoginAttempts() },
  { name: 'trash purge', run: () => purgeExpiredEntries() },
];

const SHUTDOWN_GRACE_MS = 20_000;

/**
 * Lets queued and running AI jobs finish (up to the grace period) before the
 * process goes, so a deploy does not throw away the work in flight. Whatever
 * is still unfinished is failed by the next start.
 */
export async function drainAIWorker(graceMs = SHUTDOWN_GRACE_MS) {
  const worker = getAIWorker();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), graceMs);
  });
  try {
    return await Promise.race([
      worker.idle().then(() => 'idle' as const),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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

  // `next start` would exit at once on SIGTERM; the image sets
  // NEXT_MANUAL_SIG_HANDLE so shutdown is ours to do.
  if (process.env.NEXT_MANUAL_SIG_HANDLE === 'true') {
    const shutdown = (signal: string) => {
      console.log(`${signal} received: draining AI jobs`);
      clearInterval(timer);
      void drainAIWorker()
        .then((outcome) => {
          if (outcome === 'timeout') console.warn('AI jobs left unfinished');
          return pool.end();
        })
        .catch((error) => console.error('Shutdown failed:', error))
        .finally(() => process.exit(0));
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  }
}
