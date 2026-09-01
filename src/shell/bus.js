
/* One AudioContext for the page.

   Two instruments each opening their own context worked — the OS mixer summed them —
   but it makes everything after this impossible: two contexts have two `currentTime`
   origins and two independent clocks, so nothing scheduled against one can line up
   with the other. A shared time base is the thing the clock in Phase 3 needs, and it
   is the reason to do this first.

   Levels are unchanged. Each instrument already ends in its own compressor and master
   gain; the strip below is unity, and summing here is what the OS mixer was doing
   anyway. A master section that actually processes is a later decision, not a side
   effect of merging. */
Patchwork.audio = (() => {
"use strict";

const MASTER_DEFAULT = .4;
let ctx = null, master = null, end = null;
const strips = new Map();   // id -> {in, out}
const levels = new Map();   // id -> fader gain, remembered even before the strip exists
const mutes = new Set();    // ids held silent
const solos = new Set();    // ids held audible — while any exist, everything else is not
const applied = new Map();  // id -> the gain last written to the node, to ramp from

function context(){
  if (!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    /* ⚠️ THE MASTER STARTS DOWN, and this was measured rather than guessed. Seven channels
       summing at unity peaks around +5 dBFS on the default pattern — 91 samples past full
       scale in a four-second measurement — so the mix clipped before it ever reached the
       tape, and the recorder's clamp was the only thing standing between a take and audible
       distortion.

       0.4 is 8 dB down, which lands the same pattern at about -2.7 dBFS. Half only reached
       -0.8 — clean, but one more instrument away from clipping again, and a default that
       survives only the exact material it was measured on is not a default. The console's
       master fader is where the headroom gets spent. */
    master.gain.value = MASTER_DEFAULT;
    /* ⚠️ ONE NODE EVERYTHING PASSES THROUGH ON ITS WAY OUT, whether or not anything is
       spliced in behind it. Without it, "what the speakers are getting" is master before a
       punch rack exists and the rack's output afterwards — two different nodes depending on
       when you asked, which is not something a recorder can be built on. */
    end = ctx.createGain();
    end.gain.value = 1;
    master.connect(end);
    end.connect(ctx.destination);
  }
  return ctx;
}

/* Where an instrument sends its output instead of ctx.destination. One per instrument,
   so a mixer — or a solo button — has something to hold on to later. Later is now.

   TWO NODES, not one. `in` is where the instrument plays and where every tap listens;
   `out` carries the fader on its way to master. What that buys is the answer to a question
   a one-node strip cannot even ask:

   ⚠️ TAPS ARE PRE-FADER. Your mix changes what YOU hear and nothing else — not what the
   looper prints, not what the vocoder is modulated by. Post-fader is the other defensible
   answer and it is the one to avoid here, because a take gets PUSHED: pull the drums down
   for yourself, record the studio output, and you would hand the room a loop with quiet
   drums in it and no way to know why. Worse with per-instrument sources, where your own
   mix would silently rewrite a take of somebody ELSE's instrument. A monitor balance is
   not supposed to leave your headphones. */
/* ---- the channel strip ----
   A console channel, in the order a console has them:

     in → low → mid → high → comp → makeup → FADER → pan → master
                                              └→ reverb send ─┐
                                              └→ delay send  ─┴→ back into master

   ⚠️ THE PROCESSING GOES BEFORE `out`, NOT AROUND IT. `out` is the fader that setLevel,
   mute, solo and every saved scene already write to; splicing the EQ in ahead of it means
   none of that has to know this exists. Put it after and every one of those would be
   adjusting the wrong node.

   ⚠️ THE SENDS ARE POST-FADER, tapped off `out`. That is what an engineer expects: pull a
   channel down and its reverb goes with it. Pre-fader sends leave a ghost of a muted
   channel hanging in the room, which reads as a bug even though some desks do it on
   purpose. */
function buildChannel(into, out){
  const lo = ctx.createBiquadFilter();
  lo.type = "lowshelf"; lo.frequency.value = 120; lo.gain.value = 0;
  const mid = ctx.createBiquadFilter();
  /* the sweepable one — a semi-parametric mid is the band worth having if you only get one,
     because it is where instruments actually collide with each other */
  mid.type = "peaking"; mid.frequency.value = 900; mid.Q.value = 1.1; mid.gain.value = 0;
  const hi = ctx.createBiquadFilter();
  hi.type = "highshelf"; hi.frequency.value = 6000; hi.gain.value = 0;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = 0; comp.ratio.value = 1;      // transparent until asked
  comp.knee.value = 12; comp.attack.value = .006; comp.release.value = .18;
  const makeup = ctx.createGain(); makeup.gain.value = 1;

  /* ⚠️ NOT StereoPannerNode, and this was measured rather than assumed.
     DynamicsCompressorNode is spec'd channelCount 2 / mode "explicit", so it upmixes this
     mono channel to stereo. StereoPannerNode then stops using its mono equal-power law and
     switches to the STEREO one, which at hard left computes outL = L + R — and for a
     mono-derived signal where L equals R that is +6 dB. Panning a track hard made it
     audibly jump in level, which is useless on a desk.

     So the balance is built by hand: force stereo at the fader, split, apply equal power to
     each side, merge. Constant power at every position for mono sources, and a real balance
     control for anything genuinely stereo instead of folding it down. */
  out.channelCount = 2;
  out.channelCountMode = "explicit";
  out.channelInterpretation = "speakers";
  const split = ctx.createChannelSplitter(2);
  const panL = ctx.createGain(), panR = ctx.createGain();
  const merge = ctx.createChannelMerger(2);
  panL.gain.value = Math.SQRT1_2; panR.gain.value = Math.SQRT1_2;

  const revSend = ctx.createGain(); revSend.gain.value = 0;
  const dlySend = ctx.createGain(); dlySend.gain.value = 0;

  into.connect(lo); lo.connect(mid); mid.connect(hi);
  hi.connect(comp); comp.connect(makeup); makeup.connect(out);
  out.connect(split);
  split.connect(panL, 0); split.connect(panR, 1);
  panL.connect(merge, 0, 0); panR.connect(merge, 0, 1);
  merge.connect(master);
  out.connect(revSend); revSend.connect(reverbIn());
  out.connect(dlySend); dlySend.connect(delayIn());
  return {lo, mid, hi, comp, makeup, panL, panR, revSend, dlySend};
}

function strip(id){
  context();
  if (!strips.has(id)){
    const into = ctx.createGain(), out = ctx.createGain();
    into.gain.value = 1;
    out.gain.value = gainFor(id);
    applied.set(id, out.gain.value);
    const ch = buildChannel(into, out);
    /* the meter bridge listens here — post-fader, so a meter follows its own fader the way
       the one on a desk does */
    ch.out = out; ch.in = into;
    strips.set(id, {in: into, out, ch});
    taps.forEach(wireTap);          // an instrument built after a tap still reaches it
  }
  return strips.get(id).in;
}

/* ---- the two effects the whole desk shares ----
   Built on first use rather than at startup: a page that never opens the console never
   pays for a convolver. */
let revBus = null, dlyBus = null, revReturn = null, dlyReturn = null, dlyNode = null, dlyFb = null;
function reverbIn(){
  if (revBus) return revBus;
  revBus = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = makeIR(1.9, 2.6);
  revReturn = ctx.createGain(); revReturn.gain.value = .8;
  /* a little top off the tail — a bright plate on everything at once turns to hiss */
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass"; damp.frequency.value = 5200;
  revBus.connect(conv); conv.connect(damp); damp.connect(revReturn); revReturn.connect(master);
  return revBus;
}
function delayIn(){
  if (dlyBus) return dlyBus;
  dlyBus = ctx.createGain();
  dlyNode = ctx.createDelay(2.0);
  dlyNode.delayTime.value = .375;                      // a dotted eighth at 120
  dlyFb = ctx.createGain(); dlyFb.gain.value = .34;
  /* ⚠️ The repeats get darker each pass. Feedback through a flat delay stacks the same
     bright transient over and over and the tail turns to a rattle — one filter inside the
     loop is the difference between an echo and a machine gun. */
  const dark = ctx.createBiquadFilter();
  dark.type = "lowpass"; dark.frequency.value = 3200;
  dlyReturn = ctx.createGain(); dlyReturn.gain.value = .8;
  dlyBus.connect(dlyNode);
  dlyNode.connect(dark); dark.connect(dlyFb); dlyFb.connect(dlyNode);
  dlyNode.connect(dlyReturn); dlyReturn.connect(master);
  return dlyBus;
}
/* Exponential-decay noise: cheap, and for a send reverb behind seven instruments it is
   indistinguishable from something cleverer. */
function makeIR(seconds, decay){
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++){
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return buf;
}

/* ---- the mix ----
   One gain per instrument, and NOTHING here is shared with a jam. That is the whole point
   of it rather than an omission: everybody renders the same patterns through their own
   speakers, in their own room, and the balance that works in one is not the balance that
   works in another. Patterns and patches are shared because they are the MUSIC; a mix is
   how you happen to be listening to it.

   ⚠️ Which is also why it must never be registered with session.registerPatch(). That
   would poll it, notice it differed from the last thing sent, and push your balance to
   everyone — the failure being that it works perfectly alone and only goes wrong with
   somebody else in the room.

   Levels are kept here as well as on the node, so the mixer can be set before the
   instrument has ever made a sound. A strip is not built until its instrument first plays,
   and a fader that silently did nothing until then would be the kind of bug you blame on
   the audio rather than on the order things happened in. */
/* ⚠️ ANSWERED FROM THE MAP, NEVER FROM THE NODE. `gain.value` looks like the obvious
   source of truth and is not one: it reports the value from the last render quantum in
   which that node was PROCESSED, and Chrome does not process a branch with nothing
   flowing through it. So a strip whose instrument is not currently sounding reports
   whatever its gain happened to be when it last made a noise, no matter what has been set
   since — the automation underneath is perfectly correct and the readback is a ghost.

   It cost a real diagnosis: one fader read 0.5 while its audio measurably ran at 0.2, and
   only that instrument, because only that one had gone quiet. What made it convincing was
   that every other fader was right — the ones still playing. The mixer's model is this
   map; the AudioParam is what the map does to the sound. */
function level(id){
  return levels.has(id) ? levels.get(id) : 1;
}

/* ---- mute and solo ----
   Standard mixer rules, and worth writing down because "obvious" here is only obvious once
   you have used a mixer: a mute silences that one strip; a solo silences everything that is
   NOT soloed, and several can be soloed at once. Mute wins over solo, so soloing a track you
   have muted leaves it silent rather than quietly un-muting it behind your back.

   ⚠️ They live on the SAME node as the fader, which puts them post-tap like it — your mute
   changes what you hear and not what the looper prints or what the vocoder is modulated by.
   A mute that silenced a take being recorded would be the worst kind of surprise: you would
   not find out until you played the loop back. */
function gainFor(id){
  if (mutes.has(id)) return 0;
  if (solos.size && !solos.has(id)) return 0;
  return levels.has(id) ? levels.get(id) : 1;
}
/* Ramped, not assigned: a gain that jumps clicks, and a fader drag is a jump per frame.
   Cancel first, and ramp from the value we KNOW we last wrote rather than from gain.value —
   which reports the last RENDERED value and is a ghost on a strip that has gone quiet. Plus
   setTargetAtTime approaches forever and never clears, so a dragged fader would pile an
   event per frame onto a timeline nothing ever empties. */
function applyGain(id){
  const s = strips.get(id);
  const g = gainFor(id);
  if (!s || !ctx){ applied.set(id, g); return g; }
  const from = applied.has(id) ? applied.get(id) : 1;
  const t = ctx.currentTime, p = s.out.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(from, t);
  p.linearRampToValueAtTime(g, t + .02);
  applied.set(id, g);
  return g;
}
function setLevel(id, v){
  const g = Math.max(0, Math.min(1, +v || 0));
  levels.set(id, g);
  applyGain(id);
  return g;
}
function setMute(id, on){
  if (on) mutes.add(id); else mutes.delete(id);
  applyGain(id);
  return mutes.has(id);
}
/* ⚠️ Every strip, not just this one. Soloing a track changes what you hear from all the
   others, and that is the entire point of the control — repainting only the one you clicked
   is the bug that makes solo look like it does nothing. */
function setSolo(id, on){
  if (on) solos.add(id); else solos.delete(id);
  const ids = new Set([...strips.keys(), ...levels.keys(), ...mutes, ...solos]);
  ids.forEach(applyGain);
  return solos.has(id);
}
function muted(id){ return mutes.has(id); }
function soloed(id){ return solos.has(id); }
/* what a strip is actually doing, once the fader, the mute and everyone else's solo have
   had their say — the number the meter would show, as opposed to where the fader is */
function audible(id){ return gainFor(id); }

/* A sum of every instrument's strip EXCEPT one — what the looper records when you point
   it at the studio rather than a microphone.

   Excluding the caller is the whole point: the looper's own output goes to its strip and
   on to master, so recording master would record the looper recording itself and build
   until it clips. Taps are kept and re-wired when a new strip appears, because an
   instrument can be built after the tap was made. */
const taps = [];
/* `exclude` is one id or several. The looper needs three — its own strip, the metronome's
   and the talkback's — because a click or a voice on the bus would be printed into every
   take from then on. */
function tap(exclude){
  return makeTap({exclude: [].concat(exclude || [])});
}

/* The other direction: a sum of ONLY the named strips.

   Same machinery, opposite question. "Everything except me" is what you want when you are
   capturing the band; "just this one" is what you want when you are capturing a part — the
   drums to loop under a bass line, say — and the difference between them is a whole
   feature rather than a knob, because a take with the whole studio printed into it can
   never be separated again afterwards.

   ⚠️ Point this at a strip, never AT the strip itself. Handing out `strips.get(id)` would
   be one node fewer and would work perfectly until the caller released it: disconnect()
   with no argument drops every outgoing connection, so releasing that input would also cut
   the instrument off from master and silence it with nothing to say why. */
function tapOnly(include){
  return makeTap({only: [].concat(include || [])});
}

function makeTap(spec){
  context();
  const g = ctx.createGain();
  g.gain.value = 1;
  const t = Object.assign({node: g, wired: new Set()}, spec);
  taps.push(t);
  wireTap(t);
  return g;
}
function wireTap(t){
  strips.forEach((s, id) => {
    if (t.wired.has(id)) return;
    if (t.only ? t.only.indexOf(id) < 0 : t.exclude.indexOf(id) >= 0) return;
    s.in.connect(t.node);            // .in, not .out — see the pre-fader warning above
    t.wired.add(id);
  });
}

/* ⚠️ A TAP HAS TO BE RELEASED, not merely disconnected downstream.

   Every strip holds a connection INTO the tap, and `taps` holds the tap so that an
   instrument built later still reaches it. Dropping only the tap's own output leaves both:
   the node is inaudible, so nothing sounds wrong, and it quietly stays wired to every
   strip on the page forever — plus each new strip joins it. One abandoned tap per input
   change was survivable when the only source was the whole studio and you chose it once.
   Choosing between six instruments makes changing source a normal gesture, so the graph
   has to come apart as cleanly as it went together.

   Safe to call on anything: a node that is not a tap is simply not one, and says so. */
function untap(node){
  const i = taps.findIndex(t => t.node === node);
  if (i < 0) return false;
  const t = taps.splice(i, 1)[0];
  t.wired.forEach(id => {
    const s = strips.get(id);
    if (s) try{ s.in.disconnect(t.node); }catch(e){}
  });
  try{ t.node.disconnect(); }catch(e){}
  return true;
}

/* ---- the master insert ----
   Splice a chain between master and the speakers. One, because there is one master; a
   second caller is a bug rather than a feature and is told so.

   ⚠️ AFTER EVERY TAP. The taps hang off each strip's input (see the pre-fader note above),
   so nothing spliced here can reach the looper — a punch-in effect is a moment you play,
   not something to find printed into a take on every pass afterwards. That is a
   consequence of where the taps are rather than a decision made here, and it is the
   reason this comment exists.

   The disconnect and the connects are one synchronous block, so the graph is never
   half-rewired at a render quantum boundary. */
let inserted = null;
function insert(input, output){
  context();
  if (inserted) return false;
  master.disconnect();
  master.connect(input);
  output.connect(end);
  inserted = {input, output};
  return true;
}

/* ---- the console ----
   Everything the mixer page writes to. Values are the human ones — decibels, hertz, -1..1 —
   and the mapping to node units lives here so the UI never has to know it. */
function channel(id){
  strip(id);
  return strips.get(id).ch;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const eq = {
  low(id, db){ channel(id).lo.gain.value = clamp(db, -18, 18); },
  mid(id, db){ channel(id).mid.gain.value = clamp(db, -18, 18); },
  midFreq(id, hz){ channel(id).mid.frequency.value = clamp(hz, 200, 6000); },
  high(id, db){ channel(id).hi.gain.value = clamp(db, -18, 18); },
};
/* ⚠️ ONE KNOB, NOT FIVE. Threshold, ratio, knee, attack and release on seven channels is
   thirty-five controls nobody will touch. This sweeps threshold down and ratio up together
   along the curve an engineer would have walked anyway, and makes up the level it took —
   so turning it up sounds like more compression rather than like less signal. */
function compression(id, amount){
  const a = clamp(amount, 0, 1), c = channel(id);
  c.comp.threshold.value = -40 * a;
  c.comp.ratio.value = 1 + 7 * a;
  c.makeup.gain.value = Math.pow(10, (a * 9) / 20);
}
/* equal power: the two sides are cos and sin of the same angle, so their squares always
   sum to one and the channel holds its loudness wherever it sits in the image */
/* The stereo master. Ramped rather than set, because this is a fader somebody moves while
   a take is running and a stepped gain change is a click on the tape. */
function masterLevel(){ return master ? master.gain.value : MASTER_DEFAULT; }
function setMasterLevel(v){
  context();
  const g = clamp(+v || 0, 0, 1.5);
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(g, ctx.currentTime, .02);
  return g;
}

function pan(id, v){
  const c = channel(id), x = (clamp(v, -1, 1) + 1) / 2;
  c.panL.gain.value = Math.cos(x * Math.PI / 2);
  c.panR.gain.value = Math.sin(x * Math.PI / 2);
}
function send(id, which, v){
  const c = channel(id);
  (which === "delay" ? c.dlySend : c.revSend).gain.value = clamp(v, 0, 1.2);
}
const masterFx = {
  reverbReturn(v){ reverbIn(); revReturn.gain.value = clamp(v, 0, 1.5); },
  delayReturn(v){ delayIn(); dlyReturn.gain.value = clamp(v, 0, 1.5); },
  delayTime(sec){ delayIn(); dlyNode.delayTime.linearRampToValueAtTime(
      clamp(sec, .02, 2), ctx.currentTime + .08); },
  delayFeedback(v){ delayIn(); dlyFb.gain.value = clamp(v, 0, .85); },
};

/* ---- what the room is hearing ----
   A node carrying the finished signal: every instrument, the mix, and whatever the punch
   rack is doing to it. This is what a master recorder has to listen to.

   ⚠️ THE OPPOSITE END OF THE BUS FROM tap(). A tap listens to each instrument's input,
   pre-fader and pre-everything, because a loop it prints has to be re-mixable afterwards.
   This listens to the last node before the speakers, because a RECORD of a performance
   that left out the filter sweep you played would not be a record of the performance.
   Both are correct; they are answering different questions. */
function monitor(){
  context();
  const g = ctx.createGain();
  g.gain.value = 1;
  end.connect(g);
  return g;
}
/* iOS parks the context in "suspended" until a gesture and in "interrupted" after a
   call or an app switch, so anything other than "running" needs a resume — not just
   "suspended". Both instruments carried this comment; now one place does. */
function resume(){
  context();
  if (ctx.state !== "running"){
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  }
  return ctx.state;
}

return {context, strip, resume, tap, tapOnly, untap, insert, monitor,
        channel, eq, compression, pan, send, masterFx,
        masterLevel, setMasterLevel,
        get masterDefault(){ return MASTER_DEFAULT; },
        level, setLevel,
        setMute, setSolo, muted, soloed, audible,
        get anySolo(){ return solos.size > 0; },
        get ctx(){ return ctx; },
        get master(){ return master; },
        /* the input nodes, which is what a strip has always meant to a caller */
        get strips(){ return new Map([...strips].map(([id, s]) => [id, s.in])); }};
})();
