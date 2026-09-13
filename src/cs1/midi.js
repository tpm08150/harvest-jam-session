/* ============ midi ============ */
const midiInSel = $("#midiIn"), midiOutSel = $("#midiOut"), midiChSel = $("#midiCh"),
      ledEl = $("#midiLed"), midiNoteEl = $("#midiNote");

for (let c = 0; c < 16; c++){
  const o = document.createElement("option");
  o.value = c; o.textContent = c + 1;
  midiChSel.appendChild(o);
}
midiChSel.value = "0";

/* input channel filter — omni by default, which is how this behaved before it existed */
const midiInChSel = $("#midiInCh");
midiInChSel.appendChild(Object.assign(document.createElement("option"),
  {value:"-1", textContent:"Omni"}));
for (let c = 0; c < 16; c++)
  midiInChSel.appendChild(Object.assign(document.createElement("option"),
    {value:String(c), textContent:String(c + 1)}));
midiInChSel.value = "-1";
midiInChSel.addEventListener("change", () => {
  MIDI.inCh = parseInt(midiInChSel.value, 10);
  allPadsOff();
  saveMap();
  describe();
});

/* ---- out ---- */
/* The two clocks: ctx.currentTime counts audio the graph has *accepted*, performance.now()
   is wall time. getOutputTimestamp pairs them at the frame actually leaving the device, so
   the base it gives already carries output latency — which is what the phase measurement
   wants, since it compares what's heard against when clock pulses arrive.

   ⚠️ NOTES OUT DO NOT USE IT ANY MORE. They go through Patchwork.midi.portTime(), the one
   mapping every instrument's notes leave by, and so are stamped for when their audio is
   rendered rather than heard. This pairing put CS·1's notes 12–15 ms after every other
   instrument's on the same cable (measured on a Mac's default output; more on anything
   slower), and one cable should carry one idea of now. The cost lands here: following an
   external clock, CS·1 lines its sound up with the pulses and sends its notes an output
   latency ahead of that sound. */
function ctxPerfBase(){
  if (ctx.getOutputTimestamp){
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.contextTime != null && ts.performanceTime != null && ts.performanceTime > 0)
      return ts.performanceTime - ts.contextTime * 1000;
  }
  return performance.now() - ctx.currentTime * 1000;
}
/* performance.now() time -> AudioContext time, for timestamping incoming clock onto the audio
   grid. The other direction, for the port, is portTime() in shell/midi.js. */
function ctxTime(perfMs){
  if (!ctx) return 0;
  return (perfMs - ctxPerfBase()) / 1000;
}

/* A timestamped note-off lives in the browser's queue until its moment arrives — if the
   page dies first it is never delivered and the external synth holds that note forever.
   Pads can be 8 bars (~38s at 50bpm), so only short offs are pre-scheduled; longer ones
   are held here and sent as they come due, capping the exposure to a few seconds. */
const MAX_OFF_AHEAD = 4;
const pendingOffs = [];
let offTimer = null;

function flushOffs(){
  if (!ctx) return;
  const horizon = ctx.currentTime + .25;
  for (let i = pendingOffs.length - 1; i >= 0; i--){
    const o = pendingOffs[i];
    if (o.at <= horizon){
      if (MIDI.out){ try{ MIDI.out.send([0x80 | o.ch, o.p, 0], Patchwork.midi.portTime(o.at)); }catch(e){} }
      pendingOffs.splice(i, 1);
    }
  }
  if (!pendingOffs.length && offTimer != null){ clearInterval(offTimer); offTimer = null; }
}

function sendNote(n, t, dur, vel){
  const out = MIDI.out; if (!out) return;
  const p = Math.max(0, Math.min(127, Math.round(n)));
  const v = Math.max(1, Math.min(127, Math.round(vel == null ? 96 : vel)));
  try{
    out.send([0x90 | MIDI.ch, p, v], Patchwork.midi.portTime(t));
    if (dur <= MAX_OFF_AHEAD){
      out.send([0x80 | MIDI.ch, p, 0], Patchwork.midi.portTime(t + dur));
    } else {
      pendingOffs.push({p, ch:MIDI.ch, at:t + dur});
      if (offTimer == null) offTimer = setInterval(flushOffs, 40);
    }
  }catch(e){}
}

/* Deliberately blunt: every channel, not just the selected one, because a stuck note may
   predate a channel change — or a whole browser session. */
function midiPanic(){
  pendingOffs.length = 0;
  if (offTimer != null){ clearInterval(offTimer); offTimer = null; }
  const out = MIDI.out; if (!out) return;
  try{
    if (out.clear) out.clear();          // drop everything still queued ahead of us
    for (let ch = 0; ch < 16; ch++){
      out.send([0xB0 | ch, 120, 0]);     // all sound off
      out.send([0xB0 | ch, 123, 0]);     // all notes off
      out.send([0xB0 | ch, 64, 0]);      // sustain pedal up, in case it is latching
    }
    for (let n = 0; n < 128; n++) out.send([0x80 | MIDI.ch, n, 0]);
  }catch(e){}
}

/* ---- midi learn ---- */
const MAP_KEY = "patchwork-cs1-midimap";

