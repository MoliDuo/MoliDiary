import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProxyRequest, shouldBypassProxy } from '@/proxy';

function decide(
  pathname: string,
  overrides: Partial<Parameters<typeof evaluateProxyRequest>[0]> = {},
) {
  return evaluateProxyRequest({
    pathname,
    access: 'admin',
    hasSession: false,
    ...overrides,
  });
}

test('proxy sends every locked private page including unknown paths to unlock', () => {
  assert.deepEqual(decide('/entries/new'), {
    type: 'redirect',
    location: '/unlock',
  });
  assert.deepEqual(decide('/future-private-page'), {
    type: 'redirect',
    location: '/unlock',
  });
});

test('proxy bypasses framework assets and internally authenticated API routes', () => {
  assert.deepEqual(decide('/unlock'), { type: 'next' });
  assert.equal(shouldBypassProxy('/favicon.ico'), true);
  assert.equal(shouldBypassProxy('/robots.txt'), true);
  assert.equal(shouldBypassProxy('/_next/static/chunk.js'), true);
  assert.equal(shouldBypassProxy('/api/entries'), true);
  assert.equal(shouldBypassProxy('/api/dashboard/entries'), true);
  assert.equal(shouldBypassProxy('/images/logo.png'), false);
});

test('proxy allows unlocked pages and redirects an unlocked visit to the unlock page', () => {
  assert.deepEqual(decide('/', { hasSession: true }), { type: 'next' });
  assert.deepEqual(decide('/unlock', { hasSession: true }), {
    type: 'redirect',
    location: '/',
  });
});

test('proxy refuses anyone the gateway did not vouch for as an administrator', () => {
  for (const hasSession of [false, true]) {
    for (const pathname of ['/', '/unlock', '/settings']) {
      assert.deepEqual(decide(pathname, { access: 'forbidden', hasSession }), {
        type: 'forbidden',
      });
    }
  }
  assert.deepEqual(decide('/healthz', { access: 'forbidden' }), {
    type: 'next',
  });
});
