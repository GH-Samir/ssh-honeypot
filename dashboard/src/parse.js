// Reading the log and counting things in it.
//
// The same code runs in two places: analysis/build.mjs over the full 121k-line
// capture, and the browser over a file someone drags onto the page. Keeping it
// one module is what stops the published numbers and the drag-and-drop numbers
// from quietly disagreeing.

import { formatCount, pct, share } from './format.js';

/** Label for a value the attacker left blank — a real observation, not a gap. */
export const EMPTY = '(empty)';

/**
 * Parse JSON-lines into time-sorted event rows.
 *
 * Every row gains a numeric `t` (epoch ms) so the later passes — timeline,
 * days, hours, sessions, bursts — never re-parse the same ISO string. Over
 * 121k rows that is the difference between one date parse each and six.
 *
 * Malformed lines are skipped rather than thrown: a rotated log can end
 * mid-write, and one bad line must not cost the whole report.
 *
 * @param {string} text
 * @returns {object[]} rows sorted by ascending time
 */
export function parseEvents(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object' || !row.ts) continue;

    const t = Date.parse(row.ts);
    if (Number.isNaN(t)) continue;

    row.t = t;
    out.push(row);
  }

  // events_combined.jsonl is rotated logs concatenated, so it is not globally
  // ordered even though each segment is.
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Count rows by a derived key, most frequent first.
 *
 * Ties break on the key itself. Without that the order falls out of Map
 * insertion order, and rebuilding from the same log could reshuffle a chart
 * for no reason — which looks like a data change when it is not.
 *
 * @param {object[]} rows
 * @param {(row: object) => unknown} keyFn
 * @returns {[string, number][]}
 */
export function tally(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const raw = keyFn(row);
    const key = raw === undefined || raw === null || raw === '' ? EMPTY : String(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/**
 * Take the top N of a tally and shape them into bars.
 *
 * `pct` scales against the leader so the longest bar fills its track; `share`
 * is the proportion of everything, which is the number worth quoting in prose.
 *
 * @param {[string, number][]} entries output of tally()
 * @param {number} n
 * @param {number} total all attempts, for the share column
 */
export function topBars(entries, n, total) {
  if (!entries.length) return [];
  const max = entries[0][1];
  return entries.slice(0, n).map(([key, count], i) => ({
    key,
    rank: String(i + 1).padStart(2, '0'),
    count,
    label: formatCount(count),
    pct: pct(count, max),
    share: share(count, total),
  }));
}