function midiNoteLabel(n){ return SHARPS[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
function padNoteFor(slot){
  for (const [n, s] of padMap) if (s === slot) return n;
  return null;
}

function saveMap(){
  try{ localStorage.setItem(MAP_KEY,
    JSON.stringify({pads:[...padMap], ccs:[...ccMap], progs:[...progMap],
                    notes:[...patchNotes], recall:RECALL.when, inCh:MIDI.inCh})); }catch(e){}
}
function loadMap(){
  try{
    const raw = localStorage.getItem(MAP_KEY); if (!raw) return;
    const o = JSON.parse(raw) || {};
    (o.pads || []).forEach(p => padMap.set(+p[0], +p[1]));
    (o.ccs  || []).forEach(c => { if (Object.prototype.hasOwnProperty.call(P, c[1])) ccMap.set(+c[0], c[1]); });
    /* absent in maps saved before program change existed, which is why this is a separate
       key rather than a change to the shape of the two that were already there */
    (o.progs || []).forEach(p => {
      const n = +p[0];
      if (n >= 0 && n <= 127 && typeof p[1] === "string") progMap.set(n, p[1]);
    });
    (o.notes || []).forEach(p => {
      const n = +p[0];
      if (n >= 0 && n <= 127 && typeof p[1] === "string") patchNotes.set(n, p[1]);
    });
    if (["instant","bar","pattern"].indexOf(o.recall) >= 0) RECALL.when = o.recall;
    if (typeof o.inCh === "number" && o.inCh >= -1 && o.inCh < 16){
      MIDI.inCh = o.inCh;
      if (typeof midiInChSel !== "undefined" && midiInChSel) midiInChSel.value = String(o.inCh);
    }
  }catch(e){}
}

function arm(target, el){
  $$(".arm").forEach(x => x.classList.remove("arm"));
  LEARN.target = target;
  if (el) el.classList.add("arm");
  learnSay();
}

function refreshBinds(){
  /* keyed off the registry, not FADERS, so the Bass decay control is covered too */
  Object.keys(faderCtl).forEach(id => {
    const ctl = faderCtl[id]; if (!ctl) return;
    let cc = null;
    for (const [c, fid] of ccMap) if (fid === id) cc = c;
    const b = ctl.el.querySelector(".bind");
    if (b) b.textContent = cc == null ? "" : "CC " + cc;
  });
  if (state.prog) renderProgression();   // pad badges live in the chord markup
  if (typeof refreshProgSel === "function") refreshProgSel();
}

function bindLearn(kind, num){
  const t = LEARN.target; if (!t) return;
  if (kind === "note" && t.type === "pad"){
    padMap.forEach((slot, n) => { if (slot === t.i) padMap.delete(n); });  // one note per slot
    patchNotes.delete(num);                    // a note can't be both a chord and a recall
    padMap.set(num, t.i);
  } else if (kind === "note" && t.type === "patch"){
    patchNotes.forEach((nm, n) => { if (nm === t.name) patchNotes.delete(n); });
    padMap.delete(num);
    patchNotes.set(num, t.name);
  } else if (kind === "cc" && t.type === "fader"){
    ccMap.forEach((id, c) => { if (id === t.id) ccMap.delete(c); });
    ccMap.set(num, t.id);
  } else {
    return;   // wrong message type for this target — keep waiting
  }
  saveMap();
  LEARN.target = null;
  $$(".arm").forEach(x => x.classList.remove("arm"));
  refreshBinds();
  learnSay();
}

function learnSay(){
  /* don't let describe() overwrite a standing permission/secure-context error */
  if (!LEARN.on){ if (MIDI.access) describe(); return; }
  if (!LEARN.target){
    say("<b>Learn is on.</b> Click a chord pad, then play the note you want to trigger it — "
      + "or click a fader, then move a knob. Click Learn again when you're done.");
  } else if (LEARN.target.type === "pad"){
    say("Chord slot " + (LEARN.target.i + 1) + " armed — play a note on your controller.");
  } else {
    say("Fader <b>" + LEARN.target.id + "</b> armed — move a knob or fader that sends CC.");
  }
}

function setLearn(on){
  LEARN.on = on;
  LEARN.target = null;
  root.classList.toggle("learning", on);
  $$(".arm").forEach(x => x.classList.remove("arm"));
  const b = $("#learn");
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", on ? "true" : "false");
  learnSay();
}

function applyCC(cc, val){
  const id = ccMap.get(cc);
  if (!id || !faderCtl[id]) return;
  faderCtl[id].set(val / 127);
}

/* ---- in: chord pads ---- */
const WHITE = [0,2,4,5,7,9,11];
/* white keys map to progression slots, C4 = slot 1, wrapping in every octave */
function padIndex(n){
  const w = WHITE.indexOf(((n % 12) + 12) % 12);
  if (w < 0) return -1;
  return w + (Math.floor(n / 12) - 5) * 7;
}

/* A learned map replaces the white-key default outright rather than layering on top of it:
   half-custom/half-piano would fire chords from notes you never assigned. */
function padSlot(n){
  const len = state.prog.chords.length;
  if (padMap.size) return padMap.has(n) ? padMap.get(n) % len : -1;
  const pi = padIndex(n);
  return pi < 0 ? -1 : ((pi % len) + len) % len;
}

function flashPad(i, on){
  if (on) litPads.add(i); else litPads.delete(i);
  if (!state.playing){
    const c = chordsEl.querySelectorAll(".chord")[i];   // children are .pad wrappers now
    if (c) c.classList.toggle("on", on);
  }
}

/* Arp and Pulse are patterns, not chords, so a held pad has to keep re-issuing them.
   Same lookahead trick as the transport: one shared timer tops every held pad up to a
   short horizon, rather than a timer (and drift) per pad. */
const PAD_HORIZON = .15;
let padTimer = null;
const padLooping = () => state.motion === "arp" || state.motion === "pulse";

function padTick(){
  if (!ctx || !arping.size) return;
  const horizon = ctx.currentTime + PAD_HORIZON;
  arping.forEach(a => {
    a.recs = a.recs.filter(r => active.has(r));   // drop notes that have already ended
    const amp = .35 + .65 * (a.vel / 127);
    let guard = 0;
    while (a.next < horizon && guard++ < 8){
      chordEvents(a.slot, a.next).forEach(e => {
        const g = (e.gain != null ? e.gain : VOICES[state.voice].lvl) * amp;
        a.recs.push(trigger(e.n, e.t, e.d, {bass:e.bass, gain:g, pan:e.pan, susAmt:e.susAmt}));
        sendNote(e.n, e.t, e.d, Math.round(e.vel * (a.vel / 127)));
      });
      /* the rate half of the phase correction, but not the phase half — a held pad has its
         own downbeat, set by when it was pressed, and shouldn't be dragged onto the
         transport's. It should still run at the same tempo as it, though. */
      a.next += barSeconds() * chordBars(a.slot) * (1 + (SYNC.lock ? SYNC.trim : 0));
    }
  });
}

function padOn(n, vel){
  if (!state.prog) return;
  const i = padSlot(n); if (i < 0) return;
  padDown(n, i, vel);
}

/* ⚠️ `n` IS A MAP KEY, NOT A NOTE, from here down. A control surface presses chord slot 4
   directly — there is no note number involved and inventing one would collide with a real
   key the moment the two were held together. padOff() already only ever used it as a key,
   so a string works there unchanged; this split is what lets it work here too. */
function padDown(n, i, vel){
  if (held.has(n)) padOff(n);

  const ch = state.prog.chords[i];
  const notes = state.prog.voicings[i];
  const outNotes = (state.bass ? [bassNote(ch, state.keyPc)] : []).concat(notes);

  if (padLooping()){
    ensureAudio();
    const a = {slot:i, vel, recs:[], next:ctx.currentTime + .02};
    arping.set(n, a);
    held.set(n, {recs:a.recs, outNotes, slot:i, arp:true});
    if (padTimer == null) padTimer = setInterval(padTick, 25);
    padTick();                    // don't wait a tick to start — this is a performance control
    flashPad(i, true);
    return;
  }

  /* Hold and Strum are sustained chords: one gated voicing that rings until note-off */
  if (MIDI.out){
    try{ outNotes.forEach(p => MIDI.out.send([0x90 | MIDI.ch, p, vel])); }catch(e){}
  }
  const recs = [];
  {
    ensureAudio();
    const amp = .35 + .65 * (vel / 127);
    const spread = notes.length > 1 ? 1.2 / (notes.length - 1) : 0;
    const off = state.motion === "strum" ? .045 : .012;
    if (state.bass){
      recs.push(trigger(bassNote(ch, state.keyPc), ctx.currentTime, HOLD_MAX,
        {bass:true, gain:bassGain() * amp, susAmt:P.bassSus}));
    }
    notes.forEach((nn, k) => recs.push(
      trigger(nn, ctx.currentTime + k*off, HOLD_MAX, {pan:-0.6 + k*spread, gain:VOICES[state.voice].lvl * amp})
    ));
  }
  held.set(n, {recs, outNotes, slot:i});
  flashPad(i, true);
}

function padOff(n){
  const h = held.get(n); if (!h) return;
  held.delete(n);

  const a = arping.get(n);
  if (a){
    arping.delete(n);
    if (!arping.size && padTimer != null){ clearInterval(padTimer); padTimer = null; }
    a.recs.forEach(r => releaseRec(r));
    if (MIDI.out){
      try{
        h.outNotes.forEach(p => MIDI.out.send([0x80 | MIDI.ch, p, 0]));
        /* the lookahead may already have queued note-ons past this instant; sweep again
           once the horizon has passed so nothing is left hanging on the external synth */
        setTimeout(() => {
          if (!MIDI.out) return;
          try{ h.outNotes.forEach(p => MIDI.out.send([0x80 | MIDI.ch, p, 0])); }catch(e){}
        }, (PAD_HORIZON + .12) * 1000);
      }catch(e){}
    }
  } else {
    if (MIDI.out){
      try{ h.outNotes.forEach(p => MIDI.out.send([0x80 | MIDI.ch, p, 0])); }catch(e){}
    }
    h.recs.forEach(r => releaseRec(r));
  }

  /* only clear the highlight if no other held key maps to the same slot */
  let stillHeld = false;
  held.forEach(o => { if (o.slot === h.slot) stillHeld = true; });
  if (!stillHeld) flashPad(h.slot, false);
}

function allPadsOff(){ Array.from(held.keys()).forEach(padOff); }

/* ---- in: clock ---- */
let clockLast = 0, lastBpmPaint = 0, clockWatch = null;
const clockTimes = [];

/* Clock source follows the cable now: the first 0xF8 takes over the tempo, and when the
   pulses stop the transport goes back to its own clock. Nothing to remember to flip. */
function setSync(mode){
  if (MIDI.sync === mode) return;
  MIDI.sync = mode;
  if (mode === "ext"){
    if (clockWatch == null){
      clockWatch = setInterval(() => {
        /* a bar at 50bpm is ~4.8s, but clock pulses are 24 per beat — a second of silence
           means the source really has stopped, not that it's between beats */
        if (performance.now() - clockLast > 1000) setSync("int");
      }, 250);
    }
  } else {
    if (clockWatch != null){ clearInterval(clockWatch); clockWatch = null; }
    clockTimes.length = 0;
    phaseReset();     // the grid is ours again; the old error means nothing
  }
  updateMeta();
  if (MIDI.access) describe();
}

/* ---- phase ----
   Tempo follow alone is an open loop: whatever the tempo estimate gets wrong, position
   error integrates and never comes back. This closes it. Every pulse is a statement about
   where the external beat grid is, so compare the transport's own position against it and
   feed the difference back into the length of the next chord.

   Error is wrapped to the nearest WHOLE BEAT, not the nearest pulse. Output latency and
   whatever Offset is dialled in are a constant tens of ms; half a pulse is 10ms at 120bpm,
   so locking to the nearest pulse would let that constant hop between neighbours and
   dither. Half a beat is 250ms — comfortably clear of it. Bar-level alignment is Start's
   job, not the loop's. */
const PHASE = {
  alpha: .05,     // per-pulse EMA — ~20 pulses, under a beat, well below the jitter
  gain: .25,      // fraction of the remaining error taken out per chord
  ki: .05,        // and the rate correction, see `trim` below
  maxAdj: .01,    // ...and never more than 10ms, or 2% of a chunk, whichever is smaller.
                  // 10ms on a 2s bar is 0.5%, well under audible, and pulls a worst-case
                  // quarter-beat start error in about half a minute. 4ms was inaudible too
                  // but took minutes; 20ms bought little speed for double the overshoot.
  maxTrim: .005,  // 5000ppm, an order past any real crystal mismatch
  maxErr: .45     // beats; beyond this the estimate is near the wrap and not trustworthy
};
function phaseReset(){
  SYNC.pulse = 0; SYNC.err = 0; SYNC.have = false; SYNC.trim = 0;
  SYNC.hist.length = 0;
  Patchwork.clock.setRate(1);
}
/* One pulse arrived at wall time `now`: where is the transport against it? */
function phaseSample(now){
  if (!ctx || !state.playing || !state.prog) return;
  const beat = beatSeconds();
  if (!(beat > 0)) return;
  /* both sides in beats, so the difference wraps at 1 */
  const diff = beatsAt(ctxTime(now)) - SYNC.pulse / 24;
  const wrapped = diff - Math.round(diff);
  const err = wrapped * beat;
  if (!SYNC.have){ SYNC.err = err; SYNC.have = true; }
  else SYNC.err += PHASE.alpha * (err - SYNC.err);

  /* One sample a second, two minutes deep — enough to fit a slope through, short enough
     that it forgets a transient instead of averaging it in forever. */
  const h = SYNC.hist;
  if (!h.length || now - h[h.length - 1].t > 1000){
    h.push({t:now, e:SYNC.err});
    if (h.length > 120) h.shift();
  }
}
/* The length to actually give the next chord. Returns `dur` untouched whenever the loop
   shouldn't be closed — free-running, clock ignored, no estimate yet, or an error big enough
   that it's a re-sync rather than drift, where a lurch would be worse than staying put.

   Two terms, because there are two different faults to correct:
     nudge  proportional — pulls an existing phase error back to zero
     trim   integral — the disturbance is a RATE error (tempo is measured off
            performance.now() but spent against ctx.currentTime, and those are two
            different crystals), and proportional feedback can only cancel a rate by
            standing at a permanent offset. Simulated at 900ppm skew that offset is 7ms;
            the trim absorbs the rate instead and leaves the error itself at zero. */
function phaseAdjust(dur){
  if (!SYNC.lock || !SYNC.have || !MIDI.clockOn || MIDI.sync !== "ext") return dur;
  if (Math.abs(SYNC.err) > PHASE.maxErr * beatSeconds()) return dur;
  const cap = Math.min(dur * .02, PHASE.maxAdj);
  const want = SYNC.err * PHASE.gain;
  const nudge = Math.max(-cap, Math.min(cap, want));
  /* Anti-windup: while the nudge is clamped, the loop is correcting as fast as it is
     allowed to rather than as fast as the error asks, and the integrator can't tell those
     apart — it would wind up on the way in and have to unwind past zero on the far side.
     Measured as a 31ms overshoot on a 119ms pull-in. So integrate only when not saturated. */
  if (Math.abs(want) <= cap)
    SYNC.trim = Math.max(-PHASE.maxTrim,
                Math.min(PHASE.maxTrim, SYNC.trim + PHASE.ki * SYNC.err / dur));
  /* publish the rate part so every instrument on the page runs at the corrected rate,
     not just this one — see shell/clock.js for why the nudge stays here */
  Patchwork.clock.setRate(1 + SYNC.trim);
  return dur * (1 + SYNC.trim) + nudge;
}
/* Drift is the slope, not the offset: a constant error is what Offset exists for. Fitted
   over the trailing window rather than measured against a fixed starting point, so that
   whatever the error was doing a few minutes ago stops counting — an endpoint reference
   reported a pull-in transient as a -68 ms/min drift long after the loop had settled. */
function phaseDrift(){
  const h = SYNC.hist, n = h.length;
  if (n < 20 || h[n - 1].t - h[0].t < 30000) return null;
  let mx = 0, my = 0;
  for (const p of h){ mx += p.t; my += p.e; }
  mx /= n; my /= n;
  let num = 0, den = 0;
  for (const p of h){ num += (p.t - mx) * (p.e - my); den += (p.t - mx) ** 2; }
  return den ? num / den * 60000 * 1000 : null;   // seconds per ms -> ms per minute
}

/* Tempo comes from a long window rather than smoothed single intervals. One 24ppqn pulse
   is ~20ms and arrives jittery — over the bridge on iOS it's one call per message — so
   averaging pairs gives a noisy figure. Measuring across up to four beats is a duration
   ratio, and the jitter on the two endpoints divides down by the span. */
function onClock(){
  if (!MIDI.clockOn) return;
  const now = performance.now();
  setSync("ext");
  clockLast = now;

  phaseSample(now);
  SYNC.pulse++;

  clockTimes.push(now);
  if (clockTimes.length > 97) clockTimes.shift();     // four beats at 24ppqn

  if (clockTimes.length >= 25 && now - lastBpmPaint > 200){
    lastBpmPaint = now;
    const span = clockTimes.length - 1;
    const perPulse = (clockTimes[span] - clockTimes[0]) / span;   // ms
    const bpm = 60000 / (perPulse * 24);
    if (bpm >= 40 && bpm <= 250) setBpm(bpm, true);
    paintPhase();
  }
}

function onMidi(e){
  const d = e.data; if (!d || !d.length) return;
  const s = d[0];
  ledBlink();
  if (s === 0xF8) return onClock();
  if (s === 0xFA || s === 0xFB){                       // start / continue
    /* Start usually arrives just before the first clock pulse, so requiring ext sync
       already to be engaged meant the very message that should begin playback got
       dropped. Following the clock at all is enough. */
    if (MIDI.clockOn){
      setSync("ext");
      if (state.playing) stopPlay();
      startPlay();
    }
    return;
  }
  if (s === 0xFC){                                     // stop
    if (MIDI.clockOn && state.playing) stopPlay();
    return;
  }
  if (s >= 0xF0) return;
  /* Channel filter. Everything above this point is system-realtime, which has no channel,
     so clock and start/stop are unaffected by it. */
  if (MIDI.inCh >= 0 && (s & 0x0F) !== MIDI.inCh) return;
  const type = s & 0xF0;
  if (type === 0x90 && d[2] > 0){
    if (LEARN.on && LEARN.target){ bindLearn("note", d[1]); return; }
    /* a note assigned to a patch is consumed by it — it does not also sound a chord */
    if (patchNotes.has(d[1])) return queueRecall(patchNotes.get(d[1]), midiNoteLabel(d[1]));
    padOn(d[1], d[2]);
  }
  else if (type === 0x80 || (type === 0x90 && d[2] === 0)){
    if (patchNotes.has(d[1])) return;
    padOff(d[1]);
  }
  else if (type === 0xB0){
    if (d[1] === 123 || d[1] === 120) return allPadsOff();
    if (d[1] > 119) return;                      // channel-mode messages aren't controls
    if (LEARN.on && LEARN.target){ bindLearn("cc", d[1]); return; }
    applyCC(d[1], d[2]);
  }
  /* program change carries a single data byte, so the program is d[1] and there is no d[2] */
  else if (type === 0xC0) recallProgram(d[1]);
}

function recallProgram(prog){
  const name = progMap.get(prog);
  if (name) queueRecall(name, "Program " + prog);
}

/* Ask for a patch. Whether it lands now or on the next seam is RECALL.when — the request
   is the same either way, so both the note trigger and program change come through here. */
function queueRecall(name, why){
  const store = loadStore();
  if (!store[name]){                              // assigned to a patch since deleted
    for (const [p, n] of [...progMap]) if (n === name) progMap.delete(p);
    for (const [n, pn] of [...patchNotes]) if (pn === name) patchNotes.delete(n);
    saveMap(); refreshPatchList(patchSel.value); refreshBinds();
    return;
  }
  /* Nothing is playing, so there is no seam to wait for. */
  if (RECALL.when === "instant" || !state.playing) return applyPatch(name, why);
  RECALL.pending = {name, why};
  patchSay(why + " → <b>" + name + "</b> queued for the "
    + (RECALL.when === "pattern" ? "end of the pattern" : "next chord") + ".");
}

/* Applied from inside tick(), immediately before the chord at the seam is scheduled, so the
   new progression is what gets played from that boundary on. */
function takePending(){
  if (!RECALL.pending) return;
  if (RECALL.when === "pattern" && nextIndex !== 0) return;   // wait for the loop point
  const {name, why} = RECALL.pending;
  RECALL.pending = null;
  applyPatch(name, why);
}

function applyPatch(name, why){
  const store = loadStore();
  const patch = store[name];
  if (!patch) return;
  /* A patch remembers the tempo it was saved at, which would fight an external clock for
     the fraction of a second before the follower pulls it back. Keep the clock's tempo. */
  const extBpm = MIDI.sync === "ext" ? state.bpmExact : null;
  try{ recallPatch(patch); }
  catch(err){ patchSay(why + " couldn't load <b>" + name + "</b>.", true); return; }
  if (extBpm != null) setBpm(extBpm, true);

  /* The new progression may be shorter than the one playing, and the transport is mid-flight
     with an index into the old one. chordEvents() returns nothing for an index past the end,
     i.e. a silent bar, so fold it back into range. */
  if (state.playing && state.prog && state.prog.chords.length)
    nextIndex = nextIndex % state.prog.chords.length;

  patchName.value = name;
  refreshPatchList(name);
  refreshBinds();
  patchSay(why + " → <b>" + name + "</b>.");
}

/* ---- ports & status ---- */
let ledT = 0;
function ledBlink(){
  const now = performance.now();
  if (now - ledT < 90) return;
  ledT = now;
  ledEl.classList.add("lit");
  setTimeout(() => ledEl.classList.remove("lit"), 80);
}

function say(msg, bad){
  midiNoteEl.innerHTML = msg;
  midiNoteEl.classList.toggle("bad", !!bad);
  ledEl.classList.toggle("err", !!bad);
  ledEl.classList.toggle("ready", !bad && !!MIDI.in);
}

function fillSel(sel, ports, keepId){
  sel.innerHTML = '<option value="">— none —</option>';
  ports.forEach(p => {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name || p.id;
    sel.appendChild(o);
  });
  sel.value = (keepId && ports.some(p => p.id === keepId)) ? keepId : "";
}

function ports(kind){ return MIDI.access ? Array.from(MIDI.access[kind].values()) : []; }

function fillPorts(){
  fillSel(midiInSel, ports("inputs"), MIDI.in && MIDI.in.id);
  fillSel(midiOutSel, ports("outputs"), MIDI.out && MIDI.out.id);
}

function describe(){
  const ins = ports("inputs").length, outs = ports("outputs").length;
  say(ins + " input" + (ins === 1 ? "" : "s") + " · " + outs + " output" + (outs === 1 ? "" : "s")
    + " — white keys trigger chord slots (C4 = slot 1) and wrap in every octave. "
    + (MIDI.inCh < 0 ? "Listening on <b>every channel</b>. "
                     : "Listening on <b>channel " + (MIDI.inCh + 1) + "</b> only. ")
    + (MIDI.sync === "ext"
        ? "<b>Following external clock.</b> Use Offset to line it up against your gear."
        : "Incoming MIDI clock is followed automatically."));
}

/* The port belongs to the page, not to this panel — see shell/midi.js. Assigning
   onmidimessage here is what made the two instruments steal it from each other. */
function bindInput(){
  allPadsOff();
  MIDI.in = Patchwork.midi.select(midiInSel.value);
  ledEl.classList.toggle("ready", !!MIDI.in && !ledEl.classList.contains("err"));
}
/* Called when the page's input changes, including from the other panel. */
function followInput(pt){
  MIDI.in = pt;
  if (midiInSel.value !== (pt ? pt.id : "")) midiInSel.value = pt ? pt.id : "";
  ledEl.classList.toggle("ready", !!pt && !ledEl.classList.contains("err"));
}

function bindOutput(){
  midiPanic();                      // silence whatever the old port is holding
  MIDI.out = midiOutSel.value ? ports("outputs").find(p => p.id === midiOutSel.value) || null : null;
}

$("#clockEn").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  MIDI.clockOn = b.dataset.c === "on";
  $("#clockEn").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  if (!MIDI.clockOn) setSync("int");     // drop straight back to the internal clock
});

