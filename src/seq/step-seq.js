
/* A step sequencer any instrument can mount.

   MS·1 grew one for its synth section and it never served the vocoder or the bass — the
   old notes say so outright: "the sequencer and arpeggiator drive the synth section
   only". Splitting MS·1 into three instruments made that a problem rather than a
   documented limit, because now two of the three have no sequencer at all.

   So this is a factory, not a module: call it once per instrument and you get your own
   state, your own grid and your own transport, all on the shell's clock.

   It used to be deliberately the simpler of the two models in the repo — no lanes, no note
   recording, no per-step parameter locks — on the grounds that a bass line did not need
   PM·1's complexity. That was the wrong call for a RACK: two sequencers with different
   gestures is two things to learn, and the one you are not currently looking at is always
   the one whose rules you have forgotten. It matches PM·1 now.

   The caller supplies fire(ev, t) and gets everything else. */
Patchwork.makeSeq = function(spec){
"use strict";
const MAX = spec.maxSteps || 64;
const V = Patchwork.voice;

const SEQ = {
  len: spec.len || 16, rate: spec.rate || "1/16", swing: .5,
  playing: false, root: spec.root == null ? 36 : spec.root, scale: "minor",
  gate: .5, accentAmt: .3, octaves: 0,
  /* TWO WAYS TO WRITE A LINE, because entering one by dragging every step is the slowest of
     them and it was the only one that always worked.

       play  clicks edit the grid — and a step you switch ON takes the note you last played,
             so playing a pitch and tapping four steps writes four of it
       step  ONE LIT STEP, and everything you do lands on it. Play a note and it is written
             there and the cursor moves on; move a knob and it locks to the lit step; the
             arrows walk over steps you want left alone; delete empties one and moves on

     ⚠️ Program and Step used to be two modes and they should never have been. They differed
     in one line — whether the cursor advanced — and everything else about them was the same
     gesture, so choosing between them was choosing whether the OTHER half of the mode was
     available. Notes and parameter locks belong to the same step for the same reason.

     Which means the order is: land on a step, set what you want locked, play its note, and
     it moves on. Playing first is fine too — the left arrow puts you back on what you just
     wrote. */
  mode: "play", sel: 0,
  lane: "on"                    // on | pitch | accent | slide | tie
};

/* ⚠️ THE LAST NOTE A HUMAN PLAYED, and only a human — see played(). It is what a step you
   switch on is set to, which turns "enter this line" into playing the pitch once and tapping
   the steps that want it, instead of dragging each one to the right height. Null until
   somebody plays something, so a panel nobody has touched behaves exactly as it did. */
let lastNote = null;

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
    if (spec.id) Patchwork.scenes.take(spec.id, at);
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
        withLocks(st, () => spec.fire(ev, at));
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

/* A played note as a step. The pitch is stored as a scale DEGREE from the root, the same
   as a step written by hand, so a recorded line transposes with the key like any other. */
function writeNote(st, midi){
  const sc = SCALES[SEQ.scale] || SCALES.chromatic;
  const rel = midi - SEQ.root;
  if (SEQ.scale === "chromatic"){
    st.oct = Math.floor(rel / 12);
    st.pitch = rel - 12 * st.oct;
    return;
  }
  /* nearest degree in the scale, so a note off the scale still lands somewhere musical
     rather than being dropped */
  const oct = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  let best = 0, bestD = 99;
  sc.forEach((d, k) => { const dd = Math.abs(d - pc); if (dd < bestD){ bestD = dd; best = k; } });
  st.oct = oct;
  st.pitch = best;
}

/* ---- parameter locks ----
   A step can hold overrides for any of the instrument's parameters, in force only while
   that step is being scheduled. Voices read the parameter object at BUILD time, so swapping
   it around the build is all it takes — and because scheduling is synchronous the UI never
   observes the swapped values.

   ⚠️ Restored in a finally. A throw mid-step would otherwise leave the whole patch stuck on
   one step's settings, which reads as the synth breaking rather than the sequencer. Lifted
   from PM·1's withLocks(), including this note. */
function withLocks(st, fn){
  const L = st && st.locks, P = spec.params;
  if (!L || !P) return fn();
  const saved = {};
  for (const k in L){ saved[k] = P[k]; P[k] = L[k]; }
  try { return fn(); } finally { for (const k in saved) P[k] = saved[k]; }
}

/* ---- writing a step by hand ----
   Hold a note and click a step, or select a step and play one. Two spellings of one
   gesture, and both are how PM·1 has always worked. */
function setStepNote(i, midi, vel){
  const st = steps[i % SEQ.len];
  if (!st) return false;
  st.on = 1;
  st.tie = 0;
  if (vel != null) st.accent = vel >= 100 ? 1 : 0;
  writeNote(st, midi);
  return true;
}
function selectStep(i){ SEQ.sel = ((i % SEQ.len) + SEQ.len) % SEQ.len; }

/* ⚠️ A HUMAN PLAYED THIS, which is a different fact from "a note sounded" and the only one
   that belongs in the grid. Every instrument calls this from its on-screen keys, its
   computer keyboard and its MIDI in, and NEVER from the sequencer's own firing: the note
   that comes round every pass is not a note anybody played, and writing it back into the
   step it came from would be the sequencer arguing with itself. */
function played(midi, vel){
  lastNote = midi;
  if (SEQ.mode !== "play"){
    setStepNote(SEQ.sel, midi, vel == null ? 100 : vel);
    selectStep(SEQ.sel + 1);
  }
  return true;
}
/* Turn the step under the cursor off and move on — the rest, in a mode whose other keys all
   write something. The arrows step over what is already there; this empties it first. */
/* ⚠️ THE LOCKS GO WITH THE NOTE. A step emptied of its note but still holding a filter
   sweep is a step that does nothing and changes the sound anyway — invisible except as a
   ring on a pad, and impossible to reason about later. Delete means delete. */
function eraseAt(i){
  const st = steps[((i % SEQ.len) + SEQ.len) % SEQ.len];
  if (!st) return false;
  st.on = 0; st.tie = 0; st.accent = 0; st.slide = 0;
  delete st.locks;
  return true;
}

/* In program mode, moving any registered control IS the lock gesture — no separate arm
   step, the same as recording a note by holding one and clicking. */
function lock(id){
  if (SEQ.mode === "play" || !spec.params) return false;
  const st = steps[SEQ.sel];
  if (!st) return false;
  (st.locks || (st.locks = {}))[id] = spec.params[id];
  return true;
}
function unlock(id){
  const st = steps[SEQ.sel];
  if (!st || !st.locks || !Object.prototype.hasOwnProperty.call(st.locks, id)) return false;
  delete st.locks[id];
  if (!Object.keys(st.locks).length) delete st.locks;
  return true;
}
function isLocked(id, i){
  const st = steps[((i == null ? SEQ.sel : i) % SEQ.len + SEQ.len) % SEQ.len];
  return !!(st && st.locks && Object.prototype.hasOwnProperty.call(st.locks, id));
}
function clearLocks(all){
  if (all) steps.forEach(st => { delete st.locks; });
  else { const st = steps[SEQ.sel]; if (st) delete st.locks; }
}

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

  setStepNote(i, midi, vel);
  return i;
}

