import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('the root layout themes the whole document, not just the dashboard', () => {
  const source = read('src/app/layout.tsx');
  assert.match(source, /<html lang="zh-CN" data-theme=\{theme\}>/);
  assert.match(source, /getSettings\(\)/);
  // tests/layout-import.test.mjs also depends on these two staying put.
  assert.match(source, /import '\.\/globals\.css';/);
  assert.match(source, /export const dynamic = 'force-dynamic';/);
});

test('toasts follow the saved theme instead of defaulting to light', () => {
  const layout = read('src/app/layout.tsx');
  const toaster = read('src/components/AppToaster.tsx');
  assert.match(layout, /<AppToaster theme=\{theme\} \/>/);
  assert.match(toaster, /theme=\{theme\}/);
});

test('the browser UI color tracks the saved theme', () => {
  assert.match(
    read('src/app/layout.tsx'),
    /export async function generateViewport/,
  );
});

test('the themed background covers html so overscroll never shows light', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /html\s*\{\s*background-color: var\(--bg\);/);
});

test('the dark variant targets data-theme, not a class that is never applied', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /@custom-variant dark \(&:where\(\[data-theme='dark'\]/);
  assert.doesNotMatch(css, /@custom-variant dark \([^)]*\.dark/);
});

test('theme background constants stay in sync with the stylesheet', async () => {
  const { LIGHT_BACKGROUND, DARK_BACKGROUND, themeBackgroundColor } =
    await import('../src/lib/theme.ts');
  const css = read('src/app/moli-tokens.css');

  // :root is the light theme; [data-theme='dark'] and the system media query
  // share the dark value.
  assert.match(css, new RegExp(`--moli-bg: ${LIGHT_BACKGROUND};`));
  assert.match(css, new RegExp(`--moli-bg: ${DARK_BACKGROUND};`));

  assert.deepEqual(themeBackgroundColor('light'), {
    color: LIGHT_BACKGROUND,
  });
  assert.deepEqual(themeBackgroundColor('dark'), { color: DARK_BACKGROUND });
  assert.deepEqual(themeBackgroundColor('system'), [
    { media: '(prefers-color-scheme: light)', color: LIGHT_BACKGROUND },
    { media: '(prefers-color-scheme: dark)', color: DARK_BACKGROUND },
  ]);
});
