import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareRows, buildSummary } from '../dashboard/src/summary.js';
import { truncateIp } from '../dashboard/src/anonymise.js';

const ev = (ts, ip, username, password, session_id, attempt_no, banner = 'SSH-2.0-libssh_0.9.6') => ({
  ts, t: Date.parse(ts), src_ip: ip, username, password, session_id, attempt_no, client_banner: banner,
});

const ROWS = [
  ev('2026-01-01T10:00:00Z', '165.154.177.119', 'root', '123456', 'A', 1, 'SSH-2.0-Go'),
  ev('2026-01-01T10:00:01Z', '165.154.177.119', 'root', 'password', 'A', 2, 'SSH-2.0-Go'),
  ev('2026-01-01T10:00:02Z', '165.154.177.4', 'admin', '123456', 'A2', 1, 'SSH-2.0-Go'),
  ev('2026-01-01T14:30:00Z', '43.163.107.169', 'root', '123456', 'B', 1),
  ev('2026-01-03T10:00:00Z', '8.8.8.8', 'admin', 'admin', 'C', 1, 'SSH-2.0-PuTTY_Release_0.84'),
  ev('2026-01-03T18:00:00Z', '165.154.177.119', 'root', '123456', 'D', 1, 'SSH-2.0-Go'),
];

const GEO = new Map([
  ['165.154.177.119', { country: 'China', countryCode: 'CN', asn: 'AS1', asOrg: 'UCLOUD' }],
  ['165.154.177.4', { country: 'China', countryCode: 'CN', asn: 'AS1', asOrg: 'UCLOUD' }],
  ['43.163.107.169', { country: 'Singapore', countryCode: 'SG', asn: 'AS2', asOrg: 'Tencent' }],
  ['8.8.8.8', { country: 'United States', countryCode: 'US', asn: 'AS15169', asOrg: 'Google LLC' }],
]);

const prepared = (opts = {}) => prepareRows(ROWS, { anonymise: truncateIp, geo: GEO, ...opts });

// ── prepareRows ────────────────────────────────────────────────────────────

test('prepareRows replaces the address with its published label', () => {
  const rows = prepareRows(ROWS, { anonymise: truncateIp, geo: GEO });
  assert.equal(rows[0].src_ip, '165.154.177.0/24');
  assert.equal(rows[4].src_ip, '8.8.8.0/24');
});

test('prepareRows leaves no full address anywhere in its output', () => {
  // This is the privacy guarantee, asserted on the whole serialised structure
  // rather than field by field — a new field added later cannot smuggle one out.
  const serialised = JSON.stringify(prepareRows(ROWS, { anonymise: truncateIp, geo: GEO }));
  const fullIps = serialised.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b(?!\/24)/g) || [];
  assert.deepEqual(fullIps, []);
});

test('prepareRows joins geo on the real address, before truncation', () => {
  // Truncating first would look up 165.154.177.0, which is a different host.
  const rows = prepareRows(ROWS, { anonymise: truncateIp, geo: GEO });
  assert.equal(rows[0].country, 'China');
  assert.equal(rows[0].asOrg, 'UCLOUD');
  assert.equal(rows[4].country, 'United States');
});

test('prepareRows without geo marks origin unknown rather than omitting it', () => {
  const rows = prepareRows(ROWS, { anonymise: truncateIp, geo: null });
  assert.equal(rows[0].country, null);
});

test('prepareRows in full-IP mode keeps the real address', () => {
  const rows = prepareRows(ROWS, { anonymise: (ip) => ip, geo: GEO });
  assert.equal(rows[0].src_ip, '165.154.177.119');
});

// ── buildSummary ───────────────────────────────────────────────────────────

test('buildSummary reports the headline counts', () => {
  const s = buildSummary(prepared());
  assert.equal(s.meta.total, 6);
  assert.equal(s.meta.blockCount, 3);   // two /24s plus 8.8.8.0/24
  assert.equal(s.meta.userCount, 2);    // root, admin
  assert.equal(s.meta.pwCount, 3);      // 123456, password, admin
  assert.equal(s.meta.sessionCount, 5); // A, A2, B, C, D
});

