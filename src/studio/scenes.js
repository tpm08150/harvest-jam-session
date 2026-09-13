
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
/* ⚠️ SAID OUT LOUD, not inherited from registration order. The columns used to come out in
   whatever sequence parts.txt happened to build the instruments in, with the record-only
   tracks tacked on the end — so LP·1 sat after TS·1 for no reason anybody chose, and moving
   a line in a manifest would silently rearrange the launcher.

   The order is a reading order: the kit, then the parts that play over it, then the looper
   that captures them, and TS·1 last because a transition is what ends a section. Anything
   not listed keeps its registration order at the end, so an instrument added later appears
   rather than disappearing. */
const COLUMN_ORDER = ["dr1", "bs1", "cs1", "pm1", "vc1", "lp1", "ts1"];

function columns(){
  const seen = new Map();
  Patchwork.scenes.instruments.forEach(i => seen.set(i.id, i.name));
  Patchwork.record.tracks.forEach(t => { if (!seen.has(t.id)) seen.set(t.id, t.name); });
  const rank = id => { const i = COLUMN_ORDER.indexOf(id);
                       return i < 0 ? COLUMN_ORDER.length : i; };
  return [...seen].map(([id, name]) => ({id, name}))
                  .sort((a, b) => rank(a.id) - rank(b.id));
}

/* A track with slots keeps a real audio take per row rather than a pattern. */
function slotted(id){
  const t = Patchwork.record && Patchwork.record.track(id);
  return (t && t.slots) ? t : null;
}

/* What kind of cell this is, decided once when it is built. */
/* ---- one colour per instrument ----
   ⚠️ THE BOXES AND THE PADS READ THE SAME TABLE. The launcher was a grid of identical green
   cells and sixteen identical amber pads: with the columns holding seven different
   instruments, the one thing neither view said was WHICH — you counted across from the left
   and hoped. Colour is what a column is for.

   The names on the right are the hardware's palette (see PAL in shell/launchkey.js); the
   CSS side keys off the same ids in page.css. Chosen to match each panel's own accent, so a
   pad, a box and the ring around a panel are the same colour by construction rather than by
   somebody remembering to keep three lists in step. */
const COLOUR = {dr1: "orchid",    // the purple its stripe already is
                bs1: "amber",     // bass pedals orange
                cs1: "red",
                pm1: "blue",
                vc1: "pink",      // the vocoder's own identity, not a variant of anything
                lp1: "turquoise", // the teal the looper is built out of
                ts1: "yellow"};
function colour(id){ return COLOUR[id] || "cyan"; }

function mark(b, id){
  b.dataset.hue = colour(id);
  if (slotted(id)) b.dataset.slots = "1";
  else if (!Patchwork.scenes.instruments.some(i => i.id === id)) b.disabled = true;
}

function paintCell(b, ri, id, queued, onRow){
  const t = slotted(id);
  b.classList.toggle("full", t ? !!(t.hasSlot && t.hasSlot(ri))
                               : Patchwork.scenes.has(ri, id));
  /* ⚠️ A SLOT CELL NAMES A TAKE, so it says which. Every other cell holds a pattern that
     belongs to it alone and a dot is the whole story; a looper's cell is a REFERENCE, and
     two rows pointing at take 3 look identical to two rows holding different loops unless
     the number is on them. */
  if (t && t.takeAt){
    const n = t.takeAt(ri);
    b.textContent = n == null ? "" : String(n + 1);
  }
  /* a slot track keeps its own transport, so what it is playing comes from the track
     rather than from the scene model, which has never heard of it */
  /* ⚠️ ARMED OUTRANKS LIVE, and both were being set. An instrument started on a seam that has
     not arrived is playing by isPlaying() and waiting by every other measure, so its cell wore
     both rings at once — which is not a state anybody can read, and is the pads' answer too:
     they check queued first and stop. */
  /* ⚠️ A CELL CAN BE ARMED TO STOP, and it looked exactly like one armed to start. Firing a
     row queues every instrument on it — including the ones the row has NOTHING for, whose
     pending pattern is a null meaning "stop at the seam". Both flashed the same, so cueing a
     scene that drops the bass lit the bass's empty cell in the bass's own colour, which reads
     as the bass arriving. An arm with nothing behind it is an ending. */
  const armed = queued.get(id) === ri;
  const full = b.classList.contains("full");
  b.classList.toggle("armed", armed && full);
  b.classList.toggle("ending", armed && !full);
  b.classList.toggle("live", !armed && (t ? !!(t.liveSlot && t.liveSlot() === ri)
                                          : (onRow.get(id) === ri && Patchwork.scenes.playing(id))));
}

/* One gesture table, so the two views cannot answer the same click differently.

   A CELL WRITES. The row button plays. That split is the whole of it: click a cell to put
   what an instrument is holding into that block, shift-click to empty it, and press ▶ on
   the row to hear the row. Plain click used to FIRE a cell and shift-click used to capture
   into it, which meant the two halves of the grid answered to different verbs.

   ⚠️ Deleting is one modifier now, at the owner's request. It was two — cmd AND shift — on
   the grounds that a block is a take you may have spent a while getting and one slip on a
   launcher you are playing should not throw it away. That reasoning has not stopped being
   true; it is just no longer the call being made. LP·1's takes are the ones with the most
   to lose, since a cleared audio take is not recoverable. */
function click(e, ri, id){
  const t = slotted(id);
  if (e.shiftKey){
    if (t && t.clearSlot) t.clearSlot(ri);
    else Patchwork.scenes.clear(ri, id);
    return;
  }
  /* add or edit: a slot track records a real take, everything else copies its pattern in */
  if (t){ if (t.recordSlot) t.recordSlot(ri); return; }
  Patchwork.scenes.store(ri, id);
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
    const i = at();
    if (i !== lit){
      lit = i;
      [...el.children].forEach((c, k) => c.classList.toggle("st-now", k === i));
      el.classList.toggle("st-idle", i < 0);
    }
    requestAnimationFrame(tick);
  }
  build();
  /* The pips are rebuilt on the SETTING's notification, not in the animation loop: the
     loop is rAF, which stops dead in a hidden tab, and a control that only answers while
     you can see it is not a control. Only the lit pip needs a frame. */
  Patchwork.scenes.onChange(() => {
    if (bars !== Math.max(1, Patchwork.scenes.patternBars)) build();
  });
  requestAnimationFrame(tick);
}

/* Stop everything the launcher can reach. Scene members are stopped by PRESSING their own
   Play, the way the live page's master already does it — whatever a panel does when it
   stops then happens here too, rather than being reimplemented and drifting. A slot track
   has no Play in the rack sense, so it offers stop() instead. */
