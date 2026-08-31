
/* ---- the punch-in rack ----
   Master effects you HOLD. Press, the effect is in; let go, it is out. That is the whole
   interaction and it is why these are on the live page rather than in a panel: a knob you
   set is a mixing decision, and a pad you hold for two bars is playing.

   ⚠️ AFTER THE TAPS, WHICH MEANS LP·1 RECORDS DRY. The looper listens on each instrument's
   strip input — pre-fader, see bus.js — and this sits between master and the speakers, so
   a stutter you throw over a take is not printed into it. That is the same rule the mixer
   already follows and it is the right one here for a stronger reason: a punch-in is a
   moment, and a moment baked into a loop plays back on every pass afterwards.

   ⚠️ SEVEN OF THE EIGHT ARE NATIVE NODES, which sounds like a restriction and is mostly a
   discovery: a DelayNode holds its own history, so freezing one with unity feedback IS a
   beat repeat, and ramping another one's delayTime along a quadratic slows its read head to
   a stop, which IS a tape stop. Reverse is the one that cannot be had that way — it needs
   the samples themselves, backwards — so it is a worklet, on a branch of its own, and the
   note above loadReverse() says why it is not in the chain. */
Patchwork.fx = (() => {
"use strict";

const DIVS = {"1/4": 1, "1/8": .5, "1/16": .25, "1/32": .125};   // in beats
let div = "1/16";

let ctx = null, chain = null;
const on = new Set();               // which pads are down
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

/* ⚠️ WHAT TIME A PRESS SCHEDULES AGAINST. Live it is ctx.currentTime and nothing else could
   be. Offline it cannot be: an OfflineAudioContext's currentTime sits at 0 through the whole
   of setup and only moves once startRendering is called, so a harness that wants to press a
   pad two seconds in has no way to say so. One indirection, and every effect in this file
   can be rendered and measured rather than described — which is the difference between
   "the filter sweeps" and "the filter takes 33 dB off 4 kHz". */
let nowAt = null;
const now = () => (nowAt == null ? ctx.currentTime : nowAt);
const offline = () => nowAt != null;

const FADE = .004;                  // the crossfade every engage and release uses
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function divSeconds(){ return (DIVS[div] || .25) * Patchwork.clock.beatSeconds(); }
/* A beat to sweep in and a beat to sweep back, so the filter is a gesture you hear travelling
   rather than a switch. Tempo-relative because that is what makes it land musically, clamped
   so it is neither a click at 240 nor a wait at 40. */
function sweepSeconds(){ return clamp(Patchwork.clock.beatSeconds(), .3, 1.1); }

/* ⚠️ Ramp from the value we LAST WROTE, never from param.value. gain.value reports the last
   RENDERED value and a branch with nothing flowing through it is not rendered, so an idle
   send reads back as whatever it was when it last passed audio — bus.js paid for that
   diagnosis once already and the note there is worth reading. */
const held = new Map();
/* ⚠️ AND WHERE IT HAS GOT TO, which is not the same question. `held` remembers what a ramp
   was aimed AT; interrupt one half way and that is the wrong number to start the next ramp
   from. It cost the Stop pad its release: the fade to silence is written on press, so
   letting go early ramped the gain from 0 — a dropout to nothing and back — while the sound
   was still at full level. Every ramp writes down where it started, when, and how long it
   had, so any of them can be asked what it is worth right now. */
const sweeps = new Map();           // param -> {from, to, t0, dur, exp}
function valueOf(param){
  const s = sweeps.get(param);
  if (!s) return held.has(param) ? held.get(param) : param.value;
  const e = now() - s.t0;
  if (e <= 0) return s.from;
  if (e >= s.dur) return s.to;
  const k = e / s.dur;
  return s.exp ? s.from * Math.pow(s.to / s.from, k) : s.from + (s.to - s.from) * k;
}
function mark(param, from, to, t0, dur, exp){
  sweeps.set(param, {from, to, t0, dur: Math.max(1e-6, dur), exp: !!exp});
  held.set(param, to);
}
function set(param, to, dur){
  const t = now(), from = valueOf(param);
  param.cancelScheduledValues(t);
  param.setValueAtTime(from, t);
  if (dur > 0) param.linearRampToValueAtTime(to, t + dur);
  else param.setValueAtTime(to, t);
  mark(param, from, to, t, dur);
}
/* ⚠️ EXPONENTIAL, for anything measured in Hz. A filter ramped linearly from 20 kHz spends
   most of the sweep in the top two octaves, where nothing is, and then falls off a cliff
   through everything you can hear — which is what "instant" sounded like even at a tenth of
   a second. Frequency is logarithmic to the ear, so the ramp has to be too. */
function sweep(param, to, dur){
  const t = now(), from = Math.max(1e-4, valueOf(param)), target = Math.max(1e-4, to);
  param.cancelScheduledValues(t);
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(target, t + dur);
  mark(param, from, target, t, dur, true);
}
function put(param, v){ held.set(param, v); sweeps.delete(param); param.value = v; }

function build(){
  if (chain) return chain;
  buildInto(Patchwork.audio.context());
  Patchwork.audio.insert(chain.input, chain.out);
  return chain;
}

/* Split out so the offline harness can build the same graph into its own context. Every
   node, every ramp and every constant below is the shipped chain — a second copy written
   for measurement would measure the copy. */
function buildInto(useCtx){
  ctx = useCtx;
  const g = () => ctx.createGain();

  const input = g(), out = g();

  /* ---- stutter ----
     A DelayNode already holds the last maxDelayTime seconds of whatever went into it, so
     there is nothing to arm and nothing to capture: point the read head a division back,
     cut the input, open the feedback to unity, and the line recirculates exactly the audio
     that was in flight. Beat repeat, out of one node and two gains.

     The delayTime jump on engage would zip if you could hear it — you cannot, because the
     wet gain is still at zero when it happens and only crossfades up afterwards. */
  const stIn = g(), stDry = g(), stWet = g(), stFb = g();
  const stDelay = ctx.createDelay(2);
  put(stIn.gain, 1); put(stDry.gain, 1); put(stWet.gain, 0); put(stFb.gain, 0);
  input.connect(stDry); input.connect(stIn);
  stIn.connect(stDelay); stDelay.connect(stFb); stFb.connect(stDelay);
  stDelay.connect(stWet);
  const afterSt = g();
  stDry.connect(afterSt); stWet.connect(afterSt);

  const revTap = g(), revWet = g();
  put(revTap.gain, 1); put(revWet.gain, 0);
  input.connect(revTap); revWet.connect(afterSt);

  /* ---- tape stop ----
     Read position is t − d(t), so the playback rate is 1 − d′(t): hold delayTime still and
     nothing happens, ramp it along a quadratic and the rate falls linearly to zero. d(t) =
     t²/2T reaches T/2 after T seconds and the sound has pitched down to a halt by then.
     The gain follows it down, because a read head at rest sits on one sample and that is a
     DC offset rather than a note. */
  const tapeDelay = ctx.createDelay(1), tapeGain = g();
  put(tapeGain.gain, 1);
  afterSt.connect(tapeDelay); tapeDelay.connect(tapeGain);

  /* ---- gate ----
     Scheduled against the shared grid rather than run off an oscillator, so the chop lands
     on the beat instead of wherever the LFO happened to be when you pressed. Refilled by a
     timer while it is held — see startGate(). */
  const gate = g();
  put(gate.gain, 1);
  tapeGain.connect(gate);

  /* ---- crush ----
     Quantising the sample values, with no oversampling, so the aliasing is part of it. */
  const crushDry = g(), crushWet = g(), shaper = ctx.createWaveShaper();
  shaper.curve = crushCurve(5);
  shaper.oversample = "none";
  put(crushDry.gain, 1); put(crushWet.gain, 0);
  gate.connect(crushDry); gate.connect(shaper); shaper.connect(crushWet);
  const afterCrush = g();
  crushDry.connect(afterCrush); crushWet.connect(afterCrush);

  /* ---- delay throw ----
     Fed from a send so the dry never stops, and the feedback is left running on release —
     the tail carrying on after you let go is the entire gesture. */
  const dlSend = g(), dlFb = g();
  const dlDelay = ctx.createDelay(2);
  put(dlSend.gain, 0); put(dlFb.gain, .45);
  afterCrush.connect(dlSend); dlSend.connect(dlDelay);
  dlDelay.connect(dlFb); dlFb.connect(dlDelay);

  /* ---- the filter ----
     TWO filters, always in the path and both transparent when open, rather than one whose
     type is switched. Switching type on a node with audio running through it restarts its
     history and clicks; a lowpass parked at 20 kHz and a highpass at 20 Hz cost a pair of
     biquads and never do. */
  const lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
  lp.type = "lowpass";  put(lp.frequency, 20000); lp.Q.value = 1.0;
  hp.type = "highpass"; put(hp.frequency, 20);    hp.Q.value = .9;
  afterCrush.connect(lp); dlDelay.connect(lp);
  lp.connect(hp); hp.connect(out);

  chain = {input, out, stIn, stDry, stWet, stFb, stDelay,
           revTap, revWet, revNode: null,
           tapeDelay, tapeGain, gate, crushWet, crushDry, shaper,
           dlSend, dlDelay, dlFb, lp, hp};
  chain.revReady = loadReverse(ctx, chain);
  return chain;
}

/* ---- reverse ----
   ⚠️ THE ONE EFFECT NATIVE NODES CANNOT DO. Everything else in this file is a delay line
   read cleverly; reverse needs the samples themselves, backwards, so it is a worklet — and
   it is on a PARALLEL path rather than in the chain. addModule() is async and the chain is
   built synchronously, so a worklet in series would mean the master output waiting on a
   network-shaped promise before anything could be heard. On its own branch it listens the
   whole time, outputs silence until you press it, and if it never loads at all the other
   seven pads do not care.

   ⚠️ NO BACKTICK MAY APPEAR BELOW, not even in a comment: this is a template literal and a
   backtick ends it. LP·1's worklet carries the same warning, for the same reason and after
   the same outage.

   The window is faded at both ends. Reading a slab of audio backwards and looping it puts a
   discontinuity at the wrap, which is a click on every repetition — 3 ms of taper at each
   end costs nothing and is why this sounds like an effect rather than a fault. */
const REV_SRC = `
class PunchReverse extends AudioWorkletProcessor {
  constructor(){
    super();
    this.n = Math.floor(sampleRate * 4);
    this.buf = [new Float32Array(this.n), new Float32Array(this.n)];
    this.w = 0;              // write head, frozen while engaged
    this.on = false;
    this.len = 1;            // samples in the window being read backwards
    this.r = 0;              // how far into that window, counting down
    this.fade = Math.max(8, Math.floor(sampleRate * .003));
    this.q = [];
    /* A message has no timestamp. Live that is fine — you pressed it, you meant now — but a
       render schedules its whole script before startRendering, so every message would arrive
       before the first sample and the freeze would capture an empty buffer. Measured exactly
       that: a reverse that should have been at full level came back as digital silence.
       An optional time, checked against the clock this side, and the same code answers both. */
    this.port.onmessage = e => { if (e.data) this.q.push(e.data); };
  }
  due(){
    while (this.q.length){
      const d = this.q[0];
      if (d.at != null && d.at > currentTime) return;
      this.q.shift();
      if (d.op === "on"){
        this.on = true;
        this.start = this.w;
        this.len = Math.max(this.fade * 2 + 2,
                            Math.min(this.n - 1, Math.floor(d.len * sampleRate)));
        this.r = this.len - 1;
      } else if (d.op === "off"){
        this.on = false;
      }
    }
  }
  process(inputs, outputs){
    this.due();
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const L = out[0], R = out[1] || out[0];
    const iL = inp && inp[0] ? inp[0] : null;
    const iR = inp && inp[1] ? inp[1] : iL;
    for (let i = 0; i < L.length; i++){
      if (!this.on){
        this.buf[0][this.w] = iL ? iL[i] : 0;
        this.buf[1][this.w] = iR ? iR[i] : 0;
        this.w = this.w + 1 === this.n ? 0 : this.w + 1;
        L[i] = 0; R[i] = 0;          // silent: the dry path is carrying the sound
        continue;
      }
      let idx = (this.start - this.len + this.r) % this.n;
      if (idx < 0) idx += this.n;
      let env = 1;
      if (this.r < this.fade) env = this.r / this.fade;
      else if (this.r > this.len - 1 - this.fade) env = (this.len - 1 - this.r) / this.fade;
      L[i] = this.buf[0][idx] * env;
      R[i] = this.buf[1][idx] * env;
      this.r = this.r > 0 ? this.r - 1 : this.len - 1;
    }
    return true;
  }
}
registerProcessor("punch-reverse", PunchReverse);
`;

let revURL = null;
async function loadReverse(c, ch){
  try{
    if (!revURL) revURL = URL.createObjectURL(new Blob([REV_SRC], {type: "application/javascript"}));
    await c.audioWorklet.addModule(revURL);
    const n = new AudioWorkletNode(c, "punch-reverse",
      {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]});
    ch.revTap.connect(n); n.connect(ch.revWet);
    /* onto the chain it was built for, not onto whichever one the module happens to be
       holding now — an offline render swaps that out and puts it back while this promise is
       still in flight */
    ch.revNode = n;
    return n;
  }catch(e){ return null; }
}

/* Whether the dry should be heard at all: stutter and reverse each replace it, so the
   answer is one question asked of both rather than two gains fighting over one node. */
function dryLevel(){ return (on.has("stutter") || on.has("reverse")) ? 0 : 1; }

function engageReverse(c, t){
  c.revNode.port.postMessage({op: "on", len: clamp(divSeconds(), .02, 3.5),
                              at: offline() ? t : null});
  set(c.revWet.gain, 1, FADE);
  set(c.stDry.gain, dryLevel(), FADE);
}

/* bits of resolution, as a lookup the shaper reads per sample */
function crushCurve(bits){
  const steps = Math.pow(2, bits), n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * steps) / steps;
  }
  return c;
}

