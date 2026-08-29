
/* Live faces.

   Each instrument shows a small performance face by default in the studio, with its full
   panel one click away. NOTHING IS REMOVED — MS·1 keeps all fifty knobs; the face is a
   filter over the panel that already exists, not a second UI that can drift from it.

   That choice is the whole design. A curated performance panel written separately would
   be a third copy of every control's wiring, and the first one to go stale. Instead each
   panel marks the blocks worth having while playing with `data-face`, and face mode hides
   the rest. A control that is hidden is still bound, still MIDI-learnable, and still there
   the moment you open the panel back up.

   Standalone builds default to the full panel: a single instrument on a page of its own
   should be its whole self. The studio defaults to faces, because three full panels is the
   wall this exists to avoid. */
Patchwork.faces = (() => {
"use strict";

const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

function isOn(root){ return root.classList.contains("face"); }

function set(root, on){
  if (!root) return;
  root.classList.toggle("face", !!on);
  const btn = root.querySelector(".face-toggle");
  if (btn){
    const back = root === soloed;
    btn.textContent = back ? "← Back" : "Panel";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = back ? "Back to all the instruments"
                     : "Open this instrument on its own, with every control";
  }
  notify();
}
function toggle(root){ set(root, !isOn(root)); }
function setAll(on){ Patchwork.roots.forEach(r => set(r, on)); }

/* ---- solo ----
   Opening an instrument's panel gives it the whole window and hides everything else,
   rather than expanding it in place and pushing five other panels off the bottom. A panel
   is 3000 px of controls; seeing it next to a scene launcher you cannot reach helps
   nobody.

   Only meaningful with more than one instrument. A standalone build has nothing to hide,
   so its button stays a plain face/panel toggle. */
let soloed = null;

/* `contested` lives in host.js and is private to it, so this asks the public roster. */
const several = () => Patchwork.roots.length > 1;

function solo(root){
  if (!several()) { set(root, false); return; }     // one instrument: just open the panel
  soloed = root;
  Patchwork.roots.forEach(r => r.classList.toggle("solo", r === root));
  document.body.classList.add("soloing");
  set(root, false);                                  // full panel while it has the window
  window.scrollTo(0, 0);
  notify();
}
function unsolo(){
  if (!soloed) return;
  const was = soloed;
  soloed = null;
  Patchwork.roots.forEach(r => r.classList.remove("solo"));
  document.body.classList.remove("soloing");
  set(was, true);                                    // back to its face
  /* the panel it came from is where the eye was, so put it back under the pointer */
  if (was.scrollIntoView) was.scrollIntoView({block: "nearest"});
  notify();
}

/* Escape backs out, because a full-window view with one way out is a view people get
   stuck in. */
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && soloed) unsolo();
});

/* The button is injected rather than written into three panel.html files. One
   implementation, and an instrument added later gets it without being told to. */
function mount(){
  Patchwork.roots.forEach(root => {
    if (root.querySelector(".face-toggle")) return;
    const plate = root.querySelector(".plate");
    if (!plate) return;
    const b = document.createElement("button");
    b.className = "btn ghost sm face-toggle";
    b.type = "button";
    b.addEventListener("click", () => soloed === root ? unsolo() : solo(root));
    /* before the screws, so it reads as part of the panel rather than floating */
    const screws = plate.querySelector(".screws");
    if (screws) plate.insertBefore(b, screws); else plate.appendChild(b);
    set(root, false);
  });
}

return {mount, set, setAll, toggle, solo, unsolo, isOn,
        onChange: fn => subs.push(fn),
        get soloed(){ return soloed; },
        get count(){ return Patchwork.roots.filter(isOn).length; }};
})();