return {
  SEQ, steps, stepNote, stepEvent, start, stop, tick, playingStep, recordAt,
  setStepNote, selectStep, played, eraseAt, lock, unlock, isLocked, clearLocks, withLocks,
  get lastNote(){ return lastNote; },
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
   and is the only layout that stays countable at 64.

   ⚠️ It used to be modifiers only — shift for a tie, alt for a slide — on the argument that
   a bass line is written in one pass and a lane selector makes you write it in four. Both
   are true and neither settles it: PM·1 has lanes, and a rack where the same grid answers
   two different sets of rules costs more than either gesture saves. Lanes AND modifiers
   now; the modifiers still work on the Gate lane, so nothing anyone had learned stopped
   being true.

   Three ways to put a note on a step, all of them PM·1's:
     - drag a step vertically for its pitch
     - hold a note and click a step
     - in Program mode, click a step and then play a note

   opts.lane / opts.mode are the two segmented controls, when the panel has them.
   opts.held() is what the instrument currently has under a finger, or null. */
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
    b.classList.toggle("sel", seq.SEQ.mode !== "play" && +b.dataset.i === seq.SEQ.sel);
    /* a p-lock is something you can see rather than remember */
    b.classList.toggle("lock", !!(st.locks && Object.keys(st.locks).length));
    b.textContent = (!st.on || st.tie) ? "" : noteName(seq.stepNote(st));
  });
}

