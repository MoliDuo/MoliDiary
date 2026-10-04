import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { failOrphanedPendingEntries } from '@/lib/ai/orphaned-pending';
import { runTasks } from '@/lib/background-tasks';
import { entries } from '@/lib/db/schema';
import { createTestDb } from './helpers/test-db';

test('startup fails every active pending entry and nothing else', async () => {
  const fixture = await createTestDb();
  const now = new Date('2026-10-04T12:00:00.000Z');
  try {
    await fixture.db.insert(entries).values([
      { id: 'old', content: 'x', aiStatus: 'pending', createdAt: now },
      { id: 'new', content: 'x', aiStatus: 'pending', createdAt: now },
      { id: 'done', content: 'x', aiStatus: 'done', createdAt: now },
      {
        id: 'trashed',
        content: 'x',
        aiStatus: 'pending',
        createdAt: now,
        deletedAt: now,
      },
    ]);

    const failed = await failOrphanedPendingEntries(fixture.db, now);
    assert.deepEqual(failed.map((row) => row.id).sort(), ['new', 'old']);

    for (const [id, expected] of [
      ['old', 'failed'],
      ['new', 'failed'],
      ['done', 'done'],
      ['trashed', 'pending'],
    ] as const) {
      const row = await fixture.db.query.entries.findFirst({
        columns: { aiStatus: true },
        where: eq(entries.id, id),
      });
      assert.equal(row?.aiStatus, expected, id);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('one failing housekeeping task does not stop the others', async () => {
  const originalError = console.error;
  console.error = () => {};
  const ran: string[] = [];
  try {
    await runTasks([
      {
        name: 'first',
        run: async () => {
          throw new Error('boom');
        },
      },
      { name: 'second', run: async () => void ran.push('second') },
    ]);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(ran, ['second']);
});
