
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
/* Which row each instrument is playing FROM — `queued` is what is waiting for a seam,
   this is what landed. Recorded rather than derived: two rows holding the same pattern
   are equal by value, so comparing the cell against what an instrument is playing would
   call them the same row. */
const onRow = new Map();          // id -> row index it is playing
const subs = [];

/* ---- when a fired row actually lands ----
     instant   on the click
     bar       the next bar line
     pattern   when CS·1's progression starts over

   All three are computed from the shared clock rather than signalled between instruments:
   the boundary is every N bars from the grid origin, and CS·1 reports how many bars its
   progression is. Every instrument arrives at the same answer on its own, and checks it
   INSIDE its scheduling loop, so the change is accurate to the grid rather than 200 ms
   late behind the lookahead. */
let quantum = "pattern";
let patternBars = 4;                  // CS·1 keeps this current
const lastSeen = new Map();           // id -> the time of the last step it scheduled

function setQuantum(q){
  if (["instant", "bar", "pattern"].indexOf(q) < 0) return;
  quantum = q;
  notify();
}
function setPatternBars(n){
  patternBars = Math.max(1, n | 0);
}
function quantumSeconds(){
  const bar = 4 * Patchwork.clock.beatSeconds();
  return quantum === "bar" ? bar : patternBars * bar;
}

/* Sixteen rows. The launcher, the live grid and LP·1's take strip all draw from this, so
   this is the one place the number lives — except the worklet's filled(), which cannot
   see it across the AudioWorklet boundary and says so. */
const COUNT = 16;
for (let i = 0; i < COUNT; i++) rows.push({name: String(i + 1), cells: {}});

function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }
function onChange(fn){ subs.push(fn); }

function register(id, spec){
  insts.push({id, name: spec.name || id, capture: spec.capture, apply: spec.apply,
              isPlaying: spec.isPlaying || (() => false),
              start: spec.start || function(){},
              stop: spec.stop || function(){}});
  notify();
}

/* Capture is a deep copy at the moment you press it. Storing a live reference would make
   every scene in the bank point at the same object, so editing the grid would silently
   rewrite every scene that had ever been captured from it. */
function put(row, id){
  const it = insts.find(x => x.id === id);
  if (!it || !rows[row]) return null;
  rows[row].cells[id] = JSON.parse(JSON.stringify(it.capture()));
  return it;
}

/* Putting a clip into a row that is ALREADY PLAYING brings that instrument in, exactly as
   if the row had been fired again — which is what you had to do, and the reason a gesture
   that should read as "add this to what I am hearing" read as nothing happening.

   Only when the instrument is stopped. One playing row 2 and a clip stored into row 1 is
   you filling the launcher while you play, not asking to be moved; a store is not a fire,
   and silently yanking a running instrument onto another row is a mistake you cannot see
   coming. Everything else about the join is fire()'s: the pattern, the start, and the bar
   line it lands on. */
function store(row, id){
  const it = put(row, id);
  if (!it) return;
  if (!it.isPlaying() && live(row)) fire(row, id);
  else notify();
}

/* Keep the block an instrument is playing OUT OF in step with what it is playing.

   Live recording writes onto the running grid, and the cell still held the copy taken when
   the row was pressed — so everything you played was one row-fire away from being thrown
   out, and the gesture only looked like it had worked until you used it. Arming a track and
   playing into a scene now updates that scene as you play.

   Only a cell that already exists. If the row has nothing for this instrument then the row
   is not what it is playing, and creating a block is a deliberate gesture — shift-click, or
   the row's ● — not something a stray note should do. */
function restore(id){
  const row = onRow.get(id);
  if (row == null || !rows[row] || !playing(id)) return;
  if (!rows[row].cells[id]) return;
  put(row, id);
  notify();
}

/* Capturing the whole rack into a row does NOT join. It takes what every instrument
   happens to be holding, stopped ones included, and starting those is nobody's ask. */
function storeAll(row){ insts.forEach(it => put(row, it.id)); notify(); }

/* Is this instrument sounding out of THIS row? onRow can hold a stale entry for one
   stopped from its own panel, so the transport is asked as well. */
function playingFrom(row, id){ return onRow.get(id) === row && playing(id); }

/* ...or queued to it. A cell deleted while its row is still waiting for the seam has to
   turn that pending pattern into a pending stop: `pending` holds a REFERENCE to the cell
   object, and deleting the cell out of `rows` does not reach into it, so the block you
   just removed would otherwise land anyway a bar later. */
function boundTo(row, id){ return playingFrom(row, id) || queued.get(id) === row; }

/* Is anything actually sounding from this row? */
function live(row){
  for (const id of onRow.keys()) if (playingFrom(row, id)) return true;
  return false;
}

/* Emptying the cell an instrument is playing out of STOPS it — the mirror of the join,
   and the rule firing a row already follows: a row with nothing for an instrument is a
   row that instrument is silent in. Deleting the block you can hear and hearing it carry
   on is the launcher disagreeing with itself.

   ONLY the cell being played out of. Clearing row 3 while row 1 is what you are hearing
   is housekeeping, not a transport gesture, and must not touch what is sounding. */
