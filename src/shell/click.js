
/* The metronome.

   It belongs to the page, not to an instrument. It started inside LP·1 because that is
   where you need it — you play a take to a click — but a click is the same thing the whole
   rack is counting against, so it sits beside the tempo in the Scenes head and lives here.

   ⚠️ It has its OWN strip, and the looper's tap excludes it. LP·1 records a sum of every
   strip except the ones it names; a click anywhere else on the bus would be printed into
   every take, audible in the loop for the rest of the session and doubled by the first
   overdub. Measured before the move and again after: a take cut with only the click
   running has an input peak of 0.

   It runs on the shared clock like any other voice, so it IS the tempo rather than a second
   opinion about it. Started alone it claims the grid, and whatever starts next lands in
   phase with the click — which is what a metronome is for. */
Patchwork.click = (() => {
"use strict";

let ctx = null, gain = null, on = false, level = .7, nextAt = 0;
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

/* The strip id, so LP·1 can name it in its exclusion list. */
const STRIP = "click";

function blip(t, accent){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(accent ? 1560 : 1040, t);
  /* a 2 ms rise, because a square starting at full level clicks in a way that reads as a
     fault rather than as a click track */
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(accent ? .5 : .28, t + .002);
  g.gain.exponentialRampToValueAtTime(.0004, t + .042);
  o.connect(g); g.connect(gain);
  o.start(t); o.stop(t + .06);
}

function tick(){
  if (!on || !ctx) return;
  const beat = 60 / (Patchwork.clock.bpm || 120);
  const origin = Patchwork.clock.origin;
  while (nextAt < ctx.currentTime + .2){
    const at = Math.max(ctx.currentTime + .005, nextAt);
    /* The accent comes from the grid ORIGIN, not from counting blips: claim(1) lands on the
       next beat, not the next bar, so counting would put the downbeat wherever you happened
       to press the button. */
    const n = origin == null ? 0 : Math.round((at - origin) / beat);
    blip(at, (((n % 4) + 4) % 4) === 0);
    nextAt += beat * Patchwork.clock.rate;
  }
}

function set(want){
  on = !!want;
  if (on){
    ctx = Patchwork.audio.context();
    Patchwork.audio.resume();
    if (!gain){
      gain = ctx.createGain();
      gain.gain.value = level;
      gain.connect(Patchwork.audio.strip(STRIP));
    }
    nextAt = Patchwork.clock.claim(1);
    tick();
    Patchwork.clock.run(tick);
  } else {
    Patchwork.clock.stop(tick);
  }
  notify();
}

function setLevel(v){
  level = Math.max(0, Math.min(1, v));
  if (gain) gain.gain.setTargetAtTime(level, ctx.currentTime, .01);
  notify();
}

return {set, setLevel, toggle: () => set(!on), STRIP,
        onChange: fn => subs.push(fn),
        get on(){ return on; },
        get level(){ return level; }};
})();
