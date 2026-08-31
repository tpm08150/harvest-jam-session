
/* ============ ui ============ */

const playBtn = $("#play"), tempoOut = $("#tempoOut"), nowNote = $("#nowNote"),
      meterEl = $("#inMeter"), vocNote = $("#vocNote");
const NOTES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const noteName = n => NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

function say(msg, bad){ vocNote.innerHTML = msg; vocNote.classList.toggle("err", !!bad); }

/* ---- the sequencer ---- */
const seq = Patchwork.makeSeq({
  id: "vc1", maxSteps: 64, len: 16, params: P, rate: "1/8", root: 48,
  /* ⚠️ The release is scheduled on the AUDIO clock, not a setTimeout. The old form fired
     the note-off whenever a main-thread timer got round to it, so note lengths wandered by
     however late the timer was — see BS·1's fire(), where the same fault displaced onsets
     rather than lengths because that instrument is monophonic and picks by pitch. */
  fire: (ev, t) => {
    ensureAudio();
    noteOn(ev.n, Math.round(ev.vel * 127), t);
    noteOff(ev.n, t + ev.dur);
  },
  onState: on => {
    playBtn.classList.toggle("on", on);
    playBtn.textContent = on ? "■ Stop" : "▶ Play";
    if (!on) allNotesOff();
  }
});
/* What is under a finger right now — the note a click on a step will write. Lowest of the
   held carriers, so a chord writes its root rather than whichever key was pressed last. */
const heldNote = () => {
  const on = [...carriers.keys()].filter(n => { const c = carriers.get(n); return c && !c.released; });
  return on.length ? Math.min.apply(null, on) : null;
};
const faderReg = {};

/* ⚠️ Every source of a PLAYED note calls this — the on-screen keys, the computer keyboard
   and MIDI. Not noteOn(), which would be the obvious hook and is the wrong one: VC·1's
   sequencer fires through noteOn(), so a step would write itself into whichever step was
   selected, on every pass. "A human played this" is a different fact from "a note
   sounded", and only the first one belongs in the grid. */
function played(n){
  seq.played(n, 100);
  grid.paint();
  paintSeqEdit();
}
const grid = Patchwork.mountSeqGrid($("#seqWrap"), seq, {
  held: heldNote,
  onSelect: () => paintLocked()
});

const lenSel = $("#seqLen"), rateSel = $("#seqRate"), keySel = $("#seqKey"), scaleSel = $("#seqScale");
[8,12,16,24,32,48,64].forEach(n => lenSel.appendChild(Object.assign(
  document.createElement("option"), {value:String(n), textContent:n + " steps"})));
lenSel.value = "16";
Object.keys(seq.RATES).forEach(r => rateSel.appendChild(Object.assign(
  document.createElement("option"), {value:r, textContent:r})));
rateSel.value = "1/8";
for (let n = 36; n <= 60; n++) keySel.appendChild(Object.assign(
  document.createElement("option"), {value:String(n), textContent:noteName(n)}));
keySel.value = "48";
Object.keys(seq.SCALES).forEach(s => scaleSel.appendChild(Object.assign(
  document.createElement("option"),
  {value:s, textContent:s.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase())})));
scaleSel.value = "minor";

lenSel.addEventListener("change", () => { seq.setLen(+lenSel.value); grid.render(); });
rateSel.addEventListener("change", () => { seq.SEQ.rate = rateSel.value; });
keySel.addEventListener("change", () => { seq.SEQ.root = +keySel.value; grid.paint(); });
scaleSel.addEventListener("change", () => { seq.SEQ.scale = scaleSel.value; grid.paint(); });

playBtn.addEventListener("click", () => { ensureAudio(); seq.toggle(); });
$("#panic").addEventListener("click", () => { seq.stop(); allNotesOff(); });

let latch = false;
$("#hold").addEventListener("click", () => {
  latch = !latch;
  $("#hold").classList.toggle("on", latch);
  if (!latch) allNotesOff();
});
$("#listen").addEventListener("click", async () => {
  ensureAudio();
  if (modStream){ closeInput(); $("#listen").classList.remove("on"); say("Modulator closed."); return; }
  const ok = await openInput($("#inSel").value === "__bus" ? "__bus" : "");
  $("#listen").classList.toggle("on", !!ok);
});
$("#inSel").addEventListener("change", () => { if (modStream) openInput($("#inSel").value === "__bus" ? "__bus" : ""); });

/* ---- carrier keyboard ----
   ⚠️ The OCTAVE MOVES THE KEYS, rather than being added to whatever they send. It used to be
   an offset the shell's keys module kept to itself, which meant a typed note and a clicked
   one played different pitches the moment you shifted it — the on-screen keyboard was not
   in on it. Rebuilding the row is both cheaper to reason about and the only version where
   what is written on a key is what that key does. */
