/* ============ audio ============ */
let ctx = null, master = null, comp = null, voiceBus = null, fxBus = null,
    chorusStage = null, chorusWet = null, delayNode = null, delayFb = null, delayWet = null,
    verb = null, verbWet = null, noiseBuf = {}, lfo = null, lfoGain = null, shSrc = null,
    analyser = null;
/* Modulation buses. A mono synth has one voice sounding, so these are global rather than
   per-voice: one LFO, one fade-in, one bend, summed once and read by every oscillator.
     pitchMod  cents -> the synth voice's oscillators   (LFO vibrato + its own bend)
     pitchVoc  cents -> the vocoder carrier's oscillators (same LFO, its own bend) —
               separate because on separate MIDI channels, bending the lead must not
               drag the vocoder chord with it
     filtMod   cents -> both biquads' .detune     (LFO -> cutoff)
     pwmBus    +-1   -> every pulse delay line    (its own LFO, independent of the main one)
     ampMod    0..1  -> the VCA's tremolo gain */
let pitchMod = null, pitchVoc = null, filtMod = null, pwmBus = null, pwmLfo = null,
    ampMod = null, lfoFade = null, bendSrc = null, bendVoc = null,
    lfoPitchG = null, lfoFiltG = null, lfoAmpG = null, chorusDry = null;
/* ---- vocoder ----
     vocBus   every carrier note sums here, PRE-filter: the bank does its own filtering,
              and running the carrier through the ladder first would eat the very bands
              the vocoder needs to reproduce
     modGain  the modulator (mic or line in) after its input trim
     vocBank  one {analysis, synthesis} pair per band, rebuilt when the count changes */
let vocBus = null, vocOut = null, modGain = null, modSrc = null, modStream = null,
    vocBank = [], sibGain = null, sibNoise = null, absCurve = null,
    modMeter = null, modMeterTimer = null, modPeakHold = 0, modPeakAt = 0,
    modComp = null, modMakeup = null, modPost = null, driveMeter = null;
const active = new Set();

/* MS1_UNITY is the linear gain one oscillator at full level reaches at the voice output
   when trim is 0. Set by measurement, not taste: CS·1's twelve voices average -30.1 dBFS
   for a single note and it sounds 3-4 at once, so a CS·1 chord lands near -24 dBFS. A mono
   synth has no chord to hide behind, so MS·1 aims a single note at that same -24 dBFS. */
const MS1_UNITY = 0.20;
/* Applied after the per-patch trim, so `trim` stays a pure timbre-compensation number and
   stays comparable between a bass and a lead. The pad's -6 is the "sits under CS·1"
   decision expressed once, in one place, rather than smeared into moss's own trim. */
const CAT_TRIM = {bass:+2, lead:0, key:0, stab:0, fx:0, pad:-6};

const db2lin = d => Math.pow(10, d/20);
const clampf = (v,lo,hi) => Math.min(hi, Math.max(lo, v));
const mtof = m => 440 * Math.pow(2, (m - 69)/12);

/* ---- the ladder, as two biquads ----
   A Moog ladder is H(s) = 1/((1 + s/wc)^4 + k). Factoring (1+s)^4 = -k gives two conjugate
   pole pairs, and two RBJ lowpass sections placed at those pairs reproduce it exactly.
   Driving the knob from Q1 rather than from k is what makes resonance feel even.

   BiquadFilterNode.Q is in DECIBELS for lowpass/highpass (alpha = sin w0 / (2 * 10^(Q/20))),
   which is why these are dB and why 40 dB is nowhere near a limit. */
function ladder(res){
  const Q1dB = -6.0206 + 46 * res;
  const Q1   = Math.pow(10, Q1dB/20);
  /* closed-form inverse, no bisection: u = 1 - a */
  const u    = Q1 <= 0.5 ? 1 : (Math.sqrt(4*Q1*Q1 - 1) - 1) / (4*Q1*Q1 - 2);
  const a    = 1 - u;
  const k    = 4 * a*a*a*a;
  const rho1 = Math.hypot(a - 1, a), rho2 = Math.hypot(1 + a, a);
  const Q2dB = 20 * Math.log10(rho2 / (2 * (1 + a)));
  return {Q1dB, Q2dB, rho1, rho2, k};
}
/* Web Audio's biquad normalises DC gain to unity; a real ladder does not. So the cascade
   hands you the bass-COMPENSATED filter for free and you have to attenuate to get the
   authentic thinning. rcomp 0 = true ladder (-13.8 dB of low end at full resonance),
   1 = flat DC (and +38.9 dB of peak, which clips). 0.30 measured back to within 0.5 dB
   of the filter-open level at full resonance. */