function stopAll(){
  Patchwork.roots.forEach(r => {
    const id = r.dataset.instrument;
    if (!Patchwork.scenes.playing(id)) return;
    const btn = r.querySelector("#play");
    if (btn) btn.click();
  });
  Patchwork.record.tracks.forEach(t => {
    const k = slotted(t.id);
    if (k && k.stop) k.stop();
  });
  /* Pressing a panel's Play does not reach the scene model, so say so — otherwise the
     cells stay ringed after everything has stopped. */
  Patchwork.scenes.changed();
}

/* Firing a row is the one gesture that is not implied by the state — the rows themselves
   are already shared, but "play row 3 now" has to be said. It still lands on the seam at
   the other end, computed locally, so the message only has to beat the boundary. */
function fireRowShared(ri){
  fireRow(ri);
  if (Patchwork.session && Patchwork.session.active) Patchwork.session.fired(ri);
}

/* Is anything sounding at all? The stop button reads inert when there is nothing to stop,
   because a live control that does nothing is worse than no control. */
function anyPlaying(){
  if (Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id))) return true;
  return Patchwork.record.tracks.some(t => {
    const k = slotted(t.id);
    return !!(k && k.liveSlot && k.liveSlot() !== null);
  });
}

/* ---- which row the hand is pointed at ----
   ⚠️ NOT WHICH ROW IS PLAYING, and the launcher has always answered that second question:
   a cell rings when it is live and pulses when it is queued. The cursor is a third state and
   it belongs to the person rather than to the music — it is where the controller's arrows
   have walked to, and it means nothing at all until you press ">".

   ⚠️ AND IT LIVES HERE rather than in the surface page that moves it, because the screen has
   to show it. A cursor only the controller knew about would be a row firing from a button
   nobody could see the aim of, which is the whole complaint that produced it. */
let cursor = 0;
const cursorSubs = [];
function setCursor(i){
  const n = Math.max(0, Math.min(Patchwork.scenes.rows.length - 1, i | 0));
  if (n === cursor) return cursor;
  cursor = n;
  cursorSubs.forEach(fn => { try{ fn(cursor); }catch(e){} });
  return cursor;
}

return {columns, slotted, mark, paintCell, click, fireRow, fireRowShared, colour,
        mountMeasure, stopAll, anyPlaying,
        get cursor(){ return cursor; }, setCursor,
        onCursor: fn => cursorSubs.push(fn)};
})();

/* ⚠️ THE LAUNCHER JOINS THE RACK. instrument() is how a panel becomes selectable and it
   builds one too, which this is not — so the root is registered with an empty builder. What
   that buys is everything focus already means: the ring, the controller's rack walk, and the
   pads and encoders following a click, on the one block of the Studio view that had none of
   it and is the thing you spend the most time pressing. */
if (window.Patchwork && Patchwork.instrument) Patchwork.instrument("scenes", function(){});

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
    el.dataset.row = ri;
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

  /* ---- the mix ----
     One fader per column, under the grid it belongs to, so the thing you balance and the
     thing you fire are the same list of instruments in the same order.

     ⚠️ YOURS ALONE, AND DELIBERATELY. Everybody in a jam renders the same patterns through
     their own speakers in their own room, so a balance that works in one does not work in
     another — and unlike a pattern or a patch, nobody else needs to agree with it. It is
     never sent, and shell/bus.js says what keeps it that way. */
  const mix = document.createElement("div");
  mix.className = "st-row st-row-mix";
  const lab = Object.assign(document.createElement("span"),
    {className: "st-num st-mixlab", textContent: "MIX"});
  lab.title = "Your own listening balance. It is never shared with a jam — "
            + "everyone hears the same parts through their own mix.";
  mix.appendChild(lab);
  cols.forEach(c => {
    const cell = document.createElement("div");
    cell.className = "st-fadercell";
    const f = document.createElement("input");
    f.type = "range"; f.className = "st-fader";
    f.min = "0"; f.max = "100"; f.step = "1";
    /* read back from the bus rather than from a default, so a rebuild — which happens
       whenever a row is added or the pattern length changes — does not reset the mix */
    f.value = String(Math.round(Patchwork.audio.level(c.id) * 100));
    f.dataset.inst = c.id;
    f.setAttribute("aria-label", c.name + " level");
    f.title = c.name + " level";
    /* the readout an instrument's fader carries, for the same reason: a fader you can only
       set by ear is one you cannot set back */
    const val = Object.assign(document.createElement("span"),
      {className: "st-faderval", textContent: f.value});
    /* M and S under each fader, in that order because that is the order they are on every
       mixer anyone has touched. Single letters: the column is 43px wide and the words do
       not fit, but nobody has ever had to be told what M and S are. */
    const keys = document.createElement("div");
    keys.className = "st-mskeys";
    [["m", "Mute"], ["s", "Solo"]].forEach(([k, word]) => {
      const b = document.createElement("button");
      b.className = "st-msk st-msk-" + k;
      b.type = "button";
      b.dataset.inst = c.id; b.dataset.k = k;
      b.textContent = k.toUpperCase();
      b.setAttribute("aria-label", word + " " + c.name);
      b.setAttribute("aria-pressed", "false");
      keys.appendChild(b);
    });
    cell.appendChild(f); cell.appendChild(val); cell.appendChild(keys);
    mix.appendChild(cell);
  });
  mix.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  grid.appendChild(mix);

  paintMix();
  paint();
}

/* Kept across reloads, because a mix you have to rebuild every time is one you stop
   bothering with. ⚠️ It is the fader POSITION that explains a quiet instrument on the next
   visit — which is the argument for the mixer being on screen rather than in a menu. */
const MIX_KEY = "patchwork-mix";
function loadMix(){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(MIX_KEY)); }catch(e){}
  if (!saved || typeof saved !== "object") return;
  const lv = saved.levels || saved;          // the first shape of this was levels alone
  Object.keys(lv).forEach(id => { if (typeof lv[id] === "number") Patchwork.audio.setLevel(id, lv[id]); });
  (saved.mute || []).forEach(id => Patchwork.audio.setMute(id, true));
  (saved.solo || []).forEach(id => Patchwork.audio.setSolo(id, true));
}
function saveMix(){
  const lv = {}, mute = [], solo = [];
  grid.querySelectorAll(".st-fader").forEach(f => {
    const id = f.dataset.inst;
    lv[id] = +f.value / 100;
    if (Patchwork.audio.muted(id)) mute.push(id);
    if (Patchwork.audio.soloed(id)) solo.push(id);
  });
  try{ localStorage.setItem(MIX_KEY, JSON.stringify({levels: lv, mute, solo})); }catch(e){}
}

