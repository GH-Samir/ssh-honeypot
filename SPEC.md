# SSH Honeypot — Specification

**Status:** draft, pre-build
**Owner:** [your name]
**Timeline:** 2 weeks build → 2 weeks unattended → 2 weeks analysis

---

## 1. Purpose

Deploy a low-interaction SSH honeypot on a public VPS, collect roughly one month
of unsolicited authentication attempts from the open internet, and publish an
analysis of what was observed.

The project exists to demonstrate three things to a prospective employer:

1. I can write a correct network service.
2. I can operate it — deploy it, monitor it, and design it to survive without me.
3. I can turn raw data into a finding somebody would want to read.

The third is the one most student projects skip, and is therefore the one that
carries the most weight.

## 2. Scope

### In scope

- SSH listener on port 22 that completes enough of the protocol to reach
  authentication, logs the credentials offered, and rejects every attempt.
- Structured JSON logging, one record per attempt.
- Persistence to SQLite.
- Geo/ASN enrichment of source IPs (MaxMind GeoLite2, free tier).
  *Amended (Aug 2026): shipped with ip-api.com's free batch endpoint instead —
  no account or licence key, and country + ASN come back in one call. The
  full-IP lookup cache stays local and gitignored per §3.*
- A read-only dashboard over the collected data.
- `FINDINGS.md` — written analysis with charts.
- **Stretch:** a fake HTTP endpoint logging requested paths and user agents.

### Explicitly out of scope

- **High-interaction emulation.** No shell, real or fake. No filesystem the
  attacker can write to. No execution of attacker-supplied input, ever.
- Any active response to attackers (scanning back, blocking lists, "hack-back").
- Malware sample collection.
- Real-time alerting beyond a liveness heartbeat.

### Why low-interaction

A high-interaction honeypot is more interesting and much more dangerous. If an
attacker escapes the sandbox, my VPS becomes the origin of an attack on someone
else — which is my legal and practical problem. The data I actually need
(credentials, source IPs, volume, timing) is fully available from the
authentication stage alone. The extra risk buys nothing this project needs.

## 3. Safety and legal constraints

- Cloud VPS only. Never the home network.
- Real SSH admin access moved to a non-standard port, key-only auth, before
  anything is exposed.
- Outbound traffic firewalled by default; allow-list only log sync and heartbeat
  destinations.
- Check the VPS provider's acceptable use policy for honeypot / security
  research **before** paying. Email support and ask if unclear. Getting the
  account terminated in week five is an avoidable way to lose the dataset.
- Source IPs are personal data under UK GDPR. Raw logs stay private; anything
  published is aggregated or anonymised (e.g. `/24` truncation).

## 4. Architecture

```
  Internet
     │
     ▼
[ VPS: honeypot ]
  ├── ssh_listener  (asyncssh, port 22)
  ├── http_listener (stretch, port 80)
  ├── writer        → events.jsonl → SQLite
  ├── heartbeat     → hourly ping to external monitor
  └── log sync      → nightly push to off-box storage
                          │
                          ▼
              [ local: analysis + dashboard ]
```

The listener and the analysis are deliberately separate. The box on the internet
does as little as possible; anything clever happens on a machine I control.

## 5. Data model

One event per authentication attempt.

| Field | Type | Notes |
|---|---|---|
| `event_id` | uuid | |
| `ts` | ISO 8601, UTC | always UTC, no local time anywhere |
| `service` | enum | `ssh` \| `http` |
| `src_ip` | string | |
| `src_port` | int | |
| `username` | string | may be empty or non-UTF-8 — handle it |
| `password` | string | as above |
| `client_banner` | string | SSH version string; useful for fingerprinting tools |
| `session_id` | string | groups multiple attempts in one connection |
| `attempt_no` | int | position within the session |

Enrichment (added later, in the analysis layer, not on the box):

| Field | Source |
|---|---|
| `country`, `asn`, `as_org` | MaxMind GeoLite2 |

**Rule:** the listener writes raw observation only. Enrichment is derived and
recomputable. Never mix the two.

## 6. Survivability requirements (weeks 3–4)

The honeypot must run for two weeks with nobody watching it. Before I leave,
all of the following must be true and *tested*:

- [ ] systemd unit with `Restart=always` and a restart backoff
- [ ] log rotation configured; disk usage bounded
- [ ] disk-space guard — service degrades gracefully rather than filling the disk
- [ ] nightly log sync to off-box storage (rsync/rclone), verified by restoring
      from it once
- [ ] hourly heartbeat to an external monitor (e.g. healthchecks.io free tier)
      that emails me if it stops
- [ ] tested by killing the process and confirming it comes back
- [ ] VPS billing will not lapse while I am away
- [ ] daily summary email (nice-to-have): attempts, top username, new countries

If any of these is unchecked, do not leave.

## 7. Milestones

**Week 1 — get something ugly collecting data.**
Minimum viable listener, deployed, writing JSON lines. Correctness over
elegance. Data collected on day 7 is data I have; data collected on day 14 is
half as much data.

**Week 2 — make it survivable.**
Everything in §6. Tests for the protocol handler (feed it recorded byte
sequences). Dockerfile and `docker-compose.yml`. CI running the tests. Then
stop touching it.

**Weeks 3–4 — away.** Do nothing. Check the heartbeat emails.

**Week 5 — analysis.**
Enrich, aggregate, look for structure. Questions to ask the data:

- How long between the box going live and the first probe?
- Attempts per day — steady, or bursty?
- Top usernames and passwords. What does that say about default credentials?
- Do credential lists cluster by ASN or country — one botnet or many?
- Do SSH client banners fingerprint specific tools?
- Are there repeat source IPs, or is it a long tail of one-shot hosts?

**Week 6 — presentation.**
Dashboard, README with a screenshot, `FINDINGS.md`. HTTP listener only if time
allows; it is the cuttable scope. The writeup is not.

## 8. Non-goals for the README

Nobody cares that I "learned a lot about networking". State what the thing does,
show a picture, and lead with the most surprising number in the dataset.

## 9. Open questions

- VPS provider? (Hetzner ~€4/mo, DigitalOcean ~$6/mo — check GitHub Student
  Developer Pack for credit first.)
- SQLite for the whole project, or Postgres from the start?
- Is the HTTP listener worth the scope, or is a deeper SSH analysis better?