/* ---- the gate's chop ----
   Aligned to the grid origin, so pressing it mid-bar still lands the chops on the division
   and not on your reaction time. Scheduled a third of a second ahead and refilled on a
   timer: an AudioParam has no loop, and the alternative — one long curve written on engage
   — cannot follow a tempo change or stop cleanly when you let go. */
let gateTimer = null, gateFilled = 0;
function fillGate(until){
  const c = chain, t = now(), step = divSeconds();
  if (!(step > 0)) return;
  /* offline there is no shared grid to align to — the render's own zero is the only origin
     there is, and aligning to a live clock's would put every chop outside the buffer */
  const origin = offline() ? null : Patchwork.clock.origin;
  const base = origin == null ? t : origin;
  let k = Math.ceil((Math.max(t, gateFilled) - base) / step);
  const stop = until == null ? t + .3 : until;
  const p = c.gate.gain;
  for (let n = 0; n < 4096; n++){
    const at = base + k * step;
    if (at > stop) break;
    if (at >= t){
      p.setValueAtTime(1, at);
      p.linearRampToValueAtTime(1, at + .002);
      p.setValueAtTime(1, at + step * .45);
      p.linearRampToValueAtTime(0, at + step * .45 + .004);
    }
    gateFilled = at + step;
    k++;
  }
}
function startGate(until){
  const p = chain.gate.gain;
  p.cancelScheduledValues(now());
  gateFilled = 0;
  fillGate(until);
  /* the timer is the live half: an AudioParam has no loop, so the chop is topped up as it
     goes. Offline the whole render is written in one pass and there is nothing to top up. */
  if (until == null) gateTimer = setInterval(() => fillGate(), 120);
}
function stopGate(){
  if (gateTimer) clearInterval(gateTimer);
  gateTimer = null;
  set(chain.gate.gain, 1, FADE);
}

