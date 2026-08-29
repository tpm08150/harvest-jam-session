
/* A step sequencer any instrument can mount.

   MS·1 grew one for its synth section and it never served the vocoder or the bass — the
   old notes say so outright: "the sequencer and arpeggiator drive the synth section
   only". Splitting MS·1 into three instruments made that a problem rather than a
   documented limit, because now two of the three have no sequencer at all.

   So this is a factory, not a module: call it once per instrument and you get your own
   state, your own grid and your own transport, all on the shell's clock. It is
   deliberately the SIMPLER of the two models in the repo — pitch, gate, accent, slide and
   tie, with key and scale, but no per-step parameter locks. PM·1 keeps MS·1's richer
   version because its patches use locks; there was no case for forcing that complexity
   onto a bass line.

   The caller supplies fire(ev, t) and gets everything else. */
Patchwork.makeSeq = function(spec){
"use strict";
const MAX = spec.maxSteps || 64;
const V = Patchwork.voice;

const SEQ = {
  len: spec.len || 16, rate: spec.rate || "1/16", swing: .5,
  playing: false, root: spec.root == null ? 36 : spec.root, scale: "minor",
  gate: .5, accentAmt: .3, octaves: 0, sel: 0, mode: "play"
};

const S = () => ({on: 0, pitch: 0, oct: 0, gate: .5, accent: 0, slide: 0, tie: 0});
/* MAX allocated whatever the current length, so shortening never loses what is past the
   end and lengthening never has to reallocate. */
const steps = Array.from({length: MAX}, S);

const RATES = {"1/4":1, "1/4t":1.5, "1/8":2, "1/8t":3, "1/16":4, "1/16t":6, "1/32":8};
const SCALES = {
  chromatic:[0,1,2,3,4,5,6,7,8,9,10,11],
  major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10],
  dorian:[0,2,3,5,7,9,10], phrygian:[0,1,3,5,7,8,10],
  mixolydian:[0,2,4,5,7,9,10], pentMinor:[0,3,5,7,10], pentMajor:[0,2,4,7,9]
};

/* A step stores semitones from the root but PLAYS through the scale, so transposing by a
   degree stays in key — the same model MS·1 uses, and the reason holding the 2nd in C
   major turns C-E-G into D-F-A rather than C#-F-G#. */
function stepNote(st){
  const sc = SCALES[SEQ.scale] || SCALES.chromatic;
  if (SEQ.scale === "chromatic") return SEQ.root + st.pitch + 12 * st.oct;
  const deg = st.pitch;
  const oct = Math.floor(deg / sc.length) + st.oct;
  let idx = deg % sc.length; if (idx < 0) idx += sc.length;
  return SEQ.root + sc[idx] + 12 * oct;
}

const beatSeconds = () => 60 / (Patchwork.clock.bpm || 120);
const stepSeconds = () => beatSeconds() / (RATES[SEQ.rate] || 4);

/* The single source of truth for what a step plays. The engine and MIDI out both read
   this, so what sounds and what leaves the port cannot drift. */
function stepEvent(i, t){
  const st = steps[i % SEQ.len];
  if (!st.on) return null;
  let hold = 1;
  /* a tie extends the step before it rather than sounding on its own */
  for (let k = 1; k < SEQ.len; k++){
    const nx = steps[(i + k) % SEQ.len];
    if (!nx.tie) break;
    hold++;
  }
  return {n: stepNote(st), i: i % SEQ.len, hold,
          vel: st.accent ? 1 : 1 - SEQ.accentAmt,
          gate: st.gate, slide: !!st.slide, accent: !!st.accent};
}

let nextTime = 0, stepIndex = 0, marks = [];

