
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

let accessPromise = null, access = null, port = null;
const subs = [];                 // {id, onMidi, onPort, spec}
const watchers = [];             // UI that wants to know when any of this changed
function notify(){ watchers.forEach(fn => { try{ fn(); }catch(e){} }); }

/* One requestMIDIAccess for the page — two calls mean two permission paths and two
   onstatechange owners racing to rebuild the same port lists. */
function open(){
  if (accessPromise) return accessPromise;
  if (!navigator.requestMIDIAccess)
    return accessPromise = Promise.reject(new Error("unavailable"));
  accessPromise = navigator.requestMIDIAccess({sysex:false}).then(a => {
    access = a;
    a.onstatechange = () => {
      /* A port can vanish while bound — unplugging the interface. Drop the stale
         reference before telling anyone, or every subscriber re-reads a dead port. */
      if (port && !ports("inputs").some(p => p.id === port.id)) port = null;
      subs.forEach(s => { try{ s.onPort(port); }catch(e){} });
    };
    return a;
  });
  return accessPromise;
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
let follow = false;

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
  if (port) port.onmidimessage = fanout;
  subs.forEach(s => { try{ s.onPort(port); }catch(e){} });
  notify();
  return port;
}

/* Everything registered, in the order it registered, for a page that wants to show the
   whole rig's channels in one place. */
function list(){
  return subs.filter(s => s.spec).map(s => ({id: s.id, name: (s.spec.name || s.id), spec: s.spec}));
}
function setFollow(on){
  follow = !!on;
  /* ⚠️ Notes held across the switch would never be released by the rule that is now in
     force, so let go of everything first. Silence is recoverable; a stuck note is not. */
  heldBy.clear();
  subs.forEach(s => { try{ if (s.spec && s.spec.panic) s.spec.panic(); }catch(e){} });
  notify();
}

return {open, ports, route, select, list, setFollow,
        onChange: fn => watchers.push(fn),
        get follow(){ return follow; },
        get access(){ return access; },
        get port(){ return port; }};
})();
