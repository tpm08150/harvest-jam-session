
/* ============ boot ============ */

Patchwork.scenes.register("bs1", {
  name: "BS·1",
  isPlaying: () => seq.SEQ.playing,
  capture: () => seq.capture(),
  apply: pat => {
    seq.apply(pat);
    lenSel.value = String(seq.SEQ.len);
    rateSel.value = seq.SEQ.rate;
    keySel.value = String(seq.SEQ.root);
    scaleSel.value = seq.SEQ.scale;
    grid.render();
  }
});

initMidi();

/* Offline render, mirroring the other instruments' harnesses so a bass patch can be
   trimmed against a target rather than dialled. */
async function renderNote(opts){
  const o = opts || {};
  const dur = o.dur || 2.0, rate = o.rate || 48000;
  const saved = {ctx, out, bassOut, comp};
  const savedCur = cur; cur = null;
  const savedActive = Array.from(active); active.clear();
  ctx = null;
  const off = new OfflineAudioContext(2, Math.ceil(rate * dur), rate);
  try{
    initAudio(off);
    if (o.params) Object.assign(P, o.params);
    const v = buildVoice(o.midi == null ? 36 : o.midi, o.vel == null ? 100 : o.vel, 0);
    if (o.gate > 0 && o.gate < dur) v.release(o.gate);
    return await off.startRendering();
  } finally {
    active.clear();
    ctx = saved.ctx; out = saved.out; bassOut = saved.bassOut; comp = saved.comp;
    savedActive.forEach(v => active.add(v));
    cur = savedCur;
  }
}

window.__bs1 = {P, seq, noteOn, noteOff, allNotesOff, ensureAudio, renderNote, MIDI, onMidi,
                get ctx(){ return ctx; }, get active(){ return active; },
                get held(){ return held; }, get cur(){ return cur; }};