const RCOMP = 0.30;

/* tanh drive, gain-compensated — without the compensation "drive" is just a volume
   control and every driven patch's trim is wrong. */
function driveCurve(n, gain){
  const c = new Float32Array(n), g = Math.max(1e-6, gain);
  for (let i = 0; i < n; i++){
    const x = (i/(n-1))*2 - 1;
    c[i] = Math.tanh(g*x)/Math.tanh(g);
  }
  return c;
}

function makeIR(seconds, decay){
  const rate = ctx.sampleRate, len = Math.floor(rate*seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++){
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++){
      const t = i/len;
      d[i] = (Math.random()*2-1) * Math.pow(1-t, decay) * (1 - Math.exp(-i/400));
    }
  }
  return buf;
}
function makeNoise(kind){
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === "pink"){
    /* Paul Kellet's economical pink filter — cheaper than an FFT and flat enough */
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < len; i++){
      const w = Math.random()*2-1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
      b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random()*2-1;
  }
  return buf;
}
/* Sample & hold as a looping buffer of held random values: each value repeated over a
   block, so playbackRate sets the rate. An OscillatorNode cannot make this shape. */
function makeSH(){
  const steps = 64, per = 2048;
  const buf = ctx.createBuffer(1, steps*per, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let s = 0; s < steps; s++){
    const v = Math.random()*2-1;
    for (let i = 0; i < per; i++) d[s*per + i] = v;
  }
  return {buf, hz: ctx.sampleRate/per};       // rate at playbackRate 1
}

