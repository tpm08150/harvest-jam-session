
/* Song mode — one sequence number for the whole rack, and a chain of them.

   The launcher is Ableton's: a row is a copy of a pattern per instrument, fired by hand, and every
   instrument can be on a different row. Tyler asked (2026-09-20) for the other tradition instead, for
   the groovebox with no screen: SEQUENCE 3 is sequence 3 on every instrument at once, and a song is a
   list of sequence numbers with a length each, played in order. Nothing to store, nothing to fire —
   you write parts into numbered sequences, which every instrument already keeps sixteen of
   (shell/sequences.js), and you play the numbers.

   ⚠️ IT IS THE LAUNCHER'S SEAM, NOT A NEW ONE. Changing sixteen instruments' sequences at once has to
   land the way a row lands — inside each instrument's own tick, at the first step past the line, in
   the time domain the notes are placed in — or a change would arrive a lookahead late and a bar in
   pieces. So go() hands every instrument's next pattern to scenes.land() with one seam, and the
   sequence strip learns which number it landed on from the slot that travels with it (see around()
   in shell/sequences.js). What is on the grid is put away first, as the strip's own click does.

   ⚠️ AN EMPTY SEQUENCE IS SILENCE, NOT A STOP. A row with nothing for an instrument stops it; a
   sequence with nothing written for one plays nothing and stays on the grid, ready to be written
   into — which is what "switch to 2 and write the drums" needs. CS·1 has no empty (a progression is
   always something), so its empty sequences play the progression you came from, as its strip does.

   Whose transport? Nobody's: go() plays what is playing. Play all starts the band and Stop all stops
   it; a chain that is playing starts the band if it is stopped, and stops when the band does.

   The chain: [{seq, bars}], played from the top, each entry for its bars from the seam it landed on,
   the next one landed on the same rules. Once through, or looped (`loop`). Saved with the project. */