function tick(){
  const ctx = Patchwork.audio.ctx;
  if (!ctx) return;
  const step = stepSeconds();
  while (nextTime < ctx.currentTime + .2){
    const at = Math.max(ctx.currentTime + .005, nextTime);
    if (stepIndex % SEQ.len === 0 && spec.id) Patchwork.scenes.take(spec.id);
    /* take() can STOP this instrument, when the row it fired has nothing for it.
       The loop would otherwise carry on scheduling into a transport that is no
       longer running and leave a bar of notes behind after the stop. */
    if (!SEQ.playing) return;
    const st = steps[stepIndex % SEQ.len];
    if (!st.tie){
      const ev = stepEvent(stepIndex, at);
      if (ev){
        ev.t = at;
        ev.dur = Math.max(.02, step * ev.hold * V.clampf(ev.gate, .05, 1));
        spec.fire(ev, at);
      }
    }
    marks.push({i: stepIndex % SEQ.len, t: at, end: at + step});
    /* swing advances alternately 2*sw*step and (2-2*sw)*step, summing to 2*step over a
       pair, so the pattern's length is unchanged however hard it shuffles — CS·1's model,
       shared so all four instruments shuffle identically */
    const r = Patchwork.clock.rate;
    nextTime += r * ((stepIndex % 2 === 0) ? 2*SEQ.swing*step : (2 - 2*SEQ.swing)*step);
    stepIndex++;
  }
  while (marks.length > 40) marks.shift();
}

function start(){
  if (SEQ.playing) return;
  SEQ.playing = true;
  stepIndex = 0; marks = [];
  nextTime = Patchwork.clock.claim(4);      // lands on the running grid — shell/clock.js
  tick();
  Patchwork.clock.run(tick);
  if (spec.onState) spec.onState(true);
}
function stop(){
  if (!SEQ.playing) return;
  SEQ.playing = false;
  Patchwork.clock.stop(tick);
  marks = [];
  if (spec.onState) spec.onState(false);
}

/* Which step is sounding NOW, looked up against the audio clock. Reading stepIndex would
   give the lookahead's position, up to 200 ms ahead of what you can hear. */
function playingStep(){
  const ctx = Patchwork.audio.ctx;
  if (!ctx || !SEQ.playing) return -1;
  const now = ctx.currentTime;
  for (let k = marks.length - 1; k >= 0; k--)
    if (marks[k].t <= now && now < marks[k].end) return marks[k].i;
  return -1;
}

/* ---- live recording ----
   Write a played note onto the grid at the NEAREST step, not the one currently sounding.
   A player anticipates the beat — landing everything on the step that has already started
   pushes a whole take late by up to a step, which is the difference between a recording
   that feels played and one that feels dragged.

   The pitch is stored as a scale degree from the root, the same as a step written by hand,
   so a recorded line transposes with the key like any other. */
function recordAt(midi, vel, when){
  const ctx = Patchwork.audio.ctx;
  if (!ctx || !SEQ.playing || !marks.length) return -1;
  const t = when == null ? ctx.currentTime : when;
  let m = null;
  for (let k = marks.length - 1; k >= 0; k--)
    if (marks[k].t <= t){ m = marks[k]; break; }
  if (!m) m = marks[0];
  const half = (m.end - m.t) / 2;
  const i = ((t - m.t) > half ? m.i + 1 : m.i) % SEQ.len;

  const st = steps[i];
  st.on = 1;
  st.tie = 0;
  st.accent = vel >= 100 ? 1 : 0;
  const sc = SCALES[SEQ.scale] || SCALES.chromatic;
  const rel = midi - SEQ.root;
  if (SEQ.scale === "chromatic"){
    st.oct = Math.floor(rel / 12);
    st.pitch = rel - 12 * st.oct;
  } else {
    /* nearest degree in the scale, so a note off the scale still lands somewhere musical
       rather than being dropped */
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;
    let best = 0, bestD = 99;
    sc.forEach((d, k) => { const dd = Math.abs(d - pc); if (dd < bestD){ bestD = dd; best = k; } });
    st.oct = oct;
    st.pitch = best;
  }
  return i;
}

