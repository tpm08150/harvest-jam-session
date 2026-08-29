
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

let ctx = null, master = null;
const strips = new Map();

function context(){
  if (!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  return ctx;
}

/* Where an instrument sends its output instead of ctx.destination. One per instrument,
   so a mixer — or a solo button — has something to hold on to later. */
function strip(id){
  context();
  if (!strips.has(id)){
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(master);
    strips.set(id, g);
    taps.forEach(wireTap);          // an instrument built after a tap still reaches it
  }
  return strips.get(id);
}

/* A sum of every instrument's strip EXCEPT one — what the looper records when you point
   it at the studio rather than a microphone.

   Excluding the caller is the whole point: the looper's own output goes to its strip and
   on to master, so recording master would record the looper recording itself and build
   until it clips. Taps are kept and re-wired when a new strip appears, because an
   instrument can be built after the tap was made. */
const taps = [];
/* `exclude` is one id or several. The looper needs two — its own strip and the metronome's
   — because a click on the bus would be printed into every take. */
function tap(exclude){
  context();
  const g = ctx.createGain();
  g.gain.value = 1;
  const t = {node: g, exclude: [].concat(exclude || []), wired: new Set()};
  taps.push(t);
  wireTap(t);
  return g;
}
function wireTap(t){
  strips.forEach((strip, id) => {
    if (t.exclude.indexOf(id) >= 0 || t.wired.has(id)) return;
    strip.connect(t.node);
    t.wired.add(id);
  });
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

return {context, strip, resume, tap,
        get ctx(){ return ctx; },
        get master(){ return master; },
        get strips(){ return new Map(strips); }};
})();
