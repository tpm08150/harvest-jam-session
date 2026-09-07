
/* Projects — the whole desk, saved under a name.

   Everything on this page was already persistent except the thing you actually made. Sounds
   save as patches, the mixer remembers its knobs, the tape keeps its take, the MIDI map
   survives a reload — and the SCENES, the grid of patterns that is the arrangement, lived
   only in memory. Close the tab and the song was gone while every setting around it stayed.

   ⚠️ A PROJECT IS THE SUM OF WHAT REGISTERS WITH IT, not a list this file keeps. Writing out
   "rows, live patterns, sounds, mixer, tempo" here would mean a project silently missing
   whatever is added next — and the thing added next is exactly the thing nobody remembers to
   come back and add. So each module says what it contributes:

     Patchwork.project.part("scenes", {capture, apply});

   which is the same bargain session.registerPatch() already makes for a jam, and for the
   same reason: one definition of a thing, handed to whoever needs it.

   ⚠️ AND IT SAVES WHAT IS TRUE, NOT WHAT WAS PLAYED. Nothing here records a performance —
   that is the tape's job, and the library's. This is the state you would have to rebuild by
   hand, which is the state worth a name. */
Patchwork.project = (() => {
"use strict";

const KEY = "patchwork-projects";
const LAST = "patchwork-project-last";
const parts = [];                 // {id, capture, apply}
const watchers = [];
function notify(){ watchers.forEach(fn => { try{ fn(); }catch(e){} }); }

function part(id, spec){
  if (!id || !spec || typeof spec.capture !== "function" || typeof spec.apply !== "function") return;
  parts.push({id, capture: spec.capture, apply: spec.apply});
}

/* ⚠️ Deep-copied on the way out and on the way in, the same rule scenes.js follows for a
   captured pattern: a saved project holding a live reference would be rewritten by every
   edit made after it was saved, and would look correct right up until you reloaded. */
const copy = v => (v == null ? null : JSON.parse(JSON.stringify(v)));

function capture(){
  const out = {v: 1, at: Date.now(), parts: {}};
  parts.forEach(p => {
    try{ out.parts[p.id] = copy(p.capture()); }catch(e){}
  });
  return out;
}

/* ⚠️ IN REGISTRATION ORDER, which is load order, which is the order things depend on each
   other in: the clock is up before the sequencers that read it, and the sounds are on before
   the patterns that play through them. Applying a grid to instruments that have not had
   their voices restored yet would sound wrong for exactly one pass and then correct itself,
   which is the worst kind of bug to be told about. */
function apply(proj){
  if (!proj || !proj.parts) return false;
  parts.forEach(p => {
    const data = proj.parts[p.id];
    if (data == null) return;
    try{ p.apply(copy(data)); }catch(e){ console.error("project part failed: " + p.id, e); }
  });
  notify();
  return true;
}

/* ---- the store ---- */
function all(){
  try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){ return {}; }
}
function write(o){
  try{ localStorage.setItem(KEY, JSON.stringify(o)); return true; }
  catch(e){ return false; }               // a full quota is the one failure worth reporting
}
function names(){ return Object.keys(all()).sort((a, b) => a.localeCompare(b)); }

let current = "";
try{ current = localStorage.getItem(LAST) || ""; }catch(e){}
function setCurrent(name){
  current = name || "";
  try{ localStorage.setItem(LAST, current); }catch(e){}
  notify();
}

function save(name){
  const n = String(name || "").trim();
  if (!n) return false;
  const o = all();
  o[n] = capture();
  if (!write(o)) return false;
  setCurrent(n);
  return true;
}
function open(name){
  const p = all()[name];
  if (!p) return false;
  const ok = apply(p);
  if (ok) setCurrent(name);
  return ok;
}
function remove(name){
  const o = all();
  if (!o[name]) return false;
  delete o[name];
  write(o);
  if (current === name) setCurrent("");
  return true;
}

return {part, capture, apply, save, open, remove, names, all,
        get current(){ return current; },
        onChange: fn => watchers.push(fn)};
})();

/* ---- the transport's own share of a project ----
   Here rather than in clock.js because tempo is the page's rather than the clock's — the
   clock counts, and what it counts at is a decision the project holds. */
(() => {
"use strict";
if (!Patchwork.project) return;
Patchwork.project.part("transport", {
  capture: () => ({bpm: Patchwork.clock ? Patchwork.clock.bpm : null}),
  apply: p => {
    if (p && typeof p.bpm === "number" && Patchwork.clock) Patchwork.clock.setBpm(p.bpm);
  }
});
})();
