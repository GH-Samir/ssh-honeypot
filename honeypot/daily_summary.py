import json
import os
import smtplib
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

EVENTS_PATH = "events.jsonl"
TOP_N = 5

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = os.environ["SMTP_USER"]
SMTP_PASSWORD = os.environ["SMTP_PASSWORD"]
TO_ADDR = os.environ["SMTP_USER"]


def load_recent_events(hours=24):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    events = []
    with open(EVENTS_PATH) as f:
        for line in f:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if datetime.fromisoformat(event["ts"]) >= cutoff:
                events.append(event)
    return events


def build_summary(events):
    total = len(events)
    unique_ips = len({e["src_ip"] for e in events})
    top_usernames = Counter(e["username"] or "(empty)" for e in events).most_common(TOP_N)
    top_passwords = Counter(e["password"] or "(empty)" for e in events).most_common(TOP_N)

    lines = [
        f"Honeypot daily summary — {datetime.now(timezone.utc).date()}",
        "",
        f"Attempts in last 24h: {total}",
        f"Unique source IPs:    {unique_ips}",
        "",
        "Top usernames:",
    ]
    lines += [f"  {name}: {count}" for name, count in top_usernames]
    lines += ["", "Top passwords:"]
    lines += [f"  {pw}: {count}" for pw, count in top_passwords]
    return "\n".join(lines)


def send_email(body):
    msg = MIMEText(body)
    msg["Subject"] = "Honeypot daily summary"
    msg["From"] = SMTP_USER
    msg["To"] = TO_ADDR
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)


if __name__ == "__main__":
    events = load_recent_events()
    send_email(build_summary(events))
