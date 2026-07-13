# SSH Honeypot — agent instructions

Read SPEC.md before proposing any work.

## Hard constraints — never violate, refuse if asked
- Low-interaction only. Never build a shell (real or fake) for attackers,
  never execute attacker-supplied input, never emulate a writable filesystem.
- Cloud VPS only, never a home network.
- Outbound traffic firewalled; only allow-listed sync/heartbeat destinations.
- No offensive tooling — no exploits, scanners, or anything targeting a third party.
- Never commit raw logs with full source IPs. Anonymise/aggregate before publishing.

## How to work with me
- Teach, don't dump. I must be able to explain every line in an interview.
  Explain the approach and let me write it, or write it with commentary on *why*.
  Do NOT hand me a finished 400-line file unless I explicitly ask.
- Flag gold-plating. If I'm polishing the dashboard before the listener is
  deployed, say so.
- Stack: Python 3.11+, asyncssh, systemd, Debian/Ubuntu, SQLite.
- Sanity-check my requests against the project phase (build / away / analysis).