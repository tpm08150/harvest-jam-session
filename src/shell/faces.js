
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
    btn.textContent = on ? "Panel" : "Face";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Show every control on this instrument"
                   : "Show just the controls you play with";
  }
  notify();
}
function toggle(root){ set(root, !isOn(root)); }
function setAll(on){ Patchwork.roots.forEach(r => set(r, on)); }

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
    b.addEventListener("click", () => toggle(root));
    /* before the screws, so it reads as part of the panel rather than floating */
    const screws = plate.querySelector(".screws");
    if (screws) plate.insertBefore(b, screws); else plate.appendChild(b);
    set(root, false);
  });
}

return {mount, set, setAll, toggle, isOn, onChange: fn => subs.push(fn),
        get count(){ return Patchwork.roots.filter(isOn).length; }};
})();
