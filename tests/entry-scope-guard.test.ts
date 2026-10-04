import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

/** Reads or mutates `entries` directly. */
const TOUCHES_ENTRIES =
  /\.from\(entries\)|db\.query\.entries\.find|\.update\(entries\)|\.delete\(entries\)/;

/** Goes through a named deleted-state scope. */
const USES_SCOPE =
  /activeEntries\(|trashedEntries\(|anyEntryScope\(|findActiveEntry\(|findTrashedEntry\(/;

const ALLOWLIST = new Map([
  ['lib/db/entry-scope.ts', 'defines the scopes'],
  ['lib/db/entries-repo.ts', 'defines the scoped single-entry readers'],
  ['lib/db/entry-tags.ts', 'joins entries only to reach tag rows'],
]);

/** Comments mention these helpers by name; only real code should count. */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test('every query against entries goes through a deleted-state scope', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    if (!TOUCHES_ENTRIES.test(source)) continue;
    const key = relative(SRC, file).replaceAll('\\', '/');
    if (ALLOWLIST.has(key) || USES_SCOPE.test(source)) continue;
    offenders.push(key);
  }
  assert.deepEqual(
    offenders,
    [],
    `These read or write entries without activeEntries()/trashedEntries(), which
both shows deleted rows and defeats the partial index entries_timeline_idx:
${offenders.join('\n')}`,
  );
});

test('the guard actually matches an unscoped query', () => {
  // Without this, a typo in TOUCHES_ENTRIES would make the test above pass
  // vacuously forever.
  const bad = `const rows = await db.select().from(entries).where(eq(entries.id, id));`;
  assert.equal(TOUCHES_ENTRIES.test(bad), true);
  assert.equal(USES_SCOPE.test(bad), false);

  const good = `const rows = await db.select().from(entries).where(activeEntries(eq(entries.id, id)));`;
  assert.equal(USES_SCOPE.test(good), true);
});
