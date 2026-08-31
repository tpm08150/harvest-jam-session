
/* ============ ui ============ */

const playBtn = $("#play"), tempoOut = $("#tempoOut"), lanesEl = $("#lanes");
const clampf = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Which element owns each lockable parameter, so a lock can be shown on the control that
   wrote it — the yellow label BS·1 and PM·1 both use. */
const faderReg = {};
/* assigned further down; declared here so an early paint cannot hit a temporal dead zone */
let clearLocksBtn = null;

/* ---- the lane grid ---- */
function buildLanes(){
  lanesEl.textContent = "";
  ORDER.forEach(id => {
    const row = document.createElement("div");
    row.className = "lane";
    const nm = document.createElement("button");
    nm.className = "lane-name" + (id === SEQ.lane ? " sel" : "");
    nm.textContent = VOICES[id].name;
    nm.dataset.v = id;
    nm.title = VOICES[id].full + " — click to hear it and bring it up in Voice, shift-click to play it without selecting";
    row.appendChild(nm);
    const pads = document.createElement("div");
    pads.className = "pads";
    for (let i = 0; i < MAX_STEPS; i++){
      const b = document.createElement("button");
      b.className = "pad";
      b.dataset.v = id; b.dataset.i = i;
      b.setAttribute("aria-label", VOICES[id].name + " step " + (i + 1));
      pads.appendChild(b);
    }
    row.appendChild(pads);
    lanesEl.appendChild(row);
  });
  paintPads();
}

function paintPads(){
  /* the grid's column count follows the pattern length, so 8 steps fill the row rather
     than leaving half of it empty */
  /* Sixteen columns is the widest a lane stays hittable at a panel's width, so anything
     longer wraps into rows of 16 inside the same grid rather than shrinking the pads to
     slivers. 64 steps is four rows per lane, which is what 64 steps looks like. */
  const cols = Math.min(16, SEQ.len);
  $$(".pads").forEach(p => p.style.setProperty("--steps", cols));
  $$(".pad").forEach(b => {
    const id = b.dataset.v, i = +b.dataset.i;
    b.hidden = i >= SEQ.len;
    const v = steps[id][i];
    b.classList.toggle("on", v > 0);
    b.classList.toggle("acc", v === 2);
    b.classList.toggle("beat", i % 4 === 0);
  });
}

/* Sounding a voice on demand, with no transport running. "Which one is LT again?" is the
   question the Voice faders exist to answer, and answering it should not mean programming
   a step, pressing Play and clearing it again. */
function audition(id){
  ensureAudio();
  fire(id, ctx.currentTime + .005, 1);
  flashLane(id);
}

/* ---- painting the grid ----
   A click cycles off → on → accent → off. Three states on one control, because a separate
   accent mode means holding a modifier to program the thing you most want to program — the
   downbeat of a kick is accented nearly every time.

   ⚠️ A DRAG PAINTS WHATEVER THE FIRST PAD BECAME. It falls out of that cycle rather than
   being bolted on beside it: press an empty step and you are drawing steps, press a lit one
   and you are drawing accents, press an accented one and you are erasing. Erase comes free
   and there is no modifier to remember, because the pad you started on already said what
   you meant. Lanes are not a boundary — drag down a column and you are writing a flam.

   Each pad is written once per drag, or a wiggle inside one pad would cycle it repeatedly
   and the value under your cursor would depend on how steady your hand is. */
let paintVal = null;            // what this drag is writing, null when not dragging
let painted = null;             // "voice:step" already written, so a wiggle cannot re-cycle
let lastPad = null;             // where this drag was last seen, so a fast one leaves no gaps

/* ⚠️ FILL THE SPAN, not the pad under the pointer. pointermove is SAMPLED — sweep the row
   quickly and the browser reports three positions across sixteen steps, so painting only
   what is reported draws a dotted line and the gesture reads as unreliable. Measured with a
   synthetic drag that reported four samples over eight pads: 0, 4 and 7 were filled and the
   rest were not.

   Along one axis at a time. Two samples that differ in BOTH lane and step have no
   unambiguous path between them and guessing one would write steps nobody dragged over —
   but down a column is as well defined as along a row, and a flam wants the same
   reliability a hi-hat line does. */