function initAudio(useCtx){
  if (ctx) return;
  /* useCtx lets the offline harness build THIS graph rather than a copy of it. CS·1's
     handoff is blunt about why that matters: a detector validated against nothing gave
     confident wrong answers, and a rig that reimplements the engine measures the rig. */
  ctx = useCtx || Patchwork.audio.context();
  const out = useCtx ? ctx.destination : Patchwork.audio.strip("ms1");

  master = ctx.createGain(); master.gain.value = 1;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3.5;
  comp.attack.value = .004; comp.release.value = .22;

  voiceBus = ctx.createGain();
  fxBus = ctx.createGain();

  /* ---- chorus: the single most 80s thing on the panel ----
     Two modulated delay lines around 3.2ms, phase-inverted L/R. The mode table is
     concrete so it can be checked from a rendered impulse rather than argued about. */
  chorusStage = ctx.createGain();
  chorusWet = ctx.createGain(); chorusWet.gain.value = 0;
  /* A BBD chorus adds a delayed copy, so dry+wet at unity makes switching it on a +3.5 dB
     jump. Blend instead: dry and wet are both scaled by 1/(1+wet) so the mode changes the
     WIDTH and not the level, and a patch's trim stays a timbre number. */
  chorusDry = ctx.createGain(); chorusDry.gain.value = 1;
  const chSplit = ctx.createGain();
  voiceBus.connect(chSplit);
  chSplit.connect(chorusDry); chorusDry.connect(fxBus);
  chorusStage.lines = [];
  for (let i = 0; i < 3; i++){
    const dly = ctx.createDelay(0.05);
    const lfoN = ctx.createOscillator(); lfoN.type = "sine";
    const depth = ctx.createGain();
    const pan = ctx.createStereoPanner();
    lfoN.connect(depth); depth.connect(dly.delayTime);
    chSplit.connect(dly); dly.connect(pan); pan.connect(chorusWet);
    lfoN.start();
    chorusStage.lines.push({dly, lfoN, depth, pan});
  }
  chorusWet.connect(fxBus);

  /* ---- delay: tempo-syncable, feedback hard-clamped ---- */
  delayNode = ctx.createDelay(2.5);
  delayFb = ctx.createGain(); delayFb.gain.value = 0;
  delayWet = ctx.createGain(); delayWet.gain.value = 0;
  const dlySend = ctx.createGain(); dlySend.gain.value = 1;
  fxBus.connect(dlySend); dlySend.connect(delayNode);
  delayNode.connect(delayFb); delayFb.connect(delayNode);      // the loop
  delayNode.connect(delayWet);
  delayWet.connect(comp);

  /* ---- reverb ----
     Lands on master, NOT on the compressor. Straight from CS·1's handoff: feeding the wet
     path into the compressor means more reverb only buys more gain reduction, and the
     tails pump in time with the notes. */
  verb = ctx.createConvolver(); verb.buffer = makeIR(2.4, 2.8);
  verbWet = ctx.createGain(); verbWet.gain.value = 0;
  fxBus.connect(verbWet); verbWet.connect(verb); verb.connect(master);

  fxBus.connect(comp);
  comp.connect(master);
  master.connect(out);

  /* peak meter — cheap, and the only way to know a patch is hot without guessing */
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  master.connect(analyser);

  noiseBuf.white = makeNoise("white");
  noiseBuf.pink  = makeNoise("pink");
  noiseBuf.sh    = makeSH();

  /* ---- vocoder buses ----
     vocOut lands on voiceBus, so the vocoder gets the chorus, delay and reverb the synth
     voice does — a chorused vocoder is most of the sound. */
  absCurve = mkAbsCurve(1025);
  vocBus = ctx.createGain(); vocBus.gain.value = 1;
  vocOut = ctx.createGain(); vocOut.gain.value = 0;
  modGain = ctx.createGain(); modGain.gain.value = 0;
  /* Tapped off the RAW input, before modGain and before the section's on/off — so the
     meter answers "is signal arriving?" independently of whether the vocoder is set up
     to use it. It only reads the signal; it never routes it to the output, so watching
     the meter cannot feed back. Straight out of CS·1's input-meter reasoning. */
  /* the bass goes straight to the compressor — no chorus, no delay, no reverb. A bass
     wants to stay dry and centred, and every send here is a way to smear it. */
  bassOut = ctx.createGain(); bassOut.gain.value = 1;
  bassOut.connect(comp);

  modMeter = ctx.createAnalyser();
  modMeter.fftSize = 1024;

  /* ---- modulator compression ----
     A band follower opens IN PROPORTION to the energy in its band, so without this the
     vocoder's whole output level tracks how loudly you happen to be speaking — and a quiet
     line input simply never opens the bands. That is what forces people to crank their
     preamp. Squashing the modulator first is what every hardware vocoder does, and it buys
     consistent intelligibility rather than just loudness.
     A compressor alone only holds peaks DOWN; bringing quiet material UP is the makeup
     gain, which is why the two are computed together in applyVocoder(). */
  modComp = ctx.createDynamicsCompressor();
  modComp.knee.value = 6;
  modComp.attack.value = .003;
  modComp.release.value = .10;
  modMakeup = ctx.createGain(); modMakeup.gain.value = 1;
  modPost = ctx.createGain(); modPost.gain.value = 1;
  modGain.connect(modComp); modComp.connect(modMakeup); modMakeup.connect(modPost);
  /* what actually reaches the band followers, so gain staging is visible not guessed */
  driveMeter = ctx.createAnalyser(); driveMeter.fftSize = 1024;
  modPost.connect(driveMeter);

  vocOut.connect(voiceBus);
  buildVocoder();
  buildSibilance();

  /* ---- modulation buses ---- */
  pitchMod = ctx.createGain(); pitchMod.gain.value = 1;
  pitchVoc = ctx.createGain(); pitchVoc.gain.value = 1;
  filtMod  = ctx.createGain(); filtMod.gain.value = 1;
  ampMod   = ctx.createGain(); ampMod.gain.value = 1;
  /* the LFO's fade-in, ramped from note-on. One voice sounds at a time, so one fade. */
  lfoFade  = ctx.createGain(); lfoFade.gain.value = 1;
  /* pitch bend, in cents, summed straight into the pitch bus */
  bendSrc  = ctx.createConstantSource(); bendSrc.offset.value = 0; bendSrc.start();
  bendSrc.connect(pitchMod);
  bendVoc  = ctx.createConstantSource(); bendVoc.offset.value = 0; bendVoc.start();
  bendVoc.connect(pitchVoc);
  /* PWM gets its own free-running triangle: a Juno's PWM is not the same LFO that does
     the vibrato, and sharing one makes every pulse patch wobble in pitch too. */
  pwmBus = ctx.createGain(); pwmBus.gain.value = 1;
  pwmLfo = ctx.createOscillator(); pwmLfo.type = "triangle";
  pwmLfo.frequency.value = P.pwmrate;
  pwmLfo.connect(pwmBus); pwmLfo.start();

  /* LFO destination depths. These hang off lfoFade rather than off the LFO source, so
     startLfo() can rebuild the source for a shape change without re-patching them. */
  lfoPitchG = ctx.createGain(); lfoPitchG.gain.value = P.lfop;          // cents
  lfoFade.connect(lfoPitchG); lfoPitchG.connect(pitchMod); lfoPitchG.connect(pitchVoc);
  lfoFiltG = ctx.createGain(); lfoFiltG.gain.value = P.lfof * 1200;     // cents
  lfoFade.connect(lfoFiltG); lfoFiltG.connect(filtMod);
  /* tremolo: ampMod sits at unity and the LFO adds +-lfoa around it */
  lfoAmpG = ctx.createGain(); lfoAmpG.gain.value = P.lfoa;
  lfoFade.connect(lfoAmpG); lfoAmpG.connect(ampMod.gain);
  ampMod.connect(voiceBus);

  startLfo();
  applyChorus();
  applyDelay();
  applySends();
  applyVocoder();
}

