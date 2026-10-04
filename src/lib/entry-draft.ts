import { ENTRY_CONTENT_MAX_LENGTH, parseEntryDate } from '@/lib/validation';

const DRAFT_VERSION = 1;
const DRAFT_PREFIX = 'diary:entry-draft:';

export type EntryDraft = {
  content: string;
  createdAt: string;
  savedAt: string;
};

/**
 * The editor's draft state. Modelled explicitly because the UI used to decide
 * whether to show the message in red by searching the Chinese copy for '失败'
 * and '无法' — rewording a string silently downgraded an error to a hint.
 */
export type DraftStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; savedAt: Date }
  | { kind: 'cleared' }
  | { kind: 'restored' }
  | { kind: 'discarded' }
  | { kind: 'error'; reason: 'save' | 'discard' | 'read' };

export function describeDraftStatus(
  status: DraftStatus,
  copy: { draft: DraftCopy },
  formatTime: (date: Date) => string,
): { text: string | undefined; tone: 'muted' | 'danger' } {
  const draft = copy.draft;
  switch (status.kind) {
    case 'idle':
      return { text: undefined, tone: 'muted' };
    case 'saving':
      return { text: draft.saving, tone: 'muted' };
    case 'saved':
      return { text: draft.saved(formatTime(status.savedAt)), tone: 'muted' };
    case 'cleared':
      return { text: draft.cleared, tone: 'muted' };
    case 'restored':
      return { text: draft.restored, tone: 'muted' };
    case 'discarded':
      return { text: draft.discarded, tone: 'muted' };
    case 'error':
      return {
        text:
          status.reason === 'save'
            ? draft.saveFailed
            : status.reason === 'discard'
              ? draft.discardFailed
              : draft.unreadable,
        tone: 'danger',
      };
  }
}

type DraftCopy = {
  saving: string;
  saved: (time: string) => string;
  cleared: string;
  restored: string;
  discarded: string;
  saveFailed: string;
  discardFailed: string;
  unreadable: string;
};

export function hasEntryDraftChanges(
  content: string,
  createdAt: string,
  initialContent: string,
  initialCreatedAt: string,
) {
  return content !== initialContent || createdAt !== initialCreatedAt;
}

export function entryDraftKey(mode: 'create' | 'edit', entryId?: string) {
  return mode === 'create'
    ? `${DRAFT_PREFIX}new`
    : `${DRAFT_PREFIX}edit:${entryId ?? ''}`;
}

export function serializeEntryDraft(
  content: string,
  createdAt: string,
  savedAt = new Date(),
) {
  return JSON.stringify({
    version: DRAFT_VERSION,
    content,
    createdAt,
    savedAt: savedAt.toISOString(),
  });
}

export function parseEntryDraft(value: string | null): EntryDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.version !== DRAFT_VERSION ||
      typeof parsed.content !== 'string' ||
      parsed.content.length > ENTRY_CONTENT_MAX_LENGTH ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.savedAt !== 'string' ||
      Number.isNaN(new Date(parsed.savedAt).getTime())
    ) {
      return null;
    }
    if (parsed.createdAt) parseEntryDate(parsed.createdAt);
    return {
      content: parsed.content,
      createdAt: parsed.createdAt,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}
