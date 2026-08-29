/* ============ vocoder ============ */
/* No AudioWorklet anywhere in here. The one thing that had to be proved is that a control
   signal can be built from audio and connected to a GainNode's gain: rectify the band with
   a WaveShaper, smooth it with two lowpasses, connect the result to gain.gain. Measured on
   a gated tone that gives 651:1 between open and closed, and a formant sweep transfers
   -5.8 dB at 700 Hz / +4.7 dB at 2400 Hz onto a saw carrier. That is a real vocoder. */
const VOC_LO = 150, VOC_HI = 5000;      // the span that carries intelligibility
const VOC_DRIVE = 9;                     // followers come out small; this is the makeup
/* Sixteen band gains summing, plus the unvoiced path, plus chorus and reverb, put the
   vocoder bus about 14 dB hotter than the synth voice — measured peaks of 1.7-1.8, i.e.
   clipping, on a realistic patch. This is the fixed trim that lands it on the same
   -24 dBFS target everything else is trimmed to. The Level knob rides on top of it. */
const VOC_TRIM = 0.2;
const SIB_HZ = 3800;                     // above here is unvoiced, and unpitchable
/* Scales the carrier-presence follower so a normally-sounding carrier opens the unvoiced
   gate fully. Set by measurement — see the sibilance note in HANDOFF.md. */
const SIB_CARR_DRIVE = 14;

/* MUST be an odd length. A WaveShaper maps input 0 to curve index (n-1)/2, and with an
   even n that index is fractional — so it interpolates between the two samples either side
   of zero and returns |+-1/(n-1)| instead of 0. At n=1024 that is a permanent floor of
   9.8e-4, which after the follower's drive becomes about -37 dB of gate that never closes.
   Harmless for the voiced bands, since the carrier itself stops, but the unvoiced path has
   its own noise source and leaked audibly. */
function mkAbsCurve(n){
  const size = n % 2 ? n : n + 1;
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++){ const x = (i/(size-1))*2 - 1; c[i] = Math.abs(x); }
  return c;
}
function bandFreq(i, n){ return VOC_LO * Math.pow(VOC_HI/VOC_LO, n < 2 ? 0 : i/(n-1)); }

/* One band: analysis on the modulator, synthesis on the carrier, joined by the follower. */
function mkBand(f){
  const abp = ctx.createBiquadFilter(); abp.type = "bandpass";
  abp.frequency.value = f; abp.Q.value = P.vocq;
  const rect = ctx.createWaveShaper(); rect.curve = absCurve; rect.oversample = "2x";
  const lp1 = ctx.createBiquadFilter(); lp1.type = "lowpass";
  lp1.frequency.value = P.vocresp; lp1.Q.value = .7;
  const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass";
  lp2.frequency.value = P.vocresp; lp2.Q.value = .7;
  const drive = ctx.createGain(); drive.gain.value = VOC_DRIVE;
  modPost.connect(abp); abp.connect(rect); rect.connect(lp1); lp1.connect(lp2); lp2.connect(drive);

  const sbp = ctx.createBiquadFilter(); sbp.type = "bandpass";
  sbp.frequency.value = f; sbp.Q.value = P.vocq;
  /* gain starts CLOSED and is opened only by the follower — connections sum with the value */
  const g = ctx.createGain(); g.gain.value = 0;
  drive.connect(g.gain);
  vocBus.connect(sbp); sbp.connect(g); g.connect(vocOut);
  return {abp, rect, lp1, lp2, drive, sbp, g, f};
}
function buildVocoder(){
  if (!ctx || !vocBus) return;
  vocBank.forEach(b => [b.abp,b.rect,b.lp1,b.lp2,b.drive,b.sbp,b.g]
    .forEach(n => { try{ n.disconnect(); }catch(e){} }));
  vocBank = [];
  const n = P.vocbands|0;
  for (let i = 0; i < n; i++) vocBank.push(mkBand(bandFreq(i, n)));
}
/* Q and response move under the sound; the band COUNT needs a rebuild. */
function applyVocoder(){
  if (!ctx || !vocOut) return;
  const t = ctx.currentTime;
  if (vocBank.length !== (P.vocbands|0)) buildVocoder();
  vocBank.forEach(b => {
    b.abp.Q.setTargetAtTime(P.vocq, t, .02);
    b.sbp.Q.setTargetAtTime(P.vocq, t, .02);
    b.lp1.frequency.setTargetAtTime(P.vocresp, t, .02);
    b.lp2.frequency.setTargetAtTime(P.vocresp, t, .02);
  });
  modGain.gain.setTargetAtTime(P.voc ? P.vocmod : 0, t, .02);
  if (modComp && modMakeup){
    /* threshold sweeps down and ratio up together, so one knob reads as "how hard".
       Makeup restores what the compression took out: for a signal at 0 dBFS the reduction
       is |thr|*(1 - 1/ratio), and that is exactly what quiet material needs lifting by. */
    const c = clampf(P.voccomp, 0, 1);
    const thr = -6 - 34*c;                 //  -6 dB .. -40 dB
    const ratio = 1.5 + 10.5*c;            //  1.5:1 .. 12:1
    const makeupDb = Math.min(30, -thr * (1 - 1/ratio));
    modComp.threshold.setTargetAtTime(thr, t, .02);
    modComp.ratio.setTargetAtTime(ratio, t, .02);
    modMakeup.gain.setTargetAtTime(db2lin(makeupDb), t, .02);
  }
  vocOut.gain.setTargetAtTime(P.voc ? P.vocmix * VOC_TRIM : 0, t, .02);
  if (sibGain) sibGain.gain.setTargetAtTime(P.vocsib * 0.35, t, .02);
}

