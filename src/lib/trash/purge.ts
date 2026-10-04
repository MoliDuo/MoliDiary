import { lte, sql } from 'drizzle-orm';
import { db, type AppDatabase } from '@/lib/db';
import { entries, tags } from '@/lib/db/schema';
import { trashedEntries } from '@/lib/db/entry-scope';

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

function trashExpiresAt(deletedAt: Date) {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_MS);
}

export function daysUntilPurge(deletedAt: Date, now = new Date()) {
  const remaining = trashExpiresAt(deletedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1_000)));
}

/**
 * Hard-deletes entries whose retention has elapsed, then sweeps tags nothing
 * references any more.
 *
 * Orphan collection lives here rather than on the tag write path, where it
 * would add a DELETE to every edit. It is safe because entry_tags rows survive
 * a soft delete, so a tag held only by a still-trashed entry is not orphaned
 * and is not swept.
 */
export async function purgeExpiredEntries(
  database: AppDatabase = db,
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_MS);
  const purged = await database
    .delete(entries)
    .where(trashedEntries(lte(entries.deletedAt, cutoff)))
    .returning({ id: entries.id });

  // entry_tags rows went with the cascade; now drop tags nothing points at.
  const removed = await database
    .delete(tags)
    .where(
      sql`NOT EXISTS (SELECT 1 FROM entry_tags et WHERE et.tag_id = ${tags.id})`,
    )
    .returning({ id: tags.id });

  return { purged: purged.map((row) => row.id), tagsRemoved: removed.length };
}
