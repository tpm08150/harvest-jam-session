/* ============ voices ============ */
/* Eight drum voices, synthesised. No samples anywhere in this repo, and a kit built the
   same way as everything else costs nothing to ship and can be tuned rather than replaced.

   808-shaped rather than 808-cloned: a kick is a sine with a pitch envelope, a snare is
   two tones plus filtered noise, and the metal voices are six square oscillators at
   inharmonic ratios — which is how the original made a cymbal without a sample, and the
   only reason a hat sounds like metal instead of like filtered noise.

   Every voice takes the same shape: build nodes, schedule against an absolute time, stop
   at a known end, dispose. Nothing is pooled. A drum voice is a few nodes for a few
   hundred milliseconds, and pooling them would buy nothing but a class of bug where a
   retrigger inherits the last hit's envelope. */

let ctx = null, kit = null, comp = null, noiseBuf = null;
/* Per-voice output, and the gated-reverb chain hanging off it. Objects rather than consts
   so the offline harness can swap the whole lot for a render and put them back — see
   renderHit(), which does the same for ctx and the kit bus. */
let VOUT = {}, VERB = {}, verbIR = null;

/* The 808's metal oscillator ratios. Inharmonic on purpose — any harmonic set rings as a
   pitch, and a cymbal must not have one. */
const METAL = [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637];

/* Per-voice trim, in dB, applied on top of the level control.

   MEASURED, not dialled. Each voice is rendered offline and trimmed to hit its target;
   the numbers below came out of __dr1.measure(). This is the discipline MS·1's twenty
   patches have and CS·1's twelve voices do not — CS·1 carries a measured 8.2 dB spread
   because it had no offline rig until Phase 3. A drum kit is the worst possible place to
   dial by ear, because a hat and a kick share no frequency range to compare in. */
const TRIM = {
  bd: -9.95, sd:  1.79, cp:  6.02, lt: -11.55,
  ht: -10.59, ch: 14.37, oh:  6.29, rs:   0.34
};

/* Relative balance the kit is trimmed TO, in dB against the kick. A kit is not eight
   equal sounds — a closed hat sitting at a kick's level is a kit nobody can play over.
   These are the ratios; TARGET_BD is the absolute the whole kit hangs from. */
const BALANCE = {bd: 0, sd: -3, cp: -5, lt: -4, ht: -4.5, ch: -10, oh: -9, rs: -8};
const TARGET_BD = -20;                       // dBFS, see boot.js for how it is measured

const VOICES = {
  bd: {name: "BD", full: "Kick",      tune: 48,   decay: .42, level: .95},
  sd: {name: "SD", full: "Snare",     tune: 185,  decay: .19, level: .8},
  cp: {name: "CP", full: "Clap",      tune: 1000, decay: .22, level: .8},
  lt: {name: "LT", full: "Low tom",   tune: 92,   decay: .34, level: .8},
  ht: {name: "HT", full: "High tom",  tune: 175,  decay: .26, level: .8},
  ch: {name: "CH", full: "Closed hat",tune: 40.5, decay: .045,level: .7},
  oh: {name: "OH", full: "Open hat",  tune: 40.5, decay: .38, level: .7},
  rs: {name: "RS", full: "Rimshot",   tune: 1700, decay: .034,level: .75}
};
const ORDER = ["bd", "sd", "cp", "lt", "ht", "ch", "oh", "rs"];

/* live parameter state, one object per voice — the panel writes here */
const P = {};
/* verb 0 on every voice, deliberately: adding an effect must not change a kit anybody has
   already tuned or a pattern anybody has already saved. The measured trims above are still
   the trims, because a voice with no send renders exactly what it rendered before. */
ORDER.forEach(k => { P[k] = {tune: VOICES[k].tune, decay: VOICES[k].decay,
                             level: VOICES[k].level, tone: .5,
                             verb: 0, gate: .14}; });

const dbGain = db => Math.pow(10, db / 20);

