/* ============ ui ============ */
const chordsEl = $("#chords"), metaEl = $("#meta"), playBtn = $("#play"), keySel = $("#key"), moodSel = $("#mood"), tempoOut = $("#tempoOut"), lenSel = $("#len"), modeSel = $("#mode"), modeNote = $("#modeNote"), totalBarsEl = $("#totalBars");

const title = s => s.charAt(0).toUpperCase() + s.slice(1);

/* Only list moods that can actually satisfy the selected mode — offering Dusk under
   "Major" just to report a fallback afterwards is confusing. Built from POOLS, so a new
   pool appears automatically and lands in the right lists. */
function syncMoodOptions(){
  const wantMinor = modeSel.value === "minor" ? true
                  : modeSel.value === "major" ? false : null;
  const allowed = wantMinor === null ? MOODS : MOODS.filter(m => moodHas(m, wantMinor));
  const prev = moodSel.value;
  moodSel.innerHTML = "";
  moodSel.appendChild(Object.assign(document.createElement("option"),
    {value:"any", textContent:"Anything"}));
  allowed.forEach(m => moodSel.appendChild(
    Object.assign(document.createElement("option"), {value:m, textContent:title(m)})));
  const kept = prev === "any" || allowed.indexOf(prev) >= 0;
  moodSel.value = kept ? prev : "any";
  return kept ? null : prev;    // the mood that had to be dropped, if any
}
syncMoodOptions();

/* 12 is the ceiling because 3 wide x 4 rows is exactly the EP-133's pad grid */
lenSel.appendChild(Object.assign(document.createElement("option"), {value:"auto", textContent:"Auto"}));
for (let n = 3; n <= 12; n++){
  lenSel.appendChild(Object.assign(document.createElement("option"), {value:String(n), textContent:String(n)}));
}
lenSel.value = "auto";

for (let pc = 0; pc < 12; pc++){
  const o = document.createElement("option");
  o.value = pc; o.textContent = noteName(pc, pc);
  keySel.appendChild(o);
}
const rand = document.createElement("option");
rand.value = "rand"; rand.textContent = "Random";
keySel.appendChild(rand);
keySel.value = "0";

const FADERS = [
  {id:"tone",    lab:"Tone",    g:1, fmt:v => Math.round(curve(v,TONE_MIN,TONE_MAX)) + "Hz"},
  {id:"attack",  lab:"Attack",  g:1, fmt:v => (curve(v,.004,1.4)*1000 < 999 ? Math.round(curve(v,.004,1.4)*1000)+"ms" : curve(v,.004,1.4).toFixed(2)+"s")},
  {id:"release", lab:"Release", g:1, fmt:v => curve(v,REL_MIN,REL_MAX).toFixed(2)+"s"},
  {id:"space",   lab:"Space",   g:2, fmt:v => Math.round(v*100)+"%"},
  {id:"spread",  lab:"Spread",  g:2, fmt:v => Math.round(v*100)+"%"},
  {id:"level",   lab:"Level",   g:2, fmt:v => Math.round(v*100)+"%"}
];

