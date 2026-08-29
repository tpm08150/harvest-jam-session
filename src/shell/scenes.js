
/* Scenes.

   A scene is a row: one pattern per instrument, fired together. Firing does not take
   effect where you clicked — it takes effect at the next musical seam, which is what
   makes this playable rather than a series of small mistakes.

   A scene captures the PATTERN, not the sound. Firing one changes what an instrument
   plays and leaves the filter you just dialled alone. That is the least surprising rule,
   and it keeps the deep panels for setting up and the scene row for performing.

   ---

   The seam has to be a SCHEDULING boundary, not a wall-clock one. Every instrument
   schedules ~200 ms ahead, so swapping a pattern when ctx.currentTime crosses the bar
   line lands the change a fifth of a second late — the old pattern has already been
   scheduled past the seam. CS·1 solved this before the shell existed, with takePending()
   called inside its tick right before the next chord is scheduled. This generalises that:
   an instrument calls take() at its own loop point, so the swap happens on the seam in
   the same time domain the notes are placed in. */
Patchwork.scenes = (() => {
"use strict";

const insts = [];                 // {id, name, capture, apply, isPlaying}
const rows = [];                  // rows[i] = {name, cells:{id: pattern}}
const pending = new Map();        // id -> pattern, waiting for that instrument's seam
const queued = new Map();         // id -> row index, for the UI to show what is armed
const subs = [];

const COUNT = 8;
for (let i = 0; i < COUNT; i++) rows.push({name: String(i + 1), cells: {}});

function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }
function onChange(fn){ subs.push(fn); }

function register(id, spec){
  insts.push({id, name: spec.name || id, capture: spec.capture, apply: spec.apply,
              isPlaying: spec.isPlaying || (() => false)});
  notify();
}

/* Capture is a deep copy at the moment you press it. Storing a live reference would make
   every scene in the bank point at the same object, so editing the grid would silently
   rewrite every scene that had ever been captured from it. */
function store(row, id){
  const it = insts.find(x => x.id === id);
  if (!it || !rows[row]) return;
  rows[row].cells[id] = JSON.parse(JSON.stringify(it.capture()));
  notify();
}
function storeAll(row){ insts.forEach(it => store(row, it.id)); }

function clear(row, id){
  if (!rows[row]) return;
  if (id) delete rows[row].cells[id];
  else rows[row].cells = {};
  notify();
}

/* Arm a pattern. An instrument that is not running has no seam coming, so it takes the
   change immediately — otherwise firing a scene with the transport stopped does nothing
   visible and looks broken. */
function fire(row, id){
  if (!rows[row]) return;
  const targets = id ? insts.filter(x => x.id === id) : insts;
  targets.forEach(it => {
    const pat = rows[row].cells[it.id];
    if (!pat) return;
    if (it.isPlaying()){
      pending.set(it.id, pat);
      queued.set(it.id, row);
    } else {
      it.apply(JSON.parse(JSON.stringify(pat)));
      queued.delete(it.id);
    }
  });
  notify();
}

/* Called by an instrument from inside its tick, at its own loop point. */
function take(id){
  if (!pending.has(id)) return false;
  const it = insts.find(x => x.id === id);
  const pat = pending.get(id);
  pending.delete(id);
  queued.delete(id);
  if (it) it.apply(JSON.parse(JSON.stringify(pat)));
  notify();
  return true;
}

/* Whether an instrument's own transport is running. The live page needs it to draw a
   master Play that reflects what is actually going, rather than a button with an opinion. */
function playing(id){
  const it = insts.find(x => x.id === id);
  return !!(it && it.isPlaying());
}

return {register, store, storeAll, clear, fire, take, onChange, playing,
        get rows(){ return rows; },
        get instruments(){ return insts.map(i => ({id: i.id, name: i.name})); },
        get queued(){ return new Map(queued); },
        has(row, id){ return !!(rows[row] && rows[row].cells[id]); }};
})();
