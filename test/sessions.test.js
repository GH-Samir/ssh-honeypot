import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSessions, buildStrips, buildPairs } from '../dashboard/src/sessions.js';

const ev = (ts, ip, username, password, session_id, attempt_no) => ({
  ts, t: Date.parse(ts), src_ip: ip, username, password, session_id, attempt_no,
});

// Same shape as the timeline fixture, now with credentials and sessions.
//   A  10.0.0.1     three guesses fired inside 2 seconds — an automated burst
//   B  10.0.0.2     one guess, then gone
//   C  192.168.5.7  one guess, two days later
//   D  10.0.0.1     the first address coming back for a second session
const ROWS = [
  ev('2026-01-01T10:00:00Z', '10.0.0.1', 'root', '123456', 'A', 1),
  ev('2026-01-01T10:00:01Z', '10.0.0.1', 'root', 'password', 'A', 2),
  ev('2026-01-01T10:00:02Z', '10.0.0.1', 'admin', '123456', 'A', 3),
  ev('2026-01-01T14:30:00Z', '10.0.0.2', 'root', '123456', 'B', 1),
  ev('2026-01-03T10:00:00Z', '192.168.5.7', 'admin', 'admin', 'C', 1),
  ev('2026-01-03T18:00:00Z', '10.0.0.1', 'root', '123456', 'D', 1),
];

const T0 = ROWS[0].t;
const SPAN = ROWS[5].t - T0; // 56 hours

test('buildSessions groups attempts by connection', () => {
  const { sessions, total, multiCount, singleCount } = buildSessions(ROWS);

  assert.equal(total, 4);       // A, B, C, D
  assert.equal(multiCount, 1);  // only A guessed more than once
  assert.equal(singleCount, 3);

  const a = sessions.find((s) => s.id === 'A');
  assert.equal(a.count, 3);
  assert.equal(a.ip, '10.0.0.1');
  assert.equal(a.durationMs, 2000);
});

test('buildSessions finds the longest burst and how long it took', () => {
  // This is the headline number for the burst panel: N guesses in M seconds.
  const { biggest } = buildSessions(ROWS);
  assert.equal(biggest.id, 'A');
  assert.equal(biggest.count, 3);
  assert.equal(biggest.ip, '10.0.0.1');
  assert.equal(biggest.durationMs, 2000);
});

test('buildSessions reports the share that gave up after one guess', () => {
  // 3 of 4 sessions made exactly one attempt.
  assert.equal(buildSessions(ROWS).singleShare, '75.0%');
});

test('buildSessions counts sessions per source address', () => {
  const { perIp } = buildSessions(ROWS);
  assert.equal(perIp.get('10.0.0.1'), 2); // sessions A and D
  assert.equal(perIp.get('10.0.0.2'), 1);
  assert.equal(perIp.get('192.168.5.7'), 1);
});

test('buildSessions falls back when a row carries no session_id', () => {
  // The listener always writes one, but a hand-edited or older log might not,
  // and collapsing every such row into a single giant session would be a lie.
  const rows = [
    ev('2026-01-01T10:00:00Z', '10.0.0.1', 'root', 'a', null, 1),
    ev('2026-01-01T10:00:05Z', '10.0.0.1', 'root', 'b', null, 1),
    ev('2026-01-01T10:00:05Z', '10.0.0.2', 'root', 'c', undefined, 1),
  ];
  assert.equal(buildSessions(rows).total, 3);
});

test('buildSessions on an empty capture reports nothing rather than crashing', () => {
  const s = buildSessions([]);
  assert.equal(s.total, 0);
  assert.equal(s.biggest, null);
  assert.equal(s.singleShare, '0.0%');
});

test('buildStrips bins attempts into columns instead of one node each', () => {
  // The mockup emitted one absolutely-positioned div per attempt: 52,688 of
  // them for the top 14 addresses of the real capture. Binning keeps the same
  // picture at a fixed node budget.
  const strips = buildStrips(ROWS, { t0: T0, span: SPAN, limit: 10, columns: 8 });

  assert.equal(strips.length, 3);
  assert.equal(strips[0].ip, '10.0.0.1'); // ordered by attempts, busiest first
  assert.equal(strips[0].count, 4);
  assert.equal(strips[0].sessions, 2);
  assert.equal(strips[0].meta, '4 · 2 sess');

  // Three attempts land in column 0, the fourth at the very end of the window.
  assert.deepEqual(strips[0].cells.map((c) => [c.col, c.count]), [[0, 3], [7, 1]]);
});