/* ---- the pads ---- */
let tapeAt = 0;
const TAPE_T = .9;                  // how long the machine takes to stop

function press(id){
  if (on.has(id)) return;
  if (!offline()){ build(); Patchwork.audio.resume(); }
  const c = chain, t = now();
  on.add(id);
  if (id === "stutter"){
    /* the read head moves while the wet side is still silent, so the jump is not heard */
    c.stDelay.delayTime.cancelScheduledValues(t);
    c.stDelay.delayTime.setValueAtTime(clamp(divSeconds(), .01, 1.9), t);
    set(c.stFb.gain, 1, 0);
    set(c.stIn.gain, 0, 0);
    set(c.stWet.gain, 1, FADE);
    set(c.stDry.gain, dryLevel(), FADE);
  } else if (id === "reverse"){
    /* ⚠️ THE WORKLET MAY NOT BE THERE YET, and the first press after a page load is exactly
       when it is not — the chain is built on that press and addModule is a promise. Dropping
       the press was the first version and it is the worst possible answer: the pad lights
       nothing, nothing happens, and pressing it again works, so it reads as a flaky control
       rather than a slow one. It is queued instead, and lands the moment the module does —
       unless you let go first, which is what the on.has() is asking. */
    if (c.revNode) engageReverse(c, t);
    else c.revReady.then(() => {
      if (chain === c && c.revNode && on.has("reverse")) engageReverse(c, now());
    });
  } else if (id === "stop"){
    tapeAt = t;
    const n = 64, curve = new Float32Array(n);
    for (let i = 0; i < n; i++){
      const x = (i / (n - 1)) * TAPE_T;
      curve[i] = (x * x) / (2 * TAPE_T);
    }
    const p = c.tapeDelay.delayTime;
    p.cancelScheduledValues(t);
    p.setValueCurveAtTime(curve, t, TAPE_T);
    held.set(p, TAPE_T / 2);
    /* down at the end rather than throughout: a machine losing speed is still loud until
       it is nearly stopped, and fading from the start just sounds like a fade */
    const gp = c.tapeGain.gain;
    gp.cancelScheduledValues(t);
    gp.setValueAtTime(1, t);
    gp.setValueAtTime(1, t + TAPE_T * .6);
    gp.linearRampToValueAtTime(0, t + TAPE_T);
    /* written down so releasing mid-fall knows how loud it still is — see valueOf() */
    mark(gp, 1, 0, t + TAPE_T * .6, TAPE_T * .4);
  } else if (id === "gate"){
    startGate(offline() ? t + RENDER_TAIL : null);
  } else if (id === "crush"){
    set(c.crushWet.gain, 1, FADE);
    set(c.crushDry.gain, 0, FADE);
  } else if (id === "delay"){
    c.dlDelay.delayTime.setValueAtTime(clamp(divSeconds(), .01, 1.9), t);
    set(c.dlSend.gain, .8, FADE);
  } else if (id === "lp"){
    sweep(c.lp.frequency, 200, sweepSeconds());
  } else if (id === "hp"){
    sweep(c.hp.frequency, 1600, sweepSeconds());
  }
  notify();
}

