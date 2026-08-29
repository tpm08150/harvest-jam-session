
/* ============ ui ============ */

const playBtn = $("#play"), tempoOut = $("#tempoOut"), nowNote = $("#nowNote");
const NOTES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const noteName = n => NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

/* ---- the sequencer ---- */
const seq = Patchwork.makeSeq({
  id: "bs1", maxSteps: 64, len: 16, params: P, rate: "1/16", root: 36,
  /* ⚠️ The sequencer drives the VOICE, and touches nothing the keyboard owns.

     It used to call noteOn()/noteOff() — the live-keyboard path, with a held-note map and
     lowest-note priority — and schedule the note-off on a setTimeout. That runs two time
     domains at once: note-ons placed on the audio clock up to 200 ms ahead, note-offs
     landing whenever a main-thread timer got round to it. So the scheduler would run the
     NEXT step's noteOn while the previous note was still in `held`, pick() would return
     the lower of the two, and the higher note would not sound until the older note's timer
     fired — at wall time, off the grid entirely.

     Measured at 1/8, alternating low and high: onsets at 183 / 318 ms where 250 / 250 was
     wanted, and consistently so, because it is always the same note of the pair that loses
     the priority comparison. That is why some steps sounded right. `held` reached size 2
     for 28% of samples; in a monophonic sequencer it is 0 or 1 by definition.

     The release is scheduled at an audio time now — the shape PM·1's sequencer has always
     used, which is why it never had this. */
  fire: (ev, t) => {
    ensureAudio();
    const vel = Math.round(ev.vel * 127);
    /* Slide glides into a step without re-attacking it — a 303 line, and the reason the
       bass needed a sequencer of its own rather than borrowing notes from elsewhere. */
    if (ev.slide && cur && !cur.released) cur.setPitch(t, ev.n, Math.max(.02, P.glide || .06));
    else if (cur && !cur.released) cur.retrigger(t, ev.n, vel, glideTime(cur.midi, ev.n));
    else cur = buildVoice(ev.n, vel, t);
    /* Hold the voice through a step that slides INTO this one: a slide is one continuous
       gesture, and releasing here would re-attack the next note instead of gliding. */
    if (!slidesAfter(ev.i)){
      cur.release(t + ev.dur);
      cur = null;
    }
  },
  onState: on => {
    playBtn.classList.toggle("on", on);
    playBtn.textContent = on ? "■ Stop" : "▶ Play";
    if (!on) allNotesOff();
  }
});
/* What is under a finger right now — the note a click on a step will write. Lowest, the
   same priority the voice itself uses, so what you hear and what lands agree. */
const heldNote = () => { const n = pick(); return n == null ? null : n; };
const faderReg = {};

/* ⚠️ Every source of a PLAYED note calls this — the on-screen keys, the computer keyboard
   and MIDI. Not noteOn(), which would be the obvious hook and is the wrong one: VC·1's
   sequencer fires through noteOn(), so a step would write itself into whichever step was
   selected, on every pass. "A human played this" is a different fact from "a note
   sounded", and only the first one belongs in the grid. */
function played(n){
  if (seq.SEQ.mode !== "program") return;
  seq.setStepNote(seq.SEQ.sel, n, 100);
  grid.paint();
}
const grid = Patchwork.mountSeqGrid($("#seqWrap"), seq, {
  held: heldNote,
  onSelect: () => paintLocked()
});

/* Does the next SOUNDING step glide into this one? Ties are skipped, because a tie extends
   the note before it rather than sounding on its own — the same rule stepEvent() uses when
   it works out how long a note is held. */
function slidesAfter(i){
  const st = seq.steps, len = seq.SEQ.len;
  for (let k = 1; k <= len; k++){
    const nx = st[(i + k) % len];
    if (!nx || !nx.on || nx.tie) continue;
    return !!nx.slide;
  }
  return false;
}

/* selects */
const lenSel = $("#seqLen"), rateSel = $("#seqRate"), keySel = $("#seqKey"), scaleSel = $("#seqScale");
[8,12,16,24,32,48,64].forEach(n => lenSel.appendChild(Object.assign(
  document.createElement("option"), {value:String(n), textContent:n + " steps"})));
lenSel.value = "16";
Object.keys(seq.RATES).forEach(r => rateSel.appendChild(Object.assign(
  document.createElement("option"), {value:r, textContent:r})));
rateSel.value = "1/16";
for (let n = 24; n <= 48; n++) keySel.appendChild(Object.assign(
  document.createElement("option"), {value:String(n), textContent:noteName(n)}));
keySel.value = "36";
Object.keys(seq.SCALES).forEach(s => scaleSel.appendChild(Object.assign(
  document.createElement("option"),
  {value:s, textContent:s.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase())})));
scaleSel.value = "minor";

lenSel.addEventListener("change", () => { seq.setLen(+lenSel.value); grid.render(); });
rateSel.addEventListener("change", () => { seq.SEQ.rate = rateSel.value; });
keySel.addEventListener("change", () => { seq.SEQ.root = +keySel.value; grid.paint(); });
scaleSel.addEventListener("change", () => { seq.SEQ.scale = scaleSel.value; grid.paint(); });

