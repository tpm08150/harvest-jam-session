/* ============ transport & sequencer ============ */
/* bpmExact drives the grid; SEQ.bpm is display only. CS·1 learned this the expensive way —
   deriving step length from a rounded tempo is a fraction of a percent off, inaudible for
   one bar and a quarter-second of drift per minute against external gear. */
const SEQ = {
  bpm:120, bpmExact:120, playing:false,
  motion:"off",                 // off | arp | seq
  len:16, rate:"1/16", gate:.5, swing:.5,
  dir:"up", octaves:1,
  root:36, scale:"chromatic", vel:88, accentAmt:.8, autoStart:false,
  /* play: keys start the pattern and steer it. program: keys WRITE to the selected step,
     and every knob you move is locked to that step. */
  mode:"play", sel:0,
  lane:"on",
  steps:[]
};
const MAX_STEPS = 64;
const S = (on,p,o,g,a,sl,ti) => ({on, pitch:p, oct:o, gate:g, accent:a, slide:sl, tie:ti});
/* Turn a played note into a step. The distance from the root is split across `oct` and
   `pitch` rather than crammed into pitch alone — pitch is only +-24, so forcing oct to 0
   silently truncated anything more than two octaves up (G4 over a C2 root recorded as C4). */
function writeStep(st, midi){
  const rel = clampf(Math.round(midi - SEQ.root), -48, 48);
  const oct = clampf(Math.trunc(rel/12), -2, 2);
  st.oct = oct;
  st.pitch = rel - 12*oct;
  st.on = 1; st.tie = 0;
}
/* A C-minor acid line, so accent, tie and slide are all audible on the first Play without
   the player having to build a pattern to hear what the buttons do. */
const DEFAULT_STEPS = [
  S(1,0,0,.55,1,0,0), S(0,0,0,.5,0,0,0),  S(1,0,0,.45,0,0,0), S(1,12,0,.35,0,0,0),
  S(0,0,0,.5,0,0,0),  S(1,0,0,.5,0,0,0),  S(1,0,0,.5,0,0,1),  S(1,10,0,.45,1,0,0),
  S(1,0,0,.55,0,0,0), S(0,0,0,.5,0,0,0),  S(1,3,0,.45,0,0,0), S(1,5,0,.60,0,1,0),
  S(0,0,0,.5,0,0,0),  S(1,10,0,.45,1,0,0),S(1,7,-1,.40,0,0,0),S(0,0,0,.5,0,0,0)
];
function resetSteps(){
  SEQ.steps = [];
  /* MAX_STEPS is allocated regardless of the current length, so changing length never
     has to reallocate and a pattern written at 64 survives a trip down to 16 and back. */
  for (let i = 0; i < MAX_STEPS; i++)
    SEQ.steps.push(i < 16 ? Object.assign({}, DEFAULT_STEPS[i]) : S(0,0,0,.5,0,0,0));
}
resetSteps();

const RATES = {"1/4":1, "1/4t":1.5, "1/8":2, "1/8t":3, "1/16":4, "1/16t":6, "1/32":8};

/* ---- key and scale ----
   The sequencer stores each step as semitones from the root, but PLAYS it through a scale.
   That is what lets a held note transpose the pattern without dragging it out of key:
   the shift is counted in scale DEGREES, not semitones, so a third stays a third. */
const SCALES = {
  chromatic:  [0,1,2,3,4,5,6,7,8,9,10,11],
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],
  harmminor:  [0,2,3,5,7,8,11],
  dorian:     [0,2,3,5,7,9,10],
  phrygian:   [0,1,3,5,7,8,10],
  lydian:     [0,2,4,6,7,9,11],
  mixolydian: [0,2,4,5,7,9,10],
  pentmaj:    [0,2,4,7,9],
  pentmin:    [0,3,5,7,10],
  blues:      [0,3,5,6,7,10]
};
const SCALE_LABEL = {chromatic:"Chromatic", major:"Major", minor:"Minor",
  harmminor:"Harmonic min", dorian:"Dorian", phrygian:"Phrygian", lydian:"Lydian",
  mixolydian:"Mixolydian", pentmaj:"Penta maj", pentmin:"Penta min", blues:"Blues"};

const keyPcOf = () => (((SEQ.root % 12) + 12) % 12);
/* the key's root in octave 4 — playing it transposes by nothing */
const keyRefNote = () => 60 + keyPcOf();

/* Semitone <-> scale degree, both relative to the key root. A semitone that is not in the
   scale rounds DOWN to the degree below it, so an off-scale recording still plays in key. */