const phaseOut = $("#phaseOut");
function setClockLock(on){
  SYNC.lock = !!on;
  $("#clockLock").querySelectorAll("button")
    .forEach(x => x.classList.toggle("on", (x.dataset.l === "on") === SYNC.lock));
  paintPhase();
}
$("#clockLock").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  setClockLock(b.dataset.l === "on");
  /* Measure the new regime from here — the drift figure is a slope, and fitting it across
     the moment the loop closed would report neither the open- nor the closed-loop number. */
  SYNC.hist.length = 0;
  SYNC.trim = 0;
});
/* Live phase error, and the drift slope once there's enough window to mean anything. */
function paintPhase(){
  if (MIDI.sync !== "ext" || !SYNC.have){ phaseOut.textContent = "—"; return; }
  const ms = SYNC.err * 1000, d = phaseDrift();
  phaseOut.textContent = (ms > 0 ? "+" : "") + ms.toFixed(1) + " ms"
    + (d == null ? "" : "  ·  " + (d > 0 ? "+" : "") + d.toFixed(0) + "/min");
}

const offOut = $("#offOut");
function setClockOffset(ms){
  SYNC.offsetMs = Math.max(-200, Math.min(200, Math.round(ms / 5) * 5));
  offOut.textContent = (SYNC.offsetMs > 0 ? "+" : "") + SYNC.offsetMs + " ms";
}
$("#offDown").addEventListener("click", () => setClockOffset(SYNC.offsetMs - 5));
$("#offUp").addEventListener("click", () => setClockOffset(SYNC.offsetMs + 5));
setClockOffset(0);
setClockLock(false);

