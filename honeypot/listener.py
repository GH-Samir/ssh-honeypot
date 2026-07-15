import asyncio, asyncssh, json, uuid
from datetime import datetime, timezone
import shutil

EVENTS_PATH = "events.jsonl"

MIN_FREE_BYTES = 500 * 1024 * 1024  # 500 MB safety margin

class HoneypotServer(asyncssh.SSHServer):
    def connection_made(self, conn):
        self._conn = conn
        peer = conn.get_extra_info("peername")
        self.src_ip, self.src_port = peer[0], peer[1]
        self.session_id = str(uuid.uuid4())
        self.attempt_no = 0

    def begin_auth(self, username):
        return True

    def password_auth_supported(self):
        return True

    def public_key_auth_supported(self):
        return False

    def validate_password(self, username, password):
        self.attempt_no += 1
        event = {
            "event_id": str(uuid.uuid4()),
            "ts": datetime.now(timezone.utc).isoformat(),
            "service": "ssh",
            "src_ip": self.src_ip,
            "src_port": self.src_port,
            "username": username,
            "password": password,
            "client_banner": self._conn.get_extra_info("client_version", ""),
            "session_id": self.session_id,
            "attempt_no": self.attempt_no,
        }
        if shutil.disk_usage(".").free > MIN_FREE_BYTES:
            line = json.dumps(event, ensure_ascii=False) + "\n"
            with open(EVENTS_PATH, "a", encoding="utf-8", errors="replace") as f:
                f.write(line)
        else:
            print(f"WARNING: low disk space, dropped event {event['event_id']}")
        return False

async def main():
    await asyncssh.listen(
        host="", port=22,
        server_factory=HoneypotServer,
        server_host_keys=["honeypot_host_key"],
    )
    await asyncio.Future()

asyncio.run(main())