function clear(row, id){
  if (!rows[row]) return;
  const stopping = [];
  if (id){
    if (boundTo(row, id)) stopping.push(id);
    delete rows[row].cells[id];
  } else {
    insts.forEach(it => { if (boundTo(row, it.id)) stopping.push(it.id); });
    rows[row].cells = {};
  }
  /* fire() on the now-empty cell IS the stop, and it is the same stop a fired row gives:
     queued to that instrument's loop point at every quantum but `instant`, so nothing is
     cut mid-bar. It notifies, which is why this does not. */
  if (!stopping.length){ notify(); return; }
  stopping.forEach(x => fire(row, x));
}

/* Arm a pattern. An instrument that is not running has no seam coming, so it takes the
   change immediately — otherwise firing a scene with the transport stopped does nothing
   visible and looks broken. */
/* Firing a row STARTS anything it lands on that was stopped, and STOPS anything the row
   has nothing for.

   The empty cell is the part that matters. A row is a complete picture of what should be
   playing, so an instrument with no clip in it falls silent — otherwise firing row 2
   leaves row 1's bass running underneath, and what you hear is neither row. Ableton does
   the same, and for the same reason.

   Both the start and the stop land on the instrument's loop point, not on the click, so a
   row change never cuts a bar in half. */
function fire(row, id){
  if (!rows[row]) return;
  const targets = id ? insts.filter(x => x.id === id) : insts;
  targets.forEach(it => {
    const pat = rows[row].cells[it.id];
    if (!pat){
      if (it.isPlaying() && quantum !== "instant"){
        /* null is the pending STOP — take() reads it at the seam */
        pending.set(it.id, null);
        queued.set(it.id, row);
      } else if (it.isPlaying()){
        it.stop();
        pending.delete(it.id);
        queued.delete(it.id);
        onRow.delete(it.id);
      } else {
        pending.delete(it.id);
        queued.delete(it.id);
        onRow.delete(it.id);
      }
      return;
    }
    if (it.isPlaying() && quantum !== "instant"){
      pending.set(it.id, pat);
      queued.set(it.id, row);
    } else {
      /* stopped: take it now and start, so the row is audible from the press */
      it.apply(JSON.parse(JSON.stringify(pat)));
      queued.delete(it.id);
      onRow.set(it.id, row);
      it.start();
    }
  });
  notify();
}

/* Start an instrument's transport without touching its pattern — what a just-recorded
   track needs, since the pattern it should play is already the one it has. */
/* `row` is which row it is starting FROM, when the caller knows — recording into a row
   is what a track being started is usually for, and without it the row it is now playing
   would not count as live and the next track added to it would not join. */
function start(id, row){
  const it = insts.find(x => x.id === id);
  if (!it) return;
  if (!it.isPlaying()) it.start();
  /* after the attempt, not before: start() can decline — PM·1 says so out loud when its
     Motion is Off — and a row nothing is sounding from is not a row to join */
  if (row != null && it.isPlaying()) onRow.set(id, row);
  notify();
}

/* Called by an instrument from inside its tick for EVERY step it schedules, with the
   audio time of that step. It used to be called only at a loop point, which hard-coded
   pattern-length quantisation; the boundary is a setting now, so the shell has to see
   every step to know when one is crossed.

   `lastSeen` is updated even with nothing pending, or the first crossing after a fire has
   no previous step to compare against and would be missed. */
function take(id, when){
  const prev = lastSeen.get(id);
  if (when != null) lastSeen.set(id, when);
  if (!pending.has(id)) return false;
  if (quantum !== "instant"){
    const origin = Patchwork.clock.origin;
    const q = quantumSeconds();
    if (origin == null || prev == null || !(q > 0)) return false;
    /* did this step cross a boundary the previous one had not? */
    if (Math.floor((when - origin) / q) <= Math.floor((prev - origin) / q)) return false;
  }
  const it = insts.find(x => x.id === id);
  const pat = pending.get(id);
  const row = queued.get(id);
  pending.delete(id);
  queued.delete(id);
  if (!it){ notify(); return true; }
  /* a queued null means the row had nothing for this instrument: stop, at the seam */
  if (pat === null){ it.stop(); onRow.delete(id); }
  else { it.apply(JSON.parse(JSON.stringify(pat))); if (row != null) onRow.set(id, row); }
  notify();
  return true;
}

/* Whether an instrument's own transport is running. The live page needs it to draw a
   master Play that reflects what is actually going, rather than a button with an opinion. */
function playing(id){
  const it = insts.find(x => x.id === id);
  return !!(it && it.isPlaying());
}

return {register, store, storeAll, clear, fire, take, onChange, playing, start,
        setQuantum, setPatternBars,
        get quantum(){ return quantum; },
        get patternBars(){ return patternBars; },
        get rows(){ return rows; },
        get instruments(){ return insts.map(i => ({id: i.id, name: i.name})); },
        get queued(){ return new Map(queued); },
        get onRow(){ return new Map(onRow); },
        live, restore,
        has(row, id){ return !!(rows[row] && rows[row].cells[id]); }};
})();