const fadersEl = $("#faders");
FADERS.forEach(f => {
  const el = document.createElement("div");
  el.className = "fader g" + f.g;
  el.tabIndex = 0;
  el.setAttribute("role","slider");
  el.setAttribute("aria-label", f.aria || f.lab);
  el.setAttribute("aria-valuemin","0");
  el.setAttribute("aria-valuemax","100");
  el.innerHTML = '<div class="slot"><div class="cap"></div></div><div class="lab">'+f.lab+'</div><div class="val"></div><div class="bind"></div>';
  fadersEl.appendChild(el);
  const slot = el.querySelector(".slot"), cap = el.querySelector(".cap"), val = el.querySelector(".val");

  function render(){
    const v = P[f.id];
    cap.style.setProperty("--v", v);
    val.textContent = f.fmt(v);
    el.setAttribute("aria-valuenow", Math.round(v*100));
    el.setAttribute("aria-valuetext", f.fmt(v));
  }
  function set(v){
    P[f.id] = Math.min(1, Math.max(0, v));
    if (f.id === "level" && master) master.gain.setTargetAtTime(P.level, ctx.currentTime, .02);
    else if (f.id === "space") applySpace();
    else refreshLive(f.id);
    render();
  }
  function fromEvent(e){
    const r = slot.getBoundingClientRect();
    set(1 - (e.clientY - r.top - 11) / (r.height - 22));
  }
  el.addEventListener("pointerdown", e => {
    if (LEARN.on){ arm({type:"fader", id:f.id}, el); e.preventDefault(); return; }
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    fromEvent(e); e.preventDefault();
  });
  el.addEventListener("pointermove", e => { if (el.hasPointerCapture(e.pointerId)) fromEvent(e); });
  el.addEventListener("pointerup", e => { el.classList.remove("dragging"); el.releasePointerCapture(e.pointerId); });
  el.addEventListener("keydown", e => {
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowRight") set(P[f.id] + .02);
    else if (k === "ArrowDown" || k === "ArrowLeft") set(P[f.id] - .02);
    else if (k === "PageUp") set(P[f.id] + .1);
    else if (k === "PageDown") set(P[f.id] - .1);
    else if (k === "Home") set(0);
    else if (k === "End") set(1);
    else return;
    e.preventDefault();
  });
  faderCtl[f.id] = {set, el};
  render();
});

/* Horizontal faders live outside the bank but register in the same place, so MIDI learn,
   patch save and CC control all treat them exactly like the vertical ones. */
function makeHFader(sel, param, fmt){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  function render(){
    cap.style.setProperty("--v", P[param]);
    val.textContent = fmt(P[param]);
    el.setAttribute("aria-valuenow", Math.round(P[param] * 100));
    el.setAttribute("aria-valuetext", fmt(P[param]));
  }
  function set(v){ P[param] = Math.min(1, Math.max(0, v)); render(); }
  function fromEvent(e){
    const r = slot.getBoundingClientRect();
    set((e.clientX - r.left - 11) / (r.width - 22));
  }
  el.addEventListener("pointerdown", e => {
    if (LEARN.on){ arm({type:"fader", id:param}, el); e.preventDefault(); return; }
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    fromEvent(e); e.preventDefault();
  });
  el.addEventListener("pointermove", e => { if (el.hasPointerCapture(e.pointerId)) fromEvent(e); });
  el.addEventListener("pointerup", e => { el.classList.remove("dragging"); el.releasePointerCapture(e.pointerId); });
  el.addEventListener("keydown", e => {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowUp") set(P[param] + .02);
    else if (k === "ArrowLeft" || k === "ArrowDown") set(P[param] - .02);
    else if (k === "PageUp") set(P[param] + .1);
    else if (k === "PageDown") set(P[param] - .1);
    else if (k === "Home") set(0);
    else if (k === "End") set(1);
    else return;
    e.preventDefault();
  });
  faderCtl[param] = {set, el};
  render();
}

makeHFader("#bassSusFader", "bassSus",
  v => v >= .98 ? "hold" : Math.round(curve(v, .02, 1) * 100) + "%");
/* dB against unity at the midpoint, which is how a level control should read */
makeHFader("#bassLvlFader", "bassLvl", v => {
  if (v <= 0) return "off";
  const db = 20 * Math.log10(v / .5);
  return (db > 0 ? "+" : "") + db.toFixed(1) + " dB";
});

function buildVoicings(prog){
  let prev = null;
  prog.voicings = prog.chords.map(ch => {
    const v = voiceChord(ch, state.keyPc, prev);
    prev = v.center;
    return v.notes;
  });
}

function keyMinor(){ return !!(state.prog && state.prog.minor); }

let openPad = null;
function syncPadEditors(){
  const pads = chordsEl.querySelectorAll(".pad");
  pads.forEach((pad, idx) => {
    const ed = pad.querySelector(".pad-edit"), btn = pad.querySelector(".pick button");
    if (!ed) return;
    const on = openPad === idx;
    ed.hidden = !on;
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
  });
  if (openPad != null && openPad >= pads.length) openPad = null;
}
document.addEventListener("click", () => { if (openPad != null){ openPad = null; syncPadEditors(); } });
onKey("keydown", e => {
  if (e.key === "Escape" && openPad != null){ openPad = null; syncPadEditors(); }
});