$("#panic").addEventListener("click", () => {
  if (state.playing) stopPlay();   // no point silencing if the sequencer refills it
  allPadsOff();
  killAll();
  midiPanic();
  say("Panic sent — all sound off, all notes off and sustain up on all 16 channels.");
});

$("#learn").addEventListener("click", () => setLearn(!LEARN.on));
$("#clearMap").addEventListener("click", () => {
  padMap.clear(); ccMap.clear(); patchNotes.clear();
  saveMap(); refreshBinds();
  LEARN.target = null;
  $$(".arm").forEach(x => x.classList.remove("arm"));
  say("Map cleared — pads are back to white keys from C4, faders are mouse-only.");
});

midiInSel.addEventListener("change", bindInput);
midiOutSel.addEventListener("change", bindOutput);
midiChSel.addEventListener("change", () => { midiPanic(); MIDI.ch = parseInt(midiChSel.value, 10); });


/* ---- control surface ----
   What a Launchkey (or anything else in shell/surface.js) sees when this panel has the
   focus. Two adapters, and neither knows what a Launchkey is: eight things you can turn,
   and a sixteen-cell grid.

   ⚠️ THE GRID IS READ, NOT PUSHED. shell/surface.js polls cells() and sends only the pads
   that changed — so a chord arriving on the transport's own schedule lights its pad without
   this file having to remember to announce it. Adding a new way for a slot to light up
   (which has happened twice already: MIDI learn, then held pads) cannot leave the hardware
   stale, because there is nothing here to forget to call. */