/* ⚠️ A soloed track dims every OTHER fader, not itself — that is what makes it obvious at a
   glance which way round a solo is, and it is the thing that stops "why is the bass silent"
   being a two-minute mystery three songs later. */
function paintMix(){
  const A = Patchwork.audio;
  grid.querySelectorAll(".st-msk").forEach(b => {
    const on = b.dataset.k === "m" ? A.muted(b.dataset.inst) : A.soloed(b.dataset.inst);
    /* st-on, not on: the studio sheet is not scoped to a panel, so a bare `on` here would
       reach inside every instrument that uses it — which build.py refuses, correctly. */
    b.classList.toggle("st-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  grid.querySelectorAll(".st-fadercell").forEach(cell => {
    const f = cell.querySelector(".st-fader");
    if (f) cell.classList.toggle("st-silenced", A.audible(f.dataset.inst) === 0);
  });
}

grid.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest(".st-msk");
  if (!b) return;
  const id = b.dataset.inst;
  if (b.dataset.k === "m") Patchwork.audio.setMute(id, !Patchwork.audio.muted(id));
  else Patchwork.audio.setSolo(id, !Patchwork.audio.soloed(id));
  paintMix();
  saveMix();
});

/* `input`, not `change`: a fader that only moved the sound when you let go of it would be
   unusable for the one thing a fader is for. */
grid.addEventListener("input", e => {
  const f = e.target.closest && e.target.closest(".st-fader");
  if (!f) return;
  const g = Patchwork.audio.setLevel(f.dataset.inst, +f.value / 100);
  const val = f.parentNode && f.parentNode.querySelector(".st-faderval");
  if (val) val.textContent = String(Math.round(g * 100));
  paintMix();
  saveMix();
});

function paint(){
  const q = Patchwork.scenes.queued, on = Patchwork.scenes.onRow;
  grid.querySelectorAll(".st-cell").forEach(b =>
    Patchwork.launch.paintCell(b, +b.dataset.row, b.dataset.inst, q, on));
  /* Where the controller's arrows are pointed. Drawn on the ROW rather than on a cell,
     because it is the row that ">" will fire and a cell is one instrument's corner of it. */
  const at = Patchwork.launch.cursor;
  grid.querySelectorAll(".st-row").forEach(r =>
    r.classList.toggle("st-at", r.dataset.row !== undefined && +r.dataset.row === at));
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
    if (!cell.disabled){
      /* ⚠️ CLICKING AIMS THE CURSOR TOO. Two ways to say "this row" that disagreed about
         which row you meant would make ">" fire something you were not looking at. */
      Patchwork.launch.setCursor(+cell.dataset.row);
      Patchwork.launch.click(e, +cell.dataset.row, cell.dataset.inst);
    }
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  Patchwork.launch.setCursor(ri);
  if (Patchwork.record && Patchwork.record.armedCount) Patchwork.record.captureRow(ri);
  else if (e.shiftKey) Patchwork.scenes.storeAll(ri);
  else Patchwork.launch.fireRowShared(ri);
});

loadMix();
/* The controller walks the cursor and the screen has to follow it, which nothing else here
   would have told it about. */
Patchwork.launch.onCursor(paint);
Patchwork.scenes.onChange(paint);
if (window.Patchwork.record) Patchwork.record.onChange(paint);
build();
/* ⚠️ An instrument's OWN Play button changes what is playing without telling the scene
   model, so a cell could stay ringed after its instrument had stopped. The live page has
   carried the same repaint for the same reason; the launcher needed one too. */
setInterval(paint, 400);
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
      out = document.querySelector("#stBpm"), quant = document.querySelector("#stQuant"),
      stop = document.querySelector("#stStop"), barCount = document.querySelector("#stBarCount"),
      click = document.querySelector("#stClick"), clickLvl = document.querySelector("#stClickLvl");
if (!up || !window.Patchwork || !Patchwork.clock) return;

stop.addEventListener("click", () => { Patchwork.launch.stopAll(); setTimeout(paint, 60); });

up.addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.shown + 1));
down.addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.shown - 1));
quant.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.scenes.setQuantum(b.dataset.q);
});

/* How long a "pattern" is. This used to be whatever CS·1's progression happened to be,
   which made the boundary circular for CS·1 itself — bringing it in meant waiting for a
   seam defined by the thing that was not playing yet. It is a number now, and the bar
   counter beside it draws the same number. */
barCount.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.scenes.setPatternBars(+b.dataset.b);
});

click.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.click.set(b.dataset.c === "on");
});
clickLvl.addEventListener("input", () => Patchwork.click.setLevel(clickLvl.value / 100));
Patchwork.click.onChange(paint);

/* ---- the launcher, as a surface page ----
   ⚠️ THE PADS SHOULD BE THE LAUNCHER ON THE LAUNCHER'S OWN VIEW. They already fall through to
   the scene grid when the focused panel has none, which was right as a default and wrong as
   the only route: on the Live page the launcher is the whole screen, and the pads following
   whichever panel was last clicked meant looking at a grid you could not press.

   The grid itself is the shell's — the same one the fallthrough uses, so the two cannot come
   to differ — and the controls are this head's own, because they are the ones you would reach
   past the launcher for. */
