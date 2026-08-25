import test from 'node:test';
import assert from 'node:assert/strict';

import { setupDom } from './helpers/dom.js';

setupDom(); // must run before render.js reads the global document

const { el, renderKpis, renderBars, renderTimeline, renderDays, renderHours,
        renderStrips, renderPairs, renderLogRows, renderDashboard } = await import('../dashboard/src/render.js');

const XSS = '<img src=x onerror=alert(1)>';

/**
 * The CSSOM normalises '42.00%' to '42%', in jsdom and in real browsers alike.
 * Compare the number, not the spelling.
 */
const cssPct = (node, prop) => parseFloat(node.style[prop]);

// ── el ─────────────────────────────────────────────────────────────────────

test('el builds an element with class, text and children', () => {
  const node = el('div', { class: 'panel' }, [el('h2', { text: 'Title' })]);
  assert.equal(node.tagName, 'DIV');
  assert.equal(node.className, 'panel');
  assert.equal(node.querySelector('h2').textContent, 'Title');
});

test('el writes text as text, never as markup', () => {
  // Usernames, passwords and banners are attacker-supplied and this page is
  // public. Safety here is structural: there is no innerHTML in the module.
  const node = el('span', { text: XSS });
  assert.equal(node.textContent, XSS);
  assert.equal(node.children.length, 0);
  assert.equal(node.querySelector('img'), null);
});

test('el treats a string child as text too', () => {
  const node = el('div', {}, [XSS]);
  assert.equal(node.textContent, XSS);
  assert.equal(node.children.length, 0);
});

test('el skips null and false children so callers can inline conditionals', () => {
  const node = el('div', {}, [el('b', { text: 'a' }), null, false, undefined]);
  assert.equal(node.children.length, 1);
});

test('el applies styles as properties, not as a string', () => {
  const node = el('span', { style: { width: '42.00%' } });
  assert.equal(cssPct(node, 'width'), 42);
});

// ── KPIs ───────────────────────────────────────────────────────────────────

const KPIS = [
  { label: 'Attempts', value: '121,310', note: 'authentication events logged', term: null },
  { label: 'Usernames', value: '5,162', note: 'leads at 57.1%', term: 'root' },
];

test('renderKpis makes one tile per number', () => {
  const node = renderKpis(KPIS);
  const tiles = node.querySelectorAll('.kpi');
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].querySelector('.kpi-label').textContent, 'Attempts');
  assert.equal(tiles[0].querySelector('.kpi-value').textContent, '121,310');
  assert.equal(tiles[0].querySelector('.kpi-note').textContent, 'authentication events logged');
});

test('renderKpis marks a quoted credential so it can be styled apart', () => {
  const node = renderKpis(KPIS);
  const term = node.querySelectorAll('.kpi')[1].querySelector('.term');
  assert.equal(term.textContent, 'root');
  assert.match(node.querySelectorAll('.kpi')[1].querySelector('.kpi-note').textContent, /leads at 57\.1%/);
});

test('renderKpis renders a hostile credential inert', () => {
  const node = renderKpis([{ label: 'Usernames', value: '1', note: 'leads', term: XSS }]);
  assert.equal(node.querySelector('.term').textContent, XSS);
  assert.equal(node.querySelector('img'), null);
});

// ── bars ───────────────────────────────────────────────────────────────────

const BARS = [
  { key: 'root', rank: '01', count: 69318, label: '69,318', pct: '100.00%', share: '57.1%' },
  { key: 'admin', rank: '02', count: 5740, label: '5,740', pct: '8.28%', share: '4.7%' },
];

test('renderBars scales each fill to its percentage', () => {
  const node = renderBars(BARS);
  const rows = node.querySelectorAll('.bar-row');
  assert.equal(rows.length, 2);
  assert.equal(cssPct(rows[0].querySelector('.bar-fill'), 'width'), 100);
  assert.equal(cssPct(rows[1].querySelector('.bar-fill'), 'width'), 8.28);
  assert.equal(rows[0].querySelector('.bar-key').textContent, 'root');
  assert.equal(rows[0].querySelector('.bar-value').textContent, '69,318');
});

test('renderBars shows rank only when asked', () => {
  assert.equal(renderBars(BARS, { rank: true }).querySelector('.bar-rank').textContent, '01');
  assert.equal(renderBars(BARS).querySelector('.bar-rank'), null);
});

test('renderBars can label with share instead of count', () => {
  const node = renderBars(BARS, { stacked: true });
  assert.equal(node.querySelector('.bar-value').textContent, '57.1%');
});

test('renderBars renders a hostile key inert', () => {
  const node = renderBars([{ ...BARS[0], key: XSS }]);
  assert.equal(node.querySelector('.bar-key').textContent, XSS);
  assert.equal(node.querySelector('img'), null);
});

test('renderBars on an empty list says so rather than drawing nothing', () => {
  const node = renderBars([]);
  assert.match(node.textContent, /no data/i);
});

