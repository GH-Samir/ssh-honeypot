// DOM construction.
//
// Usernames, passwords and SSH banners are attacker-supplied strings, and this
// page is public. The defence is structural rather than a sanitiser: there is
// no innerHTML in this module, and every value reaches the page as a text node.
// A payload like '<img src=x onerror=alert(1)>' in a username renders as those
// literal characters because that is the only thing textContent can do.

const NO_DATA = 'no data';

/**
 * Build an element.
 *
 * `text` sets textContent — the one place values enter the page. String
 * children go through append(), which also creates text nodes, so neither path
 * can introduce markup.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') Object.assign(node.style, value);
    else node.setAttribute(key, value);
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** A titled panel with an optional caption. */
function panel(title, note, body, extraClass = '') {
  return el('section', { class: `panel ${extraClass}`.trim() }, [
    el('div', { class: 'panel-head' }, [
      el('h2', { class: 'panel-title', text: title }),
      note ? el('p', { class: 'panel-note', text: note }) : null,
    ]),
    body,
  ]);
}

const empty = () => el('p', { class: 'empty', text: NO_DATA });

// ── panels ─────────────────────────────────────────────────────────────────

export function renderKpis(kpis) {
  return el('section', { class: 'panel panel--kpis' }, kpis.map((k) => el('div', { class: 'kpi' }, [
    el('div', { class: 'kpi-label', text: k.label }),
    el('div', { class: 'kpi-value', text: k.value }),
    // The quoted credential is a separate node so CSS can style attacker text
    // differently from ours — and so it is obvious which is which.
    el('div', { class: 'kpi-note' }, k.term
      ? [el('span', { class: 'term', text: k.term }), ` ${k.note}`]
      : [k.note]),
  ])));
}

/**
 * A list of horizontal bars.
 * `stacked` puts the key above a full-width track and labels it with the share
 * — the shape the banner panel needs, where keys are long.
 */
export function renderBars(bars, { rank = false, stacked = false } = {}) {
  // Tolerate a missing list, not just an empty one: a cached data file written
  // by an older build can lack a panel entirely, and one absent panel must not
  // take the whole page down.
  const list = Array.isArray(bars) ? bars : [];
  if (!list.length) return empty();

  return el('div', { class: `bars ${stacked ? 'bars--stacked' : ''}`.trim() },
    list.map((b) => {
      const track = el('span', { class: 'bar-track' }, [
        el('span', { class: 'bar-fill', style: { width: b.pct } }),
      ]);
      const key = el('span', { class: 'bar-key', text: b.key });
      const value = el('span', { class: 'bar-value', text: stacked ? b.share : b.label });

      return stacked
        ? el('div', { class: 'bar-row' }, [el('div', { class: 'bar-head' }, [key, value]), track])
        : el('div', { class: 'bar-row' }, [
          rank ? el('span', { class: 'bar-rank', text: b.rank }) : null,
          key, track, value,
        ]);
    }));
}

export function renderTimeline(timeline) {
  const chart = el('div', { class: 'tl' }, timeline.buckets.map((b) => el('div', {
    class: 'tl-slot', title: b.title,
  }, [el('div', { class: 'tl-bar', style: { height: b.pct } })])));

  return panel(
    'Attempt volume over the capture window',
    `Each bar is one ${timeline.bucketLabel} interval. Height is the number of login attempts recorded in that interval.`,
    el('div', {}, [
      el('div', { class: 'panel-aside', text: `PEAK ${timeline.peakLabel}` }),
      chart,
      el('div', { class: 'tl-axis' }, [
        el('span', { text: timeline.windowStart }),
        el('span', { text: timeline.windowMid }),
        el('span', { text: timeline.windowEnd }),
      ]),
    ]),
    'panel--timeline',
  );
}