/* The unvoiced path. A pitched carrier physically cannot produce "s" or "t", so without
   this the vocoder is mush at the top and barely intelligible. Detect energy above
   SIB_HZ in the modulator and let it gate a band of noise. */
function buildSibilance(){
  const hp = ctx.createBiquadFilter(); hp.type = "highpass";
  hp.frequency.value = SIB_HZ; hp.Q.value = .7;
  const rect = ctx.createWaveShaper(); rect.curve = absCurve; rect.oversample = "2x";
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 40;
  /* Measured: at the original drive the gate ran far past unity, which both slammed the
     level (+19.7 dB at sibilance 0.35, peaking 2.35) and saturated the gate so it stopped
     tracking. Sibilance has to sit UNDER the voiced bands, not on top of them. */
  const drive = ctx.createGain(); drive.gain.value = VOC_DRIVE * 0.4;
  modPost.connect(hp); hp.connect(rect); rect.connect(lp); lp.connect(drive);

  sibNoise = ctx.createBufferSource();
  sibNoise.buffer = noiseBuf.white; sibNoise.loop = true;
  const nhp = ctx.createBiquadFilter(); nhp.type = "highpass";
  nhp.frequency.value = SIB_HZ; nhp.Q.value = .7;
  const gate = ctx.createGain(); gate.gain.value = 0;
  drive.connect(gate.gain);

  /* ---- and a SECOND gate, from the carrier ----
     The voiced bands are gated by the note for free, because the carrier is what flows
     through them. This path has its own noise source, so without an explicit gate it sings
     whenever the modulator has any HF in it — with or without a note held. Measured: the
     output sat at -28 dBFS after a note had fully released, where it should be silence,
     and losing the voiced part against that standing noise bed is exactly what reads as a
     click on release.
     Following the carrier BUS rather than counting voices keeps this self-maintaining:
     it is right for one note, six notes, or a note in mid-release. */
  const carrAbs = ctx.createWaveShaper();
  carrAbs.curve = absCurve; carrAbs.oversample = "2x";
  const carrLp1 = ctx.createBiquadFilter(); carrLp1.type = "lowpass";
  carrLp1.frequency.value = 30; carrLp1.Q.value = .7;
  const carrLp2 = ctx.createBiquadFilter(); carrLp2.type = "lowpass";
  carrLp2.frequency.value = 30; carrLp2.Q.value = .7;
  const carrDrive = ctx.createGain(); carrDrive.gain.value = SIB_CARR_DRIVE;
  vocBus.connect(carrAbs); carrAbs.connect(carrLp1); carrLp1.connect(carrLp2);
  carrLp2.connect(carrDrive);
  const carrGate = ctx.createGain(); carrGate.gain.value = 0;
  carrDrive.connect(carrGate.gain);

  sibGain = ctx.createGain(); sibGain.gain.value = 0;
  sibNoise.connect(nhp); nhp.connect(gate); gate.connect(carrGate);
  carrGate.connect(sibGain); sibGain.connect(vocOut);
  sibNoise.start();
}

/* getUserMedia needs a gesture and a secure context. The three processing flags MUST be
   off: echo cancellation and noise suppression are built to remove exactly the signal a
   vocoder wants, and AGC pumps the band envelopes. */
async function startModulator(deviceId){
  ensureAudio();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    vocSay("This browser can't open an audio input.", true); return false;
  }
  stopModulator();
  try{
    modStream = await navigator.mediaDevices.getUserMedia({audio:{
      deviceId: deviceId ? {exact:deviceId} : undefined,
      echoCancellation:false, noiseSuppression:false, autoGainControl:false
    }});
    modSrc = ctx.createMediaStreamSource(modStream);
    modSrc.connect(modGain);
    if (modMeter) modSrc.connect(modMeter);
    startModMeter();
    vocSay("Listening on <b>" + modLabel(deviceId) + "</b>. "
      + "Play notes to sound them through your voice — <b>use headphones</b>, a microphone "
      + "into speakers will feed back.");
    return true;
  }catch(e){
    vocSay("Couldn't open that input (" + ((e && e.name) || e) + ").", true);
    return false;
  }
}
function stopModulator(){
  stopModMeter();
  if (modSrc){ try{ modSrc.disconnect(); }catch(e){} modSrc = null; }
  if (modStream){ try{ modStream.getTracks().forEach(t => t.stop()); }catch(e){} modStream = null; }
}

