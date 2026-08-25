// The view-model: everything the page renders, assembled in one place.
//
// This is the mockup's compute() rebuilt on the tested modules. It is pure —
// same rows in, same object out — which is what lets the build script and the
// browser's drag-and-drop path share it and agree.

import { EMPTY, tally, topBars } from './parse.js';
import { buildTimeline, buildDays, buildHours } from './timeline.js';
import { buildSessions, buildStrips, buildPairs } from './sessions.js';
import { durationLabel, formatCount, share, stamp } from './format.js';

const DEFAULTS = {
  topN: 12,
  stripLimit: 14,
  stripColumns: 360, // 2-hour cells across a 30-day capture
  pairLimit: 12,
  logLimit: 5000,
};

const blank = (v) => (v === undefined || v === null || v === '' ? EMPTY : String(v));

/** Every banner starts 'SSH-2.0-'; repeating it in 21 rows costs width and says nothing. */
const shortBanner = (b) => blank(String(b ?? '').replace(/^SSH-2\.0-/, ''));

/**
 * Attach enrichment and apply the address policy, in that order.
 *
 * Order matters: geo has to be looked up on the real address, because
 * 165.154.177.0 is a different host from 165.154.177.119 and would resolve
 * differently. Truncation happens on the way out.
 *
 * The returned rows carry no `src_ip` in its original sense — the field holds
 * the *published label* from here on. `event_id` and `src_port` are dropped
 * entirely; nothing downstream needs them, and what is not carried cannot leak.
 *
 * @param {object[]} rows from parseEvents
 * @param {{anonymise: (ip:unknown)=>string, geo: Map|null}} opts
 */
export function prepareRows(rows, { anonymise, geo } = {}) {
  return rows.map((row) => {
    const g = geo ? geo.get(row.src_ip) : null;
    return {
      ts: row.ts,
      t: row.t,
      src_ip: anonymise(row.src_ip),
      username: row.username,
      password: row.password,
      client_banner: row.client_banner,
      session_id: row.session_id,
      attempt_no: row.attempt_no,
      country: g ? g.country : null,
      asOrg: g ? g.asOrg : null,
    };
  });
}

/**
 * A gap in the data is a finding — the honeypot was down, or nobody knocked —
 * so the caption names it either way rather than printing "0 day(s)".
 */
function quietNote(n) {
  if (n === 0) return 'Every day in the window saw traffic.';
  if (n === 1) return '1 day saw no traffic at all.';
  return `${formatCount(n)} days saw no traffic at all.`;
}

