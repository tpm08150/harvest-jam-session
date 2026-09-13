/* ============ boot ============ */
setBpm(120);
setOctave(0);
applyParams(FACTORY_DEFAULT);
loadMap();
paintRoute();
/* keysTo and its hint went with the vocoder and bass sections — one voice, one destination */
refreshPatchList();
refreshBinds();
paintMeta();
paintNow();
/* ---- the patch, for a shared jam ----
   PM·1 already had both halves — applyParams() writes every parameter and repaints every
   control — because it has had patch save and load since it was MS·1. */
Patchwork.session.registerPatch("pm1", {
  capture: () => Object.assign({}, P),
  apply: src => applyParams(src)
});

/* ---- somebody else's notes ---- see shell/session.js for why a note is not state. */
Patchwork.session.registerVoice("pm1", {
  on: (n, v) => { ensureAudio(); noteOn(n, v); paintKeys(); },
  off: n => { noteOff(n); paintKeys(); }
});

initMidi();

/* ---- offline render, for measurement ----
   Renders a patch through the REAL graph by pointing the module's ctx at an
   OfflineAudioContext, then puts everything back. Every level and envelope number quoted
   anywhere about this synth should come from here, not from a reimplementation. */
async function renderPatch(opts){
  const o = opts || {};
  const dur = o.dur || 2.0, gate = o.gate == null ? 1.0 : o.gate;
  const rate = o.rate || 48000;
  const saved = {ctx, master, comp, voiceBus, fxBus, chorusStage, chorusWet, delayNode,
    delayFb, delayWet, verb, verbWet, noiseBuf, lfo, lfoGain, shSrc, analyser, pitchMod,
    filtMod, pwmBus, pwmLfo, ampMod, lfoFade, bendSrc, lfoPitchG, lfoFiltG, lfoAmpG,
    chorusDry};
  const savedP = Object.assign({}, P);
  const savedActive = Array.from(active);
  active.clear();
  ctx = null;
  const off = new OfflineAudioContext(2, Math.ceil(rate*dur), rate);
  try{
    initAudio(off);
    if (o.patch) applyParamsQuiet(FACTORY[o.patch] || FACTORY_DEFAULT);
    else if (o.params) applyParamsQuiet(o.params);
    /* initAudio() wires the effects from whatever P held when it ran, so without this the
       render silently measures the PREVIOUS patch's chorus, delay and reverb. Cost an
       entire level sweep before it showed up as an envelope that made no sense. */
    startLfo();
    if (lfoPitchG) lfoPitchG.gain.value = P.lfop;
    if (lfoFiltG)  lfoFiltG.gain.value = P.lfof*1200;
    if (lfoAmpG)   lfoAmpG.gain.value = P.lfoa;
    if (pwmLfo)    pwmLfo.frequency.value = P.pwmrate;
    applyChorus(); applyDelay(); applySends();
    if (o.chord){
      /* several voices at once, so the poly level budget can be measured rather than hoped at */
      const vs = o.chord.map(n => buildVoice(n, o.vel == null ? 100 : o.vel, 0));
      if (gate > 0 && gate < dur) vs.forEach(v => v.release(gate));
      return await off.startRendering();
    }
    const v = buildVoice(o.midi == null ? 69 : o.midi, o.vel == null ? 100 : o.vel, 0);
    if (gate > 0 && gate < dur) v.release(gate);
    const buf = await off.startRendering();
    return buf;
  } finally {
    active.clear();
    Object.keys(saved).forEach(k => { /* restored below by explicit assignment */ });
    ctx = saved.ctx; master = saved.master; comp = saved.comp; voiceBus = saved.voiceBus;
    fxBus = saved.fxBus; chorusStage = saved.chorusStage; chorusWet = saved.chorusWet;
    delayNode = saved.delayNode; delayFb = saved.delayFb; delayWet = saved.delayWet;
    verb = saved.verb; verbWet = saved.verbWet; noiseBuf = saved.noiseBuf; lfo = saved.lfo;
    lfoGain = saved.lfoGain; shSrc = saved.shSrc; analyser = saved.analyser;
    pitchMod = saved.pitchMod; filtMod = saved.filtMod; pwmBus = saved.pwmBus;
    pwmLfo = saved.pwmLfo; ampMod = saved.ampMod; lfoFade = saved.lfoFade;
    bendSrc = saved.bendSrc; lfoPitchG = saved.lfoPitchG; lfoFiltG = saved.lfoFiltG;
    lfoAmpG = saved.lfoAmpG; chorusDry = saved.chorusDry;
    Object.keys(savedP).forEach(k => P[k] = savedP[k]);
    savedActive.forEach(v2 => active.add(v2));
  }
}
/* same key-by-key reset as applyParams, without touching the DOM — the offline path has
   no UI to refresh and refreshAllControls() would rebuild the live LFO mid-render */
