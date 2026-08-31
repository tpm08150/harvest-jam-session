
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
/* id -> {pat, seam}. The PATTERN and the audio time it lands at, worked out once when the
   row was pressed rather than re-derived at every step: the instrument this row STARTS is
   given the same number (see joinSeam), so the two halves of a row cannot round to
   different lines. A null pat is a pending STOP. */
const pending = new Map();
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
     pattern   every N bars, N being the pattern length set beside it

   All three are computed from the shared clock rather than signalled between instruments:
   the boundary is every N bars from the grid origin. An instrument that is playing arrives
   at the answer on its own and checks it INSIDE its scheduling loop, so the change is
   accurate to the grid rather than 200 ms late behind the lookahead; one that the row is
   STARTING is given the same line to land on — see joinSeam(). */
let quantum = "pattern";
/* ⚠️ The pattern length is the PAGE's, set in the Scenes head and drawn by the bar counter
   there. It used to be whatever CS·1's progression happened to be, which made the boundary
   circular for CS·1 itself: bringing it in meant waiting for a seam defined by the thing
   that was not playing yet. A number you set is one every instrument, CS·1 included, can
   arrive at the same way. */
let patternBars = 4;

function setQuantum(q){
  if (["instant", "bar", "pattern"].indexOf(q) < 0) return;
  quantum = q;
  notify();
}
function setPatternBars(n){
  patternBars = Math.max(1, n | 0);
  notify();
}
function quantumSeconds(){
  const bar = 4 * Patchwork.clock.beatSeconds();
  return quantum === "bar" ? bar : patternBars * bar;
}

/* Where an instrument this row STARTS should come in.

   The ones already playing take their change inside their own tick, at the first step past
   the boundary — see take(). One that is stopped has no tick to check it in, and its own
   transport claims the next BAR, so on "Pattern" the row landed in two pieces four bars
   apart: measured pressing at bar 28.05, the joiner in at bar 29 and the swap at bar 32.

   Computed with claim() itself rather than a second copy of the arithmetic, so the joiner
   and the swap cannot round to different lines. That call is pure here — it only invents an
   origin when nothing is running, which is exactly the case this returns null for.

   Null means "start now": with nothing playing there is no seam to wait for, and the first
   instrument to start is the one that defines the grid. */
function joinSeam(){
  if (quantum === "instant") return null;
  if (!Patchwork.clock.running || Patchwork.clock.origin == null) return null;
  const beats = quantumSeconds() / Patchwork.clock.beatSeconds();
  return beats > 0 ? Patchwork.clock.claim(beats) : null;
}

/* Sixteen rows. The launcher, the live grid and LP·1's take strip all draw from this, so
   this is the one place the number lives — except the worklet's filled(), which cannot
   see it across the AudioWorklet boundary and says so. */
const COUNT = 16;
for (let i = 0; i < COUNT; i++) rows.push({name: String(i + 1), cells: {}});

/* ⚠️ A QUEUED CHANGE BELONGS TO A RUNNING TRANSPORT.

   Stop an instrument by hand before its seam arrives and there is no tick left to reach
   take(), so the change sat there — and the next thing to start that instrument got it a
   step later, out of nowhere. A queued STOP is the one that hurts: fire a row that has
   nothing for BS·1, press Stop before the seam, and BS·1 would come back in on the next row
   you pressed and cut out a step later, with nothing on screen to explain it. Found exactly
   that way while measuring the join fix above.

   ASKED, not inferred from the clock. The obvious rule — void a seam that went past a while
   ago — cannot tell "this instrument was stopped through it" from "this instrument's steps
   are longer than the quantum", and CS·1's are: a four-bar chord lands its next take four
   bars after a bar-quantum seam, and would have been thrown away as stale.

   Run from take() as well as from here, because a panel's own Play button never reaches the
   model — see changed(). Any instrument still ticking is enough to sweep for all of them. */
function voidStopped(){
  let hit = false;
  pending.forEach((_, id) => {
    const it = insts.find(x => x.id === id);
    if (it && !it.isPlaying()){ pending.delete(id); queued.delete(id); hit = true; }
  });
  return hit;
}
function notify(){
  voidStopped();
  subs.forEach(fn => { try{ fn(); }catch(e){} });
}
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
   coming. Everything else about the join is fire()'s: the pattern, the start, and the seam
   it lands on. */
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

/* Replace the whole bank. A session sends the rows entire rather than diffing them —
   at this size the diff costs more than the copy, and a full snapshot cannot drift.
   Deep-copied on the way in for the same reason capture() is: a shared reference would
   make every client's grid the same object as the message it arrived in. */
