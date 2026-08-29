
/* ============ engine ============ */
/* The bass voice, lifted from MS·1's bass section. A Taurus-shaped pedal synth: one
   oscillator with a square sub an octave below, a ladder, and a single Decay knob shaping
   filter contour and release together. Monophonic with lowest-note priority, and dry by
   design — no chorus, delay or reverb, because a bass wants to stay dry and centred.

   As its own instrument it gains the one thing it never had inside MS·1: a sequencer. The
   old notes were explicit that "the sequencer and arpeggiator drive the synth section
   only", which was a reasonable limit for a section and a poor one for an instrument. */

const V = Patchwork.voice;
const {clampf, mtof, ladder, RCOMP, schedEnv, schedRelease, beginRelease,
       envValueAt, AMP_REL_MIN} = V;

let ctx = null, out = null, bassOut = null, comp = null;

/* One flat object IS the patch — MS·1's rule, and for the same reason: a patch that omits
   a parameter must RESET it, not inherit whatever was dialled in before the load. */
const DEFAULT = {
  wave:"saw", oct:-1, level:.85, sub:.6,
  cut:420, res:5, env:2.4, dec:.35, glide:0, tone:.5
};
const P = Object.assign({}, DEFAULT);

const UNITY = 0.27;          // measured trim, as in MS·1

function initAudio(useCtx){
  if (ctx) return;
  ctx = useCtx || Patchwork.audio.context();
  out = useCtx ? ctx.destination : Patchwork.audio.strip("bs1");
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = .005; comp.release.value = .2;
  bassOut = ctx.createGain(); bassOut.gain.value = 1;
  bassOut.connect(comp); comp.connect(out);
}
function ensureAudio(){
  initAudio();
  Patchwork.audio.resume();
  return ctx.state;
}

function buildVoice(midi, vel, t){
  const v = {t0:t, midi, released:false};
  const f0 = mtof(midi) * Math.pow(2, P.oct);
  const mix = ctx.createGain(); mix.gain.value = 1;

  const o = ctx.createOscillator();
  o.type = P.wave === "square" ? "square" : "sawtooth";
  o.frequency.value = f0;
  const og = ctx.createGain(); og.gain.value = UNITY;
  o.connect(og); og.connect(mix); o.start(t);

  const sub = ctx.createOscillator();
  sub.type = "square"; sub.frequency.value = f0 / 2;
  const sg = ctx.createGain(); sg.gain.value = UNITY * P.sub;
  sub.connect(sg); sg.connect(mix); sub.start(t);

  const L = ladder(clampf(P.res / 20, 0, 1));
  const b1 = ctx.createBiquadFilter(); b1.type = "lowpass"; b1.Q.value = L.Q1dB;
  const b2 = ctx.createBiquadFilter(); b2.type = "lowpass"; b2.Q.value = L.Q2dB;
  const rg = ctx.createGain(); rg.gain.value = Math.pow(1 + L.k, RCOMP - 1);
  const vca = ctx.createGain(); vca.gain.value = 0;
  mix.connect(b1); b1.connect(b2); b2.connect(rg); rg.connect(vca); vca.connect(bassOut);

  v.setCutoff = function(t2){
    const base = clampf(P.cut, 20, ctx.sampleRate * 0.45 / L.rho2);
    b1.frequency.setTargetAtTime(base * L.rho1, t2, .01);
    b2.frequency.setTargetAtTime(base * L.rho2, t2, .01);
  };
  v.setCutoff(t);

  /* contour -> cutoff, in cents */
  const fEG = ctx.createConstantSource(); fEG.offset.value = 0; fEG.start(t);
  const fAmt = ctx.createGain(); fAmt.gain.value = P.env * 1200;
  fEG.connect(fAmt); fAmt.connect(b1.detune); fAmt.connect(b2.detune);

  const aEG = ctx.createConstantSource(); aEG.offset.value = 0; aEG.start(t);
  const pk = ctx.createGain();
  pk.gain.value = P.level * (0.7 + 0.3 * (vel / 127));
  aEG.connect(pk); pk.connect(vca.gain);

  /* One Decay knob drives both: the filter plucks down to a low sustain, the amp holds
     while the pedal is down and releases in proportion. That is the whole contour. */
  const fEnv = {A:.004, D:Math.max(.01, P.dec), S:.12,
                R:Math.max(.03, P.dec * .6), t0:t, tOff:null, vOff:0};
  const aEnv = {A:.004, D:Math.max(.05, P.dec * 2), S:1,
                R:Math.max(AMP_REL_MIN, P.dec * .6), t0:t, tOff:null, vOff:0};
  schedEnv(fEG.offset, fEnv, t, 0);
  schedEnv(aEG.offset, aEnv, t, 0);

  v.o = o; v.sub = sub; v.og = og; v.sg = sg; v.pk = pk; v.fAmt = fAmt;
  v.fEG = fEG; v.aEG = aEG; v.fEnv = fEnv; v.aEnv = aEnv;
  v.nodes = [mix, og, sg, b1, b2, rg, vca, pk, fAmt];

  v.setPitch = function(t2, m, glideT){
    v.midi = m;
    const f = mtof(m) * Math.pow(2, P.oct);
    if (glideT > 0){
      [[o, f], [sub, f / 2]].forEach(([node, target]) => {
        node.frequency.cancelScheduledValues(t2);
        node.frequency.setValueAtTime(Math.max(1e-4, node.frequency.value), t2);
        node.frequency.exponentialRampToValueAtTime(Math.max(1e-4, target), t2 + glideT);
      });
    } else { o.frequency.setValueAtTime(f, t2); sub.frequency.setValueAtTime(f / 2, t2); }
  };
  v.retrigger = function(t2, m, vel2, glideT){
    v.setPitch(t2, m, glideT);
    pk.gain.setTargetAtTime(P.level * (0.7 + 0.3 * (vel2 / 127)), t2, .005);
    const a0 = envValueAt(aEnv, t2), f0v = envValueAt(fEnv, t2);
    aEnv.t0 = t2; aEnv.tOff = null; fEnv.t0 = t2; fEnv.tOff = null;
    schedEnv(aEG.offset, aEnv, t2, a0);
    schedEnv(fEG.offset, fEnv, t2, f0v);
  };
  v.release = function(t2){
    if (v.released) return;
    v.released = true;
    /* release read AT release, not captured at note-on — turning Decay up while a pedal
       is held lengthens that note's tail, which is the rule every knob here follows */
    aEnv.R = Math.max(AMP_REL_MIN, P.dec * .6);
    fEnv.R = Math.max(.03, P.dec * .6);
    beginRelease(aEnv, t2); beginRelease(fEnv, t2);
    schedRelease(aEG.offset, aEnv, t2);
    schedRelease(fEG.offset, fEnv, t2);
    const end = t2 + 2 * aEnv.R + .05;
    try{ o.stop(end); sub.stop(end); fEG.stop(end); aEG.stop(end); }catch(e){}
    setTimeout(() => v.dispose(), Math.max(60, (end - ctx.currentTime) * 1000 + 120));
  };
  v.dispose = function(){
    active.delete(v);
    v.nodes.forEach(n => { try{ n.disconnect(); }catch(e){} });
  };
  active.add(v);
  return v;
}

