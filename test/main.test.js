import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { setupDom } from './helpers/dom.js';

setupDom();

const { el } = await import('../dashboard/src/render.js');
const { filterRows, filterNote, ingestText, loadSummary, boot, wireFileInput } = await import('../dashboard/src/main.js');

const FIXTURE = fs.readFileSync(fileURLToPath(new URL('./fixtures/sample.jsonl', import.meta.url)), 'utf8');

const LOG = [
  { time: 'Aug 14 02:59', ip: '165.154.177.0/24', user: 'root', pw: '123456', att: '1', banner: 'Go' },
  { time: 'Aug 14 02:58', ip: '43.163.107.0/24', user: 'admin', pw: 'hunter2', att: '2', banner: 'libssh_0.9.6' },
  { time: 'Aug 14 02:57', ip: '8.8.8.0/24', user: 'ubuntu', pw: 'PASSWORD', att: '1', banner: 'PuTTY' },
];

// ── filtering ──────────────────────────────────────────────────────────────

test('filterRows matches across every visible column', () => {
  assert.equal(filterRows(LOG, '165.154').length, 1);
  assert.equal(filterRows(LOG, 'admin').length, 1);
  assert.equal(filterRows(LOG, 'hunter2').length, 1);
  assert.equal(filterRows(LOG, 'putty').length, 1);
});

test('filterRows ignores case in both the query and the data', () => {
  assert.equal(filterRows(LOG, 'password')[0].user, 'ubuntu'); // matches 'PASSWORD'
  assert.equal(filterRows(LOG, 'ROOT')[0].user, 'root');
});

test('filterRows returns everything for a blank query', () => {
  assert.equal(filterRows(LOG, '').length, 3);
  assert.equal(filterRows(LOG, '   ').length, 3);
});

test('filterRows returns nothing when nothing matches', () => {
  assert.deepEqual(filterRows(LOG, 'zzzz'), []);
});

test('filterRows treats the query as text, not a pattern', () => {
  // Passwords are full of regex metacharacters. '.*' must find the literal
  // string, not match every row.
  assert.deepEqual(filterRows(LOG, '.*'), []);
  const withDots = [{ ...LOG[0], pw: 'a.*b' }];
  assert.equal(filterRows(withDots, '.*').length, 1);
});

test('filterNote describes an unfiltered view', () => {
  // Three numbers have to stay straight: what is drawn, the recent slice it is
  // drawn from, and the size of the whole capture.
  const note = filterNote({ matched: 5000, rendered: 200, pool: 5000, total: 121310, query: '' });
  assert.match(note, /200/);
  assert.match(note, /5,000 most recent/);
  assert.match(note, /121,310/);
});

test('filterNote reports what a search matched', () => {
  const note = filterNote({ matched: 42, rendered: 42, pool: 5000, total: 121310, query: 'root' });
  assert.match(note, /42 of 5,000 recent events match "root"/);
  assert.doesNotMatch(note, /shown/);
});

test('filterNote admits when it is only drawing part of the matches', () => {
  const note = filterNote({ matched: 312, rendered: 200, pool: 5000, total: 121310, query: 'root' });
  assert.match(note, /312 of 5,000 recent events match "root"/);
  assert.match(note, /first 200 shown/);
});

test('filterNote handles matching nothing', () => {
  assert.match(
    filterNote({ matched: 0, rendered: 0, pool: 5000, total: 121310, query: 'zzz' }),
    /0 of 5,000 recent events match "zzz"/,
  );
});

// ── ingesting a dropped file ───────────────────────────────────────────────

test('ingestText turns raw JSON-lines into a summary', () => {
  const summary = ingestText(FIXTURE);
  assert.equal(summary.meta.total, 7);
  assert.equal(summary.log.rows.length, 7);
});

test('ingestText keeps full addresses for a locally dropped log', () => {
  // The file never leaves the browser, and full addresses are more useful for
  // your own analysis. The published build is the one that must truncate.
  const summary = ingestText(FIXTURE);
  assert.equal(summary.meta.anonymised, false);
  assert.equal(summary.ipBars[0].key, '165.154.177.119');
});

