import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messages } from '@/lib/messages';

test('dashboard exposes an accessible settings icon and leaves theming to the root layout', () => {
  const source = readFileSync(
    new URL('../src/app/(dashboard)/layout.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /settingsPath\(\)/);
  assert.match(source, /aria-label="设置"/);
  assert.match(source, /title="设置"/);
  // The theme moved to <html> so it also covers /unlock, the document
  // background and toasts. See tests/theme-shell.test.mjs.
  assert.doesNotMatch(source, /data-theme=/);
});

test('settings form provides all settings, GET filters, and font sizes', () => {
  const source = readFileSync(
    new URL('../src/components/SettingsForm.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /跟随系统/);
  assert.match(source, /Asia\/Shanghai/);
  assert.match(source, /editorFontSize/);
  assert.match(source, /defaultExportFormat/);
  assert.match(source, /action="\/api\/export"/);
  assert.match(source, /method="get"/);
  assert.match(source, /name="tags"/);
  assert.match(source, /checked=\{option === value\}/);
  assert.doesNotMatch(source, /defaultChecked/);
  assert.match(source, /记录日期按日历日保存，不随时区变化/);
  assert.match(source, /setExportFormat\(result\.data\.defaultExportFormat\)/);

  const editor = readFileSync(
    new URL('../src/components/EntryEditorForm.tsx', import.meta.url),
    'utf8',
  );
  assert.match(editor, /editorFontSize === 'small'[\s\S]*'text-base'/);
  assert.match(editor, /editorFontSize === 'medium'[\s\S]*'text-lg'/);
  assert.match(editor, /editorFontSize === 'large'[\s\S]*'text-xl'/);
  // The literal moved into messages.ts, where all user-facing copy belongs.
  assert.match(editor, /messages\.editor\.draft\.discard/);
  assert.equal(messages.editor.draft.discard, '丢弃草稿');
  assert.doesNotMatch(editor, /router\.push\([\s\S]{0,100}router\.refresh/);
});

test('settings page maps all export redirect states to feedback', () => {
  const source = readFileSync(
    new URL('../src/app/(dashboard)/settings/page.tsx', import.meta.url),
    'utf8',
  );
  // The copy moved into messages.ts; the page still renders the no-JS
  // fallback's ?export= feedback.
  assert.match(source, /messages\.settings\.exportFailed/);
  assert.match(source, /query\.export/);
  assert.match(source, /role="alert"/);
  for (const state of ['invalid', 'error', 'empty', 'unauthorized'] as const) {
    assert.ok(messages.settings.exportFailed[state], state);
  }
});

test('the export form keeps its selection when a download fails', () => {
  const source = readFileSync(
    new URL('../src/components/SettingsForm.tsx', import.meta.url),
    'utf8',
  );
  // The native GET form stays as the no-JavaScript path; onSubmit enhances it
  // so a failure is reported in place instead of redirecting to a blank form.
  assert.match(source, /action="\/api\/export"/);
  assert.match(source, /method="get"/);
  assert.match(source, /onSubmit=\{downloadExport\}/);
  assert.match(source, /accept: 'application\/json'/);
});
