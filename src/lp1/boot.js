
/* ============ boot ============ */

/* Not a scene member. A scene changes what an instrument PLAYS, and a looper's content is
   a recording — swapping it from a scene row would either throw away a take or need the
   bank to carry audio. Both are wrong; the looper is played by hand, the way MS·1's
   vocoder and bass are. */

/* LP·1 records audio, not notes, so it has no write() — arming and record hand straight
   to its own transport, which already lands the take on the bar line. */
/* LP·1 records audio, not notes, so it has no write(). It has SLOTS instead — one take per
   scene row — and the live page drives them directly. */
Patchwork.record.register("lp1", {
  name: "LP·1",
  canRecord: true,
  slots: true,
  recordSlot: n => arm("rec", n),
  playSlot: n => queueSlot(n),          // the launcher's route: lands on the loop line
  hasSlot: n => hasSlot(n),
  clearSlot: n => clearSlot(n),
  /* armed is not yet a row — it is a row about to start on the bar line, and the launcher
     already draws that as the queued state */
  liveSlot: () => (LP.mode === "idle" || LP.mode === "armed") ? null : LP.slot,
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