playBtn.addEventListener("click", () => { ensureAudio(); seq.toggle(); });
$("#panic").addEventListener("click", () => { seq.stop(); allNotesOff(); midiPanic(); });

let latch = false;
$("#hold").addEventListener("click", () => {
  latch = !latch;
  $("#hold").classList.toggle("on", latch);
  if (!latch) allNotesOff();
});

/* ---- the keyboard ----
   Two octaves from the sequencer's root, which is where a pedalboard sits. */
const keysEl = $("#keys");
const KEY_BASE = 36;
const BLACK = {1:1,3:1,6:1,8:1,10:1};
function buildKeys(){
  keysEl.textContent = "";
  for (let i = 0; i < 25; i++){
    const n = KEY_BASE + i;
    const k = document.createElement("div");
    k.className = "k" + (BLACK[n % 12] ? " b" : "");
    k.dataset.n = n;
    if (BLACK[n % 12]) k.appendChild(document.createElement("i"));
    keysEl.appendChild(k);
  }
}
buildKeys();
keysEl.addEventListener("pointerdown", e => {
  const k = e.target.closest(".k"); if (!k) return;
  ensureAudio();
  const n = +k.dataset.n;
  /* a played note reaches the grid only while armed and recording — see shell/record.js */
  Patchwork.record.note("bs1", n, 100);
  played(n);
  if (latch && held.has(n)) noteOff(n); else noteOn(n, 100);
});
window.addEventListener("pointerup", () => { if (!latch) allNotesOff(); });

function paintNow(){
  let n = cur && !cur.released ? cur.midi : null;
  /* While the sequencer runs, what is SOUNDING is the step the audio clock is on — not the
     voice object, which is built up to 200 ms early and marked released the moment its end
     is scheduled. playingStep() is looked up against the clock, so it is the honest answer,
     and it is the same source the step grid's playhead uses. */
  if (seq.SEQ.playing){
    const i = seq.playingStep();
    const st = i >= 0 ? seq.steps[i] : null;
    n = (st && st.on && !st.tie) ? seq.stepNote(st) : null;
  }
  nowNote.textContent = n == null ? "—" : noteName(n);
  keysEl.querySelectorAll(".k").forEach(k => {
    const kn = +k.dataset.n;
    k.classList.toggle("on", held.has(kn) || kn === n);
  });
}

/* the playhead, from the audio clock */
(function paintLoop(){
  grid.paint();
  /* the note readout is now clock-derived too, so it has to repaint with the playhead */
  if (seq.SEQ.playing) paintNow();
  requestAnimationFrame(paintLoop);
})();

/* ---- tempo ---- */
function setBpm(v, fromShell){
  const b = Math.round(clampf(v, 40, 240));
  tempoOut.textContent = b;
  if (!fromShell) Patchwork.clock.setBpm(b, "bs1");
}
Patchwork.clock.onTempo("bs1", v => setBpm(v, true), 120);
setBpm(Patchwork.clock.bpm, true);
$("#bpmUp").addEventListener("click", () => setBpm(Patchwork.clock.bpm + 1));
$("#bpmDown").addEventListener("click", () => setBpm(Patchwork.clock.bpm - 1));

/* ---- voice faders ---- */
/* `id` is the key in P this fader owns. It is what a parameter lock is keyed on, and the
   reason a fader has to say which one it is rather than just how to set it. */
function fader(sel, get, set, fmt, min, max, id){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  if (id) faderReg[id] = {el: el, paint: null};
  function paintF(){
    cap.style.left = (clampf((get() - min) / (max - min), 0, 1) * 100) + "%";
    val.textContent = fmt(get());
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      set(min + clampf((cx - r.left) / r.width, 0, 1) * (max - min));
      applyLive(); paintF();
      /* In program mode moving a control IS the lock gesture — no separate arm step, the
         same as recording a note by holding one and clicking. */
      if (id && seq.lock(id)) paintSeqEdit();
    };
    move(e); el.classList.add("dragging");
    const up = () => { el.classList.remove("dragging");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  /* Double-click unlocks BEFORE it resets: otherwise there is no way to take a lock off a
     control without also losing the patch setting underneath it. PM·1's rule. */
  el.addEventListener("dblclick", () => {
    if (id && seq.SEQ.mode === "program" && seq.unlock(id)){ paintSeqEdit(); return; }
  });
  if (id) faderReg[id].paint = paintF;
  paintF();
}
/* cutoff is exponential — a linear Hz fader spends most of its travel above where a bass
   filter is ever set */
fader("#cutF", () => Math.log2(P.cut / 20) / Math.log2(2000 / 20),
      v => { P.cut = 20 * Math.pow(2000 / 20, v); },
      () => Math.round(P.cut) + " Hz", 0, 1, "cut");
fader("#resF", () => P.res, v => { P.res = v; }, v => v.toFixed(1) + " dB", 0, 18, "res");
fader("#envF", () => P.env, v => { P.env = v; }, v => v.toFixed(2) + " oct", 0, 5, "env");
fader("#decF", () => P.dec, v => { P.dec = v; }, v => (v*1000).toFixed(0) + " ms", .04, 1.5, "dec");
fader("#subF", () => P.sub, v => { P.sub = v; }, v => Math.round(v*100) + "%", 0, 1, "sub");
fader("#lvlF", () => P.level, v => { P.level = v; }, v => Math.round(v*100) + "%", 0, 1, "level");
fader("#glideF", () => P.glide, v => { P.glide = v; }, v => (v*1000).toFixed(0) + " ms", 0, .4, "glide");

function setWave(w){
  P.wave = w === "square" ? "square" : "saw";
  $$("#wave button").forEach(x => x.classList.toggle("on", x.dataset.w === P.wave));
}
$("#wave").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  setWave(b.dataset.w);
});
const OCTS = [-2, -1, 0];
function setOct(v){
  P.oct = OCTS.indexOf(v) < 0 ? 0 : v;
  $$("#oct button").forEach(x => x.classList.toggle("on", +x.dataset.o === P.oct));
}
$("#oct").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  setOct(+b.dataset.o);
});

