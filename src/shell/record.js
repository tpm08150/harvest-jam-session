
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
   One gesture. Every ARMED track has whatever is currently in its sequencer copied into
   that row; every unarmed track FIRES that row and plays back what is already there.

   That is why there is no global record button: "record" without a destination is a mode
   you can be in by accident, and the row is the destination. A track with slots — the
   looper — takes a real audio take instead of a copy, because there is nothing on its
   grid to copy.

   The copy is instant and from the live pattern, so what lands in the row is exactly what
   you were just hearing. Nothing is quantised after the fact because nothing needs to be:
   the notes were written to the grid as they were played. */
function captureRow(row){
  kit.forEach(it => {
    if (!armed.has(it.id)) return;
    if (it.slots && it.recordSlot) it.recordSlot(row);
    else Patchwork.scenes.store(row, it.id);
  });
  /* everything not armed simply plays that row */
  Patchwork.scenes.instruments.forEach(i => {
    if (!armed.has(i.id)) Patchwork.scenes.fire(row, i.id);
  });
  kit.forEach(it => {
    if (armed.has(it.id) || !it.slots || !it.playSlot) return;
    it.playSlot(row);
  });
  notify();
}

/* Called by an instrument from its own note-on path. It reaches the grid only when that
   instrument is armed AND record is on, so an armed track you are auditioning does not
   quietly overwrite the pattern you are auditioning it against. */
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