/* ⚠️ `short` IS FOR A SCREEN FOUR NAMES WIDE. The Launchkey lays its eight encoder names out
   2x4 across 128 pixels — its own Arp page fits "Swing" and "Rytm" and nothing longer — so a
   label written for a panel with room for it gets cut in half there. Six characters, chosen
   rather than truncated: "Releas" is a worse word than "Rel". */
const SURFACE_CTL = [
  {id: "tone", short: "Ton"}, {id: "attack", short: "Atk"}, {id: "release", short: "Rel"},
  {id: "space", short: "Spc"}, {id: "spread", short: "Spr"}, {id: "level", short: "Lvl"},
  {id: "bassSus", label: "Bass Sus", short: "Bas"}
];
const FADER_LAB = {};
FADERS.forEach(f => { FADER_LAB[f.id] = f.lab; });
function faderKnobs(list){
  return list.filter(c => faderCtl[c.id]).map(c => ({
    id: c.id, label: c.label || FADER_LAB[c.id] || c.id, short: c.short,
    get: () => P[c.id],
    set: v => faderCtl[c.id].set(v)
  }));
}

/* ---- TWO FACES, and Func is which one ----
   ⚠️ THIS PANEL HAS TWO INSTRUMENTS IN IT and the surface could only ever see one. The chord
   voice and the root bass have their own sound, their own level and — the part that matters —
   their own pattern: the bass is a step sequencer, and it was the one sequencer in the rack
   with no way to program it from the pads. Sixteen pads cannot be chord slots and bass steps
   at once, so Func says which, tapped rather than held, because programming a pattern with a
   modifier down is not something a hand can do for sixteen presses.

   The chord face keeps the pads it always had. It is where the panel starts and where a tap
   always brings it back, so nothing is reachable only by remembering you left it somewhere. */
