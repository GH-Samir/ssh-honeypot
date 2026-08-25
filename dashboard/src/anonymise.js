// Source-IP anonymisation.
//
// SPEC §3: source IPs are personal data under UK GDPR, so anything published is
// truncated. /24 for IPv4 and /48 for IPv6 are the conventional "network, not
// host" boundaries — enough to keep an attacking network identifiable across
// panels, not enough to point at one machine.
//
// Every function here is total: a honeypot logs whatever the network hands it,
// and one malformed address must not be able to fail the whole build.

const INVALID = '(invalid)';

/** Already-anonymised labels must survive a second pass unchanged. */
const IPV4_BLOCK = /^(\d{1,3}(?:\.\d{1,3}){3})\/24$/;
const IPV6_BLOCK = /^([0-9a-f:]+)\/48$/i;

function parseIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const p of parts) {
    // Reject '', '01', '1e2' and anything out of range — Number() is too
    // permissive on its own (Number(' 1 ') === 1, Number('') === 0).
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Expand '::' and return exactly 8 lower-case groups, or null if malformed. */
function parseIpv6(ip) {
  const halves = ip.split('::');
  if (halves.length > 2) return null; // '::' may appear at most once

  const split = (s) => (s === '' ? [] : s.split(':'));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];

  for (const g of [...head, ...tail]) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
  }

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // '::' must stand for at least one group
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }

  // Strip leading zeros so '0db8' and 'db8' produce the same label.
  return groups.map((g) => g.replace(/^0+(?=.)/, '').toLowerCase());
}

/**
 * Truncate an address to its network block.
 * @param {unknown} ip
 * @returns {string} '1.2.3.0/24', '2001:db8:abcd::/48', or '(invalid)'
 */
export function truncateIp(ip) {
  if (typeof ip !== 'string') return INVALID;
  const s = ip.trim();
  if (s === '') return INVALID;
  if (s === INVALID) return INVALID;

  // Idempotence: re-running the pipeline over its own output is a no-op.
  const v4Block = IPV4_BLOCK.exec(s);
  if (v4Block) return parseIpv4(v4Block[1]) ? s : INVALID;
  const v6Block = IPV6_BLOCK.exec(s);
  if (v6Block) return parseIpv6(v6Block[1]) ? s.toLowerCase() : INVALID;

  const v4 = parseIpv4(s);
  if (v4) return `${v4[0]}.${v4[1]}.${v4[2]}.0/24`;

  if (s.includes(':')) {
    const v6 = parseIpv6(s);
    if (v6) return `${v6.slice(0, 3).join(':')}::/48`;
  }

  return INVALID;
}

/**
 * Pick the address policy for a build.
 *
 * The published build gets truncation; `analysis/build.mjs --full-ip` gets the
 * real addresses for local analysis. Selecting once, up front, means no call
 * site has to remember which mode it is in.
 *
 * @param {boolean} anonymise
 * @returns {(ip: unknown) => string}
 */
export function makeAnonymiser(anonymise) {
  if (anonymise) return truncateIp;
  // Even in full-IP mode, junk is normalised so downstream grouping is stable.
  return (ip) => {
    if (typeof ip !== 'string') return INVALID;
    const s = ip.trim();
    return s === '' ? INVALID : s;
  };
}
