
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
    /* Every track can be armed. What differs is whether playing also writes to the grid
       as you go, which the tooltip says rather than leaving you to find out. */
    const t = Patchwork.record.tracks.find(x => x.id === c.id);
    if (!t || !t.canRecord) arm.disabled = true;
    else if (t.slots)
      arm.title = "Armed: pressing a row records an audio take into it";
    else if (t.live)
      arm.title = "Armed: notes you play land on the grid, and pressing a row puts the pattern there";
    else
      arm.title = "Armed: pressing a row puts this instrument's current pattern into it";
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
      const b = document.createElement("button");
      b.className = "st-cell"; b.dataset.row = ri; b.dataset.inst = c.id;
      /* a track with slots keeps a real audio take per row rather than a pattern */
      const t = Patchwork.record.track(c.id);
      if (t && t.slots) b.dataset.slots = "1";
      else if (!inScene.has(c.id)) b.disabled = true;
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
  const q = Patchwork.scenes.queued;
  grid.querySelectorAll(".st-cell").forEach(b => {
    const ri = +b.dataset.row, id = b.dataset.inst;
    const t = Patchwork.record.track(id);
    const has = (t && t.slots && t.hasSlot) ? t.hasSlot(ri) : Patchwork.scenes.has(ri, id);
    b.classList.toggle("full", has);
    b.classList.toggle("armed", q.get(id) === ri);
  });
  grid.querySelectorAll(".st-arm").forEach(b => {
    const on = Patchwork.record.isArmed(b.dataset.arm);
    b.classList.toggle("st-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
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
    : "Arm a track to record into a scene row.";
  const anyPlaying = Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id));
  const pb = document.querySelector("#livePlay");
  pb.textContent = anyPlaying ? "■ Stop all" : "▶ Play all";
  pb.classList.toggle("st-on", anyPlaying);
  document.querySelector("#liveBpm").textContent = Patchwork.clock.bpm;
  quant.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", b.dataset.q === Patchwork.scenes.quantum));
  quant.querySelector('[data-q="pattern"]').title =
    "When CS·1's progression starts over — " + Patchwork.scenes.patternBars + " bars";
}

grid.addEventListener("click", e => {
  const arm = e.target.closest(".st-arm");
  if (arm && !arm.disabled){ Patchwork.record.toggleArm(arm.dataset.arm); return; }
  const cell = e.target.closest(".st-cell");
  if (cell && !cell.disabled){
    const ri = +cell.dataset.row, id = cell.dataset.inst;
    /* Cmd/Ctrl-shift-click empties a cell. Two modifiers on purpose: a block is a take
       you may have spent a while getting, and one slip on a launcher you are playing
       should not be able to throw it away. */
    if ((e.metaKey || e.ctrlKey) && e.shiftKey){
      const t2 = Patchwork.record && Patchwork.record.track(id);
      if (t2 && t2.slots && t2.clearSlot) t2.clearSlot(ri);
      else Patchwork.scenes.clear(ri, id);
      return;
    }
    const t = Patchwork.record.track(id);
    if (t && t.slots){
      if (e.shiftKey && t.recordSlot) t.recordSlot(ri);
      else if (t.playSlot) t.playSlot(ri);
      return;
    }
    if (e.shiftKey) Patchwork.scenes.store(ri, id);
    else if (Patchwork.scenes.has(ri, id)) Patchwork.scenes.fire(ri, id);
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  if (Patchwork.record.armedCount) Patchwork.record.captureRow(ri);
  else if (e.shiftKey) Patchwork.scenes.storeAll(ri);
  else Patchwork.scenes.fire(ri);
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