if (window.Patchwork && Patchwork.surface){
  /* ---- the launcher, on sixteen pads ---- */
  const S = Patchwork.scenes;
  /* ⚠️ A SLOT TRACK IS NOT IN `scenes`. LP·1 keeps a real audio take per row rather than a
     pattern, so asking scenes.has() about it answers "empty" for a row that plainly is not —
     the same trap fireRow() documents a few lines above. Ask the track. */
  function hasCell(ri, id){
    const t = Patchwork.record && Patchwork.record.track ? Patchwork.record.track(id) : null;
    if (t && t.hasSlot){ try{ return !!t.hasSlot(ri); }catch(e){ return false; } }
    return S.has(ri, id);
  }

  /* Which row the arrows are pointed at. ⚠️ NOT which row is playing: those are different
     questions and the launcher has always answered the second one on screen. The cursor is
     for the hand — walk to a row with the pair beside the pads, fire it with ">" — which is
     the whole gesture on a controller you are not looking at. */
  const L = Patchwork.launch;
  const moveCursor = d => "Row " + (L.setCursor(L.cursor + (d > 0 ? 1 : -1)) + 1);

  /* ⚠️ THE PADS ARE THE MATRIX, NOT THE ROW LIST. Sixteen pads and sixteen rows made this
     one pad per row — a tidy coincidence and the wrong picture. The launcher on screen is
     instruments ACROSS and rows DOWN, and a grid flattened to a column of rows could tell
     you a row held something and never which instrument held it.

     So the pads are two rows of the real grid: the top eight are the row the cursor is on,
     the bottom eight the one after it, and the columns are the instruments in the order the
     screen draws them. Which is the eight-wide shape the pads already are. */
  const COLS = 8;
  const colsNow = () => Patchwork.launch.columns().slice(0, COLS);
  /* Cell 0 is bottom-left — the surface's contract. The cursor's row goes on TOP, because a
     list read downwards puts the row you are on above the one you are heading for. */
  const padAt = c => (c < 8 ? {ri: L.cursor + 1, ci: c} : {ri: L.cursor, ci: c - 8});

  const grid = {
    /* ⚠️ THE SCREEN SAYS WHICH TWO ROWS THESE ARE. Two rows out of sixteen, on pads with no
       numbers on them, is otherwise a guess every time you look down. */
    label: () => {
      const a = L.cursor + 1;
      return a + 1 <= S.rows.length ? "Scene " + a + " / " + (a + 1) : "Scene " + a;
    },
    cells: mods => {
      /* Func turns the pads into the desk's mute and solo — the SAME grid the mixer page
         draws, borrowed rather than rebuilt, so the two cannot disagree about what is
         muted. See consoleUI.padGrid in studio/console.js. */
      const C = Patchwork.consoleUI;
      if (mods && mods.accent && C && C.padGrid) return C.padGrid.cells();
      const out = new Array(16).fill(null);
      const cols = colsNow(), queued = S.queued, onRow = S.onRow;
      for (let c = 0; c < 16; c++){
        const at = padAt(c), col = cols[at.ci];
        /* No instrument in that column, or no row down there: a dark pad, not a dim one. */
        if (!col || at.ri >= S.rows.length) continue;
        const hue = Patchwork.launch.colour(col.id);
        const has = hasCell(at.ri, col.id);
        /* ⚠️ COLOUR MEANS "THERE IS SOMETHING HERE". It used to mean "this column is the
           bass" in every state, with brightness carrying whether the cell was full — so a
           grid of seven hues was lit in seven colours whether or not anything was in it, and
           the one question you are actually asking it was answered by a brightness step you
           had to compare against its neighbours to read.
           Empty is white now, and dim: white is the one shade that belongs to no instrument,
           so it reads as absence rather than as an eighth column. A cell with a pattern in it
           is the only thing wearing a colour, and which colour still says whose it is. */
        /* ⚠️ AN ARM WITH NOTHING BEHIND IT IS AN ENDING, and it flashed like an arrival.
           Firing a row queues every instrument on it, including the ones the row has nothing
           for — their pending pattern is a null meaning "stop at the seam" — so cueing a
           scene that drops the bass flashed the bass's colour on the bass's empty cell. White
           for going, the column's colour for coming: the same two answers the grid already
           gives for empty and full, which is what makes them readable without being learnt. */
        if (queued.get(col.id) === at.ri)
          out[c] = has ? {colour: hue, on: true, hot: true}
                       : {colour: "white", on: true, hot: true};
        else if (onRow.get(col.id) === at.ri && S.playing(col.id))
          out[c] = {colour: "green", on: true};
        else out[c] = has ? {colour: hue, on: true} : {colour: "white", on: false};
      }
      return out;
    },
    down: (cell, vel, mods) => {
      const C = Patchwork.consoleUI;
      if (mods && mods.accent && C && C.padGrid){ C.padGrid.down(cell); return; }
      const at = padAt(cell), col = colsNow()[at.ci];
      if (!col || at.ri >= S.rows.length) return;
      /* ⚠️ THE SAME CALL A MOUSE MAKES, including the modifier it would have been holding.
         A press puts the instrument's current pattern into that cell and a second press
         takes it out — which is exactly what clicking and shift-clicking the box does, and
         the reason a slot track records a real audio take here without this knowing that it
         does anything different. */
        Patchwork.launch.click({shiftKey: hasCell(at.ri, col.id)}, at.ri, col.id);
    },
    /* The pair beside the pads walks the cursor — see gridMove() in shell/surface.js. */
    move: moveCursor
  };

  /* ---- the encoders ----
     Levels first, because a launcher is a mixing job as much as an arranging one: the reason
     you are looking at this page with your hands on a controller is usually that something
     is too loud. The page's own settings are the second bank. */
  const banks = [{name: "Levels"}, {name: "Set"}];
  let bank = 0;
  const bankNow = () => Math.min(bank, banks.length - 1);
  const settingControls = () => [
    Patchwork.surface.segment(click, "Click", "Clk"),
    tempoControl(),
    Patchwork.surface.segment(barCount, "Bars", "Bar"),
    Patchwork.surface.segment(quant, "Lands on", "Qnt")
  ].filter(Boolean);
  /* Tempo is the one thing on this page that is neither a list nor a grid, so it is the one
     control here built by hand. 40-240 is the clock's own range. */
  function tempoControl(){
    const LO = 40, HI = 240;
    const set = v => { Patchwork.clock.setBpm(Math.round(LO + v * (HI - LO))); paint(); };
    return {
      id: "bpm", label: "Tempo", short: "BPM",
      text: () => String(Patchwork.clock.shown) + " bpm",
      get: () => (Patchwork.clock.shown - LO) / (HI - LO),
      set
    };
  }

  /* ⚠️ MOUNTED AS A PAGE AND REGISTERED AS A PANEL, from one object. The page is the
     explicit route — Shift and the Sends pad — and the panel is what a CLICK reaches, now
     that the launcher is selectable like everything else on the rack. Two doors, one room:
     built once and handed to both, because a second definition would be the two doors
     leading somewhere subtly different. */
  const spec = {
    name: "Scenes",
    grid,
    /* ⚠️ FUNC TAPPED OPENS THE PUNCH PAGE — a page of its own rather than a face of this one,
       so that nothing on this page still answers while it is up. See studio/live.js. */
    face: () => (Patchwork.punchUI ? Patchwork.punchUI.open() : null),
    faceName: "Pads",
    controls: () => {
      const C = Patchwork.consoleUI;
      if (bankNow() === 0 && C && C.levelControls) return C.levelControls();
      return settingControls();
    },
    controlBanks: () => banks,
    controlBank: bankNow,
    setControlBank: i => { bank = Math.max(0, Math.min(banks.length - 1, i)); },
    /* Tempo keeps the pair beside the encoders as well as having a knob: it is the number
       you reach for most here, and a nudge of exactly one is what that pair is for. */
    bumpName: "Tempo",
    bump: dir => {
      Patchwork.clock.setBpm(Patchwork.clock.shown + (dir > 0 ? -1 : 1));
      paint();
      return String(Patchwork.clock.shown);
    },
    /* ⚠️ ">" LAUNCHES THE CURSOR'S ROW, which is what the arrows are for walking to. Stop is
       the transport's own square button and always was; spending ">" on a second way to do
       it left the one gesture this page exists for with no button at all. */
    actionName: "Launch",
    action: () => {
      if (L.cursor >= Patchwork.scenes.rows.length) return null;
      Patchwork.surface.rig.fireRow(L.cursor);
      return "Row " + (L.cursor + 1);
    }
  };
  Patchwork.surface.mount("scenes", spec);
  Patchwork.surface.panel("scenes", spec);
}


