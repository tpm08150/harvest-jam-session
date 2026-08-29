
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

/* Columns are every instrument that is either a scene member or can record — LP·1 has no
   scene row of its own but very much has an arm. */
function columns(){
  const seen = new Map();
  Patchwork.scenes.instruments.forEach(i => seen.set(i.id, i.name));
  Patchwork.record.tracks.forEach(t => { if (!seen.has(t.id)) seen.set(t.id, t.name); });
  return [...seen].map(([id, name]) => ({id, name}));
}

function build(){
  const cols = columns();
  const inScene = new Set(Patchwork.scenes.instruments.map(i => i.id));
  grid.style.setProperty("--cols", cols.length);
  grid.textContent = "";

  const head = document.createElement("div");
  head.className = "st-live-row st-live-head";
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-live-num"}));
  cols.forEach(c => {
    const cell = document.createElement("div");
    cell.className = "st-track";
    cell.appendChild(Object.assign(document.createElement("span"),
      {className: "st-track-name", textContent: c.name}));
    const arm = document.createElement("button");
    arm.className = "st-arm"; arm.dataset.arm = c.id;
    arm.textContent = "Arm";
    arm.setAttribute("aria-pressed", "false");
    const can = Patchwork.record.tracks.some(t => t.id === c.id && t.canRecord);
    if (!can){
      arm.disabled = true;
      /* CS·1's pattern is a chord progression, not steps — there is no honest way to write
         a played note into it, so it says so rather than offering a button that does
         nothing. */
      arm.title = "This instrument's pattern is not a step grid, so there is nothing to record into";
    }
    cell.appendChild(arm);
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
      if (!inScene.has(c.id)){
        el.appendChild(Object.assign(document.createElement("span"), {className: "st-live-gap"}));
        return;
      }
      const b = document.createElement("button");
      b.className = "st-cell"; b.dataset.row = ri; b.dataset.inst = c.id;
      b.setAttribute("aria-label", c.name + " scene " + row.name);
      el.appendChild(b);
    });
    const fire = document.createElement("button");
    fire.className = "st-fire"; fire.dataset.row = ri; fire.textContent = "▶";
    fire.title = "Fire the whole scene (shift-click to capture)";
    el.appendChild(fire);
    grid.appendChild(el);
  });
  paint();
}

function paint(){
  const q = Patchwork.scenes.queued;
  grid.querySelectorAll(".st-cell").forEach(b => {
    const ri = +b.dataset.row, id = b.dataset.inst;
    b.classList.toggle("full", Patchwork.scenes.has(ri, id));
    b.classList.toggle("armed", q.get(id) === ri);
  });
  grid.querySelectorAll(".st-arm").forEach(b => {
    const on = Patchwork.record.isArmed(b.dataset.arm);
    b.classList.toggle("st-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const rec = Patchwork.record.recording;
  const rb = document.querySelector("#liveRec");
  rb.classList.toggle("st-on", rec);
  rb.setAttribute("aria-pressed", rec ? "true" : "false");
  document.querySelector("#liveHint").textContent = rec
    ? (Patchwork.record.armedCount
        ? "Recording — play, and it lands on the nearest step."
        : "Recording, but nothing is armed. Arm a track to capture it.")
    : "Arm a track, hit Record, and play — it lands on the grid in time.";
  const anyPlaying = Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id));
  const pb = document.querySelector("#livePlay");
  pb.textContent = anyPlaying ? "■ Stop all" : "▶ Play all";
  pb.classList.toggle("st-on", anyPlaying);
  document.querySelector("#liveBpm").textContent = Patchwork.clock.bpm;
}

grid.addEventListener("click", e => {
  const arm = e.target.closest(".st-arm");
  if (arm && !arm.disabled){ Patchwork.record.toggleArm(arm.dataset.arm); return; }
  const cell = e.target.closest(".st-cell");
  if (cell){
    const ri = +cell.dataset.row, id = cell.dataset.inst;
    if (e.shiftKey) Patchwork.scenes.store(ri, id);
    else if (Patchwork.scenes.has(ri, id)) Patchwork.scenes.fire(ri, id);
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  if (e.shiftKey) Patchwork.scenes.storeAll(ri); else Patchwork.scenes.fire(ri);
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
document.querySelector("#liveRec").addEventListener("click", () => {
  Patchwork.record.setRecording(!Patchwork.record.recording);
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
  if (isLive) paint();
}
seg.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  show(b.dataset.v);
});

Patchwork.scenes.onChange(paint);
Patchwork.record.onChange(paint);
Patchwork.clock.onTempo("live", () => paint(), null);
build();
show("studio");
/* the launcher and the live grid are two views of one model, so a change to either repaints
   whichever is showing */
setInterval(() => { if (!live.hidden) paint(); }, 400);
})();