/* Readable names for every quality in QUAL, so the type list isn't raw keys */
const QUAL_LABEL = {
  maj:"major", min:"minor", dim:"dim", sus2:"sus2", sus4:"sus4", six:"6", m6:"m6",
  maj7:"maj7", min7:"m7", dom7:"7 (dom)", m7b5:"m7♭5",
  add9:"add9", madd9:"m(add9)", maj9:"maj9", min9:"m9", dom9:"9"
};
const QUAL_ORDER = ["maj","min","dim","sus2","sus4","six","m6",
                    "maj7","min7","dom7","m7b5","add9","madd9","maj9","min9","dom9"];

/* quarter-bar resolution from ¼ up to 8 */
const BAR_STEPS = Array.from({length:32}, (_, i) => (i + 1) / 4);
function barsLabel(v){
  const whole = Math.floor(v);
  const frac = {0:"", 0.25:"¼", 0.5:"½", 0.75:"¾"}[+(v - whole).toFixed(2)] || "";
  if (whole === 0) return frac + " bar";
  return whole + frac + (v === 1 ? " bar" : " bars");
}

function fillRootOptions(sel, cur){
  const m = keyMinor();
  sel.innerHTML = "";
  for (let r = 0; r < 12; r++){
    const opt = document.createElement("option");
    opt.value = String(r);
    opt.textContent = rootName(r, state.keyPc, m) + "   " + RN[r];
    sel.appendChild(opt);
  }
  sel.value = String(((cur.r % 12) + 12) % 12);
}
function fillQualOptions(sel, cur){
  sel.innerHTML = "";
  QUAL_ORDER.forEach(q => {
    if (!QUAL[q]) return;
    const opt = document.createElement("option");
    opt.value = q;
    opt.textContent = QUAL_LABEL[q] || q;
    sel.appendChild(opt);
  });
  sel.value = cur.q;
}
function fillBarsOptions(sel, cur){
  sel.innerHTML = "";
  BAR_STEPS.forEach(v => {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = barsLabel(v);
    sel.appendChild(opt);
  });
  sel.value = String(cur.bars > 0 ? cur.bars : 1);
}

function editChord(i, patch){
  const p = state.prog;
  if (!p || !p.chords[i]) return;
  const cur = p.chords[i];
  const next = {r:cur.r, q:cur.q, bars:cur.bars || 1};
  if (patch.r != null) next.r = patch.r;
  if (patch.q != null && QUAL[patch.q]) next.q = patch.q;
  if (patch.bars != null) next.bars = patch.bars;
  p.chords[i] = next;
  if (patch.r != null || patch.q != null){
    buildVoicings(p);     // voice leading is a chain, so one edit revoices the rest
  }
  renderProgression();
}

function updateTotalBars(){
  const p = state.prog;
  if (!p){ totalBarsEl.textContent = ""; return; }
  const total = p.chords.reduce((sum, _, i) => sum + chordBars(i), 0);
  totalBarsEl.textContent = "· " + (+total.toFixed(2)) + (total === 1 ? " bar" : " bars");
}

/* only C♯/D♭, F♯/G♭ and G♯/A♭ differ between the two spellings, but leaving the picker
   on the major name while the card says the other one reads as a bug */
function relabelKeys(){
  const m = keyMinor();
  for (let pc = 0; pc < 12; pc++) keySel.options[pc].textContent = noteName(pc, pc, m);
}