function release(id){
  if (!on.has(id)) return;
  on.delete(id);
  if (!chain){ notify(); return; }
  const c = chain, t = now();
  if (id === "stutter"){
    set(c.stWet.gain, 0, FADE);
    set(c.stDry.gain, dryLevel(), FADE);
    set(c.stFb.gain, 0, 0);
    set(c.stIn.gain, 1, 0);
  } else if (id === "reverse"){
    set(c.revWet.gain, 0, FADE);
    set(c.stDry.gain, dryLevel(), FADE);
    /* told to start writing again only after the crossfade, or the last few milliseconds of
       the reversed window are overwritten by live audio while you can still hear them */
    if (c.revNode){
      if (offline()) c.revNode.port.postMessage({op: "off", at: t + FADE + .008});
      else setTimeout(() => { try{ c.revNode.port.postMessage({op: "off"}); }catch(x){} },
                      Math.ceil(FADE * 1000) + 8);
    }
  } else if (id === "stop"){
    /* ⚠️ How far the read head actually got, from elapsed time rather than off delayTime —
       which reports the last RENDERED value and is a ghost the moment a branch goes quiet.
       Letting go early has to spin up from where it was, not from the bottom. */
    const e = Math.min(TAPE_T, t - tapeAt);
    const d = (e * e) / (2 * TAPE_T);
    /* ⚠️ THE SPIN-UP IS PACED BY HOW FAR IT FELL, not by a fixed time. Closing a 450 ms
       offset in 220 ms means playing at three times speed to catch up, which is a chipmunk
       zip rather than a machine coming back — and it was over before you could hear what it
       was. Rate is 1 + d/S, so S = d/.55 holds the catch-up at 1.55x however far it got: a
       long stop glides back over most of a second, a quick tap is back almost at once. */
    const spin = clamp(d / .55, .12, 1.0);
    const p = c.tapeDelay.delayTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(d, t);
    p.linearRampToValueAtTime(0, t + spin);
    mark(p, d, 0, t, spin);
    /* and the level comes back from wherever the fall had got to, over the same glide, so
       the machine is audible while it picks up speed instead of snapping on at the end */
    set(c.tapeGain.gain, 1, Math.min(spin, .35));
  } else if (id === "gate"){
    stopGate();
  } else if (id === "crush"){
    set(c.crushWet.gain, 0, FADE);
    set(c.crushDry.gain, 1, FADE);
  } else if (id === "delay"){
    /* the send closes and the feedback is left alone: the tail is the throw */
    set(c.dlSend.gain, 0, FADE);
  } else if (id === "lp"){
    sweep(c.lp.frequency, 20000, sweepSeconds());
  } else if (id === "hp"){
    sweep(c.hp.frequency, 20, sweepSeconds());
  }
  notify();
}

