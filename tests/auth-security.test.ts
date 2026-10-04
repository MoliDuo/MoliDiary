import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientAddressFromForwardedFor,
  createLoginAttemptKey,
  readBearerToken,
} from '@/lib/auth/security';

test('Bearer tokens are read from the Authorization header', () => {
  assert.equal(readBearerToken('Bearer limen_a.b'), 'limen_a.b');
  assert.equal(readBearerToken('Basic abc'), null);
  assert.equal(readBearerToken(null), null);
});

test('login identifiers are hashed and stable', () => {
  const first = createLoginAttemptKey('203.0.113.1, 10.0.0.1');
  assert.equal(first, createLoginAttemptKey('203.0.113.1'));
  assert.notEqual(first, createLoginAttemptKey('203.0.113.2'));
  assert.doesNotMatch(first, /203\.0\.113/);
  assert.equal(createLoginAttemptKey(null), createLoginAttemptKey(''));
});

test('the client is the first public address from the right', () => {
  // A client can prepend anything; only what our proxies appended counts.
  assert.equal(
    clientAddressFromForwardedFor('1.1.1.1, 203.0.113.9, 172.18.255.11'),
    '203.0.113.9',
  );
  assert.equal(
    clientAddressFromForwardedFor('2001:db8::5, 100.64.0.7'),
    '2001:db8::5',
  );
  assert.equal(clientAddressFromForwardedFor('203.0.113.9'), '203.0.113.9');
});

test('a chain of only private hops falls back to the nearest one', () => {
  assert.equal(
    clientAddressFromForwardedFor('192.168.1.20, 172.18.0.2'),
    '172.18.0.2',
  );
  assert.equal(clientAddressFromForwardedFor('not-an-ip'), 'not-an-ip');
  assert.equal(clientAddressFromForwardedFor(null), 'unknown');
});

test('spoofed prefixes do not change the login bucket', () => {
  assert.equal(
    createLoginAttemptKey('9.9.9.9, 203.0.113.9, 172.18.255.11'),
    createLoginAttemptKey('203.0.113.9, 172.18.255.11'),
  );
});