test('ingestText reports an empty or unparseable file rather than throwing', () => {
  assert.equal(ingestText('').meta.total, 0);
  assert.equal(ingestText('nothing valid here\nnor here').meta.total, 0);
});

// ── loading the published data ─────────────────────────────────────────────

test('loadSummary fetches and parses the published summary', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ meta: { total: 42 } }) });
  const summary = await loadSummary({ fetchImpl });
  assert.equal(summary.meta.total, 42);
});

test('loadSummary reports a missing data file clearly', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => loadSummary({ fetchImpl }), /summary\.json/);
});

test('loadSummary reports a network failure clearly', async () => {
  const fetchImpl = async () => { throw new Error('offline'); };
  await assert.rejects(() => loadSummary({ fetchImpl }), /offline/);
});

test('loadSummary revalidates rather than trusting the browser cache', async () => {
  // After a redeploy the page is new but the data file may still be cached,
  // which pairs new code with an old summary and breaks panels.
  let opts = null;
  await loadSummary({ fetchImpl: async (_url, o) => { opts = o; return { ok: true, json: async () => ({}) }; } });
  assert.equal(opts.cache, 'no-cache');
});

test('boot explains a version skew instead of leaking a TypeError', async () => {
  // Rendering a stale summary used to put "Cannot read properties of undefined"
  // in front of the reader, which tells them nothing they can act on.
  const doc = harness();
  const broken = { meta: { total: 1 }, kpis: [] }; // nothing else the renderer needs

  await boot({ fetchImpl: async () => ({ ok: true, json: async () => broken }) });

  const status = doc.querySelector('#status').textContent;
  assert.equal(doc.querySelector('#status').hidden, false);
  assert.doesNotMatch(status, /Cannot read properties/);
  assert.match(status, /refresh/i);
});

// ── boot ───────────────────────────────────────────────────────────────────

function harness() {
  const dom = setupDom(`<!doctype html><html><body>
    <div id="status"></div>
    <div id="dashboard"></div>
    <div id="source"></div>
    <input id="file" type="file">
    <button id="reset" hidden></button>
  </body></html>`);
  return dom.window.document;
}

const fetchFixture = () => {
  const summary = ingestText(FIXTURE);
  return async () => ({ ok: true, json: async () => summary });
};

test('boot renders the dashboard and clears the loading status', async () => {
  const doc = harness();
  await boot({ fetchImpl: fetchFixture() });

  assert.ok(doc.querySelector('#dashboard .kpi'));
  assert.ok(doc.querySelector('#log-body tr'));
  assert.equal(doc.querySelector('#status').hidden, true);
});

test('boot shows an error instead of an empty page when data is missing', async () => {
  const doc = harness();
  await boot({ fetchImpl: async () => ({ ok: false, status: 404 }) });

  assert.equal(doc.querySelector('#status').hidden, false);
  assert.match(doc.querySelector('#status').textContent, /summary\.json/);
  assert.equal(doc.querySelector('#dashboard').children.length, 0);
});

test('boot names the data source and when it was built', async () => {
  const doc = harness();
  await boot({ fetchImpl: fetchFixture() });
  assert.match(doc.querySelector('#source').textContent, /7 events/);
});

test('typing in the search box filters the table', async () => {
  const doc = harness();
  await boot({ fetchImpl: fetchFixture() });

  const search = doc.querySelector('#log-search');
  search.value = 'admin';
  search.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));

  // The fixture has two admin attempts, e3 and e5.
  const rows = doc.querySelectorAll('#log-body tr');
  assert.equal(rows.length, 2);
  assert.match(doc.querySelector('#log-note').textContent, /2 of 7 events match "admin"/);
});

test('clearing the search box restores every row', async () => {
  const doc = harness();
  await boot({ fetchImpl: fetchFixture() });

  const search = doc.querySelector('#log-search');
  const fire = (v) => {
    search.value = v;
    search.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));
  };
  fire('admin');
  fire('');

  assert.equal(doc.querySelectorAll('#log-body tr').length, 7);
  assert.match(doc.querySelector('#log-note').textContent, /showing 7 of 7 events/);
});