/* ---- segmented buttons ---- */
function seg(sel, attr, get, set){
  const g = $(sel);
  /* A control whose section moved to another instrument is absent, not broken. Returning
     a no-op painter rather than undefined means every caller that stores the result in
     segPaint still gets something callable — the alternative is a TypeError at boot from
     a control nobody can see. */
  if (!g) return function(){};
  const paint = () => g.querySelectorAll("button").forEach(b =>
    b.classList.toggle("on", b.dataset[attr] === String(get())));
  g.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    set(b.dataset[attr]); paint();
  });
  paint();
  return paint;
}
const segPaint = {};
segPaint.o1w   = seg("#o1w","w",   () => P.o1w,   v => { P.o1w = v; });
segPaint.o2w   = seg("#o2w","w",   () => P.o2w,   v => { P.o2w = v; });
segPaint.subw  = seg("#subw","s",  () => P.subw,  v => { P.subw = v; });
segPaint.noisew= seg("#noisew","n",() => P.noisew,v => { P.noisew = v; });
segPaint.prio  = seg("#prio","p",  () => P.prio,  v => { P.prio = v; });
segPaint.lfoKey= seg("#lfoKey","k",() => P.lfokey,v => { P.lfokey = +v; });
segPaint.lfoWave = seg("#lfoWave","w", () => P.lfow, v => { P.lfow = v; startLfo(); });
segPaint.chorus  = seg("#chorus","c",  () => P.chorus, v => { P.chorus = v; applyChorus(); });
segPaint.ddiv    = seg("#ddiv","d",    () => P.ddiv, v => { P.ddiv = v; applyDelay(); });
segPaint.glideMode = seg("#glideMode","g", () => P.gmode, v => { P.gmode = v; });
segPaint.voiceMode = seg("#voiceMode","m",
  () => P.mode === "mono" ? "mono" : P.mode === "poly" ? "poly" : "uni"+P.uni,
  v => {
    /* changing how voices are allocated under sounding notes leaves orphans, so clear */
    if (ctx) allNotesOff();
    if (v === "mono"){ P.mode = "mono"; P.uni = 1; }
    else if (v === "poly"){ P.mode = "poly"; P.uni = 1; }
    else { P.mode = "uni"; P.uni = parseInt(v.slice(3),10); }
    paintMeta();
  });
segPaint.motion = seg("#motion","m", () => SEQ.motion, v => {
  SEQ.motion = v;
  renderRoll();
  if (SEQ.playing && v === "off") stopPlay();
  paintMeta();
});
segPaint.seqMode = seg("#seqMode","p", () => SEQ.mode, v => {
  SEQ.mode = v;
  paintSteps(); paintLocks(); paintMeta();
  seqHint.textContent = v === "program"
    ? "click a step, then play a note to write it — every knob you move locks to that step"
    : (LANE_HINT[SEQ.lane] || "");
});
$("#clearLocks").addEventListener("click", e => {
  if (e.shiftKey){ SEQ.steps.forEach(st => { delete st.locks; }); }
  else { const st = SEQ.steps[SEQ.sel]; if (st) delete st.locks; }
  paintSteps(); paintLocks();
});
segPaint.arpDir = seg("#arpDir","d", () => SEQ.dir, v => { SEQ.dir = v; renderRoll(); });
segPaint.arpOct = seg("#arpOct","o", () => String(SEQ.octaves), v => { SEQ.octaves = +v; renderRoll(); });
segPaint.seqLane = seg("#seqLane","l", () => SEQ.lane, v => { SEQ.lane = v; renderSteps(); });
segPaint.noteOut = seg("#noteOut","o", () => MIDI.noteOut ? "on":"off",
  v => { MIDI.noteOut = v === "on"; if (!MIDI.noteOut) midiPanic(); });
