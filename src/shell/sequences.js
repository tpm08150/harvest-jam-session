
/* Sequences — sixteen of them, on every instrument that plays one.

   A scene cell holds a COPY of a pattern, taken when you pressed it, and the instrument held
   exactly one: the one on its grid. So building a song meant writing a part, storing it into a
   row, and writing over it to make the next — and the part written over was gone from the
   instrument for good. It lived on as a cell, where it could be fired and never edited, and
   getting it back onto the grid meant writing it again.

   So each instrument keeps sixteen, and the grid is whichever one is up. Choosing another puts
   the one you were on away and brings that one up — empty, if nothing was ever written there.
   The launcher is unchanged: a cell still copies what the instrument is playing, which is now
   "the sequence that is up".

   ⚠️ A SEQUENCE IS A SCENE PATTERN. What is kept is exactly what scenes.register()'s capture()
   returns and its apply() takes — the one definition of an instrument's pattern, handed to a
   third consumer rather than described a third time. An instrument registers here only what is
   new: what an empty one looks like, and whether a pattern has anything in it.

     Patchwork.sequences.register("bs1", {blank: p => seq.blankOf(p), used: p => seq.usedIn(p)});

   ⚠️ THE SEQUENCE THAT IS UP IS NEVER KEPT IN STEP, and nothing here watches the grid. A step grid
   has a dozen ways to change — a click, a drag, a held note, a lane, a lock, a recorded take, a
   Clear, a Groove — and a hook in each is a hook the next gesture forgets. So while a sequence is
   up the grid IS that sequence, and it is copied into its slot at the moments the slot has to be
   true: leaving it, saving it, and anything arriving from outside. Polled rather than pushed,
   which is the bargain shell/session.js makes for patterns, for the same reason. */
