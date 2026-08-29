
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
  }
  return strips.get(id);
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

return {context, strip, resume,
        get ctx(){ return ctx; },
        get master(){ return master; },
        get strips(){ return new Map(strips); }};
})();