let bassFace = false;

/* ⚠️ BANKS, RATHER THAN THE SECOND EIGHT. A progression has more to say about itself than
   eight knobs hold, and what it has to say is not a modifier's worth of afterthought — Key
   and Mood and how many chords are the FIRST things you reach for, not the ones you hold a
   button to get at. So the pair beside the encoders pages them, which is the same gesture
   DR·1 and PM·1 already use for the same reason, and Func is free to mean the face. */
const CHORD_BANKS = [
  {name: "Voice", build: () => faderKnobs(SURFACE_CTL).concat(
    /* ⚠️ ENCODER EIGHT, which was empty. Seven faders and a twelve-way sound selector that
       you could reach from every surface except the one under your hands. */
    [Patchwork.surface.segment($("#voice"), "Sound", "Snd")].filter(Boolean))},
  {name: "Prog", build: () => [
    Patchwork.surface.option($("#key"), "Key", "Key"),
    Patchwork.surface.option($("#len"), "Chords", "Len"),
    /* Mood and Mode are one letter apart on the panel and would be one letter apart in a
       three-character legend, so Mode is spelled M/m — it is the major-or-minor switch, and
       saying so beats a name you have to squint at. */
    Patchwork.surface.option($("#mode"), "Mode", "M/m"),
    Patchwork.surface.option($("#mood"), "Mood", "Mod"),
    Patchwork.surface.segment($("#motion"), "Motion", "Mot"),
    Patchwork.surface.option($("#arpRate"), "Arp rate", "Arp"),
    Patchwork.surface.option($("#pulseSteps"), "Pulse", "Pls"),
    Patchwork.surface.option($("#swing"), "Swing", "Swg")
  ].filter(Boolean)}
];
/* Four, and no bank to page: everything the bass voice has fits in half a row. */
const BASS_BANKS = [
  {name: "Bass", build: () => [
    Patchwork.surface.segment($("#bass"), "Bass", "Bas"),
    Patchwork.surface.option($("#bassSteps"), "Steps", "Stp")
  ].filter(Boolean).concat(faderKnobs([
    {id: "bassSus", label: "Decay", short: "Dec"},
    {id: "bassLvl", label: "Level", short: "Lvl"}
  ])) }
];
const banksNow = () => (bassFace ? BASS_BANKS : CHORD_BANKS);
let ctlBank = 0;
function bankNow(){ return Math.min(ctlBank, banksNow().length - 1); }
function surfaceControls(){ return banksNow()[bankNow()].build(); }
function surfaceBanks(){ return banksNow().map(b => ({name: b.name})); }
function setSurfaceBank(i){ ctlBank = Math.max(0, Math.min(banksNow().length - 1, i)); }