function releaseAll(){ [...on].forEach(release); }

function setDiv(v){
  if (!DIVS[v]) return;
  div = v;
  /* a size changed under a held pad follows it, which is half the fun of the size buttons */
  if (chain && on.has("stutter"))
    chain.stDelay.delayTime.setValueAtTime(clamp(divSeconds(), .01, 1.9), now());
  if (chain && on.has("delay"))
    chain.dlDelay.delayTime.setValueAtTime(clamp(divSeconds(), .01, 1.9), now());
  if (chain && on.has("reverse") && chain.revNode)
    chain.revNode.port.postMessage({op: "on", len: clamp(divSeconds(), .02, 3.5), at: null});
  if (on.has("gate")){ stopGate(); startGate(); }
  notify();
}

/* ---- the harness ----
   A test hook, not a feature, the same one every instrument in this repo carries. Renders
   the real chain into an OfflineAudioContext with a source of the caller's choosing and a
   script of presses, so what a pad DOES can be measured.

   Everything is put back in a finally, including which pads were down: an exception mid
   render must not leave the live page holding a chain that belongs to a context that no
   longer exists. */
const RENDER_TAIL = 30;             // how far ahead a gate is written when there is no timer
async function render(o){
  const dur = o.dur || 3, rate = o.rate || 48000;
  const saved = {ctx, chain, on: [...on], gateTimer, held: new Map(held), nowAt};
  const off = new OfflineAudioContext(2, Math.ceil(rate * dur), rate);
  try{
    ctx = null; chain = null; on.clear(); held.clear(); gateTimer = null;
    buildInto(off);
    chain.out.connect(off.destination);
    /* the worklet loads asynchronously and a render that did not wait would measure the
       seven effects that do not need it and silence for the one that does */
    await chain.revReady;
    if (o.source) o.source(off, chain.input);
    (o.at || []).forEach(a => {
      nowAt = a.t;
      if (a.press) press(a.press);
      if (a.release) release(a.release);
    });
    nowAt = null;
    return await off.startRendering();
  } finally {
    if (gateTimer) clearInterval(gateTimer);
    ctx = saved.ctx; chain = saved.chain; gateTimer = saved.gateTimer; nowAt = saved.nowAt;
    on.clear(); saved.on.forEach(x => on.add(x));
    held.clear(); saved.held.forEach((v, k) => held.set(k, v));
  }
}

/* A test hook, not a feature — the same one every instrument here carries. The chain is
   exposed so a harness can listen to its output; nothing in the page reads it. */
window.__fx = {render, get chain(){ return chain; }, get on(){ return new Set(on); }};

/* Build the chain before it is needed, so the reverse worklet has loaded by the time
   anybody presses it. Called when the live page is opened — a click, so creating the audio
   context here is a gesture rather than an autoplay attempt. */
function prime(){ build(); return !!chain; }

return {press, release, releaseAll, setDiv, render, prime,
        onChange: fn => subs.push(fn),
        active: id => on.has(id),
        get div(){ return div; },
        get divs(){ return Object.keys(DIVS); },
        get any(){ return on.size > 0; }};
})();
