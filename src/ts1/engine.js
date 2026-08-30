
/* ============ engine ============ */
const V = Patchwork.voice;
const clampf = V.clampf;

let ctx = null, out = null, noise = null, verb = null, verbGate = null;

/* What a transition IS, in six numbers. Everything on the panel is one of these, and there
   is deliberately nothing else: a transition synth with an oscillator page would be a
   synthesiser you had to program before it could do its one job. */
const TS = {
  bars: 2,               // how long the run-up takes — 1, 2, 4 or 8
  shape: "rise",         // rise | fall
  character: "air",      // air | siren | roll
  depth: .75,            // how far it travels
  impact: true,          // a hit ON the landing
  fill: "off",           // roll | toms | build | off — which family of fill
  fillVariant: 0,        // which of that family's ten
  /* ⚠️ How far the sweep spills PAST the landing, in bars. Zero is the original behaviour
     and still the default, because a riser that decays through the boundary smears the
     downbeat it exists to announce. Carry is the deliberate opposite of that: sometimes you
     want the wash to hang over the first bar of the new part, and the point is that it is a
     choice rather than the only option. */
  carry: 0,
  /* ⚠️ TWO levels, not one. The sweep is synthesised here and the fill is played on
     somebody else's kit, so they arrive at wildly different levels depending on how DR·1
     happens to be set — one fader for both meant every change to the drums put the balance
     out, and the only way to fix it was to stop using one of them. */
  fxLevel: .8,           // the sweep and its impact
  fillLevel: .8,         // the drums
  space: .45,            // reverb, and how hard it is gated — see buildVerb()
  /* set while one is scheduled or sounding, and read by the panel, the scene launcher and
     the session — the one piece of state anyone outside asks about */
  armed: false,
  landAt: 0,             // ctx time this transition resolves on
  startAt: 0
};

function initAudio(useCtx){
  if (ctx) return;
  ctx = useCtx || Patchwork.audio.context();
  out = useCtx ? ctx.destination : Patchwork.audio.strip("ts1");
  noise = V.noiseBuffer(ctx, 2);
  buildVerb();
}

/* ---- the space ----
   ⚠️ GATED, and that is the whole reason it is built this way rather than as a send you set
   and forget. The sound this instrument is for is a huge reverb that STOPS — 80s gated
   toms, a riser whose tail is chopped off exactly on the downbeat. So the wet path has its
   own gate AFTER the convolver, scheduled with the same landing envelope the dry sweep
   gets: Cut chops the tail on the boundary, and Carry lets it wash over into the next part.
   Gating the SEND instead would not work — the reverb goes on ringing from whatever already
   went into it, which is the opposite of gated.

   One convolver for the instrument, not one per transition: an impulse response is a couple
   of hundred thousand samples to generate and transitions never overlap, so a shared node
   the next transition re-schedules is both cheaper and simpler than a new graph each time. */
function buildVerb(){
  const secs = 2.4, rate = ctx.sampleRate, n = Math.floor(secs * rate);
  const ir = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++){
    const d = ir.getChannelData(c);
    for (let i = 0; i < n; i++){
      const f = i / n;
      /* exponential decay with a short build at the front — a plate rather than a room,
         which is what these sounds sit in */
      const env = Math.pow(1 - f, 2.6) * Math.min(1, f * 220);
      d[i] = (Math.random() * 2 - 1) * env;
    }
  }
  verb = ctx.createConvolver();
  verb.buffer = ir;
  verbGate = ctx.createGain();
  verbGate.gain.value = 0;
  verb.connect(verbGate);
  verbGate.connect(out);
}
function ensureAudio(){
  initAudio();
  Patchwork.audio.resume();
  return ctx.state;
}

/* ---- the landing ----
   ⚠️ It takes the next boundary that is FAR ENOUGH AWAY, not simply the next one. A 4-bar
   riser armed two beats before the bar line has to wait for the boundary after, or it gets
   a run-up of two beats and sounds like a mistake. Waiting is visible — the panel counts
   down — and a transition that always gets its full length is the only version of this
   worth having. */
