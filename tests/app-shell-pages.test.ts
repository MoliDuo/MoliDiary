import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { shouldBypassProxy } from '@/proxy';

function path(relative: string) {
  return new URL(`../${relative}`, import.meta.url);
}

function read(relative: string) {
  return readFileSync(path(relative), 'utf8');
}

test('a missing entry renders the app 404 instead of the framework default', () => {
  // notFound() is thrown from src/app/(dashboard)/entries/[id]/page.tsx, so the
  // group-level file is what users actually see; the root one covers the rest.
  for (const file of [
    'src/app/(dashboard)/not-found.tsx',
    'src/app/not-found.tsx',
  ]) {
    assert.ok(existsSync(path(file)), `${file} is missing`);
    assert.match(read(file), /messages\.notFound\.backToTimeline/);
  }
});

test('a root layout crash still renders something readable', () => {
  const source = read('src/app/global-error.tsx');
  assert.match(source, /<html/);
  assert.match(source, /<body/);
  // globals.css is not loaded for global-error, so Tailwind classes would be
  // inert and the page would render unstyled.
  assert.doesNotMatch(source, /className=/);
  // Colors must come from the design tokens, never literals (standard 11.3.4).
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
});

test('installable-app assets are reachable without a session', () => {
  for (const asset of [
    '/manifest.webmanifest',
    '/icon.svg',
    '/icon.png',
    '/icon-192.png',
    '/maskable-512.png',
    '/apple-icon.png',
    '/favicon.ico',
    '/favicon.svg',
    '/robots.txt',
  ]) {
    assert.equal(shouldBypassProxy(asset), true, asset);
  }
  assert.equal(shouldBypassProxy('/images/logo.png'), false);
  assert.equal(shouldBypassProxy('/entries/new'), false);
});

test('the manifest and icons exist for add-to-home-screen', () => {
  for (const file of [
    'src/app/manifest.ts',
    'public/icon.svg',
    'public/favicon.svg',
    'public/favicon.ico',
    'public/icon.png',
    'public/icon-192.png',
    'public/maskable-512.png',
    'public/apple-icon.png',
  ]) {
    assert.ok(existsSync(path(file)), `${file} is missing`);
  }
  const manifest = read('src/app/manifest.ts');
  for (const [, src] of manifest.matchAll(/src: '(\/[^']+)'/g)) {
    assert.ok(
      existsSync(path(`public${src}`)),
      `manifest icon ${src} is missing`,
    );
  }
  assert.match(manifest, /display: 'standalone'/);
  // The manifest prerenders at build time, where no database is reachable, and
  // it is served unauthenticated. Reading settings here breaks `next build`.
  assert.doesNotMatch(manifest, /getSettings|@\/lib\/db/);
});

test('pages carry their own browser title', async () => {
  assert.match(
    read('src/app/layout.tsx'),
    /title: \{ default: 'Moli Diary', template: '%s · Moli Diary' \}/,
  );
  assert.match(
    read('src/app/(dashboard)/entries/[id]/page.tsx'),
    /export async function generateMetadata/,
  );
  for (const [file, title] of [
    ['src/app/(dashboard)/entries/new/page.tsx', '新建'],
    ['src/app/(dashboard)/entries/[id]/edit/page.tsx', '编辑'],
    ['src/app/(dashboard)/settings/page.tsx', '设置'],
    ['src/app/login/layout.tsx', '登录'],
  ] as const) {
    assert.match(read(file), new RegExp(`title: '${title}'`), file);
  }
});

test('the detail page and its metadata share one cached query', async () => {
  const source = read('src/app/(dashboard)/entries/[id]/page.tsx');
  assert.match(source, /getEntryById/);
  assert.doesNotMatch(source, /db\.query\.entries/);
  assert.match(read('src/lib/entry-data.ts'), /cache\(/);
});