function surfaceFace(){
  bassFace = !bassFace;
  /* ⚠️ BACK TO THE FIRST BANK. The faces have different numbers of banks and a bank index
     carried across means landing on Prog's page number inside a face that has one bank —
     which bankNow() clamps, so nothing breaks and you simply arrive somewhere you did not
     ask for. Arriving at the front of a face is the only answer that is the same every
     time. */
  ctlBank = 0;
  return bassFace ? "Bass" : "Chords";
}

/* Which slot is sounding right now, from the same `marks` the on-screen playhead reads —
   rather than from a second counter that could disagree with what you can hear. */
function soundingSlot(){
  if (!state.playing || !ctx) return -1;
  const now = ctx.currentTime;
  let cur = -1;
  for (const m of marks) if (now >= m.t && now < m.end) cur = m.i;
  return cur;
}

const surfaceGrid = {
  /* The screen line, spelled by the same function the on-screen pad uses — a ♭VII that
     reads B♭ in the panel and A♯ on the controller would be two answers to one question. */
  label: () => {
    const i = soundingSlot();
    if (i < 0 || !state.prog) return "Chords";
    return chordName(state.prog.chords[i], state.keyPc, state.prog.minor);
  },
  cells: () => {
    const out = new Array(16).fill(null);
    if (!state.prog) return out;
    const n = Math.min(16, state.prog.chords.length);
    const playing = soundingSlot();
    for (let i = 0; i < n; i++){
      const heldHere = litPads.has(i);
      out[i] = {colour: "amber", on: heldHere || i === playing, hot: heldHere};
    }
    return out;
  },
  /* Velocity comes through as it arrived: the pads are velocity-sensitive and padDown
     already scales the voicing by it, so a soft pad is a soft chord for the same reason a
     soft key is. */
  down: (i, vel) => {
    if (!state.prog || i >= state.prog.chords.length) return;
    ensureAudio();
    padDown("s" + i, i, Math.max(1, vel || 96));
  },
  up: i => padOff("s" + i)
};

