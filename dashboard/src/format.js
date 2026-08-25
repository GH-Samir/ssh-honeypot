// Display formatting.
//
// Deliberately no Intl / toLocaleString. The same value is formatted in three
// places — the build script on a dev machine, the test runner in CI, and a
// visitor's browser — and Intl output varies with ICU build and host locale.
// Hand-rolling keeps all three byte-identical.
//
// SPEC §5: "always UTC, no local time anywhere". Every date accessor below is
// a getUTC* one, so the host timezone cannot leak into a label.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad2 = (n) => String(n).padStart(2, '0');

/** 121310 → '121,310'. Junk becomes '0' rather than reaching a visitor as NaN. */
export function formatCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const neg = v < 0;
  const digits = String(Math.abs(Math.trunc(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${digits}` : digits;
}

/**
 * Human-readable span. Minutes below an hour, hours below two days, then days —
 * the unit that keeps the number small enough to read at a glance.
 */
export function durationLabel(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return '1 min';
  const hours = v / 3600000;
  // Never report "0 min" for a short-but-real window; one attempt still spans
  // an instant worth calling a minute.
  if (hours < 1) return `${Math.max(1, Math.round(v / 60000))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

/** 'HH:MM' in UTC. */
export function stampTime(ms) {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 'Jul 29' in UTC. Day is unpadded — it reads as prose, not a column. */
export function stampDay(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** 'Wed' in UTC. */
export function stampDow(ms) {
  return DAYS[new Date(ms).getUTCDay()];
}

/**
 * Timestamp for an axis or a log row. A single-day capture does not need the
 * date repeated on every row; a month-long one does.
 */
export function stamp(ms, multiDay) {
  return multiDay ? `${stampDay(ms)} ${stampTime(ms)}` : stampTime(ms);
}

/**
 * Bar width as a CSS percentage of the largest value in its set.
 * Clamped because a width outside 0–100% breaks the track it sits in.
 */
export function pct(value, max) {
  const v = Number(value), m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0 || v <= 0) return '0.00%';
  return `${Math.min(100, (v / m) * 100).toFixed(2)}%`;
}

/** Proportion of the whole, for "50.1% of all attempts" style labels. */
export function share(value, total) {
  const v = Number(value), t = Number(total);
  if (!Number.isFinite(v) || !Number.isFinite(t) || t <= 0 || v <= 0) return '0.0%';
  return `${Math.min(100, (v / t) * 100).toFixed(1)}%`;
}
