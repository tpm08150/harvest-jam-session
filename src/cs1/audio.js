/* ============ audio ============ */
let ctx = null, master = null, dry = null, wet = null, verb = null, comp = null, cutSrc = null;
const active = new Set();
/* Only a hair above zero — enough to keep the filter parameter positive, low enough that
   fully-closed really is silent. (It used to be 80Hz to protect the bass fundamental,
   which is exactly what stopped Tone from closing all the way.) */
const CUT_FLOOR = 6;
/* held pads run open-ended; this is just a safety stop so a stuck note can't ring forever */
const HOLD_MAX = 40;

/* Custom harmonic spectra — one oscillator carrying many partials, rather than stacking
   a sine per harmonic. Index is the harmonic number, value its amplitude. */
const PERIODIC_SPEC = {
  organ:  [0, 1, .5, .34, .26, 0, .17, 0, .11],        // drawbar-ish: 1,2,3,4,6,8
  hollow: [0, 1, 0, .42, 0, .24, 0, .15, 0, .09]       // odd harmonics only — clarinet-like
};
const STD_WAVES = ["sine","square","sawtooth","triangle"];
let periodic = {};

/* osc entries are [wave, semitones, gain, detuneCents?]; voice-level `filter` defaults to
   lowpass, and `cut` scales the shared Tone cutoff. */
const VOICES = {
  soft:  {oscs:[["triangle",0,.55],["sine",0,.45]],             cut:1.0, q:.6,  lvl:.16},
  reed:  {oscs:[["sawtooth",0,.4],["sawtooth",0,.4]],           cut:.82, q:1.1, lvl:.12},
  glass: {oscs:[["square",0,.22],["triangle",12,.2]],           cut:1.35,q:.8,  lvl:.13},
  bell:  {oscs:[["sine",0,.5],["sine",12,.22],["sine",19,.1]],  cut:1.5, q:.5,  lvl:.15},
  /* lvl on the new voices was set by measuring rendered RMS against the existing four —
     a bandpass or a detuned saw stack loses far more level than it looks like it should */
  /* three saws pulled apart in cents — the beating is the whole character */
  wire:  {oscs:[["sawtooth",0,.3,-13],["sawtooth",0,.3,13],["sawtooth",-12,.2,0]],
                                                                cut:1.15,q:.9,  lvl:.26},
  organ: {oscs:[["organ",0,.55],["organ",12,.14]],              cut:1.4, q:.4,  lvl:.155},
  /* bandpass instead of lowpass: hollow and focused rather than simply darker */
  wood:  {oscs:[["hollow",0,.6],["square",0,.13]],              cut:.95, q:2.4, lvl:.44,
          filter:"bandpass"},
  /* highpass thins the body out, leaving the upper partials */
  vapor: {oscs:[["triangle",12,.4],["sine",19,.24],["triangle",0,.22]],
                                                                cut:.35, q:.7,  lvl:.16,
          filter:"highpass"},

  /* --- big synth chords --- */
  /* the supersaw: four saws pulled ±19 cents apart, plus a sub for weight */
  neon:  {oscs:[["sawtooth",0,.24,-19],["sawtooth",0,.24,19],
                ["sawtooth",0,.20,-7],["sawtooth",-12,.18,7]], cut:1.3, q:.7,  lvl:.30},
  /* squares beating against each other, with a saw octave up for glass on top */
  chrome:{oscs:[["square",0,.26,-11],["square",0,.26,11],
                ["sawtooth",12,.12,0],["square",-12,.16,0]],    cut:1.55,q:.9,  lvl:.20},
  /* resonant and darker so the filter envelope reads as a brass swell */
  brass: {oscs:[["sawtooth",0,.34,-7],["sawtooth",0,.34,7],
                ["sawtooth",-12,.20,0]],                        cut:.75, q:2.0, lvl:.23},
  /* wide and shimmering — the octave-and-a-fifth partial is what makes it sound huge */
  halo:  {oscs:[["triangle",0,.30,-13],["triangle",0,.30,13],
                ["sine",19,.14,0],["triangle",-12,.20,0]],      cut:1.15,q:.5,  lvl:.22}
};

