
/* Shared jam sessions.

   Everyone plays the same grid. Nobody streams audio — every browser synthesises its own
   sound from patterns and parameters, which are a few KB, so what crosses the wire is
   state. That is only possible because of the seam: nothing in this app says "change now",
   it says "change at boundary N", and each client works out when that is on its own. A
   message that takes 150 ms to arrive still lands on the same bar line for everyone, as
   long as it beats the boundary — the 200 ms scheduling lookahead is a jitter buffer this
   app already paid for.

   ---

   THE TRANSPORT IS PLUGGABLE, and this file must never know which one it has. Today it is
   a BroadcastChannel, which reaches other TABS on this machine and nothing else — that is
   not a toy, it is how the model gets tested with two real players before a server exists.
   A WebSocket adapter is the same four methods.

   A transport is: {send(msg), close(), onMessage(fn)}.

   ---

   EVERY MESSAGE CARRIES ITS SENDER, and you ignore your own. Applying a remote op also sets
   `applying`, because the models here are notification-based: scenes.store() tells its
   subscribers, this file is one of them, and without the guard every remote change would
   bounce straight back out. That is the same reason clock.setBpm() has always taken a
   `from`. */
Patchwork.session = (() => {
"use strict";

const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

let tx = null;                 // the transport, or null when playing alone
let room = null;
let applying = false;          // a remote op is being applied — do not echo it
let epoch = null;              // Date.now() of the session's beat 0
let problem = null;            // why the last join could not happen, in words
const peers = new Map();       // id -> {id, name, seen}
const owners = new Map();      // instrument id -> peer id

/* A peer id that survives nothing and needs to: it identifies this tab for the length of
   this session and no longer. */
const me = {id: Math.random().toString(36).slice(2, 10), name: ""};

/* ---- transports ----
   Two of them, same four methods, and nothing below this point knows which one it has.

   BroadcastChannel reaches other TABS on this machine and nothing else. It is not a
   fallback for the real one — it is how you jam with yourself, and how the model was
   proven with two clients before a server existed.

   The relay reaches other machines, and brings a clock with it. Which one you get is
   explicit, from `?relay=` in the URL: a silent fallback would let you set up a
   two-laptop test that quietly was not one. */
function broadcastChannel(name){
  if (typeof BroadcastChannel === "undefined") return null;
  const ch = new BroadcastChannel("patchwork-jam-" + name);
  return {
    kind: "this machine only",
    send: msg => ch.postMessage(msg),
    close: () => ch.close(),
    onMessage: fn => { ch.onmessage = e => fn(e.data); }
  };
}

/* ⚠️ A SOCKET OVER THE INTERNET WILL DROP, and on a LAN it essentially never did — which
   is why the first version of this had no reconnect and seemed fine. A phone locking, a
   laptop lid, a wifi handover, a tunnel restart and a deploy of the relay itself all close
   it, and without this the jam simply stopped: no error, no message, the head bar still
   reading like a live session while nothing crossed the wire. That is the worst failure
   this app can have, because it looks exactly like everybody else having stopped playing.

   So the socket is disposable and the TRANSPORT is not. `ws` is swapped underneath; `tx`
   never changes identity, and nothing above this point learns that the link went away and
   came back. */
function webSocket(url, name){
  let ws = null, handler = null, closed = false, tries = 0, timer = null, linked = false;
  const queue = [];

  function attach(sock){
    sock.addEventListener("open", () => {
      if (closed || ws !== sock) return;
      tries = 0;
      sock.send(JSON.stringify({kind: "join", room: name}));
      queue.splice(0).forEach(m => sock.send(m));
      /* ⚠️ Only on a RE-connect. The first hello is the one join() sent into the queue
         above; sending another here would have every peer answer a second identical
         welcome for no reason. On a reconnect the queue is empty by design (see send)
         and this is what re-announces us and pulls the room's state back. */
      if (linked) send("hello", {name: me.name});
      linked = true;
      syncTime();
      notify();
    });
    /* One path for both: a socket that fails to open fires error and then close. */
    sock.addEventListener("close", () => { if (ws === sock) retry(); });
    sock.addEventListener("error", () => { if (ws === sock) notify(); });
    sock.addEventListener("message", e => {
      let m; try{ m = JSON.parse(e.data); }catch(err){ return; }
      if (m.kind === "pong"){ takeSample(m); return; }
      if (m.kind === "joined"){ adoptEpoch(m.epoch); notify(); return; }
      if (handler) handler(m);
    });
  }

  function retry(){
    if (closed) return;
    notify();
    /* Backed off, and jittered: a relay deploy drops every socket in the room at the same
       instant, and an unjittered backoff would have them all come back in lockstep and do
       it again on the next failure. */
    const wait = Math.min(8000, 500 * Math.pow(2, tries++)) * (0.7 + Math.random() * 0.6);
    clearTimeout(timer);
    timer = setTimeout(dial, wait);
  }
  function dial(){
    if (closed) return;
    let sock;
    try{ sock = new WebSocket(url); }catch(e){ retry(); return; }
    ws = sock;
    attach(sock);
  }

  /* The first dial is synchronous so a URL the browser will not even construct — a typo, or
     the mixed-content block — is reported as a failed join rather than retried forever. */
  try{ ws = new WebSocket(url); }catch(e){ return null; }
  attach(ws);

  /* The browser knows before we do. Waiting out a backoff after the wifi is demonstrably
     back is several seconds of a jam that could already be running. */
  const wake = () => { if (!closed && (!ws || ws.readyState > 1)){ clearTimeout(timer); tries = 0; dial(); } };
  addEventListener("online", wake);

  return {
    kind: url.replace(/^wss?:\/\//, ""),
    send: msg => {
      const s2 = JSON.stringify(msg);
      if (ws && ws.readyState === 1){ ws.send(s2); return; }
      /* Queued only before the FIRST connection, which is the window join()'s hello lands
         in. Queuing through a reconnect would bank a poll's worth of stale state every
         220 ms for as long as the link was down and then flush all of it at once — and it
         would be pointless, because the hello above pulls the room's real state back. */
      if (!linked && queue.length < 32) queue.push(s2);
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      removeEventListener("online", wake);
      try{ if (ws) ws.close(); }catch(e){}
    },
    onMessage: fn => { handler = fn; },
    ping: () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({kind:"ping", t0: performance.now()})); },
    get ready(){ return !!ws && ws.readyState === 1; },
    /* So the head bar can tell "still trying to reach it" from "reached it once and lost
       it" — the first is usually a wrong address and the second is usually the network. */
    get state(){
      if (ws && ws.readyState === 1) return "open";
      return linked ? "retrying" : "connecting";
    }
  };
}

/* ---- the clock ----
   Two browsers have unrelated ctx.currentTime origins, so the session carries a shared
   epoch in the SERVER's milliseconds and each client maps it onto its own audio clock.

   ⚠️ Date.now() cannot be that shared clock across machines. Two laptops' system clocks
   are routinely seconds apart, which would put the grids seconds apart — the failure that
   sounds like the feature simply not working. Between tabs on one machine it is exact and
   free, so that is what BroadcastChannel sessions use; a relay session estimates its
   offset against the server instead.

   NTP's estimator, and its trick: over several round trips, keep the sample with the
   SMALLEST round trip rather than averaging. A fast exchange is one where little queueing
   happened in either direction, so its midpoint is closest to the truth; averaging drags
   the estimate toward whichever direction was more congested.

   ⚠️ This is the make-or-break part. Get it slightly wrong and it sounds NEARLY right,
   which is worse than obviously broken. */
let offsetMs = 0;          // serverNow() - performance.now()
let bestRtt = Infinity;
let synced = false;

function serverNow(){
  return tx && tx.ping ? performance.now() + offsetMs : Date.now();
}
function takeSample(m){
  const t1 = performance.now();
  const rtt = t1 - m.t0;
  if (!(rtt >= 0) || rtt > bestRtt) return;
  bestRtt = rtt;
  offsetMs = m.ts - (m.t0 + rtt / 2);
  synced = true;
  notify();
}
function syncTime(){
  if (!tx || !tx.ping) return;
  /* A burst to settle it, then a slow trickle: crystals drift, and a session that runs for
     an hour would otherwise be estimating from the first ten seconds of it. */
  let n = 0;
  const burst = setInterval(() => { if (!tx || !tx.ping || ++n > 8) clearInterval(burst); else tx.ping(); }, 120);
  clearInterval(trickle); trickle = setInterval(() => {
    if (!tx || !tx.ping){ clearInterval(trickle); return; }
    /* let a long-running estimate be revisited rather than frozen at whatever the first
       minute happened to look like */
    bestRtt *= 1.05;
    tx.ping();
  }, 5000);
}
let trickle = null;

function originFromEpoch(){
  if (epoch == null || !synced) return null;
  const ctx = Patchwork.audio && Patchwork.audio.ctx;
  if (!ctx) return null;
  return ctx.currentTime - (serverNow() - epoch) / 1000;
}
function adoptEpoch(ms){
  epoch = ms;
}
/* The clock asks for this the moment it would otherwise define a fresh grid. It cannot be
   pushed at join time: the mapping needs an AudioContext, and there is rarely one yet. */
Patchwork.clock.setOriginSource(() => (tx ? originFromEpoch() : null));

/* ---- patch parameters ----
   An instrument's SOUND, as opposed to its pattern. scenes.register() has always been
   explicit that a scene carries the pattern and not the sound — firing a row changes the
   line and leaves the filter you just dialled alone — so sharing the sound is a separate
   registration rather than a wider scene.

   ⚠️ POLLED, not pushed, and that is the whole design. A knob move is a pointermove per
   frame, so pushing would mean throttling every control on every instrument; and there is
   no single place a parameter changes — a fader, a segment, a MIDI CC, a patch load and a
   step's p-lock all write the same object. One snapshot compared against the last one sent
   catches every one of them, including the ones added later that nobody remembers to hook.

   The cost is up to one tick of latency on a knob, which does not matter: a filter sweep
   is not a note, and nothing here lands on a seam. */
const patchKit = [];             // {id, capture, apply}
const patchSeen = new Map();     // id -> the JSON last sent or received
function registerPatch(id, spec){
  if (!spec || !spec.capture || !spec.apply) return;
  patchKit.push({id, capture: spec.capture, apply: spec.apply});
}
function patchSnapshot(){
  const out = {};
  patchKit.forEach(it => { try{ out[it.id] = it.capture(); }catch(e){} });
  return out;
}
function applyPatch(id, params){
  const it = patchKit.find(x => x.id === id);
  if (!it) return;
  applying = true;
  try{ it.apply(params); }catch(e){}
  finally { applying = false; }
  /* remember what we just took, or the next poll sees a difference and sends it back */
  try{ patchSeen.set(id, JSON.stringify(it.capture())); }catch(e){}
}
function pollPatches(){
  if (!tx || applying) return;
  patchKit.forEach(it => {
    let snap;
    try{ snap = JSON.stringify(it.capture()); }catch(e){ return; }
    if (patchSeen.get(it.id) === snap) return;
    patchSeen.set(it.id, snap);
    send("patch", {inst: it.id, params: JSON.parse(snap)});
  });
}
/* ---- live patterns ----
   The same polling, for the same reasons, on the pattern an instrument is playing rather
   than the sound it is playing it with. A step grid has a dozen ways to change — a click, a
   drag, a held note, a lane, a p-lock, a recorded take — and pushing from each of them would
   be a dozen hooks that the next gesture forgets to add itself to. */
const patternSeen = new Map();
function patternSnapshot(){
  const out = {};
  Patchwork.scenes.instruments.forEach(i => {
    const p = Patchwork.scenes.livePattern(i.id);
    if (p) out[i.id] = p;
  });
  return out;
}
function pollPatterns(){
  if (!tx || applying) return;
  Patchwork.scenes.instruments.forEach(i => {
    let snap;
    try{ snap = JSON.stringify(Patchwork.scenes.livePattern(i.id)); }catch(e){ return; }
    if (snap == null || patternSeen.get(i.id) === snap) return;
    patternSeen.set(i.id, snap);
    send("pattern", {inst: i.id, pattern: JSON.parse(snap)});
  });
}
function takePattern(id, pat){
  applying = true;
  try{ Patchwork.scenes.setLivePattern(id, pat); } finally { applying = false; }
  /* remember what we took, or the next poll sends it straight back */
  try{ patternSeen.set(id, JSON.stringify(Patchwork.scenes.livePattern(id))); }catch(e){}
}

setInterval(() => { pollPatches(); pollPatterns(); }, 220);

/* ---- what a session shares ----
   The whole musical state, small enough to send entire on join. Patch parameters are NOT
   here yet: they are per-instrument and each one already knows how to serialise itself,
   so they are the next thing to add rather than a different problem. */
function snapshot(){
  return {
    epoch: epoch,
    bpm: Patchwork.clock.bpm,
    quantum: Patchwork.scenes.quantum,
    patternBars: Patchwork.scenes.patternBars,
    rows: Patchwork.scenes.rows.map(r => ({name: r.name, cells: r.cells})),
    patches: patchSnapshot(),
    patterns: patternSnapshot(),
    owners: [...owners]
  };
}
function applySnapshot(s){
  applying = true;
  try{
    if (s.epoch != null) adoptEpoch(s.epoch);
    if (s.bpm) Patchwork.clock.setBpm(s.bpm, "session");
    if (s.quantum) Patchwork.scenes.setQuantum(s.quantum);
    if (s.patternBars) Patchwork.scenes.setPatternBars(s.patternBars);
    if (s.rows) Patchwork.scenes.loadRows(s.rows);
    if (s.patterns) Object.keys(s.patterns).forEach(id => {
      Patchwork.scenes.setLivePattern(id, s.patterns[id]);
      try{ patternSeen.set(id, JSON.stringify(Patchwork.scenes.livePattern(id))); }catch(e){}
    });
    if (s.patches) Object.keys(s.patches).forEach(id => {
      const it = patchKit.find(x => x.id === id);
      if (!it) return;
      try{ it.apply(s.patches[id]); patchSeen.set(id, JSON.stringify(it.capture())); }catch(e){}
    });
    if (s.owners){ owners.clear(); s.owners.forEach(([k, v]) => owners.set(k, v)); }
  } finally { applying = false; }
  notify();
}

/* ---- sending ---- */
function send(kind, body){
  if (!tx || applying) return;
  tx.send(Object.assign({kind, from: me.id}, body));
}

/* Called by the models when something local changed. Deliberately a push from the shell's
   own notifications rather than a wrapper around every mutator: there is one place that
   knows the whole state, and re-sending it is cheap at this size. */
function pushScenes(){
  if (!tx || applying) return;
  send("rows", {rows: Patchwork.scenes.rows.map(r => ({name: r.name, cells: r.cells}))});
}
function pushTransport(){
  if (!tx || applying) return;
  send("transport", {bpm: Patchwork.clock.bpm,
                     quantum: Patchwork.scenes.quantum,
                     patternBars: Patchwork.scenes.patternBars});
}

/* ---- receiving ---- */
function onMessage(m){
  if (!m || m.from === me.id) return;         // never act on your own echo
  const p = peers.get(m.from) || {id: m.from, name: m.name || m.from.slice(0, 4)};
  p.seen = Date.now();
  if (m.name) p.name = m.name;
  peers.set(m.from, p);

  if (m.kind === "hello"){
    /* Whoever is already here answers with the state, so a joiner does not need a server
       to be told what is going on. Several answers are harmless: they are identical. */
    send("welcome", {to: m.from, name: me.name, state: snapshot()});
    notify();
    return;
  }
  if (m.kind === "welcome"){
    if (m.to === me.id && m.state) applySnapshot(m.state);
    notify();
    return;
  }
  if (m.kind === "rows"){
    applying = true;
    try{ Patchwork.scenes.loadRows(m.rows); } finally { applying = false; }
    notify();
    return;
  }
  if (m.kind === "transport"){
    applying = true;
    try{
      if (m.bpm) Patchwork.clock.setBpm(m.bpm, "session");
      if (m.quantum) Patchwork.scenes.setQuantum(m.quantum);
      if (m.patternBars) Patchwork.scenes.setPatternBars(m.patternBars);
    } finally { applying = false; }
    notify();
    return;
  }
  if (m.kind === "fire"){
    /* A row fired by someone else lands on the seam here too, because the seam is computed
       locally from the shared origin rather than signalled. The message only has to arrive
       before the boundary, not at it. */
    applying = true;
    try{ Patchwork.launch ? Patchwork.launch.fireRow(m.row) : Patchwork.scenes.fire(m.row); }
    finally { applying = false; }
    notify();
    return;
  }
  if (m.kind === "patch"){
    applyPatch(m.inst, m.params);
    return;                                   // no notify: a knob move is not a roster change
  }
  if (m.kind === "pattern"){
    takePattern(m.inst, m.pattern);
    return;                                   // nor is a step
  }
  if (m.kind === "note"){
    takeNote(m);
    return;                                   // nor, most of all, is a note
  }
  if (m.kind === "take"){
    takeTake(m);
    return;
  }
  if (m.kind === "talk"){
    if (Patchwork.talk) Patchwork.talk.heard(m.from, m.d);
    return;                                   // a voice is not a roster change either
  }
  if (m.kind === "own"){
    if (m.owner) owners.set(m.inst, m.owner); else owners.delete(m.inst);
    notify();
    return;
  }
  if (m.kind === "bye"){
    if (Patchwork.talk) Patchwork.talk.forget(m.from);
    peers.delete(m.from);
    owners.forEach((v, k) => { if (v === m.from) owners.delete(k); });
    notify();
    return;
  }
  notify();
}

/* ---- where the relay is ----
   With no `?relay=` at all you get HOME_RELAY, the one this build ships with, so the
   deployed link works for whoever opens it without anybody having to know a query string
   exists. `?relay=` is for everything else, in whatever form is least likely to be mistyped:

     (nothing)                 the relay this build ships with   <- the deployed site
     ?relay                    this host, port 8124              <- two laptops on a LAN
     ?relay=9000               this host, that port
     ?relay=192.168.68.51      that host, port 8124
     ?relay=ws://host:9000     spelled out in full
     ?relay=off                no relay: other tabs on this machine, and nothing else

   ⚠️ The bare form exists because retyping an IP address twice in one URL is a trap. It
   cost a real two-laptop test: the page half was right, the relay half said 192.168.1.51
   for 192.168.68.51, so the studio loaded perfectly and the socket could not connect —
   which looks like the jam being broken rather than a typo. If you are serving the page
   from the same machine as the relay, and you almost always are, `?relay` alone is right
   and cannot be got wrong. */
/* ⚠️ A page served over HTTPS cannot open a ws:// socket. The browser blocks it as mixed
   content, silently as far as the page is concerned — the socket simply never opens and the
   head bar sits on "connecting…" forever, which reads as the relay being down rather than
   as the one thing it is.

   It bit the moment this went up on Netlify: the studio was https, the relay on a laptop was
   ws, and there is no combination of those two that a browser will allow. A relay reachable
   from an https page needs TLS, which in practice means a tunnel (`cloudflared tunnel --url
   http://localhost:8124` hands you a wss:// address) or hosting it somewhere that terminates
   TLS for you. */
function relayProblem(url){
  if (!url) return null;
  if (location.protocol === "https:" && /^ws:\/\//i.test(url))
    return "this page is https, so it cannot reach a ws:// relay — it needs a wss:// address";
  return null;
}

/* ---- the relay this build ships with ----
   ⚠️ SET THIS TO THE DEPLOYED WORKER, as wss://. It is the difference between a link you
   can hand somebody and a link that quietly puts each visitor in a jam of their own.

   Until it is set, a page with no `?relay=` falls back to BroadcastChannel — which reaches
   other TABS on that machine and nothing else. That is the right thing locally and exactly
   the wrong thing on the deployed site, where it means two people on one link each get a
   private room, both see "waiting for someone to join", and nothing on screen is wrong
   enough to explain it. That was the bug this whole relay exists to fix.

   Hard-coded rather than fetched, because the build is a pure join of src/ with no
   substitution step — see tools/build.py. Changing it means a rebuild and a deploy of the
   studio, which is the honest cost of the rule that every shipped line lives in exactly
   one fragment. `relay/wrangler.toml` prints the URL to put here. */
const HOME_RELAY = "wss://harvest-jam-relay.tmorton-e18.workers.dev";

function relayFromUrl(){
  const raw = new URLSearchParams(location.search).get("relay");
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  if (raw == null) return HOME_RELAY || null;
  const v = String(raw).trim();
  /* An explicit way back to the same-machine transport, for testing the model with two
     tabs now that the networked one is what you get by default. */
  if (/^(off|none|0|no|solo|local)$/i.test(v)) return null;
  if (v === "" || v === "1" || v === "true") return proto + location.hostname + ":8124";
  if (/^[0-9]+$/.test(v)) return proto + location.hostname + ":" + v;
  if (/^wss?:\/\//.test(v)) return v;
  return proto + (v.indexOf(":") >= 0 ? v : v + ":8124");
}

/* ---- who is jamming ----
   So a jam can be PICKED rather than named from memory. Typing the same string on two
   machines is the single most likely way to end up in two empty rooms wondering why the
   other person cannot see you.

   Both transports can answer it, differently. The relay knows its rooms and is asked. A
   BroadcastChannel has no server, so the sessions answer for themselves on a shared lobby
   channel — a question goes out, whoever is in a jam says which one, and the replies are
   collected for a moment. */
const LOBBY = "patchwork-jam-lobby";
let lobby = null;
function openLobby(){
  if (lobby || typeof BroadcastChannel === "undefined") return;
  lobby = new BroadcastChannel(LOBBY);
  lobby.onmessage = e => {
    /* answer for the jam this tab is in, if any */
    if (e.data && e.data.q && tx && !tx.ping && room)
      lobby.postMessage({room, peer: me.id});
  };
}
openLobby();

function browse(cb){
  const relay = relayFromUrl();
  if (relay){
    const bad = relayProblem(relay);
    if (bad){ cb(null, bad); return; }
    /* a throwaway connection: ask, answer, close. Asking on the live one would mean being
       joined before you had chosen. */
    let ws;
    try{ ws = new WebSocket(relay); }catch(e){ cb(null, "cannot reach " + relay); return; }
    const done = err => { try{ ws.close(); }catch(e){} };
    const timer = setTimeout(() => { done(); cb(null, "no answer from " + relay); }, 4000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({kind: "rooms"})));
    ws.addEventListener("error", () => { clearTimeout(timer); done(); cb(null, "cannot reach " + relay); });
    ws.addEventListener("message", e => {
      let m; try{ m = JSON.parse(e.data); }catch(err){ return; }
      if (m.kind !== "rooms") return;
      clearTimeout(timer); done();
      cb(m.rooms || []);
    });
    return;
  }
  if (!lobby){ cb([]); return; }
  const seen = new Map();
  const listen = e => {
    if (!e.data || !e.data.room) return;
    const r = seen.get(e.data.room) || {name: e.data.room, peers: 0};
    r.peers++;
    seen.set(e.data.room, r);
  };
  lobby.addEventListener("message", listen);
  lobby.postMessage({q: 1});
  setTimeout(() => {
    lobby.removeEventListener("message", listen);
    cb([...seen.values()].sort((a, b) => a.name < b.name ? -1 : 1));
  }, 350);
}

/* ---- joining and leaving ---- */
function join(name, who){
  leave();
  room = String(name || "jam").trim().toLowerCase();
  me.name = String(who || "").trim() || ("player " + me.id.slice(0, 3));
  /* `?relay` picks the networked transport. Explicit on purpose — a silent fallback would
     let you set up a two-laptop test that quietly was not one. */
  const relay = relayFromUrl();
  problem = relayProblem(relay);
  if (problem){ room = null; notify(); return false; }
  tx = relay ? webSocket(relay, room) : broadcastChannel(room);
  if (!tx){ room = null; notify(); return false; }
  tx.onMessage(onMessage);
  offsetMs = 0; bestRtt = Infinity; synced = !tx.ping;
  /* seed the poll with what everything currently sounds like, so joining does not
     immediately broadcast six unchanged patches */
  patchKit.forEach(it => { try{ patchSeen.set(it.id, JSON.stringify(it.capture())); }catch(e){} });
  Patchwork.scenes.instruments.forEach(i => {
    try{ patternSeen.set(i.id, JSON.stringify(Patchwork.scenes.livePattern(i.id))); }catch(e){}
  });
  /* ⚠️ Only a BroadcastChannel session stamps its own beat 0, and only because two tabs
     share one Date.now() exactly. A relay session waits to be told: at this moment the
     offset has not been measured, so any number produced here would be in this tab's
     performance.now() base and would mean nothing to the other end. */
  if (!tx.ping && epoch == null) adoptEpoch(Date.now());
  send("hello", {name: me.name});
  notify();
  return true;
}
function leave(){
  if (Patchwork.talk && Patchwork.talk.on) Patchwork.talk.stop();
  if (tx){ send("bye", {}); tx.close(); }
  clearInterval(trickle); trickle = null;
  tx = null; room = null; epoch = null; problem = null;
  offsetMs = 0; bestRtt = Infinity; synced = false;
  peers.clear(); owners.clear();
  notify();
}

/* ---- live notes ----
   The one thing here that is NOT state. A pattern, a patch and a block are all "what is
   true now" and can be polled; a note is an event, and an event that arrives late is
   simply a late note.

   Sent the moment it is played and played the moment it arrives. No seam, deliberately:
   a seam is what you want for a change of MATERIAL, and exactly what you do not want for
   somebody's fingers. On a LAN that is a millisecond or two and genuinely playable. Over a
   long link it will not be, and the honest fix there is Ninjam's — put everyone a bar
   behind, which this codebase could do because every event already carries a musical
   position. That is a decision about the room, not about this file.

   ⚠️ `applying` is set around the local playback of a remote note. VC·1 and PM·1 route
   their sequencers through the same noteOn() a person uses, so without the guard a note
   arriving here would be broadcast straight back out. */
const voiceKit = [];             // {id, on, off}
function registerVoice(id, spec){
  if (!spec || !spec.on) return;
  voiceKit.push({id, on: spec.on, off: spec.off || function(){}});
}
function played(id, note, vel, isOn){
  if (!tx || applying) return;
  send("note", {inst: id, n: note, v: vel, on: !!isOn});
}
function takeNote(m){
  const it = voiceKit.find(x => x.id === m.inst);
  if (!it) return;
  applying = true;
  try{ if (m.on) it.on(m.n, m.v == null ? 100 : m.v); else it.off(m.n); }
  catch(e){}
  finally { applying = false; }
}

/* ---- pushing a take ----
   The looper works exactly as it does alone: you record, you listen, you re-record. Nobody
   else hears any of it until you push it. That is deliberate and it is the whole shape of
   the feature — a take you are not sure about should not be everybody's problem, and a
   looper you cannot experiment on in company is a looper you will not use in company.

   ⚠️ In a session the looper must record its INPUT and not the studio bus. Locally the bus
   is the useful source: capture what the band just played, then overdub. In a session your
   render of the bus already contains everybody's parts, so pushing it would have the room
   hear the band twice — once live and once printed, and doubled again by the first overdub.
   The exclusion the bus tap already does for one strip has to be the whole idea: what
   travels as audio is what has no pattern. See setInput() in lp1's engine.

   It is a REQUEST, not a broadcast of state: the take is not polled, has no "current" value
   worth reconciling, and a second push of the same slot simply replaces it. */
let pushing = false;
async function pushTake(slot){
  const t = Patchwork.record.track("lp1");
  if (!tx || !t || !t.grabTake || pushing) return {ok: false, why: "not in a jam"};
  pushing = true;
  try{
    const chans = await t.grabTake(slot);
    if (!chans) return {ok: false, why: "that take is empty"};
    const rate = t.sampleRate ? t.sampleRate() : 48000;
    const packed = await Patchwork.codec.encode(chans, rate);
    /* ⚠️ ONE MEBIBYTE IS THE CEILING on a WebSocket message through the hosted relay, and
       going over it does not drop the message — Cloudflare closes the socket with 1009.
       So the failure mode without this check is not "the take did not arrive", it is
       "pushing a long take ends the jam", and the reconnect above would paper over it just
       well enough to make it hard to find.

       Opus is nowhere near it (~50 KB for two bars, ~67 KB once base64 has taken its
       third). The PCM fallback is, and it is the path a browser without WebCodecs takes —
       so this is the browser-dependent bug that does not reproduce on the machine you
       wrote it on. Said in terms of what to do about it rather than in bytes. */
    if (packed.data.length > 900000)
      return {ok: false, why: "that take is too long to send" +
        (packed.kind === "pcm" ? " — this browser has no Opus encoder, so takes have to be short"
                               : "") + ". Push a shorter one."};
    /* the length and the tempo travel with it, because the receiver may have no bank yet */
    send("take", {slot: slot | 0, take: packed, meta: t.takeMeta ? t.takeMeta() : null});
    return {ok: true, kind: packed.kind, bytes: packed.data.length};
  } finally { pushing = false; }
}
async function takeTake(m){
  const t = Patchwork.record.track("lp1");
  if (!t || !t.loadTake || !m.take) return;
  const chans = await Patchwork.codec.decode(m.take);
  if (!chans) return;
  t.loadTake(m.slot, chans, m.meta);
  notify();
}

/* ---- the owner label ----
   Injected into each plate, the way faces.js does the Panel button and record.js the Arm —
   one implementation, and an instrument added later gets it without being told to.

   It is only visible in a jam, because outside one there is nobody to be told. Claiming
   does not lock anyone out; it says who is holding an instrument, which is most of the
   value and all that can honestly be offered without a server to arbitrate it. What it
   really prevents is two people editing the same step grid and each wondering why their
   changes keep reverting — the patterns are last-writer-wins, so knowing whose hands are
   on which panel IS the mechanism. */
function mountOwners(){
  Patchwork.roots.forEach(root => {
    if (root.querySelector(".owner-tag")) return;
    const plate = root.querySelector(".plate");
    if (!plate) return;
    const b = document.createElement("button");
    b.className = "btn ghost sm owner-tag";
    b.type = "button";
    b.dataset.inst = root.dataset.instrument;
    b.hidden = true;
    b.addEventListener("click", () => {
      const id = b.dataset.inst;
      if (owners.get(id) === me.id) release(id); else claim(id);
    });
    const screws = plate.querySelector(".screws");
    if (screws) plate.insertBefore(b, screws); else plate.appendChild(b);
  });
  paintOwners();
}
function paintOwners(){
  Patchwork.roots.forEach(root => {
    const b = root.querySelector(".owner-tag");
    if (!b) return;
    b.hidden = !tx;
    if (!tx) return;
    const id = b.dataset.inst, holder = owners.get(id);
    const mine = holder === me.id;
    b.classList.toggle("mine", mine);
    b.classList.toggle("theirs", !!holder && !mine);
    b.textContent = holder ? (mine ? "You" : (ownerName(id) || "someone")) : "Free";
    b.title = holder
      ? (mine ? "You are holding this — click to let it go"
              : (ownerName(id) || "someone") + " is holding this. Click to take it over.")
      : "Nobody is holding this — click to take it";
  });
}
subs.push(paintOwners);

/* ---- ownership ----
   Advisory, and deliberately so for now: it says who is holding an instrument, it does not
   lock anyone out. A lock needs an authority to arbitrate it, and there is no server yet —
   two people claiming at once would just disagree. Showing it is most of the value. */
function claim(inst){
  owners.set(inst, me.id);
  send("own", {inst, owner: me.id});
  notify();
}
function release(inst){
  owners.delete(inst);
  send("own", {inst, owner: null});
  notify();
}
function ownerName(inst){
  const id = owners.get(inst);
  if (!id) return null;
  if (id === me.id) return me.name;
  const p = peers.get(id);
  return p ? p.name : "someone";
}

/* Local changes go out. Subscribing to the models rather than wrapping their mutators
   means a call site added later is shared without being told to. */
Patchwork.scenes.onChange(pushScenes);
Patchwork.clock.onTempo("session", pushTransport, null);

return {join, leave, browse, claim, release, ownerName, registerPatch, mountOwners,
        registerVoice, played, pushTake,
        talk: (d, n) => send("talk", {d, n}),
        onChange: fn => subs.push(fn),
        fired: row => send("fire", {row}),
        get active(){ return !!tx; },
        get room(){ return room; },
        /* what the head bar tells you about the connection, so a two-laptop test that is
           quietly two tabs is visible rather than mysterious */
        get via(){ return tx ? tx.kind : null; },
        get problem(){ return problem; },
        get linked(){ return !!tx && (tx.ready === undefined || tx.ready); },
        /* "open" | "connecting" | "retrying" — a relay that was never reached is usually a
           wrong address, one that was reached and lost is usually the network, and reading
           the same "connecting…" for both sent a real debugging session down the wrong path. */
        get link(){ return tx ? (tx.state || "open") : null; },
        get clock(){ return {synced, offsetMs: Math.round(offsetMs), rttMs: bestRtt === Infinity ? null : Math.round(bestRtt)}; },
        get me(){ return {id: me.id, name: me.name}; },
        get owners(){ return new Map(owners); },
        get peers(){ return [...peers.values()].map(p => ({id: p.id, name: p.name})); }};
})();
