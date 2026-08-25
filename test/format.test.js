import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCount,
  durationLabel,
  stampTime,
  stampDay,
  stampDow,
  stamp,
  pct,
  share,
} from '../dashboard/src/format.js';

// Everything here must be independent of the host locale and timezone: the
// build runs on Samir's machine, the tests run in CI, and the page renders in
// a visitor's browser. All three have to print the same string. SPEC §5 also
// says "always UTC, no local time anywhere".

test('formatCount groups thousands', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(7), '7');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1000), '1,000');
  assert.equal(formatCount(121310), '121,310');
  assert.equal(formatCount(1234567), '1,234,567');
});

test('formatCount handles junk without printing NaN at a visitor', () => {
  assert.equal(formatCount(null), '0');
  assert.equal(formatCount(undefined), '0');
  assert.equal(formatCount('nope'), '0');
  assert.equal(formatCount(-42), '-42');
});

test('durationLabel switches unit at the right boundaries', () => {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  assert.equal(durationLabel(0), '1 min');           // never claim zero
  assert.equal(durationLabel(30 * MIN), '30 min');
  assert.equal(durationLabel(HOUR), '1 h');          // 1h exactly flips to hours
  assert.equal(durationLabel(90 * MIN), '1.5 h');
  assert.equal(durationLabel(47 * HOUR), '47 h');
  assert.equal(durationLabel(48 * HOUR), '2 days');  // 48h exactly flips to days
  assert.equal(durationLabel(30 * DAY), '30 days');
});

test('durationLabel describes this capture window', () => {
  // 2026-07-15T11:50:24Z → 2026-08-14T02:59:11Z, the real span.
  const span = Date.parse('2026-08-14T02:59:11.918Z') - Date.parse('2026-07-15T11:50:24.624Z');
  assert.equal(durationLabel(span), '29.6 days');
});

test('stamps read the clock in UTC, not the host timezone', () => {
  // 2026-07-29T18:42:07Z — a moment inside the busiest day of the capture.
  const t = Date.parse('2026-07-29T18:42:07Z');
  assert.equal(stampTime(t), '18:42');
  assert.equal(stampDay(t), 'Jul 29');
  assert.equal(stampDow(t), 'Wed');
});

test('stamps pad single digits so columns line up', () => {
  const t = Date.parse('2026-08-05T04:07:00Z');
  assert.equal(stampTime(t), '04:07');
  assert.equal(stampDay(t), 'Aug 5');
  assert.equal(stampDow(t), 'Wed');
});

test('stamp adds the date only when the capture spans days', () => {
  const t = Date.parse('2026-07-29T18:42:07Z');
  assert.equal(stamp(t, true), 'Jul 29 18:42');
  assert.equal(stamp(t, false), '18:42');
});

test('stamps survive a midnight boundary', () => {
  const t = Date.parse('2026-08-14T00:00:00Z');
  assert.equal(stampTime(t), '00:00');
  assert.equal(stamp(t, true), 'Aug 14 00:00');
});

test('pct is a CSS width relative to the largest bar', () => {
  assert.equal(pct(50, 100), '50.00%');
  assert.equal(pct(5587, 5587), '100.00%');
  assert.equal(pct(1, 3), '33.33%');
  assert.equal(pct(0, 100), '0.00%');
});

test('pct never divides by zero or exceeds the track', () => {
  // An all-zero bucket set would otherwise render NaN% and collapse the layout.
  assert.equal(pct(0, 0), '0.00%');
  assert.equal(pct(5, 0), '0.00%');
  assert.equal(pct(150, 100), '100.00%');
  assert.equal(pct(-5, 100), '0.00%');
});

test('share is a one-decimal proportion of the whole', () => {
  assert.equal(share(60799, 121310), '50.1%');
  assert.equal(share(1, 121310), '0.0%');
  assert.equal(share(121310, 121310), '100.0%');
  assert.equal(share(5, 0), '0.0%');
});