test('a search matching nothing leaves a message, not a blank table', async () => {
  const doc = harness();
  await boot({ fetchImpl: fetchFixture() });

  const search = doc.querySelector('#log-search');
  search.value = 'nothing-matches-this';
  search.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));

  assert.match(doc.querySelector('#log-body').textContent, /no matching events/i);
});

test('loading a local file replaces the dashboard rather than stacking one', async () => {
  const doc = harness();
  const api = await boot({ fetchImpl: fetchFixture() });

  api.showSummary(ingestText(FIXTURE), 'dropped.jsonl');

  assert.equal(doc.querySelectorAll('.panel--kpis').length, 1);
  assert.match(doc.querySelector('#source').textContent, /dropped\.jsonl/);
  // A dropped file is analysed locally, so it shows real addresses.
  assert.ok(doc.querySelector('#dashboard').textContent.includes('165.154.177.119'));
});

test('the search still works after a local file is loaded', async () => {
  const doc = harness();
  const api = await boot({ fetchImpl: fetchFixture() });
  api.showSummary(ingestText(FIXTURE), 'dropped.jsonl');

  const search = doc.querySelector('#log-search');
  search.value = 'root';
  search.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));

  assert.equal(doc.querySelectorAll('#log-body tr').length, 4);
});

// ── returning to the published capture ─────────────────────────────────────

test('the reset control is hidden until a local file is loaded', async () => {
  const doc = harness();
  const api = await boot({ fetchImpl: fetchFixture() });

  assert.equal(doc.querySelector('#reset').hidden, true);
  api.showSummary(ingestText(FIXTURE), 'dropped.jsonl');
  assert.equal(doc.querySelector('#reset').hidden, false);
});

test('reset puts the published capture back', async () => {
  // Someone viewing this from a link must always have a way back to the real
  // report without knowing to refresh.
  const doc = harness();
  const api = await boot({ fetchImpl: fetchFixture() });

  api.showSummary(ingestText(FIXTURE), 'dropped.jsonl');
  assert.match(doc.querySelector('#source').textContent, /dropped\.jsonl/);

  doc.querySelector('#reset').dispatchEvent(new globalThis.window.Event('click', { bubbles: true }));

  assert.match(doc.querySelector('#source').textContent, /events_combined\.jsonl/);
  assert.equal(doc.querySelector('#reset').hidden, true);
  assert.equal(doc.querySelectorAll('.panel--kpis').length, 1);
});

test('reset does not refetch — the published summary is kept in memory', async () => {
  let fetches = 0;
  const doc = harness();
  const summary = ingestText(FIXTURE);
  const api = await boot({
    fetchImpl: async () => { fetches++; return { ok: true, json: async () => summary }; },
  });

  api.showSummary(ingestText(FIXTURE), 'dropped.jsonl');
  doc.querySelector('#reset').dispatchEvent(new globalThis.window.Event('click', { bubbles: true }));

  assert.equal(fetches, 1);
});

test('wireFileInput does not make the whole page a drop target', async () => {
  // A stray file dragged onto a portfolio page must not silently replace the
  // report. Loading a log is deliberate: it goes through the button.
  const doc = harness();
  const api = await boot({ fetchImpl: fetchFixture() });
  let called = false;
  wireFileInput({ ...api, showFile: () => { called = true; } });

  const drop = new globalThis.window.Event('drop', { bubbles: true, cancelable: true });
  doc.body.dispatchEvent(drop);

  assert.equal(called, false);
});

test('the log draws at most the cap, however many events match', async () => {
  const doc = harness();
  const many = Array.from({ length: 600 }, (_, i) => (
    `{"ts":"2026-01-01T10:00:${String(i % 60).padStart(2, '0')}Z","src_ip":"1.1.1.1","username":"root","password":"p","client_banner":"SSH-2.0-Go","session_id":"S${i}","attempt_no":1}`
  )).join('\n');
  const summary = ingestText(many);
  await boot({ fetchImpl: async () => ({ ok: true, json: async () => summary }) });

  assert.equal(doc.querySelectorAll('#log-body tr').length, 200);
  assert.match(doc.querySelector('#log-note').textContent, /200/);
});
