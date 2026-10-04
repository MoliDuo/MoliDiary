import { eq } from 'drizzle-orm';
import { db, type AppDatabase } from '@/lib/db';
import { entries } from '@/lib/db/schema';
import { activeEntries } from '@/lib/db/entry-scope';

/**
 * Marks every entry still `pending` as failed. Run once at startup: the AI
 * queue lives in memory, so anything pending when the process starts lost its
 * job with the previous one. The owner retries them from the app.
 *
 * Trashed entries are left alone; failing them would churn updated_at and
 * reorder the recycle bin for no reason.
 */
export async function failOrphanedPendingEntries(
  database: AppDatabase = db,
  now = new Date(),
) {
  return database
    .update(entries)
    .set({ aiStatus: 'failed', updatedAt: now })
    .where(activeEntries(eq(entries.aiStatus, 'pending')))
    .returning({ id: entries.id });
}