function schedule(){
  ensureAudio();
  const beats = TS.bars * 4;
  const dur = beats * Patchwork.clock.beatSeconds();
  let land = Patchwork.clock.claim(beats);
  const now = ctx.currentTime;
  while (land - dur < now + .05) land += dur;
  TS.startAt = land - dur;
  TS.landAt = land;
  TS.armed = true;
  build(TS.startAt, land, dur);
  notify();
  return {startAt: TS.startAt, landAt: land, dur};
}

/* ---- landing on the very next boundary ----
   The escape hatch from schedule()'s rule. Sometimes the part changes in one bar and a
   two-bar riser squashed into it is better than no riser at all — so this takes the next
   boundary whatever it costs the run-up, and the panel says that is what it does. */
function fireNow(){
  ensureAudio();
  const beats = TS.bars * 4;
  const dur = beats * Patchwork.clock.beatSeconds();
  let land = Patchwork.clock.claim(beats);
  const now = ctx.currentTime;
  /* ⚠️ WITH NOTHING ELSE RUNNING THERE IS NO GRID TO LAND ON, and claim() says so by
     handing back "now" — this instrument's downbeat would define the grid, which is right
     for a sequencer pressing Play and nonsense for a riser: it collapses the whole run-up
     into a few milliseconds and all you hear is the impact. A boundary this close cannot
     carry a transition whatever the reason for it, so take the one after. */
  if (land - now < Math.min(.15, dur * .1)) land += dur;
  const start = Math.max(now + .02, land - dur);
  TS.startAt = start;
  TS.landAt = land;
  TS.armed = true;
  build(start, land, Math.max(.05, land - start));
  notify();
  return {startAt: start, landAt: land};
}

function cancel(){
  if (!TS.armed) return;
  const t = ctx ? ctx.currentTime : 0;
  live.forEach(n => { try{ n.stop ? n.stop(t + .05) : n.disconnect(); }catch(e){} });
  live = [];
  if (fade){ try{ fade.gain.cancelScheduledValues(t);
                   fade.gain.setTargetAtTime(0, t, .02); }catch(e){} }
  if (verbGate){ try{ verbGate.gain.cancelScheduledValues(t);
                      verbGate.gain.setTargetAtTime(0, t, .04); }catch(e){} }
  TS.armed = false;
  notify();
}

let live = [], fade = null;

/* ---- building one ----
   Scheduled entirely up front, from startAt to landAt. Nothing here runs on a timer and
   nothing checks the clock again once it is built: the whole gesture is a set of ramps on
   an audio parameter, which is the only way it can be sample-accurate about the one moment
   that matters. */
/* How long the sound has to keep existing after the landing. The carry is a decay rather
   than a hard stop, so the source has to outlive it — cutting at the landing would silence
   the very thing carry exists to produce. */
function tailSec(dur){
  return .35 + TS.carry * 4 * Patchwork.clock.beatSeconds() * 1.4;
}