/* iOS parks the context in "suspended" until a gesture and in "interrupted" after a call
   or an app switch — so anything other than "running" needs a resume, not just "suspended". */
function ensureAudio(){
  initAudio();
  Patchwork.audio.resume();
  if (typeof ioStats === "function"){ ioStats(); setTimeout(ioStats, 400); }
  return ctx.state;
}

/* ---- global LFO ----
   One LFO shared by every unison member, which is correct for this instrument class.
   Rebuilt on a shape change because an OscillatorNode's type can change but a buffer
   source's cannot, and S&H is the one shape no oscillator can make. */
function startLfo(){
  if (!ctx) return;
  if (lfoGain) { try{ lfoGain.disconnect(); }catch(e){} }
  if (lfo){ try{ lfo.stop(); lfo.disconnect(); }catch(e){} lfo = null; }
  if (shSrc){ try{ shSrc.stop(); shSrc.disconnect(); }catch(e){} shSrc = null; }
  lfoGain = ctx.createGain(); lfoGain.gain.value = 1;
  if (lfoFade) lfoGain.connect(lfoFade);
  if (P.lfow === "sh"){
    shSrc = ctx.createBufferSource();
    shSrc.buffer = noiseBuf.sh.buf; shSrc.loop = true;
    shSrc.playbackRate.value = clampf(P.lfor / noiseBuf.sh.hz, .0001, 4);
    shSrc.connect(lfoGain); shSrc.start();
  } else {
    lfo = ctx.createOscillator();
    lfo.type = P.lfow === "sq" ? "square" : P.lfow === "saw" ? "sawtooth"
             : P.lfow === "sine" ? "sine" : "triangle";
    lfo.frequency.value = P.lfor;
    lfo.connect(lfoGain); lfo.start();
  }
}
function setLfoRate(hz){
  if (!ctx) return;
  const t = ctx.currentTime;
  if (shSrc) shSrc.playbackRate.setTargetAtTime(clampf(hz/noiseBuf.sh.hz, .0001, 4), t, .02);
  else if (lfo) lfo.frequency.setTargetAtTime(hz, t, .02);
}
/* Restarting the shared LFO on a new note is what `lfokey` means on a mono synth. */
function retriggerLfo(){ if (P.lfokey) startLfo(); }

/* ---- envelope ----
   Tracked analytically in JS as well as scheduled on the param, because `param.value` is
   useless for reading a running envelope (in an OfflineAudioContext it returns the value
   at time 0), and a retrigger has to start its ramp from where the envelope actually is
   or it steps and clicks. We scheduled it, so we know it. */
/* ORDER MATTERS at the call site: read this BEFORE setting e.tOff. Once tOff is set, the
   `t < e.tOff` test below is false at exactly t = tOff, so it takes the release branch and
   returns the OLD vOff — which is 0 on a note that has not been released yet. Setting tOff
   first therefore starts every release from silence, and the release control does nothing
   at all. Use beginRelease() rather than doing it by hand. */
function envValueAt(e, t){
  if (!e || t <= e.t0) return 0;
  if (e.tOff == null || t < e.tOff){
    const u = t - e.t0;
    return u < e.A ? (e.A <= 0 ? 1 : u/e.A)
                   : e.S + (1 - e.S) * Math.exp(-(u - e.A) / (e.D/6.9));
  }
  return e.vOff * Math.exp(-(t - e.tOff) / (e.R/6.9));
}
/* attack is linear so it TERMINATES at t+A — an RC attack never arrives and leaves the
   voice mid-ramp. decay and release are setTargetAtTime, i.e. a capacitor discharging;
   tau = time/6.9 is 99.9% complete at `time`, so the terminator step is under -60 dB.
   Never exponentialRampToValueAtTime(0, ...) — that is illegal and throws. */
function schedEnv(param, e, t, v0){
  param.cancelScheduledValues(t);
  param.setValueAtTime(v0, t);
  param.linearRampToValueAtTime(1, t + e.A);
  param.setTargetAtTime(e.S, t + e.A, e.D/6.9);
  param.setValueAtTime(e.S, t + e.A + e.D);
}
/* Amp release floor. Below this a note-off is an abrupt amplitude step, which splatters
   broadband energy even though no individual sample jumps far — the click is the ENVELOPE's
   abruptness, not a discontinuity, which is why a max-sample-step metric shows nothing here.
   Measured on a 110 Hz sine with the filter open, so any HF at the release IS the click:
   energy falls about 6 dB per doubling of release time, and 0.5 ms -> 10 ms is a 23.7 dB
   reduction. Attack has no floor: a fast attack from silence is a legitimate transient. */
