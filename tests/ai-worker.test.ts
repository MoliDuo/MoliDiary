import assert from 'node:assert/strict';
import test from 'node:test';
import { AIWorker } from '@/lib/ai/worker';
import { getDataKey } from '@/lib/crypto/cipher';
import type { AppDatabase } from '@/lib/db';

const noDatabase = null as unknown as AppDatabase;

test('a job sees the data key it was queued with, not another request', async () => {
  const worker = new AIWorker(2);
  const seen: string[] = [];
  for (const label of ['a', 'b']) {
    const dataKey = Buffer.from(label.repeat(32));
    worker.enqueue({
      dataKey,
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push((await getDataKey(noDatabase)).toString());
      },
    });
  }
  await worker.idle();
  assert.deepEqual(seen.sort(), ['a'.repeat(32), 'b'.repeat(32)]);
});

test('no more jobs run at once than the concurrency allows', async () => {
  const worker = new AIWorker(2);
  let running = 0;
  let peak = 0;
  for (let i = 0; i < 6; i++) {
    worker.enqueue({
      dataKey: Buffer.alloc(32),
      run: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
      },
    });
  }
  await worker.idle();
  assert.equal(peak, 2);
  assert.equal(worker.size, 0);
});

test('a failing job does not stop the ones behind it', async () => {
  const worker = new AIWorker(1);
  const originalError = console.error;
  console.error = () => {};
  let ran = false;
  try {
    worker.enqueue({
      dataKey: Buffer.alloc(32),
      run: async () => {
        throw new Error('boom');
      },
    });
    worker.enqueue({
      dataKey: Buffer.alloc(32),
      run: async () => {
        ran = true;
      },
    });
    await worker.idle();
  } finally {
    console.error = originalError;
  }
  assert.equal(ran, true);
});

test('draining waits for running jobs and gives up after the grace period', async () => {
  const { drainAIWorker } = await import('@/lib/background-tasks');
  const { getAIWorker } = await import('@/lib/ai/worker');
  const worker = getAIWorker();

  let finished = false;
  worker.enqueue({
    dataKey: Buffer.alloc(32),
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    },
  });
  assert.equal(await drainAIWorker(1_000), 'idle');
  assert.equal(finished, true);

  worker.enqueue({
    dataKey: Buffer.alloc(32),
    run: () => new Promise((resolve) => setTimeout(resolve, 150)),
  });
  assert.equal(await drainAIWorker(10), 'timeout');
  await worker.idle();
});
