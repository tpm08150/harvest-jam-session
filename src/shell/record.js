
/* Live recording.

   Ableton's gesture: the transport is already running, you arm a track, you play, and
   what you play lands in the clip on the grid. Nothing stops, nothing is a take.

   The shell owns arming and the global record state; each instrument owns what "write a
   note" means, because a drum lane, a bass line and a chord progression are not the same
   thing and a shared writer would have to pretend they were. */
Patchwork.record = (() => {
"use strict";

const kit = [];              // {id, name, write, arm, disarm, canRecord}
const armed = new Set();
const subs = [];

function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }
function onChange(fn){ subs.push(fn); }

function register(id, spec){
  kit.push({id, name: spec.name || id,
            write: spec.write || null,
            arm: spec.arm || function(){},
            disarm: spec.disarm || function(){},
            slots: !!spec.slots,
            recordSlot: spec.recordSlot || null,
            playSlot: spec.playSlot || null,
            hasSlot: spec.hasSlot || null,
            canRecord: spec.canRecord == null ? !!spec.write : spec.canRecord});
  notify();
}
function track(id){ return kit.find(x => x.id === id) || null; }

function setArmed(id, want){
  const it = kit.find(x => x.id === id);
  if (!it || !it.canRecord) return;
  if (want){ armed.add(id); it.arm(true); } else { armed.delete(id); it.disarm(); }
  notify();
}
function toggleArm(id){ setArmed(id, !armed.has(id)); }

/* ---- record into a scene row ----
   One gesture, and it has to be audible from the press. Hitting ● on a row:

     - every ARMED track starts if it was stopped, and has whatever is in its sequencer
       copied into that row
     - every UNARMED track fires that row and plays back what is already there, starting
       if it was stopped
     - a track with slots — the looper — takes a real audio take instead of a copy

   The starting is the part that was missing and the part that makes it feel like a
   recorder: before, the cell filled and nothing sounded, so the gesture looked like it
   had failed. An armed track also has to be RUNNING for live note capture to reach the
   grid at all, since a step index is meaningless with no transport — so starting it is
   what lets you arm a second track and play into the same row a moment later.

   Order matters: armed tracks start FIRST, so their pattern is running before the copy is
   taken and the row gets what you are actually hearing. */
function captureRow(row){
  kit.forEach(it => {
    if (!armed.has(it.id)) return;
    if (it.slots && it.recordSlot){ it.recordSlot(row); return; }
    Patchwork.scenes.start(it.id);
    Patchwork.scenes.store(row, it.id);
  });
  Patchwork.scenes.instruments.forEach(i => {
    if (!armed.has(i.id)) Patchwork.scenes.fire(row, i.id);
  });
  kit.forEach(it => {
    if (armed.has(it.id) || !it.slots || !it.playSlot) return;
    it.playSlot(row);
  });
  notify();
}

/* Live note capture stays gated on the track being armed. There is no global record
   switch any more, so an armed track writes what you play as you play it, and the row
   button is what commits the result to a scene. */
function note(id, midi, vel, when){
  if (!armed.has(id)) return -1;
  const it = kit.find(x => x.id === id);
  if (!it || !it.write) return -1;
  try{ return it.write(midi, vel, when); }catch(e){ return -1; }
}

return {register, setArmed, toggleArm, captureRow, note, onChange, track,
        isArmed: id => armed.has(id),
        get tracks(){ return kit.map(k => ({id: k.id, name: k.name, canRecord: k.canRecord})); },
        get armedCount(){ return armed.size; }};
})();
