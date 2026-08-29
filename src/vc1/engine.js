
/* ============ engine ============ */
/* A 16-band vocoder, lifted from MS·1's vocoder section, with a deliberately simple
   carrier of its own and the sequencer it never had.

   No AudioWorklet anywhere in here. The one thing that had to be proved is that a control
   signal can be built from audio and connected to a GainNode's gain: rectify the band with
   a WaveShaper, smooth it with two lowpasses, connect the result to gain.gain. Measured on
   a gated tone that gives 651:1 between open and closed, and a formant sweep transfers
   -5.8 dB at 700 Hz / +4.7 dB at 2400 Hz onto a saw carrier. That is a real vocoder. */

const V = Patchwork.voice;
const {clampf, mtof, schedEnv, schedRelease, beginRelease, envValueAt, AMP_REL_MIN} = V;

const VOC_LO = 150, VOC_HI = 5000;   // the span that carries intelligibility
const VOC_DRIVE = 9;                 // followers come out small; this is the makeup
/* Sixteen band gains summing, plus the unvoiced path, put the bus about 14 dB hotter than
   a plain synth voice — measured peaks of 1.7-1.8, i.e. clipping, on a realistic patch.
   This is the fixed trim that lands it on the same -24 dBFS target everything else is
   trimmed to. The Level control rides on top of it. */
const VOC_TRIM = 0.2;
const SIB_HZ = 3800;                 // above here is unvoiced, and unpitchable
const SIB_CARR_DRIVE = 14;
/* Carrier gain staging, MEASURED rather than guessed.

   MS·1's carrier came off its full voice stack, which carries per-patch trims and a
   unison divisor; VC·1's is a bare oscillator, and a bare oscillator at unity is far
   hotter. Running the identical synthetic modulator through both put VC·1 exactly
   23.07 dB above MS·1 — the same offset at two modulator levels, which is what a constant
   gain error looks like rather than a behavioural difference. This is that offset. */
const CARRIER_UNITY = 0.0702;

let ctx = null, out = null, carrierBus = null, vocOut = null,
    modGain = null, modComp = null, modMakeup = null, modPost = null,
    absCurve = null, noiseBuf = null, sibGain = null, sibNoise = null,
    modSrc = null, modStream = null, modMeter = null;
let bank = [];

const DEFAULT = {
  bands:16, q:4.5, resp:22, sib:.35, mix:.9, mod:1, comp:.75,
  carrier:.8, wave:"saw", attack:.02, release:.25, input:"__mic"
};
const P = Object.assign({}, DEFAULT);

const db2lin = db => Math.pow(10, db / 20);

/* MUST be an odd length. A WaveShaper maps input 0 to curve index (n-1)/2, and with an
   even n that index is fractional — so it interpolates between the two samples either side
   of zero and returns |±1/(n-1)| instead of 0. At n=1024 that is a permanent floor of
   9.8e-4, which after the follower's drive becomes about -37 dB of gate that never closes.
   Harmless for the voiced bands, since the carrier itself stops, but the unvoiced path has
   its own noise source and leaked audibly. */
function mkAbsCurve(n){
  const size = n % 2 ? n : n + 1;
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++){ const x = (i / (size - 1)) * 2 - 1; c[i] = Math.abs(x); }
  return c;
}
function bandFreq(i, n){ return VOC_LO * Math.pow(VOC_HI / VOC_LO, n < 2 ? 0 : i / (n - 1)); }

function initAudio(useCtx){
  if (ctx) return;
  ctx = useCtx || Patchwork.audio.context();
  out = useCtx ? ctx.destination : Patchwork.audio.strip("vc1");
  absCurve = mkAbsCurve(1025);
  noiseBuf = V.noiseBuffer(ctx, 2);

  carrierBus = ctx.createGain(); carrierBus.gain.value = 1;
  vocOut = ctx.createGain(); vocOut.gain.value = P.mix * VOC_TRIM;
  vocOut.connect(out);

  /* ---- the modulator chain ----
     Compression before the bank is what stops the vocoder needing a hot input: a band
     opens in proportion to its energy, so without it the whole output level tracks how
     loudly you speak. */
  modGain = ctx.createGain(); modGain.gain.value = P.mod;
  modComp = ctx.createDynamicsCompressor();
  modComp.knee.value = 6; modComp.attack.value = .003; modComp.release.value = .10;
  modMakeup = ctx.createGain(); modMakeup.gain.value = 1;
  modPost = ctx.createGain(); modPost.gain.value = 1;
  modGain.connect(modComp); modComp.connect(modMakeup); modMakeup.connect(modPost);
  modMeter = ctx.createAnalyser(); modMeter.fftSize = 1024;

  buildBank();
  buildSibilance();
  applyVocoder();
}
function ensureAudio(){ initAudio(); Patchwork.audio.resume(); return ctx.state; }

