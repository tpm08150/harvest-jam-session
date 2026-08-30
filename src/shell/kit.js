/* The drum kit on the page, for whoever wants to hit it.

   TS·1 plays fills. It has no drums, and giving it some would put a second kit on the page
   that sounds nothing like the first — you would tune DR·1 and the fills would stay where
   they were, which is the kind of wrong that is hard to even describe once you are hearing
   it. So the same arrangement chords use: one instrument PROVIDES a kit, and anyone else
   asks it to hit something at a given time.

   Deliberately a scheduling API and not a note API. A fill is written as "these hits, at
   these audio times", which is what makes it land on the seam sample-accurately; anything
   routed through a note-now call would arrive whenever the timer happened to fire. */
Patchwork.kit = (() => {
"use strict";

let provider = null;
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

/* `spec` is {name, voices:[ids], hit(id, when, vel, opts)} — `when` in the audio clock's
   time, `vel` 0..1. The provider keeps every opinion about what a kick sounds like.

   `opts` is {tune, decay} as RATIOS of however that voice is currently set, and it is what
   lets a caller play a descending tom run on a kit with two toms in it. Ratios rather than
   values on purpose: a fill asking for "a fifth below this tom" still works after you have
   retuned the tom, where a fill asking for 92 Hz would quietly stop matching the kit. */
function provide(spec){ provider = spec || null; notify(); }

function hit(id, when, vel, opts){
  if (!provider || !provider.hit) return false;
  try{ provider.hit(id, when, vel == null ? 1 : vel, opts || null); return true; }
  catch(e){ return false; }
}
function has(id){ return !!(provider && provider.voices && provider.voices.indexOf(id) >= 0); }

/* What a voice is currently tuned to, in Hz, or null if the provider will not say.

   A caller wanting a run of pitches needs this: ratios alone are not comparable ACROSS two
   voices, so a fill computing "×0.8 on the high tom then ×1.1 on the low" has no idea
   whether that second hit is above or below the first. With the base pitches it can aim at
   real frequencies and work the ratios back out — and it keeps following the kit when you
   retune it, which is why this is asked for rather than assumed. */
function tuneOf(id){
  if (!provider || !provider.tuneOf) return null;
  try{ const v = provider.tuneOf(id); return (typeof v === "number" && v > 0) ? v : null; }
  catch(e){ return null; }
}

return {provide, hit, has, tuneOf,
        onChange: fn => { subs.push(fn); },
        get ready(){ return !!(provider && provider.hit); },
        get name(){ return provider ? provider.name : null; },
        get voices(){ return provider && provider.voices ? provider.voices.slice() : []; }};
})();