function paint(){
  out.textContent = Patchwork.clock.shown;
  const live = Patchwork.launch.anyPlaying();
  stop.classList.toggle("st-live", live);
  stop.disabled = !live;
  quant.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", b.dataset.q === Patchwork.scenes.quantum));
  barCount.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", +b.dataset.b === Patchwork.scenes.patternBars));
  click.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", (b.dataset.c === "on") === Patchwork.click.on));
  quant.querySelector('[data-q="pattern"]').title =
    "Every " + Patchwork.scenes.patternBars + " bars — the pattern length in the Scenes head";
}
/* no initial: the instruments decide the page's starting tempo between them, and this
   only ever reports it */
Patchwork.clock.onTempo("studio", paint, null);
Patchwork.scenes.onChange(paint);
Patchwork.record.onChange(paint);
paint();
Patchwork.launch.mountMeasure(document.querySelector("#stBars"));
})();

/* ---- the jam ----
   Join a room by name and you are playing the same grid as everyone else on it. The prompt
   is deliberately the whole interface for now: a room is a string, and inventing a lobby
   before the model is proven would be building the second thing first. */
(() => {
"use strict";
const btn = document.querySelector("#stJamBtn"), who = document.querySelector("#stJamWho");
if (!btn || !window.Patchwork || !Patchwork.session) return;

const joinBtn = document.querySelector("#stJamJoin");
const list = document.querySelector("#stJamList");

function askName(){
  /* asked once and remembered, because being asked your own name every time you join is
     the kind of friction that stops people trying the feature twice */
  let n = "";
  try{ n = localStorage.getItem("patchwork-jam-name") || ""; }catch(e){}
  n = window.prompt("What should they call you?", n) || "";
  try{ localStorage.setItem("patchwork-jam-name", n); }catch(e){}
  return n;
}

btn.addEventListener("click", () => {
  list.hidden = true;
  if (Patchwork.session.active){ Patchwork.session.leave(); return; }
  const room = window.prompt("Name your jam — anyone who joins it plays with you", "jam");
  if (room == null) return;
  if (!Patchwork.session.join(room, askName()))
    who.innerHTML = "<em>" + (Patchwork.session.problem
      || "this browser cannot open a session") + "</em>";
});

/* ⚠️ Typing the same string on two machines is the single most likely way to end up in two
   empty rooms wondering why the other person cannot see you. Picking from a list removes
   that, and the list itself is the diagnostic: if it comes back empty over a relay, the
   two machines are not talking to the same one. */
joinBtn.addEventListener("click", () => {
  if (Patchwork.session.active){ list.hidden = true; return; }
  list.textContent = "";
  list.appendChild(Object.assign(document.createElement("div"),
    {className: "st-jam-empty", textContent: "looking…"}));
  list.hidden = false;
  Patchwork.session.browse((rooms, err) => {
    list.textContent = "";
    if (err || !rooms){
      list.appendChild(Object.assign(document.createElement("div"),
        {className: "st-jam-empty", textContent: err || "could not look"}));
      return;
    }
    if (!rooms.length){
      list.appendChild(Object.assign(document.createElement("div"), {className: "st-jam-empty",
        textContent: "No jams running. Start one — whoever joins it next will see it here."}));
      return;
    }
    rooms.forEach(r => {
      const b = document.createElement("button");
      b.className = "st-jam-row";
      b.appendChild(Object.assign(document.createElement("b"), {textContent: r.name}));
      b.appendChild(Object.assign(document.createElement("span"),
        {textContent: r.peers + (r.peers === 1 ? " player" : " players")}));
      b.addEventListener("click", () => {
        list.hidden = true;
        Patchwork.session.join(r.name, askName());
      });
      list.appendChild(b);
    });
  });
});

document.addEventListener("click", e => {
  if (!list.hidden && !e.target.closest("#stJam")) list.hidden = true;
});

/* ---- talkback ----
   Open, not push-to-talk: you are playing with both hands, and a button you have to hold
   is a button you cannot use while playing. Off by default, because a microphone that
   opens itself is nobody's idea of a good time. */
const talkBtn = document.querySelector("#stTalk");
talkBtn.addEventListener("click", async () => {
  talkBtn.disabled = true;
  const r = await Patchwork.talk.toggle();
  talkBtn.disabled = false;
  if (!r.ok) who.innerHTML = who.innerHTML + " &middot; <em>" + r.why + "</em>";
});
function paintTalk(){
  const inJam = Patchwork.session.active;
  talkBtn.hidden = !inJam || !Patchwork.talk.supported;
  talkBtn.classList.toggle("st-live", Patchwork.talk.on);
  talkBtn.textContent = Patchwork.talk.on ? "\u{1F534} Live" : "\u{1F3A4} Talk";
  talkBtn.title = Patchwork.talk.on
    ? "Your microphone is open to the jam — click to close it"
    : "Open your microphone to the jam";
}
Patchwork.talk.onChange(paintTalk);
Patchwork.session.onChange(paintTalk);
paintTalk();

function paint(){
  const on = Patchwork.session.active;
  btn.textContent = on ? "Leave jam" : "Start a jam";
  btn.classList.toggle("st-on", on);
  joinBtn.hidden = on;
  if (!on){
    /* keep an explanation on screen; clearing it would hide the only thing that says why */
    if (!Patchwork.session.problem) who.textContent = "";
    return;
  }
  const peers = Patchwork.session.peers, S = Patchwork.session;
  /* WHERE the jam is, not just that there is one. A two-laptop test that is quietly two
     tabs on one machine looks identical otherwise, and so does a relay that never
     connected — both would read "waiting for someone to join" forever. */
  const clk = S.clock;
  /* ⚠️ "connecting…" and "reconnecting…" are different diagnoses and used to read the same.
     The first means the relay has never answered — a wrong address, or a relay that is not
     running. The second means it answered and the link went away, which is the network and
     will very likely come back on its own. Telling somebody to check the address when they
     should just wait ten seconds is the cost of collapsing them. */
  const link = S.link === "retrying" ? " <em>(reconnecting…)</em>"
             : S.link === "connecting" ? " <em>(connecting…)</em>"
             : clk.synced ? "" : " <em>(syncing clock…)</em>";
  who.innerHTML = "<b>" + S.room + "</b> · via " + S.via + link
    + " · " + (peers.length
        ? "you and " + peers.length + " other" + (peers.length > 1 ? "s" : "")
        : "waiting for someone to join")
    + (clk.rttMs == null ? "" : " · " + clk.rttMs + " ms");
}
/* the peer count and the clock estimate both move without anything else changing */
setInterval(paint, 1000);
Patchwork.session.onChange(paint);
paint();
})();