function writeStep(id, i){
  const k = id + ":" + i;
  if (i >= SEQ.len || painted.has(k)) return false;
  painted.add(k);
  steps[id][i] = paintVal;
  return true;
}
function writeSpan(id, from, to){
  let hit = false;
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) hit = writeStep(id, i) || hit;
  return hit;
}
function writeColumn(from, to, i){
  const a = ORDER.indexOf(from), b = ORDER.indexOf(to);
  if (a < 0 || b < 0) return writeStep(to, i);
  let hit = false;
  for (let k = Math.min(a, b); k <= Math.max(a, b); k++) hit = writeStep(ORDER[k], i) || hit;
  return hit;
}

/* ⚠️ elementFromPoint, not pointerenter. With the capture set below, enter and over never
   fire on the individual pads — the capture target swallows them — which is the same trap
   PM·1's keyboard documents at its own glissando. */
function padAt(x, y){
  const el = document.elementFromPoint(x, y);
  const p = el ? el.closest(".pad") : null;
  return p && !p.hidden && lanesEl.contains(p) ? p : null;
}

function selectLane(id){
  SEQ.lane = id;
  $$(".lane-name").forEach(x => x.classList.toggle("sel", x.dataset.v === id));
  syncVoice();
}

/* Program mode is not painted. There the click chooses which hit the faders will write a
   lock onto and leaves the pattern alone, so a drag has nothing to fill in. */
lanesEl.addEventListener("pointerdown", e => {
  const pad = e.target.closest(".pad");
  if (!pad || pad.hidden) return;
  const id = pad.dataset.v, i = +pad.dataset.i;
  if (SEQ.mode === "program"){
    SEQ.sel = i;
  } else {
    paintVal = (steps[id][i] + 1) % 3;
    painted = new Set([id + ":" + i]);
    lastPad = {id, i};
    steps[id][i] = paintVal;
    /* guarded for the same reason PM·1 guards its release: capture throws on a pointer the
       browser no longer considers active, and the rest of this handler still has to run */
    try{ lanesEl.setPointerCapture(e.pointerId); }catch(x){}
  }
  selectLane(id);
  paintPads();
  paintLocks();
});
lanesEl.addEventListener("pointermove", e => {
  if (paintVal == null) return;
  const pad = padAt(e.clientX, e.clientY);
  if (!pad) return;
  const id = pad.dataset.v, i = +pad.dataset.i;
  if (lastPad && lastPad.id === id && lastPad.i === i) return;
  const hit = !lastPad                ? writeStep(id, i)
            : lastPad.id === id       ? writeSpan(id, lastPad.i, i)
            : lastPad.i  === i        ? writeColumn(lastPad.id, id, i)
            :                           writeStep(id, i);
  lastPad = {id, i};
  if (hit) paintPads();
});
const endPaint = e => {
  paintVal = null; painted = null; lastPad = null;
  if (e && e.pointerId != null){ try{ lanesEl.releasePointerCapture(e.pointerId); }catch(x){} }
};
lanesEl.addEventListener("pointerup", endPaint);
lanesEl.addEventListener("pointercancel", endPaint);

lanesEl.addEventListener("click", e => {
  const nm = e.target.closest(".lane-name");
  if (nm){
    const id = nm.dataset.v;
    /* Plain click selects AND sounds it. Shift is the performance gesture and keeps the
       selection where it is, so you can finger-drum one voice while editing another.

       Only the shift form writes to the grid. Selecting a voice to tweak is not playing a
       note, and with DR·1 armed a recording selection would punch a hit into the pattern
       every time you reached for the Tune fader. */
    if (e.shiftKey) Patchwork.record.note("dr1", id, 110);
    else {
      SEQ.lane = id;
      $$(".lane-name").forEach(x => x.classList.toggle("sel", x.dataset.v === id));
      syncVoice();
    }
    audition(id);
    return;
  }
  const pad = e.target.closest(".pad");
  if (!pad || pad.hidden) return;
  /* ⚠️ A POINTER ALREADY DID THIS ONE. The pads are buttons, so pressing Enter on a focused
     pad still has to work — and that click is the only one that reaches here, because a
     click synthesised from a keypress carries detail 0 while a pointer's carries at least
     one. Without the guard every mouse click would cycle the pad twice. */
  if (e.detail > 0) return;
  const id = pad.dataset.v, i = +pad.dataset.i;
  if (SEQ.mode === "program") SEQ.sel = i;
  else steps[id][i] = (steps[id][i] + 1) % 3;
  selectLane(id);
  paintPads();
  paintLocks();
});

