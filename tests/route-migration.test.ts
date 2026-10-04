import test from 'node:test';
import assert from 'node:assert/strict';

test('redirect helpers generate Chinese-only root routes', async () => {
  const { dashboardPath, entryDetailPath, unlockPath, newEntryPath } =
    await import('@/lib/pathname');
  assert.equal(dashboardPath(), '/');
  assert.equal(unlockPath(), '/unlock');
  assert.equal(newEntryPath(), '/entries/new');
  assert.equal(entryDetailPath('entry-1'), '/entries/entry-1');
});
