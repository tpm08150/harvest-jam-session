
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

/* Every panel that holds notes, so a control that moves the octave can drop them first —
   see octaveUI(). Keyed by root because that is what a panel IS to the shell. */
const releasers = new Map();

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
    if (v == null) return;
    if (spec.off) spec.off(v);
    if (Patchwork.session) Patchwork.session.played(root.dataset.instrument, v, 0, false);
  };
  const dropAll = () => {
    if (!held.size) return;
    [...held.keys()].forEach(release);
    if (spec.paint) spec.paint();
  };
  releasers.set(root, dropAll);

  Patchwork.onKey(root, "keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey || editing(e)) return;
    /* An instrument that wanted this key already took it. PM·1's program mode walks its
       step grid with the arrows, and while that is on it is the better use of them. */
    if (e.defaultPrevented) return;

    /* Up and down as well as left and right. Up/down is what everybody reaches for and what
       the owner asked for; left/right was here first and stays, because a habit that already
       works is not worth taking away to make a point about consistency. PM·1's program mode
       walks its grid with all four and takes them first — see defaultPrevented above. */
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "ArrowUp"   || e.key === "ArrowDown"){
      const d = (e.key === "ArrowRight" || e.key === "ArrowUp") ? 1 : -1;
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
    /* Everyone else hears it too. Here rather than in each instrument because this IS the
       one place every instrument's typed notes pass through — and because a note played by
       a PERSON is what travels; a sequencer's notes are already implied by the shared
       pattern and would arrive twice. */
    if (Patchwork.session) Patchwork.session.played(root.dataset.instrument, v, 100, true);
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
  window.addEventListener("blur", dropAll);
}

/* ---- the octave control ----
   Built rather than written into three panel.html files, for the reason at the top of this
   file: an instrument added later should get this by asking. It is the same − n + stepper
   PM·1 already had in its transport, moved to where the thing it moves actually is.

   `range` is the instrument's, not ours: only the panel knows what its keyboard spans and
   what its note names are — BS·1's keys read a further octave down than they play, because
   its oscillator has an octave of its own underneath this one. */
function octaveUI(host, spec){
  if (!host) return function(){};
  const lo = spec.min == null ? -3 : spec.min, hi = spec.max == null ? 3 : spec.max;
  const root = host.closest("[data-instrument]");
  const wrap = document.createElement("div");
  wrap.className = "kboct";
  const mk = (cls, tag) => { const e = document.createElement(tag || "span"); e.className = cls; return e; };
  const lab = mk("kboct-lab"); lab.textContent = "Oct";
  const down = mk("kboct-btn", "button"), up = mk("kboct-btn", "button");
  down.type = up.type = "button";
  down.textContent = "\u2212"; up.textContent = "+";
  down.setAttribute("aria-label", "Down an octave");
  up.setAttribute("aria-label", "Up an octave");
  const out = mk("kboct-out", "output");
  const range = mk("kboct-range");
  wrap.appendChild(lab); wrap.appendChild(down); wrap.appendChild(out);
  wrap.appendChild(up); wrap.appendChild(range);
  host.appendChild(wrap);

  function paint(){
    const v = spec.get();
    out.textContent = (v > 0 ? "+" : "") + v;
    wrap.classList.toggle("shifted", v !== 0);
    down.disabled = v <= lo; up.disabled = v >= hi;
    if (spec.range) range.textContent = spec.range();
  }
  function step(d){
    const v = Math.max(lo, Math.min(hi, spec.get() + d));
    if (v === spec.get()) return;
    /* ⚠️ Drop what is held BEFORE the shift, the same rule the arrow keys follow: an
       instrument that applies the octave on the way out of noteOff too would otherwise
       release a note it never started and leave the sounding one held for good. */
    if (root) panic(root);
    spec.set(v);
    paint();
  }
  down.addEventListener("click", () => step(-1));
  up.addEventListener("click", () => step(1));
  paint();
  return paint;
}

/* Drop every typed note a panel is holding. */
function panic(root){
  const f = releasers.get(root);
  if (f) f();
}

return {mount, octaveUI, panic, get layout(){ return Object.assign({}, MAP); }};
})();