function toDegree(semi, keyPc, sc){
  const d = semi - keyPc;
  const oct = Math.floor(d / 12);
  const rel = ((d % 12) + 12) % 12;
  let idx = 0;
  for (let i = 0; i < sc.length; i++) if (sc[i] <= rel) idx = i;
  return oct * sc.length + idx;
}
function fromDegree(deg, keyPc, sc){
  const n = sc.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return keyPc + oct * 12 + sc[idx];
}
/* How far the currently held note moves the pattern, in scale degrees. */
function seqShift(keyPc, sc){
  const t = pick();
  if (!t) return 0;
  return toDegree(t.midi, keyPc, sc) - toDegree(keyRefNote(), keyPc, sc);
}
/* The note a step plays. `atRest` skips the held-note transposition, which is what the pad
   labels want — a label that moved with whatever you were holding would be unreadable. */
function stepNote(st, atRest){
  const base = SEQ.root + st.pitch + 12 * st.oct;
  const sc = SCALES[SEQ.scale] || SCALES.chromatic;
  if (SEQ.scale === "chromatic"){
    const t = atRest ? null : pick();
    return clampf(base + (t ? t.midi - keyRefNote() : 0), 0, 127);
  }
  const keyPc = keyPcOf();
  const shift = atRest ? 0 : seqShift(keyPc, sc);
  return clampf(fromDegree(toDegree(base, keyPc, sc) + shift, keyPc, sc), 0, 127);
}
const beatSeconds = () => 60 / (SEQ.bpmExact || SEQ.bpm);
const stepSeconds = () => beatSeconds() / (RATES[SEQ.rate] || 4);
/* Swing as the share of each step PAIR given to the first note: .5 straight, .667 triplet,
   .75 a hard shuffle. Same model as CS·1, so the two instruments shuffle identically. */
const swungAt = (s, step) => s*step + ((s % 2) ? step*(2*SEQ.swing - 1) : 0);

/* One event list, consumed by both the internal engine and MIDI out, so the two cannot
   drift apart. Straight out of CS·1's chordEvents() lesson. */
function stepEvent(i, t){
  const st = SEQ.steps[i % SEQ.len];
  if (!st || !st.on || st.tie) return null;
  const step = stepSeconds();
  const at = t, gap = swungAt(1, step);
  /* a tie extends this note through the following tied steps rather than sounding them */
  let span = 1;
  while (span < SEQ.len && SEQ.steps[(i + span) % SEQ.len].tie) span++;
  const dur = Math.max(.02, gap * span * (st.slide ? 1 : clampf(st.gate, .05, 1)));
  return {
    n: stepNote(st),
    t: at,
    d: dur,
    vel: clampf(Math.round(SEQ.vel * (st.accent ? 1 + SEQ.accentAmt*.45 : 1)), 1, 127),
    accent: !!st.accent,
    slide: !!st.slide
  };
}

function arpSequence(){
  const base = [];
  const notes = heldNotes.map(n => n.midi).sort((a,b) => a-b);
  if (!notes.length) return [];
  for (let o = 0; o < SEQ.octaves; o++)
    notes.forEach(n => { const p = n + 12*o; if (p <= 127) base.push(p); });
  base.sort((a,b) => a-b);
  if (SEQ.dir === "down") return base.slice().reverse();
  if (SEQ.dir === "updown") return base.length > 2 ? base.concat(base.slice(1,-1).reverse()) : base;
  return base;
}

/* ---- scheduling ----
   25 ms interval, 200 ms lookahead, straight from CS·1's tick(). The sequencer owns the
   voice while it runs, so slide and tie can act on a note that is already sounding. */
let timer = null, nextTime = 0, stepIndex = 0, marks = [], arpIdx = 0;

/* Slide is the one thing that makes a 303 line sound like a 303: portamento INTO the step
   with no amp retrigger, so the two notes are one continuous gesture. It only works if the
   previous note was never released, which is why the scheduler looks one step ahead. */
function nextSounding(i){
  for (let k = 1; k <= SEQ.len; k++){
    const st = SEQ.steps[(i + k) % SEQ.len];
    if (st && st.on && !st.tie) return {st, k};
  }
  return null;
}

