import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGatewayAccess } from '@/lib/auth/identity';

function headers(values: Record<string, string>) {
  return new Headers(values);
}

test('an administrator the gateway vouches for gets in', () => {
  assert.equal(
    checkGatewayAccess(
      headers({ 'remote-user': 'someone', 'remote-groups': 'users,admins' }),
      true,
    ),
    'admin',
  );
  assert.equal(
    checkGatewayAccess(
      headers({ 'remote-user': 'someone', 'remote-groups': 'users, admins' }),
      true,
    ),
    'admin',
  );
});

test('everyone else is refused in production', () => {
  for (const values of <Record<string, string>[]>[
    {},
    { 'remote-groups': 'admins' },
    { 'remote-user': ' ', 'remote-groups': 'admins' },
    { 'remote-user': 'someone' },
    { 'remote-user': 'someone', 'remote-groups': 'users' },
    // The name is never compared, only the group.
    { 'remote-user': 'admins', 'remote-groups': 'users' },
    { 'remote-user': 'someone', 'remote-groups': 'superadmins' },
  ]) {
    assert.equal(checkGatewayAccess(headers(values), true), 'forbidden');
  }
});

test('development has no gateway and is let through', () => {
  assert.equal(checkGatewayAccess(headers({}), false), 'admin');
});