/** Min/max by loop: Math.min(...times) overflows the stack at 121k arguments. */
function bounds(times) {
  if (!times.length) return { t0: 0, t1: 0 };
  let t0 = times[0], t1 = times[0];
  for (const t of times) {
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  return { t0, t1 };
}

/**
 * Assemble the whole view-model.
 *
 * @param {object[]} rows output of prepareRows
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function buildSummary(rows, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const total = rows.length;

  const times = rows.map((r) => r.t);
  const { t0, t1 } = bounds(times);
  const span = t1 - t0;

  const ips = tally(rows, (r) => r.src_ip);
  const users = tally(rows, (r) => r.username);
  const pws = tally(rows, (r) => r.password);
  const banners = tally(rows, (r) => shortBanner(r.client_banner));

  const timeline = buildTimeline(times, t0, span);
  const days = buildDays(times);
  const hours = buildHours(times);
  const sess = buildSessions(rows);
  const strips = buildStrips(rows, {
    t0, span, limit: opts.stripLimit, columns: opts.stripColumns, perIp: sess.perIp,
  });
  const pairs = buildPairs(rows, opts.pairLimit);

  // Geo is optional: a log dropped onto the page has never been enriched.
  const hasGeo = rows.some((r) => r.country);
  const countries = hasGeo ? tally(rows, (r) => r.country) : [];
  const networks = hasGeo ? tally(rows, (r) => r.asOrg) : [];

  // In the full-IP local build the addresses are not blocks, so say so.
  const anonymised = ips.length > 0 && String(ips[0][0]).includes('/');

  const topUserShare = share(
    users.slice(0, opts.topN).reduce((a, [, n]) => a + n, 0), total,
  );
  const seenOnce = pws.filter(([, n]) => n === 1).length;

  // A KPI note may need to quote a username or password. That text is
  // attacker-controlled, so it lives in its own `term` field rather than being
  // baked into the prose: the renderer can style it, and the build's privacy
  // guard can tell our words apart from theirs.
  const kpi = (label, value, note, term = null) => ({ label, value, note, term });

  const kpis = [
    kpi('Attempts', formatCount(total), 'authentication events logged'),
    kpi(
      anonymised ? 'Source blocks' : 'Source IPs',
      formatCount(ips.length),
      anonymised ? 'distinct /24 networks' : 'distinct addresses',
    ),
    kpi('Sessions', formatCount(sess.total), `${formatCount(sess.multiCount)} with repeat guesses`),
    kpi(
      'Usernames',
      formatCount(users.length),
      users.length ? `leads at ${share(users[0][1], total)}` : '—',
      users.length ? users[0][0] : null,
    ),
    kpi(
      'Passwords',
      formatCount(pws.length),
      pws.length ? `tried ${formatCount(pws[0][1])}×` : '—',
      pws.length ? pws[0][0] : null,
    ),
  ];
  if (hasGeo) {
    kpis.push(kpi('Countries', formatCount(countries.length), 'distinct origins'));
  }
  kpis.push(kpi(
    'Window',
    total ? durationLabel(span) : '—',
    total ? `from ${stamp(t0, timeline.multiDay)} UTC` : 'no events',
  ));

  // Newest first: the aggregate panels carry the totals, so the log is for
  // seeing what is happening now. The mockup showed the oldest 150, which on a
  // month-long capture is the least interesting end.
  const logSlice = rows.slice(Math.max(0, total - opts.logLimit)).reverse();

  return {
    meta: {
      total,
      blockCount: ips.length,
      userCount: users.length,
      pwCount: pws.length,
      sessionCount: sess.total,
      bannerCount: banners.length,
      spanMs: span,
      startedAt: total ? new Date(t0).toISOString() : null,
      endedAt: total ? new Date(t1).toISOString() : null,
      anonymised,
    },

    kpis,

    timeline: {
      buckets: timeline.buckets,
      bucketLabel: timeline.bucket.label,
      peakLabel: `${formatCount(timeline.peak)} / ${timeline.bucket.label}`,
      windowStart: total ? `${stamp(t0, timeline.multiDay)} UTC` : '',
      windowMid: total ? stamp(t0 + span / 2, timeline.multiDay) : '',
      windowEnd: total ? stamp(t1, timeline.multiDay) : '',
    },

    days: {
      rows: days.days,
      spansDays: days.spansDays,
      note: days.busiest
        ? `Busiest day: ${days.busiest.label} at ${formatCount(days.busiest.count)} attempts. `
          + quietNote(days.quietCount)
        : '',
    },

    hours: {
      rows: hours.hours,
      note: total
        ? 'Attempts folded onto a 24-hour clock, all days combined. '
          + `Peak hour is ${String(hours.busiestHour).padStart(2, '0')}:00 UTC.`
        : '',
    },

    strips: {
      rows: strips,
      note: sess.biggest
        ? `Longest single burst: ${formatCount(sess.biggest.count)} guesses from ${sess.biggest.ip} `
          + `in ${Math.max(1, Math.round(sess.biggest.durationMs / 1000))}s. `
          + `${sess.singleShare} of sessions made exactly one attempt before dropping.`
        : '',
    },

    ipBars: topBars(ips, opts.topN, total),
    bannerBars: topBars(banners, 8, total),
    userBars: topBars(users, opts.topN, total),
    pwBars: topBars(pws, opts.topN, total),

    userNote: `${formatCount(users.length)} distinct usernames. The top `
      + `${Math.min(opts.topN, users.length)} account for ${topUserShare} of all attempts.`,
    pwNote: `${formatCount(pws.length)} distinct passwords, `
      + `${share(seenOnce, pws.length)} of them seen only once.`,

    pairs,

    geo: {
      available: hasGeo,
      countryBars: topBars(countries, opts.topN, total),
      networkBars: topBars(networks, opts.topN, total),
      countryCount: countries.length,
      note: hasGeo
        ? `${formatCount(countries.length)} countries across ${formatCount(ips.length)} source networks, `
          + 'resolved at build time. Ranked by attempts, not by number of hosts.'
        : 'Not available. The log records source addresses only; country attribution '
          + 'needs a GeoIP lookup run against the distinct addresses.',
    },

    log: {
      rows: logSlice.map((r) => ({
        time: stamp(r.t, timeline.multiDay),
        ip: r.src_ip,
        user: blank(r.username),
        pw: blank(r.password),
        att: r.attempt_no == null ? '—' : String(r.attempt_no),
        banner: shortBanner(r.client_banner),
      })),
      shown: logSlice.length,
      total,
      note: `Raw events, newest first — the most recent ${formatCount(logSlice.length)} `
        + `of ${formatCount(total)}.`,
    },
  };
}
