/* TS·1 — the transition synth.

   Every other instrument in this rack answers "what is playing?". This one answers "what
   happens NEXT?" — the sweep, the riser and the drop that carry one part into another. It
   is built around a landing rather than around notes, which is why it has no keyboard and
   no pattern: a riser is defined by the moment it stops, and everything else about it is
   consequence.

   ⚠️ IT LANDS ON THE SEAM, like everything else here. You arm it; it works out the next
   boundary of the length you chose, starts itself the right distance BEFORE that boundary,
   and resolves exactly on it. That is the whole instrument, and it is the reason this can
   be armed by a scene row, a MIDI note or another player in a jam without any of them
   having to know how long a riser takes. */
Patchwork.instrument("ts1", root => {
"use strict";

const $  = s => root.querySelector(s);
const $$ = s => root.querySelectorAll(s);
