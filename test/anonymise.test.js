import test from 'node:test';
import assert from 'node:assert/strict';

import { truncateIp, makeAnonymiser } from '../dashboard/src/anonymise.js';

// SPEC §3: source IPs are personal data under UK GDPR. Anything published is
// truncated. These tests are the guarantee — if they go red, the privacy
// promise in the README is broken.

test('IPv4 keeps the network and zeroes the host octet', () => {
  assert.equal(truncateIp('165.154.177.119'), '165.154.177.0/24');
  assert.equal(truncateIp('43.163.107.169'), '43.163.107.0/24');
  assert.equal(truncateIp('8.8.8.8'), '8.8.8.0/24');
});

test('IPv4 boundary octets survive truncation', () => {
  assert.equal(truncateIp('0.0.0.0'), '0.0.0.0/24');
  assert.equal(truncateIp('255.255.255.255'), '255.255.255.0/24');
  assert.equal(truncateIp('1.2.3.0'), '1.2.3.0/24');
});

test('addresses in the same /24 collapse to one label', () => {
  // The whole point: neighbouring hosts become indistinguishable.
  const block = ['203.0.113.1', '203.0.113.2', '203.0.113.254'].map(truncateIp);
  assert.deepEqual(new Set(block), new Set(['203.0.113.0/24']));
});

test('IPv6 truncates to /48, expanding :: first', () => {
  assert.equal(truncateIp('2001:db8:abcd:1234::1'), '2001:db8:abcd::/48');
  assert.equal(truncateIp('2001:0db8:0000:0042:0000:0000:0000:0001'), '2001:db8:0::/48');
  assert.equal(truncateIp('fe80::1'), 'fe80:0:0::/48');
});

test('malformed input degrades to a label, never throws', () => {
  // A honeypot logs whatever the network hands it. A bad address must not
  // take down the whole build.
  for (const bad of ['', '   ', 'not-an-ip', '999.1.1.1', '1.2.3', '1.2.3.4.5', null, undefined, 42, {}]) {
    assert.equal(truncateIp(bad), '(invalid)', `input: ${JSON.stringify(bad)}`);
  }
});

test('an already-truncated label passes through unchanged', () => {
  // Re-running the pipeline over its own output must be a no-op, not garbage.
  assert.equal(truncateIp('165.154.177.0/24'), '165.154.177.0/24');
  assert.equal(truncateIp('2001:db8:abcd::/48'), '2001:db8:abcd::/48');
  assert.equal(truncateIp('(invalid)'), '(invalid)');
});

test('makeAnonymiser(true) truncates; makeAnonymiser(false) is identity', () => {
  // The --full-ip local build needs the real addresses; the published build
  // must not be able to get at them by accident.
  const publish = makeAnonymiser(true);
  const local = makeAnonymiser(false);
  assert.equal(publish('165.154.177.119'), '165.154.177.0/24');
  assert.equal(local('165.154.177.119'), '165.154.177.119');
  assert.equal(local(''), '(invalid)'); // still normalises junk
});
