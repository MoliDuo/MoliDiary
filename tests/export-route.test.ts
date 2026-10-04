import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportRouteHandler } from '@/app/api/export/route';
import type { ExportEntry } from '@/lib/export-core';
import { DEFAULT_SETTINGS } from '@/lib/settings-core';

const row: ExportEntry = {
  id: 'one',
  content: 'body',
  title: null,
  summary: null,
  tags: [],
  source: 'web',
  aiStatus: 'pending',
  createdAt: new Date('2026-07-27T00:00:00Z'),
  recordedAt: new Date('2026-07-27T01:00:00Z'),
  updatedAt: null,
};

function handler(overrides: Record<string, unknown> = {}) {
  return createExportRouteHandler({
    authorize: () => true,
    loadSettings: () => DEFAULT_SETTINGS,
    loadEntries: async () => [row],
    now: () => new Date('2026-07-27T16:30:00Z'),
    reportError: () => {},
    ...overrides,
  } as never);
}

test('export route redirects unauthenticated requests to login', async () => {
  const response = await handler({ authorize: () => false })(
    new Request('https://diary.test/api/export?format=json'),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://diary.test/login');
});

for (const query of ['format=xml', 'format=json&from=bad']) {
  test(`export route redirects invalid parameters: ${query}`, async () => {
    const response = await handler()(
      new Request(`https://diary.test/api/export?${query}`),
    );
    assert.equal(
      response.headers.get('location'),
      'https://diary.test/settings?export=invalid',
    );
  });
}

test('export route redirects empty results without a download', async () => {
  const response = await handler({ loadEntries: async () => [] })(
    new Request('https://diary.test/api/export?format=json'),
  );
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    'https://diary.test/settings?export=empty',
  );
  assert.equal(response.headers.get('content-disposition'), null);
});

test('export route streams Markdown with safe headers and timezone filename', async () => {
  const response = await handler()(
    new Request('https://diary.test/api/export?format=markdown'),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    response.headers.get('content-type'),
    'text/markdown; charset=utf-8',
  );
  assert.equal(
    response.headers.get('content-disposition'),
    // The time is part of the name so two exports in a day do not collide.
    'attachment; filename="diary-export-2026-07-28-0030.md"',
  );
  assert.match(await response.text(), /Moli Diary 日记导出/);
});

test('export route streams complete JSON with correct headers', async () => {
  const response = await handler()(
    new Request('https://diary.test/api/export?format=json'),
  );
  assert.equal(
    response.headers.get('content-type'),
    'application/json; charset=utf-8',
  );
  assert.match(response.headers.get('content-disposition') ?? '', /\.json"$/);
  // Bumped with the move to normalized tags; entries[].tags is an array now.
  assert.equal((await response.json()).schemaVersion, 2);
});

test('export route hides database errors behind a settings redirect', async () => {
  const response = await handler({
    loadEntries: async () => {
      throw new Error('secret database detail');
    },
  })(new Request('https://diary.test/api/export?format=json'));
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    'https://diary.test/settings?export=error',
  );
  assert.doesNotMatch(await response.text(), /secret database detail/);
});