return {
  SEQ, steps, stepNote, stepEvent, start, stop, tick, playingStep, recordAt,
  RATES, SCALES,
  toggle(){ SEQ.playing ? stop() : start(); },
  setLen(n){ SEQ.len = V.clampf(n|0, 1, MAX); },
  capture(){ return {steps: JSON.parse(JSON.stringify(steps.slice(0, MAX))),
                     len: SEQ.len, rate: SEQ.rate, swing: SEQ.swing,
                     root: SEQ.root, scale: SEQ.scale, gate: SEQ.gate,
                     accentAmt: SEQ.accentAmt}; },
  apply(p){
    if (p.steps) p.steps.forEach((st, i) => { if (i < MAX) steps[i] = Object.assign(S(), st); });
    ["len","rate","swing","root","scale","gate","accentAmt"].forEach(k => {
      if (p[k] != null) SEQ[k] = p[k];
    });
  }
};
};

/* The grid that goes with it.

   Rendered in rows of eight, which is how MS·1 and DR·1 both settled on drawing sixteen
   and is the only layout that stays countable at 64. A click cycles a step off -> on ->
   accent; shift-click sets a tie, alt-click a slide. Modifiers rather than lane buttons,
   because a bass line is written in one pass and a lane selector makes you write it in
   four. */
Patchwork.mountSeqGrid = function(el, seq, opts){
"use strict";
const o = opts || {};
const noteName = n => {
  const N = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
  return N[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
};

function render(){
  el.textContent = "";
  const rows = Math.ceil(seq.SEQ.len / 8);
  for (let r = 0; r < rows; r++){
    const row = document.createElement("div");
    row.className = "seqrow";
    const lab = document.createElement("span");
    lab.className = "rlab";
    lab.textContent = (r*8 + 1) + "–" + Math.min(seq.SEQ.len, r*8 + 8);
    row.appendChild(lab);
    const grid = document.createElement("div");
    grid.className = "steps";
    for (let c = 0; c < 8; c++){
      const i = r*8 + c;
      if (i >= seq.SEQ.len) break;
      const b = document.createElement("button");
      b.className = "step"; b.type = "button"; b.dataset.i = i;
      if (i % 4 === 0) b.classList.add("beat");
      grid.appendChild(b);
    }
    row.appendChild(grid);
    el.appendChild(row);
  }
  paint();
}

function paint(){
  const cur = seq.playingStep();
  el.querySelectorAll(".step").forEach(b => {
    const st = seq.steps[+b.dataset.i];
    b.classList.toggle("on", !!st.on && !st.tie);
    b.classList.toggle("acc", !!st.accent && !!st.on);
    b.classList.toggle("sld", !!st.slide && !!st.on);
    b.classList.toggle("tie", !!st.tie);
    b.classList.toggle("now", +b.dataset.i === cur);
    b.textContent = (!st.on || st.tie) ? "" : noteName(seq.stepNote(st));
  });
}

el.addEventListener("click", e => {
  const b = e.target.closest(".step"); if (!b) return;
  const st = seq.steps[+b.dataset.i];
  if (e.shiftKey){ st.tie = st.tie ? 0 : 1; if (st.tie) st.on = 1; }
  else if (e.altKey){ st.slide = st.slide ? 0 : 1; if (st.slide) st.on = 1; }
  else if (!st.on){ st.on = 1; st.accent = 0; }
  else if (!st.accent){ st.accent = 1; }
  else { st.on = 0; st.accent = 0; st.tie = 0; st.slide = 0; }
  paint();
  if (o.onEdit) o.onEdit();
});

/* Drag a step vertically to set its pitch — the fastest way to write a line, and it means
   the grid needs no separate pitch lane. */
el.addEventListener("pointerdown", e => {
  const b = e.target.closest(".step"); if (!b || e.shiftKey || e.altKey) return;
  const st = seq.steps[+b.dataset.i];
  const y0 = e.clientY, p0 = st.pitch;
  let moved = false;
  const move = ev => {
    const d = Math.round((y0 - ev.clientY) / 9);
    if (d !== 0) moved = true;
    st.pitch = Math.max(-24, Math.min(24, p0 + d));
    if (moved && !st.on) st.on = 1;
    paint();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (moved && o.onEdit) o.onEdit();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

render();
return {render, paint};
};
