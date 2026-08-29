
/* ---- the scene launcher ----
   Studio only. The model lives in shell/scenes.js and works headless; this is the row of
   buttons over it.

   Deliberately small. The panels below already carry every control an instrument has —
   what is missing when you are playing is a way to change WHAT is played without going
   back to a grid and editing it, and that is all this does. */
/* ---- what a launcher cell IS ----
   The studio's small launcher and the live page are two views of ONE grid, so every rule
   about a cell — which instruments get a column, what the cell shows, what a click does —
   has to be the same in both or they disagree about the same object.

   They had already drifted. The live page grew LP·1's column and the slot routing that
   goes with it; the launcher kept listing scene members only, so on the faces page the
   looper simply was not there. Putting the rules in one place is what stops that
   happening again the next time one view learns something.

   It lives in the studio rather than the shell because it is about the launcher's DOM,
   which the shell does not own — and here specifically because this file is built before
   live.js, which uses it. */
Patchwork.launch = (() => {
"use strict";

/* Every instrument that is either a scene member or can record. LP·1 has no scene row of
   its own — a scene changes what an instrument PLAYS and a looper's content is a
   recording — but it very much has one take per row, so it has a column. */
function columns(){
  const seen = new Map();
  Patchwork.scenes.instruments.forEach(i => seen.set(i.id, i.name));
  Patchwork.record.tracks.forEach(t => { if (!seen.has(t.id)) seen.set(t.id, t.name); });
  return [...seen].map(([id, name]) => ({id, name}));
}

/* A track with slots keeps a real audio take per row rather than a pattern. */
function slotted(id){
  const t = Patchwork.record && Patchwork.record.track(id);
  return (t && t.slots) ? t : null;
}

/* What kind of cell this is, decided once when it is built. */
function mark(b, id){
  if (slotted(id)) b.dataset.slots = "1";
  else if (!Patchwork.scenes.instruments.some(i => i.id === id)) b.disabled = true;
}

function paintCell(b, ri, id, queued, onRow){
  const t = slotted(id);
  b.classList.toggle("full", t ? !!(t.hasSlot && t.hasSlot(ri))
                               : Patchwork.scenes.has(ri, id));
  /* a slot track keeps its own transport, so what it is playing comes from the track
     rather than from the scene model, which has never heard of it */
  b.classList.toggle("live", t ? !!(t.liveSlot && t.liveSlot() === ri)
                               : (onRow.get(id) === ri && Patchwork.scenes.playing(id)));
  b.classList.toggle("armed", queued.get(id) === ri);
}

/* One gesture table, so the two views cannot answer the same click differently. */
function click(e, ri, id){
  /* Cmd/Ctrl-shift-click empties a cell. Two modifiers on purpose: a block is a take you
     may have spent a while getting, and one slip on a launcher you are playing should not
     be able to throw it away. */
  if ((e.metaKey || e.ctrlKey) && e.shiftKey){
    const t = slotted(id);
    if (t && t.clearSlot) t.clearSlot(ri);
    else Patchwork.scenes.clear(ri, id);
    return;
  }
  const t = slotted(id);
  if (t){
    if (e.shiftKey && t.recordSlot) t.recordSlot(ri);
    else if (t.playSlot) t.playSlot(ri);
    return;
  }
  if (e.shiftKey) Patchwork.scenes.store(ri, id);
  else if (Patchwork.scenes.has(ri, id)) Patchwork.scenes.fire(ri, id);
}

/* ⚠️ Firing a ROW had never reached the looper. `Patchwork.scenes.fire(row)` walks scene
   members, and LP·1 is deliberately not one — a scene changes what an instrument PLAYS and
   a looper's content is a recording. So the row button moved five instruments and left the
   sixth sitting there, while the ● record path worked, because captureRow() walks the
   record kit and happens to catch slot tracks on its way past.

   The row is the gesture, so the row has to move everything the row can see. */
function fireRow(ri){
  Patchwork.scenes.fire(ri);
  Patchwork.record.tracks.forEach(t => {
    const k = slotted(t.id);
    if (k && k.playSlot) k.playSlot(ri);
  });
}

/* Where in the pattern you are. The launcher says when a change LANDS — "pattern" is
   CS·1's progression coming round — and until now gave you no way to see that moment
   approaching, so firing on the one you wanted was guesswork with an eight-second wait
   attached.

   Computed from the grid origin and the shared clock, the same way every instrument works
   out its own seam, rather than counted by a timer that would drift away from the audio. */
function mountMeasure(el){
  let lit = -1, bars = 0;
  function build(){
    bars = Math.max(1, Patchwork.scenes.patternBars);
    el.textContent = "";
    for (let i = 0; i < bars; i++){
      const p = document.createElement("i");
      p.className = "st-bar";
      p.title = "Bar " + (i + 1) + " of " + bars;
      el.appendChild(p);
    }
    lit = -1;
  }
  function at(){
    const ctx = Patchwork.audio && Patchwork.audio.ctx;
    const origin = Patchwork.clock.origin;
    if (!ctx || origin == null || !Patchwork.clock.running) return -1;
    const bar = 4 * Patchwork.clock.beatSeconds();
    if (!(bar > 0)) return -1;
    const k = Math.floor((ctx.currentTime - origin) / bar);
    return ((k % bars) + bars) % bars;
  }
  function tick(){
    if (bars !== Math.max(1, Patchwork.scenes.patternBars)) build();
    const i = at();
    if (i !== lit){
      lit = i;
      [...el.children].forEach((c, k) => c.classList.toggle("st-now", k === i));
      el.classList.toggle("st-idle", i < 0);
    }
    requestAnimationFrame(tick);
  }
  build();
  requestAnimationFrame(tick);
}

return {columns, slotted, mark, paintCell, click, fireRow, mountMeasure};
})();