function build(t0, land, dur){
  const rise = TS.shape === "rise";
  const d = clampf(TS.depth, 0, 1);
  const amp = ctx.createGain();
  amp.gain.value = 0;
  fade = amp;

  const filt = ctx.createBiquadFilter();
  filt.type = TS.character === "siren" ? "lowpass" : "bandpass";
  filt.Q.setValueAtTime(TS.character === "air" ? 1.2 + 6*d : 1.4, t0);

  amp.connect(out);
  filt.connect(amp);
  /* the send is per transition so Space can change between them; the convolver is not */
  const send = ctx.createGain();
  send.gain.setValueAtTime(clampf(TS.space, 0, 1) * 1.15, t0);
  amp.connect(send);
  send.connect(verb);
  live.push(send);

  /* The sweep, in one place for all three characters: a frequency that travels from one
     end of its range to the other across the run-up. Exponential, because pitch is. */
  const lo = 180, hi = 180 + 7600 * (0.25 + 0.75*d);
  const fA = rise ? lo : hi, fB = rise ? hi : lo;
  filt.frequency.setValueAtTime(fA, t0);
  filt.frequency.exponentialRampToValueAtTime(fB, land);

  if (TS.character === "siren"){
    /* A tone rather than noise: the same gesture, but it has a pitch you can hear moving,
       which is what makes it read as a siren rather than as wind. */
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const pA = rise ? 90 : 90 * Math.pow(2, 3*d), pB = rise ? 90 * Math.pow(2, 3*d) : 90;
    osc.frequency.setValueAtTime(pA, t0);
    osc.frequency.exponentialRampToValueAtTime(pB, land);
    osc.connect(filt);
    osc.start(t0); osc.stop(land + tailSec(dur));
    live.push(osc);
  } else {
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    src.connect(filt);
    src.start(t0); src.stop(land + tailSec(dur));
    live.push(src);
  }

  /* ---- the swell ----
     Up into the landing and then off it, fast. A riser that decays through the boundary
     smears the downbeat it exists to announce. */
  amp.gain.setValueAtTime(0, t0);
  const peak = clampf(TS.fxLevel, 0, 1) * .55;
  amp.gain.linearRampToValueAtTime(peak * .12, t0 + dur * .25);
  amp.gain.exponentialRampToValueAtTime(Math.max(.0005, peak), land - .01);
  /* ---- the landing, and what comes after it ----
     Without carry this cuts hard, because a riser decaying through the boundary smears the
     downbeat it exists to announce. With carry it is let go slowly instead, and the sweep
     keeps travelling in the direction it was going — a riser that goes on rising as it fades
     is the sound of the wash hanging over the new part, and one that froze in pitch on the
     boundary would just sound like a stuck note. */
  const carrySec = TS.carry * 4 * Patchwork.clock.beatSeconds();
  /* the wet is open through the run-up and then follows the dry off the landing */
  const vg = verbGate.gain;
  vg.cancelScheduledValues(t0);
  vg.setValueAtTime(1, t0);
  if (carrySec > .01){
    amp.gain.setTargetAtTime(0, land, carrySec / 3.2);
    vg.setTargetAtTime(0, land, carrySec / 2.4);          // the tail outlives the dry a little
    filt.frequency.exponentialRampToValueAtTime(
      clampf(fB * (rise ? 1.7 : .55), 40, 18000), land + carrySec);
  } else {
    amp.gain.setTargetAtTime(0, land, TS.impact ? .012 : .05);
    /* the gate, in the 80s sense: the tail is cut rather than allowed to ring out */
    vg.setTargetAtTime(0, land, .03);
  }

  if (TS.character === "roll"){
    /* An accelerating stutter — the snare-roll shape, done as scheduled gain steps rather
       than an LFO because the whole point is that the rate CHANGES, and it has to land on
       the boundary exactly however many pulses that takes. */
    const gate = ctx.createGain();
    filt.disconnect(); filt.connect(gate); gate.connect(amp);
    let t = t0, step = dur / 8;
    const floorStep = Math.max(.028, dur / (24 + 72*d));
    while (t < land - .001){
      gate.gain.setValueAtTime(1, t);
      gate.gain.setTargetAtTime(.06, t + step * .35, step * .18);
      t += step;
      step = Math.max(floorStep, step * (0.86 - .06*d));
    }
    gate.gain.setValueAtTime(1, Math.max(t0, land - .001));
    live.push(gate);
  }

  if (TS.impact) buildImpact(land);
  buildFill(t0, land, dur);

  /* One timer, for the panel and for anyone asking whether a transition is running. The
     audio is already scheduled and does not depend on this firing on time. */
  const ms = Math.max(0, (land - ctx.currentTime + tailSec(dur)) * 1000);
  setTimeout(() => { if (TS.landAt === land){ TS.armed = false; live = []; notify(); } }, ms);
}