/* ---- walking the steps ----
   ⚠️ MOUNTED BEFORE shell/keys.js, and that is what makes it work. Left and right move an
   instrument's octave there, and host.js runs every handler registered for a panel in the
   order they were registered — so this one has to be in place first and say so with
   preventDefault, which is exactly what keys.js checks before acting. Every instrument that
   mounts a grid does it well before it mounts a keyboard; PM·1 makes the same arrangement
   with its own handler and says so too.

   Up and down are deliberately left alone. They move the octave, and moving the octave is
   what you want while typing a line in from the computer keyboard. */
const root = el.closest("[data-instrument]");
if (root && Patchwork.onKey) Patchwork.onKey(root, "keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (seq.SEQ.mode === "play") return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft"){
    seq.selectStep(seq.SEQ.sel + (e.key === "ArrowRight" ? 1 : -1));
    if (o.onSelect) o.onSelect(seq.SEQ.sel);
    paint();
    e.preventDefault();
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete"){
    seq.eraseAt(seq.SEQ.sel);
    seq.selectStep(seq.SEQ.sel + 1);
    if (o.onSelect) o.onSelect(seq.SEQ.sel);
    paint();
    if (o.onEdit) o.onEdit();
    e.preventDefault();
  }
});

el.addEventListener("click", e => {
  const b = e.target.closest(".step"); if (!b) return;
  const i = +b.dataset.i, st = seq.steps[i];

  /* Holding a note and clicking a step writes it, whatever lane is showing and whatever
     mode you are in. It is the fastest way to enter a line and it beats the lane, because
     reaching for a key is already an unambiguous statement about what you want that step to
     be. In step programming it moves the cursor there too — you have just said which step
     you are working on by writing to it. */
  const held = o.held && o.held();
  if (held != null){
    seq.setStepNote(i, held, 100);
    if (seq.SEQ.mode !== "play"){ seq.selectStep(i); if (o.onSelect) o.onSelect(i); }
    paint();
    if (o.onEdit) o.onEdit();
    return;
  }

  /* ⚠️ THE FIRST CLICK MOVES THE CURSOR, THE NEXT ONE EDITS — PM·1's rule, and the reason
     Gate, Pitch, Accent, Slide and Tie work here at all. Step programming used to swallow
     every click into "select this step" and nothing else, so the five lane buttons were a
     row of controls that did nothing unless you left the mode first. There is no gesture
     spare to give them: a click has to be able to mean "work on this one" as well.

     Once the step is lit, everything below is the same code Play mode runs, so the lanes
     cannot behave differently in the two modes. */
  if (seq.SEQ.mode !== "play" && seq.SEQ.sel !== i){
    seq.selectStep(i);
    if (o.onSelect) o.onSelect(i);
    paint();
    return;
  }

  const lane = seq.SEQ.lane || "on";
  /* Modifiers still work, and only on the Gate lane — on a Slide lane a shift-click that
     set a tie would be the grid ignoring the control you just chose. */
  if (lane === "on" && e.shiftKey){ st.tie = st.tie ? 0 : 1; if (st.tie) st.on = 1; }
  else if (lane === "on" && e.altKey){ st.slide = st.slide ? 0 : 1; if (st.slide) st.on = 1; }
  else if (lane === "accent"){ st.accent = st.accent ? 0 : 1; if (st.accent) st.on = 1; }
  else if (lane === "slide"){ st.slide = st.slide ? 0 : 1; if (st.slide) st.on = 1; }
  else if (lane === "tie"){ st.tie = st.tie ? 0 : 1; if (st.tie) st.on = 1; }
  else if (lane === "pitch"){ st.on = 1; }     /* the drag below is the edit; this arms it */
  else if (!st.on){
    st.on = 1; st.accent = 0;
    /* ⚠️ THE NOTE YOU LAST PLAYED, not the root. A step switched on used to land on whatever
       pitch it happened to be holding — the root, for a step never touched — so writing a
       line meant turning steps on and then dragging every one of them to the right height.
       Play the pitch once and tap the steps that want it. Holding a note still wins, above,
       because a key under a finger is a more specific statement than one you let go of. */
    if (seq.lastNote != null) seq.setStepNote(i, seq.lastNote);
  }
  else if (!st.accent){ st.accent = 1; }
  else { st.on = 0; st.accent = 0; st.tie = 0; st.slide = 0; }
  paint();
  if (o.onEdit) o.onEdit();
});

