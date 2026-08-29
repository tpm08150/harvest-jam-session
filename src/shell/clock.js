
/* One clock for the page.

   Both instruments already ran the same transport — a 25 ms interval scheduling against
   ctx.currentTime with a 200 ms lookahead, and bpmExact driving the grid while the
   rounded value is display only. MS·1's copy says outright that it came from CS·1. What
   they did not share was a grid ORIGIN, and that is what stopped them locking: each set
   nextTime to ctx.currentTime + .03 at the moment its own Play was pressed, so two
   instruments started a second apart ran a second apart forever, at identical tempo.

   The shell owns the origin, the tempo and the single timer. It does NOT own musical
   position — CS·1 counts bars of varying length and MS·1 counts swung sixteenths, and
   those belong to the instruments. */
Patchwork.clock = (() => {
"use strict";

let bpm = null;                 // the exact value; rounding is for display only
let origin = null;              // ctx time of beat 0 of the running grid
let timer = null;
const running = new Set();      // tick functions currently scheduled
const tempoSubs = [];

const beatSeconds = () => 60 / (bpm || 120);

/* The audio-clock time an instrument should place its first event at.

   Nothing else running: start now, and this instrument's downbeat DEFINES the grid —
   which is exactly what a standalone build does, so its timing is unchanged. Something
   already running: land on the next boundary of the existing grid instead, so the two
   are in phase rather than merely at the same tempo.

   quantumBeats is how coarse that seam is — 4 for a bar. */
function claim(quantumBeats){
  const ctx = Patchwork.audio.context();
  const soon = ctx.currentTime + .03;
  if (origin === null || running.size === 0){
    /* ⚠️ A session IMPOSES the grid: whoever opened the jam defined beat 0, and a client
       that starts playing an hour later has to land on that grid rather than starting a
       fresh one under everyone. Asked for here rather than pushed in from outside because
       this is the one moment a fresh origin would be invented — and because the mapping
       needs an AudioContext, which does not exist when the session is joined. */
    const shared = originSource && originSource();
    if (shared == null){ origin = soon; return soon; }
    origin = shared;
  }
  const q = Math.max(1e-6, quantumBeats * beatSeconds());
  return origin + Math.ceil((soon - origin) / q) * q;
}

/* Where a shared grid comes from — see shell/session.js. Returns null when playing alone,
   which is every standalone build and the studio until someone starts a jam. */
let originSource = null;
function setOriginSource(fn){ originSource = fn; }

function pump(){
  /* A tick that throws must not take the other instruments' transports down with it. */
  running.forEach(fn => { try{ fn(); }catch(e){ console.error("clock tick failed", e); } });
}

function run(fn){
  running.add(fn);
  if (timer == null) timer = setInterval(pump, 25);
}

function stop(fn){
  running.delete(fn);
  if (running.size === 0){
    clearInterval(timer); timer = null;
    origin = null;              // the next instrument to start defines a fresh grid
  }
}

/* Tempo is shared, so a change on either panel moves both. `from` names the instrument
   that made the change, so its own handler can skip the round trip and avoid fighting
   the control the user is currently dragging. */
function setBpm(v, from){
  const next = Math.min(240, Math.max(20, +v || 0));
  if (bpm === null){ bpm = next; return bpm; }
  if (next === bpm) return bpm;
  bpm = next;
  tempoSubs.forEach(s => { if (s.id !== from) s.fn(bpm); });
  return bpm;
}

/* The first instrument to register decides the page's tempo; every one after it adopts
   that value on the spot. Without this the two ran at their own defaults — CS·1 at 88 and
   MS·1 at 120 — until someone happened to touch a tempo control, so "shared tempo" would
   have been true only after the fact. */
/* The rate trim from whichever instrument owns the phase lock.

   CS·1's phaseAdjust() has two terms and only one of them generalises. The NUDGE is a
   phase pull sized against one chord and capped per chord; applying it to a sixteenth
   as well would correct sixteen times too hard. The TRIM is a rate correction — the
   term that exists because tempo is measured off performance.now() but spent against
   ctx.currentTime, two different crystals, so the error integrates forever. That one is
   just "run this fraction faster", which is true of any interval, and it is the term
   behind the measured 54 ms/min.

   So the trim is shared and the nudge is not. The residual: while the loop is pulling in
   a phase error, CS·1 moves against MS·1 by up to maxAdj (10 ms) per chord until it
   settles. Sharing the nudge too means the shell owning musical position for both
   instruments, which is the scene launcher's job, not this one's. */
let rate = 1;
function setRate(r){ rate = (isFinite(r) && r > 0.5 && r < 1.5) ? r : 1; }

function onTempo(id, fn, initial){
  tempoSubs.push({id, fn});
  if (bpm === null) bpm = Math.min(240, Math.max(20, +initial || 120));
  else if (initial != null && initial !== bpm) fn(bpm);
  return bpm;
}

return {claim, run, stop, setBpm, onTempo, beatSeconds, setRate, setOriginSource,
        get rate(){ return rate; },
        get bpm(){ return bpm; },
        get origin(){ return origin; },
        get running(){ return running.size; }};
})();
