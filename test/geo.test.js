import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chunkIps, enrichIps, readCache, writeCache, UNKNOWN } from '../analysis/geo.mjs';

/** A fake ip-api.com that answers every query with a country derived from it. */
function fakeApi(overrides = {}) {
  const calls = [];
  const impl = async (url, options) => {
    const batch = JSON.parse(options.body);
    calls.push(batch);
    if (overrides.throwOn && overrides.throwOn(calls.length)) throw new Error('network down');
    if (overrides.status && overrides.status(calls.length) !== 200) {
      return { ok: false, status: overrides.status(calls.length), json: async () => [] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => batch.map((q) => ({
        status: 'success', query: q,
        country: `Country-${q}`, countryCode: 'XX',
        as: 'AS12345 Example Networks', org: 'Example Org', isp: 'Example ISP',
      })),
    };
  };
  return { impl, calls };
}

const noSleep = async () => {};

test('chunkIps splits into batches the API will accept', () => {
  const ips = Array.from({ length: 250 }, (_, i) => `1.1.1.${i}`);
  const batches = chunkIps(ips, 100);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 50]);
  assert.equal(batches.flat().length, 250);
});

test('chunkIps handles an empty list', () => {
  assert.deepEqual(chunkIps([], 100), []);
});

test('enrichIps resolves every address', async () => {
  const api = fakeApi();
  const geo = await enrichIps(['8.8.8.8', '1.1.1.1'], { fetchImpl: api.impl, sleep: noSleep });

  assert.equal(geo.get('8.8.8.8').country, 'Country-8.8.8.8');
  assert.equal(geo.get('8.8.8.8').countryCode, 'XX');
  // 'AS12345 Example Networks' is split so the number and the name are usable
  // separately — SPEC §5 wants asn and as_org as distinct fields.
  assert.equal(geo.get('8.8.8.8').asn, 'AS12345');
  assert.equal(geo.get('8.8.8.8').asOrg, 'Example Networks');
});

test('enrichIps batches at 100 addresses per request', async () => {
  const api = fakeApi();
  const ips = Array.from({ length: 250 }, (_, i) => `1.1.1.${i}`);
  await enrichIps(ips, { fetchImpl: api.impl, sleep: noSleep });

  assert.equal(api.calls.length, 3);
  assert.deepEqual(api.calls.map((c) => c.length), [100, 100, 50]);
});

test('enrichIps deduplicates before spending requests on them', async () => {
  const api = fakeApi();
  // The capture has 121,310 rows but only 1,896 addresses; looking up one per
  // row would be 1,200 wasted requests and a rate-limit ban.
  await enrichIps(['8.8.8.8', '8.8.8.8', '8.8.8.8'], { fetchImpl: api.impl, sleep: noSleep });
  assert.deepEqual(api.calls, [['8.8.8.8']]);
});

test('enrichIps paces between requests but not after the last', async () => {
  // ip-api.com allows 15 batch requests per minute on the free tier. Going over
  // gets the address blocked, which would cost the whole enrichment run.
  const api = fakeApi();
  const waits = [];
  const ips = Array.from({ length: 250 }, (_, i) => `1.1.1.${i}`);
  await enrichIps(ips, { fetchImpl: api.impl, sleep: async (ms) => waits.push(ms), paceMs: 4000 });

  assert.deepEqual(waits, [4000, 4000]); // 3 batches, 2 gaps
});

test('enrichIps serves cached addresses without touching the network', async () => {
  const api = fakeApi();
  const cache = new Map([['8.8.8.8', { country: 'Cached Land', countryCode: 'CL', asn: 'AS1', asOrg: 'Cached' }]]);
  const geo = await enrichIps(['8.8.8.8'], { fetchImpl: api.impl, sleep: noSleep, cache });

  assert.equal(api.calls.length, 0);
  assert.equal(geo.get('8.8.8.8').country, 'Cached Land');
});