segPaint.bassOn = seg("#bassOn","b", () => String(P.bass), v => {
  P.bass = +v;
  if (!P.bass && ctx) allBassOff(ctx.currentTime);
  paintBassNote(); paintMeta();
  if (typeof paintRoute === "function") paintRoute();
  if (typeof paintKeysNote === "function") paintKeysNote();
});
segPaint.bassWave = seg("#bassWave","w", () => P.bwave, v => { P.bwave = v; });
segPaint.vocOn = seg("#vocOn","v", () => String(P.voc), v => {
  P.voc = +v;
  applyVocoder(); paintKeys(); paintMeta();
  if (typeof paintRoute === "function") paintRoute();   // the note mentions this state
  if (typeof paintKeysNote === "function") paintKeysNote();
  if (P.voc && !modSrc) vocSay("Vocoder is on — hit <b>Listen</b> to open an input. "
    + "Until then the carrier has nothing to shape it, so those notes stay silent.");
});
segPaint.vocBands = seg("#vocBands","b", () => String(P.vocbands), v => {
  P.vocbands = +v; applyVocoder();
});
segPaint.keysTo = seg("#keysTo","k", () => keysTo, v => {
  keysTo = v; allNotesOff(); saveMap(); paintKeys(); paintMeta(); paintKeysNote();
});
/* The bass path already refused to play into a section that was switched off; the vocoder
   path did not, and silently swallowed the notes. Say so instead of eating them. */
function paintKeysNote(){
  const el = root.querySelector("#keysNote"); if (!el) return;
  const dead = (keysTo === "voc" || keysTo === "both") && !P.voc ? "vocoder"
             : keysTo === "bass" && !P.bass ? "bass" : null;
  el.innerHTML = dead
    ? "the <b>" + dead + "</b> section is off, so these notes make no sound"
    : "on-screen and computer keys only — incoming MIDI routes by channel";
  el.classList.toggle("bad", !!dead);
}

/* ---- keyboard ----
   Two octaves from C3. Black keys are placed against the white index they follow, so the
   layout stays right at any width. */
const KEY_BASE = 48;
const WHITE_PC = [0,2,4,5,7,9,11];
const BLACK_AFTER = {0:1, 1:3, 3:6, 4:8, 5:10};      // white index in octave -> semitone
const keysEl = $("#keys");
function buildKeys(){
  keysEl.innerHTML = "";
  for (let o = 0; o < 2; o++){
    for (let w = 0; w < 7; w++){
      const i = o*7 + w, midi = KEY_BASE + o*12 + WHITE_PC[w];
      const b = document.createElement("button");
      b.className = "kw"; b.style.setProperty("--i", i);
      b.dataset.n = midi; b.type = "button";
      b.setAttribute("aria-label", noteLabel(midi));
      if (WHITE_PC[w] === 0) b.innerHTML = '<span class="klabel">'+noteLabel(midi)+'</span>';
      keysEl.appendChild(b);
    }
  }
  for (let o = 0; o < 2; o++){
    for (let w = 0; w < 7; w++){
      if (BLACK_AFTER[w] == null) continue;
      const midi = KEY_BASE + o*12 + BLACK_AFTER[w];
      const b = document.createElement("button");
      b.className = "kb"; b.style.setProperty("--w", o*7 + w);
      b.dataset.n = midi; b.type = "button";
      b.setAttribute("aria-label", noteLabel(midi));
      keysEl.appendChild(b);
    }
  }
}
buildKeys();

/* Pointer capture on the CONTAINER, then resolve the key under the pointer on each move.
   With capture set, pointerenter/pointerover never fire on the individual keys — the
   capture target swallows them — so an enter-based glissando looks right and never slides. */
let kbDown = null;
function keyAt(x, y){
  const el = document.elementFromPoint(x, y);
  return el ? el.closest(".kw,.kb") : null;
}
keysEl.addEventListener("pointerdown", e => {
  const k = keyAt(e.clientX, e.clientY); if (!k) return;
  keysEl.setPointerCapture(e.pointerId);
  kbDown = k; noteOn(+k.dataset.n, 100); paintKeys();
  e.preventDefault();
});
keysEl.addEventListener("pointermove", e => {
  if (!keysEl.hasPointerCapture(e.pointerId) || !kbDown) return;
  const k = keyAt(e.clientX, e.clientY);
  if (k && k !== kbDown){
    noteOff(+kbDown.dataset.n);
    kbDown = k; noteOn(+k.dataset.n, 100);
    paintKeys();
  }
});
const kbUp = e => {
  if (kbDown){ noteOff(+kbDown.dataset.n); kbDown = null; paintKeys(); }
  try{ keysEl.releasePointerCapture(e.pointerId); }catch(err){}
};
keysEl.addEventListener("pointerup", kbUp);
keysEl.addEventListener("pointercancel", kbUp);
/* keyboard-accessible: space/enter on a focused key */
keysEl.addEventListener("keydown", e => {
  const k = e.target.closest(".kw,.kb"); if (!k) return;
  if (e.key !== " " && e.key !== "Enter") return;
  if (e.repeat) return;
  noteOn(+k.dataset.n, 100); paintKeys(); e.preventDefault();
});
keysEl.addEventListener("keyup", e => {
  const k = e.target.closest(".kw,.kb"); if (!k) return;
  if (e.key !== " " && e.key !== "Enter") return;
  noteOff(+k.dataset.n); paintKeys();
});
function paintKeys(){
  const syn = new Set(heldNotes.map(n => n.midi).concat([...polyVoices.keys()]));
  const bass = new Set(bassHeld.map(n => n.midi));
  keysEl.querySelectorAll(".kw,.kb").forEach(k => {
    const m = +k.dataset.n + octave*12;
    /* One key, one colour. Bass and vocoder win over the synth when a note is in more than
       one section, because they are the ones you would otherwise not notice. */
    const isBass = bass.has(m), isVoc = carriers.has(m), isSyn = syn.has(m);
    k.classList.toggle("on-bass", isBass);
    k.classList.toggle("on-voc",  !isBass && isVoc);
    k.classList.toggle("on",      !isBass && !isVoc && isSyn);
    k.classList.toggle("tint-voc",  keysTo === "voc"  || keysTo === "both");
    k.classList.toggle("tint-bass", keysTo === "bass");
  });
}

