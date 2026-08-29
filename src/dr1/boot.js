
/* ============ boot ============ */

function ensureAudio(){
  initAudio();
  Patchwork.audio.resume();
  return ctx.state;
}

/* Render one voice offline, the way __ms1.renderPatch() and __cs1.renderChord() do.
   This is what the kit's trims are measured with — see measure() below. */
async function renderHit(id, opts){
  const o = opts || {};
  const dur = o.dur || 1.5, rate = o.rate || 48000;
  const saved = {ctx, kit, comp, noiseBuf};
  const savedOpen = openHat;
  openHat = null;
  ctx = null;
  const off = new OfflineAudioContext(2, Math.ceil(rate * dur), rate);
  try{
    initAudio(off);
    if (o.params) Object.assign(P[id], o.params);
    /* `hits` renders a whole pattern rather than one voice, which is the only way to get
       at the cost that matters: a drum machine's load is hits per second, and a single
       one-shot in a long buffer measures mostly silence. */
    if (o.hits) o.hits.forEach(h => fire(h.id, h.t, h.vel == null ? 1 : h.vel));
    else fire(id, 0, o.vel == null ? 1 : o.vel);
    return await off.startRendering();
  } finally {
    ctx = saved.ctx; kit = saved.kit; comp = saved.comp; noiseBuf = saved.noiseBuf;
    openHat = savedOpen;
  }
}

/* Measure every voice and report the trim each one needs.

   The metric is the loudest 30 ms anywhere in the hit, not RMS over a fixed window.
   That matters more here than anywhere else in the repo, because a kit spans 45 ms
   (closed hat) to 420 ms (kick) and any fixed window is wrong for one end of it:

     500 ms — MS·1's window. Divides a hat's energy by ten parts silence.
     150 ms — the obvious fix. Still under-measures a 45 ms hat by ~5 dB while measuring
              a 380 ms open hat in full, which handed two voices from the SAME generator
              trims 13 dB apart. That is the metric being wrong, not the voices.
     30 ms peak-RMS — self-scaling. Every voice is measured over the part of itself that
              is actually loud, so length stops leaking into level.

   It is also the better perceptual proxy: for transients the ear integrates over roughly
   this long, which is why a short bright hit and a long quiet one can measure the same
   in RMS and sound nothing alike.

   ⚠️ Stochastic, for the same reason MS·1's harness is: every noise source starts at a
   random offset per hit, so snare, clap, hats and the kick's click do not repeat exactly.
   `runs` averages; 8 holds the numbers to about a tenth of a dB. Never read one run. */
async function measure(runs){
  const N = runs || 8;
  const rows = {};
  for (const id of ORDER){
    let sum = 0;
    for (let r = 0; r < N; r++){
      const b = await renderHit(id, {dur: 1.5});
      const L = b.getChannelData(0), R = b.getChannelData(1);
      const win = Math.round(b.sampleRate * .03);
      /* sliding sum-of-squares, so this stays one pass over the buffer */
      let acc = 0, best = 0;
      for (let i = 0; i < L.length; i++){
        const m = (L[i] + R[i]) / 2;
        acc += m * m;
        if (i >= win){ const o = (L[i-win] + R[i-win]) / 2; acc -= o * o; }
        if (i >= win && acc > best) best = acc;
      }
      sum += Math.sqrt(best / win);
    }
    const db = 20 * Math.log10(sum / N);
    const target = TARGET_BD + BALANCE[id];
    rows[id] = {measured: +db.toFixed(2), target: target,
                needs: +(target - db).toFixed(2), applied: TRIM[id]};
  }
  return rows;
}

/* ---- scenes ----
   A DR·1 pattern is the grid and how it is read. Not the voice parameters: firing a
   scene should change the beat, not retune the kit under you. */
Patchwork.scenes.register("dr1", {
  name: "DR·1",
  isPlaying: () => SEQ.playing,
  capture: () => ({steps: JSON.parse(JSON.stringify(steps)),
                   len: SEQ.len, rate: SEQ.rate, swing: SEQ.swing, accentAmt: SEQ.accentAmt}),
  apply: pat => {
    ORDER.forEach(k => { if (pat.steps && pat.steps[k]) steps[k] = pat.steps[k].slice(); });
    if (pat.len) SEQ.len = pat.len;
    if (pat.rate) SEQ.rate = pat.rate;
    if (pat.swing != null) SEQ.swing = pat.swing;
    if (pat.accentAmt != null) SEQ.accentAmt = pat.accentAmt;
    $("#len").value = String(SEQ.len);
    $("#rate").value = SEQ.rate;
    paintPads();
  }
});

/* A drum grid records differently: the note picks the LANE, not a pitch, and the same
   nearest-step rounding applies. GM numbers come in from a pad controller; an audition
   click passes the lane id straight through. */
Patchwork.record.register("dr1", {
  name: "DR·1",
  write: (midi, vel, when) => {
    const id = typeof midi === "string" ? midi : GM[midi];
    if (!id || !SEQ.playing || !marks.length) return -1;
    const ctx = Patchwork.audio.ctx;
    const t = when == null ? ctx.currentTime : when;
    let m = null;
    for (let k = marks.length - 1; k >= 0; k--) if (marks[k].t <= t){ m = marks[k]; break; }
    if (!m) m = marks[0];
    const i = ((t - m.t) > (m.end - m.t) / 2 ? m.i + 1 : m.i) % SEQ.len;
    steps[id][i] = vel >= 100 ? 2 : 1;
    paintPads();
    return i;
  }
});

initMidi();

/* A test hook, not a feature — the same one CS·1 and MS·1 carry. */
window.__dr1 = {P, SEQ, steps, ORDER, VOICES, TRIM, BALANCE, TARGET_BD,
                fire, renderHit, measure, ensureAudio, MIDI, onMidi,
                get ctx(){ return ctx; }};
