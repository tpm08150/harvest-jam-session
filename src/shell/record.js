
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
let on = false;              // the global record enable
const subs = [];

function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }
function onChange(fn){ subs.push(fn); }

function register(id, spec){
  kit.push({id, name: spec.name || id,
            write: spec.write || null,
            arm: spec.arm || function(){},
            disarm: spec.disarm || function(){},
            canRecord: spec.canRecord == null ? !!spec.write : spec.canRecord});
  notify();
}

function setArmed(id, want){
  const it = kit.find(x => x.id === id);
  if (!it || !it.canRecord) return;
  if (want){ armed.add(id); it.arm(on); } else { armed.delete(id); it.disarm(); }
  notify();
}
function toggleArm(id){ setArmed(id, !armed.has(id)); }

function setRecording(want){
  on = !!want;
  /* Arming is a standing choice and record is the momentary one, so turning record on
     tells everything already armed to begin — the alternative is arming twice. */
  kit.forEach(it => { if (armed.has(it.id)) (on ? it.arm(true) : it.disarm()); });
  notify();
}

/* Called by an instrument from its own note-on path. It reaches the grid only when that
   instrument is armed AND record is on, so an armed track you are auditioning does not
   quietly overwrite the pattern you are auditioning it against. */
function note(id, midi, vel, when){
  if (!on || !armed.has(id)) return -1;
  const it = kit.find(x => x.id === id);
  if (!it || !it.write) return -1;
  try{ return it.write(midi, vel, when); }catch(e){ return -1; }
}

return {register, setArmed, toggleArm, setRecording, note, onChange,
        isArmed: id => armed.has(id),
        get recording(){ return on; },
        get tracks(){ return kit.map(k => ({id: k.id, name: k.name, canRecord: k.canRecord})); },
        get armedCount(){ return armed.size; }};
})();