/* bassLvl .5 is unity — it reproduces the gain the bass had before it was adjustable */
/* tone .6755 solves to the same ~1965Hz the default has always had — re-derived each time
   the Tone range changes, so widening the fader never shifts the default patch */
const P = {tone:.6755, attack:.22, release:.42, bassSus:.7, bassLvl:.5, space:.42, spread:.4, level:.72};
const BASS_UNITY = .13;
const bassGain = () => BASS_UNITY * 2 * P.bassLvl;
/* frozen defaults: a patch that omits a parameter should reset it, not inherit
   whatever happened to be dialled in before the load */
const P_DEFAULT = Object.assign({}, P);
const state = {voice:"soft", motion:"hold", bpm:88, bpmExact:88, keyPc:0, prog:null, playing:false, bass:true};
/* Patches have carried three different shapes for this: a boolean, then the brief
   off/decay/sustain strings, now a boolean plus the Bass fader. Returns {on, sus},
   where sus is null when the patch didn't pin one. */
function normBass(v){
  if (v === "off" || v === false) return {on:false, sus:null};
  if (v === "sustain") return {on:true, sus:1};
  if (v === "decay") return {on:true, sus:.7};
  return {on:true, sus:null};
}
/* `ch` is the OUTPUT channel and never filtered anything coming IN — the app answered on
   every channel whatever this was set to. `inCh` is the input filter: -1 is omni, which is
   what the behaviour always effectively was, so the default changes nothing. */
const MIDI = {access:null, in:null, out:null, ch:0, inCh:-1, sync:"int", clockOn:true};
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.platform)
            || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
/* Shifts the transport's grid against incoming MIDI clock. Browser output latency puts
   audible notes behind the reference by a fixed amount, and nothing else compensates.
   `offsetMs` is that constant, dialled in by hand; the phase fields below are the
   time-varying part — following clock tempo alone lets position error integrate, because
   a tempo estimate that is 0.1% off is a tenth of a bar out after a hundred bars.
     pulse  counts 0xF8 since the last reset, so beat phase is pulse % 24
     err    smoothed phase error in SECONDS, positive = transport running ahead
     lock   whether that error is fed back into the grid, or only measured */
const SYNC = {offsetMs:0, lock:false, pulse:0, err:0, have:false, trim:0, hist:[]};
/* steps divide the bar, so 4/8/12/16 read as quarters, eighths, triplets, sixteenths */
const PULSE = {steps:8, on:[1,0,1,1,0,1,1,0]};
/* default is a single hit on the downbeat — i.e. the original one-note-per-bar bass */
const BASSQ = {steps:8, on:[1,0,0,0,0,0,0,0]};
const ARP = {dir:"updown", octaves:1, rate:"auto"};
/* "auto" keeps the adaptive behaviour: a sequence longer than a bar of eighths would never
   reach its top notes, so it doubles to sixteenths. Explicit rates divide the bar directly. */
const arpStepFor = (beat, seqLen) =>
  ARP.rate === "auto" ? (seqLen > 8 ? beat/4 : beat/2) : (beat * 4) / ARP.rate;
/* Swing as the share of each step-PAIR given to the first note: .5 is straight,
   .667 is triplet feel, .75 is a hard shuffle. Off-beats are pushed late by the rest. */
const SW = {ratio:.5};
/* bpmExact is what the transport runs on. state.bpm is only for display — deriving bar
   length from a rounded tempo is a fraction of a percent off, which is inaudible for one
   bar and a quarter of a second of drift per minute against external gear. */