function makeNoise(c){
  /* Two seconds is long enough that a loop is never audible on a hit lasting 400 ms, and
     each voice starts at its own offset anyway. */
  const len = Math.floor(c.sampleRate * 2);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function initAudio(useCtx){
  if (ctx) return;
  ctx = useCtx || Patchwork.audio.context();
  const out = useCtx ? ctx.destination : Patchwork.audio.strip("dr1");

  /* Light glue only. A kit bus that squashes is a mixing decision, and this one is here
     to stop eight simultaneous hits clipping the strip, not to make the kit pump. */
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 4;
  comp.attack.value = .003; comp.release.value = .12;

  kit = ctx.createGain();
  kit.gain.value = 1;
  kit.connect(comp); comp.connect(out);

  /* One output per voice, so the reverb has something to tap. The voices used to connect
     straight to the kit bus, and a send needs the voice on its own — a shared bus can only
     be sent as a whole, and a gate on a shared tail is a gate the kick closes for the
     snare. Unity gain, so the dry path is arithmetically what it was. */
  VOUT = {}; VERB = {}; verbIR = null;
  ORDER.forEach(id => {
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(kit);
    VOUT[id] = g;
  });

  noiseBuf = makeNoise(ctx);
}

/* ---- the gated reverb ----
   ⚠️ ONE CONVOLVER PER VOICE, and that is the whole reason this costs what it costs. The
   gate has to be AFTER the convolver — gating the send instead leaves the reverb ringing
   from what already went in, which is the opposite of gated, and TS·1's engine says the
   same thing for the same reason. A shared convolver's output is every voice's tail mixed
   together, so one gate on it would have the kick slamming the snare's tail shut.

   Built the first time a voice's Verb is turned up and never torn down. A kit with reverb
   on the snare alone pays for one convolver; nobody has ever wanted eight.

   The send is high-passed. A gated plate fed the bottom of a kick is mud, and every record
   this effect comes from filtered the send — it is part of the sound, not a safety rail. */
const VERB_HP = 180;        // Hz, off the send
const VERB_OPEN = .003;     // the gate's attack: enough not to click on a ringing tail
const VERB_SLAM = .012;     // and its close — the cut that makes it a gate rather than a tail

/* Long and slow on purpose: the GATE is what makes this short, so the impulse it chops has
   to still be going when the chop lands. A fast-decaying IR gated at 140 ms sounds like a
   small room ending early, which is the opposite of the effect — the point is a big room
   that stops. Seven hundred milliseconds covers the longest gate the fader offers. */
function makeVerbIR(c){
  const secs = .7, rate = c.sampleRate, n = Math.floor(secs * rate);
  const ir = c.createBuffer(2, n, rate);
  const build = Math.max(1, rate * .004);
  /* independently random per channel, which is the whole width of it */
  for (let ch = 0; ch < 2; ch++){
    const d = ir.getChannelData(ch);
    for (let i = 0; i < n; i++)
      d[i] = (Math.random() * 2 - 1) * Math.exp(-2.2 * (i / n)) * Math.min(1, i / build);
  }
  return ir;
}

function ensureVerb(id){
  if (VERB[id]) return VERB[id];
  if (!verbIR) verbIR = makeVerbIR(ctx);
  const send = ctx.createGain(); send.gain.value = 0;
  const hp = highpass(VERB_HP, .7);
  const conv = ctx.createConvolver(); conv.buffer = verbIR;
  const gate = ctx.createGain(); gate.gain.value = 0;
  VOUT[id].connect(send); send.connect(hp); hp.connect(conv);
  conv.connect(gate); gate.connect(kit);
  return (VERB[id] = {send, gate, env: null});
}

/* What the gate is worth at time t, from the envelope last scheduled on it.

   ⚠️ Worked out rather than read off the node. A hit is scheduled up to 200 ms ahead, and
   param.value is the value NOW — pinning that at a future time is the standard Web Audio
   way to put a step in your own signal. cancelScheduledValues() alone is no better: it
   drops a ramp that has not finished, and the value jumps back to where that ramp started.
   Retriggering inside the hold is normal drumming, so this has to be exact. */
function gateAt(e, t){
  if (!e) return 0;
  const d = t - e.t;
  if (d <= 0) return 0;
  if (d < VERB_OPEN) return d / VERB_OPEN;
  if (d < e.hold) return 1;
  if (d < e.hold + VERB_SLAM) return 1 - (d - e.hold) / VERB_SLAM;
  return 0;
}

/* Open the gate on the hit and slam it shut a fixed time later. The send level is scheduled
   at the hit rather than set live, so a per-step lock on Verb lands with the step that
   carries it instead of whenever the sequencer got round to it. */
function sendVerb(id, t, p){
  const amt = p.verb;
  if (!(amt > 0) && !VERB[id]) return;         // never used: build nothing
  const v = ensureVerb(id);
  v.send.gain.setValueAtTime(Math.max(0, Math.min(1, amt)), t);
  if (!(amt > 0)) return;                      // turned down: leave the gate wherever it is
  const hold = Math.max(VERB_OPEN + .005, p.gate);
  const g = v.gate.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(gateAt(v.env, t), t);
  g.linearRampToValueAtTime(1, t + VERB_OPEN);
  g.setValueAtTime(1, t + hold);
  g.linearRampToValueAtTime(0, t + hold + VERB_SLAM);
  v.env = {t, hold};
}

/* A noise source starting at a random offset, so repeated hits are not identical.
   Deliberately random per hit — the same choice MS·1 makes, and the reason its level
   harness is stochastic. See the handoff before measuring anything with this. */
function noise(t, dur){
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(t, Math.random() * (noiseBuf.duration - dur - .05));
  s.stop(t + dur + .05);
  return s;
}

/* An exponential fall from `peak` to silence. setTargetAtTime never actually reaches its
   target, so every voice ends with an explicit ramp to zero at a known time — otherwise
   a long-decay voice leaves a node running under everything that follows it. */
function decayTo(param, t, peak, dur){
  param.setValueAtTime(peak, t);
  param.setTargetAtTime(0, t, Math.max(.004, dur / 4));
  param.setValueAtTime(param.value, t + dur);
  param.linearRampToValueAtTime(0, t + dur + .012);
}

function bandpass(freq, q){
  const f = ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  return f;
}
function highpass(freq, q){
  const f = ctx.createBiquadFilter();
  f.type = "highpass"; f.frequency.value = freq; f.Q.value = q == null ? .7 : q;
  return f;
}

/* ---- the voices ----
   Each returns the time it finishes, so the scheduler knows when the node graph is free
   and the open hat knows how long it has to live before a closed hat chokes it. */

function hitKick(t, vel, p, out){
  const g = ctx.createGain(); g.gain.value = 0;
  const o = ctx.createOscillator(); o.type = "sine";
  /* The pitch envelope IS the kick. A sine at 48 Hz is a test tone; the same sine swept
     from 3.5x down to 48 Hz in 45 ms is a drum, and the sweep is what your ear reads as
     the beater. Tone stretches the sweep rather than raising the pitch, so the knob
     changes the character and not the note. */
  const top = p.tune * (2.4 + p.tone * 2.6);
  o.frequency.setValueAtTime(top, t);
  o.frequency.exponentialRampToValueAtTime(p.tune, t + .012 + p.tone * .05);
  decayTo(g.gain, t, vel, p.decay);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + p.decay + .05);

  /* the beater click, separate so Tone can move it without touching the body */
  const cg = ctx.createGain(); cg.gain.value = 0;
  const hp = highpass(1200);
  const n = noise(t, .01);
  decayTo(cg.gain, t, vel * .35 * p.tone, .008);
  n.connect(hp); hp.connect(cg); cg.connect(out);
  return t + p.decay + .06;
}

