
/* One computer keyboard, for every instrument that has notes.

   PM·1 grew one and the other four did not, so "playable without hardware" was true of
   exactly one panel out of six. This is the arrangement faces.js already uses for the Panel
   button: one implementation in the shell, and an instrument added later gets it by asking
   rather than by being copied into.

   host.js decides WHICH panel the keys reach — the focused one. This decides what they
   MEAN, and it is deliberately thin about it: an instrument says what a key index plays and
   how to start and stop it, so a drum machine maps the row to its eight lanes while a synth
   maps it to semitones, and neither has to know about the other. */
Patchwork.keys = (() => {
"use strict";

/* The tracker layout every soft synth uses: the home row is the white keys and the row
   above holds the black ones roughly where they physically sit. */
const MAP = {a:0, w:1, s:2, e:3, d:4, f:5, t:6, g:7, y:8, h:9, u:10,
             j:11, k:12, o:13, l:14, p:15, ";": 16};

function mount(root, spec){
  /* The RESOLVED value is held, not the key index. Shift the octave with a note down and
     map(i) answers differently, so a keyup routed through map() would release a note that
     was never started and leave the sounding one held forever. */
  const held = new Map();
  let oct = 0;                    // only used when the instrument has no octave of its own

  const editing = e => {
    const tag = (e.target.tagName || "").toLowerCase();
    return tag === "input" || tag === "select" || tag === "textarea";
  };
  const release = i => {
    const v = held.get(i);
    held.delete(i);
    if (v != null && spec.off) spec.off(v);
  };

  Patchwork.onKey(root, "keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey || editing(e)) return;
    /* An instrument that wanted this key already took it. PM·1's program mode walks its
       step grid with the arrows, and while that is on it is the better use of them. */
    if (e.defaultPrevented) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight"){
      const d = e.key === "ArrowRight" ? 1 : -1;
      /* ⚠️ Release first. PM·1 applies its octave inside noteOff() as well as noteOn(), so
         moving it under a held key would release a note it never started and leave the
         sounding one held forever. Rare with a pair of ± buttons; the ordinary case the
         moment the arrows do it. */
      [...held.keys()].forEach(release);
      /* An instrument with its own octave control drives THAT, so its readout keeps
         telling the truth. One without keeps the offset here instead. */
      if (spec.octave) spec.octave(d);
      else oct = Math.max(-3, Math.min(3, oct + d));
      if (spec.paint) spec.paint();
      e.preventDefault();
      return;
    }

    const i = MAP[e.key.toLowerCase()];
    if (i == null || e.repeat || held.has(i)) return;
    const v = spec.map(i, oct);
    if (v == null) return;         // fewer things to play than there are keys — a drum kit
    held.set(i, v);
    spec.on(v, 100);
    if (spec.paint) spec.paint();
    e.preventDefault();
  });

  Patchwork.onKey(root, "keyup", e => {
    const i = MAP[e.key.toLowerCase()];
    if (i == null || !held.has(i)) return;
    release(i);
    if (spec.paint) spec.paint();
  });

  /* A key held while the window loses focus never sends its keyup, so nothing would
     release the note. host.js clears its own routing table for the same reason. */
  window.addEventListener("blur", () => {
    if (!held.size) return;
    [...held.keys()].forEach(release);
    if (spec.paint) spec.paint();
  });
}

return {mount, get layout(){ return Object.assign({}, MAP); }};
})();