/* ---- step grid ---- */
const seqWrap = $("#seqWrap"), seqLenSel = $("#seqLen"), seqRateSel = $("#seqRate"),
      seqHint = $("#seqHint");
const seqKeySel = $("#seqKey"), seqScaleSel = $("#seqScale");
NOTE_NAMES.forEach((nm, pc) => seqKeySel.appendChild(Object.assign(
  document.createElement("option"), {value:String(pc), textContent:nm})));
Object.keys(SCALES).forEach(k => seqScaleSel.appendChild(Object.assign(
  document.createElement("option"), {value:k, textContent:SCALE_LABEL[k]})));
seqKeySel.addEventListener("change", () => {
  /* keep the root's octave, move its pitch class — "key" and "where the pattern sits"
     are the same knob, which is one control instead of two */
  const oct = Math.floor(SEQ.root / 12);
  SEQ.root = clampf(oct*12 + parseInt(seqKeySel.value,10), 0, 127);
  paintSeqKey();
});
seqScaleSel.addEventListener("change", () => { SEQ.scale = seqScaleSel.value; paintSeqKey(); });
function paintSeqKey(){
  seqKeySel.value = String(keyPcOf());
  seqScaleSel.value = SEQ.scale;
  seqHint.textContent = LANE_HINT[SEQ.lane] || "";
  paintSteps();                     // the pad labels are key-dependent
}

[8,12,16,24,32,48,64].forEach(n => seqLenSel.appendChild(
  Object.assign(document.createElement("option"), {value:String(n), textContent:n+" steps"})));
Object.keys(RATES).forEach(r => seqRateSel.appendChild(
  Object.assign(document.createElement("option"), {value:r, textContent:r})));
seqLenSel.value = "16"; seqRateSel.value = "1/16";

const LANE_HINT = {
  on:"click a step to turn it on or off",
  pitch:"drag a step up or down to move it in semitones",
  accent:"accent lifts velocity and opens the filter further",
  slide:"slide glides into the step without re-attacking it",
  tie:"tie extends the note before it through this step"
};
function renderSteps(){
  seqWrap.innerHTML = "";
  const rows = Math.ceil(SEQ.len / 8);
  for (let r = 0; r < rows; r++){
    const row = document.createElement("div");
    row.className = "seqrow";
    const lab = document.createElement("span");
    lab.className = "rlab"; lab.textContent = (r*8 + 1) + "–" + Math.min(SEQ.len, r*8+8);
    row.appendChild(lab);
    const grid = document.createElement("div");
    grid.className = "steps";
    for (let c = 0; c < 8; c++){
      const i = r*8 + c;
      if (i >= SEQ.len) break;
      const b = document.createElement("button");
      b.className = "step"; b.type = "button"; b.dataset.i = i;
      if (i % 4 === 0) b.classList.add("beat");
      grid.appendChild(b);
    }
    row.appendChild(grid);
    seqWrap.appendChild(row);
  }
  paintSteps();
  seqHint.textContent = LANE_HINT[SEQ.lane] || "";
}
function paintSteps(){
  seqWrap.querySelectorAll(".step").forEach(b => {
    const st = SEQ.steps[+b.dataset.i];
    b.classList.toggle("on", !!st.on && !st.tie);
    b.classList.toggle("acc", !!st.accent && !!st.on);
    b.classList.toggle("sld", !!st.slide && !!st.on);
    b.classList.toggle("tie", !!st.tie);
    b.classList.toggle("sel", SEQ.mode === "program" && +b.dataset.i === SEQ.sel);
    b.classList.toggle("lock", !!(st.locks && Object.keys(st.locks).length));
    /* the note it will play, quantised to the current key — a tie has no note of its own */
    b.textContent = (!st.on || st.tie) ? "" : noteLabel(stepNote(st, true));
  });
}
/* Highlight the knobs that are locked on the selected step, so a p-lock is something you
   can see rather than remember. */
