import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProxyRequest, shouldBypassProxy } from '@/proxy';

function decide(
  pathname: string,
  overrides: Partial<Parameters<typeof evaluateProxyRequest>[0]> = {},
) {
  return evaluateProxyRequest({
    pathname,
    signedIn: true,
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

test('proxy sends anyone who is not signed in to Authelia, whatever the path', () => {
  for (const pathname of ['/', '/unlock', '/settings']) {
    assert.deepEqual(decide(pathname, { signedIn: false }), { type: 'login' });
  }
  assert.deepEqual(decide('/healthz', { signedIn: false }), { type: 'next' });
  assert.deepEqual(decide('/auth/callback', { signedIn: false }), {
    type: 'next',
  });
  assert.equal(shouldBypassProxy('/auth/login'), true);
});
