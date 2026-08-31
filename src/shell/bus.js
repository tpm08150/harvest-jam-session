
/* One AudioContext for the page.

   Two instruments each opening their own context worked — the OS mixer summed them —
   but it makes everything after this impossible: two contexts have two `currentTime`
   origins and two independent clocks, so nothing scheduled against one can line up
   with the other. A shared time base is the thing the clock in Phase 3 needs, and it
   is the reason to do this first.

   Levels are unchanged. Each instrument already ends in its own compressor and master
   gain; the strip below is unity, and summing here is what the OS mixer was doing
   anyway. A master section that actually processes is a later decision, not a side
   effect of merging. */
Patchwork.audio = (() => {
"use strict";

let ctx = null, master = null;
const strips = new Map();   // id -> {in, out}
const levels = new Map();   // id -> fader gain, remembered even before the strip exists
const mutes = new Set();    // ids held silent
const solos = new Set();    // ids held audible — while any exist, everything else is not
const applied = new Map();  // id -> the gain last written to the node, to ramp from

function context(){
  if (!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  return ctx;
}

/* Where an instrument sends its output instead of ctx.destination. One per instrument,
   so a mixer — or a solo button — has something to hold on to later. Later is now.

   TWO NODES, not one. `in` is where the instrument plays and where every tap listens;
   `out` carries the fader on its way to master. What that buys is the answer to a question
   a one-node strip cannot even ask:

   ⚠️ TAPS ARE PRE-FADER. Your mix changes what YOU hear and nothing else — not what the
   looper prints, not what the vocoder is modulated by. Post-fader is the other defensible
   answer and it is the one to avoid here, because a take gets PUSHED: pull the drums down
   for yourself, record the studio output, and you would hand the room a loop with quiet
   drums in it and no way to know why. Worse with per-instrument sources, where your own
   mix would silently rewrite a take of somebody ELSE's instrument. A monitor balance is
   not supposed to leave your headphones. */
function strip(id){
  context();
  if (!strips.has(id)){
    const into = ctx.createGain(), out = ctx.createGain();
    into.gain.value = 1;
    out.gain.value = gainFor(id);
    applied.set(id, out.gain.value);
    into.connect(out);
    out.connect(master);
    strips.set(id, {in: into, out});
    taps.forEach(wireTap);          // an instrument built after a tap still reaches it
  }
  return strips.get(id).in;
}

/* ---- the mix ----
   One gain per instrument, and NOTHING here is shared with a jam. That is the whole point
   of it rather than an omission: everybody renders the same patterns through their own
   speakers, in their own room, and the balance that works in one is not the balance that
   works in another. Patterns and patches are shared because they are the MUSIC; a mix is
   how you happen to be listening to it.

   ⚠️ Which is also why it must never be registered with session.registerPatch(). That
   would poll it, notice it differed from the last thing sent, and push your balance to
   everyone — the failure being that it works perfectly alone and only goes wrong with
   somebody else in the room.

   Levels are kept here as well as on the node, so the mixer can be set before the
   instrument has ever made a sound. A strip is not built until its instrument first plays,
   and a fader that silently did nothing until then would be the kind of bug you blame on
   the audio rather than on the order things happened in. */
/* ⚠️ ANSWERED FROM THE MAP, NEVER FROM THE NODE. `gain.value` looks like the obvious
   source of truth and is not one: it reports the value from the last render quantum in
   which that node was PROCESSED, and Chrome does not process a branch with nothing
   flowing through it. So a strip whose instrument is not currently sounding reports
   whatever its gain happened to be when it last made a noise, no matter what has been set
   since — the automation underneath is perfectly correct and the readback is a ghost.

   It cost a real diagnosis: one fader read 0.5 while its audio measurably ran at 0.2, and
   only that instrument, because only that one had gone quiet. What made it convincing was
   that every other fader was right — the ones still playing. The mixer's model is this
   map; the AudioParam is what the map does to the sound. */
function level(id){
  return levels.has(id) ? levels.get(id) : 1;
}

/* ---- mute and solo ----
   Standard mixer rules, and worth writing down because "obvious" here is only obvious once
   you have used a mixer: a mute silences that one strip; a solo silences everything that is
   NOT soloed, and several can be soloed at once. Mute wins over solo, so soloing a track you
   have muted leaves it silent rather than quietly un-muting it behind your back.

   ⚠️ They live on the SAME node as the fader, which puts them post-tap like it — your mute
   changes what you hear and not what the looper prints or what the vocoder is modulated by.
   A mute that silenced a take being recorded would be the worst kind of surprise: you would
   not find out until you played the loop back. */
function gainFor(id){
  if (mutes.has(id)) return 0;
  if (solos.size && !solos.has(id)) return 0;
  return levels.has(id) ? levels.get(id) : 1;
}
/* Ramped, not assigned: a gain that jumps clicks, and a fader drag is a jump per frame.
   Cancel first, and ramp from the value we KNOW we last wrote rather than from gain.value —
   which reports the last RENDERED value and is a ghost on a strip that has gone quiet. Plus
   setTargetAtTime approaches forever and never clears, so a dragged fader would pile an
   event per frame onto a timeline nothing ever empties. */
function applyGain(id){
  const s = strips.get(id);
  const g = gainFor(id);
  if (!s || !ctx){ applied.set(id, g); return g; }
  const from = applied.has(id) ? applied.get(id) : 1;
  const t = ctx.currentTime, p = s.out.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(from, t);
  p.linearRampToValueAtTime(g, t + .02);
  applied.set(id, g);
  return g;
}
function setLevel(id, v){
  const g = Math.max(0, Math.min(1, +v || 0));
  levels.set(id, g);
  applyGain(id);
  return g;
}
function setMute(id, on){
  if (on) mutes.add(id); else mutes.delete(id);
  applyGain(id);
  return mutes.has(id);
}
/* ⚠️ Every strip, not just this one. Soloing a track changes what you hear from all the
   others, and that is the entire point of the control — repainting only the one you clicked
   is the bug that makes solo look like it does nothing. */
function setSolo(id, on){
  if (on) solos.add(id); else solos.delete(id);
  const ids = new Set([...strips.keys(), ...levels.keys(), ...mutes, ...solos]);
  ids.forEach(applyGain);
  return solos.has(id);
}
function muted(id){ return mutes.has(id); }
function soloed(id){ return solos.has(id); }
/* what a strip is actually doing, once the fader, the mute and everyone else's solo have
   had their say — the number the meter would show, as opposed to where the fader is */
function audible(id){ return gainFor(id); }

/* A sum of every instrument's strip EXCEPT one — what the looper records when you point
   it at the studio rather than a microphone.

   Excluding the caller is the whole point: the looper's own output goes to its strip and
   on to master, so recording master would record the looper recording itself and build
   until it clips. Taps are kept and re-wired when a new strip appears, because an
   instrument can be built after the tap was made. */
const taps = [];
/* `exclude` is one id or several. The looper needs three — its own strip, the metronome's
   and the talkback's — because a click or a voice on the bus would be printed into every
   take from then on. */
function tap(exclude){
  return makeTap({exclude: [].concat(exclude || [])});
}

/* The other direction: a sum of ONLY the named strips.

   Same machinery, opposite question. "Everything except me" is what you want when you are
   capturing the band; "just this one" is what you want when you are capturing a part — the
   drums to loop under a bass line, say — and the difference between them is a whole
   feature rather than a knob, because a take with the whole studio printed into it can
   never be separated again afterwards.

   ⚠️ Point this at a strip, never AT the strip itself. Handing out `strips.get(id)` would
   be one node fewer and would work perfectly until the caller released it: disconnect()
   with no argument drops every outgoing connection, so releasing that input would also cut
   the instrument off from master and silence it with nothing to say why. */
function tapOnly(include){
  return makeTap({only: [].concat(include || [])});
}

function makeTap(spec){
  context();
  const g = ctx.createGain();
  g.gain.value = 1;
  const t = Object.assign({node: g, wired: new Set()}, spec);
  taps.push(t);
  wireTap(t);
  return g;
}
function wireTap(t){
  strips.forEach((s, id) => {
    if (t.wired.has(id)) return;
    if (t.only ? t.only.indexOf(id) < 0 : t.exclude.indexOf(id) >= 0) return;
    s.in.connect(t.node);            // .in, not .out — see the pre-fader warning above
    t.wired.add(id);
  });
}

/* ⚠️ A TAP HAS TO BE RELEASED, not merely disconnected downstream.

   Every strip holds a connection INTO the tap, and `taps` holds the tap so that an
   instrument built later still reaches it. Dropping only the tap's own output leaves both:
   the node is inaudible, so nothing sounds wrong, and it quietly stays wired to every
   strip on the page forever — plus each new strip joins it. One abandoned tap per input
   change was survivable when the only source was the whole studio and you chose it once.
   Choosing between six instruments makes changing source a normal gesture, so the graph
   has to come apart as cleanly as it went together.

   Safe to call on anything: a node that is not a tap is simply not one, and says so. */
function untap(node){
  const i = taps.findIndex(t => t.node === node);
  if (i < 0) return false;
  const t = taps.splice(i, 1)[0];
  t.wired.forEach(id => {
    const s = strips.get(id);
    if (s) try{ s.in.disconnect(t.node); }catch(e){}
  });
  try{ t.node.disconnect(); }catch(e){}
  return true;
}

/* ---- the master insert ----
   Splice a chain between master and the speakers. One, because there is one master; a
   second caller is a bug rather than a feature and is told so.

   ⚠️ AFTER EVERY TAP. The taps hang off each strip's input (see the pre-fader note above),
   so nothing spliced here can reach the looper — a punch-in effect is a moment you play,
   not something to find printed into a take on every pass afterwards. That is a
   consequence of where the taps are rather than a decision made here, and it is the
   reason this comment exists.

   The disconnect and the connects are one synchronous block, so the graph is never
   half-rewired at a render quantum boundary. */
let inserted = null;
function insert(input, output){
  context();
  if (inserted) return false;
  master.disconnect();
  master.connect(input);
  output.connect(ctx.destination);
  inserted = {input, output};
  return true;
}

/* iOS parks the context in "suspended" until a gesture and in "interrupted" after a
   call or an app switch, so anything other than "running" needs a resume — not just
   "suspended". Both instruments carried this comment; now one place does. */
function resume(){
  context();
  if (ctx.state !== "running"){
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  }
  return ctx.state;
}

return {context, strip, resume, tap, tapOnly, untap, insert, level, setLevel,
        setMute, setSolo, muted, soloed, audible,
        get anySolo(){ return solos.size > 0; },
        get ctx(){ return ctx; },
        get master(){ return master; },
        /* the input nodes, which is what a strip has always meant to a caller */
        get strips(){ return new Map([...strips].map(([id, s]) => [id, s.in])); }};
})();