function paintLocks(){
  const st = SEQ.mode === "program" ? SEQ.steps[SEQ.sel] : null;
  const L = (st && st.locks) || {};
  Object.keys(ctlReg).forEach(id => {
    const el = ctlReg[id] && ctlReg[id].el;
    if (el) el.classList.toggle("locked", Object.prototype.hasOwnProperty.call(L, id));
  });
}
/* Called whenever a knob moves. In program mode that IS the gesture for locking — there is
   no separate arm step, the same as recording a note by holding one and clicking. */
function lockKnob(id){
  if (SEQ.mode !== "program") return;
  const st = SEQ.steps[SEQ.sel]; if (!st) return;
  (st.locks || (st.locks = {}))[id] = P[id];
  paintSteps(); paintLocks();
}
function selectStep(i){
  SEQ.sel = ((i % SEQ.len) + SEQ.len) % SEQ.len;
  paintSteps(); paintLocks();
}
/* Rebuilt whenever the run itself changes — held notes, direction, octave range — and only
   re-classed during playback, so the animation costs one class toggle per step. */
const arpRoll = $("#arpRoll");
const ROLL_H = 70, ROLL_NOTE = 9;      // must match the .roll / .rollnote CSS
/* The arp and the sequencer are different instruments sharing a rack: one plays what you
   hold, the other plays what you wrote. Showing a step grid the arp does not read was just
   a second thing to scan past. */
function paintMotionView(){
  const arp = SEQ.motion === "arp";
  arpRoll.hidden = !arp;
  seqWrap.hidden = arp;
  $$("[data-seqonly]").forEach(el => { el.hidden = arp; });
  $$("[data-arponly]").forEach(el => { el.hidden = !arp; });
}
function renderRoll(){
  paintMotionView();
  const on = SEQ.motion === "arp";
  if (!on) return;
  const seq = arpSequence();
  if (!seq.length){
    arpRoll.innerHTML = '<span class="rollhint">hold notes to build a run</span>';
    return;
  }
  const lo = Math.min.apply(null, seq), hi = Math.max.apply(null, seq);
  const span = Math.max(1, hi - lo);
  const w = 100 / seq.length;
  arpRoll.innerHTML =
    '<span class="rolllab">' + noteLabel(lo) + " – " + noteLabel(hi)
      + "  ·  " + seq.length + " steps</span>"
    + seq.map((n, i) =>
        '<i class="rollnote" data-i="' + i + '" title="' + noteLabel(n) + '"'
        + ' style="left:' + (i*w + w*0.12).toFixed(2) + '%;width:' + (w*0.76).toFixed(2) + '%;'
        /* The strip is 70px and a block is 9px, so the highest note's bottom edge can only
           go to 70 - 9 - 6 of padding. Using the full height clipped the top note. */
        + 'bottom:' + (6 + (n - lo)/span * (ROLL_H - ROLL_NOTE - 12)).toFixed(1)
        + 'px"></i>').join("");
}
function paintRoll(cur){
  if (arpRoll.hidden) return;
  const ai = cur && cur.ai != null ? cur.ai : -1;
  const notes = arpRoll.querySelectorAll(".rollnote");
  for (let i = 0; i < notes.length; i++)
    notes[i].classList.toggle("now", +notes[i].dataset.i === ai);
}
function clearStepMarks(){
  seqWrap.querySelectorAll(".step").forEach(b => b.classList.remove("now"));
  arpRoll.querySelectorAll(".rollnote").forEach(b => b.classList.remove("now"));
}
seqWrap.addEventListener("pointerdown", e => {
  const b = e.target.closest(".step"); if (!b) return;
  const st = SEQ.steps[+b.dataset.i];
  /* Hold a note and click a step to record it. No record mode to arm or forget — if a key
     is down you are recording, if it is not you are editing. The pitch is stored raw and
     quantised to the scale on playback, so changing key afterwards re-reads the pattern
     rather than destroying it. */
  if (SEQ.mode === "program" && SEQ.sel !== +b.dataset.i){
    selectStep(+b.dataset.i);        // first click selects; click again to edit the lane
    return;
  }
  if (heldNotes.length){
    writeStep(st, heldNotes[heldNotes.length - 1].midi);
    paintSteps();
    return;
  }
  if (SEQ.lane === "pitch"){
    b.setPointerCapture(e.pointerId);
    b._y = e.clientY; b._p = st.pitch + 12*st.oct;
    return;
  }
  if (SEQ.lane === "on")      st.on = st.on ? 0 : 1;
  else if (SEQ.lane === "accent") st.accent = st.accent ? 0 : 1;
  else if (SEQ.lane === "slide")  st.slide  = st.slide ? 0 : 1;
  else if (SEQ.lane === "tie")    st.tie    = st.tie ? 0 : 1;
  paintSteps();
});
seqWrap.addEventListener("pointermove", e => {
  const b = e.target.closest(".step");
  if (!b || !b.hasPointerCapture || !b.hasPointerCapture(e.pointerId)) return;
  const st = SEQ.steps[+b.dataset.i];
  const d = Math.round((b._y - e.clientY)/8);
  const v = clampf(b._p + d, -24, 24);
  st.oct = Math.trunc(v/12); st.pitch = v - 12*st.oct;
  paintSteps();
});
seqWrap.addEventListener("pointerup", e => {
  const b = e.target.closest(".step");
  if (b && b.hasPointerCapture && b.hasPointerCapture(e.pointerId))
    try{ b.releasePointerCapture(e.pointerId); }catch(err){}
});
seqLenSel.addEventListener("change", () => {
  SEQ.len = parseInt(seqLenSel.value, 10);
  /* keep the playhead inside the new length rather than letting it run off the end */
  stepIndex = stepIndex % SEQ.len;
  renderSteps();
});
seqRateSel.addEventListener("change", () => { SEQ.rate = seqRateSel.value; applyDelay(); });
renderSteps();
paintSeqKey();
paintLocks();
renderRoll();

