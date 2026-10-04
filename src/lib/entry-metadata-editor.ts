import type { messages as copyShape } from '@/lib/messages';
import { normalizeTags } from '@/lib/tags';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 50;
const MAX_TITLE_LENGTH = 200;

export type TagDraftIssue =
  'empty' | 'duplicate' | 'too-long' | 'limit-reached';

export function validateTagDraft(
  draft: string,
  existing: string[],
): TagDraftIssue | null {
  const value = draft.trim();
  if (!value) return 'empty';
  if (value.length > MAX_TAG_LENGTH) return 'too-long';
  if (existing.includes(value)) return 'duplicate';
  if (existing.length >= MAX_TAGS) return 'limit-reached';
  return null;
}

/**
 * Everything the tag editor renders. The component is a thin view over this so
 * the rules can be tested without a DOM, and so the same limits that
 * normalizeTags enforces server-side are surfaced before the round-trip.
 */
export function buildTagEditorModel({
  tags,
  draft,
  locked,
  copy,
}: {
  tags: string[];
  draft: string;
  locked: boolean;
  copy: typeof copyShape;
}) {
  const issue = validateTagDraft(draft, tags);
  return {
    chips: tags.map((name) => ({
      name,
      removeLabel: copy.entryDetail.removeTag(name),
    })),
    canAdd: issue === null,
    addDisabledReason:
      issue === 'duplicate'
        ? copy.entryDetail.tagDuplicate
        : issue === 'too-long'
          ? copy.entryDetail.tagTooLong
          : issue === 'limit-reached'
            ? copy.entryDetail.tagLimitReached
            : null,
    lockNotice: locked ? copy.entryDetail.tagsLocked : null,
    remaining: Math.max(0, MAX_TAGS - tags.length),
  };
}

export function normalizeTitleInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim().slice(0, MAX_TITLE_LENGTH);
  return title || null;
}

export function normalizeTagsInput(value: unknown): string[] {
  return normalizeTags(value);
}
