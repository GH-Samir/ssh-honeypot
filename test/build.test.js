import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFromText, findFullIps, writeSummary, OUTPUT_NAME } from '../analysis/build.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/sample.jsonl', import.meta.url));
const text = fs.readFileSync(FIXTURE, 'utf8');

const GEO = new Map([
  ['165.154.177.119', { country: 'China', countryCode: 'CN', asn: 'AS1', asOrg: 'UCLOUD' }],
  ['165.154.177.4', { country: 'China', countryCode: 'CN', asn: 'AS1', asOrg: 'UCLOUD' }],
  ['43.163.107.169', { country: 'Singapore', countryCode: 'SG', asn: 'AS2', asOrg: 'Tencent' }],
  ['8.8.8.8', { country: 'United States', countryCode: 'US', asn: 'AS15169', asOrg: 'Google LLC' }],
]);

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'build-'));

test('buildFromText turns a log into a summary', () => {
  const { summary, stats } = buildFromText(text, { geo: GEO });

  assert.equal(stats.lines, 8);   // 7 events plus the truncated line
  assert.equal(stats.parsed, 7);
  assert.equal(stats.skipped, 1);
  assert.equal(summary.meta.total, 7);
  assert.equal(summary.meta.blockCount, 3);
  assert.equal(summary.meta.anonymised, true);
});

test('buildFromText anonymises by default', () => {
  const { summary } = buildFromText(text, { geo: GEO });
  assert.equal(summary.ipBars[0].key, '165.154.177.0/24');
  assert.equal(summary.log.rows.every((r) => r.ip.endsWith('/24')), true);
});

test('buildFromText in full-IP mode keeps real addresses', () => {
  const { summary } = buildFromText(text, { geo: GEO, fullIp: true });
  assert.equal(summary.meta.anonymised, false);
  assert.equal(summary.ipBars[0].key, '165.154.177.119');
});

test('buildFromText stamps when the build ran', () => {
  const before = Date.now();
  const { summary } = buildFromText(text, { geo: GEO });
  assert.ok(Date.parse(summary.meta.generatedAt) >= before);
});

test('buildFromText works with no geo data at all', () => {
  const { summary } = buildFromText(text, { geo: null });
  assert.equal(summary.geo.available, false);
  assert.equal(summary.meta.total, 7);
});

// ── the privacy guard ──────────────────────────────────────────────────────

test('findFullIps passes a properly anonymised summary', () => {
  const { summary } = buildFromText(text, { geo: GEO });
  assert.deepEqual(findFullIps(summary), []);
});

test('findFullIps catches a summary that was not anonymised', () => {
  // The guard has to be able to fail, or it proves nothing.
  const { summary } = buildFromText(text, { geo: GEO, fullIp: true });
  const found = findFullIps(summary);
  assert.ok(found.length > 0);
  assert.ok(found.some((f) => f.value.includes('165.154.177.119')));
  assert.ok(found.some((f) => f.path.startsWith('ipBars')));
});

test('findFullIps looks inside prose, not just fields', () => {
  // The burst caption names an address: "1,417 guesses from X in 119s".
  const { summary } = buildFromText(text, { geo: GEO, fullIp: true });
  assert.ok(findFullIps(summary).some((f) => f.path === 'strips.note'));
});

test('findFullIps ignores an address-shaped password', () => {
  // The real capture contains the password '0.0.0.0.'. Scanning attacker-
  // supplied text would fail the build over a credential, not a leak.
  const { summary } = buildFromText(text, { geo: GEO });
  assert.equal(summary.pwBars.some((b) => b.key === '0.0.0.0.'), true);
  assert.deepEqual(findFullIps(summary), []);
});

test('findFullIps ignores address-shaped usernames and banners', () => {
  const hostile = JSON.stringify({
    ts: '2026-01-01T10:00:00Z', src_ip: '1.1.1.1',
    username: '10.11.12.13', password: 'x',
    client_banner: 'SSH-2.0-9.9.9.9', session_id: 'S', attempt_no: 1,
  });
  const { summary } = buildFromText(hostile, { geo: null });
  assert.deepEqual(findFullIps(summary), []);
});

test('findFullIps flags a new address field added later', () => {
  // Fail-safe: anything not explicitly known to be attacker text gets scanned,
  // so a future field cannot smuggle an address out unnoticed.
  const { summary } = buildFromText(text, { geo: GEO });
  summary.meta.probedFrom = '203.0.113.7';
  assert.ok(findFullIps(summary).some((f) => f.path === 'meta.probedFrom'));
});

// ── writing ────────────────────────────────────────────────────────────────

test('writeSummary creates the directory and writes parseable JSON', () => {
  const dir = tmpdir();
  try {
    const { summary } = buildFromText(text, { geo: GEO });
    const file = writeSummary(path.join(dir, 'data'), summary);

    assert.equal(path.basename(file), OUTPUT_NAME);
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(loaded.meta.total, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSummary refuses to publish a summary carrying full addresses', () => {
  // The last line of defence: even if someone runs the published build with the
  // wrong flag, the file does not get written.
  const dir = tmpdir();
  try {
    const { summary } = buildFromText(text, { geo: GEO, fullIp: true });
    assert.throws(
      () => writeSummary(path.join(dir, 'data'), summary),
      /full source address/i,
    );
    assert.equal(fs.existsSync(path.join(dir, 'data', OUTPUT_NAME)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSummary allows full addresses only when explicitly told to', () => {
  const dir = tmpdir();
  try {
    const { summary } = buildFromText(text, { geo: GEO, fullIp: true });
    const file = writeSummary(path.join(dir, 'data'), summary, { allowFullIps: true });
    assert.match(path.basename(file), /\.full\.json$/); // gitignored name
    assert.ok(fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