function renderProgression(){
  const p = state.prog;
  /* 3 wide, filled bottom-up, so chord 1 sits bottom-left like pad 1 on the EP-133.
     Placement is explicit rather than reversing the DOM — that keeps document order at
     1..n, which paint(), flashPad() and the pad badges all index into. */
  const cols = Math.min(3, p.chords.length);
  const rows = Math.ceil(p.chords.length / cols);
  chordsEl.innerHTML = "";
  p.chords.forEach((ch, i) => {
    const pad = document.createElement("div");
    pad.className = "pad";
    pad.style.gridRow = String(rows - Math.floor(i / cols));
    pad.style.gridColumn = String((i % cols) + 1);

    const bars = chordBars(i);
    const b = document.createElement("button");
    b.className = "chord";
    const note = padNoteFor(i);
    b.innerHTML = '<span class="wipe"></span><span class="name">'+chordName(ch, state.keyPc, p.minor)+'</span><span class="rn">'+romanName(ch)+'</span>'
      + (note == null ? '' : '<span class="bind">'+midiNoteLabel(note)+'</span>')
      + (bars === 1 ? '' : '<span class="len">'+barsLabel(bars)+'</span>');
    b.addEventListener("click", () => {
      if (LEARN.on) arm({type:"pad", i}, b);
      else stab(i);
    });

    const pick = document.createElement("span");
    pick.className = "pick";
    pick.innerHTML = '<button type="button" aria-label="Edit pad '+(i+1)+'" aria-expanded="false">▾</button>';

    const edit = document.createElement("div");
    edit.className = "pad-edit";
    edit.hidden = true;
    /* anchor right for the last column so the panel can't run off the card */
    if (i % cols === cols - 1){ edit.style.right = "0"; } else { edit.style.left = "0"; }
    edit.innerHTML = '<label>Root <select class="pe-root"></select></label>'
                   + '<label>Type <select class="pe-qual"></select></label>'
                   + '<label>Length <select class="pe-bars"></select></label>';
    const rootSel = edit.querySelector(".pe-root"),
          qualSel = edit.querySelector(".pe-qual"),
          barsSel = edit.querySelector(".pe-bars");
    fillRootOptions(rootSel, ch);
    fillQualOptions(qualSel, ch);
    fillBarsOptions(barsSel, {bars});
    rootSel.addEventListener("change", () => editChord(i, {r:parseInt(rootSel.value, 10)}));
    qualSel.addEventListener("change", () => editChord(i, {q:qualSel.value}));
    barsSel.addEventListener("change", () => editChord(i, {bars:parseFloat(barsSel.value)}));
    edit.addEventListener("click", e => e.stopPropagation());

    pick.querySelector("button").addEventListener("click", e => {
      e.stopPropagation();
      openPad = (openPad === i) ? null : i;
      syncPadEditors();
    });

    pad.appendChild(b);
    pad.appendChild(pick);
    pad.appendChild(edit);
    chordsEl.appendChild(pad);
  });
  syncPadEditors();     // an edit re-renders the pads, so reopen whichever was open
  updateTotalBars();
  relabelKeys();
  chordsEl.style.gridTemplateColumns = "repeat(" + cols + ",minmax(0,1fr))";
  updateMeta();
}

/* meta line only — never rebuilds the chord grid, so it's safe to call from the clock */
function updateMeta(){
  const p = state.prog; if (!p) return;
  metaEl.textContent = noteName(state.keyPc, state.keyPc, p.minor) + (p.minor ? " minor" : " major")
    + " · " + title(p.mood) + " · " + state.bpm + " bpm"
    + (MIDI.sync === "ext" ? " · ext" : "");
}

function newProgression(){
  if (keySel.value === "rand") state.keyPc = Math.floor(Math.random()*12);
  else state.keyPc = parseInt(keySel.value,10);
  state.prog = makeProgression(
    moodSel.value,
    lenSel.value === "auto" ? 0 : parseInt(lenSel.value, 10),
    modeSel.value
  );
  buildVoicings(state.prog);
  renderProgression();
  const p = state.prog;
  modeNote.style.display = p.fallback ? "" : "none";
  if (p.fallback){
    modeNote.textContent = title(p.mood) + " has no " + modeSel.value + " progressions — "
      + "generated in " + (p.minor ? "minor" : "major") + " instead.";
  }
  if (state.playing){ nextIndex = 0; }
}

$("#gen").addEventListener("click", () => { newProgression(); if (!state.playing) startPlay(); });
playBtn.addEventListener("click", () => state.playing ? stopPlay() : startPlay());

