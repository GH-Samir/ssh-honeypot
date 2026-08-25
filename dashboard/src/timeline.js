// Turning a list of instants into the three time views: the capture-window
// bar chart, the day-by-day calendar, and the 24-hour fold.
//
// All three read the clock in UTC (SPEC §5). All three take a plain array of
// epoch numbers, so they are trivially testable and never touch event shape.

import { formatCount, pct, stamp, stampDay, stampDow } from './format.js';

/** Monday-first, so the weekend reads as a pair instead of split across both ends. */
const WEEK = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]];

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;

/**
 * Bucket widths, coarsest-last. The chart wants enough bars to show the shape
 * of a burst but few enough that each stays wide enough to hover, so we take
 * the first width that fits the window into <= 72 of them.
 */
const LADDER = [
  [MINUTE, 'minute'],
  [5 * MINUTE, '5-minute'],
  [15 * MINUTE, '15-minute'],
  [30 * MINUTE, '30-minute'],
  [HOUR, 'hour'],
  [3 * HOUR, '3-hour'],
  [6 * HOUR, '6-hour'],
  [12 * HOUR, '12-hour'],
  [DAY, 'day'],
];

const MAX_BARS = 72;

/** Pick the bucket width for a window. @returns {{ms:number,label:string}} */
export function chooseBucket(spanMs) {
  const span = Math.max(0, Number(spanMs) || 0);
  for (const [ms, label] of LADDER) {
    if (span / ms <= MAX_BARS) return { ms, label };
  }
  const [ms, label] = LADDER[LADDER.length - 1];
  return { ms, label };
}

/**
 * A capture spanning more than a day and a half needs the date on its labels;
 * a shorter one would just repeat the same date on every bar.
 */
const isMultiDay = (span) => span > DAY * 1.5;

const attemptsLabel = (n) => `${formatCount(n)} ${n === 1 ? 'attempt' : 'attempts'}`;

/**
 * Bucket every instant into the capture-window bar chart.
 *
 * @param {number[]} times epoch ms
 * @param {number} t0 first instant
 * @param {number} span window width in ms
 */
export function buildTimeline(times, t0, span) {
  const width = Math.max(0, Number(span) || 0);
  const bucket = chooseBucket(width);
  const multiDay = isMultiDay(width);

  // +1 so the final instant gets a bucket of its own rather than being folded
  // back into the previous one.
  const count = Math.max(1, Math.ceil(width / bucket.ms) + 1);
  const counts = new Array(count).fill(0);
  for (const t of times) {
    const i = Math.floor((t - t0) / bucket.ms);
    counts[Math.min(count - 1, Math.max(0, i))]++;
  }

  const peak = counts.length ? Math.max(...counts) : 0;
  const buckets = counts.map((c, i) => ({
    count: c,
    pct: pct(c, peak),
    title: `${stamp(t0 + i * bucket.ms, multiDay)} UTC — ${attemptsLabel(c)}`,
  }));

  return { buckets, peak, bucket, multiDay };
}

/** UTC calendar date key, 'YYYY-MM-DD'. */
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Day-by-day counts across the capture.
 *
 * Days with no traffic are filled in rather than skipped: a gap in the data is
 * itself a finding (the honeypot was down, or nobody knocked), and a chart that
 * silently closes the gap hides it.
 *
 * @param {number[]} times epoch ms
 */
export function buildDays(times) {
  const counts = new Map();
  for (const t of times) counts.set(dayKey(t), (counts.get(dayKey(t)) || 0) + 1);

  const keys = [...counts.keys()].sort();
  if (!keys.length) return { days: [], spansDays: false, busiest: null, quietCount: 0, peak: 0 };

  const peak = Math.max(...counts.values());
  const first = Date.parse(`${keys[0]}T00:00:00Z`);
  const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`);

  const days = [];
  for (let d = first; d <= last; d += DAY) {
    const count = counts.get(dayKey(d)) || 0;
    days.push({
      key: dayKey(d),
      label: stampDay(d),
      dow: stampDow(d),
      count,
      pct: pct(count, peak),
      quiet: count === 0,
    });
  }

  return {
    days,
    spansDays: keys.length > 1,
    busiest: days.reduce((a, b) => (b.count > a.count ? b : a), days[0]),
    quietCount: days.filter((d) => d.quiet).length,
    peak,
  };
}

/**
 * Every attempt folded onto a single 24-hour clock, all days combined.
 * Answers "do the scanners keep office hours?" — they do not, but the shape
 * still shows which botnets share a schedule.
 *
 * @param {number[]} times epoch ms
 */
export function buildHours(times) {
  const counts = new Array(24).fill(0);
  for (const t of times) counts[new Date(t).getUTCHours()]++;

  const peak = Math.max(...counts);
  const hours = counts.map((count, h) => ({
    hour: String(h).padStart(2, '0'),
    // Label every third hour: 24 labels on a narrow panel overlap into mush.
    tick: h % 3 === 0 ? String(h).padStart(2, '0') : '',
    count,
    pct: pct(count, peak),
    title: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 UTC — ${attemptsLabel(count)}`,
  }));

  return { hours, peak, busiestHour: counts.indexOf(peak) };
}

/**
 * Every attempt folded onto a Mon–Sun week, all weeks combined.
 *
 * The companion question to the hour fold: do the scanners keep a human
 * schedule at the week scale? A flat profile means fully automated fleets; a
 * weekend dip would mean someone is at a keyboard.
 *
 * @param {number[]} times epoch ms
 */
export function buildWeekdays(times) {
  const byDay = new Array(7).fill(0); // indexed by getUTCDay: 0 = Sunday
  for (const t of times) byDay[new Date(t).getUTCDay()]++;

  const peak = Math.max(...byDay);
  const rows = WEEK.map(([dow, i]) => ({
    dow,
    key: dow, // bar-list shape, so the renderer can reuse renderBars
    count: byDay[i],
    label: formatCount(byDay[i]),
    pct: pct(byDay[i], peak),
  }));

  const busiest = rows.reduce((a, b) => (b.count > a.count ? b : a), rows[0]);
  return { rows, peak, busiest: busiest.dow };
}
