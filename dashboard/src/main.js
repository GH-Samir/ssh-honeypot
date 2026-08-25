// Page wiring: load the published summary, render it, and keep the search box
// and the drag-and-drop path working.

import { parseEvents } from './parse.js';
import { prepareRows, buildSummary } from './summary.js';
import { makeAnonymiser } from './anonymise.js';
import { formatCount } from './format.js';
import { renderDashboard, renderLogRows, LOG_CAP } from './render.js';

const DATA_URL = './data/summary.json';

/**
 * Filter log rows by a plain substring across every visible column.
 *
 * Deliberately not a regex: passwords are full of metacharacters, and typing
 * '.*' should find the literal string rather than matching everything.
 */
export function filterRows(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (
    r.ip.toLowerCase().includes(q)
    || r.user.toLowerCase().includes(q)
    || r.pw.toLowerCase().includes(q)
    || r.banner.toLowerCase().includes(q)
  ));
}

/**
 * Caption under the log.
 *
 * Three numbers have to stay straight and honest: how many rows are drawn
 * (`rendered`), the recent slice they are drawn from (`pool`), and the size of
 * the whole capture (`total`). Claiming to show more than it does would make
 * the log look like the full picture when the aggregate panels above are the
 * ones carrying the totals.
 */
export function filterNote({ matched, rendered, pool, total, query }) {
  const q = String(query || '').trim();
  const wholeCapture = pool >= total;

  if (!q) {
    return wholeCapture
      ? `Newest first — showing ${formatCount(rendered)} of ${formatCount(total)} events.`
      : `Newest first — showing ${formatCount(rendered)} of the ${formatCount(pool)} most recent events `
        + `(${formatCount(total)} in total).`;
  }

  const scope = wholeCapture ? 'events' : 'recent events';
  const head = `${formatCount(matched)} of ${formatCount(pool)} ${scope} match "${q}"`;
  return rendered < matched ? `${head} — first ${formatCount(rendered)} shown.` : `${head}.`;
}

/**
 * Build a summary from raw JSON-lines in the browser.
 *
 * No anonymisation and no geo: the file was opened locally and never leaves
 * the machine, so real addresses are both safe and more useful here. The
 * published build is the one bound by SPEC §3.
 */
export function ingestText(text) {
  const rows = prepareRows(parseEvents(text), { anonymise: makeAnonymiser(false), geo: null });
  return buildSummary(rows);
}

/**
 * Fetch the precomputed summary written by analysis/build.mjs.
 *
 * `no-cache` means revalidate, not skip the cache: without it a redeploy can
 * pair the new page with a summary the browser cached from the old one, and a
 * panel the new code expects simply is not there.
 */
export async function loadSummary({ fetchImpl = globalThis.fetch, url = DATA_URL } = {}) {
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Could not load data/summary.json (HTTP ${res.status}). Run \`npm run build\` to generate it.`);
  }
  return res.json();
}

/**
 * Start the page.
 *
 * Returns a small API so a dropped file — or a test — can swap in a different
 * summary without reloading.
 */
export async function boot({ fetchImpl = globalThis.fetch, url = DATA_URL } = {}) {
  const status = document.getElementById('status');
  const root = document.getElementById('dashboard');
  const source = document.getElementById('source');
  const reset = document.getElementById('reset');

  let current = null;
  let published = null; // kept so reset never needs a second fetch

  const setStatus = (message) => {
    status.textContent = message;
    status.hidden = !message;
  };

  function showSummary(summary, label) {
    current = summary;
    setStatus('');
    renderDashboard(root, summary);

    const built = summary.meta.generatedAt
      ? ` · built ${summary.meta.generatedAt.slice(0, 16).replace('T', ' ')} UTC`
      : '';
    source.textContent = `${label} · ${formatCount(summary.meta.total)} events${built}`;

    // Anyone arriving from a link must have a visible way back to the real
    // report, rather than having to know to refresh.
    if (reset) reset.hidden = summary === published;

    // The log table is rebuilt on every render, so the listener goes on the
    // fresh node each time rather than surviving across renders.
    const search = document.getElementById('log-search');
    const body = document.getElementById('log-body');
    const note = document.getElementById('log-note');

    const paint = (rows, query) => {
      renderLogRows(body, rows);
      note.textContent = filterNote({
        matched: rows.length,
        rendered: Math.min(rows.length, LOG_CAP),
        pool: summary.log.rows.length,
        total: summary.log.total,
        query,
      });
    };

    if (body && note) paint(summary.log.rows, '');
    if (search && body) {
      search.addEventListener('input', () => paint(filterRows(summary.log.rows, search.value), search.value));
    }
  }

  function showFile(file) {
    setStatus(`Reading ${file.name}…`);
    const reader = new FileReader();
    reader.onload = () => {
      const summary = ingestText(String(reader.result));
      if (!summary.meta.total) {
        setStatus(`No valid JSON lines found in ${file.name}.`);
        return;
      }
      showSummary(summary, file.name);
    };
    reader.onerror = () => setStatus(`Could not read ${file.name}.`);
    reader.readAsText(file);
  }

  function showPublished() {
    if (published) showSummary(published, 'events_combined.jsonl');
  }

  if (reset) reset.addEventListener('click', showPublished);

  setStatus('Loading capture…');
  try {
    published = await loadSummary({ fetchImpl, url });
  } catch (err) {
    root.replaceChildren();
    setStatus(err.message);
    return { showSummary, showFile, showPublished, get summary() { return current; } };
  }

  // Fetching and rendering fail for different reasons and deserve different
  // messages. A render fault here means the page and its data file disagree —
  // telling a reader "Cannot read properties of undefined" helps nobody.
  try {
    showPublished();
  } catch (err) {
    root.replaceChildren();
    setStatus('This page and its data file are out of step. A hard refresh (Ctrl+Shift+R, or Cmd+Shift+R) should fix it.');
    console.error('[dashboard] render failed:', err);
  }

  return { showSummary, showFile, showPublished, get summary() { return current; } };
}

/**
 * Wire the file picker.
 *
 * Deliberately *not* a page-wide drop target. This page is meant to be opened
 * from a link by people who are not looking to analyse anything, and a file
 * dragged onto the window by accident should not replace the report with a
 * stranger's data. Loading a log is an explicit act: it goes through the button.
 */
export function wireFileInput(api) {
  const input = document.getElementById('file');
  if (!input) return;

  input.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) api.showFile(file);
    // Reset the control so picking the same file twice fires again.
    e.target.value = '';
  });
}