(() => {
"use strict";
const grid = document.querySelector("#stGrid");
if (!grid || !window.Patchwork || !Patchwork.scenes) return;

function build(){
  const cols = Patchwork.launch.columns();
  grid.style.setProperty("--cols", cols.length);
  grid.textContent = "";

  const head = document.createElement("div");
  head.className = "st-row st-row-head";
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  cols.forEach(c => head.appendChild(Object.assign(document.createElement("span"),
    {className: "st-inst", textContent: c.name})));
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  grid.appendChild(head);

  Patchwork.scenes.rows.forEach((row, ri) => {
    const el = document.createElement("div");
    el.className = "st-row";
    el.appendChild(Object.assign(document.createElement("span"),
      {className: "st-num", textContent: row.name}));
    cols.forEach(c => {
      const b = document.createElement("button");
      b.className = "st-cell";
      b.dataset.row = ri; b.dataset.inst = c.id;
      Patchwork.launch.mark(b, c.id);
      b.setAttribute("aria-label", c.name + " scene " + row.name);
      el.appendChild(b);
    });
    const fire = document.createElement("button");
    fire.className = "st-fire";
    fire.dataset.row = ri;
    fire.setAttribute("aria-label", "Fire scene " + row.name);
    el.appendChild(fire);
    grid.appendChild(el);
  });
  paint();
}

function paint(){
  const q = Patchwork.scenes.queued, on = Patchwork.scenes.onRow;
  grid.querySelectorAll(".st-cell").forEach(b =>
    Patchwork.launch.paintCell(b, +b.dataset.row, b.dataset.inst, q, on));
  /* The row buttons follow the same rule as the live page: with something armed they are
     record, otherwise they are fire. Arming is done on the live page, but a track stays
     armed across views, so the studio has to show the same truth. */
  const arming = Patchwork.record && Patchwork.record.armedCount > 0;
  grid.querySelectorAll(".st-fire").forEach(b => {
    b.classList.toggle("st-rec-row", !!arming);
    b.textContent = arming ? "●" : "▶";
    b.title = arming
      ? "Record the armed tracks into this scene, and play the rest of the row"
      : "Fire this scene (shift-click to capture every instrument into it)";
  });
}

/* Shift is capture, plain is fire. One modifier rather than a mode, because a launcher
   with a record-arm state is a launcher you can be in the wrong half of while playing. */
grid.addEventListener("click", e => {
  const cell = e.target.closest(".st-cell");
  if (cell){
    if (!cell.disabled) Patchwork.launch.click(e, +cell.dataset.row, cell.dataset.inst);
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  if (Patchwork.record && Patchwork.record.armedCount) Patchwork.record.captureRow(ri);
  else if (e.shiftKey) Patchwork.scenes.storeAll(ri);
  else Patchwork.launch.fireRow(ri);
});

Patchwork.scenes.onChange(paint);
if (window.Patchwork.record) Patchwork.record.onChange(paint);
build();
})();

/* ---- the master transport ----
   One tempo for the page, in the one place on it that is about the page rather than about
   an instrument, and the quantum beside it because "how fast" and "when does a change
   land" are the same question asked twice.

   The quantum segment also exists on the live page. Both paint from Patchwork.scenes on
   its change notification rather than from each other, so neither is the source of truth
   and switching views cannot show two different answers. */
(() => {
"use strict";
const up = document.querySelector("#stUp"), down = document.querySelector("#stDown"),
      out = document.querySelector("#stBpm"), quant = document.querySelector("#stQuant");
if (!up || !window.Patchwork || !Patchwork.clock) return;

up.addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.bpm + 1));
down.addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.bpm - 1));
quant.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.scenes.setQuantum(b.dataset.q);
});

function paint(){
  out.textContent = Patchwork.clock.bpm;
  quant.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", b.dataset.q === Patchwork.scenes.quantum));
  quant.querySelector('[data-q="pattern"]').title =
    "When CS·1's progression starts over — " + Patchwork.scenes.patternBars + " bars";
}
/* no initial: the instruments decide the page's starting tempo between them, and this
   only ever reports it */
Patchwork.clock.onTempo("studio", paint, null);
Patchwork.scenes.onChange(paint);
paint();
Patchwork.launch.mountMeasure(document.querySelector("#stBars"));
})();

/* ---- faces / full panels, for every instrument at once ----
   The per-panel toggle is the shell's; this is the one that moves all of them, because
   the common gesture is "show me everything" rather than "show me everything about MS·1". */
(() => {
"use strict";
const seg = document.querySelector("#stFaces");
if (!seg || !window.Patchwork || !Patchwork.faces) return;
seg.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  Patchwork.faces.setAll(b.dataset.f === "face");
});
/* Follows the per-panel toggles too, so the pair never disagree — with a mix showing, the
   segment reads as whichever state most panels are in. */
Patchwork.faces.onChange(() => {
  const faces = Patchwork.faces.count, total = Patchwork.roots.length;
  const on = faces * 2 >= total;
  seg.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", (b.dataset.f === "face") === on));
});
})();
