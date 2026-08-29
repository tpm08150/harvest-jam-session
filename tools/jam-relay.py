#!/usr/bin/env python3
"""A WebSocket relay for shared jam sessions.

    python3 tools/jam-relay.py            # port 8124
    PORT=9000 python3 tools/jam-relay.py

Stdlib only, deliberately. This repo's rule is that `python3 tools/build.py` needs nothing
but a Python interpreter, and a jam that needed an npm install to try would be a different
project. The WebSocket handshake is one SHA-1 and the framing is a few lines, so the whole
dependency is avoidable for about a hundred lines that will never need updating.

WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT

It relays and it keeps time. That is all. It holds no musical state, arbitrates nothing,
and never inspects a payload beyond its `kind` — because the clients already agree on
everything, and a relay that understood the music would be a second implementation of the
model with its own opinions about who is right.

Two message kinds are the relay's own:

    {"kind":"join","room":"..."}   put this connection in a room
    {"kind":"ping","t0":<num>}     answered directly with {"kind":"pong","t0":...,"ts":...}
    {"kind":"rooms"}               answered with the rooms that currently have anyone in them

Everything else is forwarded verbatim to every OTHER connection in the same room.

TIME IS THE POINT OF HAVING A SERVER AT ALL. Two laptops' system clocks can be seconds
apart, so Date.now() cannot be the shared epoch — `ts` is this process's clock, and the
clients estimate their offset against it NTP-style. See originFromEpoch() in
shell/session.js.

TO RUN IT FOR TWO LAPTOPS ON ONE NETWORK: start this on either machine, find that machine's
LAN address, and open the studio on both with ?relay=ws://<that-address>:8124
"""
import base64
import hashlib
import json
import os
import socket
import struct
import threading
import time

PORT = int(os.environ.get("PORT", 8124))
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

rooms = {}          # room name -> set of Client
epochs = {}         # room name -> ms of that room's beat 0
lock = threading.Lock()


def now_ms():
    """One clock for the session. Wall time, because the clients need to map it onto their
    own audio clocks and a monotonic counter has no meaning to anyone else."""
    return time.time() * 1000.0