const keysEl = $("#keys");
const KEY_BASE = 48;
const KEY_SPAN = 25;
const BLACK = {1:1,3:1,6:1,8:1,10:1};
let octave = 0;
function buildKeys(){
  keysEl.textContent = "";
  for (let i = 0; i < KEY_SPAN; i++){
    const n = KEY_BASE + octave * 12 + i;
    const k = document.createElement("div");
    k.className = "k" + (BLACK[n % 12] ? " b" : "");
    k.dataset.n = n;
    k.title = noteName(n);
    if (BLACK[n % 12]) k.appendChild(document.createElement("i"));
    /* every C carries its octave, which is the whole of "where am I" */
    else if (n % 12 === 0){
      const lab = document.createElement("span");
      lab.className = "klab"; lab.textContent = noteName(n);
      k.appendChild(lab);
    }
    keysEl.appendChild(k);
  }
}
buildKeys();
const keyRange = () => noteName(KEY_BASE + octave * 12) + " – " +
                       noteName(KEY_BASE + octave * 12 + KEY_SPAN - 1);
function setOctave(v){
  octave = Math.max(-3, Math.min(3, v | 0));
  buildKeys();
  paintNow();
}
const paintOct = Patchwork.keys.octaveUI(keysEl.parentNode, {
  get: () => octave, set: setOctave, range: keyRange
});
keysEl.addEventListener("pointerdown", e => {
  const k = e.target.closest(".k"); if (!k) return;
  ensureAudio();
  const n = +k.dataset.n;
  /* a played note reaches the grid only while armed and recording — see shell/record.js */
  Patchwork.record.note("vc1", n, 100);
  played(n);
  if (latch && carriers.has(n)) noteOff(n); else noteOn(n, 100);
});
window.addEventListener("pointerup", () => { if (!latch) allNotesOff(); });

/* The computer keyboard is the shell's — see shell/keys.js. The arrows drive VC·1's own
   octave now, so the on-screen keys move with them and typing an A plays the key marked A.
   The carrier is voiced from the note it is given, so shifting it is the whole of what an
   octave means here. */
Patchwork.keys.mount(root, {
  map: i => KEY_BASE + octave * 12 + i,
  on: (n, v) => {
    ensureAudio();
    Patchwork.record.note("vc1", n, v);
    played(n);
    if (latch && carriers.has(n)) noteOff(n); else noteOn(n, v);
  },
  off: n => { if (!latch) noteOff(n); },
  paint: () => paintNow(),
  octave: d => { setOctave(octave + d); paintOct(); }
});

function paintNow(){
  const held = [...carriers.keys()].filter(n => { const c = carriers.get(n); return c && !c.released; });
  nowNote.textContent = held.length ? held.sort((a,b)=>a-b).map(noteName).join(" ") : "—";
  keysEl.querySelectorAll(".k").forEach(k => k.classList.toggle("on", held.indexOf(+k.dataset.n) >= 0));
}

/* meter and playhead */
const mbuf = new Float32Array(1024);
(function paintLoop(){
  grid.paint();
  if (modMeter){
    modMeter.getFloatTimeDomainData(mbuf);
    let s = 0; for (let i = 0; i < mbuf.length; i++) s += mbuf[i]*mbuf[i];
    meterEl.style.width = Math.min(100, Math.sqrt(s/mbuf.length) * 320) + "%";
  }
  requestAnimationFrame(paintLoop);
})();

/* ---- tempo ---- */
function setBpm(v, fromShell){
  const b = Math.round(clampf(v, 40, 240));
  tempoOut.textContent = b;
  if (!fromShell) Patchwork.clock.setBpm(b, "vc1");
}
Patchwork.clock.onTempo("vc1", v => setBpm(v, true), 120);
setBpm(Patchwork.clock.bpm, true);
$("#bpmUp").addEventListener("click", () => setBpm(Patchwork.clock.bpm + 1));
$("#bpmDown").addEventListener("click", () => setBpm(Patchwork.clock.bpm - 1));

/* ---- bank controls ---- */
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
      applyVocoder(); paintF();
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
    if (id && seq.SEQ.mode !== "play" && seq.unlock(id)) paintSeqEdit();
  });
  if (id) faderReg[id].paint = paintF;
  paintF();
}
fader("#qF",    () => P.q,       v => { P.q = v; },       v => v.toFixed(1), .5, 12, "q");
fader("#respF", () => P.resp,    v => { P.resp = v; },    v => v.toFixed(0) + " Hz", 4, 80, "resp");
fader("#sibF",  () => P.sib,     v => { P.sib = v; },     v => Math.round(v*100) + "%", 0, 1, "sib");
fader("#compF", () => P.comp,    v => { P.comp = v; },    v => Math.round(v*100) + "%", 0, 1, "comp");
fader("#modF",  () => P.mod,     v => { P.mod = v; },     v => Math.round(v*100) + "%", 0, 3, "mod");
fader("#carrF", () => P.carrier, v => { P.carrier = v; }, v => Math.round(v*100) + "%", 0, 1.5, "carrier");
fader("#mixF",  () => P.mix,     v => { P.mix = v; },     v => Math.round(v*100) + "%", 0, 1.5, "mix");
fader("#relF",  () => P.release, v => { P.release = v; }, v => (v*1000).toFixed(0) + " ms", .02, 1.5, "release");

