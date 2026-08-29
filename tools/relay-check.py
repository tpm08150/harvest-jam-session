#!/usr/bin/env python3
"""Check that a jam relay speaks the protocol — whichever relay it is.

    python3 tools/jam-relay.py &                      # the LAN one
    python3 tools/relay-check.py ws://localhost:8124

    cd relay && npx wrangler dev &                    # the hosted one, run locally
    python3 tools/relay-check.py ws://localhost:8787

    python3 tools/relay-check.py wss://harvest-jam-relay.<subdomain>.workers.dev

⚠️ THIS EXISTS BECAUSE THERE ARE TWO RELAYS AND THEY MUST NOT DRIFT. `tools/jam-relay.py`
is the one you run for two laptops on a LAN — no account, no deploy, no internet.
`relay/worker.js` is the one the deployed site talks to, because an https page cannot open
a ws:// socket and Netlify serves static files only. The clients cannot tell them apart,
and that is the entire point: the same studio build has to work against either.

Nothing enforces that on its own. Two implementations of one protocol drift silently — the
second one gets a fix the first does not, or a field is renamed on the side you happened to
be testing — and the failure surfaces as "the jam works from my laptop but not from the
link", which is a miserable thing to debug from the wrong end. So the protocol is written
down once, as assertions, and both relays are held to it.

Stdlib only, like everything else in tools/. A WebSocket client is a handshake and a mask;
requiring an npm install to check the LAN relay would make the dependency-free half of this
depend on the other half.
"""
import base64
import hashlib
import json
import os
import queue
import socket
import ssl
import struct
import sys
import threading
import time
from urllib.parse import urlparse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class Peer:
    """One connection, with a reader thread turning frames into decoded messages."""

    def __init__(self, url):
        u = urlparse(url)
        secure = u.scheme == "wss"
        port = u.port or (443 if secure else 80)
        self.sock = socket.create_connection((u.hostname, port), timeout=10)
        if secure:
            self.sock = ssl.create_default_context().wrap_socket(
                self.sock, server_hostname=u.hostname)
        self.inbox = queue.Queue()
        self._handshake(u)
        self.alive = True
        t = threading.Thread(target=self._read_loop, daemon=True)
        t.start()

    def _handshake(self, u):
        key = base64.b64encode(os.urandom(16)).decode()
        host = u.hostname + ("" if u.port is None else ":%d" % u.port)
        self.sock.sendall((
            "GET %s HTTP/1.1\r\n"
            "Host: %s\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (u.path or "/", host, key)).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise OSError("relay closed during the handshake")
            buf += chunk
        head, _, rest = buf.partition(b"\r\n\r\n")
        if b"101" not in head.split(b"\r\n")[0]:
            raise OSError("relay did not upgrade: " + head.split(b"\r\n")[0].decode())
        want = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        if want.lower().encode() not in head.lower():
            raise OSError("Sec-WebSocket-Accept did not match — that is not a WebSocket")
        self._rest = rest

    # ---- framing ----------------------------------------------------------
    def _recv(self, n):
        buf, self._rest = self._rest[:n], self._rest[n:]
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    def _read_loop(self):
        try:
            while self.alive:
                head = self._recv(2)
                if not head:
                    break
                opcode, length = head[0] & 0x0F, head[1] & 0x7F
                if length == 126:
                    length = struct.unpack(">H", self._recv(2))[0]
                elif length == 127:
                    length = struct.unpack(">Q", self._recv(8))[0]
                payload = self._recv(length) if length else b""
                if payload is None or opcode == 0x8:
                    break
                if opcode != 0x1:
                    continue
                try:
                    self.inbox.put(json.loads(payload.decode("utf-8")))
                except (ValueError, UnicodeDecodeError):
                    pass
        except OSError:
            pass
        self.alive = False

    def send(self, obj):
        """Client frames are always masked; that is the spec, not a courtesy."""
        data = json.dumps(obj).encode("utf-8")
        n = len(data)
        head = bytearray([0x81])
        if n < 126:
            head.append(0x80 | n)
        elif n < (1 << 16):
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        self.sock.sendall(bytes(head) + bytes(data[i] ^ mask[i % 4] for i in range(n)))

    def take(self, kind, timeout=4.0):
        """The next message of this kind, or None. Anything else is put back, because the
        relay may be forwarding somebody's traffic at the same time."""
        held, deadline = [], time.time() + timeout
        found = None
        while time.time() < deadline:
            try:
                m = self.inbox.get(timeout=max(0.01, deadline - time.time()))
            except queue.Empty:
                break
            if m.get("kind") == kind:
                found = m
                break
            held.append(m)
        for m in held:
            self.inbox.put(m)
        return found

    def drain(self, seconds=0.35):
        """Everything that arrives in a moment — for asserting a message did NOT."""
        time.sleep(seconds)
        out = []
        while True:
            try:
                out.append(self.inbox.get_nowait())
            except queue.Empty:
                return out

    def close(self):
        self.alive = False
        try:
            self.sock.close()
        except OSError:
            pass


passes, fails = 0, 0


def ok(name, cond, extra=""):
    global passes, fails
    if cond:
        passes += 1
        print("  ok   " + name)
    else:
        fails += 1
        print("  FAIL " + name + (("  -> " + str(extra)) if extra else ""))


def now_ms():
    return time.time() * 1000.0


def run(url):
    print("checking " + url)
    a = Peer(url)

    # ---- rooms, before anyone has joined anything ----
    a.send({"kind": "rooms"})
    r = a.take("rooms")
    ok("rooms answers on an unjoined connection", r is not None and isinstance(r.get("rooms"), list), r)
    ok("rooms is empty before any join", r and r["rooms"] == [], r and r["rooms"])

    # ---- join ----
    a.send({"kind": "join", "room": "check"})
    ja = a.take("joined")
    ok("join is answered", ja is not None)
    ok("joined names the room", ja and ja.get("room") == "check", ja and ja.get("room"))
    ok("joined carries an epoch", ja and isinstance(ja.get("epoch"), (int, float)), ja)
    ok("joined carries ts", ja and isinstance(ja.get("ts"), (int, float)), ja)
    ok("first joiner sees 0 peers", ja and ja.get("peers") == 0, ja and ja.get("peers"))
    # ⚠️ The epoch is the reason the relay exists at all — a shared beat 0 in ONE clock.
    # A relay that answered with its own uptime, or with 0, would look fine here and put
    # two laptops seconds apart.
    ok("epoch is wall-clock ms", ja and abs(ja["epoch"] - now_ms()) < 60000,
       ja and round(ja["epoch"] - now_ms()))

    # ---- a second client ----
    b = Peer(url)
    b.send({"kind": "rooms"})
    r = b.take("rooms")
    ok("rooms lists an occupied room",
       r and len(r["rooms"]) == 1 and r["rooms"][0]["name"] == "check", r and r["rooms"])
    ok("rooms counts its peers", r and r["rooms"][0].get("peers") == 1, r and r["rooms"])

    b.send({"kind": "join", "room": "check"})
    jb = b.take("joined")
    ok("second joiner is answered", jb is not None)
    ok("second joiner gets the SAME epoch", jb and ja and jb["epoch"] == ja["epoch"],
       jb and ja and "%.1f ms apart" % (jb["epoch"] - ja["epoch"]))
    ok("second joiner sees 1 peer", jb and jb.get("peers") == 1, jb and jb.get("peers"))

    # ---- forwarding: verbatim, to others, never to the sender ----
    a.drain(0.2); b.drain(0.2)
    a.send({"kind": "note", "from": "aaa", "inst": "dr1", "n": 36, "v": 100, "on": True})
    got = b.take("note", 2.0)
    ok("a message reaches the other client", got is not None)
    ok("forwarded verbatim",
       got and got.get("from") == "aaa" and got.get("n") == 36 and got.get("inst") == "dr1", got)
    ok("never echoed to the sender",
       not any(m.get("kind") == "note" for m in a.drain(0.3)))

    # ---- ping / pong ----
    a.send({"kind": "ping", "t0": 12345.678})
    pong = a.take("pong")
    ok("ping is answered", pong is not None)
    ok("pong returns t0 untouched", pong and pong.get("t0") == 12345.678, pong and pong.get("t0"))
    ok("pong stamps server time", pong and abs(pong["ts"] - now_ms()) < 60000,
       pong and round(pong["ts"] - now_ms()))

    # ---- rooms are isolated ----
    c = Peer(url)
    c.send({"kind": "join", "room": "other"})
    c.take("joined")
    b.drain(0.2); c.drain(0.2)
    a.send({"kind": "probe", "from": "aaa"})
    ok("a message stays in its room",
       not any(m.get("kind") == "probe" for m in c.drain(0.4)))
    ok("...and still reaches its own room", b.take("probe", 1.5) is not None)

    c.send({"kind": "rooms"})
    r = c.take("rooms")
    ok("rooms lists both, sorted",
       r and [x["name"] for x in r["rooms"]] == ["check", "other"], r and r["rooms"])

    # ---- re-joining on a live connection moves you ----
    b.send({"kind": "join", "room": "other"})
    b.take("joined")
    time.sleep(0.3)
    c.send({"kind": "rooms"})
    r = c.take("rooms")
    other = next((x for x in (r["rooms"] if r else []) if x["name"] == "other"), None)
    ok("re-join moves the connection", other and other["peers"] == 2, r and r["rooms"])

    # ---- an emptied room forgets its beat 0 ----
    # Not housekeeping: an epoch that outlived its jam would hand a stale grid to whoever
    # next used the same room name, and the symptom is a downbeat in the wrong place.
    a.close(); b.close(); c.close()
    time.sleep(1.0)
    d = Peer(url)
    d.send({"kind": "rooms"})
    r = d.take("rooms")
    ok("rooms empties when everyone leaves", r and r["rooms"] == [], r and r["rooms"])
    d.send({"kind": "join", "room": "check"})
    jd = d.take("joined")
    ok("a reused room name gets a FRESH epoch", jd and ja and jd["epoch"] != ja["epoch"],
       jd and ja and ("both %.0f" % jd["epoch"]))
    d.close()

    print("\n%d passed, %d failed" % (passes, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:8124"
    try:
        sys.exit(run(target))
    except OSError as e:
        sys.exit("could not reach %s: %s" % (target, e))