/* ---- drum fills ----
   Written as fractions of the run-up, not as steps, so one fill works at any length: the
   same pattern is four hits over a bar or sixteen over eight bars without a second version
   of it existing. `at` is 0 at the start of the run-up and 1 on the landing.

   ⚠️ Nothing lands ON 1. The boundary belongs to the downbeat the fill is announcing, and a
   fill hit sitting exactly on it doubles whatever fires there — including TS·1's own
   impact. The last hit of every pattern is deliberately just before.

   Ten of each kind rather than one, because a fill you have heard forty times is a fill you
   stop hearing. They are generated from a handful of shared shapes instead of being thirty
   hand-written arrays — the arrays would be longer, and every one of them would be a place
   for a typo to hide as a musical decision. */

/* positions: n hits spread evenly between two points in the run-up */
function evenly(n, from, to){
  const out = [];
  for (let k = 0; k < n; k++) out.push(from + (to - from) * (k / n));
  return out;
}
/* positions that get closer together — `bite` is how hard it accelerates */
function accel(n, from, to, bite){
  const out = [];
  for (let k = 0; k < n; k++){
    const f = k / n;
    out.push(from + (to - from) * Math.pow(f, 1 + bite));
  }
  return out;
}
/* Every hit in a run-up is louder than the one before it. Fills are a crescendo by nature,
   and the ones that are not read as a mistake rather than as a choice. */
const swell = (f, lo, hi) => (lo == null ? .55 : lo) + ((hi == null ? .98 : hi) - (lo == null ? .55 : lo)) * f;

/* ---- a run of pitches across the toms ----
   ⚠️ AIMED AT FREQUENCIES, NOT AT RATIOS. A ratio means something different on each tom, so
   "×0.83 then ×1.13" reads as a descent in the code and is a jump upward in the air — which
   is what the first version of the cascade did at the handover. Ask the kit what its toms
   are tuned to, aim at a curve of real pitches, and work each ratio back out from whichever
   tom reaches that pitch with the least stretch. It keeps working after you retune them. */
function tomAt(f, depth, rise){
  const K = (typeof Patchwork !== "undefined" && Patchwork.kit) ? Patchwork.kit : null;
  const hi = (K && K.tuneOf("ht")) || 175;
  const lo = (K && K.tuneOf("lt")) || 92;
  const d = 0.35 + 0.65 * depth;
  const travel = d * 1.9;
  /* rise runs the same curve backwards, so an up-run is the same shape inverted rather than
     a second set of numbers to keep in step with the first */
  const g = rise ? (1 - f) : f;
  const hz = (hi * 1.3) * Math.pow(2, -travel * g);
  const useLo = Math.abs(Math.log2(hz / lo)) < Math.abs(Math.log2(hz / hi));
  return {v: useLo ? "lt" : "ht", tune: hz / (useLo ? lo : hi), hz};
}
/* a tom run of n hits at the given positions */
function tomRun(pos, depth, rise, velLo, velHi){
  return pos.map((at, k) => {
    const f = pos.length < 2 ? 0 : k / (pos.length - 1);
    const t = tomAt(f, depth, rise);
    return {v: t.v, at, tune: t.tune, hz: t.hz,
            vel: swell(f, velLo, velHi), decay: 1.5 + .8 * f};
  });
}
const hits = (pos, v, velLo, velHi, extra) => pos.map((at, k) => Object.assign(
  {v, at, vel: swell(pos.length < 2 ? 1 : k / (pos.length - 1), velLo, velHi)}, extra || {}));

/* ---- the bank ----
   Each entry is {name, make({dur, depth, rise})}. `rise` is the panel's Shape: a fill runs
   the same way the sweep over it does, so one control steers both and there is not a second
   direction switch that can disagree with the first. */