function hitSnare(t, vel, p, out){
  /* Two tones a fifth-ish apart plus noise: the tones are the drum, the noise is the
     snare wires, and Tone crossfades between them. A snare with no tone is a noise burst
     and a snare with no noise is a tom. */
  const bodyLvl = (1 - p.tone) * .9, noiseLvl = .35 + p.tone * .65;
  [1, 1.78].forEach((mult, i) => {
    const o = ctx.createOscillator(); o.type = "triangle";
    o.frequency.value = p.tune * mult;
    const g = ctx.createGain(); g.gain.value = 0;
    decayTo(g.gain, t, vel * bodyLvl * (i ? .6 : 1), p.decay * .55);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + p.decay + .05);
  });
  const n = noise(t, p.decay);
  const bp = bandpass(1750 + p.tone * 1800, 1.1);
  const hp = highpass(500);
  const g = ctx.createGain(); g.gain.value = 0;
  decayTo(g.gain, t, vel * noiseLvl, p.decay);
  n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
  return t + p.decay + .06;
}

function hitClap(t, vel, p, out){
  /* Three fast bursts and a tail. The bursts are the whole trick — a clap is several
     hands not quite together, and a single noise burst through the same filter reads as
     a short snare instead. 909 spacing, roughly 10 ms apart. */
  const bp = bandpass(p.tune, 1.5);
  const hp = highpass(600);
  bp.connect(hp);
  const g = ctx.createGain(); g.gain.value = 0;
  hp.connect(g); g.connect(out);
  const spread = .008 + p.tone * .012;
  [0, spread, spread * 2].forEach((off, i) => {
    const bg = ctx.createGain(); bg.gain.value = 0;
    const n = noise(t + off, .015);
    decayTo(bg.gain, t + off, vel * (1 - i * .18), .006);
    n.connect(bg); bg.connect(bp);
  });
  const tail = noise(t + spread * 2, p.decay);
  const tg = ctx.createGain(); tg.gain.value = 0;
  decayTo(tg.gain, t + spread * 2, vel * .5, p.decay);
  tail.connect(tg); tg.connect(bp);
  g.gain.value = 1;
  return t + spread * 2 + p.decay + .06;
}