// ── time panels ────────────────────────────────────────────────────────────

test('renderTimeline draws a bar per bucket with a hover title', () => {
  const timeline = {
    buckets: [
      { count: 3, pct: '100.00%', title: 'Jan 1 10:00 UTC — 3 attempts' },
      { count: 0, pct: '0.00%', title: 'Jan 1 11:00 UTC — 0 attempts' },
    ],
    bucketLabel: 'hour', peakLabel: '3 / hour',
    windowStart: 'Jan 1 10:00 UTC', windowMid: 'Jan 2 14:00', windowEnd: 'Jan 3 18:00',
  };
  const node = renderTimeline(timeline);
  const bars = node.querySelectorAll('.tl-bar');
  assert.equal(bars.length, 2);
  assert.equal(cssPct(bars[0], 'height'), 100);
  // The tooltip lives on the full-height column, not the bar: a bucket with one
  // attempt is a 1px sliver nobody can hover.
  assert.equal(node.querySelectorAll('.tl-slot')[0].getAttribute('title'),
    'Jan 1 10:00 UTC — 3 attempts');
  assert.match(node.textContent, /Jan 1 10:00 UTC/);
});

test('renderDays lists every day including the quiet ones', () => {
  const days = {
    rows: [
      { key: '2026-01-01', label: 'Jan 1', dow: 'Thu', count: 4, pct: '100.00%', quiet: false },
      { key: '2026-01-02', label: 'Jan 2', dow: 'Fri', count: 0, pct: '0.00%', quiet: true },
    ],
    spansDays: true, note: 'Busiest day: Jan 1',
  };
  const node = renderDays(days);
  const rows = node.querySelectorAll('.day-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.day-count').textContent, '4');
  // A day with no traffic is marked, so the CSS can grey it rather than just
  // drawing a zero-width bar that looks like a rendering bug.
  assert.ok(rows[1].classList.contains('is-quiet'));
});

test('renderHours draws 24 columns and labels every third', () => {
  const hours = {
    rows: Array.from({ length: 24 }, (_, h) => ({
      hour: String(h).padStart(2, '0'),
      tick: h % 3 === 0 ? String(h).padStart(2, '0') : '',
      count: h, pct: `${h * 4}.00%`, title: `${h}:00 — ${h}`,
    })),
    note: 'Peak hour is 10:00 UTC.',
  };
  const node = renderHours(hours);
  assert.equal(node.querySelectorAll('.hour-bar').length, 24);
  assert.equal(node.querySelectorAll('.hour-tick').length, 24);
  assert.equal(node.querySelectorAll('.hour-tick')[3].textContent, '03');
  assert.equal(node.querySelectorAll('.hour-tick')[4].textContent, '');
});

test('renderStrips positions each binned cell', () => {
  const strips = {
    rows: [{
      ip: '165.154.177.0/24', count: 5587, sessions: 5587, meta: '5,587 · 5,587 sess',
      cells: [
        { col: 0, count: 3, left: '0.000%', width: '0.278%', opacity: 1 },
        { col: 180, count: 1, left: '50.000%', width: '0.278%', opacity: 0.57 },
      ],
    }],
    note: 'Longest single burst: 1,417 guesses',
  };
  const node = renderStrips(strips);
  const cells = node.querySelectorAll('.strip-cell');
  assert.equal(cells.length, 2);
  assert.equal(cssPct(cells[0], 'left'), 0);
  assert.equal(cssPct(cells[0], 'width'), 0.278);
  assert.equal(cells[1].style.opacity, '0.57');
  assert.equal(node.querySelector('.strip-ip').textContent, '165.154.177.0/24');
});

// ── tables ─────────────────────────────────────────────────────────────────

test('renderPairs builds a table of repeated credentials', () => {
  const node = renderPairs([{ u: 'root', p: '123456', count: 168, n: '168' }]);
  const cells = node.querySelectorAll('tbody tr td');
  assert.equal(cells[0].textContent, 'root');
  assert.equal(cells[1].textContent, '123456');
  assert.equal(cells[2].textContent, '168');
});

test('renderPairs renders hostile credentials inert', () => {
  const node = renderPairs([{ u: XSS, p: XSS, count: 2, n: '2' }]);
  assert.equal(node.querySelector('tbody td').textContent, XSS);
  assert.equal(node.querySelector('img'), null);
});

test('renderLogRows fills the table body, newest first', () => {
  const rows = [
    { time: 'Aug 14 02:59', ip: '1.2.3.0/24', user: 'root', pw: '123456', att: '1', banner: 'Go' },
    { time: 'Aug 14 02:58', ip: '4.5.6.0/24', user: 'admin', pw: 'x', att: '2', banner: 'libssh_0.9.6' },
  ];
  const tbody = el('tbody');
  renderLogRows(tbody, rows);
  assert.equal(tbody.querySelectorAll('tr').length, 2);
  assert.equal(tbody.querySelector('tr td').textContent, 'Aug 14 02:59');
});

