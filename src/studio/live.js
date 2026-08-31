
/* ---- the live page ----
   The scene launcher, made big, with an arm per track and one record button over the top.

   Ableton's gesture, which is the one worth copying: the transport is already running,
   you arm a track, you press record, and what you play lands on the grid. Nothing stops
   and nothing is a take. Arming is a standing choice; record is the momentary one. */
(() => {
"use strict";
const live = document.querySelector("#stLive");
const rack = document.querySelector(".st-rack");
const scenes = document.querySelector(".st-scenes");
const grid = document.querySelector("#liveGrid");
if (!live || !window.Patchwork || !Patchwork.record) return;

/* The columns, the cell states and the click table are `Patchwork.launch`'s — shared with
   the studio's small launcher, because the two are views of one grid and drifted apart
   once already. */
/* ---- the punch-in rack ----
   HOLD is the gesture. Press, the effect is in; let go, it is out — which is why these are
   pads rather than knobs and why they are here rather than on a panel: a control you set is
   a mixing decision, a control you hold for two bars is playing.

   The number row does the same thing, because the interesting live gesture is one hand on
   the launcher and one on the effects, and a mouse can only be in one place. */
/* ⚠️ SIXTEEN PADS AND SIXTEEN KEYS, in reading order: the number row, then the row above it.
   Q, W, E, R, T and Y are note keys in shell/keys.js, and on the live page they are taken
   from it — the panels are hidden there, so a note key is playing an instrument you cannot
   see, and an effect is the thing in front of you. The handler preventDefaults, which is
   what keys.js checks. */
const FXKEYS = "1234567890qwerty";
const FX = [
  {id: "lp",      name: "LP",      hint: "how far down the top comes off"},
  {id: "hp",      name: "HP",      hint: "how far up the bottom goes"},
  {id: "iso",     name: "Iso",     hint: "which slice is left"},
  {id: "stutter", name: "Stutter", hint: "how long a slice repeats"},
  {id: "loop",    name: "Loop",    hint: "how much goes round"},
  {id: "reverse", name: "Reverse", hint: "how long a slice plays backwards"},
  {id: "repitch", name: "Repitch", hint: "how far it is shifted"},
  {id: "gate",    name: "Gate",    hint: "how fast it chops"},
  {id: "pump",    name: "Pump",    hint: "how fast it breathes"},
  {id: "delay",   name: "Delay",   hint: "how much it feeds back"},
  {id: "space",   name: "Space",   hint: "how much goes to the room"},
  {id: "flange",  name: "Flange",  hint: "how fast the notch sweeps"},
  {id: "ring",    name: "Ring",    hint: "what it is multiplied by"},
  {id: "drive",   name: "Drive",   hint: "how hard it is pushed"},
  {id: "crush",   name: "Crush",   hint: "how many bits are left"},
  {id: "stop",    name: "Stop",    hint: "how long the machine takes to stop"}
];
const fxPads = document.querySelector("#stFxPads");
const fxLatch = document.querySelector("#stFxLatch");
const fxHint = document.querySelector("#stFxHint");
let latched = false;

function buildFx(){
  if (!fxPads || !window.Patchwork || !Patchwork.fx) return;
  fxPads.textContent = "";
  FX.forEach((f, i) => {
    const b = document.createElement("button");
    b.className = "st-fx-pad";
    b.dataset.fx = f.id;
    b.dataset.key = FXKEYS[i] || "";
    b.title = f.name + " — " + f.hint + ". Hold, or hold " + b.dataset.key.toUpperCase() +
              ". Arrows or the wheel move its number.";
    b.innerHTML = '<span class="st-fx-name"></span><span class="st-fx-val"></span>' +
                  '<span class="st-fx-key"></span>';
    b.querySelector(".st-fx-name").textContent = f.name;
    b.querySelector(".st-fx-key").textContent = b.dataset.key;
    fxPads.appendChild(b);
  });
  paintFx();
}
function paintFx(){
  if (!fxPads) return;
  const focus = Patchwork.fx.focus;
  fxPads.querySelectorAll(".st-fx-pad").forEach(b => {
    const id = b.dataset.fx;
    b.classList.toggle("st-on", Patchwork.fx.active(id));
    b.classList.toggle("st-focus", id === focus);
    b.querySelector(".st-fx-val").textContent = Patchwork.fx.paramText(id);
  });
  fxLatch.classList.toggle("st-on", latched);
  fxLatch.setAttribute("aria-pressed", latched ? "true" : "false");
  const f = FX.find(x => x.id === focus);
  fxHint.textContent = f ? "\u2190 \u2192  " + f.name + " \u00b7 " + f.hint : "";
}
/* Latched, a press is a toggle; held, it is a press. One function so the pointer and the
   number row cannot end up with different ideas about which. */
function fxDown(id){
  if (latched && Patchwork.fx.active(id)) Patchwork.fx.release(id);
  else Patchwork.fx.press(id);
}
function fxUp(id){ if (!latched) Patchwork.fx.release(id); }

if (fxPads){
  fxPads.addEventListener("pointerdown", e => {
    const b = e.target.closest(".st-fx-pad"); if (!b) return;
    if (e.pointerId != null) try{ b.setPointerCapture(e.pointerId); }catch(x){}
    fxDown(b.dataset.fx);
    e.preventDefault();
  });
  /* The wheel is the pointer's arrow keys. Over a pad it moves that pad's number and takes
     the focus with it, so reaching for one with the mouse and then reaching for the arrows
     carries on where you left off. */
  fxPads.addEventListener("wheel", e => {
    const b = e.target.closest(".st-fx-pad"); if (!b) return;
    Patchwork.fx.setFocus(b.dataset.fx);
    Patchwork.fx.nudge(e.deltaY < 0 ? 1 : -1);
    e.preventDefault();
  }, {passive: false});
  /* ⚠️ RELEASED FROM THE WINDOW, not from the pad. A pad stuck down is an effect you cannot
     turn off, which is the worst failure available to this control — and every way of
     letting go that does not end in a pointerup ON the pad leads there: dragging off it,
     a capture that did not take, the pointer being cancelled, the window losing focus. */
  const letGo = () => { if (!latched) Patchwork.fx.releaseAll(); };
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", letGo);
  window.addEventListener("blur", letGo);

  fxLatch.addEventListener("click", () => {
    latched = !latched;
    if (!latched) Patchwork.fx.releaseAll();
    paintFx();
  });

  /* ⚠️ Only while the live page is showing, and never while something is being typed into.
     The digits are not in the keyboard map shell/keys.js uses, so nothing is being taken
     from an instrument — but a room name being typed into a prompt is still text. */
  const typing = e => {
    const t = (e.target.tagName || "").toLowerCase();
    return t === "input" || t === "select" || t === "textarea";
  };
  const mine = e => !(live.hidden || e.metaKey || e.ctrlKey || e.altKey || typing(e));
  const keyFx = e => {
    if (!mine(e)) return null;
    const i = FXKEYS.indexOf((e.key || "").toLowerCase());
    return i >= 0 && i < FX.length ? FX[i].id : null;
  };
  /* ⚠️ CAPTURING, and that is not a detail. shell/keys.js takes the left and right arrows to
     move an instrument's octave, and its listener is installed by host.js at load — earlier
     than this one, so in the bubble phase it would win. A capturing listener on document runs
     before every bubble listener on it, and preventDefault here is what keys.js checks for
     before it does anything. On the live page an octave is the wrong thing for an arrow to
     mean anyway: you cannot see the keyboard it would be moving. */
  document.addEventListener("keydown", e => {
    if (mine(e) && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
      if (Patchwork.fx.nudge(e.key === "ArrowRight" ? 1 : -1)) e.preventDefault();
      return;
    }
    const id = keyFx(e); if (!id || e.repeat) return;
    fxDown(id); e.preventDefault();
  }, true);
  document.addEventListener("keyup", e => {
    const id = keyFx(e); if (!id) return;
    fxUp(id);
  }, true);
  Patchwork.fx.onChange(paintFx);
  buildFx();
}

function build(){
  const cols = Patchwork.launch.columns();
  grid.style.setProperty("--cols", cols.length);
  grid.textContent = "";

  const head = document.createElement("div");
  head.className = "st-live-row st-live-head";
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-live-num"}));
  /* Just labels. Arming moved onto each instrument's plate — see shell/record.js — because
     a row of six arm buttons put the choice of what you are recording six columns away
     from the instrument you were playing. */
  cols.forEach(c => {
    const cell = document.createElement("div");
    cell.className = "st-track";
    cell.appendChild(Object.assign(document.createElement("span"),
      {className: "st-track-name", textContent: c.name}));
    head.appendChild(cell);
  });
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-live-num"}));
  grid.appendChild(head);

  Patchwork.scenes.rows.forEach((row, ri) => {
    const el = document.createElement("div");
    el.className = "st-live-row";
    el.appendChild(Object.assign(document.createElement("span"),
      {className: "st-live-num", textContent: row.name}));
    cols.forEach(c => {
      const b = document.createElement("button");
      b.className = "st-cell"; b.dataset.row = ri; b.dataset.inst = c.id;
      Patchwork.launch.mark(b, c.id);
      b.setAttribute("aria-label", c.name + " scene " + row.name);
      el.appendChild(b);
    });
    const fire = document.createElement("button");
    fire.className = "st-fire"; fire.dataset.row = ri;
    el.appendChild(fire);
    grid.appendChild(el);
  });
  paint();
}

function paint(){
  const q = Patchwork.scenes.queued, on = Patchwork.scenes.onRow;
  grid.querySelectorAll(".st-cell").forEach(b =>
    Patchwork.launch.paintCell(b, +b.dataset.row, b.dataset.inst, q, on));
  /* With something armed, the row buttons ARE the record: they take what is on the armed
     tracks now and put it in that row. Nothing armed and they are plain scene fires. */
  const arming = Patchwork.record.armedCount > 0;
  grid.querySelectorAll(".st-fire").forEach(b => {
    b.classList.toggle("st-rec-row", arming);
    b.textContent = arming ? "●" : "▶";
    b.title = arming
      ? "Record the armed tracks into this scene, and play the rest of the row"
      : "Fire this scene (shift-click to capture)";
  });
  document.querySelector("#liveHint").textContent = arming
    ? "Armed. Play, then hit ● on a row to put it there — unarmed tracks just play that row."
    : "Arm an instrument on its own panel to record into a scene row.";
  const anyPlaying = Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id));
  const pb = document.querySelector("#livePlay");
  pb.textContent = anyPlaying ? "■ Stop all" : "▶ Play all";
  pb.classList.toggle("st-on", anyPlaying);
  document.querySelector("#liveBpm").textContent = Patchwork.clock.bpm;
  quant.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", b.dataset.q === Patchwork.scenes.quantum));
  quant.querySelector('[data-q="pattern"]').title =
    "Every " + Patchwork.scenes.patternBars + " bars — the pattern length in the Scenes head";
}

