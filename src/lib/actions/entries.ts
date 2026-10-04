'use server';

import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { processAIEntries, processAIEntry } from '@/lib/ai/processor';
import { scheduleAIJob } from '@/lib/ai/worker';
import { requireSession } from '@/lib/auth/session';
import { createEntryActions } from './entries-core';

const entryActions = createEntryActions({
  db,
  createId: () => nanoid(12),
  scheduleAI: (job) => scheduleAIJob(db, job),
  processAIEntry,
  processAIEntries,
  authorize: requireSession,
  revalidatePath,
});

export async function createEntry(formData: FormData) {
  return entryActions.createEntry(formData);
}
export const deleteEntry = entryActions.deleteEntry;
export const restoreEntry = entryActions.restoreEntry;
export const purgeEntry = entryActions.purgeEntry;
export const setEntryTags = entryActions.setEntryTags;
export const setEntryTitle = entryActions.setEntryTitle;
export const unlockEntryMetadata = entryActions.unlockEntryMetadata;
export async function updateEntry(id: string, formData: FormData) {
  return entryActions.updateEntry(id, formData);
}
export const regenerateEntryMetadata = entryActions.regenerateEntryMetadata;
export const bulkRegenerateEntryMetadata =
  entryActions.bulkRegenerateEntryMetadata;
