
/* ============ boot ============ */

/* Not a scene member. A scene changes what an instrument PLAYS, and a looper's content is
   a recording — swapping it from a scene row would either throw away a take or need the
   bank to carry audio. Both are wrong; the looper is played by hand, the way MS·1's
   vocoder and bass are. */

/* LP·1 records audio, not notes, so it has no write() — arming and record hand straight
   to its own transport, which already lands the take on the bar line. */
Patchwork.record.register("lp1", {
  name: "LP·1",
  canRecord: true,
  arm: recording => { if (recording && LP.mode === "idle") arm("rec"); },
  disarm: () => { if (LP.mode === "rec" || LP.mode === "armed") stopLoop(); }
});

window.__lp1 = {LP, arm, play, stopLoop, clearLoop, undo, openInput, closeInput,
                ensureNode, allocate, loopFrames,
                get ctx(){ return ctx; }, get node(){ return node; }};