/* ---- mono, lowest-note priority ----
   A pedalboard plays the lowest note you are standing on; anything else makes a two-foot
   chord sound like whichever pedal you happened to press last. */
const active = new Set();
const held = new Map();          // midi -> velocity
let cur = null;

function pick(){
  let lowest = null;
  held.forEach((vel, n) => { if (lowest === null || n < lowest) lowest = n; });
  return lowest;
}
function glideTime(from, to){
  if (!P.glide || from == null) return 0;
  return P.glide * Math.abs(to - from) / 12;
}

function noteOn(midi, vel, when){
  ensureAudio();
  const t = when == null ? ctx.currentTime + .003 : when;
  held.set(midi, vel);
  const n = pick();
  if (n == null) return;
  if (cur && !cur.released){
    cur.retrigger(t, n, held.get(n) || vel, glideTime(cur.midi, n));
  } else {
    cur = buildVoice(n, held.get(n) || vel, t);
  }
  paintNow();
}
function noteOff(midi, when){
  const t = when == null ? ctx.currentTime + .003 : when;
  held.delete(midi);
  const n = pick();
  if (n == null){
    if (cur){ cur.release(t); cur = null; }
  } else if (cur && !cur.released){
    cur.retrigger(t, n, held.get(n) || 100, glideTime(cur.midi, n));
  }
  paintNow();
}
function allNotesOff(){
  held.clear();
  const t = ctx ? ctx.currentTime : 0;
  if (cur){ cur.release(t); cur = null; }
  active.forEach(v => { try{ v.release(t); }catch(e){} });
  paintNow();
}

/* Live parameter moves, so every knob works under a sounding note — the rule MS·1 fell
   short of and then fixed, kept here from the start. */
function applyLive(){
  if (!ctx) return;
  const t = ctx.currentTime;
  active.forEach(v => {
    v.setCutoff(t);
    v.fAmt.gain.setTargetAtTime(P.env * 1200, t, .01);
    v.pk.gain.setTargetAtTime(P.level * .85, t, .01);
    v.sg.gain.setTargetAtTime(UNITY * P.sub, t, .01);
    /* Resonance is structural — it sets both biquads' Q at build time — so it is the one
       control here that waits for the next note. Everything else moves under a held pedal. */
  });
}
