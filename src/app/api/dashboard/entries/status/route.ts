import { inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { db, type AppDatabase } from '@/lib/db';
import { entries } from '@/lib/db/schema';
import { normalizeAIStatus } from '@/lib/ai/polling';
import { loadEntryTagsMap } from '@/lib/db/entry-tags';
import { getFieldCipher } from '@/lib/crypto/cipher';
import { activeEntries } from '@/lib/db/entry-scope';

export const MAX_STATUS_IDS = 100;

type BatchStatusDependencies = {
  authorize: () => unknown | Promise<unknown>;
  database: AppDatabase;
};

function parseIds(body: unknown) {
  if (!body || typeof body !== 'object' || !('ids' in body)) return null;
  const { ids } = body as { ids?: unknown };
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_STATUS_IDS ||
    ids.some(
      (id) =>
        typeof id !== 'string' || id.trim().length === 0 || id.length > 64,
    )
  ) {
    return null;
  }
  return [...new Set(ids)];
}

export function createBatchEntryStatusHandler({
  authorize,
  database,
}: BatchStatusDependencies) {
  return async function POST(request: Request) {
    if (!(await authorize())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const ids = parseIds(body);
    if (!ids) {
      return NextResponse.json({ error: 'Invalid entry IDs' }, { status: 400 });
    }

    const cipher = await getFieldCipher(database);
    const rows = await database
      .select({
        id: entries.id,
        aiStatus: entries.aiStatus,
        title: entries.title,
        summary: entries.summary,
      })
      .from(entries)
      .where(activeEntries(inArray(entries.id, ids)));

    const rowMap = new Map(rows.map((row) => [row.id, row]));
    const tagsById = await loadEntryTagsMap(database, ids);
    return NextResponse.json({
      entries: ids.flatMap((id) => {
        const row = rowMap.get(id);
        return row
          ? [
              {
                ...row,
                title: cipher.decryptEntryField(id, 'title', row.title),
                summary: cipher.decryptEntryField(id, 'summary', row.summary),
                aiStatus: normalizeAIStatus(row.aiStatus),
                tags: tagsById.get(id) ?? [],
              },
            ]
          : [];
      }),
    });
  };
}

export const POST = createBatchEntryStatusHandler({
  authorize: getSession,
  database: db,
});