const barSeconds = () => (60 / (state.bpmExact || state.bpm)) * 4;
/* pads default to one bar; anything from a quarter-bar to eight is allowed */
const chordBars = i => {
  const c = state.prog && state.prog.chords[i];
  return c && c.bars > 0 ? c.bars : 1;
};
const swungAt = (s, step) => s * step + ((s % 2) ? step * (2 * SW.ratio - 1) : 0);
const held = new Map();     // incoming midi note -> {recs, outNotes, slot}
const arping = new Map();   // held notes running a looping motion -> {slot, next, vel, recs}
const litPads = new Set();  // chord slots currently held from a pad
const LEARN = {on:false, target:null};
const padMap = new Map();   // learned: midi note -> chord slot
const ccMap  = new Map();   // learned: cc number -> fader id
/* assigned: program number -> patch name. One program selects exactly one patch, and a
   patch answers to at most one program, so the mapping reads the same in both directions.
   Kept even though the EP-133 turns out not to send program change — other gear does, and
   it costs nothing to answer it. */
const progMap = new Map();
/* assigned: midi note -> patch name. This is the one the EP-133 can actually drive, by
   putting a pad on a note. A note used this way is consumed and does NOT also play a chord. */
const patchNotes = new Map();
/* When a recall lands. Instant is jarring mid-phrase, so the default waits for the next
   chord boundary — a bar for the default one-bar pads, and always a musical seam. The
   transport only ever schedules whole chords, so that is the finest quantum available
   without rescheduling notes that have already been handed to the engine. */
const RECALL = {when:"bar", pending:null};
const faderCtl = {};        // fader id -> {set, el} so CC can drive them

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

/* useCtx is for offline rendering, which needs THIS graph rather than a copy of it —
   the same argument MS·1's initAudio already carried. Online, the context and the
   output both come from the shell, so every instrument shares one time base. */
function initAudio(useCtx){
  if (ctx) return;
  ctx = useCtx || Patchwork.audio.context();
  const out = useCtx ? ctx.destination : Patchwork.audio.strip("cs1");
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = .006; comp.release.value = .25;
  master = ctx.createGain(); master.gain.value = P.level;
  dry = ctx.createGain(); wet = ctx.createGain();
  verb = ctx.createConvolver(); verb.buffer = makeIR(2.8, 2.6);
  /* reverb lands on master, NOT on the compressor. Feeding wet into comp meant more Space
     just bought more gain reduction — the fader's top half did nothing — and it pumped the
     tails in time with the chords. */
  dry.connect(comp); wet.connect(verb); verb.connect(master);
  comp.connect(master); master.connect(out);
  /* one shared cutoff signal every live note reads from, so Tone moves under sounding notes */
  cutSrc = ctx.createConstantSource();
  cutSrc.offset.value = toneHz();
  cutSrc.start();
  /* PeriodicWaves need the context, so they're built here rather than at parse time */
  periodic = {};
  Object.keys(PERIODIC_SPEC).forEach(k => {
    const mags = PERIODIC_SPEC[k];
    const real = new Float32Array(mags.length), imag = new Float32Array(mags.length);
    for (let i = 0; i < mags.length; i++) imag[i] = mags[i];
    periodic[k] = ctx.createPeriodicWave(real, imag, {disableNormalization:false});
  });
  applySpace();
}
/* 3x, not .85x — the ConvolverNode normalizes a 2.8s noise IR down hard, so the old
   send sat around -23dB at the default and was effectively inaudible */
/* iOS parks the context in "suspended" until a gesture, and in "interrupted" after a call
   or an app switch — so anything other than "running" needs a resume, not just "suspended". */
function ensureAudio(){
  initAudio();
  Patchwork.audio.resume();
  /* Every other ioStats() call sits on a device-picker path, and those are disabled on
     iOS — so without this the stats line never appears on the one platform where it's
     the only way to read latency. Repeat once the context is actually running, since
     outputLatency isn't meaningful until then. */
  if (typeof ioStats === "function"){
    ioStats();
    setTimeout(ioStats, 400);
  }
  return ctx.state;
}

