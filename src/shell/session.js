
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

/* ---- transports ---- */
function broadcastChannel(name){
  if (typeof BroadcastChannel === "undefined") return null;
  const ch = new BroadcastChannel("patchwork-jam-" + name);
  return {
    send: msg => ch.postMessage(msg),
    close: () => ch.close(),
    onMessage: fn => { ch.onmessage = e => fn(e.data); }
  };
}

/* ---- the clock ----
   Two browsers have unrelated ctx.currentTime origins, so the session carries a shared
   WALL-CLOCK epoch and each client maps it onto its own audio clock. Date.now() is the
   only clock two tabs already agree on; a real session would take the epoch from the
   server and estimate the offset, which is the same arithmetic with a correction term.

   ⚠️ This is the make-or-break part. Get it slightly wrong and it sounds NEARLY right,
   which is worse than obviously broken. */
function originFromEpoch(){
  if (epoch == null) return null;
  const ctx = Patchwork.audio && Patchwork.audio.ctx;
  if (!ctx) return null;
  return ctx.currentTime - (Date.now() - epoch) / 1000;
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

/* ---- joining and leaving ---- */
function join(name, who){
  leave();
  room = String(name || "jam").trim().toLowerCase();
  me.name = String(who || "").trim() || ("player " + me.id.slice(0, 3));
  tx = broadcastChannel(room);
  if (!tx){ room = null; notify(); return false; }
  tx.onMessage(onMessage);
  /* The first one in defines the grid. Anyone already here overrides it in their welcome. */
  if (epoch == null) adoptEpoch(Date.now());
  send("hello", {name: me.name});
  notify();
  return true;
}
function leave(){
  if (tx){ send("bye", {}); tx.close(); }
  tx = null; room = null; epoch = null;
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

return {join, leave, claim, release, ownerName, onChange: fn => subs.push(fn),
        fired: row => send("fire", {row}),
        get active(){ return !!tx; },
        get room(){ return room; },
        get me(){ return {id: me.id, name: me.name}; },
        get owners(){ return new Map(owners); },
        get peers(){ return [...peers.values()].map(p => ({id: p.id, name: p.name})); }};
})();