$("#bands").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  P.bands = +b.dataset.b;
  $$("#bands button").forEach(x => x.classList.toggle("on", x === b));
  ensureAudio(); applyVocoder();
});
$("#wave").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  P.wave = b.dataset.w;
  $$("#wave button").forEach(x => x.classList.toggle("on", x === b));
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
    if (f && f.el) f.el.classList.toggle("locked", seq.SEQ.mode !== "play" && seq.isLocked(id));
  });
  /* here rather than in paintSeqEdit: this is what the grid calls when the selection moves,
     and both the button's label and whether it is disabled depend on the selected step */
  if (clearLocksBtn) clearLocksBtn.paint();
}
function paintSeqEdit(){
  const m = seq.SEQ.mode;
  $$("#seqMode button").forEach(b => b.classList.toggle("on", b.dataset.p === m));
  $$("#seqLane button").forEach(b => b.classList.toggle("on", b.dataset.l === seq.SEQ.lane));
  /* The last note played is state you cannot see anywhere else, and it decides what the next
     step you switch on becomes — so it is written down rather than left to be discovered. */
  const nx = seq.lastNote == null ? "" : "  \u00b7  " + noteName(seq.lastNote) + " goes into the next step you switch on";
  if (seqHint) seqHint.textContent = m !== "play"
    ? "everything lands on the lit step \u2014 a note writes it and moves on, a knob locks to it. \u2190 \u2192 walk, delete empties note and locks"
    : (LANE_HINT[seq.SEQ.lane] || "hold a note and click a step to record it") + nx;
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
/* declared before it is assigned: a paint can run while this file is still being
   evaluated, and a `const` in its temporal dead zone throws on any access at all */
let clearLocksBtn = null;
clearLocksBtn = Patchwork.mountClearLocks($("#clearLocks"), {
  steps: () => seq.steps,
  sel: () => seq.SEQ.sel,
  clear: all => seq.clearLocks(all),
  repaint: () => paintSeqEdit()
});
paintSeqEdit();

onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ ensureAudio(); seq.toggle(); e.preventDefault(); }
});

paintNow();

/* ---- the patch, for a shared jam ---- see BS·1's for why this is separate from a scene. */
function refreshAllControls(){
  Object.keys(faderReg).forEach(id => { const f = faderReg[id]; if (f && f.paint) f.paint(); });
  $$("#bands button").forEach(x => x.classList.toggle("on", +x.dataset.b === P.bands));
  $$("#wave button").forEach(x => x.classList.toggle("on", x.dataset.w === P.wave));
  applyVocoder();
}
/* ⚠️ ONE definition of this instrument's sound, handed to both the jam and the
   patch store. Written twice they would drift, and the symptom would be a saved
   patch that recalls slightly less than a jam shares — invisible until two people
   compare what they are hearing. */
const SOUND = {
  capture: () => {
    const out = Object.assign({}, P);
    /* the modulator input is a DEVICE on this machine and names nothing on another */
    delete out.input;
    return out;
  },
  apply: src => {
    Object.keys(DEFAULT).forEach(k => {
      if (k === "input") return;
      if (src && src[k] !== undefined) P[k] = src[k];
    });
    refreshAllControls();
  }
};
Patchwork.session.registerPatch("vc1", SOUND);
Patchwork.patches.mount(root, "vc1", SOUND);


/* ---- somebody else's notes ---- see BS·1's. */
Patchwork.session.registerVoice("vc1", {
  on: (n, v) => { ensureAudio(); noteOn(n, v); paintNow(); },
  off: n => { noteOff(n); paintNow(); }
});

/* ---- groove from the chords on the page ----
   A vocoder wants long vowels, not a line: one note per chord, held through it with ties,
   so the carrier sustains and whatever is speaking into the modulator does the moving. The
   top note of CS·1's voicing rather than the root — it is the one that reads as a melody
   when a voice is put through it.

   ⚠️ It writes the whole pattern, rests included, or the previous line would show through
   the gaps in the new one. */
(() => {
"use strict";
const btn = $("#grooveBtn");
if (!btn || !window.Patchwork || !Patchwork.chords) return;

function paintGroove(){
  const ok = Patchwork.chords.ready;
  btn.disabled = !ok;
  btn.title = ok
    ? "Fill this sequence from CS·1's progression — one held note per chord"
    : "No chords on this page yet. CS·1 makes a progression; this plays along with it.";
}
btn.addEventListener("click", () => {
  const C = Patchwork.chords;
  if (!C.ready) return;
  const len = seq.SEQ.len;
  for (let i = 0; i < len; i++){
    const st = seq.steps[i];
    const ch = C.at(i, len);
    st.on = 0; st.tie = 0; st.slide = 0; st.accent = 0;
    if (!ch) continue;
    if (C.starts(i, len)){
      const top = ch.notes && ch.notes.length ? ch.notes[ch.notes.length - 1] : ch.bass + 12;
      seq.setStepNote(i, top, 100);
    } else {
      /* a tie extends the note before it rather than sounding — see stepEvent */
      st.tie = 1;
    }
  }
  paintSeqEdit();
  grid.render();
});
Patchwork.chords.onChange(paintGroove);
paintGroove();
})();