test('buildSummary collapses neighbouring hosts into one block', () => {
  // .119 (3 attempts) and .4 (1) are separate sources but one published label,
  // so the top bar shows their combined 4, not either one alone.
  const s = buildSummary(prepared());
  assert.equal(s.ipBars[0].key, '165.154.177.0/24');
  assert.equal(s.ipBars[0].count, 4);
});

test('buildSummary builds one KPI tile per headline number', () => {
  const s = buildSummary(prepared());
  const labels = s.kpis.map((k) => k.label);
  assert.deepEqual(labels, ['Attempts', 'Source blocks', 'Sessions', 'Usernames', 'Passwords', 'Countries', 'Window']);
  assert.equal(s.kpis[0].value, '6');
  assert.equal(s.kpis[3].note, '"root" leads at 66.7%');
});

test('buildSummary drops the countries tile when there is no geo data', () => {
  const s = buildSummary(prepareRows(ROWS, { anonymise: truncateIp, geo: null }));
  assert.ok(!s.kpis.some((k) => k.label === 'Countries'));
  assert.equal(s.geo.available, false);
});

test('buildSummary ranks countries by attempts and by network', () => {
  const s = buildSummary(prepared());
  assert.equal(s.geo.available, true);
  assert.equal(s.geo.countryBars[0].key, 'China');
  assert.equal(s.geo.countryBars[0].count, 4);
  assert.equal(s.geo.networkBars[0].key, 'UCLOUD');
  assert.equal(s.geo.countryCount, 3);
});

test('buildSummary honours topN across every ranked panel', () => {
  const s = buildSummary(prepared(), { topN: 1 });
  assert.equal(s.ipBars.length, 1);
  assert.equal(s.userBars.length, 1);
  assert.equal(s.pwBars.length, 1);
});

test('buildSummary strips the protocol prefix from client banners', () => {
  // Every banner starts 'SSH-2.0-'; repeating it 21 times costs column width
  // and tells the reader nothing.
  const s = buildSummary(prepared());
  assert.equal(s.bannerBars[0].key, 'Go');
  assert.equal(s.bannerBars[0].count, 4);
});

test('buildSummary writes the prose notes the panels are captioned with', () => {
  const s = buildSummary(prepared());
  assert.match(s.days.note, /Busiest day: Jan 1 at 4 attempts/);
  assert.match(s.hours.note, /Peak hour is 10:00 UTC/);
  assert.match(s.strips.note, /2 guesses from 165\.154\.177\.0\/24 in 1s/);
  assert.match(s.strips.note, /80\.0% of sessions made exactly one attempt/);
  assert.match(s.pwNote, /3 distinct passwords/);
});

test('buildSummary shows the newest events first in the log', () => {
  // The aggregate panels carry the totals; the log is for seeing what is
  // happening now, so it reads newest-first rather than from the start of the
  // capture the way the mockup did.
  const s = buildSummary(prepared());
  assert.equal(s.log.rows[0].time, 'Jan 3 18:00');
  assert.equal(s.log.rows[0].ip, '165.154.177.0/24');
  assert.equal(s.log.rows[0].banner, 'Go');
  assert.equal(s.log.rows[0].att, '1');
});

test('buildSummary caps the log and says so honestly', () => {
  const s = buildSummary(prepared(), { logLimit: 2 });
  assert.equal(s.log.rows.length, 2);
  assert.equal(s.log.shown, 2);
  assert.equal(s.log.total, 6);
  assert.match(s.log.note, /most recent 2 of 6/);
});

test('buildSummary keeps hostile credentials intact for the renderer to escape', () => {
  const nasty = [ev('2026-01-01T10:00:00Z', '1.2.3.4', '<script>alert(1)</script>', 'x', 'S', 1)];
  const s = buildSummary(prepareRows(nasty, { anonymise: truncateIp, geo: null }));
  assert.equal(s.log.rows[0].user, '<script>alert(1)</script>');
  assert.equal(s.userBars[0].key, '<script>alert(1)</script>');
});

test('buildSummary produces a renderable shape for an empty capture', () => {
  // Reachable by dropping a file whose every line was malformed.
  const s = buildSummary([]);
  assert.equal(s.meta.total, 0);
  assert.equal(s.kpis.length > 0, true);
  assert.deepEqual(s.ipBars, []);
  assert.deepEqual(s.log.rows, []);
  assert.equal(s.strips.rows.length, 0);
  assert.equal(s.geo.available, false);
});