function flashLane(id){
  const el = lanesEl.querySelector('.lane-name[data-v="' + id + '"]');
  if (!el) return;
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 90);
}

/* ---- playhead ----
   Painted from the marks the scheduler left, looked up against the audio clock — the
   same approach CS·1 and MS·1 use. Reading stepIndex directly would show the lookahead's
   position, which is up to 200 ms ahead of what you can hear. */
function paint(){
  if (!SEQ.playing){ clearMarks(); return; }
  const now = ctx.currentTime;
  let cur = -1;
  for (let k = marks.length - 1; k >= 0; k--)
    if (marks[k].t <= now && now < marks[k].end){ cur = marks[k].i; break; }
  $$(".pad").forEach(b => b.classList.toggle("now", +b.dataset.i === cur));
  if (cur >= 0 && cur !== lastPainted){
    ORDER.forEach(id => { if (steps[id][cur]) flashLane(id); });
    lastPainted = cur;
  }
  requestAnimationFrame(paint);
}
let lastPainted = -1;
function clearMarks(){ $$(".pad").forEach(b => b.classList.remove("now")); lastPainted = -1; }

/* ---- horizontal faders ----
   Registered the way CS·1's are, so MIDI learn and patch save would get them for free. */
const faderCtl = {};
/* min and max are functions, not numbers, because Tune's range depends on which voice is
   selected — a kick tuned to a hat's 40 Hz fundamental is inaudible, and a hat at a
   kick's 48 Hz is a buzz. One fader serving eight voices needs the range to move with
   the selection rather than being remapped after the fact. */
/* `param` is the key in P[lane] this fader owns. It is what a parameter lock is keyed on,
   and the reason a fader has to say which one it is rather than just how to set it — the
   same argument BS·1's fader() makes. Faders with no param (swing, accent) are the
   pattern's, not a voice's, and cannot be locked. */