/* ---- horizontal faders (gate & swing) ----
   Registered in the same ctlReg as the knobs, so MIDI learn and CC drive them for free. */
function makeHFader(sel, get, set, fmt, id){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  function render(){
    cap.style.setProperty("--v", get());
    val.textContent = fmt(get());
    el.setAttribute("aria-valuenow", Math.round(get()*100));
    el.setAttribute("aria-valuetext", fmt(get()));
  }
  function put(v){ set(clampf(v, 0, 1)); render(); }
  function fromEvent(e){
    const r = slot.getBoundingClientRect();
    put((e.clientX - r.left - 11)/(r.width - 22));
  }
  el.addEventListener("pointerdown", e => {
    if (LEARN.on){ arm({type:"ctl", id}, el); e.preventDefault(); return; }
    el.setPointerCapture(e.pointerId); el.classList.add("dragging");
    fromEvent(e); e.preventDefault();
  });
  el.addEventListener("pointermove", e => { if (el.hasPointerCapture(e.pointerId)) fromEvent(e); });
  el.addEventListener("pointerup", e => {
    el.classList.remove("dragging");
    try{ el.releasePointerCapture(e.pointerId); }catch(err){}
  });
  el.addEventListener("keydown", e => {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowUp") put(get() + .02);
    else if (k === "ArrowLeft" || k === "ArrowDown") put(get() - .02);
    else if (k === "Home") put(0); else if (k === "End") put(1);
    else return;
    e.preventDefault();
  });
  ctlReg[id] = {set:put, render, el};
  render();
}
makeHFader("#gateFader", () => SEQ.gate, v => SEQ.gate = clampf(v,.05,1),
           v => Math.round(v*100)+"%", "gate");
/* swing is stored .5..75 but presented 0..1 on the fader, same model as CS·1's SW.ratio */
makeHFader("#swingFader", () => (SEQ.swing - .5)/.25, v => SEQ.swing = .5 + v*.25,
           v => v <= .02 ? "straight" : Math.round((.5 + v*.25)*100)+"%", "swing");

/* The modulator meter's painter lived in the block below and went with it. The engine
   above still calls start/stop, so they stay as no-ops rather than leaving a reference
   that only throws when a section nobody can switch on is switched on. */
function startModMeter(){}
function stopModMeter(){}
function paintModMeter(){}

/* The vocoder's controls went with its rack — see VC·1. The engine below them is still
   here and is unreachable: nothing on this panel can set P.voc, and the schema pins it to
   0. Taking the engine out is a separate job, because MS·1's three sections were
   interwoven through the UI layer rather than stacked, and the safe order is to make it
   unreachable first and prove that, which is what the patch-render comparison does. */

/* ---- readouts ----
   rAF is paused in a hidden tab (and never fires at all in a headless pane), so anything
   that MUST be correct is also written on the event that changed it, not only here. */