grid.addEventListener("click", e => {
  const cell = e.target.closest(".st-cell");
  if (cell){
    if (!cell.disabled) Patchwork.launch.click(e, +cell.dataset.row, cell.dataset.inst);
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  if (Patchwork.record.armedCount) Patchwork.record.captureRow(ri);
  else if (e.shiftKey) Patchwork.scenes.storeAll(ri);
  else Patchwork.launch.fireRowShared(ri);
});

/* Master transport. Presses the instruments' own Play buttons rather than reaching into
   their transports, so whatever a panel does when you press Play — arm checks, autostart,
   painting — happens here too instead of being reimplemented and drifting. */
document.querySelector("#livePlay").addEventListener("click", () => {
  const anyPlaying = Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id));
  Patchwork.roots.forEach(r => {
    const id = r.dataset.instrument;
    const btn = r.querySelector("#play");
    if (!btn) return;
    const isSeq = Patchwork.scenes.instruments.some(i => i.id === id);
    if (!isSeq) return;                     // the looper is not part of "play all"
    if (Patchwork.scenes.playing(id) === anyPlaying) btn.click();
  });
  setTimeout(paint, 60);
});
/* When a fired row lands. "Pattern" is CS·1's progression coming round — the harmony is
   the thing everything else should change with. */
const quant = document.querySelector("#liveQuant");
quant.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.scenes.setQuantum(b.dataset.q);
});

document.querySelector("#liveUp").addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.bpm + 1));
document.querySelector("#liveDown").addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.bpm - 1));

/* ---- the view switch ---- */
const seg = document.querySelector("#stView");
function show(which){
  const isLive = which === "live";
  live.hidden = !isLive;
  rack.hidden = isLive;
  scenes.hidden = isLive;
  document.body.classList.toggle("living", isLive);
  seg.querySelectorAll("button").forEach(b => b.classList.toggle("st-sel", b.dataset.v === which));
  if (isLive){
    paint();
    /* the punch rack's reverse is a worklet and loads asynchronously — built here so it is
       ready by the time a pad is pressed rather than a beat after */
    if (Patchwork.fx) try{ Patchwork.fx.prime(); }catch(e){}
  }
}
seg.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  show(b.dataset.v);
});

Patchwork.launch.mountMeasure(document.querySelector("#liveBars"));
Patchwork.scenes.onChange(paint);
Patchwork.record.onChange(paint);
Patchwork.clock.onTempo("live", () => paint(), null);
build();
show("studio");
/* the launcher and the live grid are two views of one model, so a change to either repaints
   whichever is showing */
setInterval(() => { if (!live.hidden) paint(); }, 400);
})();