function applyParamsQuiet(src){
  Object.keys(FACTORY_DEFAULT).forEach(k => {
    const dflt = FACTORY_DEFAULT[k], got = src ? src[k] : undefined;
    P[k] = (typeof dflt === "number")
      ? (typeof got === "number" && isFinite(got) ? got : dflt)
      : (typeof got === "string" ? got : dflt);
  });
}

/* A test hook, not a feature: the offline harness needs to build a voice and read the
   patch without driving the UI. Mirrors CS·1's habit of making the engine measurable. */
/* ---- scenes ----
   An PM·1 pattern is the step sequence and how it is read — not the patch. Firing a
   scene changes the line, not the sound it is played with. */

/* ⚠️ PM·1 is the one instrument that can be RUNNING with nothing to play. Motion Off
   means the keyboard plays it and the sequencer stands down, so `startPlay()` refuses to
   start at all — correct when you are playing it by hand, and the reason a fired row
   containing PM·1 did nothing at all. It declined, said so in `#patchNote`, and that
   element is not on the face, so the message went nowhere and the cell just looked broken.

   A scene therefore puts it in a motion mode: the one the clip was captured in if that
   was Arp, and Seq otherwise, because a scene carries a step pattern and Seq is what
   plays one. Its own Play button is untouched — Motion Off there still means what it
   says, and you can still pick Off and play notes over a stopped grid.

   The seg is repainted, not just the state. A panel reading OFF while the sequencer runs
   is the same bug wearing the opposite face. */
function motionForScene(){
  SEQ.motion = SEQ.motion === "arp" ? "arp" : "seq";
  /* Unconditional, and NOT guarded on "did this change the value". apply() sets
     SEQ.motion from the clip before calling here, so a clip captured in Arp arrives
     already correct and an early return skipped the repaint it came for — the sequencer
     ran the arp while the panel still read OFF and showed the step grid. What has to be
     true after a scene acts is that the panel agrees with what is sounding, which is a
     statement about the paint, not about the assignment above it. */
  segPaint.motion();
  renderRoll();                  // also runs paintMotionView — the grid/roll swap
  paintMeta();
}

/* The line and how it is read — steps, length, rate, swing, direction, range, key, scale and
   gate — without deciding whether PM·1 runs it. A scene decides that straight after; a sequence
   does not decide it at all. See below. */
function applyLine(pat){
  if (pat.steps) SEQ.steps = JSON.parse(JSON.stringify(pat.steps));
  ["len","rate","swing","dir","octaves","root","scale","gate"].forEach(k => {
    if (pat[k] != null) SEQ[k] = pat[k];
  });
  seqLenSel.value = String(SEQ.len);
  seqRateSel.value = SEQ.rate;
  paintSeqKey();
  paintSteps();
  renderRoll();
  paintMeta();
}

Patchwork.scenes.register("pm1", {
  name: "PM·1",
  isPlaying: () => SEQ.playing,
  start: () => { ensureAudio(); motionForScene(); if (!SEQ.playing) startPlay(); },
  stop: () => { if (SEQ.playing) stopPlay(); },
  capture: () => ({steps: JSON.parse(JSON.stringify(SEQ.steps)),
                   len: SEQ.len, rate: SEQ.rate, swing: SEQ.swing,
                   motion: SEQ.motion, dir: SEQ.dir, octaves: SEQ.octaves,
                   root: SEQ.root, scale: SEQ.scale, gate: SEQ.gate}),
  apply: pat => {
    if (pat.motion != null) SEQ.motion = pat.motion;
    applyLine(pat);
    /* here as well as in start(), because a row landing at a SEAM applies without
       starting — an Off in the clip would leave the transport running and silent */
    motionForScene();
  }
});

