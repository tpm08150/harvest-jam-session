
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
    kind: "this machine",
    send: msg => ch.postMessage(msg),
    close: () => ch.close(),
    onMessage: fn => { ch.onmessage = e => fn(e.data); }
  };
}

function webSocket(url, name){
  let ws, handler = null, closed = false;
  const queue = [];
  try{ ws = new WebSocket(url); }catch(e){ return null; }

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({kind: "join", room: name}));
    queue.splice(0).forEach(m => ws.send(m));
    syncTime();
    notify();
  });
  ws.addEventListener("close", () => { if (!closed) notify(); });
  ws.addEventListener("error", () => notify());
  ws.addEventListener("message", e => {
    let m; try{ m = JSON.parse(e.data); }catch(err){ return; }
    if (m.kind === "pong"){ takeSample(m); return; }
    if (m.kind === "joined"){ adoptEpoch(m.epoch); notify(); return; }
    if (handler) handler(m);
  });

  return {
    kind: url.replace(/^wss?:\/\//, ""),
    send: msg => {
      const s2 = JSON.stringify(msg);
      if (ws.readyState === 1) ws.send(s2); else if (ws.readyState === 0) queue.push(s2);
    },
    close: () => { closed = true; try{ ws.close(); }catch(e){} },
    onMessage: fn => { handler = fn; },
    ping: () => { if (ws.readyState === 1) ws.send(JSON.stringify({kind:"ping", t0: performance.now()})); },
    get ready(){ return ws.readyState === 1; }
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
  if (m.kind === "own"){
    if (m.owner) owners.set(m.inst, m.owner); else owners.delete(m.inst);
    notify();
    return;
  }
  if (m.kind === "bye"){
    peers.delete(m.from);
    owners.forEach((v, k) => { if (v === m.from) owners.delete(k); });
    notify();
    return;
  }
  notify();
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
  const relay = new URLSearchParams(location.search).get("relay");
  if (relay){
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
  /* `?relay=ws://host:port` picks the networked transport. Explicit on purpose. */
  const relay = new URLSearchParams(location.search).get("relay");
  tx = relay ? webSocket(relay, room) : broadcastChannel(room);
  if (!tx){ room = null; notify(); return false; }
  tx.onMessage(onMessage);
  offsetMs = 0; bestRtt = Infinity; synced = !tx.ping;
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
  if (tx){ send("bye", {}); tx.close(); }
  clearInterval(trickle); trickle = null;
  tx = null; room = null; epoch = null;
  offsetMs = 0; bestRtt = Infinity; synced = false;
  peers.clear(); owners.clear();
  notify();
}

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

return {join, leave, browse, claim, release, ownerName, onChange: fn => subs.push(fn),
        fired: row => send("fire", {row}),
        get active(){ return !!tx; },
        get room(){ return room; },
        /* what the head bar tells you about the connection, so a two-laptop test that is
           quietly two tabs is visible rather than mysterious */
        get via(){ return tx ? tx.kind : null; },
        get linked(){ return !!tx && (tx.ready === undefined || tx.ready); },
        get clock(){ return {synced, offsetMs: Math.round(offsetMs), rttMs: bestRtt === Infinity ? null : Math.round(bestRtt)}; },
        get me(){ return {id: me.id, name: me.name}; },
        get owners(){ return new Map(owners); },
        get peers(){ return [...peers.values()].map(p => ({id: p.id, name: p.name})); }};
})();