function seqFire(ev, slideIn, holdOn){
  ensureAudio();
  const slideT = Math.max(.005, Math.min(.25, stepSeconds() * .45));
  if (!curVoice || curVoice.released){
    curVoice = buildVoice(ev.n, ev.vel, ev.t);
    retriggerLfo();
    if (lfoFade){
      lfoFade.gain.cancelScheduledValues(ev.t);
      if (P.lfod > 0){
        lfoFade.gain.setValueAtTime(0, ev.t);
        lfoFade.gain.linearRampToValueAtTime(1, ev.t + P.lfod);
      } else lfoFade.gain.setValueAtTime(1, ev.t);
    }
  } else if (slideIn){
    curVoice.setPitch(ev.t, ev.n, slideT);         // no retrigger — that is the point
    curVoice.peak.gain.setTargetAtTime(
      (1 - P.vela + P.vela*(ev.vel/127)) * db2lin(P.trim + (CAT_TRIM[P.cat] || 0)),
      ev.t, .01);
  } else {
    curVoice.retrigger(ev.t, ev.n, ev.vel, 0);
  }
  if (!holdOn){
    const v = curVoice;
    v.release(ev.t + ev.d);
    curVoice = null;          // the next event builds a fresh voice, as it should
  }
  if (MIDI.noteOut) sendNote(ev.n, ev.t, ev.d, ev.vel);
}

function scheduleStep(i, t){
  if (SEQ.motion === "seq"){
    const ev = stepEvent(i, t);
    if (!ev) return;
    const nx = nextSounding(i);
    const slideNext = !!(nx && nx.st.slide);
    if (slideNext) ev.d = swungAt(1, stepSeconds()) * nx.k;   // hold right into the slide
    const st = SEQ.steps[i % SEQ.len];
    withLocks(st, () => seqFire(ev, false, slideNext));
    /* the slide flag on THIS step means it was slid into, handled when it was scheduled */
    if (st.slide && curVoice) {/* nothing further */}
  } else if (SEQ.motion === "arp"){
    const seq = arpSequence();
    if (!seq.length) return;
    let idx;
    if (SEQ.dir === "random"){
      idx = Math.floor(Math.random()*seq.length);
      if (seq.length > 1 && idx === arpIdx) idx = (idx + 1) % seq.length;
    } else idx = arpIdx % seq.length;
    arpIdx = idx + 1;
    const step = stepSeconds(), gap = swungAt(1, step);
    const ev = {n:seq[idx], t, d:Math.max(.02, gap*clampf(SEQ.gate,.05,1)), vel:SEQ.vel};
    seqFire(ev, false, false);
    return idx;                       // so the roll can light the note that just fired
  }
}

function tick(){
  const step = stepSeconds();
  while (nextTime < ctx.currentTime + .2){
    const at = Math.max(ctx.currentTime + .005, nextTime);
    /* a queued scene lands on the loop point, ahead of this step being scheduled — see
       shell/scenes.js for why this cannot be done on wall time */
    Patchwork.scenes.take("pm1", at);
    /* take() can STOP this instrument, when the row it fired has nothing for it.
       The loop would otherwise carry on scheduling into a transport that is no
       longer running and leave a bar of notes behind after the stop. */
    if (!SEQ.playing) return;
    const ai = scheduleStep(stepIndex, at);
    marks.push({i:stepIndex % SEQ.len, ai:ai, t:at, end:at + step});
    /* swing advances alternately 2*sw*step and (2-2*sw)*step, summing to 2*step over a
       pair, so the pattern's total length is unchanged however hard it shuffles */
    /* the shared rate trim: PM·1 has no clock follow of its own, so this is how it
       follows external clock at all — it runs at whatever rate the lock has settled on */
    const r = Patchwork.clock.rate;
    nextTime += r * ((stepIndex % 2 === 0) ? 2*SEQ.swing*step : (2 - 2*SEQ.swing)*step);
    stepIndex++;
  }
  while (marks.length > 24) marks.shift();
}

function startPlay(){
  ensureAudio();
  if (SEQ.motion === "off"){
    sayPatch("Motion is Off — pick <b>Arp</b> or <b>Seq</b> for Play to do anything.");
    return;
  }
  SEQ.playing = true;
  stepIndex = 0; arpIdx = 0; marks = [];
  /* see CS·1's startPlay — the shell lands this on the running grid when there is one */
  nextTime = Patchwork.clock.claim(4);
  tick();
  Patchwork.clock.run(tick);
  timer = tick;
  playBtn.classList.add("on");
  playBtn.textContent = "■ Stop";
  requestAnimationFrame(paint);
}
function stopPlay(){
  SEQ.playing = false;
  SEQ.autoStart = false;
  Patchwork.clock.stop(tick); timer = null;
  const t = ctx ? ctx.currentTime : 0;
  if (curVoice){ curVoice.release(t); curVoice = null; }
  active.forEach(v => { try{ v.release(t); }catch(e){} });
  midiPanic();
  playBtn.classList.remove("on");
  playBtn.textContent = "▶ Play";
  clearStepMarks();
}