function setBpm(v, exact, fromShell){
  /* keep the unrounded value for the transport; round only for the readout */
  const clamped = Math.min(180, Math.max(50, v));
  state.bpmExact = exact ? clamped : Math.round(clamped);
  /* Tempo is the page's, not this panel's. Skipped when the shell is the one telling us,
     or the two instruments would bounce a change back and forth. */
  if (!fromShell) Patchwork.clock.setBpm(state.bpmExact, "cs1");
  const shown = Math.round(clamped);
  if (shown !== state.bpm){
    state.bpm = shown;
    tempoOut.textContent = shown;
    updateMeta();
    updateSwingHint();
  }
}
Patchwork.clock.onTempo("cs1", v => setBpm(v, true, true), state.bpmExact);
$("#bpmUp").addEventListener("click", () => setBpm(state.bpm + 2));
$("#bpmDown").addEventListener("click", () => setBpm(state.bpm - 2));
keySel.addEventListener("change", () => {
  if (keySel.value !== "rand") state.keyPc = parseInt(keySel.value,10);
  else state.keyPc = Math.floor(Math.random()*12);
  buildVoicings(state.prog); renderProgression();
});
moodSel.addEventListener("change", newProgression);
lenSel.addEventListener("change", newProgression);
modeSel.addEventListener("change", () => {
  const dropped = syncMoodOptions();
  newProgression();
  if (dropped){
    modeNote.style.display = "";
    modeNote.textContent = title(dropped) + " has no " + modeSel.value
      + " progressions, so it's not offered in this mode — switched to Anything.";
  }
});

$("#voice").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  state.voice = b.dataset.v;
  $("#voice").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
});
$("#motion").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  state.motion = b.dataset.m;
  $("#motion").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  syncMotionOpts();
});

$("#bass").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  state.bass = b.dataset.b === "on";
  $("#bass").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
});

/* ---- arp & pulse options ---- */
function syncMotionOpts(){
  const arp = state.motion === "arp", pulse = state.motion === "pulse";
  $("#motionOpts").hidden = !(arp || pulse);   // swing only means anything for stepped motions
  $("#arpRow").hidden = !arp;
  $("#pulseRow").hidden = !pulse;
  updateSwingHint();   // the ms figure depends on which motion's step size applies
}

/* the percentages musicians read on a DAW swing control; 50% is straight */
const SWING_OPTS = [[.5,"Straight"],[.54,"54%"],[.58,"58%"],[.62,"62%"],
                    [.667,"67% · triplet"],[.71,"71%"],[.75,"75% · hard"]];
const swingSel = $("#swing"), swingHint = $("#swingHint");
SWING_OPTS.forEach(o => swingSel.appendChild(
  Object.assign(document.createElement("option"), {value:String(o[0]), textContent:o[1]})));
swingSel.value = String(SW.ratio);

function updateSwingHint(){
  if (SW.ratio <= .5){ swingHint.textContent = "even steps"; return; }
  const beat = 60 / state.bpm;
  let step;
  if (state.motion === "pulse"){
    step = (beat * 4) / Math.max(1, PULSE.steps);
  } else {
    /* under "auto" the rate depends on the sequence length, so read it off the real voicing */
    const v = state.prog && state.prog.voicings && state.prog.voicings[0];
    step = arpStepFor(beat, v ? arpSequence(v).length : 4);
  }
  swingHint.textContent = "off-beats late by " + Math.round(step*(2*SW.ratio-1)*1000) + " ms";
}
swingSel.addEventListener("change", () => {
  SW.ratio = parseFloat(swingSel.value);
  updateSwingHint();
});

const stepGrid = $("#stepGrid"), pulseStepsSel = $("#pulseSteps"),
      bassGrid = $("#bassGrid"), bassStepsSel = $("#bassSteps");