/* The computer keyboard is the shell's — see shell/keys.js. It plays the same path a
   pointer on the on-screen keys does, record.note() included, so a typed line lands on the
   grid exactly as a clicked one does. The arrows walk BS·1's own octave segment, which is
   a transposition rather than a keyboard offset — so the control keeps telling the truth. */
Patchwork.keys.mount(root, {
  map: i => KEY_BASE + i,
  on: (n, v) => {
    ensureAudio();
    Patchwork.record.note("bs1", n, v);
    played(n);
    if (latch && held.has(n)) noteOff(n); else noteOn(n, v);
  },
  off: n => { if (!latch) noteOff(n); },
  paint: paintNow,
  octave: d => setOct(OCTS[Math.max(0, Math.min(OCTS.length - 1, OCTS.indexOf(P.oct) + d))])
});


/* ---- the sequencer's editing controls ----
   The same three PM·1 has, driving the shared grid — see seq/step-seq.js. Two sequencers
   with different gestures is two things to learn, and the one you are not looking at is
   always the one whose rules you have forgotten. */
const LANE_HINT = {
  on: "click a step to turn it on \u00b7 shift-click ties \u00b7 alt-click slides",
  pitch: "drag a step up or down to set its note",
  accent: "click a step to accent it",
  slide: "click a step to glide into it from the one before",
  tie: "click a step to hold the note before it through this one"
};
const seqHint = $("#seqHint");
function paintLocked(){
  /* Which controls hold a lock for the SELECTED step, so a p-lock is something you can see
     rather than remember — PM·1 marks its knobs the same way. */
  Object.keys(faderReg).forEach(id => {
    const f = faderReg[id];
    if (f && f.el) f.el.classList.toggle("locked", seq.SEQ.mode === "program" && seq.isLocked(id));
  });
}
function paintSeqEdit(){
  const program = seq.SEQ.mode === "program";
  $$("#seqMode button").forEach(b => b.classList.toggle("on", (b.dataset.p === "program") === program));
  $$("#seqLane button").forEach(b => b.classList.toggle("on", b.dataset.l === seq.SEQ.lane));
  if (seqHint) seqHint.textContent = program
    ? "click a step, then play a note to write it \u2014 every knob you move locks to that step"
    : (LANE_HINT[seq.SEQ.lane] || "hold a note and click a step to record it");
  paintLocked();
  grid.paint();
}
$("#seqMode").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  seq.SEQ.mode = b.dataset.p;
  paintSeqEdit();
});
$("#seqLane").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  seq.SEQ.lane = b.dataset.l;
  paintSeqEdit();
});
$("#clearLocks").addEventListener("click", e => {
  seq.clearLocks(e.shiftKey);
  paintSeqEdit();
});
paintSeqEdit();

onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ ensureAudio(); seq.toggle(); e.preventDefault(); }
});

paintNow();

/* ---- the patch, for a shared jam ----
   The SOUND, not the pattern. scenes.register() has always carried the pattern and left the
   filter you just dialled alone; this is the other half, and it is a separate registration
   for that reason — see registerPatch() in shell/session.js.

   Every control is repainted on the way in, or the panel would show one thing and play
   another. */
function refreshAllControls(){
  Object.keys(faderReg).forEach(id => { const f = faderReg[id]; if (f && f.paint) f.paint(); });
  setWave(P.wave);
  setOct(P.oct);
  applyLive();
}
Patchwork.session.registerPatch("bs1", {
  capture: () => Object.assign({}, P),
  apply: src => {
    Object.keys(DEFAULT).forEach(k => { if (src && src[k] !== undefined) P[k] = src[k]; });
    refreshAllControls();
  }
});