/* The all-at-once faces/panels switch used to live here. It is gone: every panel already
   carries its own Panel button, so nothing was lost except a control in the header that
   made the Studio page's chrome sit differently from every other tab's. */

/* ---- the rack's MIDI, in one place ----
   Every instrument answers on a channel and every panel grew a pair of selects to set it,
   so the same question had six answers scattered across six panels — and the one you
   needed was always inside the panel you had not opened. The input port was the page's
   from the start (see shell/midi.js); this brings the channels up to join it.

   ⚠️ It does not OWN any of it. Each instrument still keeps its own channel and still
   filters its own input; this reads and writes them through the adapter each one registers.
   A second copy of the routing here would be a second thing to disagree with the first, and
   the panels' own selects — which standalone builds still need — would be the ones to go
   stale. */
/* ---- the rack's output ----
   ⚠️ THE STUDIO HAD NO OUTPUT CONTROL AND THE SYNTHS EACH HAD ONE. Six copies of a question
   whose answer is the page's, which is the same mistake the MIDI panel below was written to
   undo — so this is the same fix, and the panels' own selects step aside with `data-hosted`
   the way LP·1's metronome already does. Standalone pages keep theirs: there is no page
   there to own it.

   Enumeration needs a moment and needs permission on some browsers, so the list fills in
   asynchronously and Rescan is there for a device plugged in after the fact. */
