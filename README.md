# SSH Honeypot — a month of credential telemetry

**One machine in China guessed 1,417 passwords against this server in 119
seconds — and 98.6% of the 114,940 sessions that knocked gave up after a single
guess.** Both ends of that spectrum are automated; nothing that touched this
box in 30 days looked like a human.

This repo is a low-interaction SSH honeypot and the analysis of what it caught:
**121,310 authentication attempts from 1,896 addresses in 100 countries**,
collected on a public VPS between 15 July and 14 August 2026.

**Live dashboard:** <https://gh-samir.github.io/ssh-honeypot/>

![Dashboard screenshot](docs/screenshot.png)

## What the data says

- **Half the traffic speaks Go.** 50.1% of all attempts announced themselves
  with the client banner `SSH-2.0-Go` — one scanning stack dominates the
  internet's background noise. `libssh` variants cover another 36%.
- **Volume and reach are different stories.** China leads both attempt volume
  (22.9%) and distinct sources (426 /24 blocks) — a genuinely distributed
  botnet. Singapore, the UK, Nigeria and Costa Rica rank high on volume from a
  *handful* of hosts each: rented capacity firing short, huge bursts.
- **12% of attempts came from Google, OVH, UCLOUD and Tencent address space.**
  The background noise increasingly rents by the hour.
- **Scanners keep no schedule.** The Mon–Sun fold is flat — weekend traffic is
  actually 11% *higher* than weekdays.
- **`root` is 57% of all username guesses.** The #2 username, oddly, is
  `rookie` (4.8%) — ahead of `admin`. 44.6% of the 25,037 distinct passwords
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
aggregation modules run in Node at build time and in the browser — you can load
any `.jsonl` log into the live page and it is analysed locally, in your
browser; nothing is uploaded anywhere.

## Privacy

Source IPs are personal data under UK GDPR. The published build truncates every
address to its `/24` network before anything is written, and the build refuses
to emit a file containing a full address — enforced by test and again at the
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

## License

MIT — see [LICENSE](LICENSE).