/* Pulse and Bass are the same widget over different data */
function fillStepCounts(sel, cfg){
  [4,6,8,12,16].forEach(n => sel.appendChild(
    Object.assign(document.createElement("option"), {value:String(n), textContent:n + " steps"})));
  sel.value = String(cfg.steps);
}
function renderSteps(el, cfg){
  el.innerHTML = "";
  /* Anything over 8 splits into two equal rows rather than wrapping wherever the width
     runs out — 16 reads as 2x8, which is also two beats per row. */
  const cols = cfg.steps > 8 ? cfg.steps / 2 : cfg.steps;
  el.style.gridTemplateColumns = "repeat(" + cols + ", auto)";
  const perBeat = cfg.steps / 4;
  for (let s = 0; s < cfg.steps; s++){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "step" + (cfg.on[s] ? " on" : "")
                + (perBeat >= 1 && s % perBeat === 0 ? " beat" : "");
    b.dataset.s = s;
    b.setAttribute("aria-label", "Step " + (s + 1));
    b.setAttribute("aria-pressed", cfg.on[s] ? "true" : "false");
    el.appendChild(b);
  }
}
function wireSteps(el, cfg){
  el.addEventListener("click", e => {
    const b = e.target.closest(".step"); if (!b) return;
    const s = parseInt(b.dataset.s, 10);
    cfg.on[s] = cfg.on[s] ? 0 : 1;
    b.classList.toggle("on", !!cfg.on[s]);
    b.setAttribute("aria-pressed", cfg.on[s] ? "true" : "false");
  });
}
function setStepCount(cfg, el, n){
  const old = cfg.on.slice();
  cfg.steps = n;
  /* repeat the old pattern rather than blanking it — 8→16 should feel like the same
     groove at double resolution, not like the sequencer got wiped */
  cfg.on = Array.from({length:n}, (_, i) => old[i % old.length] || 0);
  renderSteps(el, cfg);
}
function buildStepGrid(){ renderSteps(stepGrid, PULSE); }

fillStepCounts(pulseStepsSel, PULSE);
fillStepCounts(bassStepsSel, BASSQ);
wireSteps(stepGrid, PULSE);
wireSteps(bassGrid, BASSQ);
renderSteps(bassGrid, BASSQ);
pulseStepsSel.addEventListener("change", () => {
  setStepCount(PULSE, stepGrid, parseInt(pulseStepsSel.value, 10));
  updateSwingHint();
});
bassStepsSel.addEventListener("change", () =>
  setStepCount(BASSQ, bassGrid, parseInt(bassStepsSel.value, 10)));

$("#arpDir").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  ARP.dir = b.dataset.d;
  $("#arpDir").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
});
$("#arpOct").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  ARP.octaves = parseInt(b.dataset.o, 10);
  $("#arpOct").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  updateSwingHint();          // octave count can change the auto rate
});

/* notes per bar, with the note value that division works out to in 4/4 */
const ARP_RATES = [["auto","Auto"],[4,"4 / bar · ¼"],[6,"6 / bar · ¼T"],[8,"8 / bar · ⅛"],
                   [12,"12 / bar · ⅛T"],[16,"16 / bar · 1⁄16"],[24,"24 / bar · 1⁄16T"],
                   [32,"32 / bar · 1⁄32"]];
const arpRateSel = $("#arpRate");
ARP_RATES.forEach(r => arpRateSel.appendChild(
  Object.assign(document.createElement("option"), {value:String(r[0]), textContent:r[1]})));
arpRateSel.value = "auto";
arpRateSel.addEventListener("change", () => {
  ARP.rate = arpRateSel.value === "auto" ? "auto" : parseInt(arpRateSel.value, 10);
  updateSwingHint();
});

buildStepGrid();
syncMotionOpts();

onKey("keydown", e => {
  /* target isn't always an Element — a key event dispatched at document has none of this */
  const el = e.target instanceof Element ? e.target : null;
  const tag = el ? el.tagName : "";
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (el && el.getAttribute("role") === "slider")) return;
  if (e.code === "Space"){
    if (tag === "BUTTON") return;   // let the focused button handle its own activation
    e.preventDefault(); state.playing ? stopPlay() : startPlay();
  }
  else if (e.key.toLowerCase() === "n"){ newProgression(); }
  else if (/^[1-9]$/.test(e.key)){
    const i = parseInt(e.key,10) - 1;
    if (state.prog && i < state.prog.chords.length) stab(i);
  }
});
window.addEventListener("resize", () => { if (state.prog) renderProgression(); });