Patchwork.song = (() => {
"use strict";

const COUNT = 16;                  // sequences, as shell/sequences.js counts them
const MAX_CHAIN = 64;
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

let at = 0;                        // the sequence the rack is on, or heading to once `landing` passes
let landing = null;                // {seq, seam}: a change waiting for its seam, for a display to flash
let landTimer = null;

const ctxTime = () => { const c = Patchwork.audio && Patchwork.audio.ctx; return c ? c.currentTime : 0; };
const ids = () => Patchwork.scenes.instruments.map(i => i.id).filter(id => Patchwork.sequences.has(id));

/* Which instruments have anything in sequence i, for a pad to say so. */
function filled(i){ return ids().filter(id => Patchwork.sequences.filled(id, i)); }

/* Everything the rack would play from sequence i, as scenes.land() takes it. */
function cellsFor(i){
  const cells = {};
  ids().forEach(id => {
    const pat = Patchwork.sequences.peek(id, i);
    if (pat) cells[id] = {pat, slot: i};
  });
  return cells;
}

/* Change the whole rack to sequence i: on `seam` when given, else on the launcher's next seam, else —
   nothing playing — now. */
function go(i, seam){
  i = i | 0;
  if (i < 0 || i >= COUNT) return false;
  const when = seam !== undefined ? seam : Patchwork.scenes.joinSeam();
  Patchwork.scenes.land(cellsFor(i), when, null, {start: false});
  at = i;
  clearTimeout(landTimer); landTimer = null;
  if (when != null && when > ctxTime()){
    landing = {seq: i, seam: when};
    landTimer = setTimeout(() => { landing = null; landTimer = null; notify(); },
                           Math.max(0, (when - ctxTime()) * 1000) + 30);
  } else landing = null;
  notify();
  return true;
}

/* ---- the chain ---- */
const chain = [];                  // [{seq, bars}]
let loop = true;
let pos = -1;                      // the entry playing, or -1 when the chain is not
let landedAt = null;               // the seam the entry playing landed on
let nextTimer = null;
const barSeconds = () => 4 * Patchwork.clock.beatSeconds();

function clampBars(n){ return Math.max(1, Math.min(64, n | 0)); }
function add(seq, bars, where){
  if (chain.length >= MAX_CHAIN) return -1;
  const entry = {seq: Math.max(0, Math.min(COUNT - 1, seq | 0)), bars: clampBars(bars || 4)};
  const i = (where == null || where < 0 || where > chain.length) ? chain.length : where;
  chain.splice(i, 0, entry);
  if (pos >= i && pos >= 0) pos++;
  notify();
  return i;
}
function remove(i){
  if (i < 0 || i >= chain.length) return false;
  chain.splice(i, 1);
  if (pos > i) pos--;
  else if (pos === i){ pos = Math.min(pos, chain.length - 1); }
  if (!chain.length) stopChain();
  notify();
  return true;
}
function set(i, patch){
  const e = chain[i];
  if (!e) return false;
  if (patch && typeof patch.seq === "number") e.seq = Math.max(0, Math.min(COUNT - 1, patch.seq | 0));
  if (patch && typeof patch.bars === "number") e.bars = clampBars(patch.bars);
  notify();
  return true;
}
function clear(){ chain.length = 0; stopChain(); notify(); }

/* ⚠️ THE NEXT ENTRY IS LANDED AHEAD OF ITS LINE, NOT AT IT. An instrument takes a change at the first
   step it schedules past the seam, and it schedules about 200 ms ahead — so a change handed over
   after the seam is a step late. The timer aims 800 ms before; the seam it hands over is exact
   whatever the timer's own lateness, because the line was worked out when the entry before it landed. */
function armNext(){
  clearTimeout(nextTimer); nextTimer = null;
  if (pos < 0 || landedAt == null) return;
  const e = chain[pos];
  if (!e) return;
  const seam = landedAt + e.bars * barSeconds();
  const ms = Math.max(0, (seam - ctxTime() - .8) * 1000);
  nextTimer = setTimeout(() => {
    nextTimer = null;
    if (pos < 0) return;
    let next = pos + 1;
    if (next >= chain.length){
      if (!loop){ pos = -1; landedAt = null; notify(); return; }
      next = 0;
    }
    /* the band stopped under it: nothing to land on, and nothing to keep counting for */
    if (!Patchwork.transport || !Patchwork.transport.anyPlaying){ stopChain(); return; }
    pos = next;
    landedAt = seam;
    go(chain[pos].seq, seam);
    armNext();
  }, ms);
}

/* Play the chain from entry i (the top unless said). With the band stopped, the first entry goes on
   every grid now and Play all starts the band; playing, it lands on the next seam like any change. */
function playChain(from){
  if (!chain.length) return false;
  pos = Math.max(0, Math.min(chain.length - 1, from | 0));
  const playing = !!(Patchwork.transport && Patchwork.transport.anyPlaying);
  if (!playing){
    go(chain[pos].seq, null);
    if (Patchwork.transport) Patchwork.transport.toggleAll();
    /* the band's first step is the entry's seam: claim() gave every transport the same line */
    landedAt = Patchwork.clock.origin != null ? Patchwork.clock.claim(4) : ctxTime();
  } else {
    const seam = Patchwork.scenes.joinSeam();
    go(chain[pos].seq, seam);
    landedAt = seam != null ? seam : ctxTime();
  }
  armNext();
  notify();
  return true;
}
/* The chain stops counting; whatever is playing goes on playing. */
function stopChain(){
  clearTimeout(nextTimer); nextTimer = null;
  if (pos < 0) return;
  pos = -1; landedAt = null;
  notify();
}

/* Where the entry playing is, in bars, for a display: {entry, bar, of}. */
function progress(){
  if (pos < 0 || landedAt == null) return null;
  const e = chain[pos];
  const bar = Math.floor(Math.max(0, ctxTime() - landedAt) / barSeconds());
  return {entry: pos, seq: e.seq, bar: Math.min(e.bars - 1, bar), of: e.bars};
}

/* ---- with a project ---- */
if (Patchwork.project) Patchwork.project.part("song", {
  capture: () => ({v: 1, at, loop, chain: chain.map(e => ({seq: e.seq, bars: e.bars}))}),
  apply: p => {
    if (!p) return;
    stopChain();
    chain.length = 0;
    (Array.isArray(p.chain) ? p.chain : []).slice(0, MAX_CHAIN).forEach(e => {
      if (e && typeof e.seq === "number") chain.push({seq: Math.max(0, Math.min(COUNT - 1, e.seq | 0)), bars: clampBars(e.bars || 4)});
    });
    loop = p.loop !== false;
    if (typeof p.at === "number") at = Math.max(0, Math.min(COUNT - 1, p.at | 0));
    notify();
  }
});

return {go, add, remove, set, clear, playChain, stopChain, progress, filled, COUNT, MAX_CHAIN,
        get at(){ return at; },
        get landing(){ return landing; },
        get chain(){ return chain.map(e => ({seq: e.seq, bars: e.bars})); },
        get pos(){ return pos; },
        get loop(){ return loop; }, set loop(v){ loop = !!v; notify(); },
        get chaining(){ return pos >= 0; },
        onChange: fn => subs.push(fn)};
})();
