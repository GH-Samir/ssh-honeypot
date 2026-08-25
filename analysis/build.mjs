// Build step: raw capture → dashboard/data/summary.json.
//
// Reads the log, joins the cached geo enrichment, applies the address policy
// and writes the single file the page fetches. Offline — run `npm run geo`
// first if the cache is cold.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEvents } from '../dashboard/src/parse.js';
import { prepareRows, buildSummary } from '../dashboard/src/summary.js';
import { makeAnonymiser } from '../dashboard/src/anonymise.js';
import { readCache, CACHE_FILE, UNKNOWN } from './geo.mjs';

export const OUTPUT_NAME = 'summary.json';
export const FULL_OUTPUT_NAME = 'summary.full.json'; // gitignored
export const DATA_DIR = fileURLToPath(new URL('../dashboard/data/', import.meta.url));

/**
 * Build the view-model from raw JSON-lines text.
 *
 * @param {string} text
 * @param {{geo?: Map|null, fullIp?: boolean, options?: object}} opts
 */
export function buildFromText(text, { geo = null, fullIp = false, options = {} } = {}) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim()).length;
  const raw = parseEvents(text);
  const rows = prepareRows(raw, { anonymise: makeAnonymiser(!fullIp), geo });
  const summary = buildSummary(rows, options);

  summary.meta.generatedAt = new Date().toISOString();
  summary.meta.sourceLines = lines;

  return {
    summary,
    stats: { lines, parsed: raw.length, skipped: lines - raw.length },
  };
}

// ── privacy guard ──────────────────────────────────────────────────────────

/**
 * Subtrees and fields holding attacker-supplied text.
 *
 * These are excluded from the scan because they are *not* our data to leak —
 * and because scanning them produces false positives. The real capture contains
 * the password '0.0.0.0.', and a username or SSH banner can be set to anything
 * the client likes, including something address-shaped.
 *
 * Everything else is scanned. That direction matters: a field added later is
 * checked by default, so it cannot smuggle an address out unnoticed.
 */
const CREDENTIAL_SUBTREES = new Set(['userBars', 'pwBars', 'pairs', 'bannerBars']);
const CREDENTIAL_FIELDS = new Set(['user', 'pw', 'banner', 'u', 'p', 'term']);

const DOTTED_QUAD = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g;

/**
 * Find full source addresses anywhere in a summary.
 *
 * A match immediately followed by '/' is an already-truncated block label and
 * is fine; anything else is a leak.
 *
 * @returns {{path:string, value:string}[]}
 */
export function findFullIps(summary) {
  const found = [];

  const walk = (node, trail) => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(DOTTED_QUAD)) {
        const after = node[match.index + match[0].length];
        if (after === '/') continue; // '165.154.177.0/24' — already a block
        found.push({ path: trail, value: node });
        return;
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${trail}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (CREDENTIAL_SUBTREES.has(key) || CREDENTIAL_FIELDS.has(key)) continue;
        walk(value, trail ? `${trail}.${key}` : key);
      }
    }
  };

  walk(summary, '');
  return found;
}

/**
 * Write the summary, refusing to publish one that carries full addresses.
 *
 * SPEC §3 makes this a hard rule, so it is enforced at the point of writing
 * rather than trusted to the caller passing the right flag.
 */
export function writeSummary(dir, summary, { allowFullIps = false } = {}) {
  const leaks = findFullIps(summary);
  if (leaks.length && !allowFullIps) {
    const sample = leaks.slice(0, 3).map((l) => `  ${l.path}: ${l.value}`).join('\n');
    throw new Error(
      `Refusing to write: summary contains ${leaks.length} full source address(es).\n${sample}\n`
      + 'SPEC §3 requires published data to be anonymised.',
    );
  }

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, allowFullIps && leaks.length ? FULL_OUTPUT_NAME : OUTPUT_NAME);
  fs.writeFileSync(file, JSON.stringify(summary));
  return file;
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const fullIp = args.includes('--full-ip');
  const log = args.find((a) => !a.startsWith('--')) || 'events_combined.jsonl';

  if (!fs.existsSync(log)) {
    console.error(`No such log: ${log}`);
    process.exit(1);
  }

  const geo = readCache(CACHE_FILE);
  if (!geo.size) {
    console.warn('No geo cache — run `npm run geo` first for country and network panels.');
  }

  const { summary, stats } = buildFromText(fs.readFileSync(log, 'utf8'), { geo, fullIp });
  const file = writeSummary(DATA_DIR, summary, { allowFullIps: fullIp });

  const bytes = fs.statSync(file).size;
  console.log(`${stats.parsed} events from ${path.basename(log)}${stats.skipped ? ` (${stats.skipped} lines skipped)` : ''}`);
  console.log(`  ${summary.meta.blockCount} source ${summary.meta.anonymised ? 'blocks' : 'addresses'}, `
    + `${summary.meta.userCount} usernames, ${summary.meta.pwCount} passwords, `
    + `${summary.geo.available ? summary.geo.countryCount : 0} countries`);
  if (geo.size) {
    const unknown = summary.geo.countryBars.find((b) => b.key === UNKNOWN);
    if (unknown) console.log(`  ${unknown.label} attempts from unresolved addresses`);
  }
  console.log(`Wrote ${path.relative(process.cwd(), file)} — ${(bytes / 1024).toFixed(0)}KB`);
  if (fullIp) console.log('Full-IP build: local analysis only, this file is gitignored.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