function hitTom(t, vel, p, out){
  const o = ctx.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(p.tune * (1.5 + p.tone), t);
  o.frequency.exponentialRampToValueAtTime(p.tune, t + .05 + p.tone * .06);
  const g = ctx.createGain(); g.gain.value = 0;
  decayTo(g.gain, t, vel, p.decay);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + p.decay + .05);
  /* a little noise for the skin, or it is a sine and reads as a bass note */
  const n = noise(t, .03);
  const ng = ctx.createGain(); ng.gain.value = 0;
  const bp = bandpass(p.tune * 4, .9);
  decayTo(ng.gain, t, vel * .22, .025);
  n.connect(bp); bp.connect(ng); ng.connect(out);
  return t + p.decay + .06;
}

/* Both hats come from the same generator; the only difference is how long it lasts and
   whether a closed hat cuts it off. That is also true of the hardware. */
function metal(t, vel, p, dur, hpHz, out){
  const g = ctx.createGain(); g.gain.value = 0;
  const hp = highpass(hpHz, .8);
  const bp = bandpass(hpHz * 1.35, 1.1);
  hp.connect(bp); bp.connect(g); g.connect(out);
  const oscs = METAL.map(r => {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = p.tune * r;
    o.connect(hp);
    o.start(t); o.stop(t + dur + .05);
    return o;
  });
  decayTo(g.gain, t, vel * .5, dur);
  return {end: t + dur + .06, gain: g, oscs};
}

let openHat = null;                 // the sounding open hat, so a closed one can choke it

function hitClosedHat(t, vel, p, out){
  chokeOpenHat(t);
  return metal(t, vel, p, p.decay, 6500 + p.tone * 3500, out).end;
}
function hitOpenHat(t, vel, p, out){
  chokeOpenHat(t);
  const m = metal(t, vel, p, p.decay, 6000 + p.tone * 3500, out);
  openHat = m;
  return m.end;
}
/* A closed hat cuts an open one. Without this the two overlap into a wash that no drum
   machine has ever made, because they are one physical hi-hat. */
function chokeOpenHat(t){
  if (!openHat) return;
  const g = openHat.gain.gain;
  try{
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(.0001, g.value), t);
    g.linearRampToValueAtTime(0, t + .006);
    openHat.oscs.forEach(o => { try{ o.stop(t + .02); }catch(e){} });
  }catch(e){}
  openHat = null;
}

function hitRim(t, vel, p, out){
  /* Short, bright and pitched — a rimshot is a click with a note in it. */
  const o = ctx.createOscillator(); o.type = "triangle";
  o.frequency.value = p.tune;
  const o2 = ctx.createOscillator(); o2.type = "square";
  o2.frequency.value = p.tune * 1.47;
  const g = ctx.createGain(); g.gain.value = 0;
  const bp = bandpass(p.tune * 1.2, 2.2);
  o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(out);
  decayTo(g.gain, t, vel * .8, p.decay);
  o.start(t); o.stop(t + p.decay + .05);
  o2.start(t); o2.stop(t + p.decay + .05);
  return t + p.decay + .06;
}

const HITS = {bd: hitKick, sd: hitSnare, cp: hitClap, lt: hitTom, ht: hitTom,
              ch: hitClosedHat, oh: hitOpenHat, rs: hitRim};

/* The one place a voice is sounded. Both the engine and MIDI out go through fire(), so
   what you hear and what leaves the MIDI port cannot drift — the rule CS·1's
   chordEvents() and MS·1's stepEvent() already follow. */
function fire(id, t, vel){
  if (!ctx) return 0;
  const p = P[id];
  const g = Math.max(0, Math.min(1, vel)) * p.level * dbGain(TRIM[id] || 0);
  /* before the hit, so the gate is already open when the first sample reaches it */
  sendVerb(id, t, p);
  return HITS[id](t, g, p, VOUT[id] || kit);
}