function applySpace(){ if (wet) wet.gain.setTargetAtTime(P.space * 3, ctx.currentTime, .02); }
const curve = (v,lo,hi) => lo * Math.pow(hi/lo, v);
/* 25Hz shuts the sound off entirely; 16kHz is past anything the oscillators put out, so the
   top of the fader is genuinely open. Voice `cut` multiplies this and BiquadFilterNode
   clamps at Nyquist, so bell's 1.5x simply saturates rather than misbehaving. */
const TONE_MIN = 25, TONE_MAX = 16000;
const toneHz = () => curve(P.tone, TONE_MIN, TONE_MAX);
const REL_MIN = .08, REL_MAX = 6;
const relTime = () => Math.max(.06, curve(P.release, REL_MIN, REL_MAX));

function trigger(midi, t, hold, opts){
  const o = opts || {};
  const V = VOICES[state.voice];
  /* clamp attack so a slow attack can't outrun a short note and leave the envelope mid-ramp */
  const atk = Math.min(curve(P.attack, .004, 1.4), hold * .8);
  const rel = relTime();
  const cutMul = o.bass ? .5 : V.cut;
  const detMul = o.bass ? .3 : 1;
  const basePan = o.bass ? 0 : (o.pan || 0);
  const peak = (o.gain != null ? o.gain : V.lvl) * (o.bass ? 1.15 : 1);
  const freq = 440 * Math.pow(2,(midi-69)/12);
  const decEnd = Math.min(atk + Math.min(hold*.9, 1.6), hold * .99);

  /* susAmt (0..1) gives a continuously variable envelope tail, used by the bass:
       0    — falls to 2% in ~0.35s, a hard pluck
       1    — no decay at all, holds at full level
     Absent means the standard chord-note shape: dip to 72%, then hold. */
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(peak, t + atk);
  let susLevel;
  if (o.susAmt != null && o.susAmt >= .98){
    susLevel = peak;
  } else if (o.susAmt != null){
    /* the fall time is capped so a plucked bass dies at the same rate whether the pad
       is one bar or eight, instead of stretching to fit */
    const fallEnd = Math.min(hold * .99, atk + curve(o.susAmt, .35, 4));
    susLevel = Math.max(peak * curve(o.susAmt, .02, 1), .0002);
    env.gain.exponentialRampToValueAtTime(susLevel, t + fallEnd);
  } else {
    susLevel = peak * .72;
    env.gain.linearRampToValueAtTime(susLevel, t + decEnd);
  }

  const filt = ctx.createBiquadFilter();
  /* the bass always stays lowpass — a bandpass or highpass voice would gut the low end */
  filt.type = o.bass ? "lowpass" : (V.filter || "lowpass");
  filt.Q.value = o.bass ? .7 : V.q;
  filt.frequency.value = CUT_FLOOR;
  /* the envelope is a multiplier on the shared cutoff, not an absolute frequency */
  const cutEnv = ctx.createGain();
  cutEnv.gain.setValueAtTime(.55 * cutMul, t);
  cutEnv.gain.linearRampToValueAtTime(cutMul, t + atk + .04);
  /* the filter closing is the other half of the trail-off, so it tracks susAmt too */
  const cutEnd = o.susAmt != null ? (.34 + .62 * o.susAmt) : .62;
  cutEnv.gain.exponentialRampToValueAtTime(cutEnd * cutMul, t + hold + rel);
  cutSrc.connect(cutEnv);
  cutEnv.connect(filt.frequency);

  const pan = ctx.createStereoPanner();
  pan.pan.value = basePan * P.spread;

  env.connect(filt); filt.connect(pan);
  pan.connect(dry);
  if (!o.bass) pan.connect(wet); else { const bw = ctx.createGain(); bw.gain.value = .35; pan.connect(bw); bw.connect(wet); }

  const oscs = [];
  const specs = o.bass ? [["triangle",0,.6],["sine",0,.5]] : V.oscs;
  specs.forEach((sp, i) => {
    const osc = ctx.createOscillator();
    if (STD_WAVES.indexOf(sp[0]) >= 0) osc.type = sp[0];
    else if (periodic[sp[0]]) osc.setPeriodicWave(periodic[sp[0]]);
    else osc.type = "sine";
    osc.frequency.value = freq * Math.pow(2, sp[1]/12);
    /* voice detune is fixed character; Spread is the player's control, so they add */
    osc.detune.value = (sp[3] || 0) + (i % 2 ? 1 : -1) * P.spread * 22 * detMul;
    const g = ctx.createGain(); g.gain.value = sp[2];
    osc.connect(g); g.connect(env);
    osc.start(t);
    oscs.push(osc);
  });

  const rec = {env, oscs, filt, pan, cutEnv, basePan, detMul, t, hold, peak, rel,
               sus:susLevel, oscDet:specs.map(sp => sp[3] || 0)};
  /* the tail is re-schedulable so the Release fader can move under a sounding note */
  rec.tail = function(r){
    rec.rel = r;
    const end = rec.t + rec.hold + r;
    env.gain.cancelScheduledValues(rec.t + rec.hold);
    env.gain.setValueAtTime(rec.sus, rec.t + rec.hold);
    env.gain.exponentialRampToValueAtTime(.0001, end);
    oscs.forEach(x => { try{ x.stop(end + .05); }catch(e){} });
  };
  rec.tail(rel);

  active.add(rec);
  oscs[0].onended = () => {
    active.delete(rec);
    try{ cutSrc.disconnect(cutEnv); }catch(e){}
    try{ cutEnv.disconnect(); env.disconnect(); filt.disconnect(); pan.disconnect(); }catch(e){}
  };
  return rec;
}

