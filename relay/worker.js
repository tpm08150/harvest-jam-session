/* The jam relay, with a home.

   This is `tools/jam-relay.py` as a Cloudflare Worker, and it exists for one reason: an
   https page cannot open a ws:// socket. The studio is served from Netlify over TLS, so a
   relay it can reach has to terminate TLS too, and Netlify serves static files only. A
   laptop behind `cloudflared` works and is what the two-machine tests used, but it is a
   URL that changes every restart and a laptop that has to stay awake — which is not a link
   you can hand somebody.

   THE PROTOCOL IS THE PYTHON FILE'S, EXACTLY. Same three server-owned kinds, same shapes,
   same forward-everything-else rule:

       {"kind":"join","room":"..."}   put this connection in a room
       {"kind":"ping","t0":<num>}     answered with {"kind":"pong","t0":...,"ts":...}
       {"kind":"rooms"}               answered with the rooms that currently have anyone in

   ⚠️ There are two implementations of this relay and they must not drift. The Python one
   is not legacy — it is the one you run for two laptops on a LAN with no internet, and it
   needs no account, no login and no deploy. This one is the one the deployed site talks
   to. If you change the protocol, change both; the clients cannot tell them apart and that
   is the point.

   WHAT THE REWRITE ACTUALLY REMOVED. The Python file hand-rolls the WebSocket handshake
   (one SHA-1) and the frame codec (mask, length, opcodes) because its rule is stdlib-only.
   Workers does all of that for you, so what is left here is just the relay: about sixty
   lines of protocol against two hundred of protocol-plus-plumbing. Nothing about the
   MEANING changed.

   ---

   ONE DURABLE OBJECT, HOLDING EVERY ROOM. The obvious Workers design is one object per
   room — it is what Durable Objects are for, and it would let two rooms live on two
   continents. This does not do that, because of `rooms`: a listing has to be answered by
   something that knows every room, and one-object-per-room means no such thing exists
   without adding a registry object for rooms to check in and out of, plus the
   eventual-consistency questions that come with it. A single object is the honest
   translation of the single Python process, answers `rooms` by looking at what it is
   holding, and is single-threaded so no room can be created twice. The ceiling is roughly
   32k sockets on one object, which this will not meet.

   ⚠️ HIBERNATION MEANS THIS CLASS'S MEMORY IS NOT DURABLE. `acceptWebSocket` (rather than
   `accept`) lets the runtime evict the object between messages while the sockets stay
   open — that is what makes an idle jam free rather than billed for the hour nobody
   played. The cost is that the constructor may run again at any time with every field
   back at its initial value, so NOTHING may live in `this`. Room membership is derived
   from the sockets themselves, each carrying its room in an attachment; a room's beat 0
   lives in storage. Both survive an eviction. A `rooms = new Map()` up here would work
   perfectly in testing and then quietly empty itself in production the first time a jam
   went quiet for a moment. */

const MAX_ROOM = 64;          // room names, trimmed to something a head bar can print
const MAX_NAME_ROOMS = 200;   // ceiling on a `rooms` listing, so it cannot be a payload

/* Every socket carries its own membership, because the object holding them may be evicted
   from memory at any moment and rebuilt with nothing in it. `serializeAttachment` is the
   one piece of per-connection state that survives that. */
function attached(ws){
  try{ return ws.deserializeAttachment() || {}; }catch(e){ return {}; }
}
function attach(ws, next){
  try{ ws.serializeAttachment(next); }catch(e){}
}

export class Relay {
  constructor(ctx, env){
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request){
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    /* accept, NOT server.accept() — see the hibernation warning above */
    this.ctx.acceptWebSocket(server);
    attach(server, {room: null});
    return new Response(null, {status: 101, webSocket: client});
  }

  /* ---- the loop ----
     One message, and the same three questions the Python `handle()` asks in the same
     order. Everything it does not recognise is somebody else's business and goes out
     untouched — the relay has never inspected a payload beyond its `kind` and must not
     start, or it becomes a second implementation of the music with its own opinions. */
  async webSocketMessage(ws, data){
    const raw = typeof data === "string" ? data : new TextDecoder().decode(data);
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){ return; }
    if (!msg || typeof msg !== "object") return;

