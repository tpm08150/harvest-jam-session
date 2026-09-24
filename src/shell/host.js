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
/* ⚠️ AND BRING IT INTO VIEW, because focus can move without a hand on the page. A controller
   steps between panels and the rack is taller than the window: the ring moved to a panel two
   screens down, the encoders and pads were driving something nobody could see, and the only
   way to find out what you were playing was to scroll and look.

   Nothing when it is already whole on screen, so this is silent in the ordinary case and
   never fights a scroll you are in the middle of. A panel taller than the window aligns to
   its top rather than its middle — centring one would push its own header off. */
function reveal(root){
  const box = root.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (box.top >= 0 && box.bottom <= vh) return;
  let smooth = true;
  try{ smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){}
  try{
    root.scrollIntoView({behavior: smooth ? "smooth" : "auto",
                         block: box.height > vh ? "start" : "center"});
  }catch(e){ root.scrollIntoView(); }     // the options form is not everywhere
}

/* `quiet` is "the hand is already there" — see the pointer listener below. */
function focus(root, quiet){
  if (!root || roots.indexOf(root) < 0) return;
  const moved = focused !== root;
  focused = root;
  if (!contested()) return;              // nothing to show with a single panel
  roots.forEach(r => r.classList.toggle("focused", r === focused));
  if (moved && !quiet) reveal(root);
}

document.addEventListener("pointerdown", e => {
  const el = e.target instanceof Element ? e.target.closest("[data-instrument]") : null;
  /* ⚠️ QUIET, and this is the case that makes the flag worth having. You clicked it, so it
     is already where you want it — and this fires on the pointerdown that STARTS a fader
     drag, so a scroll here would move the control out from under the finger holding it. */
  if (el) focus(el, true);
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

/* ---- screenless: the page with nothing looking at it ----
   ?screenless on the URL (remembered, like ?kiosk, which it implies — see shell/kiosk.js): a Raspberry Pi
   with no monitor, played entirely from the controller. Two things happen and nothing else changes.

   The document is display:none, so nothing is styled, laid out, painted or composited. ⚠️ THE DOM STAYS,
   AND HAS TO: the controller's pages read and write it — surface.option() reads a <select>, the mixer
   page sets a fader's value and dispatches input — and none of that needs a pixel.

   And a "frame" comes four times a second from a plain timer. ⚠️ SLOWED, NOT STOPPED: the tape's rewind
   advances inside its frame callback (studio/tape.js), and a frame that never came would leave it winding
   forever. Slowing requestAnimationFrame itself also covers the loops that never moved to animate() —
   CS·1's wipes, PM·1's steps and meter, DR·1's playhead, the console's meters — in one place.

   Measured 2026-09-19, M3 Max, Chrome 153 headless at 1920x1080, the offline copy, six instruments
   playing from Play all, CPU a second from ps: drawn, 1.11 s — GPU process 0.87, renderer 0.20, main
   thread 0.044; like this, 0.24 s — GPU process 0.001, renderer 0.21 (the audio thread), main thread
   0.015 (0.012 with frames stopped outright). ⚠️ HIDE IT BEFORE SWITCHING THE GPU OFF: the same page
   still drawn under --disable-gpu cost the renderer 2.56 s a second, rastering in software. */
const SCREENLESS_KEY = "patchwork-screenless";
const screenless = (() => {
  /* ⚠️ A REMEMBERED BLANK PAGE NEEDS A DOOR. ?screenless=off forgets it, from the address bar, because a
     laptop that tried this once would otherwise open to nothing with no button to press. */
  if (/[?&]screenless=(off|0)\b/.test(location.search)){
    try{ localStorage.removeItem(SCREENLESS_KEY); }catch(e){}
    return false;
  }
  const asked = /[?&]screenless\b/.test(location.search);
  try{
    if (asked) localStorage.setItem(SCREENLESS_KEY, "1");
    return asked || localStorage.getItem(SCREENLESS_KEY) === "1";
  }catch(e){ return asked; }
})();
if (screenless){
  const st = document.createElement("style");
  st.textContent = "html{display:none !important}";
  document.documentElement.appendChild(st);
  window.requestAnimationFrame = fn => setTimeout(() => fn(performance.now()), 250);
  window.cancelAnimationFrame = id => clearTimeout(id);
}

/* ---- a loop that asks for frames only while something moves ----
   ⚠️ A FRAME ASKED FOR IS A FRAME MADE, whatever the callback then does with it. A loop that requests the
   next animation frame from every frame keeps the compositor running at the display's rate, and the rack
   had seven that never stopped — BS·1, VC·1, LP·1, TS·1, SQ·1 and the launcher's two bar counters, 422
   requests a second with nothing playing. Measured in Chrome 152 on a laptop (2026-09-13): the idle
   browser spent 0.36 s of CPU a second, and 0.14 with those requests stubbed out. The Raspberry Pi 4 the
   rack was burned onto got two frames a second.

   So `draw(now, moving)` runs every frame while `busy()` says something is in motion, and every `idle`
   milliseconds on a plain timer otherwise — a timer asks nothing of the compositor — or not at all with
   idle 0. Each timer tick asks busy() again, so motion nobody announced is picked up within a tick;
   `wake()` is for a caller that knows it has just started something and wants the first frame now. The
   frame after motion stops still draws, with moving true, which is what clears a playhead. */
function animate(draw, busy, idle){
  const every = idle == null ? 250 : idle;
  let frame = 0, timer = 0;
  const moving = () => { try{ return !!busy(); }catch(e){ return false; } };
  function run(now, inMotion){
    try{ draw(now, inMotion); }catch(e){ console.error("animation failed", e); }
  }
  function schedule(){
    if (frame || timer) return;
    if (moving()){
      frame = requestAnimationFrame(now => { frame = 0; run(now, true); schedule(); });
    } else if (every > 0){
      timer = setTimeout(() => {
        timer = 0;
        if (!moving()) run(performance.now(), false);
        schedule();
      }, every);
    }
  }
  schedule();
  return {wake(){ if (timer && moving()){ clearTimeout(timer); timer = 0; } schedule(); }};
}

return {instrument, onKey, focus, animate, screenless,
        /* From a console over DevTools, the only way in once nothing is drawn: forget it, then reload. */
        screenlessOff(){ try{ localStorage.removeItem(SCREENLESS_KEY); }catch(e){} },
        get roots(){ return roots.slice(); },
        get focused(){ return focused; }};
})();
