import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('unlock labels and retry countdown are Chinese-only', async () => {
  const { formatRetryCountdown, getUnlockSubmitLabel } =
    await import('@/app/unlock/page');

  assert.equal(getUnlockSubmitLabel(false), '进入');
  assert.equal(getUnlockSubmitLabel(true), '进入中...');
  assert.equal(formatRetryCountdown(120), '02:00');
  assert.equal(formatRetryCountdown(900), '15:00');
});

test('unlock form uses the Server Action without intercepting submit', () => {
  const source = readFileSync(
    new URL('../src/app/unlock/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /useActionState\(unlock, undefined\)/);
  assert.match(source, /<form action=\{action\}/);
  assert.doesNotMatch(source, /preventDefault/);
  assert.doesNotMatch(source, /useRouter/);
});

test('unlock action converts backend failures into recoverable feedback', async () => {
  const { handleUnlockAttempt } = await import('@/lib/auth/actions');
  const reported: unknown[] = [];
  const failure = new Error('session storage unavailable');

  assert.deepEqual(
    await handleUnlockAttempt(
      async () => {
        throw failure;
      },
      (error) => reported.push(error),
    ),
    { ok: false, error: '发生了意外错误' },
  );
  assert.deepEqual(reported, [failure]);

  const invalidPassword = {
    ok: false as const,
    error: '密码错误或请求过于频繁',
  };
  assert.equal(
    await handleUnlockAttempt(
      async () => invalidPassword,
      () => {},
    ),
    invalidPassword,
  );
});

test('unlock redirect remains outside the rejected-attempt handler', () => {
  const source = readFileSync(
    new URL('../src/lib/auth/actions.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /await handleUnlockAttempt\([\s\S]*?\);\n  if \(!result\.ok\) return result;\n  redirect\('\/'\);/,
  );
});