export function renderDays(days) {
  const body = days.rows.length
    ? el('div', { class: 'daylist' }, days.rows.map((d) => el('div', {
      // Marked rather than left as a zero-width bar, which reads as a bug.
      class: `day-row ${d.quiet ? 'is-quiet' : ''}`.trim(),
    }, [
      el('span', { class: 'day-dow', text: d.dow }),
      el('span', { class: 'day-label', text: d.label }),
      el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: { width: d.pct } })]),
      el('span', { class: 'day-count', text: String(d.count) }),
    ])))
    : empty();

  return panel('Day by day', days.note, body, 'panel--days');
}

export function renderHours(hours) {
  // The weekday fold shares this panel: it balances the panel's height against
  // the 31-row day list beside it, and the two folds ask the same question at
  // two scales. Optional, so a summary from an older build still renders.
  const weekdays = Array.isArray(hours.weekdays) && hours.weekdays.length
    ? el('div', { class: 'weekdays' }, [
      el('h3', { class: 'sub', text: 'By weekday' }),
      renderBars(hours.weekdays),
      hours.weekdayNote ? el('p', { class: 'panel-foot', text: hours.weekdayNote }) : null,
    ])
    : null;

  return panel('Hour of day', hours.note, el('div', {}, [
    el('div', { class: 'hours' }, hours.rows.map((h) => el('div', {
      class: 'hour-slot', title: h.title,
    }, [el('div', { class: 'hour-bar', style: { height: h.pct } })]))),
    el('div', { class: 'hour-axis' }, hours.rows.map((h) => el('span', { class: 'hour-tick', text: h.tick }))),
    weekdays,
  ]), 'panel--hours');
}

export function renderStrips(strips) {
  const body = strips.rows.length
    ? el('div', { class: 'strips' }, strips.rows.map((s) => el('div', { class: 'strip' }, [
      el('span', { class: 'strip-ip', text: s.ip }),
      el('span', { class: 'strip-track' }, s.cells.map((c) => el('span', {
        class: 'strip-cell',
        title: `${c.count} attempt${c.count === 1 ? '' : 's'}`,
        style: { left: c.left, width: c.width, opacity: String(c.opacity) },
      }))),
      el('span', { class: 'strip-meta', text: s.meta }),
    ])))
    : empty();

  return panel(
    'Session bursts by source',
    'One row per source, ordered by total attempts. Each cell is a time slice; the denser the shading, the more attempts landed in it. Solid blocks are automated bursts, faint scattered cells are slow probing.',
    el('div', {}, [body, strips.note ? el('p', { class: 'panel-foot', text: strips.note }) : null]),
    'panel--strips',
  );
}

export function renderPairs(pairs) {
  if (!pairs.length) return empty();

  return el('table', { class: 'table table--pairs' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Username' }), el('th', { text: 'Password' }),
      el('th', { class: 'num', text: 'N' }),
    ])]),
    el('tbody', {}, pairs.map((p) => el('tr', {}, [
      el('td', { text: p.u }), el('td', { class: 'accent', text: p.p }),
      el('td', { class: 'num', text: p.n }),
    ]))),
  ]);
}

/** Rows drawn at once. See renderLogRows. */
export const LOG_CAP = 200;

/**
 * Fill the log table body. Separate from the panel because the search box
 * re-runs it on every keystroke — replacing rows, never appending.
 *
 * Capped because the published log holds 5,000 events: drawing them all costs
 * ~35,000 nodes and makes every keystroke crawl. The search still runs over the
 * whole set — only the drawing is limited, and the caption says so.
 */
export function renderLogRows(tbody, rows, { cap = LOG_CAP } = {}) {
  tbody.replaceChildren();

  if (!rows.length) {
    tbody.append(el('tr', {}, [el('td', { class: 'empty', colspan: '6', text: 'no matching events' })]));
    return;
  }

  for (const r of rows.slice(0, cap)) {
    tbody.append(el('tr', {}, [
      el('td', { class: 'dim', text: r.time }),
      el('td', { text: r.ip }),
      el('td', { text: r.user }),
      el('td', { class: 'accent', text: r.pw }),
      el('td', { class: 'num dim', text: r.att }),
      el('td', { class: 'dim', text: r.banner }),
    ]));
  }
}