test('buildStrips places and sizes each cell as a CSS offset', () => {
  const [busiest] = buildStrips(ROWS, { t0: T0, span: SPAN, limit: 10, columns: 8 });
  assert.equal(busiest.cells[0].left, '0.000%');
  assert.equal(busiest.cells[1].left, '87.500%');
  assert.equal(busiest.cells[0].width, '12.500%');
});

test('buildStrips shades a cell by how many attempts it holds', () => {
  // Density is the whole point of the panel — a solid block is an automated
  // burst, scattered faint ticks are slow probing.
  const [busiest] = buildStrips(ROWS, { t0: T0, span: SPAN, limit: 10, columns: 8 });
  assert.equal(busiest.cells[0].opacity, 1);     // 3 of 3, the strip's densest
  assert.equal(busiest.cells[1].opacity, 0.57);  // 1 of 3, still clearly visible
});

test('buildStrips orders ties by address so rebuilds are stable', () => {
  const strips = buildStrips(ROWS, { t0: T0, span: SPAN, limit: 10, columns: 8 });
  assert.deepEqual(strips.map((s) => s.ip), ['10.0.0.1', '10.0.0.2', '192.168.5.7']);
});

test('buildStrips honours the row limit', () => {
  const strips = buildStrips(ROWS, { t0: T0, span: SPAN, limit: 2, columns: 8 });
  assert.deepEqual(strips.map((s) => s.ip), ['10.0.0.1', '10.0.0.2']);
});

test('buildStrips survives a zero-width window', () => {
  // Every attempt at the same instant: must not divide by zero into NaN%.
  const same = ROWS.slice(0, 3).map((r) => ({ ...r, t: T0 }));
  const [strip] = buildStrips(same, { t0: T0, span: 0, limit: 5, columns: 8 });
  assert.equal(strip.cells.length, 1);
  assert.equal(strip.cells[0].left, '0.000%');
  assert.equal(strip.cells[0].count, 3);
});

test('buildPairs keeps only credentials tried more than once', () => {
  // A pair seen twice from different sources is evidence of a shared wordlist;
  // a pair seen once is noise.
  const pairs = buildPairs(ROWS, 10);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], { u: 'root', p: '123456', count: 3, n: '3' });
});

test('buildPairs does not confuse a username containing the separator', () => {
  // Joining on a printable character would let 'a:b' + 'c' collide with
  // 'a' + 'b:c'. The pair key has to be unambiguous.
  const rows = [
    ev('2026-01-01T10:00:00Z', '1.1.1.1', 'a', 'b:c', 'S1', 1),
    ev('2026-01-01T10:00:01Z', '1.1.1.1', 'a', 'b:c', 'S2', 1),
    ev('2026-01-01T10:00:02Z', '1.1.1.1', 'a:b', 'c', 'S3', 1),
    ev('2026-01-01T10:00:03Z', '1.1.1.1', 'a:b', 'c', 'S4', 1),
  ];
  const pairs = buildPairs(rows, 10);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((p) => [p.u, p.p, p.count]).sort(),
    [['a', 'b:c', 2], ['a:b', 'c', 2]]);
});

test('buildPairs labels blank credentials rather than dropping them', () => {
  const rows = [
    ev('2026-01-01T10:00:00Z', '1.1.1.1', '', '', 'S1', 1),
    ev('2026-01-01T10:00:01Z', '1.1.1.1', '', '', 'S2', 1),
  ];
  assert.deepEqual(buildPairs(rows, 10)[0], { u: '(empty)', p: '(empty)', count: 2, n: '2' });
});

test('buildPairs returns nothing when every credential is unique', () => {
  assert.deepEqual(buildPairs(ROWS.slice(4, 5), 10), []);
});