Patchwork.sequences = (() => {
"use strict";

const COUNT = 16;
const book = new Map();          // id -> bank
const subs = [];
/* True while this module is the one writing a pattern, so around() does not mistake choosing a
   sequence for something arriving from outside. */
let busy = false;

function register(id, spec){
  if (!id || book.has(id)) return;
  const s = spec || {};
  book.set(id, {
    id,
    label: s.label || "Sequence",
    /* a captured pattern -> the same settings with nothing in them. Absent for an instrument
       with no such thing as empty (CS·1 always has a progression), where an empty slot starts
       as a copy of the one you came from instead. */
    blank: typeof s.blank === "function" ? s.blank : null,
    /* a captured pattern -> whether there is anything in it. Absent means always. */
    used: typeof s.used === "function" ? s.used : null,
    /* Put a sequence on the grid, when that is not quite what a scene does — PM·1's scene picks
       a motion as it lands, and choosing a sequence must not. Absent means the scene's apply(). */
    apply: typeof s.apply === "function" ? s.apply : null,
    /* top-level keys two patterns are not compared by — see keyOf() */
    ignore: Array.isArray(s.ignore) ? s.ignore.slice() : [],
    /* where the strip goes on the panel: after this block. See mount(). */
    after: s.after || null,
    slots: new Array(COUNT).fill(null),   // {pat, key} or null
    /* The slot the grid is, or -1 for none — a pattern from outside that no slot holds. */
    at: 0,
    /* {i, key}: an empty slot just walked into, and what was put on the grid there */
    fresh: null,
    box: null
  });
}

/* What two patterns are compared by: everything capture() returns, less the keys an instrument
   says are not part of a sequence. PM·1's motion is one — a scene sets it on its own account as
   it lands, and a row stored from sequence 2 is still sequence 2 whether PM·1 was on Off or Seq
   when it was stored. */
function keyOf(b, pat){
  if (!pat || typeof pat !== "object") return null;
  if (!b.ignore.length) return JSON.stringify(pat);
  const o = Object.assign({}, pat);
  b.ignore.forEach(k => { delete o[k]; });
  return JSON.stringify(o);
}

/* The grid, as a pattern and its key. */
function live(b){
  let pat = null;
  try{ pat = Patchwork.scenes.livePattern(b.id); }catch(e){ return null; }
  if (!pat) return null;
  return {pat, key: keyOf(b, pat)};
}

/* Does this grid, standing in slot i, mean there is something in slot i? */
function counts(b, i, cur){
  if (!cur) return false;
  /* ⚠️ AN EMPTY SLOT YOU WALKED INTO IS STILL EMPTY until something is written there. Walking in
     puts a blank on the grid — or a copy of what you came from, where there is no blank — and
     walking out again untouched must not leave a trail of lit copies behind you. */
  if (b.fresh && b.fresh.i === i && b.fresh.key === cur.key) return false;
  if (!b.used) return true;
  try{ return !!b.used(cur.pat); }catch(e){ return true; }
}

/* Put the grid away into the slot it is. */
function keep(b, cur){
  if (b.at < 0 || !cur) return;
  b.slots[b.at] = counts(b, b.at, cur)
    ? {pat: JSON.parse(JSON.stringify(cur.pat)), key: cur.key}
    : null;
}

function put(b, pat){
  busy = true;
  try{
    if (b.apply) b.apply(JSON.parse(JSON.stringify(pat)));
    else Patchwork.scenes.setLivePattern(b.id, pat);
  }catch(e){ console.error("sequence could not be put on the grid: " + b.id, e); }
  finally { busy = false; }
}

/* Walk into slot i: what is kept there, else a blank, else a copy of the grid you came from. */
function enter(b, i, cur){
  const kept = b.slots[i];
  b.at = i;
  b.fresh = null;
  if (kept){ put(b, kept.pat); return; }
  if (!cur) return;
  if (b.blank){
    let empty = null;
    try{ empty = b.blank(JSON.parse(JSON.stringify(cur.pat))); }catch(e){}
    if (empty) put(b, empty);
  }
  const now = live(b);
  b.fresh = now ? {i, key: now.key} : null;
}

/* ---- the two gestures ---- */
function select(id, i){
  const b = book.get(id);
  i = i | 0;
  if (!b || i < 0 || i >= COUNT || i === b.at) return false;
  const cur = live(b);
  keep(b, cur);
  enter(b, i, cur);
  notify();
  return true;
}

/* The grid goes into slot i as well, and you go with it: a variation starts as a copy of what it
   varies. ⚠️ It REPLACES whatever slot i held — which is also how a slot is emptied, by copying a
   blank grid over it. The modifier is the ask; the launcher spends shift on deleting a block for
   the same reason. */
function copyTo(id, i){
  const b = book.get(id);
  i = i | 0;
  if (!b || i < 0 || i >= COUNT || i === b.at) return false;
  const cur = live(b);
  if (!cur) return false;
  keep(b, cur);
  b.at = i;
  b.fresh = null;
  keep(b, cur);
  notify();
  return true;
}

/* ---- a pattern arriving from outside ----
   ⚠️ A SCENE, A JAM AND A PATCH ALL WRITE THE GRID WITHOUT ASKING WHICH SEQUENCE IS UP. Left alone,
   the next time the grid was put away the slot you were on would take whatever had arrived: fire
   row 2 while on sequence 1, and sequence 1 became row 2's copy — the exact loss this file exists
   to prevent. So everything that changes a pattern from outside comes through here.

   BEFORE, the grid is put away, so nothing written into the slot you were on is lost. AFTER, if
   the pattern did change, the instrument is on whichever slot holds exactly what arrived — a
   cell stored from sequence 3 and not edited since IS sequence 3 — or, when none does, on the
   slot it was already on if that one is empty: an empty slot has nothing to lose, which is why
   loading a project onto a fresh page lands in sequence 1 rather than in none.

   Otherwise it is on NONE, and the strip rings nothing. Edits then stay on the grid, and the
   next choice of sequence replaces it — which is what firing another row has always done to an
   edit nobody stored. Shift-click keeps it.

   A change that leaves the pattern as it was — a patch that only moved the sound — changes
   nothing about which sequence is up. */
/* `slot`, when the caller says which of the sixteen it is putting on the grid, settles what content
   alone cannot: an empty sequence walked into by a global change (shell/song.js) is that sequence,
   fresh, and not "none"; and a pattern two slots hold is the one the caller named. */
function around(id, fn, slot){
  const b = book.get(id);
  if (!b || busy) return fn();
  const before = live(b);
  keep(b, before);
  try{ return fn(); }
  finally {
    const after = live(b);
    const named = (typeof slot === "number" && slot >= 0 && slot < COUNT) ? slot : -1;
    if (after && (!before || after.key !== before.key)){
      const hit = named >= 0 && b.slots[named] && b.slots[named].key === after.key
        ? named : b.slots.findIndex(s => s && s.key === after.key);
      b.fresh = null;
      if (hit >= 0) b.at = hit;
      else if (named >= 0){ b.at = named; if (!b.slots[named]) b.fresh = {i: named, key: after.key}; }
      else if (b.at < 0 || b.slots[b.at]) b.at = -1;
      notify();
    } else if (after && named >= 0 && named !== b.at){
      /* the same pattern, asked for by a different number: an empty slot entered from a grid that
         already showed nothing, or a copy in two places */
      b.fresh = null;
      b.at = named;
      if (!b.slots[named]) b.fresh = {i: named, key: after.key};
      notify();
    }
  }
}

/* ---- smaller on the shelf ----
   ⚠️ A PATTERN IS MOSTLY NOTHING, WRITTEN OUT IN FULL. A step grid keeps all sixty-four steps
   whatever its length, and SQ·1 keeps sixteen grids: one SQ·1 sequence measured 91 KB of JSON,
   almost all of it the same empty step over and over. Sixteen of those in a project is a megabyte
   and a half, in the one localStorage key every project shares.

   So a saved sequence writes a run of identical items once, with a count — sixty-four empty
   steps become one. Exactly reversible, key order and all, because the keys that say which cell
   is which sequence are compared as strings and a load spelt differently would match nothing.
   Only at the shelf: in memory, in a scene cell and on the wire a pattern is the plain one. */
const RUN = "~run";
function pack(v){
  if (Array.isArray(v)){
    const out = [];
    for (let i = 0; i < v.length;){
      const s = JSON.stringify(v[i]);
      let n = 1;
      while (i + n < v.length && JSON.stringify(v[i + n]) === s) n++;
      if (n > 2) out.push({[RUN]: [n, pack(v[i])]});
      else for (let k = 0; k < n; k++) out.push(pack(v[i + k]));
      i += n;
    }
    return out;
  }
  if (v && typeof v === "object"){
    const o = {};
    Object.keys(v).forEach(k => { o[k] = pack(v[k]); });
    return o;
  }
  return v;
}
/* Unpacked data passes through unchanged, so a bank saved before packing still loads. */
function unpack(v){
  if (Array.isArray(v)){
    const out = [];
    v.forEach(x => {
      const run = x && typeof x === "object" && !Array.isArray(x)
               && Object.keys(x).length === 1 && Array.isArray(x[RUN]) ? x[RUN] : null;
      if (run) for (let k = 0; k < (run[0] | 0); k++) out.push(unpack(run[1]));
      else out.push(unpack(x));
    });
    return out;
  }
  if (v && typeof v === "object"){
    const o = {};
    Object.keys(v).forEach(k => { o[k] = unpack(v[k]); });
    return o;
  }
  return v;
}

/* ---- with a patch, and with a project ----
   All sixteen as they stand, and which is up. `live` only when the grid is in no slot, so a patch
   saved while a scene was playing still brings back what was playing. */
function capture(id){
  const b = book.get(id);
  if (!b) return null;
  const cur = live(b);
  keep(b, cur);
  const out = {v: 1, at: b.at, slots: b.slots.map(s => (s ? pack(s.pat) : null))};
  if (b.at < 0 && cur) out.live = pack(cur.pat);
  return out;
}

/* ⚠️ ALL SIXTEEN ARE REPLACED, and the ones you had are not kept anywhere: recalling a patch's
   sequences is the same bargain recalling its sound makes with the knobs. What was on the grid
   goes too — unless the caller has already put the right thing there (CS·1's and PM·1's patches
   carry their own grid), in which case it is recognised and left alone. */
function load(id, data){
  const b = book.get(id);
  if (!b || !data || !Array.isArray(data.slots)) return false;
  b.slots = Array.from({length: COUNT}, (_, i) => {
    const p = data.slots[i] && typeof data.slots[i] === "object" ? unpack(data.slots[i]) : null;
    return p ? {pat: p, key: keyOf(b, p)} : null;
  });
  b.fresh = null;
  const at = (typeof data.at === "number" && data.at >= 0 && data.at < COUNT) ? data.at | 0 : -1;
  const cur = live(b);
  if (at < 0){
    b.at = -1;
    if (data.live) put(b, unpack(data.live));
  } else if (b.slots[at] && cur && cur.key === b.slots[at].key){
    b.at = at;
  } else enter(b, at, cur);
  notify();
  return true;
}

/* How many a saved bank holds, for a panel to say so. */
function count(data){
  return data && Array.isArray(data.slots) ? data.slots.filter(Boolean).length : 0;
}

/* ---- which sequence a launcher cell holds ----
   A cell is a copy, so it IS sequence 3 for exactly as long as neither has changed since it was
   stored, and that is what the launcher prints on it — the way an LP·1 cell prints its take.
   ⚠️ By content, not by a tag written when the cell was stored: a tag would go on saying 3 after
   sequence 3 had been rewritten, and a number that lies is worse than no number. */
const cellKeys = new WeakMap();          // a cell object -> its key; cells are replaced, never edited
const recentLive = new Map();            // id -> {t, cur}, so a paint of every cell captures once
function recent(b){
  const now = performance.now();
  const hit = recentLive.get(b.id);
  if (hit && now - hit.t < 250) return hit.cur;
  const cur = live(b);
  recentLive.set(b.id, {t: now, cur});
  return cur;
}
function slotOf(id, pat){
  const b = book.get(id);
  if (!b || !pat || typeof pat !== "object") return -1;
  let key = cellKeys.get(pat);
  if (key === undefined){
    try{ key = keyOf(b, pat); }catch(e){ key = null; }
    cellKeys.set(pat, key);
  }
  if (key == null) return -1;
  for (let i = 0; i < COUNT; i++){
    if (i === b.at){
      const cur = recent(b);
      if (cur && cur.key === key && counts(b, i, cur)) return i;
    } else if (b.slots[i] && b.slots[i].key === key) return i;
  }
  return -1;
}

/* ---- the strip ----
   Injected rather than written into six panel.html files — the arrangement faces.js and record.js
   use for the plate's buttons, and for their reason: one implementation, and an instrument that
   registers later gets it without being told. On the face, because writing a song happens there. */
function mount(){
  book.forEach(b => {
    if (b.box && b.box.isConnected) return;
    const root = (Patchwork.roots || []).find(r => r.dataset.instrument === b.id);
    if (!root) return;
    let anchor = (b.after && root.querySelector(b.after)) || root.querySelector("#patchNote")
              || root.querySelector(".transport") || root.querySelector(".plate");
    if (!anchor) return;
    /* ⚠️ A CHILD OF THE PANEL, whatever the anchor is inside: the face hides the panel's children
       that are not data-face, so a strip nested in one of those would vanish with it. */
    while (anchor.parentElement && anchor.parentElement !== root) anchor = anchor.parentElement;
    const box = document.createElement("div");
    box.className = "seqs";
    box.setAttribute("data-face", "");
    const lab = document.createElement("span");
    lab.className = "silk seqs-lab";
    lab.textContent = b.label;
    const row = document.createElement("div");
    row.className = "seqs-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", b.label + "s");
    for (let i = 0; i < COUNT; i++){
      const n = document.createElement("button");
      n.type = "button";
      n.className = "seqs-n";
      n.dataset.i = String(i);
      n.textContent = String(i + 1);
      row.appendChild(n);
    }
    row.addEventListener("click", e => {
      const n = e.target.closest(".seqs-n");
      if (!n) return;
      if (e.shiftKey) copyTo(b.id, +n.dataset.i);
      else select(b.id, +n.dataset.i);
    });
    box.appendChild(lab);
    box.appendChild(row);
    anchor.insertAdjacentElement("afterend", box);
    b.box = box;
  });
  paint();
}

/* ⚠️ ON A TIMER as well as on a change, because the one fact that moves most — whether the
   sequence that is up has anything in it — changes with every step you write, and nothing here
   hears about that (see the note at the top). The launcher repaints on the same interval for the
   same reason. Only a strip on screen is asked — and "on screen" is the strip's own layout, not
   document.hidden: a hidden tab throttles the timer by itself, and a guard on it meant a change
   made while the tab was hidden was drawn nowhere until something else happened to repaint. */
/* ⚠️ AN ATTRIBUTE IS WRITTEN ONLY WHEN IT CHANGES. paint() runs every 400 ms for every instrument's
   strip, and it set aria-pressed and a title on all sixteen numbers each time whether or not anything
   had moved — about seventy DOM changes a second per instrument, over four hundred across the rack,
   with nothing happening, each one style work for the page. Nothing on a laptop; on the Raspberry Pi 4
   the rack could not play (2026-09-13). */
function writeAttr(el, attr, value){ if (el.getAttribute(attr) !== value) el.setAttribute(attr, value); }
function paint(){
  book.forEach(b => {
    const box = b.box;
    if (!box || !box.isConnected || box.offsetParent === null) return;
    const cur = b.at >= 0 ? live(b) : null;
    const here = b.at >= 0 && counts(b, b.at, cur);
    const word = b.label;
    const empty = b.blank ? "Click for an empty one" : "Click to start one from the " + word.toLowerCase() + " you are on";
    box.classList.toggle("loose", b.at < 0);
    const lab = box.querySelector(".seqs-lab");
    if (lab) writeAttr(lab, "title", b.at < 0
      ? "What is on the grid came from a scene, a jam or a patch, and none of these sixteen holds it. "
        + "Shift-click a number to keep it there."
      : "");
    box.querySelectorAll(".seqs-n").forEach(n => {
      const i = +n.dataset.i, on = i === b.at;
      const has = on ? here : !!b.slots[i];
      n.classList.toggle("cur", on);
      n.classList.toggle("has", has);
      writeAttr(n, "aria-pressed", on ? "true" : "false");
      writeAttr(n, "title", word + " " + (i + 1) + (on
        ? (has ? " — on the grid now. Shift-click another number to copy it there."
               : " — empty, on the grid now. Anything you write is kept here.")
        : (has ? ". Click to bring it up; shift-click to copy the grid over it."
               : " — empty. " + empty + "; shift-click to copy the grid into it.")));
    });
  });
}
let timer = null;
function notify(){
  recentLive.clear();
  paint();
  subs.forEach(fn => { try{ fn(); }catch(e){} });
}

/* ---- what slot i would put on the grid ----
   For a caller that has to hand the pattern to something else first — a seam, which lands it later
   (shell/song.js). What is kept there; else a blank of the grid, or the grid itself where the
   instrument has no blank; null when there is nothing to go on. */
function peek(id, i){
  const b = book.get(id);
  if (!b || i < 0 || i >= COUNT) return null;
  if (i === b.at){ const cur = live(b); return cur ? JSON.parse(JSON.stringify(cur.pat)) : null; }
  const kept = b.slots[i];
  if (kept) return JSON.parse(JSON.stringify(kept.pat));
  const cur = live(b);
  if (!cur) return null;
  const copy = JSON.parse(JSON.stringify(cur.pat));
  if (!b.blank) return copy;
  try{ return b.blank(copy) || copy; }catch(e){ return copy; }
}
/* Is there anything in slot i — counting the grid, when i is the one that is up. */
function filled(id, i){
  const b = book.get(id);
  if (!b || i < 0 || i >= COUNT) return false;
  if (i === b.at) return counts(b, i, live(b));
  return !!b.slots[i];
}

return {register, select, copyTo, around, capture, load, count, slotOf, peek, filled, COUNT,
        mount(){ mount(); if (!timer) timer = setInterval(paint, 400); },
        has: id => book.has(id),
        at: id => (book.has(id) ? book.get(id).at : -1),
        /* what this instrument calls one of its sixteen — "Progression" on CS·1 — for a screen */
        label: id => (book.has(id) ? book.get(id).label : ""),
        get ids(){ return [...book.keys()]; },
        onChange: fn => subs.push(fn)};
})();

/* ---- the sequences' share of a project ----
   ⚠️ A PROJECT THAT SAVED THE GRID AND NOT THE SIXTEEN would reopen with one sequence per
   instrument — the one that happened to be up — and the rest of the song's parts gone, which is
   the loss sixteen of them exist to stop. Registered straight after the scenes' share, so it
   applies after the live patterns are on the grids and finds them already where they belong. */
(() => {
"use strict";
if (!Patchwork.project) return;
Patchwork.project.part("sequences", {
  capture(){
    const out = {};
    Patchwork.sequences.ids.forEach(id => { out[id] = Patchwork.sequences.capture(id); });
    return out;
  },
  apply(p){
    if (!p) return;
    Object.keys(p).forEach(id => Patchwork.sequences.load(id, p[id]));
  }
});
})();