/* fade a note out now, at the current Release setting — used by pad note-off */
function releaseRec(rec, when){
  if (!ctx) return;
  const t = when == null ? ctx.currentTime : when;
  const r = relTime();
  try{
    rec.env.gain.cancelScheduledValues(t);
    rec.env.gain.setValueAtTime(Math.max(rec.env.gain.value, .0001), t);
    rec.env.gain.exponentialRampToValueAtTime(.0001, t + r);
    rec.oscs.forEach(o => { try{ o.stop(t + r + .05); }catch(e){} });
  }catch(e){}
}

function killAll(){
  if (!ctx) return;
  const t = ctx.currentTime;
  active.forEach(rec => {
    try{
      rec.env.gain.cancelScheduledValues(t);
      rec.env.gain.setValueAtTime(Math.max(rec.env.gain.value, .0001), t);
      rec.env.gain.exponentialRampToValueAtTime(.0001, t + .18);
      rec.oscs.forEach(o => { try{ o.stop(t + .22); }catch(e){} });
    }catch(e){}
  });
}

/* push a fader move into notes that are already sounding */
function refreshLive(id){
  if (!ctx) return;
  const now = ctx.currentTime;
  if (id === "tone"){
    if (cutSrc) cutSrc.offset.setTargetAtTime(toneHz(), now, .03);
  } else if (id === "spread"){
    const d = P.spread * 22;
    active.forEach(rec => {
      try{
        rec.pan.pan.setTargetAtTime(rec.basePan * P.spread, now, .02);
        rec.oscs.forEach((o, i) => o.detune.setTargetAtTime(
          (rec.oscDet ? rec.oscDet[i] || 0 : 0) + (i % 2 ? d : -d) * rec.detMul, now, .02));
      }catch(e){}
    });
  } else if (id === "release"){
    const r = relTime();
    active.forEach(rec => { if (now < rec.t + rec.hold) { try{ rec.tail(r); }catch(e){} } });
  }
}