test('enrichIps looks up only the addresses the cache is missing', async () => {
  const api = fakeApi();
  const cache = new Map([['8.8.8.8', { country: 'Cached Land', countryCode: 'CL', asn: 'AS1', asOrg: 'Cached' }]]);
  const geo = await enrichIps(['8.8.8.8', '1.1.1.1'], { fetchImpl: api.impl, sleep: noSleep, cache });

  assert.deepEqual(api.calls, [['1.1.1.1']]);
  assert.equal(geo.get('8.8.8.8').country, 'Cached Land');
  assert.equal(geo.get('1.1.1.1').country, 'Country-1.1.1.1');
  assert.equal(cache.size, 2); // newly resolved address is remembered
});

test('a failed request degrades to Unknown instead of failing the build', async () => {
  // A month of collected data must not become unpublishable because a free
  // geo API had a bad afternoon.
  const api = fakeApi({ throwOn: () => true });
  const geo = await enrichIps(['8.8.8.8', '1.1.1.1'], { fetchImpl: api.impl, sleep: noSleep });

  assert.equal(geo.get('8.8.8.8').country, UNKNOWN);
  assert.equal(geo.get('1.1.1.1').country, UNKNOWN);
});

test('an HTTP error degrades the same way', async () => {
  const api = fakeApi({ status: () => 429 });
  const geo = await enrichIps(['8.8.8.8'], { fetchImpl: api.impl, sleep: noSleep });
  assert.equal(geo.get('8.8.8.8').country, UNKNOWN);
});

test('one failed batch does not lose the batches that worked', async () => {
  const api = fakeApi({ throwOn: (n) => n === 1 });
  const ips = Array.from({ length: 150 }, (_, i) => `1.1.1.${i}`);
  const geo = await enrichIps(ips, { fetchImpl: api.impl, sleep: noSleep });

  assert.equal(geo.get('1.1.1.0').country, UNKNOWN);       // first batch failed
  assert.equal(geo.get('1.1.1.149').country, 'Country-1.1.1.149'); // second worked
});

test('a per-address failure is Unknown while its neighbours resolve', async () => {
  // ip-api returns status:'fail' for reserved ranges rather than erroring.
  const impl = async (url, options) => ({
    ok: true, status: 200,
    json: async () => JSON.parse(options.body).map((q) => (
      q === '10.0.0.1'
        ? { status: 'fail', message: 'reserved range', query: q }
        : { status: 'success', query: q, country: 'Realm', countryCode: 'RE', as: 'AS7 Seven', org: 'Org' }
    )),
  });
  const geo = await enrichIps(['10.0.0.1', '8.8.8.8'], { fetchImpl: impl, sleep: noSleep });

  assert.equal(geo.get('10.0.0.1').country, UNKNOWN);
  assert.equal(geo.get('8.8.8.8').country, 'Realm');
});

test('failures are not cached, so a later run can retry them', async () => {
  const api = fakeApi({ throwOn: () => true });
  const cache = new Map();
  await enrichIps(['8.8.8.8'], { fetchImpl: api.impl, sleep: noSleep, cache });
  assert.equal(cache.size, 0);
});

test('an AS string without a number still yields something usable', async () => {
  const impl = async (url, options) => ({
    ok: true, status: 200,
    json: async () => JSON.parse(options.body).map((q) => ({
      status: 'success', query: q, country: 'Realm', countryCode: 'RE', as: '', org: 'Fallback Org',
    })),
  });
  const geo = await enrichIps(['8.8.8.8'], { fetchImpl: impl, sleep: noSleep });
  assert.equal(geo.get('8.8.8.8').asn, UNKNOWN);
  assert.equal(geo.get('8.8.8.8').asOrg, 'Fallback Org');
});

test('the cache round-trips through disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-'));
  const file = path.join(dir, 'geo.json');
  try {
    const cache = new Map([['8.8.8.8', { country: 'Realm', countryCode: 'RE', asn: 'AS7', asOrg: 'Seven' }]]);
    writeCache(file, cache);
    const loaded = readCache(file);
    assert.equal(loaded.get('8.8.8.8').country, 'Realm');
    assert.equal(loaded.size, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing or corrupt cache file starts empty rather than throwing', () => {
  assert.equal(readCache('/nonexistent/path/geo.json').size, 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-'));
  const file = path.join(dir, 'geo.json');
  try {
    fs.writeFileSync(file, '{ not json');
    assert.equal(readCache(file).size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
