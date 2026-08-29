/* ============ boot ============ */
setBpm(120);
setOctave(0);
applyParams(FACTORY_DEFAULT);
loadMap();
paintRoute();
segPaint.keysTo();
paintKeysNote();        // loadMap may have restored a different destination
refreshPatchList();
refreshBinds();
paintMeta();
paintNow();
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
    chorusDry, vocBus, vocOut, modGain, vocBank, sibGain, sibNoise, absCurve,
    pitchVoc, bendVoc, modComp, modMakeup, modPost, driveMeter, modMeter, bassOut};
  const savedCarriers = Array.from(carriers.entries());
  carriers.clear();
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
    applyChorus(); applyDelay(); applySends(); applyVocoder();
    /* there is no microphone in an offline render, so a test supplies its own modulator */
    if (o.modulator){
      const m = o.modulator(off);
      if (m) m.connect(modGain);
    }
    if (o.bass != null){
      const bv = buildBass(o.bass, o.vel == null ? 100 : o.vel, 0);
      if (gate > 0 && gate < dur) bv.release(gate);
      return await off.startRendering();
    }
    if (o.chord){
      /* several voices at once, so the poly level budget can be measured rather than hoped at */
      const vs = o.chord.map(n => buildVoice(n, o.vel == null ? 100 : o.vel, 0));
      if (gate > 0 && gate < dur) vs.forEach(v => v.release(gate));
      return await off.startRendering();
    }
    if (o.carrier != null){
      /* render the vocoder path instead of the synth voice */
      const c = buildCarrier(o.carrier, o.vel == null ? 100 : o.vel, 0);
      if (gate > 0 && gate < dur) c.release(gate);
      const buf0 = await off.startRendering();
      return buf0;
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
    vocBus = saved.vocBus; vocOut = saved.vocOut; modGain = saved.modGain;
    vocBank = saved.vocBank; sibGain = saved.sibGain; sibNoise = saved.sibNoise;
    absCurve = saved.absCurve; pitchVoc = saved.pitchVoc; bendVoc = saved.bendVoc;
    bassOut = saved.bassOut;
    modComp = saved.modComp; modMakeup = saved.modMakeup; modPost = saved.modPost;
    driveMeter = saved.driveMeter; modMeter = saved.modMeter;
    carriers.clear();
    savedCarriers.forEach(([k, v2]) => carriers.set(k, v2));
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
Patchwork.scenes.register("pm1", {
  name: "PM·1",
  isPlaying: () => SEQ.playing,
  capture: () => ({steps: JSON.parse(JSON.stringify(SEQ.steps)),
                   len: SEQ.len, rate: SEQ.rate, swing: SEQ.swing,
                   motion: SEQ.motion, dir: SEQ.dir, octaves: SEQ.octaves,
                   root: SEQ.root, scale: SEQ.scale, gate: SEQ.gate}),
  apply: pat => {
    if (pat.steps) SEQ.steps = JSON.parse(JSON.stringify(pat.steps));
    ["len","rate","swing","motion","dir","octaves","root","scale","gate"].forEach(k => {
      if (pat[k] != null) SEQ[k] = pat[k];
    });
    seqLenSel.value = String(SEQ.len);
    seqRateSel.value = SEQ.rate;
    paintSeqKey();
    paintSteps();
  }
});

window.__pm1 = {P, SEQ, FACTORY, FACTORY_DEFAULT, FACTORY_ORDER, ladder,
                applyParams, noteOn, noteOff, buildVoice, renderPatch,
                stepEvent, nextSounding, stepSeconds, swungAt, envValueAt,
                arpSequence, stepNote, toDegree, fromDegree, SCALES,
                selectStep, withLocks, writeStep,
                buildCarrier, bandFreq, onMidi, routeFor, MIDI,
                get keysTo(){ return keysTo; }, set keysTo(v){ keysTo = v; },
                get carriers(){ return carriers; }, get held(){ return heldNotes; },
                get poly(){ return polyVoices; }, MAX_POLY, chordName,
                get bassHeld(){ return bassHeld; }, get bassVoice(){ return bassVoice; },
                get outNotes(){ return outNotes; },
                applyParam, get ctlReg(){ return ctlReg; }, get master(){ return master; }, get modMeter(){ return modMeter; }, paintModMeter, startModMeter, stopModMeter,
                get bend(){ return {syn:bendSrc && bendSrc.offset.value,
                                    voc:bendVoc && bendVoc.offset.value}; },
                get buses(){ return {pitchMod, pitchVoc}; },
                get ctx(){ return ctx; }, get active(){ return active; }, ensureAudio};