/* one note event list per bar, shared by the internal engine and MIDI out */
function chordEvents(i, t){
  const prog = state.prog;
  if (!prog || !prog.chords[i] || !prog.voicings[i]) return [];
  const beat = 60 / state.bpm;
  const bar = beat * 4;
  const bars = chordBars(i);
  const span = bar * bars;              // how long this pad actually holds
  const ch = prog.chords[i];
  const notes = prog.voicings[i];
  const motion = state.motion;

  /* Bass runs its own step sequence, repeating each bar like Pulse does. Each hit lasts
     until the next one (or the end of the chord), and the Decay fader shapes that span —
     so a single step at full decay is one note held under the whole bar, and a busier
     pattern gives a bass line. Deliberately NOT swung: the Swing control only appears for
     Arp and Pulse, and a hidden control shouldn't move these notes. */
  const ev = [];
  if (state.bass){
    const bn = Math.max(1, BASSQ.steps);
    const bStep = bar / bn;
    const bTotal = Math.max(1, Math.round(bn * bars));
    const hits = [];
    for (let s = 0; s < bTotal; s++) if (BASSQ.on[s % bn]) hits.push(s * bStep);
    hits.forEach((at, k) => {
      const until = (k + 1 < hits.length) ? hits[k + 1] : span;
      /* velocity tracks the level so external gear follows the same mix move */
      ev.push({n:bassNote(ch, state.keyPc), t:t + at, d:Math.max(.05, (until - at) * .99),
               bass:true, gain:bassGain(), susAmt:P.bassSus,
               vel:Math.max(1, Math.min(127, Math.round(76 * P.bassLvl / .5)))});
    });
  }
  const spread = notes.length > 1 ? 1.2 / (notes.length - 1) : 0;

  if (motion === "hold" || motion === "strum"){
    const off = motion === "strum" ? .045 : 0;
    notes.forEach((n, k) => ev.push({n, t:t + k*off, d:span*.94 - k*off, pan:-0.6 + k*spread, vel:98}));
  } else if (motion === "arp"){
    const seq = arpSequence(notes);
    /* rate is per bar, so a longer pad gets proportionally more notes — the run keeps
       going rather than stretching, which would change the arp's speed */
    const step = arpStepFor(beat, seq.length);
    const steps = Math.max(1, Math.round(span / step));
    let prev = -1;
    for (let s = 0; s < steps; s++){
      let idx;
      if (ARP.dir === "random"){
        idx = Math.floor(Math.random() * seq.length);
        if (seq.length > 1 && idx === prev) idx = (idx + 1) % seq.length;   // no immediate repeats
      } else {
        idx = s % seq.length;
      }
      prev = idx;
      /* duration follows the gap to the NEXT swung step, so shuffled off-beats don't
         run past the downbeat that follows them */
      const at = swungAt(s, step), gap = swungAt(s+1, step) - at;
      ev.push({n:seq[idx], t:t + at, d:gap*1.45,
               pan:-0.5 + (s % notes.length)*spread, gain:VOICES[state.voice].lvl*.85, vel:88});
    }
  } else {
    const n = Math.max(1, PULSE.steps);
    const step = bar / n;                       // step size stays tied to ONE bar...
    const total = Math.max(1, Math.round(n * bars));   // ...and the pattern repeats over the pad
    for (let s = 0; s < total; s++){
      if (!PULSE.on[s % n]) continue;
      const at = swungAt(s, step), gap = swungAt(s+1, step) - at;
      notes.forEach((nn,k) => ev.push({n:nn, t:t + at, d:gap*.85,
                                       pan:-0.5 + k*spread, gain:VOICES[state.voice].lvl*.62, vel:84}));
    }
  }
  return ev;
}

/* Octaves stack upward from the voicing, then direction reshapes the run.
   Random picks per step at schedule time, so it isn't baked into the sequence. */