const AMP_REL_MIN = .01;

/* Capture where the envelope actually is, THEN mark it released. */
function beginRelease(e, t){
  e.vOff = envValueAt(e, t);
  e.tOff = t;
  return e.vOff;
}
function schedRelease(param, e, t){
  param.cancelScheduledValues(t);
  param.setValueAtTime(e.vOff, t);
  param.setTargetAtTime(0, t, e.R/6.9);
  param.setValueAtTime(0, t + 2*e.R);
}

/* ---- one unison member ----
   A pulse is built as saw(t) - saw(t - w/f) from ONE oscillator, so both copies share the
   same band-limiting and the difference adds no aliasing at all. Measured against a
   sawtooth + DC + waveshaper: 40-64 dB less alias energy, and exactly zero DC at every
   width, which the waveshaper construction cannot manage without a correction network.
   The price is that delayTime has to track w/f, and MUST be ramped exponentially during
   glide — a linear ramp wanders the width by ~19% and collapses the tone toward a square. */
function mkStack(voice, det, panPos, f0){
  /* a carrier reads the vocoder's pitch bus, the synth voice reads its own */
  const pbus = voice.voc ? pitchVoc : pitchMod;
  const out = ctx.createGain(); out.gain.value = 1;
  const pan = ctx.createStereoPanner();
  pan.pan.value = panPos;
  out.connect(pan);
  const parts = [];

  /* `key` tags the part so applyParam() can find it later. The node is built even at
     level 0 — a gain of zero is silent but PRESENT, which is what lets the level knob move
     under a sounding note instead of waiting for the next one. Only "off" is structural. */
  function osc(wave, oct, semi, cents, lvl, isSub, key){
    if (wave === "off") return null;
    const detune = cents + det;
    const ratio = Math.pow(2, oct + semi/12);
    const g = ctx.createGain(); g.gain.value = lvl;
    g.connect(out);
    const o = ctx.createOscillator();
    o.type = wave === "pulse" ? "sawtooth" : wave === "tri" ? "triangle"
           : wave === "sine" ? "sine" : "sawtooth";
    o.frequency.value = f0 * ratio;
    o.detune.value = detune;
    /* detune is an a-rate param and connections SUM with its value, so vibrato and bend
       ride on top of the fixed per-oscillator detune without overwriting it */
    pbus.connect(o.detune);
    const rec = {o, g, ratio, detune, wave, isSub:!!isSub, pbus, key, oct, semi, cents};
    if (wave === "pulse"){
      /* saw - delayed saw */
      const sum = ctx.createGain(); sum.gain.value = .5;
      const dly = ctx.createDelay(0.5);
      const inv = ctx.createGain(); inv.gain.value = -1;
      o.connect(sum); o.connect(dly); dly.connect(inv); inv.connect(sum);
      sum.connect(g);
      dly.delayTime.value = clampf(P.pw / (f0*ratio), 1/ctx.sampleRate, .5);
      /* PWM rides the same delay line; its depth scales by 1/f exactly as the base does */
      const pwmDepth = ctx.createGain();
      pwmDepth.gain.value = P.pwm / (f0*ratio);
      pwmBus.connect(pwmDepth); pwmDepth.connect(dly.delayTime);
      rec.dly = dly; rec.pwmDepth = pwmDepth;
    } else {
      o.connect(g);
    }
    o.start(voice.t0);
    parts.push(rec);
    return rec;
  }

  const r1 = osc(P.o1w, P.o1oct, P.o1semi, P.o1det, P.o1lvl * MS1_UNITY, false, "o1");
  const r2 = osc(P.o2w, P.o2oct, P.o2semi, P.o2det, P.o2lvl * MS1_UNITY, false, "o2");

  /* ---- cross modulation ----
     FM: osc 2 drives osc 1's frequency. `frequency` is a-rate and connections sum with
     its value, so the depth gain is a peak deviation in Hz and has to be re-scaled
     whenever the pitch moves (see setPitch below). Negative frequency is legal in Web
     Audio and simply runs the phase backwards, which is what keeps this stable at depth. */
  if (r2 && r1){
    const fmDepth = ctx.createGain();
    fmDepth.gain.value = P.fm * 6 * (f0 * r1.ratio);   // 0 when FM is off, but present
    r2.o.connect(fmDepth); fmDepth.connect(r1.o.frequency);
    r1.fmDepth = fmDepth;
  }
  /* Ring: osc 1 through a GainNode whose gain is driven by osc 2. The gain param goes
     bipolar, which is true ring modulation with the carrier suppressed — not AM. */
  if (r2 && r1){
    const ringG = ctx.createGain(); ringG.gain.value = 0;
    const ringOut = ctx.createGain(); ringOut.gain.value = P.ring;
    r1.g.disconnect();
    const dry = ctx.createGain(); dry.gain.value = 1 - P.ring;
    r1.g.connect(dry); dry.connect(out);
    r1.g.connect(ringG); r2.o.connect(ringG.gain);
    ringG.connect(ringOut); ringOut.connect(out);
    r1.ringDry = dry; r1.ringOut = ringOut;           // so the Ring knob can crossfade live
  }
  {
    const sub = P.subw;
    const subOct = (sub === "sq2" || sub === "sin2") ? -2 : -1;
    const subWave = (sub === "sin1" || sub === "sin2") ? "sine" : "pulse";
    osc(subWave, subOct, 0, 0, P.sublvl * MS1_UNITY, true, "sub");
  }
  {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf[P.noisew] || noiseBuf.white; n.loop = true;
    const g = ctx.createGain(); g.gain.value = P.noiselvl * MS1_UNITY * .6;
    n.connect(g); g.connect(out);
    /* random start offset so unison members are decorrelated rather than one loud noise */
    n.start(voice.t0, Math.random() * (n.buffer.duration - .05));
    parts.push({n, g, noise:true, key:"noise"});
  }

  const LVL = () => ({o1:P.o1lvl*MS1_UNITY, o2:P.o2lvl*MS1_UNITY,
                     sub:P.sublvl*MS1_UNITY, noise:P.noiselvl*MS1_UNITY*.6});
  const RATIO = k => k === "o1" ? Math.pow(2, P.o1oct + P.o1semi/12)
                   : k === "o2" ? Math.pow(2, P.o2oct + P.o2semi/12)
                   : k === "sub" ? Math.pow(2, ((P.subw === "sq2" || P.subw === "sin2") ? -2 : -1))
                   : 1;
  const CENTS = k => k === "o1" ? P.o1det : k === "o2" ? P.o2det : 0;

  return {out, pan, parts, det, curF:f0,
    /* Everything below moves under a sounding note. CS·1's whole fader design is built on
       that and MS·1 fell short of it: half the panel used to wait for the next note. */
    setLevels(t){
      const L = LVL();
      parts.forEach(p => { if (p.key && L[p.key] != null)
        p.g.gain.setTargetAtTime(L[p.key], t, .02); });
    },
    setDrift(t, newDet, newPan){
      this.det = newDet;
      pan.pan.setTargetAtTime(newPan, t, .02);
      parts.forEach(p => { if (!p.o) return;
        p.detune = CENTS(p.key) + newDet;
        p.o.detune.setTargetAtTime(p.detune, t, .02); });
    },
    setTuning(t){
      parts.forEach(p => { if (!p.o || !p.key) return;
        p.ratio = RATIO(p.key);
        p.detune = CENTS(p.key) + this.det;
        p.o.detune.setTargetAtTime(p.detune, t, .02);
      });
      this.setPitch(t, this.curF, 0);
    },
    setCross(t){
      parts.forEach(p => {
        if (p.fmDepth) p.fmDepth.gain.setTargetAtTime(P.fm * 6 * this.curF * p.ratio, t, .02);
        if (p.ringDry){
          p.ringDry.gain.setTargetAtTime(1 - P.ring, t, .02);
          p.ringOut.gain.setTargetAtTime(P.ring, t, .02);
        }
      });
    },
    setPitch(t, f, glideT){
      this.curF = f;
      parts.forEach(p => {
        if (!p.o) return;
        const target = f * p.ratio;
        if (glideT > 0){
          p.o.frequency.cancelScheduledValues(t);
          p.o.frequency.setValueAtTime(Math.max(1e-4, p.o.frequency.value), t);
          p.o.frequency.exponentialRampToValueAtTime(Math.max(1e-4, target), t + glideT);
        } else {
          p.o.frequency.setValueAtTime(target, t);
        }
        if (p.fmDepth){
          const dep = P.fm * 6 * target;
          if (glideT > 0){
            p.fmDepth.gain.cancelScheduledValues(t);
            p.fmDepth.gain.setValueAtTime(p.fmDepth.gain.value, t);
            p.fmDepth.gain.linearRampToValueAtTime(dep, t + glideT);
          } else p.fmDepth.gain.setValueAtTime(dep, t);
        }
        if (p.dly){
          const w = clampf(P.pw / target, 1/ctx.sampleRate, .5);
          if (glideT > 0){
            p.dly.delayTime.cancelScheduledValues(t);
            p.dly.delayTime.setValueAtTime(Math.max(1e-6, p.dly.delayTime.value), t);
            /* exponential, never linear — see the comment above mkStack */
            p.dly.delayTime.exponentialRampToValueAtTime(w, t + glideT);
            p.pwmDepth.gain.exponentialRampToValueAtTime(
              Math.max(1e-9, P.pwm/target || 1e-9), t + glideT);
          } else {
            p.dly.delayTime.setValueAtTime(w, t);
            p.pwmDepth.gain.setValueAtTime(Math.max(1e-9, P.pwm/target || 1e-9), t);
          }
        }
      });
    },
    stop(t){
      parts.forEach(p => {
        try{ if (p.o) p.o.stop(t); if (p.n) p.n.stop(t); }catch(e){}
      });
    }};
}