/* One band: analysis on the modulator, synthesis on the carrier, joined by the follower. */
function mkBand(f){
  const abp = ctx.createBiquadFilter(); abp.type = "bandpass";
  abp.frequency.value = f; abp.Q.value = P.q;
  const rect = ctx.createWaveShaper(); rect.curve = absCurve; rect.oversample = "2x";
  const lp1 = ctx.createBiquadFilter(); lp1.type = "lowpass"; lp1.frequency.value = P.resp; lp1.Q.value = .7;
  const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = P.resp; lp2.Q.value = .7;
  const drive = ctx.createGain(); drive.gain.value = VOC_DRIVE;
  modPost.connect(abp); abp.connect(rect); rect.connect(lp1); lp1.connect(lp2); lp2.connect(drive);

  const sbp = ctx.createBiquadFilter(); sbp.type = "bandpass";
  sbp.frequency.value = f; sbp.Q.value = P.q;
  /* gain starts CLOSED and is opened only by the follower — connections sum with the value */
  const g = ctx.createGain(); g.gain.value = 0;
  drive.connect(g.gain);
  carrierBus.connect(sbp); sbp.connect(g); g.connect(vocOut);
  return {abp, rect, lp1, lp2, drive, sbp, g, f};
}
function buildBank(){
  bank.forEach(b => [b.abp,b.rect,b.lp1,b.lp2,b.drive,b.sbp,b.g]
    .forEach(n => { try{ n.disconnect(); }catch(e){} }));
  bank = [];
  const n = P.bands | 0;
  for (let i = 0; i < n; i++) bank.push(mkBand(bandFreq(i, n)));
}

/* The unvoiced path. A pitched carrier physically cannot produce "s" or "t", so without
   this the vocoder is mush at the top and barely intelligible. */
function buildSibilance(){
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = SIB_HZ; hp.Q.value = .7;
  const rect = ctx.createWaveShaper(); rect.curve = absCurve; rect.oversample = "2x";
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 40;
  /* Measured: at the voiced bands' drive this gate ran far past unity, which both slammed
     the level (+19.7 dB at sibilance 0.35, peaking 2.35) and saturated the gate so it
     stopped tracking. Sibilance sits UNDER the voiced bands, not on top of them. */
  const drive = ctx.createGain(); drive.gain.value = VOC_DRIVE * 0.4;
  modPost.connect(hp); hp.connect(rect); rect.connect(lp); lp.connect(drive);

  sibNoise = ctx.createBufferSource();
  sibNoise.buffer = noiseBuf; sibNoise.loop = true;
  const nhp = ctx.createBiquadFilter(); nhp.type = "highpass"; nhp.frequency.value = SIB_HZ; nhp.Q.value = .7;
  const gate = ctx.createGain(); gate.gain.value = 0;
  drive.connect(gate.gain);

  /* A SECOND gate, from the carrier. The voiced bands are gated by the note for free,
     because the carrier is what flows through them; this path has its own noise source, so
     without an explicit gate it sings whenever the modulator has any HF in it, note or no
     note. Measured: the output sat at -28 dBFS after a note had fully released, where it
     should be silence. Following the carrier BUS rather than counting voices keeps it
     self-maintaining — right for one note, six notes, or a note in mid-release. */
  const carrAbs = ctx.createWaveShaper(); carrAbs.curve = absCurve; carrAbs.oversample = "2x";
  const cl1 = ctx.createBiquadFilter(); cl1.type = "lowpass"; cl1.frequency.value = 30; cl1.Q.value = .7;
  const cl2 = ctx.createBiquadFilter(); cl2.type = "lowpass"; cl2.frequency.value = 30; cl2.Q.value = .7;
  const cd = ctx.createGain(); cd.gain.value = SIB_CARR_DRIVE;
  carrierBus.connect(carrAbs); carrAbs.connect(cl1); cl1.connect(cl2); cl2.connect(cd);
  const carrGate = ctx.createGain(); carrGate.gain.value = 0;
  cd.connect(carrGate.gain);

  sibGain = ctx.createGain(); sibGain.gain.value = 0;
  sibNoise.connect(nhp); nhp.connect(gate); gate.connect(carrGate);
  carrGate.connect(sibGain); sibGain.connect(vocOut);
  sibNoise.start();
}

/* Q and response move under the sound; the band COUNT needs a rebuild. */
function applyVocoder(){
  if (!ctx || !vocOut) return;
  const t = ctx.currentTime;
  if (bank.length !== (P.bands | 0)) buildBank();
  bank.forEach(b => {
    b.abp.Q.setTargetAtTime(P.q, t, .02);
    b.sbp.Q.setTargetAtTime(P.q, t, .02);
    b.lp1.frequency.setTargetAtTime(P.resp, t, .02);
    b.lp2.frequency.setTargetAtTime(P.resp, t, .02);
  });
  modGain.gain.setTargetAtTime(P.mod, t, .02);
  /* Threshold sweeps down and ratio up together, so one knob reads as "how hard". Makeup
     restores what the compression took out: for a signal at 0 dBFS the reduction is
     |thr|*(1 - 1/ratio), which is exactly what quiet material needs lifting by. */
  const c = clampf(P.comp, 0, 1);
  const thr = -6 - 34 * c, ratio = 1.5 + 10.5 * c;
  modComp.threshold.setTargetAtTime(thr, t, .02);
  modComp.ratio.setTargetAtTime(ratio, t, .02);
  modMakeup.gain.setTargetAtTime(db2lin(Math.min(30, -thr * (1 - 1 / ratio))), t, .02);
  vocOut.gain.setTargetAtTime(P.mix * VOC_TRIM, t, .02);
  if (sibGain) sibGain.gain.setTargetAtTime(P.sib * 0.35, t, .02);
  carrierBus.gain.setTargetAtTime(P.carrier, t, .02);
}