/* ---- the bass pattern, on the same sixteen pads ----
   ⚠️ NOT makeSeqSurface, and that is the shim rule applied honestly. The shared factory wants
   steps that carry a pitch, an accent, a slide and a tie; a bass step here is a 1 or a 0 and
   the note is whatever the chord's root happens to be. Faking six properties to reuse a
   paging helper is the shim that lies — this is thirty lines that say what they do.

   Paged in sixteens like every other grid here, read top row first, because a step grid you
   read in a different order on one panel is a coin flip every time you look down. */
const BASS_PAGE = 16;
let bassPage = 0;
const bassPages = () => Math.max(1, Math.ceil(BASSQ.steps / BASS_PAGE));
const bassBase = () => Math.min(bassPage, bassPages() - 1) * BASS_PAGE;
const bassCell = c => bassBase() + (c < 8 ? c + 8 : c - 8);

const bassSurface = {
  label: () => {
    const first = bassBase() + 1, last = Math.min(BASSQ.steps, bassBase() + BASS_PAGE);
    return "Bass  " + first + "-" + last;
  },
  pages: bassPages,
  page: () => Math.min(bassPage, bassPages() - 1),
  setPage: p => { bassPage = Math.max(0, Math.min(bassPages() - 1, p)); },
  cells: () => {
    const out = new Array(16).fill(null);
    for (let k = 0; k < BASS_PAGE; k++){
      const i = bassBase() + k;
      if (i >= BASSQ.steps) continue;              // a shorter pattern leaves them dark
      const cell = k < 8 ? k + 8 : k - 8;
      /* ⚠️ THE PLAYHEAD IS READ OFF THE PANEL, not worked out again. Where the bass is in its
         pattern depends on the sounding chord's length in bars, and that arithmetic lives in
         paintSteps() — a second copy here would be a second answer to the same question, and
         the one you could see would be the one that was wrong. */
      const here = bassGrid.children[i];
      const now = !!(here && here.classList.contains("now"));
      out[cell] = now ? {colour: "white", on: true}
                      : {colour: BASSQ.on[i] ? "amber" : "cyan", on: !!BASSQ.on[i]};
    }
    return out;
  },
  down: cell => {
    const i = bassCell(cell);
    if (i >= BASSQ.steps) return;
    toggleStep(BASSQ, bassGrid, i);
  }
};

/* ⚠️ THE SECOND EIGHT USED TO LIVE ON FUNC and every one of them is in the Prog bank above
   instead. Nothing was lost and Func was: a panel with two faces needs a button that picks
   one, the settings were the wrong thing to be holding a modifier for, and a page you reach
   with the same pair as every other panel's pages is one fewer rule. */
function surfaceGridNow(){ return bassFace ? bassSurface : surfaceGrid; }

function initMidi(){
  if (!navigator.requestMIDIAccess){
    /* Every iOS browser is WebKit underneath, so this is a platform limit rather than a
       browser choice — naming Safari 18 here misleads anyone reading it on a phone. */
    say(IS_IOS
      ? "Web MIDI isn't available on iOS or iPadOS — every browser there uses WebKit, so "
        + "switching browsers won't help. Everything else works; MIDI needs a desktop."
      : "Web MIDI isn't available in this browser. Chrome and Edge support it, and Firefox "
        + "prompts for permission.", true);
    return;
  }
  if (!window.isSecureContext){
    say("Web MIDI needs a secure context. Serve this file over <code>localhost</code> "
      + "rather than opening it with <code>file://</code>.", true);
    return;
  }
  /* What this instrument answers on, so the studio can show the whole rig's channels in
     one place. The setters keep this panel's own selects in step: the two views are the
     same setting and must never disagree about it. */
  Patchwork.midi.route("cs1", onMidi, pt => {
    fillPorts(); followInput(pt); bindOutput(); describe();
  }, {
    name: "CS\u00b71", panic: midiPanic,
    controls: surfaceControls,
    controlBanks: surfaceBanks, controlBank: bankNow, setControlBank: setSurfaceBank,
    face: surfaceFace, faceName: "Voice",
    grid: surfaceGridNow,
    inCh:  {get: () => MIDI.inCh,
            set: c => { MIDI.inCh = c; midiInChSel.value = String(c);
                        allPadsOff(); saveMap(); describe(); }},
    outCh: {get: () => MIDI.ch,
            set: c => { midiPanic(); MIDI.ch = c; midiChSel.value = String(c); }}
  });
  Patchwork.midi.open().then(a => {
    MIDI.access = a;
    fillPorts();
    /* Only claim the default port if nothing has claimed one yet — otherwise the second
       instrument to boot rebinds the page's input out from under the first. */
    const ins = ports("inputs");
    if (!Patchwork.midi.port && ins.length){ midiInSel.value = ins[0].id; bindInput(); }
    else followInput(Patchwork.midi.port);
    describe();
  }).catch(err => {
    say("MIDI access was denied or failed (" + ((err && err.name) || "error") + ").", true);
  });
}