function loadRows(next){
  if (!Array.isArray(next)) return;
  rows.forEach((r, i) => {
    const src = next[i];
    r.cells = src && src.cells ? JSON.parse(JSON.stringify(src.cells)) : {};
  });
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

/* Arm a pattern. With the whole rack stopped there is no seam coming, so the row takes
   effect immediately — otherwise firing a scene into silence does nothing visible and looks
   broken. With something already playing there IS one, and everything the row touches waits
   for it. */
/* Firing a row STARTS anything it lands on that was stopped, and STOPS anything the row
   has nothing for.

   The empty cell is the part that matters. A row is a complete picture of what should be
   playing, so an instrument with no clip in it falls silent — otherwise firing row 2
   leaves row 1's bass running underneath, and what you hear is neither row. Ableton does
   the same, and for the same reason.

   The change, the start and the stop all land on the ROW's seam, not on the click, so a row
   change never cuts a bar in half and never arrives in pieces. */
function fire(row, id){
  if (!rows[row]) return;
  const targets = id ? insts.filter(x => x.id === id) : insts;
  /* One boundary for the whole row, pinned across the start() calls below — see joinSeam().
     Cleared in a finally: a pin left standing would be picked up by the next Play button
     pressed by hand, which is a bar line's worth of surprise nobody asked for. */
  const seam = joinSeam();
  if (seam != null) Patchwork.clock.pin(seam);
  try{
    targets.forEach(it => {
      const pat = rows[row].cells[it.id];
      if (!pat){
        if (it.isPlaying() && seam != null){
          /* a null pattern is the pending STOP — take() reads it at the seam */
          pending.set(it.id, {pat: null, seam});
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
      if (it.isPlaying() && seam != null){
        pending.set(it.id, {pat, seam});
        queued.set(it.id, row);
      } else {
        /* stopped: take it now and start, so the row is audible from the press. The pin makes
           "now" the row's seam when the rack is running — its first step lands on the same
           line the others swap on, rather than on the next bar.

           Anything still queued for it is void: this pattern is the answer to that question,
           and a stale queue is how a track came back for one step and stopped again. */
        pending.delete(it.id);
        it.apply(JSON.parse(JSON.stringify(pat)));
        queued.delete(it.id);
        onRow.set(it.id, row);
        it.start();
      }
    });
  } finally { if (seam != null) Patchwork.clock.pin(null); }
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
  /* On the same seam as a fired row, and for the same reason: pressing ● on a row starts the
     ARMED tracks through here and the unarmed ones through fire(), so without this one press
     brought half the row in on the next bar and the other half four bars later.

     Null with the rack stopped, which is the ● press the workflow is built around — arm a
     track, hit a row, hear it now. Nothing about that changes. */
  const seam = joinSeam();
  if (seam != null) Patchwork.clock.pin(seam);
  /* whatever was queued for it is void — see the sweep in notify() for why one can still be
     sitting there, and what it does to a track that comes back carrying it */
  try{
    if (!it.isPlaying()){ pending.delete(id); queued.delete(id); it.start(); }
  } finally { if (seam != null) Patchwork.clock.pin(null); }
  /* after the attempt, not before: start() can decline — PM·1 says so out loud when its
     Motion is Off — and a row nothing is sounding from is not a row to join */
  if (row != null && it.isPlaying()) onRow.set(id, row);
  notify();
}

/* Called by an instrument from inside its tick for EVERY step it schedules, with the audio
   time of that step. It used to be called only at a loop point, which hard-coded
   pattern-length quantisation; the boundary is a setting now, so the shell has to see every
   step to know when one has been reached.

   The comparison is against an ABSOLUTE time stored when the row was pressed. It used to
   ask "did this step cross a boundary the previous one had not", which meant remembering
   the previous step per instrument — and that memory went stale across a stop, so a change
   queued before one landed on the first step after it came back rather than on a seam. */
function take(id, when){
  /* every step, for every instrument, not just this one: a track stopped by hand has no tick
     left to notice that what it was waiting for is void, so whatever IS running notices for
     it. Six entries and a Map delete — cheaper than the paint it saves. */
  if (voidStopped()) notify();
  const q = pending.get(id);
  if (!q || when == null) return false;
  /* the first step AT OR PAST the line the row was aimed at. The epsilon is for a step whose
     accumulated time lands a float's breadth short of a boundary computed by multiplication;
     a millionth of a second early is not a thing anybody can hear. */
  if (q.seam != null && when < q.seam - 1e-6) return false;
  const it = insts.find(x => x.id === id);
  const pat = q.pat;
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

/* ---- the live pattern ----
   What an instrument is playing RIGHT NOW, as opposed to the copy sitting in a cell. A cell
   only changes when someone stores into it, so a session that shared cells alone showed an
   edit to the other machines when a row was fired and not before — you would change a step
   and watch nothing happen anywhere else.

   Same capture()/apply() a scene uses. They have always been the instrument's whole pattern;
   nothing needed adding to them. */
function livePattern(id){
  const it = insts.find(x => x.id === id);
  if (!it) return null;
  try{ return it.capture(); }catch(e){ return null; }
}
function setLivePattern(id, pat){
  const it = insts.find(x => x.id === id);
  if (!it || !pat) return;
  try{ it.apply(JSON.parse(JSON.stringify(pat))); }catch(e){}
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
        live, restore, loadRows, livePattern, setLivePattern,
        /* Nothing here can see an instrument's own Play button. The transports are the
           instruments' and they change without telling the model, so a caller that has
           just moved one says so — the same signal record.changed() is. */
        changed: notify,
        has(row, id){ return !!(rows[row] && rows[row].cells[id]); }};
})();