(() => {
"use strict";
const box = document.querySelector("#stAudio");
const A = window.Patchwork && Patchwork.audio;
if (!box || !A) return;
const sel = box.querySelector("#stAudioOut"), note = box.querySelector("#stAudioNote"),
      scan = box.querySelector("#stAudioScan");

/* ⚠️ SAY WHY THERE IS ONE PAIR. A row of greyed-out selects reads as a fault on this page, and
   the count is not this page's to give: the browser decides how many channels a device has, and
   Chrome on a Mac counts only the ones its speaker setup names. See openOut() in shell/bus.js. */
const pairsNote = document.createElement("span");
function paintPairs(){
  const n = A.outPairs().length;
  pairsNote.innerHTML = n > 1
    ? " " + A.outWidth + " channels \u2014 " + n + " pairs."
    : " This output is stereo to the browser, so every instrument plays on 1-2."
      + (/Mac/.test(navigator.platform || "")
        ? " A Mac gives an interface only the channels named in <b>Audio MIDI Setup \u2192 "
          + "Configure Speakers</b>; name them there, then reload."
        : "");
}
function say(msg, bad){
  note.innerHTML = msg || "";
  note.classList.toggle("bad", !!bad);
  if (!bad){ note.appendChild(pairsNote); paintPairs(); }
}
async function fill(){
  const list = await A.outputs();
  const keep = A.sink;
  sel.textContent = "";
  sel.appendChild(Object.assign(document.createElement("option"),
    {value: "", textContent: "System default"}));
  list.forEach(d => sel.appendChild(Object.assign(document.createElement("option"),
    {value: d.id, textContent: d.label})));
  /* ⚠️ Restored from the BUS rather than from the select, which is the same trap LP·1's
     input list documents: a rebuild would otherwise drop the choice back to the first row. */
  if ([].some.call(sel.options, o => o.value === keep)) sel.value = keep;
  if (!list.length)
    say("Only the system default is available. A browser lists the individual outputs by "
      + "name once it has audio permission — on the Pi that is granted by policy, and here "
      + "it follows the first time you let this page use a microphone.");
  else say(list.length + " output" + (list.length === 1 ? "" : "s") + " available.");
}
/* ---- a row per instrument ----
   ⚠️ THE OUTPUT PAIR IS PER INSTRUMENT AND THE DEVICE IS NOT, which is why one of these is a
   row and the other is the header above them. See the note in scenes.html. Laid out like the
   MIDI rows below because it is the same question asked of the same list.

   Built once, like theirs, and for the same reason: a <select> rebuilt under an open menu
   closes it, and this repaints whenever the device list changes. */
const rows = box.querySelector("#stAudioRows");
const built = new Map();

/* The two panels that take audio IN rather than only putting it out. ⚠️ Driven through the
   panel's own select rather than around it — LP·1 refuses an input change while it is
   recording and VC·1 has to reopen a stream, and both of those live in the panel's own
   change handler. Writing the value and firing `change` is the whole adapter. */
const INPUTS = {lp1: "Records", vc1: "Modulator"};
function panelSel(id){
  const root = (Patchwork.roots || []).find(r => r.dataset.instrument === id);
  return root ? root.querySelector("#inSel") : null;
}

function cell(labelText){
  const c = document.createElement("span");
  c.className = "st-midi-cell";
  c.appendChild(Object.assign(document.createElement("span"),
    {className: "st-midi-lab", textContent: labelText}));
  return c;
}

/* ⚠️ EVERY PANEL ON THE PAGE, not every panel on the MIDI router. LP·1 takes no notes and
   therefore never registered a channel — which is the whole reason surface.panel() exists —
   and it is also the one panel here that most obviously has an audio input. Building this
   list from the router quietly left out the looper. Roots are what is actually on the page;
   the name comes from whichever registry happens to know it. */
const silent = id => {
  const r = (Patchwork.roots || []).find(x => x.dataset.instrument === id);
  return !!(r && r.hasAttribute("data-silent"));
};
function panelList(){
  const midi = (Patchwork.midi && Patchwork.midi.list) ? Patchwork.midi.list() : [];
  /* ⚠️ WHO REGISTERED AS AN INSTRUMENT, not who has a data-instrument attribute. The
     launcher carries one so that it can be selected like a panel, and it has no strip, no
     channel and no audio of its own — a row for it here would be three dead selects. Asking
     the registries rather than the DOM is what keeps the two ideas apart. */
    const plays = (Patchwork.scenes && Patchwork.scenes.instruments) || [];
    const takes = (Patchwork.record && Patchwork.record.tracks) || [];
    const real = id => midi.some(x => x.id === id) || plays.some(x => x.id === id)
                    || takes.some(x => x.id === id);
    return (Patchwork.roots || []).map(r => {
      const id = r.dataset.instrument;
      const m = midi.find(x => x.id === id);
      const t = Patchwork.record && Patchwork.record.track ? Patchwork.record.track(id) : null;
      return {id, name: (m && m.name) || (t && t.name) || id.toUpperCase()};
    /* ⚠️ AND AN AUDIO ROW NEEDS AUDIO. SQ·1 passes every registry — it plays a pattern, it
       is in a scene, it answers on a channel — and has no strip to route, because what it
       drives is a box on the end of a cable. It says so in its markup; asking the DOM is how
       the mixer decides the same thing. */
    }).filter(x => x.id && real(x.id) && !silent(x.id));
}

function buildRows(){
  panelList().forEach(it => {
    if (built.has(it.id)) return;
    const row = document.createElement("div");
    row.className = "st-midi-row";
    row.dataset.inst = it.id;
    row.appendChild(Object.assign(document.createElement("span"),
      {className: "st-midi-name", textContent: it.name}));

    const outCell = cell("out");
    const outSel = document.createElement("select");
    outSel.className = "st-midi-ch";
    /* ⚠️ An id, so the surface page can drive THIS select rather than a second copy of the
       same question — see studio/settings.js. One control, one truth. */
    outSel.id = "stOut-" + it.id;
    outSel.setAttribute("aria-label", it.name + " output channels");
    outSel.addEventListener("change", () => { A.setOut(it.id, parseInt(outSel.value, 10)); });
    outCell.appendChild(outSel);
    row.appendChild(outCell);

    let inSelProxy = null;
    const src = INPUTS[it.id] ? panelSel(it.id) : null;
    if (src){
      const inCell = cell("in");
      inSelProxy = document.createElement("select");
      inSelProxy.className = "st-midi-ch";
      inSelProxy.id = "stAIn-" + it.id;
      inSelProxy.setAttribute("aria-label", it.name + " audio input");
      inSelProxy.addEventListener("change", () => {
        src.value = inSelProxy.value;
        src.dispatchEvent(new Event("change", {bubbles: true}));
        /* ⚠️ Read back rather than assumed. LP·1 puts the old value straight back when it
           refuses — changing the loop length would empty every take — so believing our own
           write would leave this row lying about what the looper is listening to. */
        setTimeout(() => { inSelProxy.value = src.value; }, 0);
      });
      inCell.appendChild(inSelProxy);
      row.appendChild(inCell);
      /* ⚠️ AND FOLLOW IT. A panel's list fills late — device names arrive after an async
         enumerate, and again whenever something is plugged in — so a copy taken when this row
         was built showed neither, and a device the panel offered was missing here until
         somebody pressed Rescan. Watching the select is what keeps a copy a copy. */
      new MutationObserver(paintRows).observe(src, {childList: true, subtree: true});
    } else row.appendChild(document.createElement("span")).className = "st-midi-cell st-midi-none";

    rows.appendChild(row);
    built.set(it.id, {outSel, inSelProxy, src});
  });
}

function paintRows(){
  buildRows();
  const pairs = A.outPairs();          // the device decides how many there are
  built.forEach((made, id) => {
    const want = pairs.map(p => p.pair + ":" + p.label).join(",");
    if (made.outSel.dataset.built !== want){
      made.outSel.dataset.built = want;
      made.outSel.textContent = "";
      pairs.forEach(o => made.outSel.appendChild(Object.assign(
        document.createElement("option"), {value: String(o.pair), textContent: o.label})));
    }
    made.outSel.value = String(A.outOf(id));
    /* One pair means a stereo device, and a list with one row on it is a control that only
       looks like a choice. */
    made.outSel.disabled = pairs.length < 2;
    if (made.inSelProxy && made.src){
      const want2 = [].map.call(made.src.options, o => o.value + ":" + o.textContent).join(",");
      if (made.inSelProxy.dataset.built !== want2){
        made.inSelProxy.dataset.built = want2;
        made.inSelProxy.textContent = "";
        /* the groups as well as the rows: "From this page" and a list of devices are two lists */
        [].forEach.call(made.src.children, n => made.inSelProxy.appendChild(n.cloneNode(true)));
      }
      made.inSelProxy.value = made.src.value;
    }
  });
}

sel.addEventListener("change", async () => {
  const r = await A.setSink(sel.value);
  const what = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "default";
  paintRows();          // a different device can offer a different number of pairs
  if (r === "ok") say("Output \u2192 <b>" + what + "</b>.");
  else if (r === "unsupported")
    say("This browser cannot route audio per device \u2014 "
      + "<code>AudioContext.setSinkId</code> needs Chrome 110+.", true);
  else say("Couldn't switch output (" + r + ").", true);
});
scan.addEventListener("click", () => { fill(); paintRows(); });
fill();
/* Late, because the instruments register with the MIDI router as they boot and the panels
   this proxies have to exist before their selects can be copied. */
setTimeout(paintRows, 0);
if (Patchwork.midi && Patchwork.midi.onChange) Patchwork.midi.onChange(paintRows);
/* A remembered output lands after the page is up, and can bring more pairs with it. */
if (A.onOut) A.onOut(() => { paintRows(); paintPairs(); });
})();

