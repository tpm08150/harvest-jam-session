/* The chords on the page, for whoever wants to play along.

   CS·1 generates a progression and then plays it alone. Everything else in the rack — the
   bass, the poly synth, the vocoder — starts from an empty grid you fill by hand, in a key
   nothing tells you. That is a lot of typing to arrive at the notes already on screen.

   So one instrument PROVIDES chords and any number of instruments READ them. Deliberately
   not "CS·1 drives the rack": nothing here plays anything or changes anybody's pattern.
   A reader asks what the chords are, when it is asked to, and writes its own notes — which
   is why the button lives on the instrument being filled rather than on CS·1.

   ⚠️ POLLED, NOT PUSHED, and for the reason session.js already gives about patches: the
   progression is set in three different places today — generated, loaded from a patch,
   applied from a scene — and the fourth one added later is the one nobody remembers to
   hook. One snapshot compared against the last catches every way it can change, including
   the ways added after this was written.

   The provider hands back RESOLVED notes, not chord symbols. Voicing a chord is CS·1's
   theory and belongs in CS·1; a reader that had to know what "♭VII" meant would be a
   second implementation of the part of this app most worth having only once. */
Patchwork.chords = (() => {
"use strict";

let read = null;                 // the provider's snapshot function
let cur = null;                  // the last progression seen
let sig = null;                  // its signature, for spotting a change
const subs = [];

function notify(){ subs.forEach(fn => { try{ fn(cur); }catch(e){} }); }

/* One provider. A page with two instruments claiming to own the chords has a question
   nobody has asked yet, and answering it now would be inventing the problem. */
function provide(fn){ read = fn; poll(); }

function poll(){
  if (!read) return;
  let next = null;
  try{ next = read(); }catch(e){ next = null; }
  const s = next ? JSON.stringify(next) : null;
  if (s === sig) return;
  sig = s; cur = next;
  notify();
}
setInterval(poll, 500);

/* ---- which chord a step belongs to ----
   The progression is divided evenly across the pattern, whatever the rate or length: four
   chords over sixteen steps is four steps each, and the same four over a 12-step pattern
   is three each. Bars would be the musical answer and are the wrong one here — a reader's
   pattern length has nothing to do with how long CS·1 holds a chord, and a mapping that
   ran off the end of the grid would drop the last chords silently. Even division means the
   whole progression is always in the pattern, which is what the button is for. */
function at(i, len){
  if (!cur || !cur.chords || !cur.chords.length || !len) return null;
  const n = cur.chords.length;
  const k = Math.min(n - 1, Math.floor((i % len) * n / len));
  return cur.chords[k];
}
/* True on the first step of each chord — where a reader puts the thing that lands. */
function starts(i, len){
  if (!cur || !cur.chords || !cur.chords.length || !len) return false;
  const n = cur.chords.length;
  return Math.floor((i % len) * n / len) !== Math.floor((((i % len) - 1 + len) % len) * n / len)
      || (i % len) === 0;
}

return {provide, at, starts, poll,
        onChange: fn => { subs.push(fn); if (cur) { try{ fn(cur); }catch(e){} } },
        get current(){ return cur; },
        get ready(){ return !!(cur && cur.chords && cur.chords.length); }};
})();
