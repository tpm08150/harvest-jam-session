/* The shell.

   Everything singular on the page lives here, so instruments can stop each assuming
   they own the document. Phase 2 gives it the two that actually collide — the root an
   instrument queries within, and the computer keyboard. The clock, the audio bus and
   the MIDI router follow in Phase 3.

   It is deliberately the same code standalone and hosted. A page with one instrument
   takes the identical path a page with three does, so the standalone builds are not a
   second configuration that can rot untested. */
window.Patchwork = (() => {
"use strict";

const roots = [];          // every instrument panel on this page, in document order
let focused = null;        // the one the computer keyboard is talking to
const handlers = [];       // {root, type, fn}

/* Which root a keydown went to, keyed by e.code. A keyup MUST reach the instrument that
   received its keydown even if focus moved in between — route it by focus instead and
   the first instrument holds that note forever. Held notes are exactly the thing a
   focus change is likely to interrupt, so this is the common case, not the corner. */
const pressed = new Map();

function instrument(id, build){
  const root = document.querySelector(`[data-instrument="${id}"]`);
  if (!root) return null;                   // this build does not include that panel
  roots.push(root);
  if (!focused) focused = root;
  build(root);
  return root;
}

/* With one instrument there is nothing to arbitrate and it is always focused, so a
   standalone build behaves exactly as it did before the shell existed. */
const contested = () => roots.length > 1;

/* Idempotent on purpose. The first instrument to register is focused before there is
   anything to contest, so an early return when the root is already focused left the
   panel that owns the keyboard with no ring on it — the one case that matters most,
   since it is the state the page opens in. */
function focus(root){
  if (!root || roots.indexOf(root) < 0) return;
  focused = root;
  if (!contested()) return;              // nothing to show with a single panel
  roots.forEach(r => r.classList.toggle("focused", r === focused));
}

document.addEventListener("pointerdown", e => {
  const el = e.target instanceof Element ? e.target.closest("[data-instrument]") : null;
  if (el) focus(el);
}, true);

function onKey(root, type, fn){
  handlers.push({root, type, fn});
}

/* One listener per event type for the whole page, dispatching to the instrument that
   owns the keyboard. Registering each instrument's handler on document directly is what
   made this a collision in the first place: every instrument saw every key. */
["keydown", "keyup"].forEach(type => {
  document.addEventListener(type, e => {
    let target = focused;
    if (type === "keydown") {
      if (e.code) pressed.set(e.code, focused);
    } else if (e.code && pressed.has(e.code)) {
      target = pressed.get(e.code);
      pressed.delete(e.code);
    }
    handlers.forEach(h => { if (h.type === type && h.root === target) h.fn(e); });
  });
});

/* A key held while the window loses focus never sends its keyup, so the note that was
   sounding has nothing to release it. Instruments already handle blur themselves; this
   just stops the routing table growing without bound. */
window.addEventListener("blur", () => pressed.clear());

return {instrument, onKey, focus,
        get roots(){ return roots.slice(); },
        get focused(){ return focused; }};
})();