function renderLogPanel(log) {
  const tbody = el('tbody', { id: 'log-body' });
  renderLogRows(tbody, log.rows);

  const table = el('table', { class: 'table table--log' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Time' }), el('th', { text: 'Source' }), el('th', { text: 'Username' }),
      el('th', { text: 'Password' }), el('th', { class: 'num', text: 'Att' }), el('th', { text: 'Client' }),
    ])]),
    tbody,
  ]);

  return el('section', { class: 'panel panel--log' }, [
    el('div', { class: 'panel-head panel-head--row' }, [
      el('div', {}, [
        el('h2', { class: 'panel-title', text: 'Event log' }),
        el('p', { class: 'panel-note', id: 'log-note', text: log.note }),
      ]),
      el('input', {
        id: 'log-search', type: 'search', class: 'search',
        placeholder: 'filter ip, user, password, banner',
        'aria-label': 'Filter events',
      }),
    ]),
    el('div', { class: 'table-scroll' }, [table]),
  ]);
}

// ── the whole page ─────────────────────────────────────────────────────────

/**
 * Render the dashboard into `root`, replacing whatever was there.
 * Dropping a second log must not stack two dashboards on top of each other.
 */
export function renderDashboard(root, summary) {
  // Defaults for anything a summary might not carry. The page and its data file
  // are deployed together but cached separately, so they can briefly disagree.
  const list = (v) => (Array.isArray(v) ? v : []);
  const days = { rows: [], spansDays: false, note: '', ...summary.days };
  const hours = { rows: [], note: '', ...summary.hours };
  const strips = { rows: [], note: '', ...summary.strips };
  const log = { rows: [], shown: 0, total: 0, note: '', ...summary.log };
  const geo = { available: false, countryBars: [], sourceBars: [], countryCount: 0, note: '', ...summary.geo };
  const meta = { total: 0, anonymised: true, ...summary.meta };

  const geoPanel = panel(
    'Origin by country',
    geo.note,
    geo.available
      ? el('div', { class: 'split' }, [
        el('div', {}, [
          el('h3', { class: 'sub', text: 'By attempts' }),
          renderBars(geo.countryBars, { rank: true }),
        ]),
        el('div', {}, [
          el('h3', { class: 'sub', text: `By unique ${meta.anonymised ? 'sources' : 'addresses'}` }),
          renderBars(geo.sourceBars, { rank: true }),
        ]),
      ])
      : empty(),
    `panel--geo ${geo.available ? '' : 'is-unavailable'}`.trim(),
  );

  root.replaceChildren(
    renderKpis(list(summary.kpis)),
    renderTimeline({ buckets: [], bucketLabel: '', peakLabel: '', windowStart: '', windowMid: '', windowEnd: '', ...summary.timeline }),
    // A single-day capture has nothing to say day-by-day, and folding one day
    // onto a 24-hour clock just redraws the timeline.
    ...(days.spansDays
      ? [el('div', { class: 'grid grid--2' }, [renderDays(days), renderHours(hours)])]
      : []),
    renderStrips(strips),
    el('div', { class: 'grid grid--2' }, [
      panel('Most active sources', `Attempts per source ${meta.anonymised ? '/24 block' : 'address'}. Bar length is relative to the busiest.`, renderBars(summary.ipBars, { rank: true }), 'panel--ips'),
      panel('Client software', 'Self-reported SSH banners. Library banners indicate scripted scanners rather than interactive clients.', renderBars(summary.bannerBars, { stacked: true }), 'panel--banners'),
    ]),
    el('div', { class: 'grid grid--2' }, [
      panel('Usernames tried', summary.userNote, renderBars(summary.userBars), 'panel--users'),
      panel('Passwords tried', summary.pwNote, renderBars(summary.pwBars), 'panel--pws'),
    ]),
    el('div', { class: 'grid grid--2' }, [
      panel('Repeated credential pairs', 'Combinations seen more than once — the overlap where separate scanners share a wordlist.', renderPairs(list(summary.pairs)), 'panel--pairs'),
      geoPanel,
    ]),
    renderLogPanel(log),
  );
}
