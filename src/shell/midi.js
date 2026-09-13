
/* One MIDI router for the page.

   `port.onmidimessage` is a single-handler PROPERTY, not an event target. Two
   instruments each assigning it means the second silently replaces the first, so on a
   page with both, whichever bound last received everything and the other was deaf —
   with no error and nothing in the console to suggest it.

   The router binds once and fans out. Channel routing does not move here: each
   instrument already filters by channel on the way in, and that is where it belongs —
   MS·1 splits synth, vocoder, bass and CC across four channels of its own, which is not
   something a shared router should have opinions about.

   The input port is the page's, like the tempo. Selecting one on either panel binds it
   for everything, and every panel's selector follows. */
Patchwork.midi = (() => {
"use strict";

let accessPromise = null, access = null, port = null, sysex = false;
const subs = [];                 // {id, onMidi, onPort, spec}
const watchers = [];             // UI that wants to know when any of this changed
function notify(){ watchers.forEach(fn => { try{ fn(); }catch(e){} }); }

/* ---- claimed ports ----
   A control surface is not an instrument on the page's input; it is a second cable, and
   both ends of it are its own. A Launchkey puts its keys on one USB port and its pads,
   pots and transport on another, so `port` (the page's performance input) and the DAW
   port are two different devices as far as Web MIDI is concerned.

   ⚠️ THE SHELL STILL OWNS EVERY `onmidimessage`. That property is the reason this module
   exists — two assignments and the first one silently stops receiving. A claim is a way
   to ask the shell to bind a port on your behalf, NOT a licence to bind it yourself. */
const claims = new Map();        // portId -> handler

/* One requestMIDIAccess for the page — two calls mean two permission paths and two
   onstatechange owners racing to rebuild the same port lists.

   ⚠️ SYSEX IS A DIFFERENT PERMISSION, and a scarier-sounding one: Chrome asks to "control
   your MIDI devices" rather than to use them. Asking every visitor for it so that the one
   with a Launchkey can have a screen readout is the wrong trade, so the default is off and
   the answer is remembered. `upgrade()` below is what a deliberate click runs. */
const SYSEX_KEY = "patchwork-midi-sysex";
function wantSysex(){
  try{ return localStorage.getItem(SYSEX_KEY) === "1"; }catch(e){ return false; }
}
function bindAccess(a, withSysex){
  access = a; sysex = !!withSysex;
  a.onstatechange = () => {
    /* A port can vanish while bound — unplugging the interface. Drop the stale
       reference before telling anyone, or every subscriber re-reads a dead port. */
    if (port && !ports("inputs").some(p => p.id === port.id)) port = null;
    /* A claimed port can vanish the same way, and its handler is the one thing that will
       never hear about it from a subscriber callback. */
    Array.from(claims.keys()).forEach(id => {
      if (!ports("inputs").some(p => p.id === id)) claims.delete(id);
    });
    /* the output can vanish the same way an input can, and a remembered one can APPEAR —
       a box that boots before its interface is awake has to pick it up when it arrives */
    bindOut();
    subs.forEach(s => { try{ s.onPort(port); }catch(e){} });
    notify();
  };
  bindOut();
  return a;
}
function open(){
  if (accessPromise) return accessPromise;
  if (!navigator.requestMIDIAccess)
    return accessPromise = Promise.reject(new Error("unavailable"));
  const ask = wantSysex();
  accessPromise = navigator.requestMIDIAccess({sysex:ask})
    .then(a => bindAccess(a, ask))
    /* Remembering the answer means remembering a "yes" that has since been revoked in the
       browser's own site settings. Fall back rather than leaving the page with no MIDI at
       all — everything except the screen still works without it. */
    .catch(err => {
      if (!ask) throw err;
      return navigator.requestMIDIAccess({sysex:false}).then(a => bindAccess(a, false));
    });
  return accessPromise;
}

/* Ask for SysEx now, from a click. Resolves true if the page holds it afterwards.

   ⚠️ A SECOND requestMIDIAccess RETURNS A DIFFERENT ACCESS OBJECT with a different set of
   port objects, so every binding made against the old one is dead. Port *ids* are stable
   per origin, which is what makes re-selecting the same input and re-claiming the same
   surface port possible at all — so both are re-applied by id here rather than left for
   the caller to notice going quiet. */
function upgrade(){
  if (sysex) return Promise.resolve(true);
  if (!navigator.requestMIDIAccess) return Promise.resolve(false);
  return navigator.requestMIDIAccess({sysex:true}).then(a => {
    const keepPort = port ? port.id : "";
    const keepClaims = Array.from(claims.entries());
    if (port){ try{ port.onmidimessage = null; }catch(e){} }
    keepClaims.forEach(([id]) => {
      const old = ports("inputs").find(p => p.id === id);
      if (old){ try{ old.onmidimessage = null; }catch(e){} }
    });
    claims.clear(); port = null;
    bindAccess(a, true);
    accessPromise = Promise.resolve(a);
    try{ localStorage.setItem(SYSEX_KEY, "1"); }catch(e){}
    if (keepPort) select(keepPort);
    keepClaims.forEach(([id, fn]) => claim(id, fn));
    notify();
    return true;
  }).catch(() => false);
}

function ports(kind){ return access ? Array.from(access[kind].values()) : []; }

function deliver(s, e){
  /* A handler that throws must not stop the message reaching the other instruments. */
  try{ s.onMidi(e); }catch(err){ console.error("midi handler failed", err); }
}

/* ---- play whatever panel you are looking at ----
   Channels are the right model when a controller has several parts on it and you have set
   the rig up once. They are the wrong model for one keyboard and six instruments, where
   the question is always "play THIS one" and the answer was a trip into a panel to change
   a number. Follow mode makes clicking a panel the whole gesture — the same click that
   already hands it the computer keyboard.

   ⚠️ THE CHANNEL IS REWRITTEN, not bypassed. Every instrument filters by channel on its
   own way in and that filter is not moving — the router has never had opinions about
   channels and should not grow them. So a message aimed at the focused instrument is
   re-stamped with the channel that instrument is listening on, and its own filter passes
   it for its own reasons. An instrument on Omni needs no rewrite and gets none. */
/* ⚠️ ON BY DEFAULT, AND REMEMBERED. Off was the safe choice for a rack whose panels each
   had their own port and channel, and it is the wrong one for the way this is actually
   played: you click a panel, you play, and you expect to hear the panel you clicked. With
   this off, a controller on one channel reaches exactly one instrument and every other panel
   is silent until you go and find the channel selectors — which is a MIDI routing problem
   presented as the keyboard being broken.

   Remembered rather than merely defaulted, so turning it off stays off: a default is what
   you get before you have an opinion, not something to be handed back every reload. */
const FOLLOW_KEY = "patchwork-midi-follow";
let follow = (() => {
  try{ const v = localStorage.getItem(FOLLOW_KEY); return v == null ? true : v === "1"; }
  catch(e){ return true; }
})();

/* ⚠️ A NOTE-OFF GOES WHERE ITS NOTE-ON WENT, focus or no focus. Hold a note, click another
   panel, let go: without this the note-off lands on the newly focused instrument and the
   first one sustains that note until a panic. host.js has exactly this problem with the
   computer keyboard and exactly this answer — a keyup is routed to whichever panel took
   its keydown. Held notes are the thing a focus change is most likely to interrupt, so
   this is the common case rather than the corner. */
const heldBy = new Map();        // "channel:note" -> the id that took the note-on

function focusedId(){
  const r = Patchwork.focused;
  return r && r.dataset ? r.dataset.instrument : null;
}
function retarget(s, d){
  const want = s.spec && s.spec.inCh ? s.spec.inCh.get() : -1;
  if (want == null || want < 0) return {data: d};    // Omni: nothing to re-stamp
  const out = Uint8Array.from(d);
  out[0] = (d[0] & 0xF0) | (want & 0x0F);
  return {data: out};
}

function fanout(e){
  const d = e.data;
  if (!follow || !d || !d.length){ subs.forEach(s => deliver(s, e)); return; }
  const st = d[0];
  /* Realtime carries no channel and belongs to everyone — CS·1 follows the clock, and a
     transport that only reached the panel you happened to be looking at would be a bug
     nobody would think to describe as a MIDI routing problem. */
  if (st >= 0xF0){ subs.forEach(s => deliver(s, e)); return; }
  const type = st & 0xF0, ch = st & 0x0F;
  /* All-notes-off and all-sound-off reach everything. A panic that only works on the panel
     you are looking at is not a panic. */
  if (type === 0xB0 && (d[1] === 120 || d[1] === 123)){
    subs.forEach(s => deliver(s, e)); return;
  }

  const key = ch + ":" + d[1];
  let id = null;
  if (type === 0x80 || (type === 0x90 && d[2] === 0)){
    id = heldBy.get(key) || null;
    heldBy.delete(key);
  }
  if (!id) id = focusedId();
  const s = subs.find(x => x.id === id);
  if (!s) return;                                   // focus is on something that takes no MIDI
  if (type === 0x90 && d[2] > 0) heldBy.set(key, s.id);
  deliver(s, retarget(s, d));
}

/* Register an instrument. onMidi gets every message — filter by channel yourself.
   onPort is called when the page's input changes, including when the OTHER panel
   changed it, so a selector and an LED can follow. */
/* `spec` is how an instrument says which channels it answers on, so ONE place can show
   them all and set them. It is an adapter rather than a field because every instrument
   keeps this somewhere different and calls it something different — bs1 and vc1 have
   MIDI.inCh, dr1 has inCh and ch, cs1 has both under other names again, and pm1's input
   channel is called synCh for reasons that date to MS·1. Asking each to expose a getter
   and a setter costs one object and means the shell never has to know any of that.

     {name, inCh:{get,set}, outCh:{get,set}}   — every part optional */
function route(id, onMidi, onPort, spec){
  subs.push({id, onMidi, onPort: onPort || function(){}, spec: spec || null});
  notify();
}

function select(portId){
  if (port){ try{ port.onmidimessage = null; }catch(e){} }
  port = portId ? (ports("inputs").find(p => p.id === portId) || null) : null;
  /* ⚠️ A CLAIMED PORT IS NOT AVAILABLE AS THE PAGE INPUT. The surface holds the Launchkey's
     DAW port, and selecting it here would overwrite its handler with fanout — the exact
     single-property collision this module was written to stop, except now between the shell
     and itself. Refuse it and leave the input where it was. */
  if (port && claims.has(port.id)) port = null;
  if (port) port.onmidimessage = fanout;
  subs.forEach(s => { try{ s.onPort(port); }catch(e){} });
  notify();
  return port;
}

/* ---- one way out for the rack ----
   ⚠️ ONE PORT, MANY CHANNELS, which is the same shape the input already had and the same
   shape the audio bus arrived at independently. Every panel that speaks MIDI grew its own
   output port select — PM·1 and CS·1 and DR·1 each have one — and that is three answers to a
   question with one answer, kept in three places you have to open a panel to find. The
   channel is the instrument's; the cable is the page's.

   Remembered, because a box that boots into this should come up plugged into the same thing
   it was plugged into yesterday. */
const OUT_KEY = "patchwork-midi-out";
let outPort = null, outId = "";
try{ outId = localStorage.getItem(OUT_KEY) || ""; }catch(e){}

function bindOut(){
  outPort = outId ? (ports("outputs").find(p => p.id === outId) || null) : null;
  return outPort;
}
function selectOut(portId){
  outId = portId || "";
  try{ localStorage.setItem(OUT_KEY, outId); }catch(e){}
  bindOut();
  notify();
  return outPort;
}

/* ---- audio time into port time ----
   ⚠️ TWO CLOCKS, AND THE PORT READS THE OTHER ONE. Every sequencer in the rack schedules on the
   AudioContext clock, in seconds since the context was made; MIDIOutput.send takes a
   performance.now() timestamp, in milliseconds since the page was. An audio time handed to the
   port is a moment long gone, so the message goes out the instant it is scheduled — up to a
   whole lookahead early — and nothing anywhere fails. SQ·1's drum tracks did exactly that (a hit
   timestamped 132.24 against a performance.now() of 132269) while its synth tracks, further down
   the same file, converted; VC·1's sequencer sent no timestamp at all, which the port reads as
   "now".

   So the conversion lives here, beside the one door their MIDI goes out of, rather than once
   per instrument: BS·1, TS·1 and SQ·1's synth tracks each carried a copy of this line. It is the
   plain mapping those copies used — now, plus how far ahead the audio time is.

   ⚠️ CS·1 AND PM·1 DO NOT USE IT. They send through ports of their own with their own
   perfTime(), which asks getOutputTimestamp() and so lands a note when its audio frame leaves the
   device rather than when it is rendered — later than this by the output latency. The two have
   not been made one; see HANDOFF.md, "SQ·1 asks for a row from every track". */
function portTime(t){
  const c = Patchwork.audio && Patchwork.audio.ctx;
  if (!c || t == null) return performance.now();
  return performance.now() + Math.max(0, t - c.currentTime) * 1000;
}

/* A sender for one instrument. ⚠️ IT REMEMBERS WHAT IT SENT, which is the whole reason this
   is an object rather than a function: a note-off for a note nobody sent is noise on the
   wire, and a note-on left hanging by a panic or a port change is a stuck note on somebody
   else's synth — the one MIDI bug that outlives the page that caused it.

   `ch` is a getter rather than a number so the sender does not go stale when the channel is
   changed from the Settings tab, which is exactly where it will be changed from.

   ⚠️ `when` IS PORT TIME — performance.now() milliseconds — or nothing, for now. Anything
   scheduled on the audio clock goes through portTime() first: nothing here can tell 132.24
   seconds from 132.24 milliseconds, and the port will not say. */
function sender(chOf){
  const live = new Set();
  const at = t => (t == null ? 0 : t);
  const ch = () => {
    const c = typeof chOf === "function" ? chOf() : chOf;
    return Math.max(0, Math.min(15, (c | 0)));
  };
  function raw(bytes, when){
    const o = outPort;
    if (!o) return false;
    try{ o.send(bytes, at(when)); return true; }catch(e){ return false; }
  }
  return {
    get on(){ return !!outPort; },
    noteOn(n, vel, when){
      const p = Math.max(0, Math.min(127, Math.round(n)));
      const v = Math.max(1, Math.min(127, Math.round(vel == null ? 96 : vel)));
      /* a pitch already sounding is released first, so a receiver sees a clean retrigger
         rather than two note-ons it has to guess about */
      if (live.has(p)) raw([0x80 | ch(), p, 0], when);
      if (raw([0x90 | ch(), p, v], when)) live.add(p);
    },
    noteOff(n, when){
      const p = Math.max(0, Math.min(127, Math.round(n)));
      if (!live.has(p)) return;
      live.delete(p);
      raw([0x80 | ch(), p, 0], when);
    },
    cc(num, val, when){ raw([0xB0 | ch(), num & 127, val & 127], when); },
    /* ⚠️ NOT gated on the port still being the one we sent through. A note already out has
       to be released whatever the settings say now, or it hangs forever on a receiver that
       has no idea the page moved on. */
    allOff(){
      live.forEach(p => raw([0x80 | ch(), p, 0]));
      live.clear();
      raw([0xB0 | ch(), 123, 0]);
    }
  };
}

/* ---- a port of one's own ----
   Bind `handler` to one input port for a control surface. Returns a release function; call
   it when the surface disconnects, because a claim outlives the object that made it and a
   port nobody is listening to is better than a port two things are.

   Claiming the port that is currently the page input takes it: the surface's DAW port and
   the page's performance input are different cables on the same device, and a boot that
   happened to select the DAW port first must not leave the surface deaf. */
function claim(portId, handler){
  const pt = ports("inputs").find(p => p.id === portId);
  if (!pt) return function(){};
  if (port && port.id === portId){ try{ port.onmidimessage = null; }catch(e){} port = null; }
  const prev = claims.get(portId);
  if (prev){ try{ pt.onmidimessage = null; }catch(e){} }
  claims.set(portId, handler);
  pt.onmidimessage = ev => { try{ handler(ev); }catch(err){ console.error("surface handler failed", err); } };
  subs.forEach(s => { try{ s.onPort(port); }catch(e){} });
  notify();
  return () => {
    if (claims.get(portId) !== handler) return;   // someone else claimed it since
    claims.delete(portId);
    const still = ports("inputs").find(p => p.id === portId);
    if (still){ try{ still.onmidimessage = null; }catch(e){} }
    notify();
  };
}
function claimed(portId){ return claims.has(portId); }

/* Outputs have no shared-handler problem — sending is not listening — so this is a lookup
   rather than an ownership question. It exists so a surface never has to reach for
   `access` and hold a port object across a SysEx upgrade that invalidates it. */
function output(portId){
  return portId ? (ports("outputs").find(p => p.id === portId) || null) : null;
}

/* Everything registered, in the order it registered, for a page that wants to show the
   whole rig's channels in one place. */
function list(){
  return subs.filter(s => s.spec).map(s => ({id: s.id, name: (s.spec.name || s.id), spec: s.spec}));
}
function setFollow(on){
  follow = !!on;
  try{ localStorage.setItem(FOLLOW_KEY, follow ? "1" : "0"); }catch(e){}
  /* ⚠️ Notes held across the switch would never be released by the rule that is now in
     force, so let go of everything first. Silence is recoverable; a stuck note is not. */
  heldBy.clear();
  subs.forEach(s => { try{ if (s.spec && s.spec.panic) s.spec.panic(); }catch(e){} });
  notify();
}

return {open, upgrade, ports, route, select, list, setFollow,
        claim, claimed, output, selectOut, sender, portTime,
        get outPort(){ return outPort; },
        get outId(){ return outId; },
        onChange: fn => watchers.push(fn),
        get follow(){ return follow; },
        get sysex(){ return sysex; },
        get access(){ return access; },
        get port(){ return port; }};
})();