/* Drag a step vertically to set its pitch — the fastest way to write a line, and it means
   the grid needs no separate pitch lane. */
el.addEventListener("pointerdown", e => {
  const b = e.target.closest(".step"); if (!b || e.shiftKey || e.altKey) return;
  /* the same rule the click follows: the lit step is draggable, an unlit one is selected
     first — measured, and a drag fires no click event at all, so the two cannot both act */
  if (seq.SEQ.mode !== "play" && seq.SEQ.sel !== +b.dataset.i) return;
  if (o.held && o.held() != null) return;          // a held note is the edit
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

/* ---- the Clear locks button ----
   ⚠️ IT ONLY EVER CLEARED THE SELECTED STEP, and said "Clear locks", which reads as all of
   them. Lock three steps, press it, and two locks stay lit — the button looks broken when
   it is doing exactly what it was built to do. Worse, with a step selected that holds no
   locks it did nothing at all, which is indistinguishable from a dead control.

   So the button names its own scope and refuses to be a no-op: it reads "Clear step"
   normally and "Clear all (3)" while Shift is held, and it is disabled precisely when
   pressing it would change nothing. The count is the part that matters — it is what tells
   you locks exist somewhere else, which is the thing you could not see before.

   Three instruments grew the same button and BS·1, VC·1 and PM·1 had three copies of the
   same mistake between them, so this is the one implementation. PM·1 keeps its own
   sequencer rather than this module's, which is why the state arrives through an adapter
   instead of a `seq`. */
Patchwork.mountClearLocks = function(btn, o){
"use strict";
if (!btn || !o) return {paint(){}};
const held = st => !!(st && st.locks && Object.keys(st.locks).length);
const count = () => o.steps().filter(held).length;
const here = () => held(o.steps()[o.sel()]);
let shift = false;

function paint(){
  const n = count(), mine = here();
  btn.textContent = shift ? (n > 1 ? "Clear all (" + n + ")" : "Clear all") : "Clear step";
  btn.disabled = shift ? n === 0 : !mine;
  btn.title = n === 0
    ? "No parameter locks to clear."
    : shift
      ? "Clear the locks on every step."
      : mine
        ? "Clear this step's locks. Hold Shift to clear all " + n + "."
        : "This step has no locks. Hold Shift to clear all " + n + ".";
}

btn.addEventListener("click", e => {
  /* read the modifier from the event, not from `shift` — a keyboard Enter on a focused
     button carries its own shiftKey and never fired the keydown we track */
  o.clear(!!e.shiftKey);
  if (o.repaint) o.repaint();
  paint();
});
/* Tracked on the window because the label has to change while the pointer is nowhere near
   the button — that is the whole point of it. */
addEventListener("keydown", e => { if (e.key === "Shift" && !shift){ shift = true; paint(); } });
addEventListener("keyup", e => { if (e.key === "Shift" && shift){ shift = false; paint(); } });
/* a window that loses focus with Shift down never sends the keyup */
addEventListener("blur", () => { if (shift){ shift = false; paint(); } });

paint();
return {paint};
};
