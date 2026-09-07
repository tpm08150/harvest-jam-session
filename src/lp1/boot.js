
/* ============ boot ============ */

/* Not a scene member. A scene changes what an instrument PLAYS, and a looper's content is
   a recording — swapping it from a scene row would either throw away a take or need the
   bank to carry audio. Both are wrong; the looper is played by hand, the way MS·1's
   vocoder and bass are.

   ⚠️ SO A SCENE CELL NAMES A TAKE RATHER THAN BEING ONE. Slot n used to BE row n, which made
   the take bank and the arrangement one list: a loop you wanted in three places had to be
   recorded three times, and thirty-two rows against sixteen takes would have left half the
   launcher unable to hold a loop at all. The four calls below are the whole of the change —
   the launcher still asks the same four questions and gets answers about a reference. */
Patchwork.record.register("lp1", {
  name: "LP·1",
  canRecord: true,
  slots: true,
  /* ⚠️ NOT "RECORD INTO THIS ROW" ANY MORE. It is "put what I am holding here", which is the
     sentence every other instrument's cell already answers — theirs holds a pattern and this
     one holds the take you are on. Recording is LP·1's own business and happens on its own
     pads and its own button. */
  recordSlot: n => assignRow(n),
  playSlot: n => fireRowTake(n),
  hasSlot: n => rowHasTake(n),
  /* Which take this row names, for a cell that has to show it — see paintCell(). */
  takeAt: n => takeAt(n),
  /* ⚠️ FORGETS THE REFERENCE, KEEPS THE AUDIO. Clearing a cell is tidying an arrangement;
     throwing away a recording is a thing you ask for on the take strip, and doing it as a
     side effect of the first would be the most destructive control on the page wearing the
     costume of the least. */
  clearSlot: n => unassignRow(n),
  /* armed is not yet a row — it is a row about to start on the bar line, and the launcher
     already draws that as the queued state */
  liveSlot: () => (LP.mode === "idle" || LP.mode === "armed") ? null : LP.firedRow,
  /* how the session gets a take out of here and puts one back — see shell/codec.js */
  grabTake: n => grabTake(n),
  loadTake: (n, chans, meta) => loadTake(n, chans, meta),
  takeMeta: () => ({bars: LP.bars, bpm: LP.bpmAtRecord || Patchwork.clock.bpm || 120}),
  sampleRate: () => (ctx ? ctx.sampleRate : 48000),
  disarm: () => { if (LP.mode === "rec" || LP.mode === "armed") stopLoop(); },
  stop: () => stopLoop()
});

window.__lp1 = {LP, arm, play, fireSlot, selectSlot, hasSlot, clearSlot, stopLoop, clearLoop, undo,
                setDub, queueSlot, grabTake, loadTake,
                openInput, closeInput,
                ensureNode, allocate, loopFrames,
                get ctx(){ return ctx; }, get node(){ return node; }};