class Client(threading.Thread):
    daemon = True

    def __init__(self, sock, addr):
        super().__init__()
        self.sock = sock
        self.addr = addr
        self.room = None
        self.alive = True

    # ---- framing ----------------------------------------------------------
    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    def read_frame(self):
        """One text frame, or None when the peer has gone.

        Client frames are always masked; that is the spec, not a courtesy, so the mask is
        applied unconditionally rather than being treated as optional."""
        head = self._recv_exact(2)
        if not head:
            return None
        b1, b2 = head[0], head[1]
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        length = b2 & 0x7F
        if length == 126:
            ext = self._recv_exact(2)
            if not ext:
                return None
            length = struct.unpack(">H", ext)[0]
        elif length == 127:
            ext = self._recv_exact(8)
            if not ext:
                return None
            length = struct.unpack(">Q", ext)[0]
        mask = self._recv_exact(4) if masked else b"\x00\x00\x00\x00"
        if mask is None:
            return None
        payload = self._recv_exact(length) if length else b""
        if payload is None:
            return None
        if masked:
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
        if opcode == 0x8:                      # close
            return None
        if opcode == 0x9:                      # ping -> pong, keep the socket honest
            self.send_frame(payload, opcode=0xA)
            return b""
        if opcode == 0xA:                      # pong, ignore
            return b""
        return payload

    def send_frame(self, data, opcode=0x1):
        """Server frames are never masked."""
        n = len(data)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(n)
        elif n < (1 << 16):
            head.append(126)
            head += struct.pack(">H", n)
        else:
            head.append(127)
            head += struct.pack(">Q", n)
        try:
            self.sock.sendall(bytes(head) + data)
        except OSError:
            self.alive = False

    def send_json(self, obj):
        self.send_frame(json.dumps(obj).encode("utf-8"))

    # ---- handshake --------------------------------------------------------
    def handshake(self):
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = self.sock.recv(1024)
            if not chunk:
                return False
            req += chunk
            if len(req) > 65536:
                return False
        key = None
        for line in req.split(b"\r\n"):
            if line.lower().startswith(b"sec-websocket-key:"):
                key = line.split(b":", 1)[1].strip()
        if not key:
            return False
        accept = base64.b64encode(
            hashlib.sha1(key + GUID.encode()).digest()).decode()
        self.sock.sendall(
            b"HTTP/1.1 101 Switching Protocols\r\n"
            b"Upgrade: websocket\r\n"
            b"Connection: Upgrade\r\n"
            b"Sec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n")
        return True

    # ---- the loop ---------------------------------------------------------
    def run(self):
        try:
            if not self.handshake():
                return
            while self.alive:
                raw = self.read_frame()
                if raw is None:
                    break
                if not raw:
                    continue
                try:
                    msg = json.loads(raw.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    continue
                self.handle(msg, raw)
        except OSError:
            pass
        finally:
            self.leave()
            try:
                self.sock.close()
            except OSError:
                pass

    def handle(self, msg, raw):
        kind = msg.get("kind")
        if kind == "ping":
            # Answered on this connection only, and stamped as late as possible so the
            # client's round-trip estimate contains as little of our own delay as it can.
            self.send_json({"kind": "pong", "t0": msg.get("t0"), "ts": now_ms()})
            return
        if kind == "rooms":
            # So you can pick a jam instead of having to be told its name. Asked before
            # joining anything, which is why it is answered on any connection.
            with lock:
                listing = sorted(({"name": r, "peers": len(cs)} for r, cs in rooms.items()),
                                 key=lambda r: r["name"])
            self.send_json({"kind": "rooms", "rooms": listing})
            return
        if kind == "join":
            self.leave()
            room = str(msg.get("room") or "jam")
            with lock:
                rooms.setdefault(room, set()).add(self)
                # ⚠️ The ROOM's beat 0, stamped here and never by a client. A client cannot
                # stamp it: at join time it has not measured its offset yet, so the number
                # it would produce is in its own performance.now() base and means nothing
                # to anybody else. Every joiner is told the same value in the same clock
                # the pongs are in, which is the whole reason this process keeps time.
                epochs.setdefault(room, now_ms())
                epoch = epochs[room]
            self.room = room
            self.send_json({"kind": "joined", "room": room, "ts": now_ms(),
                            "epoch": epoch, "peers": self.room_size() - 1})
            print("  + %s joined %r (%d here)" % (self.addr[0], room, self.room_size()))
            return
        # Anything else is the clients' business, forwarded untouched.
        self.broadcast(raw)

    def room_size(self):
        with lock:
            return len(rooms.get(self.room, ()))

    def broadcast(self, raw):
        if not self.room:
            return
        with lock:
            others = [c for c in rooms.get(self.room, ()) if c is not self]
        for c in others:
            c.send_frame(raw)

    def leave(self):
        if not self.room:
            return
        with lock:
            peers = rooms.get(self.room)
            if peers:
                peers.discard(self)
                if not peers:
                    rooms.pop(self.room, None)
                    # the room is gone, so its grid is too — the next one starts fresh
                    epochs.pop(self.room, None)
        print("  - %s left %r" % (self.addr[0], self.room))
        self.room = None


def lan_addresses():
    """Best effort at the addresses another laptop could actually reach. The UDP connect
    never sends anything; it just asks the routing table which interface would be used."""
    out = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        out.append(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    return out or ["<this machine's LAN address>"]


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("", PORT))
    srv.listen(64)
    print("jam relay on port %d" % PORT)
    for a in lan_addresses():
        print("  open the studio with  ?relay=ws://%s:%d" % (a, PORT))
    print("  ctrl-c to stop\n")
    try:
        while True:
            sock, addr = srv.accept()
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            Client(sock, addr).start()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        srv.close()


if __name__ == "__main__":
    main()
