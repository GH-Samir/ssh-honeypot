# SSH Honeypot - a month of credential telemetry

**One machine in Sweden guessed 1,417 passwords against this server in 119
seconds - and 98.6% of the 114,940 sessions that knocked gave up after a single
guess.** Both ends of that spectrum are automated; nothing that touched this
box in 30 days looked like a human.

This repo is a low-interaction SSH honeypot and the analysis of what it caught:
**121,310 authentication attempts from 1,896 addresses in 100 countries**,
collected on a public VPS between 15 July and 14 August 2026.

**Live dashboard:** <https://gh-samir.github.io/ssh-honeypot/>

![Dashboard screenshot](image.png)

## What the data says

- **Half the traffic speaks Go.** 50.1% of all attempts announced themselves
  with the client banner `SSH-2.0-Go` - one scanning stack dominates the
  internet's background noise. `libssh` variants cover another 36%.
- **Volume and reach are different stories.** China leads both attempt volume
  (22.9%) and distinct sources (426 /24 blocks) - a genuinely distributed
  botnet. Singapore, the UK, Nigeria and Costa Rica rank high on volume from a
  *handful* of hosts each: rented capacity firing short, huge bursts.
- **A quarter of all attempts (25.7%) came from Google, OVH, UCLOUD and Tencent
  address space.** The background noise increasingly rents by the hour.
- **Scanners keep no schedule.** The Mon–Sun fold is flat - weekend traffic is
  actually 11% *higher* than weekdays.
- **`root` is 57% of all username guesses.** The #2 username, oddly, is
  `rookie` (4.8%) - ahead of `admin`. 44.6% of the 25,037 distinct passwords
  were tried exactly once: long-tail wordlists, not shared dictionaries.

## How it works

```
[ VPS ]  listener (asyncssh) → events.jsonl        ← raw observation only
            │
[ local ]  analysis/geo.mjs   → geo cache          ← enrichment, run once
           analysis/build.mjs → dashboard/data/    ← aggregate + anonymise
            │
[ Pages ]  dashboard/         → static site        ← no server, no tracking
```

The listener ([honeypot/listener.py](honeypot/listener.py)) completes just
enough of the SSH protocol to reach authentication, logs each attempt as one
JSON line, and rejects everything. No shell, real or fake; nothing an attacker
can execute or write to.

The dashboard is a static page over a precomputed `summary.json`. The same
aggregation modules run in Node at build time and in the browser - you can load
any `.jsonl` log into the live page and it is analysed locally, in your
browser; nothing is uploaded anywhere.

## Privacy

The published build truncates every address to its `/24` network before anything 
is written, and the build refuses to emit a file containing a full address - enforced by test and again at the
point of writing. Raw logs and the full-IP geo cache never leave the local
machine and are gitignored. Usernames and passwords are attacker-supplied
strings; the renderer treats them as inert text everywhere (there is no
`innerHTML` in the codebase).

## Running it

```sh
npm ci
npm test                 # 171 tests, node --test + jsdom
npm run geo              # one-time: resolve source IPs via ip-api.com (cached)
npm run build            # events_combined.jsonl → dashboard/data/summary.json
npm run serve            # http://localhost:8000
```

Every module was built test-first; CI runs the suite on each push, and the
Pages deploy is gated on it.

## Using your own data

The dashboard reads **JSON Lines**: one JSON object per line, no enclosing
array, no commas between lines. Load a file with the **Load a .jsonl** button on
the live page and it is analysed in your browser - nothing is uploaded. To
publish it instead, put it through `npm run build`.

A minimal line needs only a timestamp; everything else fills in a panel:

| Field | Required | What it feeds |
|---|---|---|
| `ts` | **yes** | Timeline, day/hour/weekday folds, event log. A line without a parseable `ts` is skipped. |
| `src_ip` | no | Top sources, burst strips, country lookup. Missing shows as `(invalid)`. |
| `username` | no | Usernames panel, credential pairs. Missing shows as `(empty)`. |
| `password` | no | Passwords panel, credential pairs. Missing shows as `(empty)`. |
| `client_banner` | no | Client software panel. The `SSH-2.0-` prefix is stripped for display. |
| `session_id` | no | Groups attempts into bursts. Without it each line counts as its own session, so burst figures flatten. |
| `attempt_no` | no | Event log column only. Missing shows as `—`. |

`event_id`, `service` and `src_port` are accepted and ignored - the dashboard
never uses them, and the build drops them rather than carrying them through.

A full line, as the listener writes it:

```json
{"event_id":"7e7e2352-3377-4b65-8fa2-95de6a4b12b6","ts":"2026-07-15T11:50:24.624798+00:00","service":"ssh","src_ip":"203.0.113.119","src_port":55143,"username":"root","password":"hello test","client_banner":"SSH-2.0-OpenSSH_for_Windows_9.5","session_id":"d6f9c6bc-2d33-449f-abbb-ec3c2054557b","attempt_no":1}
```

And the smallest thing that renders:

```json
{"ts":"2026-07-15T11:50:24Z","src_ip":"203.0.113.119","username":"root","password":"123456"}
```

### Timestamps

**Always include a timezone.** `ts` is parsed with `Date.parse`, which reads a
bare `2026-07-15T11:50:24` as *local* time - so the same file would render
differently for every visitor. On a page served worldwide that is a 26-hour
spread. Both of these are unambiguous and correct:

```
2026-07-15T11:50:24.624798+00:00     ← what the listener writes
2026-07-15T11:50:24Z
```

Unix epoch numbers (`1752580224`) are **not** supported and those lines are
dropped. Convert to ISO 8601 first.

### Malformed lines

Blank lines, unparseable JSON and lines missing `ts` are skipped rather than
aborting the run - a rotated log can end mid-write. `npm run build` reports the
count:

```
121310 events from events_combined.jsonl (3 lines skipped)
```

Lines need not be in chronological order; they are sorted on load.

## License

MIT - see [LICENSE](LICENSE).