function arpSequence(notes){
  const base = [];
  for (let o = 0; o < ARP.octaves; o++){
    notes.forEach(n => { const p = n + 12*o; if (p <= 108) base.push(p); });
  }
  base.sort((a,b) => a-b);
  if (!base.length) return notes.slice();
  if (ARP.dir === "down") return base.slice().reverse();
  if (ARP.dir === "updown") return base.length > 2 ? base.concat(base.slice(1,-1).reverse()) : base;
  return base;    // up, and random (index chosen per step above)
}

function scheduleChord(i, t){
  chordEvents(i, t).forEach(e => {
    trigger(e.n, e.t, e.d, {bass:e.bass, gain:e.gain, pan:e.pan, susAmt:e.susAmt});
    sendNote(e.n, e.t, e.d, e.vel);
  });
}

/* Render a chord into an OfflineAudioContext, the way MS·1's renderPatch does.

   CS·1 had no offline harness, which is why its twelve voices carry a measured 8.2 dB
   spread while MS·1's twenty patches sit within a fraction of a dB — one instrument's
   levels were dialled and the other's were measured. This is the rig that makes CS·1's
   measurable too, and Phase 3 needed it for a different reason: without it there was no
   way to put a number on what the two instruments cost together.

   Saves and restores the live graph exactly as MS·1's does, so calling it while the
   transport is running does not disturb what is sounding. */
async function renderChord(opts){
  const o = opts || {};
  const dur = o.dur || 2.0, rate = o.rate || 48000;
  const saved = {ctx, master, dry, wet, verb, comp, cutSrc, periodic};
  const savedActive = Array.from(active);
  active.clear();
  ctx = null;
  const off = new OfflineAudioContext(2, Math.ceil(rate * dur), rate);
  try{
    initAudio(off);
    if (o.voice) state.voice = o.voice;
    const notes = o.notes || [48, 52, 55, 59, 62, 67];
    const gate = o.gate == null ? dur : o.gate;
    notes.forEach((n, i) => trigger(n, 0, gate, {gain: o.gain, pan: o.pan ? (i / notes.length - .5) * 2 : 0}));
    return await off.startRendering();
  } finally {
    active.forEach(v => { try{ v.stop && v.stop(); }catch(e){} });
    active.clear();
    ctx = saved.ctx; master = saved.master; dry = saved.dry; wet = saved.wet;
    verb = saved.verb; comp = saved.comp; cutSrc = saved.cutSrc; periodic = saved.periodic;
    savedActive.forEach(v => active.add(v));
  }
}

/* ---- transport ---- */
/* gridBeats is the musical position of nextTime, in beats since playback started. Keeping
   it alongside nextTime is what makes phase measurable at all: nextTime alone says when the
   next chord lands, not where the grid thinks it is relative to anyone else's bar. */
