/* SQ·1 — the external sequencer.

   ⚠️ THE ONE PANEL HERE THAT MAKES NO SOUND. Every other instrument in this rack ends at the
   audio bus; this one ends at a five-pin cable, and what it is for is the box on the other
   side of it. It has no voice, no strip and no fader, and the only thing it can be wrong
   about is timing — which is why it is built on the same clock as everything else rather
   than on a timer of its own.

   Sixteen tracks, one per MIDI channel, sixty-four steps each. A track is either a DRUM
   track — eight lanes of on/off/accent, each lane sending a note number you set — or a SYNTH
   track, which is BS·1's sequencer wholesale: pitch as a scale degree, accent, slide, tie
   and parameter locks. Both models exist for every track and only one of them plays, because
   switching between them while you are looking for something should not cost you the pattern
   you already wrote.

   ⚠️ EACH TRACK KEEPS ITS OWN LENGTH AND RATE. That is the whole reason to own one of these:
   a twelve-step hat against a sixteen-step bass is a polyrhythm, and the same two locked to
   one grid is a fill you have to write out longhand. They meet at the shell's clock, which is
   what keeps them locked to the rest of the rack rather than merely near it. */
Patchwork.instrument("sq1", root => {
"use strict";

const $  = s => root.querySelector(s);
const $$ = s => root.querySelectorAll(s);