function makeFader(sel, get, set, fmt, min, max, param){
  const el = $(sel), slot = el.querySelector(".hslot"), cap = el.querySelector(".hcap"),
        val = el.querySelector(".hval");
  if (param) faderReg[param] = el;
  const lo = () => (typeof min === "function" ? min() : min);
  const hi = () => (typeof max === "function" ? max() : max);
  function paintF(){
    const a = lo(), b = hi();
    cap.style.left = (clampf((get() - a) / (b - a), 0, 1) * 100) + "%";
    val.textContent = fmt(get());
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      const x = clampf((cx - r.left) / r.width, 0, 1);
      const a = lo(), b = hi();
      set(a + x * (b - a));
      paintF();
      /* In program mode moving a control IS the lock gesture — no separate arm step, the
         same as the other three sequencers. */
      if (param && lock(param)) paintLocks();
    };
    move(e);
    el.classList.add("dragging");
    el.setPointerCapture && e.pointerId != null && el.setPointerCapture(e.pointerId);
    const up = () => {
      el.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  faderCtl[sel] = paintF;
  paintF();
  return paintF;
}

/* ---- per-voice controls ----
   One set of faders serving whichever lane is selected, rather than four controls per
   voice times eight voices. Thirty-two knobs on a panel this size is a wall, and a drum
   machine is played on the grid — the voice faders are for setting up, not performing. */
const TUNE_RANGE = {bd:[28,90], sd:[120,320], cp:[500,2200], lt:[55,180],
                    ht:[100,320], ch:[24,70], oh:[24,70], rs:[900,2600]};
const cur = () => P[SEQ.lane];

function syncVoice(){
  const v = VOICES[SEQ.lane];
  if (typeof paintLocks === "function") paintLocks();
  $("#voiceTag").textContent = v.name;
  $("#voiceMeta").textContent = v.full;
  ["#tuneF", "#toneF", "#decayF", "#levelF", "#verbF", "#gateF"]
    .forEach(k => faderCtl[k] && faderCtl[k]());
}

makeFader("#tuneF",  () => cur().tune,  v => { cur().tune = v; },
          v => (v < 100 ? v.toFixed(1) : Math.round(v)) + " Hz",
          () => TUNE_RANGE[SEQ.lane][0], () => TUNE_RANGE[SEQ.lane][1], "tune");
makeFader("#toneF",  () => cur().tone,  v => { cur().tone = v; },
          v => Math.round(v * 100) + "%", 0, 1, "tone");
makeFader("#decayF", () => cur().decay, v => { cur().decay = v; },
          v => (v * 1000).toFixed(0) + " ms", .02, 1.2, "decay");
makeFader("#levelF", () => cur().level, v => { cur().level = v; },
          v => Math.round(v * 100) + "%", 0, 1, "level");
/* Off reads as "off" rather than "0%": a send at zero is a different thing from a level at
   zero, and the voice row is where you look to see whether a voice is in the reverb at all. */
makeFader("#verbF",  () => cur().verb,  v => { cur().verb = v; },
          v => (v < .005 ? "off" : Math.round(v * 100) + "%"), 0, 1, "verb");
makeFader("#gateF",  () => cur().gate,  v => { cur().gate = v; },
          v => (v * 1000).toFixed(0) + " ms", .04, .5, "gate");
makeFader("#swingF",  () => SEQ.swing,     v => { SEQ.swing = v; },
          v => Math.round(v * 100) + "%", .5, .75);
makeFader("#accentF", () => SEQ.accentAmt, v => { SEQ.accentAmt = v; },
          v => Math.round(v * 100) + "%", 0, .8);

/* ---- program mode and parameter locks ---- */
const seqModeEl = $("#seqMode"), lockHintEl = $("#lockHint");
seqModeEl.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  SEQ.mode = b.dataset.p;
  $$("#seqMode button").forEach(x => x.classList.toggle("on", x.dataset.p === SEQ.mode));
  paintPads();
  paintLocks();
});
/* Double-click unlocks BEFORE it would reset anything: otherwise there is no way to take a
   lock off a control without also losing the voice setting underneath it. PM·1's rule. */
["tune", "tone", "decay", "level"].forEach(param => {
  const el = faderReg[param];
  if (el) el.addEventListener("dblclick", () => {
    if (SEQ.mode === "program" && unlock(param)) paintLocks();
  });
});

function paintLocks(){
  const program = SEQ.mode === "program";
  ["tune", "tone", "decay", "level"].forEach(param => {
    const el = faderReg[param];
    if (el) el.classList.toggle("locked", program && isLocked(param));
  });
  $$(".pad").forEach(b => {
    const id = b.dataset.v, i = +b.dataset.i;
    b.classList.toggle("lock", !!lockAt(id, i));
    b.classList.toggle("sel", program && id === SEQ.lane && i === SEQ.sel);
  });
  if (lockHintEl){
    const n = lockCount(SEQ.lane);
    lockHintEl.textContent = !program
      ? (n ? n + " locked step" + (n === 1 ? "" : "s") + " on " + SEQ.lane.toUpperCase() : "")
      : "step " + (SEQ.sel + 1) + " of " + SEQ.lane.toUpperCase()
        + " — move a voice fader to lock it";
  }
  if (clearLocksBtn) clearLocksBtn.paint();
}

/* One implementation of this button across the rack — see seq/step-seq.js. DR·1 keeps its
   locks per LANE, so the button is about the lane whose voice the faders are editing. */
