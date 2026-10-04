import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entryDraftKey,
  hasEntryDraftChanges,
  parseEntryDraft,
  serializeEntryDraft,
} from '@/lib/entry-draft';

test('entry drafts are versioned and preserve content, date, and save time', () => {
  const savedAt = new Date('2026-07-27T12:34:00.000Z');
  assert.deepEqual(
    parseEntryDraft(
      serializeEntryDraft('几千字也要留下', '2026-07-27', savedAt),
    ),
    {
      content: '几千字也要留下',
      createdAt: '2026-07-27',
      savedAt: savedAt.toISOString(),
    },
  );
  assert.equal(entryDraftKey('create'), 'diary:entry-draft:new');
  assert.equal(
    entryDraftKey('edit', 'entry-1'),
    'diary:entry-draft:edit:entry-1',
  );
  assert.equal(
    parseEntryDraft(serializeEntryDraft('正文仍要保留', '', savedAt))?.content,
    '正文仍要保留',
  );
});

test('entry drafts ignore malformed, stale, and invalid values', () => {
  assert.equal(parseEntryDraft(null), null);
  assert.equal(parseEntryDraft('not-json'), null);
  assert.equal(
    parseEntryDraft(
      JSON.stringify({
        version: 0,
        content: 'old',
        createdAt: '2026-07-27',
        savedAt: new Date().toISOString(),
      }),
    ),
    null,
  );
  assert.equal(
    parseEntryDraft(
      JSON.stringify({
        version: 1,
        content: 'invalid date',
        createdAt: '2026-02-31',
        savedAt: new Date().toISOString(),
      }),
    ),
    null,
  );
});

test('unchanged editor values do not leave a stale draft', () => {
  assert.equal(
    hasEntryDraftChanges('same', '2026-07-27', 'same', '2026-07-27'),
    false,
  );
  assert.equal(
    hasEntryDraftChanges('new', '2026-07-27', 'same', '2026-07-27'),
    true,
  );
});