let timer = null, nextTime = 0, nextIndex = 0, marks = [], gridBeats = 0;
const beatSeconds = () => barSeconds() / 4;
/* Transport's musical position at an audio-clock time, interpolated back from the grid. */
const beatsAt = t => gridBeats - (nextTime - t) / beatSeconds();
function startPlay(){
  ensureAudio();
  state.playing = true;
  nextIndex = 0;
  gridBeats = 0;
  phaseReset();
  /* Just enough that the first chord isn't scheduled into the past — the tick runs every
     25ms. This used to be 80ms, which was the dominant term in the clock offset people
     had to dial out, and pure delay on the Play button besides. */
  /* The shell places this on the running grid if another instrument is already going,
     and defines the grid from here if not — so a standalone build starts exactly where
     it always did, and two instruments started seconds apart are still in phase. */
  nextTime = Patchwork.clock.claim(4);
  marks = [];
  tick();
  Patchwork.clock.run(tick);
  timer = tick;
  playBtn.classList.add("on");
  playBtn.textContent = "■ Stop";
  requestAnimationFrame(paint);
}
function tick(){
  /* nextTime is the musical grid; `off` shifts what's actually scheduled against it, so a
     negative offset pulls playback ahead of an external clock. Lookahead is widened by the
     offset so a negative shift can't ask for a time that has already passed. */
  const off = SYNC.offsetMs / 1000;
  while (nextTime + off < ctx.currentTime + .2 + Math.abs(off)){
    /* a queued patch lands here, on the seam, before anything for this chord is scheduled —
       so the progression that gets played from this boundary is the new one */
    takePending();
    /* and a queued scene, at the loop point rather than every chord — same reasoning,
       generalised across the instruments in shell/scenes.js */
    if (nextIndex === 0) Patchwork.scenes.take("cs1");
    const at = Math.max(ctx.currentTime + .005, nextTime + off);
    const bars = chordBars(nextIndex);
    const dur = barSeconds() * bars;
    scheduleChord(nextIndex, at);
    marks.push({i:nextIndex, t:at, end:at + dur});
    /* The grid advances by the exact musical length; the correction is applied to the
       wall-clock step only, so gridBeats stays an honest count of beats played. */
    nextTime += phaseAdjust(dur);
    gridBeats += 4 * bars;
    nextIndex = (nextIndex + 1) % state.prog.chords.length;
  }
  /* quarter-bar pads burn through marks far faster than whole bars did */
  while (marks.length > 12) marks.shift();
}
function stopPlay(){
  state.playing = false;
  Patchwork.clock.stop(tick); timer = null;
  /* release held pads first — midiPanic's all-notes-off would cut them on the external
     synth anyway, and leaving their loops running would desync internal from external */
  allPadsOff();
  killAll();
  midiPanic();
  playBtn.classList.remove("on");
  playBtn.textContent = "▶ Play";
  $$(".chord").forEach((c, idx) => {
    c.classList.toggle("on", litPads.has(idx));
    c.querySelector(".wipe").style.width = "0%";
  });
  clearSteps();
}
function paint(){
  if (!state.playing) return;
  const now = ctx.currentTime;
  let cur = null;
  for (const m of marks) if (now >= m.t && now < m.end) cur = m;
  const cards = $$(".chord");
  cards.forEach((c, idx) => {
    const on = cur && cur.i === idx;
    c.classList.toggle("on", !!on || litPads.has(idx));
    c.querySelector(".wipe").style.width = on ? (((now - cur.t)/(cur.end - cur.t))*100).toFixed(1) + "%" : "0%";
  });
  paintSteps(cur, now);
  requestAnimationFrame(paint);
}

/* playhead on both step grids, derived from progress through the current chord */
function paintSteps(cur, now){
  const frac = cur ? (now - cur.t) / (cur.end - cur.t) : -1;
  const mark = (el, cfg, active) => {
    /* patterns repeat per bar, so wrap the position by the chord's length in bars */
    const bars = cur ? Math.max(1, chordBars(cur.i)) : 1;
    const idx = (active && frac >= 0)
      ? Math.floor(frac * cfg.steps * bars) % cfg.steps : -1;
    for (let s = 0; s < el.children.length; s++)
      el.children[s].classList.toggle("now", s === idx);
  };
  mark(stepGrid, PULSE, state.motion === "pulse");
  mark(bassGrid, BASSQ, state.bass);
}
function clearSteps(){
  for (const b of stepGrid.children) b.classList.remove("now");
  for (const b of bassGrid.children) b.classList.remove("now");
}

/* One-shot trigger for a click, a key press or a pad. Runs the SAME event list the
   sequencer uses, so Strum/Arp/Pulse behave identically whether or not it's playing —
   they used to be silently flattened to Hold here. */
function stab(i){
  if (!state.prog) return;
  ensureAudio();
  const t = ctx.currentTime + .02;   // nudge off "now" so nothing schedules into the past
  chordEvents(i, t).forEach(e => {
    trigger(e.n, e.t, e.d, {bass:e.bass, gain:e.gain, pan:e.pan, susAmt:e.susAmt});
    sendNote(e.n, e.t, e.d, e.vel);
  });
}