/* ---- the carrier ----
   Deliberately simple: one oscillator and an amp envelope per note, summed into the shared
   bank. PARAPHONIC, which is the whole point — six notes cost the same as one, because the
   bank is downstream of the sum. A full synth voice per note would be six filter banks and
   would sound no more like a vocoder. */
const carriers = new Map();

function buildCarrier(midi, vel, t){
  const o = ctx.createOscillator();
  o.type = P.wave === "pulse" ? "square" : P.wave;
  o.frequency.value = mtof(midi);
  const g = ctx.createGain(); g.gain.value = 0;
  const trim = ctx.createGain(); trim.gain.value = CARRIER_UNITY;
  o.connect(g); g.connect(trim); trim.connect(carrierBus);
  o.start(t);
  const env = {A: Math.max(.002, P.attack), D: .3, S: 1,
               R: Math.max(AMP_REL_MIN, P.release), t0: t, tOff: null, vOff: 0};
  schedEnv(g.gain, env, t, 0);
  const c = {o, g, env, midi, released: false};
  c.release = function(t2){
    if (c.released) return;
    c.released = true;
    env.R = Math.max(AMP_REL_MIN, P.release);   // read at release, like everything else
    beginRelease(env, t2);
    schedRelease(g.gain, env, t2);
    const end = t2 + 2 * env.R + .05;
    try{ o.stop(end); }catch(e){}
    setTimeout(() => { try{ o.disconnect(); g.disconnect(); trim.disconnect(); }catch(e){} carriers.delete(midi); },
               Math.max(60, (end - ctx.currentTime) * 1000 + 120));
  };
  return c;
}

function noteOn(midi, vel, when){
  ensureAudio();
  const t = when == null ? ctx.currentTime + .003 : when;
  const old = carriers.get(midi);
  if (old) old.release(t);
  /* Six at a time. Past that the bank is being asked to resolve a cluster it cannot, and
     the result is a drone rather than a chord. */
  if (carriers.size >= 6){
    const first = carriers.keys().next().value;
    const c = carriers.get(first);
    if (c) c.release(t);
  }
  carriers.set(midi, buildCarrier(midi, vel, t));
  if (typeof paintNow === "function") paintNow();
}
function noteOff(midi, when){
  const t = when == null ? ctx.currentTime + .003 : when;
  const c = carriers.get(midi);
  if (c) c.release(t);
  if (typeof paintNow === "function") paintNow();
}
function allNotesOff(){
  const t = ctx ? ctx.currentTime : 0;
  carriers.forEach(c => { try{ c.release(t); }catch(e){} });
  if (typeof paintNow === "function") paintNow();
}

/* ---- the modulator input ---- */
async function openInput(deviceId){
  initAudio();
  if (deviceId === "__bus"){
    closeInput();
    /* Vocode the rest of the studio rather than a voice — the drums through the bank is a
       classic, and it needs no microphone. Excludes this instrument's own strip, so the
       bank cannot analyse its own output. */
    modSrc = Patchwork.audio.tap("vc1");
    modSrc.connect(modGain); modSrc.connect(modMeter);
    modStream = "__bus";
    say("Modulating with the <b>studio output</b> — hold notes to hear the other "
      + "instruments through the bank.");
    return true;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    say("This browser can't open an audio input.", true); return false;
  }
  closeInput();
  try{
    /* The three processing flags MUST be off: echo cancellation and noise suppression are
       built to remove exactly the signal a vocoder wants, and AGC pumps the band
       envelopes. */
    modStream = await navigator.mediaDevices.getUserMedia({audio:{
      deviceId: deviceId ? {exact: deviceId} : undefined,
      echoCancellation:false, noiseSuppression:false, autoGainControl:false
    }});
    modSrc = ctx.createMediaStreamSource(modStream);
    modSrc.connect(modGain); modSrc.connect(modMeter);
    say("Listening. Hold notes to sound them through your voice — <b>use headphones</b>, "
      + "a microphone into speakers will feed back.");
    return true;
  }catch(e){
    say("Couldn't open that input (" + ((e && e.name) || e) + ").", true);
    return false;
  }
}
function closeInput(){
  if (modSrc){ try{ modSrc.disconnect(); }catch(e){} modSrc = null; }
  if (modStream && modStream !== "__bus"){
    modStream.getTracks().forEach(t => { try{ t.stop(); }catch(e){} });
  }
  modStream = null;
}