clearLocksBtn = Patchwork.mountClearLocks($("#clearLocks"), {
  steps: () => Array.from({length: SEQ.len}, (_, i) => ({locks: lockAt(SEQ.lane, i)})),
  sel: () => SEQ.sel,
  clear: all => clearLocks(all),
  repaint: () => { paintPads(); paintLocks(); }
});

/* ---- transport and pattern controls ---- */
playBtn.addEventListener("click", () => SEQ.playing ? stopPlay() : startPlay());
$("#clearPat").addEventListener("click", () => { ORDER.forEach(k => steps[k].fill(0)); paintPads(); });
$("#defaultPat").addEventListener("click", () => { loadDefaultPattern(); paintPads(); });
$("#panic").addEventListener("click", () => { stopPlay(); midiPanic(); });

function setBpm(v, fromShell){
  const b = Math.round(clampf(v, 40, 240));
  tempoOut.textContent = b;
  if (!fromShell) Patchwork.clock.setBpm(b, "dr1");
}
Patchwork.clock.onTempo("dr1", v => setBpm(v, true), 120);
setBpm(Patchwork.clock.bpm, true);
$("#bpmUp").addEventListener("click", () => setBpm(Patchwork.clock.bpm + 1));
$("#bpmDown").addEventListener("click", () => setBpm(Patchwork.clock.bpm - 1));

$("#rate").addEventListener("change", e => { SEQ.rate = e.target.value; });
$("#len").addEventListener("change", e => { SEQ.len = +e.target.value; paintPads(); });

/* Space plays, and only when this panel owns the keyboard — see shell/host.js. */
onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ SEQ.playing ? stopPlay() : startPlay(); e.preventDefault(); }
});

/* The computer keyboard is the shell's — see shell/keys.js. A drum machine has no scale,
   so the row maps to the eight LANES in kit order: the same thing a shift-click on a lane
   name does, record.note() included, so a typed part lands on the grid. Keys past the
   eighth map to nothing and are ignored rather than wrapping round to the kick. */
Patchwork.keys.mount(root, {
  map: i => ORDER[i] || null,
  on: (id, v) => {
    Patchwork.record.note("dr1", id, v);
    audition(id);
    SEQ.lane = id;
    $$(".lane-name").forEach(x => x.classList.toggle("sel", x.dataset.v === id));
    syncVoice();
  },
  off: () => {}                    // a drum voice rings out; there is nothing to release
});

buildLanes();
syncVoice();

/* ---- the kit, for a shared jam ----
   Eight voices of six numbers. Not the pattern — that is the scene's — and not the trims,
   which are measured constants rather than anything you dial. */
/* ⚠️ ONE definition of this instrument's sound, handed to both the jam and the
   patch store. Written twice they would drift, and the symptom would be a saved
   patch that recalls slightly less than a jam shares — invisible until two people
   compare what they are hearing. */
const SOUND = {
  capture: () => {
    const out = {};
    ORDER.forEach(id => {
      const v = P[id];
      out[id] = {tune: v.tune, tone: v.tone, decay: v.decay, level: v.level,
                 verb: v.verb, gate: v.gate};
    });
    return out;
  },
  apply: src => {
    if (!src) return;
    ORDER.forEach(id => {
      const got = src[id]; if (!got) return;
      /* a patch saved before the reverb existed carries no verb, and reads back as the
         dry kit it was — the key is simply absent and the default stands */
      ["tune", "tone", "decay", "level", "verb", "gate"].forEach(k => {
        if (typeof got[k] === "number" && isFinite(got[k])) P[id][k] = got[k];
      });
    });
    syncVoice();
  }
};
Patchwork.session.registerPatch("dr1", SOUND);
Patchwork.patches.mount(root, "dr1", SOUND);


/* ---- somebody else's hits ----
   A lane id rather than a note number, because that is what DR·1's keyboard sends. A drum
   voice rings out on its own, so there is nothing to release. */
Patchwork.session.registerVoice("dr1", {
  on: id => { if (VOICES[id]) audition(id); },
  off: () => {}
});
