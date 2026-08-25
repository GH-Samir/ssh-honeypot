import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseBucket, buildTimeline, buildDays, buildHours, buildWeekdays } from '../dashboard/src/timeline.js';

const HOUR = 3600000, DAY = 86400000;

// A hand-checkable fixture: 6 attempts across 3 calendar days, with 2026-01-02
// deliberately empty so the "quiet day" case is always exercised.
//   Jan 1 (Thu) 10:00:00, 10:00:01, 10:00:02  — three in one burst
//   Jan 1 (Thu) 14:30:00
//   Jan 3 (Sat) 10:00:00
//   Jan 3 (Sat) 18:00:00
const TIMES = [
  '2026-01-01T10:00:00Z', '2026-01-01T10:00:01Z', '2026-01-01T10:00:02Z',
  '2026-01-01T14:30:00Z', '2026-01-03T10:00:00Z', '2026-01-03T18:00:00Z',
].map(Date.parse);

const T0 = TIMES[0];
const SPAN = TIMES[5] - T0; // 56 hours

test('chooseBucket keeps the bar count readable as the window grows', () => {
  // The ladder targets <= 72 bars: enough shape to see bursts, few enough that
  // each bar is still wide enough to hover.
  assert.deepEqual(chooseBucket(30 * 60000), { ms: 60000, label: 'minute' });
  assert.deepEqual(chooseBucket(6 * HOUR), { ms: 300000, label: '5-minute' });
  assert.deepEqual(chooseBucket(56 * HOUR), { ms: HOUR, label: 'hour' });
  assert.deepEqual(chooseBucket(30 * DAY), { ms: 43200000, label: '12-hour' });
});

test('chooseBucket falls back to daily for an absurdly long window', () => {
  assert.deepEqual(chooseBucket(5 * 365 * DAY), { ms: DAY, label: 'day' });
});

test('buildTimeline drops each attempt in the right bucket', () => {
  const { buckets, peak, bucket } = buildTimeline(TIMES, T0, SPAN);

  assert.equal(bucket.label, 'hour');
  assert.equal(buckets.length, 57); // 56 hours spanned, inclusive of both ends
  assert.equal(buckets[0].count, 3); // the 10:00:00–10:00:02 burst
  assert.equal(buckets[4].count, 1); // 14:30 is 4.5h in
  assert.equal(buckets[48].count, 1); // Jan 3 10:00
  assert.equal(buckets[56].count, 1); // Jan 3 18:00
  assert.equal(peak, 3);
  assert.equal(buckets.reduce((a, b) => a + b.count, 0), TIMES.length);
});

test('buildTimeline scales bar heights against the peak and labels them', () => {
  const { buckets } = buildTimeline(TIMES, T0, SPAN);
  assert.equal(buckets[0].pct, '100.00%');
  assert.equal(buckets[1].pct, '0.00%');
  assert.equal(buckets[4].pct, '33.33%');
  // Tooltip has to say which instant it is; the chart has only 3 axis labels.
  assert.equal(buckets[0].title, 'Jan 1 10:00 UTC — 3 attempts');
  assert.equal(buckets[4].title, 'Jan 1 14:00 UTC — 1 attempt');
  assert.equal(buckets[1].title, 'Jan 1 11:00 UTC — 0 attempts');
});

test('buildTimeline survives every attempt landing on one instant', () => {
  // span would be 0; a zero-width window must not produce NaN or an infinite
  // bucket count.
  const same = [T0, T0, T0];
  const { buckets, peak } = buildTimeline(same, T0, 0);
  assert.ok(buckets.length >= 1);
  assert.equal(peak, 3);
  assert.equal(buckets[0].count, 3);
});

test('buildDays fills the calendar including days with no traffic', () => {
  const { days, spansDays, busiest, quietCount } = buildDays(TIMES);

  assert.equal(spansDays, true);
  assert.equal(days.length, 3); // Jan 1, 2, 3 — the hole is present, not skipped
  assert.deepEqual(days.map((d) => d.count), [4, 0, 2]);
  assert.deepEqual(days.map((d) => d.label), ['Jan 1', 'Jan 2', 'Jan 3']);
  assert.deepEqual(days.map((d) => d.dow), ['Thu', 'Fri', 'Sat']);
  assert.deepEqual(days.map((d) => d.quiet), [false, true, false]);
  assert.equal(quietCount, 1);
  assert.equal(busiest.label, 'Jan 1');
  assert.equal(days[0].pct, '100.00%');
  assert.equal(days[1].pct, '0.00%');
  assert.equal(days[2].pct, '50.00%');
});

test('buildDays reports a single-day capture as not spanning days', () => {
  const oneDay = [Date.parse('2026-01-01T01:00:00Z'), Date.parse('2026-01-01T23:00:00Z')];
  const { days, spansDays } = buildDays(oneDay);
  assert.equal(spansDays, false);
  assert.equal(days.length, 1);
});

test('buildHours folds every day onto one 24-hour clock', () => {
  const { hours, busiestHour, peak } = buildHours(TIMES);

  assert.equal(hours.length, 24);
  assert.equal(hours[10].count, 4); // 3 on Jan 1 + 1 on Jan 3, same hour slot
  assert.equal(hours[14].count, 1);
  assert.equal(hours[18].count, 1);
  assert.equal(hours[0].count, 0);
  assert.equal(busiestHour, 10);
  assert.equal(peak, 4);
  assert.equal(hours[10].pct, '100.00%');
  assert.equal(hours[14].pct, '25.00%');
});

test('buildHours labels every third hour so the axis stays legible', () => {
  const { hours } = buildHours(TIMES);
  assert.equal(hours[0].tick, '00');
  assert.equal(hours[1].tick, '');
  assert.equal(hours[3].tick, '03');
  assert.equal(hours[21].tick, '21');
  assert.equal(hours[10].title, '10:00–10:59 UTC — 4 attempts');
});

test('buildWeekdays folds every week onto Mon–Sun', () => {
  // The fixture: Jan 1 2026 is a Thursday (4 events), Jan 3 a Saturday (2).
  const { rows, busiest, peak } = buildWeekdays(TIMES);

  assert.equal(rows.length, 7);
  // Monday-first: the interesting contrast is weekday vs weekend, so the
  // weekend sits together at the end instead of being split across both ends.
  assert.deepEqual(rows.map((r) => r.dow), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(rows.map((r) => r.count), [0, 0, 0, 4, 0, 2, 0]);
  assert.equal(peak, 4);
  assert.equal(busiest, 'Thu');
  assert.equal(rows[3].pct, '100.00%');
  assert.equal(rows[5].pct, '50.00%');
});

test('buildWeekdays labels each row for the bar list', () => {
  const { rows } = buildWeekdays(TIMES);
  assert.equal(rows[3].key, 'Thu');
  assert.equal(rows[3].label, '4');
});

test('the time builders accept an empty capture', () => {
  // Reachable via drag-and-drop of a log whose lines were all malformed.
  assert.equal(buildDays([]).days.length, 0);
  assert.equal(buildDays([]).spansDays, false);
  assert.equal(buildHours([]).hours.length, 24);
  assert.equal(buildHours([]).busiestHour, 0);
  assert.equal(buildWeekdays([]).rows.length, 7);
  assert.equal(buildWeekdays([]).rows.every((r) => r.count === 0), true);
});
