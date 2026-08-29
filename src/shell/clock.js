
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

let ticks = 0;
function pump(){
  ticks++;
  /* A tick that throws must not take the other instruments' transports down with it. */
  running.forEach(fn => { try{ fn(); }catch(e){ console.error("clock tick failed", e); } });
}

/* ---- what drives the tick ----
   ⚠️ setInterval STOPS IN A TAB YOU CANNOT SEE. Measured: a plain setInterval(fn, 25) in a
   non-visible tab produced 4 ticks in 3 seconds where 120 were asked for — about 1.3 Hz,
   against a scheduler that looks 200 ms ahead. That is not a degraded tick, it is a stopped
   one, and every instrument on the page goes silent behind it.

   Chrome exempts pages that are PLAYING AUDIO, which is why this was invisible for so long:
   a jam in progress was never the case that broke. The case that breaks is a client sitting
   in a session with nothing sounding, waiting to fire a row — its clock has stalled by the
   time it does, and in a shared session that is everybody's problem rather than its own.

   So the tick comes off the AUDIO THREAD instead. It is real-time, it is never throttled
   while the context runs, and this clock was always about audio time — the interval was
   only ever a way of asking "has 25 ms passed".

   Three things this needs and would otherwise be an afternoon:

   - THE NODE MUST BE CONNECTED. A worklet nobody pulls is a worklet whose process() is never
     called, so it goes through a zero gain to the destination: audible to nothing, pulled by
     the graph all the same.
   - THE MODULE LOADS ASYNCHRONOUSLY. The interval keeps running until the worklet is live.
     Double-ticking across the handover is harmless — every instrument's tick() only schedules
     while nextTime is inside the lookahead, so a second call finds nothing to do.
   - A SLOW INTERVAL STAYS as a backstop, because a suspended context stops the audio thread
     too. It is far too slow to be the mechanism and is not meant to be; it is there so a
     failure sounds like gaps rather than silence, and it heals as soon as the worklet
     returns. */
const TICK_SRC = "\n" + [
  "class TickProcessor extends AudioWorkletProcessor {",
  "  constructor(){ super(); this.n = 0; }",
  "  process(){",
  "    /* 128 frames a quantum, so eight of them is about 21 ms at 48 kHz - near enough the",
  "       25 ms the interval asked for, and indifferent to whether the tab is visible. */",
  "    if (++this.n >= 8){ this.n = 0; this.port.postMessage(0); }",
  "    return true;",
  "  }",
  "}",
  "registerProcessor('pw-tick', TickProcessor);"
].join("\n");

let tickNode = null, tickLoading = false;
const FAST = 25, BACKSTOP = 500;
let interval = FAST;

function setInterval_(ms){
  if (timer != null) clearInterval(timer);
  interval = ms;
  timer = setInterval(pump, ms);
}

function ensureTicker(){
  if (tickNode || tickLoading) return;
  const ctx = Patchwork.audio && Patchwork.audio.ctx;
  if (!ctx || !ctx.audioWorklet) return;          // the interval is covering us
  tickLoading = true;
  /* a Blob URL, the same trick LP·1's worklet uses to keep the one-file rule */
  const url = URL.createObjectURL(new Blob([TICK_SRC], {type: "text/javascript"}));
  ctx.audioWorklet.addModule(url).then(() => {
    URL.revokeObjectURL(url);
    const n = new AudioWorkletNode(ctx, "pw-tick",
      {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1]});
    const mute = ctx.createGain();
    mute.gain.value = 0;
    n.connect(mute); mute.connect(ctx.destination);
    n.port.onmessage = () => { if (running.size) pump(); };
    tickNode = n;
    if (timer != null) setInterval_(BACKSTOP);
  }).catch(() => { tickLoading = false; });      // stay on the interval
}

function run(fn){
  running.add(fn);
  ensureTicker();
  if (timer == null) setInterval_(tickNode ? BACKSTOP : FAST);
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
        get running(){ return running.size; },
        /* what is actually driving the tick, and how many it has done — diagnostics, but
           the kind you want when a session sounds like it has stalled */
        get driver(){ return tickNode ? "worklet" : (timer != null ? "interval" : "none"); },
        get ticks(){ return ticks; }};
})();
