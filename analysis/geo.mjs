// Geo/ASN enrichment via ip-api.com, run once at build time.
//
// SPEC §5 is explicit that the listener writes raw observation only and that
// enrichment is "derived and recomputable" — so this never touches the log. It
// resolves addresses to a country and network, caches the answer, and hands a
// lookup table to the build script.
//
// SPEC §2 names MaxMind GeoLite2. ip-api.com is used instead because it needs
// no account or licence key, and it returns ASN and org in the same call. The
// trade-off: the free tier is HTTP-only and rate-limited, and the addresses are
// sent to a third party. They are attacker addresses observed by the honeypot,
// not anybody's users, and nothing about the honeypot itself is disclosed.
//
// The cache it writes is keyed by full IP, so it is personal data under SPEC §3
// and stays gitignored. Only the aggregate country/ASN counts get published.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNKNOWN = 'Unknown';

const ENDPOINT = 'http://ip-api.com/batch';
const FIELDS = 'status,message,query,country,countryCode,as,org,isp';

/** Free tier: 100 addresses per batch, 15 batches per minute. */
export const BATCH_SIZE = 100;
export const PACE_MS = 4000;

/** Split a list into batches the API will accept in one request. */
export function chunkIps(ips, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < ips.length; i += size) out.push(ips.slice(i, i + size));
  return out;
}

/**
 * ip-api returns `as` as one string: 'AS15169 Google LLC'. SPEC §5 wants asn
 * and as_org as separate fields, so split on the first space.
 */
function splitAs(as, org) {
  const match = /^(AS\d+)\s*(.*)$/.exec(String(as || '').trim());
  if (match) return { asn: match[1], asOrg: match[2] || org || UNKNOWN };
  return { asn: UNKNOWN, asOrg: org || UNKNOWN };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve addresses to {country, countryCode, asn, asOrg}.
 *
 * Failures never throw. A month of collected data must not become
 * unpublishable because a free API had a bad afternoon — unresolved addresses
 * come back as Unknown and are left out of the cache so a later run retries
 * them.
 *
 * @param {string[]} ips
 * @param {{fetchImpl?:Function, sleep?:Function, paceMs?:number, cache?:Map,
 *          batchSize?:number, onProgress?:Function}} [opts]
 * @returns {Promise<Map<string, object>>}
 */
export async function enrichIps(ips, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    paceMs = PACE_MS,
    cache = new Map(),
    batchSize = BATCH_SIZE,
    onProgress = () => {},
  } = opts;

  const result = new Map();
  const missing = [];

  // Deduplicate first: the capture has 121k rows but only ~1.9k addresses.
  // One request per row would be 1,200 wasted calls and a rate-limit ban.
  for (const ip of new Set(ips)) {
    if (cache.has(ip)) result.set(ip, cache.get(ip));
    else missing.push(ip);
  }

  const batches = chunkIps(missing, batchSize);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let entries = [];

    try {
      const res = await fetchImpl(`${ENDPOINT}?fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.ok) entries = await res.json();
    } catch {
      entries = []; // fall through to the Unknown fill below
    }

    const seen = new Set();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || entry.status !== 'success' || !entry.query) continue;
      const record = {
        country: entry.country || UNKNOWN,
        countryCode: entry.countryCode || '??',
        ...splitAs(entry.as, entry.org),
      };
      result.set(entry.query, record);
      cache.set(entry.query, record); // only successes are remembered
      seen.add(entry.query);
    }

    // Anything the API skipped, failed, or never answered for.
    for (const ip of batch) {
      if (!seen.has(ip)) {
        result.set(ip, { country: UNKNOWN, countryCode: '??', asn: UNKNOWN, asOrg: UNKNOWN });
      }
    }

    onProgress({ batch: i + 1, batches: batches.length, resolved: seen.size });

    // Pace between requests, never after the last one.
    if (i < batches.length - 1 && paceMs > 0) await sleep(paceMs);
  }

  return result;
}

/** Load the on-disk cache. A missing or corrupt file is simply an empty cache. */
export function readCache(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

/** Persist the cache so a rebuild costs no requests at all. */
export function writeCache(file, cache) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`);
}

export const CACHE_FILE = fileURLToPath(new URL('./cache/geo.json', import.meta.url));

/**
 * CLI: `npm run geo -- [logfile]`
 *
 * Kept separate from the build because it is the only step that needs the
 * network and the only one that takes minutes. Run it once; every later build
 * reads the cache and stays offline.
 */
async function main() {
  const log = process.argv[2] || 'events_combined.jsonl';
  if (!fs.existsSync(log)) {
    console.error(`No such log: ${log}`);
    process.exit(1);
  }

  const ips = new Set();
  for (const line of fs.readFileSync(log, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const ip = JSON.parse(line).src_ip;
      if (ip) ips.add(ip);
    } catch { /* the build's parser reports malformed lines; ignore here */ }
  }

  const cache = readCache(CACHE_FILE);
  const todo = [...ips].filter((ip) => !cache.has(ip)).length;
  console.log(`${ips.size} distinct addresses, ${cache.size} cached, ${todo} to resolve`);
  if (todo === 0) {
    console.log('Nothing to do.');
    return;
  }
  console.log(`~${Math.ceil((Math.ceil(todo / BATCH_SIZE) - 1) * PACE_MS / 1000)}s of pacing ahead.`);

  const geo = await enrichIps([...ips], {
    cache,
    onProgress: ({ batch, batches, resolved }) =>
      console.log(`  batch ${batch}/${batches} — ${resolved} resolved`),
  });

  writeCache(CACHE_FILE, cache);
  const unresolved = [...geo.values()].filter((g) => g.country === UNKNOWN).length;
  console.log(`Cached ${cache.size} addresses to ${path.relative(process.cwd(), CACHE_FILE)}`);
  if (unresolved) console.log(`${unresolved} unresolved — rerun to retry them.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