test('renderLogRows replaces previous rows rather than appending', () => {
  // The search box re-renders on every keystroke; appending would grow the
  // table without bound.
  const tbody = el('tbody');
  const row = { time: 't', ip: 'i', user: 'u', pw: 'p', att: '1', banner: 'b' };
  renderLogRows(tbody, [row, row, row]);
  renderLogRows(tbody, [row]);
  assert.equal(tbody.querySelectorAll('tr').length, 1);
});

test('renderLogRows renders a hostile password inert', () => {
  const tbody = el('tbody');
  renderLogRows(tbody, [{ time: 't', ip: 'i', user: 'u', pw: XSS, att: '1', banner: 'b' }]);
  assert.equal(tbody.querySelectorAll('td')[3].textContent, XSS);
  assert.equal(tbody.querySelector('img'), null);
});

test('renderLogRows says so when a filter matches nothing', () => {
  const tbody = el('tbody');
  renderLogRows(tbody, []);
  assert.match(tbody.textContent, /no matching events/i);
});

// ── whole dashboard ────────────────────────────────────────────────────────

const SUMMARY = {
  meta: { total: 6, blockCount: 3, anonymised: true, generatedAt: '2026-08-25T16:19:12.379Z' },
  kpis: KPIS,
  timeline: { buckets: [{ count: 1, pct: '100.00%', title: 't' }], bucketLabel: 'hour', peakLabel: '1 / hour', windowStart: 'a', windowMid: 'b', windowEnd: 'c' },
  days: { rows: [{ key: 'k', label: 'Jan 1', dow: 'Thu', count: 1, pct: '100.00%', quiet: false }], spansDays: true, note: 'n' },
  hours: { rows: [{ hour: '00', tick: '00', count: 1, pct: '100.00%', title: 't' }], note: 'n' },
  strips: { rows: [{ ip: 'i', count: 1, sessions: 1, meta: 'm', cells: [{ col: 0, count: 1, left: '0.000%', width: '1%', opacity: 1 }] }], note: 'n' },
  ipBars: BARS, bannerBars: BARS, userBars: BARS, pwBars: BARS,
  userNote: 'u', pwNote: 'p',
  pairs: [{ u: 'root', p: '123456', count: 2, n: '2' }],
  geo: { available: true, countryBars: BARS, networkBars: BARS, countryCount: 3, note: 'g' },
  log: { rows: [{ time: 't', ip: 'i', user: 'u', pw: 'p', att: '1', banner: 'b' }], shown: 1, total: 6, note: 'l' },
};

test('renderDashboard mounts every panel into the root', () => {
  const root = el('div');
  renderDashboard(root, SUMMARY);
  assert.ok(root.querySelector('.kpi'));
  assert.ok(root.querySelector('.tl-bar'));
  assert.ok(root.querySelector('.day-row'));
  assert.ok(root.querySelector('.hour-bar'));
  assert.ok(root.querySelector('.strip-cell'));
  assert.ok(root.querySelector('.bar-row'));
  assert.ok(root.querySelector('#log-body tr'));
  assert.ok(root.querySelector('#log-search'));
});

test('renderDashboard replaces the previous render', () => {
  // Dropping a second file must not stack two dashboards.
  const root = el('div');
  renderDashboard(root, SUMMARY);
  renderDashboard(root, SUMMARY);
  assert.equal(root.querySelectorAll('.panel--kpis').length, 1);
});

test('renderDashboard hides the day/hour panels for a single-day capture', () => {
  const root = el('div');
  renderDashboard(root, { ...SUMMARY, days: { ...SUMMARY.days, spansDays: false } });
  assert.equal(root.querySelector('.day-row'), null);
});

test('renderDashboard shows the geo panel as unavailable without geo data', () => {
  const root = el('div');
  renderDashboard(root, { ...SUMMARY, geo: { available: false, countryBars: [], networkBars: [], countryCount: 0, note: 'Not available.' } });
  const geo = root.querySelector('.panel--geo');
  assert.ok(geo.classList.contains('is-unavailable'));
  assert.match(geo.textContent, /Not available/);
});

test('renderDashboard renders an empty capture without throwing', () => {
  const root = el('div');
  const empty = {
    ...SUMMARY,
    meta: { total: 0, blockCount: 0, anonymised: true, generatedAt: null },
    ipBars: [], bannerBars: [], userBars: [], pwBars: [], pairs: [],
    days: { rows: [], spansDays: false, note: '' },
    strips: { rows: [], note: '' },
    geo: { available: false, countryBars: [], networkBars: [], countryCount: 0, note: '' },
    log: { rows: [], shown: 0, total: 0, note: '' },
  };
  assert.doesNotThrow(() => renderDashboard(root, empty));
  assert.match(root.textContent, /no data/i);
});