(() => {
"use strict";
const box = document.querySelector("#stMidi");
if (!box || !window.Patchwork || !Patchwork.midi) return;
const inSel = box.querySelector("#stMidiIn"),
      rows = box.querySelector("#stMidiRows"),
      follow = box.querySelector("#stMidiFollow"),
      note = box.querySelector("#stMidiNote");

const chOptions = sel => {
  sel.appendChild(Object.assign(document.createElement("option"),
    {value: "-1", textContent: "Omni"}));
  for (let c = 0; c < 16; c++)
    sel.appendChild(Object.assign(document.createElement("option"),
      {value: String(c), textContent: String(c + 1)}));
};

function fillPorts(){
  fillOuts();
  const keep = Patchwork.midi.port ? Patchwork.midi.port.id : "";
  inSel.textContent = "";
  inSel.appendChild(Object.assign(document.createElement("option"),
    {value: "", textContent: "— none —"}));
  Patchwork.midi.ports("inputs").forEach(p => inSel.appendChild(Object.assign(
    document.createElement("option"), {value: p.id, textContent: p.name || p.id})));
  inSel.value = keep;
}
inSel.addEventListener("change", () => Patchwork.midi.select(inSel.value));

const outSel = box.querySelector("#stMidiOut");
function fillOuts(){
  if (!outSel) return;
  const keep = Patchwork.midi.outId;
  outSel.textContent = "";
  outSel.appendChild(Object.assign(document.createElement("option"),
    {value: "", textContent: "\u2014 none \u2014"}));
  Patchwork.midi.ports("outputs").forEach(p => outSel.appendChild(Object.assign(
    document.createElement("option"), {value: p.id, textContent: p.name || p.id})));
  /* Restored from the ROUTER, not from the select — a rebuild when a cable appears would
     otherwise drop the choice back to "none". The same trap the audio list documents. */
  if ([].some.call(outSel.options, o => o.value === keep)) outSel.value = keep;
}
if (outSel) outSel.addEventListener("change", () => Patchwork.midi.selectOut(outSel.value));

/* Built once per registered instrument. The selects are not rebuilt on every repaint — a
   <select> being rebuilt under an open menu closes it, and this repaints whenever anything
   in the rack's MIDI changes. */
const built = new Map();          // id -> {inCh, outCh}
function build(){
  Patchwork.midi.list().forEach(it => {
    if (built.has(it.id)) return;
    const row = document.createElement("div");
    row.className = "st-midi-row";
    row.dataset.inst = it.id;
    row.appendChild(Object.assign(document.createElement("span"),
      {className: "st-midi-name", textContent: it.name}));
    const made = {};
    [["inCh", "in"], ["outCh", "out"]].forEach(([key, lab]) => {
      const cell = document.createElement("span");
      cell.className = "st-midi-cell";
      if (!it.spec[key]){ cell.classList.add("st-midi-none"); rows && row.appendChild(cell); return; }
      const sel = document.createElement("select");
      sel.className = "st-midi-ch";
      sel.id = "stMidi-" + key + "-" + it.id;
      chOptions(sel);
      sel.value = String(it.spec[key].get());
      sel.setAttribute("aria-label", it.name + " " + lab + " channel");
      sel.addEventListener("change", () => {
        it.spec[key].set(parseInt(sel.value, 10));
        paint();
      });
      cell.appendChild(Object.assign(document.createElement("span"),
        {className: "st-midi-lab", textContent: lab}));
      cell.appendChild(sel);
      made[key] = sel;
      row.appendChild(cell);
    });
    rows.appendChild(row);
    built.set(it.id, made);
  });
}

function paint(){
  build();
  const on = Patchwork.midi.follow;
  follow.checked = on;
  rows.classList.toggle("st-midi-ignored", on);
  Patchwork.midi.list().forEach(it => {
    const made = built.get(it.id);
    if (!made) return;
    ["inCh", "outCh"].forEach(k => {
      if (!made[k] || !it.spec[k]) return;
      const v = String(it.spec[k].get());
      if (made[k].value !== v) made[k].value = v;   // the panel's own select may have moved it
    });
  });
  const n = Patchwork.midi.ports("inputs").length;
  note.innerHTML = !n
    ? "No MIDI inputs found. Connect one and it will appear here."
    : on
      ? "Notes play <b>whichever panel has the keyboard</b> — click a panel to aim them. "
        + "Input channels are ignored while this is on; <b>out</b> still sends on its own channel."
      : n + " input" + (n === 1 ? "" : "s") + ". Each instrument listens on its own channel — "
        + "<b>Omni</b> answers to all of them.";
}

/* ⚠️ Held notes are dropped on the way through — see setFollow in shell/midi.js. Switching
   the rule a note-off will be routed by, while a note is held, is the one way to strand it. */
follow.addEventListener("change", () => { Patchwork.midi.setFollow(follow.checked); paint(); });

Patchwork.midi.onChange(() => { fillPorts(); paint(); });
fillPorts(); paint();
/* The instruments register during their own boot, which may be after this file runs. */
setTimeout(() => { fillPorts(); paint(); }, 0);

/* ---- the controller ----
   Sits under the channel rows because it is the answer to the same question one level up:
   the rows say which instrument answers to what, and this says what is doing the asking.

   ⚠️ IT LISTS WHAT IT CAN SEE, not what it knows about. A profile whose hardware is not
   plugged in is not an option — offering "Novation Launchkey MK4" to somebody who does not
   own one, and having it silently do nothing when picked, is worse than an empty list. */
const surfSel = box.querySelector("#stSurface"),
      surfNote = box.querySelector("#stSurfaceNote");
if (surfSel && window.Patchwork && Patchwork.surface){
  const fillSurfaces = () => {
    const found = Patchwork.surface.available;
    const cur = Patchwork.surface.connected;
    /* Rebuilt only when the set of options actually changed — a <select> being rebuilt
       under an open menu closes it, and this repaints on every port change. */
    const want = found.map(f => f.id + "\u0000" + f.label).join("\u0001");
    if (surfSel.dataset.built !== want){
      surfSel.dataset.built = want;
      surfSel.textContent = "";
      surfSel.appendChild(Object.assign(document.createElement("option"),
        {value: "", textContent: found.length ? "\u2014 none \u2014" : "\u2014 none found \u2014"}));
      found.forEach(f => surfSel.appendChild(Object.assign(document.createElement("option"),
        {value: f.id, textContent: f.label})));
    }
    if (surfSel.value !== cur) surfSel.value = cur;
    surfSel.disabled = !found.length;

    const st = Patchwork.surface.status;
    surfNote.hidden = !st;
    if (st){
      surfNote.innerHTML = "<b>" + st + "</b> is driving the rack \u2014 pads follow the "
        + "selected panel, the eight encoders are its controls, and Play is the transport."
        + (Patchwork.midi.sysex ? "" : " Its screen needs SysEx permission, which this page "
          + "does not have; everything else works without it.");
    }
  };
  surfSel.addEventListener("change", () => {
    if (!surfSel.value){ Patchwork.surface.disconnect(); return; }
    Patchwork.surface.connect(surfSel.value);
  });
  Patchwork.surface.onChange(fillSurfaces);
  Patchwork.midi.onChange(fillSurfaces);
  fillSurfaces();
  setTimeout(fillSurfaces, 0);
}
})();
