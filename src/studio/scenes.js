
/* ---- the scene launcher ----
   Studio only. The model lives in shell/scenes.js and works headless; this is the row of
   buttons over it.

   Deliberately small. The panels below already carry every control an instrument has —
   what is missing when you are playing is a way to change WHAT is played without going
   back to a grid and editing it, and that is all this does. */
(() => {
"use strict";
const grid = document.querySelector("#stGrid");
if (!grid || !window.Patchwork || !Patchwork.scenes) return;

function build(){
  const insts = Patchwork.scenes.instruments;
  grid.style.setProperty("--cols", insts.length);
  grid.textContent = "";

  const head = document.createElement("div");
  head.className = "st-row st-row-head";
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  insts.forEach(i => head.appendChild(Object.assign(document.createElement("span"),
    {className: "st-inst", textContent: i.name})));
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  grid.appendChild(head);

  Patchwork.scenes.rows.forEach((row, ri) => {
    const el = document.createElement("div");
    el.className = "st-row";
    el.appendChild(Object.assign(document.createElement("span"),
      {className: "st-num", textContent: row.name}));
    insts.forEach(i => {
      const b = document.createElement("button");
      b.className = "st-cell";
      b.dataset.row = ri; b.dataset.inst = i.id;
      b.setAttribute("aria-label", i.name + " scene " + row.name);
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
  const q = Patchwork.scenes.queued;
  grid.querySelectorAll(".st-cell").forEach(b => {
    const ri = +b.dataset.row, id = b.dataset.inst;
    b.classList.toggle("full", Patchwork.scenes.has(ri, id));
    b.classList.toggle("armed", q.get(id) === ri);
  });
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
    const ri = +cell.dataset.row, id = cell.dataset.inst;
    if (e.shiftKey) Patchwork.scenes.store(ri, id);
    else if (Patchwork.scenes.has(ri, id)) Patchwork.scenes.fire(ri, id);
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  if (Patchwork.record && Patchwork.record.armedCount) Patchwork.record.captureRow(ri);
  else if (e.shiftKey) Patchwork.scenes.storeAll(ri);
  else Patchwork.scenes.fire(ri);
});

Patchwork.scenes.onChange(paint);
if (window.Patchwork.record) Patchwork.record.onChange(paint);
build();
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
