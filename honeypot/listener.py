import asyncio, asyncssh, json, uuid
from datetime import datetime, timezone

class HoneypotServer(asyncssh.SSHServer):
    def connection_made(self, conn):
        # Grab and stash on self:
        #   - peer IP and port: conn.get_extra_info("peername")
        #   - the client's SSH banner (find it in the asyncssh docs)
        #   - a fresh session_id
        #   - attempt counter = 0
        ...

    def begin_auth(self, username):
        return True

    def password_auth_supported(self):
        return True

    def public_key_auth_supported(self):
        return False

    def validate_password(self, username, password):
        # 1. increment the attempt counter
        # 2. build the event dict — SPEC §5, every field
        # 3. append one JSON line to events.jsonl
        # 4. return False. Always.
        ...

async def main():
    await asyncssh.listen(
        host="", port=2222,          # port 22 comes later
        server_factory=HoneypotServer,
        server_host_keys=["honeypot_host_key"],
    )
    await asyncio.Future()

asyncio.run(main())