const FILL_BANK = {
  roll: [
    {name: "Straight",   make: () => hits(evenly(16, 0, 1), "sd")},
    {name: "Eighths",    make: () => hits(evenly(8, 0, 1), "sd", .6)},
    {name: "Triplets",   make: () => hits(evenly(12, 0, 1), "sd")},
    {name: "Accelerate", make: ({depth}) => hits(accel(20, 0, 1, .9 + depth), "sd", .4)},
    {name: "Half-time",  make: () => hits(evenly(4, 0, 1), "sd", .7, 1)},
    {name: "Buzz",       make: () => hits(evenly(4, 0, .5), "sd", .5, .6)
                                     .concat(hits(evenly(24, .5, 1), "sd", .55))},
    {name: "Flams",      make: () => evenly(8, 0, 1).flatMap((at, k) => {
                                       const f = k / 8;
                                       return [{v: "sd", at, vel: swell(f) * .5},
                                               {v: "sd", at: at + .012, vel: swell(f)}];
                                     })},
    {name: "Backbeat",   make: () => hits(evenly(16, 0, 1), "sd", .4, .7)
                                     .map((h, k) => (k % 4 === 2 ? Object.assign(h, {vel: 1}) : h))},
    {name: "Stutter",    make: () => [0, .25, .5, .75].flatMap(b =>
                                       hits(evenly(3, b, b + .16), "sd", .5, .9))},
    {name: "Crescendo",  make: () => hits(evenly(24, 0, 1), "sd", .12, 1)}
  ],
  toms: [
    {name: "Cascade",    make: ({depth, rise}) =>
                           tomRun(evenly(6, 0, .75).concat(evenly(4, .75, 1)), depth, rise)},
    {name: "Steps",      make: ({depth, rise}) => tomRun(evenly(8, 0, 1), depth, rise)},
    {name: "Tumble",     make: ({depth, rise}) => tomRun(accel(14, 0, 1, .8), depth, rise, .45)},
    {name: "Pairs",      make: ({depth, rise}) => tomRun(
                           evenly(6, 0, 1).flatMap(a => [a, a + .028]), depth, rise)},
    {name: "Alternating",make: ({depth, rise}) => tomRun(evenly(12, 0, 1), depth, rise)
                           .map((h, k) => (k % 2 ? Object.assign(h, {v: h.v === "ht" ? "lt" : "ht"}) : h))},
    {name: "Triplets",   make: ({depth, rise}) => tomRun(evenly(12, 0, 1), depth, rise, .5)},
    {name: "Last half",  make: ({depth, rise}) => tomRun(evenly(8, .5, 1), depth, rise, .6)},
    {name: "Sparse",     make: ({depth, rise}) => tomRun(evenly(4, 0, 1), depth, rise, .75, 1)},
    {name: "Avalanche",  make: ({depth, rise}) => tomRun(evenly(16, 0, 1), depth, rise, .4)},
    {name: "Tom & kick", make: ({depth, rise}) => tomRun(evenly(8, 0, 1), depth, rise)
                           .flatMap((h, k) => (k % 2 === 0
                             ? [h, {v: "bd", at: h.at + .5 / 8, vel: h.vel * .85}] : [h]))}
  ],
  build: [
    {name: "Hats",       make: () => hits(evenly(8, 0, .5), "ch", .4, .6)
                                     .concat(hits(evenly(16, .5, 1), "ch", .6, .95))},
    {name: "Doubling",   make: () => [[.0, 4], [.25, 8], [.5, 12], [.75, 20]]
                                     .flatMap(([b, n], i) => hits(evenly(n / 4, b, b + .25), "ch", .35 + i * .16))},
    {name: "Snare rise", make: () => hits(accel(18, 0, 1, .6), "sd", .3, 1)},
    {name: "Open hats",  make: () => evenly(8, 0, 1).map((at, k) => ({
                                       v: k % 2 ? "oh" : "ch", at, vel: swell(k / 8, .45)}))},
    {name: "Ride",       make: () => hits(evenly(16, 0, 1), "rs", .4, .9)},
    {name: "Claps",      make: () => hits(evenly(8, 0, 1), "cp", .5, 1)},
    {name: "Four floor", make: () => hits(evenly(4, 0, 1), "bd", .8, 1)
                                     .concat(hits(evenly(8, 0, 1), "ch", .35, .6))},
    {name: "Thin out",   make: () => hits(evenly(16, 0, .6), "ch", .9, .5)
                                     .concat(hits(evenly(2, .6, 1), "sd", .6, 1))},
    {name: "Machine",    make: () => hits(evenly(32, 0, 1), "ch", .3, .85)},
    {name: "Hat & clap", make: () => hits(evenly(16, 0, 1), "ch", .3, .7)
                                     .concat(hits(evenly(4, .5, 1), "cp", .6, 1))}
  ]
};

