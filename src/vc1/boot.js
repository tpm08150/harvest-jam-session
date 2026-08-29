
/* ============ boot ============ */

Patchwork.scenes.register("vc1", {
  name: "VC·1",
  isPlaying: () => seq.SEQ.playing,
  start: () => { ensureAudio(); seq.start(); },
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

Patchwork.record.register("vc1", {
  name: "VC·1",
  write: (midi, vel, when) => {
    const i = seq.recordAt(midi, vel, when);
    if (i >= 0) grid.paint();
    return i;
  }
});

initMidi();

/* Offline render. A vocoder has no microphone in an offline context, so a test supplies
   its own modulator — the same arrangement MS·1's harness used. */
async function renderVoc(opts){
  const o = opts || {};
  const dur = o.dur || 2.0, rate = o.rate || 48000;
  const saved = {ctx, out, carrierBus, vocOut, modGain, modComp, modMakeup, modPost,
                 absCurve, noiseBuf, sibGain, sibNoise, modMeter, bank};
  const savedCarriers = Array.from(carriers.entries());
  carriers.clear();
  ctx = null; bank = [];
  const off = new OfflineAudioContext(2, Math.ceil(rate * dur), rate);
  try{
    initAudio(off);
    if (o.params) Object.assign(P, o.params);
    applyVocoder();
    if (o.modulator){ const m = o.modulator(off); if (m) m.connect(modGain); }
    (o.notes || [48, 55, 60]).forEach(n => noteOn(n, 100, 0));
    if (o.gate > 0 && o.gate < dur) carriers.forEach(c => c.release(o.gate));
    return await off.startRendering();
  } finally {
    carriers.clear();
    ctx = saved.ctx; out = saved.out; carrierBus = saved.carrierBus; vocOut = saved.vocOut;
    modGain = saved.modGain; modComp = saved.modComp; modMakeup = saved.modMakeup;
    modPost = saved.modPost; absCurve = saved.absCurve; noiseBuf = saved.noiseBuf;
    sibGain = saved.sibGain; sibNoise = saved.sibNoise; modMeter = saved.modMeter;
    bank = saved.bank;
    savedCarriers.forEach(([k, v]) => carriers.set(k, v));
  }
}

window.__vc1 = {P, seq, noteOn, noteOff, allNotesOff, ensureAudio, applyVocoder,
                openInput, closeInput, renderVoc, MIDI, onMidi,
                get ctx(){ return ctx; }, get bank(){ return bank; },
                get carriers(){ return carriers; }};