function paintNow(){
  /* everything sounding, both sections — a vocoder chord is still a chord */
  const sounding = heldNotes.map(n => n.midi).concat([...carriers.keys()]);
  const uniq = [...new Set(sounding)];
  if (!uniq.length){
    nowNote.firstChild.nodeValue = "—";
    nowDetail.textContent = "";
    return;
  }
  const name = chordName(uniq);
  nowNote.firstChild.nodeValue = uniq.length === 1 ? noteLabel(uniq[0]) : name;
  const bits = [];
  if (uniq.length > 1)
    bits.push(uniq.sort((a,b) => a-b).map(noteLabel).join(" "));
  if (bendCents) bits.push((bendCents > 0 ? "+" : "") + Math.round(bendCents) + "¢");
  if (P.mode === "uni") bits.push("×" + P.uni);
  nowDetail.textContent = bits.join("   ");
  if (typeof renderRoll === "function") renderRoll();
}
function paintMeta(){
  const bits = [
    P.mode === "uni" ? "unison ×"+P.uni : P.mode === "poly" ? "poly ×"+MAX_POLY : "mono",
    P.gmode === "off" ? "no glide" : P.gmode,
    SEQ.motion === "off" ? "free" : SEQ.motion
  ];
  if (P.voc) bits.push("vocoder " + P.vocbands + "b");
  if (P.bass) bits.push("bass " + P.boct + " oct");
  bits.push("keys → " + keysTo);
  if (SEQ.mode === "program") bits.push("PROGRAM step " + (SEQ.sel + 1));
  voiceMeta.textContent = bits.join(" · ");
}
function paint(){
  if (!SEQ.playing) return;
  const now = ctx.currentTime;
  let cur = null;
  for (const m of marks) if (now >= m.t && now < m.end) cur = m;
  seqWrap.querySelectorAll(".step").forEach(b =>
    b.classList.toggle("now", !!cur && +b.dataset.i === cur.i));
  paintRoll(cur);
  meterTick();
  requestAnimationFrame(paint);
}
/* peak meter — the only way to know a patch is hot without guessing */
let peakHold = 0, peakAt = 0;
const meterEl = $("#ioStats");
function meterTick(){
  if (!analyser) return;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let pk = 0;
  for (let i = 0; i < buf.length; i++){ const a = Math.abs(buf[i]); if (a > pk) pk = a; }
  const now = performance.now();
  if (pk >= peakHold || now - peakAt > 1500){ peakHold = pk; peakAt = now; }
  ioStats(peakHold);
}

/* ---- transport controls ---- */
playBtn.addEventListener("click", () => {
  ensureAudio();
  if (SEQ.playing){ stopPlay(); SEQ.autoStart = false; }
  else { SEQ.autoStart = false; startPlay(); }   // started by hand: keys will not stop it
});
$("#hold").addEventListener("click", () => {
  latch = !latch;
  $("#hold").classList.toggle("on", latch);
  $("#hold").setAttribute("aria-pressed", latch ? "true" : "false");
  if (!latch) allNotesOff();
});
function setBpm(v, fromShell){
  SEQ.bpmExact = clampf(v, 40, 240);
  SEQ.bpm = Math.round(SEQ.bpmExact);
  tempoOut.textContent = SEQ.bpm;
  applyDelay();                       // a synced delay follows the tempo
  /* one tempo for the page — see CS·1's setBpm for why fromShell exists */
  if (!fromShell) Patchwork.clock.setBpm(SEQ.bpmExact, "pm1");
}
Patchwork.clock.onTempo("pm1", v => setBpm(v, true), SEQ.bpmExact);
$("#bpmDown").addEventListener("click", () => setBpm(SEQ.bpmExact - 1));
$("#bpmUp").addEventListener("click", () => setBpm(SEQ.bpmExact + 1));
function setOctave(v){
  octave = clampf(v|0, -3, 3);
  octOut.textContent = (octave > 0 ? "+" : "") + octave;
}
$("#octDown").addEventListener("click", () => setOctave(octave - 1));
$("#octUp").addEventListener("click", () => setOctave(octave + 1));
$("#panic").addEventListener("click", () => {
  if (SEQ.playing) stopPlay();
  allNotesOff();
  midiPanic();
  say("Panic sent — all sound off, all notes off and sustain up on all 16 channels.");
});

/* computer keyboard, so the thing is playable without hardware */
const KEYMAP = {a:0,w:1,s:2,e:3,d:4,f:5,t:6,g:7,y:8,h:9,u:10,j:11,k:12,o:13,l:14,p:15,";":16};
const kbHeld = new Set();
onKey("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ SEQ.playing ? stopPlay() : startPlay(); e.preventDefault(); return; }
  /* Arrow keys walk the pattern while programming. Skipped when a knob or fader has focus,
     because those use arrows themselves and the event bubbles up to here. */
  if (SEQ.mode === "program" && e.key.indexOf("Arrow") === 0
      && !(e.target.closest && e.target.closest(".knob,.hfader"))){
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1
            : e.key === "ArrowDown" ? 8 : e.key === "ArrowUp" ? -8 : 0;
    if (d){ selectStep(SEQ.sel + d); e.preventDefault(); return; }
  }
  const k = KEYMAP[e.key.toLowerCase()];
  if (k == null || e.repeat || kbHeld.has(k)) return;
  kbHeld.add(k); noteOn(KEY_BASE + k, 100); paintKeys(); e.preventDefault();
});
onKey("keyup", e => {
  const k = KEYMAP[e.key.toLowerCase()];
  if (k == null || !kbHeld.has(k)) return;
  kbHeld.delete(k); noteOff(KEY_BASE + k); paintKeys();
});

