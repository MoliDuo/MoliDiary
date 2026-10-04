import { getDataKey, withDataKey } from '@/lib/crypto/cipher';
import type { AppDatabase } from '@/lib/db';

type Job = { run: () => Promise<void>; dataKey: Buffer };

/**
 * A small in-process queue for AI metadata jobs.
 *
 * The server is one long-lived process, so a job simply runs when a slot frees
 * up; there is no time budget to fit inside. A job holds the data key of the
 * request that queued it, in memory only, because the diary is encrypted and
 * the model needs the plaintext. Nothing about a queued job is persisted, so a
 * restart drops the queue; startup marks the orphaned `pending` rows failed
 * and the owner retries them with their own credential.
 */
export class AIWorker {
  private readonly queue: Job[] = [];
  private active = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  enqueue(job: Job) {
    this.queue.push(job);
    this.pump();
  }

  /** Jobs waiting or running. */
  get size() {
    return this.queue.length + this.active;
  }

  /** Resolves once the queue is empty and nothing is running. */
  idle() {
    if (this.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      void withDataKey(job.dataKey, job.run)
        .catch((error) => console.error('AI job failed:', error))
        .finally(() => {
          this.active--;
          this.pump();
          if (this.size === 0) {
            for (const resolve of this.idleWaiters.splice(0)) resolve();
          }
        });
    }
  }
}

// Route handlers, server actions and instrumentation may each load their own
// copy of this module; the queue has to be shared between them.
const globalForWorker = globalThis as typeof globalThis & {
  __limenAIWorker?: AIWorker;
};

export function getAIWorker() {
  return (globalForWorker.__limenAIWorker ??= new AIWorker(
    Number(process.env.AI_CONCURRENCY) || 2,
  ));
}

/**
 * Queues a job on behalf of the current request. Call it from the request
 * itself, not from after(): that is where the credential can still be read.
 */
export async function scheduleAIJob(
  database: AppDatabase,
  run: () => Promise<void>,
) {
  getAIWorker().enqueue({ run, dataKey: await getDataKey(database) });
}