    if (msg.kind === "ping"){
      /* ⚠️ TIME IS THE POINT OF HAVING A SERVER AT ALL, and Workers' Date.now() has a
         quirk worth knowing before you trust it: it does not advance during synchronous
         execution. It returns the time of the last I/O, which inside this handler is the
         moment this ping arrived. That is not a problem here, it is the ideal stamp — the
         Python relay stamps as late as it can specifically to keep its own handling time
         out of the client's round-trip estimate, and this gets that for free. It would be
         a problem if anything were awaited above this line, so nothing is. */
      ws.send(JSON.stringify({kind: "pong", t0: msg.t0, ts: Date.now()}));
      return;
    }

    if (msg.kind === "rooms"){
      /* Asked before joining anything, which is why it is answered on any connection.
         Counted from the sockets rather than from a table, because the sockets are the
         only membership record that survives an eviction. */
      const counts = new Map();
      for (const peer of this.ctx.getWebSockets()){
        const room = attached(peer).room;
        if (room) counts.set(room, (counts.get(room) || 0) + 1);
      }
      const rooms = [...counts.entries()]
        .map(([name, peers]) => ({name, peers}))
        .sort((a, b) => a.name < b.name ? -1 : 1)
        .slice(0, MAX_NAME_ROOMS);
      ws.send(JSON.stringify({kind: "rooms", rooms}));
      return;
    }

    if (msg.kind === "join"){
      const was = attached(ws).room;
      const room = String(msg.room || "jam").slice(0, MAX_ROOM);
      attach(ws, {room});
      if (was && was !== room) await this.forgetIfEmpty(was);
      /* ⚠️ The ROOM's beat 0, stamped here and never by a client. A client cannot stamp
         it: at join time it has not measured its clock offset yet, so the number it would
         produce is in its own performance.now() base and means nothing to anybody else.
         Every joiner is told the same value in the same clock the pongs are in, which is
         the whole reason this process keeps time.

         In storage rather than in a field, because a field would not survive the object
         being evicted while the jam was quiet — and the symptom of losing it is the grid
         jumping under everyone already playing. */
      const key = "epoch:" + room;
      let epoch = await this.ctx.storage.get(key);
      if (epoch == null){
        epoch = Date.now();
        await this.ctx.storage.put(key, epoch);
      }
      ws.send(JSON.stringify({kind: "joined", room, ts: Date.now(),
                              epoch, peers: this.size(room) - 1}));
      return;
    }

    /* Anything else is the clients' business, forwarded verbatim. */
    this.broadcast(ws, raw);
  }

  async webSocketClose(ws){ await this.gone(ws); }
  async webSocketError(ws){ await this.gone(ws); }

  async gone(ws){
    const room = attached(ws).room;
    attach(ws, {room: null});
    if (room) await this.forgetIfEmpty(room);
  }

  /* The room is gone, so its grid is too — the next one starts fresh. Matches the Python
     relay's leave(), and matters more here: storage persists across evictions, so an epoch
     nobody deleted would outlive the jam that defined it and hand a stale beat 0 to a jam
     that reused the name a week later. */
  async forgetIfEmpty(room){
    if (this.size(room) === 0) await this.ctx.storage.delete("epoch:" + room);
  }

  size(room){
    let n = 0;
    for (const peer of this.ctx.getWebSockets())
      if (attached(peer).room === room) n++;
    return n;
  }

  broadcast(sender, raw){
    const room = attached(sender).room;
    if (!room) return;
    for (const peer of this.ctx.getWebSockets()){
      if (peer === sender) continue;
      if (attached(peer).room !== room) continue;
      try{ peer.send(raw); }catch(e){}
    }
  }
}

/* ---- the front door ----
   A WebSocket upgrade goes to the one object. Anything else is a person or a monitor
   who has pasted the URL into a browser, and gets told what this is rather than a 426 —
   the first thing you do after deploying is open the URL, and a blank error page is a
   poor way to find out the deploy worked. */
export default {
  async fetch(request, env){
    if (/websocket/i.test(request.headers.get("Upgrade") || ""))
      return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(request);
    return new Response(
      "Harvest Jam relay.\n\n" +
      "This is a WebSocket relay for shared jam sessions, not a page. It carries patterns,\n" +
      "patches, notes and the session clock between browsers running the studio.\n\n" +
      "Open the studio instead: https://harvest-jam.netlify.app\n",
      {headers: {"content-type": "text/plain; charset=utf-8",
                 "access-control-allow-origin": "*"}});
  }
};