/* ---- sixteen of them ----
   See shell/sequences.js. The pattern is the scene's, with one difference in how it lands.

   ⚠️ CHOOSING A SEQUENCE DOES NOT CHOOSE A MOTION. A scene puts PM·1 into Seq or Arp as it
   lands, because a scene that played nothing was the bug motionForScene() fixed. Choosing one of
   sixteen is editing, not performing: Motion Off is where you write a line over a stopped grid,
   and a number that flipped it to Seq would be one control quietly changing another. So a
   sequence lands through applyLine(), and motion is not part of what makes two patterns the same
   sequence — a row stored from sequence 2 is sequence 2 whether PM·1 sat on Off or Seq when it
   was stored, and a scene that lands it on Seq has not made it a different one. */
Patchwork.sequences.register("pm1", {
  apply: applyLine,
  ignore: ["motion"],
  blank: p => Object.assign({}, p, {steps: Array.from({length: MAX_STEPS}, () => S(0,0,0,.5,0,0,0))}),
  used: p => !!(p && Array.isArray(p.steps) && p.steps.some(st =>
    st && (st.on || st.tie || (st.locks && Object.keys(st.locks).length))))
});

/* PM·1 keeps MS·1's richer sequencer, so recording writes through writeStep() — the same
   path a hand-written step takes, locks and all.

   ⚠️ THE NEAREST STEP, WHICH IS WHAT THIS SAID AND NOT WHAT IT DID. It took nextSounding()
   — the step about to play — so a note struck a hair LATE landed a whole step early, and it
   computed a timestamp and a step length and then used neither. Both were sitting there as
   the unwritten half of the intention. This is the same rounding seq/step-seq.js does for
   BS·1 and VC·1: find the step you are inside, and round to whichever end is closer.

   ⚠️ AND THE WHOLE HELD CHORD, not the one note that arrived. Every other way of writing a
   step on this panel takes the chord — the grid's click does, step programming does — and
   the one that did not was the only one you would use while playing. Read from heldNotes at
   the moment of the write, so a triad grows into one step rather than three notes fighting
   over it. */
Patchwork.record.register("pm1", {
  name: "PM·1",
  write: (midi, vel, when) => {
    if (!SEQ.playing || !marks.length) return -1;
    const t = when == null ? (ctx ? ctx.currentTime : 0) : when;
    const i = stepAtTime(t);
    if (i < 0) return -1;
    const st = SEQ.steps[i];
    if (!st) return -1;
    const ns = heldNotes.map(h => h.midi).sort((a, b) => a - b);
    const root = ns.length ? ns[0] : midi;
    writeStep(st, root, ns.length > 1 ? ns.slice(1).map(x => x - root) : null);
    st.on = 1; st.tie = 0;
    st.accent = vel >= 100 ? 1 : 0;
    clearTail(i);
    paintSteps();
    return i;
  },
  /* ⚠️ AND HOW LONG YOU LEANT ON IT. Every note of a chord reports its own release and they
     all point at the same step, so the ties only ever GROW — which makes the step as long as
     the longest note in the chord, and that is what a chord held with one finger lingering
     actually sounds like. */
  hold: (from, when) => {
    if (!SEQ.playing || !marks.length) return 0;
    const to = stepAtTime(when == null ? (ctx ? ctx.currentTime : 0) : when);
    if (to < 0) return 0;
    const n = tieTail(from, to);
    if (n) paintSteps();
    return n;
  }
});

window.__pm1 = {P, SEQ, FACTORY, FACTORY_DEFAULT, FACTORY_ORDER, ladder,
                applyParams, noteOn, noteOff, buildVoice, renderPatch,
                stepEvent, nextSounding, stepSeconds, swungAt, envValueAt,
                /* the scheduled step boundaries, so a test can ask which step a given
                   instant rounds to rather than guessing at one */
                get marks(){ return marks; },
                arpSequence, stepNote, toDegree, fromDegree, SCALES,
                selectStep, withLocks, writeStep,
                onMidi, routeFor, MIDI,
                get held(){ return heldNotes; },
                get poly(){ return polyVoices; }, MAX_POLY, chordName,
                /* how you ask whether a step played a chord or a single note without
                   having to listen to it — `active` is already below */
                stepNotes,
                get outNotes(){ return outNotes; },
                applyParam, get ctlReg(){ return ctlReg; }, get master(){ return master; }, get bend(){ return {syn:bendSrc && bendSrc.offset.value}; },
                get buses(){ return {pitchMod}; },
                get ctx(){ return ctx; }, get active(){ return active; }, ensureAudio};
