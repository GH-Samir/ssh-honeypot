// Connection-level structure: who connected, how hard they tried, and which
// credential pairs turn up often enough to look like a shared wordlist.

import { EMPTY } from './parse.js';
import { formatCount, share } from './format.js';

/**
 * Group attempts into the connections that carried them.
 *
 * `session_id` is written by the listener once per connection (listener.py sets
 * it in connection_made), so it groups a burst of guesses fired down one TCP
 * session. Where it is missing we fall back to address+timestamp, which keeps
 * distinct rows distinct rather than collapsing them into one giant session.
 *
 * @param {object[]} rows
 */
export function buildSessions(rows) {
  const byId = new Map();

  for (const row of rows) {
    const id = row.session_id || `${row.src_ip}|${row.ts}`;
    let s = byId.get(id);
    if (!s) {
      s = { id, ip: row.src_ip, count: 0, t0: Infinity, t1: -Infinity };
      byId.set(id, s);
    }
    s.count++;
    if (row.t < s.t0) s.t0 = row.t;
    if (row.t > s.t1) s.t1 = row.t;
  }

  const sessions = [...byId.values()];
  for (const s of sessions) s.durationMs = s.t1 - s.t0;

  const perIp = new Map();
  for (const s of sessions) perIp.set(s.ip, (perIp.get(s.ip) || 0) + 1);

  const multiCount = sessions.filter((s) => s.count > 1).length;
  const singleCount = sessions.length - multiCount;

  // Ties break on the earlier session so the headline number is reproducible.
  const biggest = sessions.reduce(
    (best, s) => (!best || s.count > best.count || (s.count === best.count && s.t0 < best.t0) ? s : best),
    null,
  );

  return {
    sessions,
    total: sessions.length,
    multiCount,
    singleCount,
    singleShare: share(singleCount, sessions.length),
    biggest,
    perIp,
  };
}

/**
 * One horizontal strip per source address, showing when its attempts landed.
 *
 * The mockup drew one node per attempt. Over the real capture that is 52,688
 * nodes for the top 14 addresses, which the browser feels. Binning into a fixed
 * number of columns and shading by density draws the same picture — solid
 * blocks for automated bursts, faint scattered cells for slow probing — with a
 * node budget that does not grow with the log.
 *
 * @param {object[]} rows
 * @param {{t0:number, span:number, limit:number, columns:number, perIp?:Map}} opts
 */
export function buildStrips(rows, { t0, span, limit, columns, perIp } = {}) {
  const sessionsPerIp = perIp || buildSessions(rows).perIp;

  const times = new Map();
  for (const row of rows) {
    let list = times.get(row.src_ip);
    if (!list) { list = []; times.set(row.src_ip, list); }
    list.push(row.t);
  }

  const ordered = [...times.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);

  const width = `${(100 / columns).toFixed(3)}%`;

  return ordered.map(([ip, list]) => {
    const counts = new Map();
    for (const t of list) {
      // A zero-width window means every attempt shares one instant; put them
      // all in the first column rather than dividing by zero.
      const col = span > 0
        ? Math.min(columns - 1, Math.max(0, Math.floor(((t - t0) / span) * columns)))
        : 0;
      counts.set(col, (counts.get(col) || 0) + 1);
    }

    const densest = Math.max(...counts.values());
    const cells = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([col, count]) => ({
        col,
        count,
        left: `${((col / columns) * 100).toFixed(3)}%`,
        width,
        // Floor at 0.35 so a single lone attempt is still visible against the
        // track; the rest of the range carries the density signal.
        opacity: Number((0.35 + 0.65 * (count / densest)).toFixed(2)),
      }));

    const sessions = sessionsPerIp.get(ip) || 0;
    return {
      ip,
      count: list.length,
      sessions,
      meta: `${formatCount(list.length)} · ${formatCount(sessions)} sess`,
      cells,
    };
  });
}

/**
 * Username+password combinations tried more than once.
 *
 * The key is JSON rather than a joined string: usernames and passwords are
 * attacker-controlled and may contain any byte, including whatever separator
 * we picked, so a printable delimiter could make 'a:b'+'c' collide with
 * 'a'+'b:c'. JSON quoting is unambiguous by construction.
 *
 * @param {object[]} rows
 * @param {number} limit
 */
export function buildPairs(rows, limit) {
  const counts = new Map();
  for (const row of rows) {
    const u = row.username === undefined || row.username === null || row.username === '' ? EMPTY : String(row.username);
    const p = row.password === undefined || row.password === null || row.password === '' ? EMPTY : String(row.password);
    const key = JSON.stringify([u, p]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [u, p] = JSON.parse(key);
      return { u, p, count, n: formatCount(count) };
    })
    .sort((a, b) => b.count - a.count || (a.u < b.u ? -1 : a.u > b.u ? 1 : a.p < b.p ? -1 : 1))
    .slice(0, limit);
}