function fillList(kind){ return FILL_BANK[kind] || []; }
function currentFill(){
  const bank = fillList(TS.fill);
  if (!bank.length) return null;
  return bank[Math.max(0, Math.min(bank.length - 1, TS.fillVariant | 0))];
}

function buildFill(t0, land, dur){
  const entry = currentFill();
  if (!entry || !Patchwork.kit || !Patchwork.kit.ready) return;
  let list = [];
  try{ list = entry.make({dur, depth: clampf(TS.depth, 0, 1), rise: TS.shape === "rise"}) || []; }
  catch(e){ return; }
  list.forEach(h => {
    if (h.at >= 1) return;                       // see the warning above
    const when = t0 + h.at * dur;
    if (when >= land) return;
    /* fall back to the snare for a voice this kit does not have, rather than dropping the
       hit and leaving a hole in the middle of a fill */
    const v = Patchwork.kit.has(h.v) ? h.v : "sd";
    Patchwork.kit.hit(v, when, clampf(h.vel, .05, 1) * clampf(TS.fillLevel, 0, 1),
                      (h.tune || h.decay) ? {tune: h.tune, decay: h.decay} : null);
  });
}

/* ---- the landing itself ----
   A drop is a transition that ends in something, and without this the riser simply stops —
   which sounds like the audio failing rather than like an arrival. */
function buildImpact(land){
  const g = ctx.createGain();
  g.gain.setValueAtTime(clampf(TS.fxLevel, 0, 1) * .9, land);
  g.gain.exponentialRampToValueAtTime(.0005, land + .9);
  g.connect(out);
  if (verb){
    const isend = ctx.createGain();
    isend.gain.setValueAtTime(clampf(TS.space, 0, 1) * .8, land);
    g.connect(isend); isend.connect(verb);
    live.push(isend);
  }

  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(150, land);
  sub.frequency.exponentialRampToValueAtTime(38, land + .5);
  sub.connect(g);
  sub.start(land); sub.stop(land + 1);

  const burst = ctx.createBufferSource();
  burst.buffer = noise; burst.loop = false;
  const bf = ctx.createBiquadFilter();
  bf.type = "lowpass";
  bf.frequency.setValueAtTime(6000, land);
  bf.frequency.exponentialRampToValueAtTime(400, land + .35);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(clampf(TS.fxLevel, 0, 1) * .5, land);
  bg.gain.exponentialRampToValueAtTime(.0005, land + .45);
  burst.connect(bf); bf.connect(bg); bg.connect(out);
  burst.start(land); burst.stop(land + .5);
  live.push(sub, burst);
}

/* How far off the landing is, in seconds — what the panel counts down. */
function untilLanding(){
  if (!TS.armed || !ctx) return 0;
  return Math.max(0, TS.landAt - ctx.currentTime);
}

const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }
function onChange(fn){ subs.push(fn); }