/* ---- the voice ----
   One voice at a time; unison stacks live inside it. Held together as an object so a
   legato note can re-pitch it without touching either envelope, which is the whole point
   of legato and the difference between a slide and a retrigger. */
function buildVoice(midi, vel, t){
  const uni = P.mode === "uni" ? clampf(P.uni|0, 2, 7) : 1;
  const f0 = mtof(midi);

  const v = {t0:t, midi, vel, uni, stacks:[], released:false};

  /* oscillator sum -> drive -> filter cascade -> resonance trim -> HPF -> VCA */
  const oscSum = ctx.createGain();
  /* unison members sum coherently at small detune, so 1/sqrt(n) is the right law; the
     residual 1-2 dB at n=4..5 lives in the patch's own trim */
  oscSum.gain.value = 1 / Math.sqrt(uni);

  for (let i = 0; i < uni; i++){
    /* symmetric spread: for n=3 that is -d, 0, +d rather than 0, d, 2d */
    const k = uni === 1 ? 0 : (i/(uni-1)) * 2 - 1;
    const det = k * (P.unidet/2);
    const pan = uni === 1 ? 0 : k * P.unispread;
    /* mkStack already wires out -> pan, so only pan reaches the sum */
    const st = mkStack(v, det, pan, f0);
    st.pan.connect(oscSum);
    v.stacks.push(st);
  }

  const shaper = ctx.createWaveShaper();
  const driveG = Math.max(1, db2lin(P.fdrive));
  shaper.curve = driveCurve(2048, driveG);
  shaper.oversample = "4x";
  const driveTrim = ctx.createGain();
  /* the tanh curve is already normalised to unity peak, so this only restores the
     loudness the soft-clipping took out rather than doubling the drive */
  driveTrim.gain.value = db2lin(-0.6 * P.fdrive) * (P.fdrive > 0 ? driveG : 1);

  const L = ladder(clampf(P.fres/20, 0, 1));
  const biq1 = ctx.createBiquadFilter(); biq1.type = "lowpass";
  const biq2 = ctx.createBiquadFilter(); biq2.type = "lowpass";
  biq1.Q.value = L.Q1dB; biq2.Q.value = L.Q2dB;
  const resGain = ctx.createGain();
  resGain.gain.value = Math.pow(1 + L.k, RCOMP - 1);

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass"; hpf.frequency.value = clampf(P.fhpf, 20, 600); hpf.Q.value = 0.7;

  const vca = ctx.createGain(); vca.gain.value = 0;

  oscSum.connect(shaper); shaper.connect(driveTrim); driveTrim.connect(biq1);
  biq1.connect(biq2); biq2.connect(resGain); resGain.connect(hpf);
  hpf.connect(vca); vca.connect(ampMod);

  /* base cutoff: everything that does NOT change during the note is folded into the
     frequency, and only the envelope and the LFO ride the a-rate detune input, in cents.
     Multiplicative, not +Hz — an octave of envelope has to mean an octave at every
     cutoff setting, and a filter envelope IS a capacitor discharging into a V/oct input. */
  v.setCutoff = function(t2, midiNow){
    const key = P.fkey * (midiNow - 60)/12;
    const vAmt = P.velf * (v.vel/127);
    const base = clampf(P.fcut * Math.pow(2, key + vAmt), 20, ctx.sampleRate*0.45/L.rho2);
    biq1.frequency.setTargetAtTime(base * L.rho1, t2, .01);
    biq2.frequency.setTargetAtTime(base * L.rho2, t2, .01);
  };
  v.setCutoff(t, midi);

  /* filter envelope, as a cents signal */
  const fltEG = ctx.createConstantSource(); fltEG.offset.value = 0; fltEG.start(t);
  const fltAmt = ctx.createGain(); fltAmt.gain.value = P.fenv * 1200;   // bipolar, in cents
  fltEG.connect(fltAmt); fltAmt.connect(filtMod);
  filtMod.connect(biq1.detune); filtMod.connect(biq2.detune);

  /* amp envelope */
  const ampEG = ctx.createConstantSource(); ampEG.offset.value = 0; ampEG.start(t);
  const peak = ctx.createGain();
  const velGain = 1 - P.vela + P.vela * (vel/127);
  peak.gain.value = velGain * db2lin(P.trim + (CAT_TRIM[P.cat] || 0));
  ampEG.connect(peak); peak.connect(vca.gain);

  v.fltEG = fltEG; v.ampEG = ampEG; v.vca = vca; v.peak = peak;
  v.fltAmt = fltAmt; v.oscSum = oscSum; v.biq1 = biq1; v.biq2 = biq2;
  v.shaper = shaper; v.driveTrim = driveTrim; v.hpf = hpf;
  v.nodes = [oscSum, shaper, driveTrim, biq1, biq2, resGain, hpf, vca, peak, fltAmt];

  v.aEnv = {A:Math.max(.0005, P.aa), D:Math.max(.005, P.ad), S:clampf(P.as,0,1),
            R:Math.max(AMP_REL_MIN, P.ar), t0:t, tOff:null, vOff:0};
  v.fEnv = {A:Math.max(.0005, P.fa), D:Math.max(.005, P.fd), S:clampf(P.fs,0,1),
            R:Math.max(.0005, P.fr), t0:t, tOff:null, vOff:0};

  schedEnv(ampEG.offset, v.aEnv, t, 0);
  schedEnv(fltEG.offset, v.fEnv, t, 0);

  v.setPitch = function(t2, m, glideT){
    v.midi = m;
    const f = mtof(m);
    v.stacks.forEach(st => st.setPitch(t2, f, glideT));
    v.setCutoff(t2, m);
  };

  /* Retrigger without a click: start the ramp from where the envelope ACTUALLY is.
     cancelAndHoldAtTime + linearRamp drops to zero in Chrome, and param.value cannot be
     read back reliably, so the value comes from the analytic model instead. */
  v.retrigger = function(t2, m, vel2, glideT){
    v.setPitch(t2, m, glideT);
    v.vel = vel2;
    v.peak.gain.setTargetAtTime((1 - P.vela + P.vela*(vel2/127))
      * db2lin(P.trim + (CAT_TRIM[P.cat] || 0)), t2, .005);
    const a0 = envValueAt(v.aEnv, t2), f0v = envValueAt(v.fEnv, t2);
    v.aEnv.t0 = t2; v.aEnv.tOff = null;
    v.fEnv.t0 = t2; v.fEnv.tOff = null;
    schedEnv(v.ampEG.offset, v.aEnv, t2, a0);
    schedEnv(v.fltEG.offset, v.fEnv, t2, f0v);
  };

  v.release = function(t2){
    if (v.released) return;
    v.released = true;
    /* read the release times NOW rather than trusting what they were at note-on, so
       turning the knob while a note is held affects that note's release */
    v.aEnv.R = Math.max(AMP_REL_MIN, P.ar);
    v.fEnv.R = Math.max(AMP_REL_MIN, P.fr);
    beginRelease(v.aEnv, t2);
    beginRelease(v.fEnv, t2);
    schedRelease(v.ampEG.offset, v.aEnv, t2);
    schedRelease(v.fltEG.offset, v.fEnv, t2);
    /* release is -80 dB of the sustain level at 2R, so that is when the voice is free */
    const end = t2 + 2*v.aEnv.R + .05;
    v.stacks.forEach(st => st.stop(end));
    try{ fltEG.stop(end); ampEG.stop(end); }catch(e){}
    setTimeout(() => v.dispose(), Math.max(60, (end - ctx.currentTime)*1000 + 120));
  };

  v.dispose = function(){
    active.delete(v);
    try{ filtMod.disconnect(biq1.detune); filtMod.disconnect(biq2.detune); }catch(e){}
    v.stacks.forEach(st => { try{ st.pan.disconnect(); st.out.disconnect(); }catch(e){}
      st.parts.forEach(p => { try{ if(p.pwmDepth) pwmBus.disconnect(p.pwmDepth); }catch(e){}
                              try{ if(p.o) (p.pbus||pitchMod).disconnect(p.o.detune); }catch(e){} }); });
    v.nodes.forEach(n => { try{ n.disconnect(); }catch(e){} });
  };

  active.add(v);
  return v;
}

