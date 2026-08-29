
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
            /* whether played notes land on the grid as you play, as opposed to the
               pattern being copied when a row is pressed */
            live: !!spec.write,
            recordSlot: spec.recordSlot || null,
            playSlot: spec.playSlot || null,
            hasSlot: spec.hasSlot || null,
            clearSlot: spec.clearSlot || null,
            /* which slot it is working out of right now, or null. A slot track has no
               scene row, so the launcher cannot ask scenes.onRow which cell to ring. */
            liveSlot: spec.liveSlot || null,
            /* stop this track's own transport. A scene member is stopped through
               scenes.stop(); a slot track keeps its transport privately, so it has to
               offer one or a master stop would leave the looper running. */
            stop: spec.stop || null,
            /* audio in and out of a slot, for a shared jam */
            grabTake: spec.grabTake || null,
            loadTake: spec.loadTake || null,
            sampleRate: spec.sampleRate || null,
            takeMeta: spec.takeMeta || null,
            /* Armable by default. Arming means "put what you have into the row I press",
               which every registered track can do — CS·1's progression captures as readily
               as a step grid. write() is a SEPARATE, narrower capability: taking notes you
               play live onto a grid as you play them. Conflating the two is what greyed
               out CS·1's arm for no good reason. */
            canRecord: spec.canRecord == null ? true : spec.canRecord});
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
    /* the row is passed so the shell knows this track is now playing FROM it — that is
       what lets a track added to the same row a moment later join what you are hearing */
    Patchwork.scenes.start(it.id, row);
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
   button is what commits the result to a scene.

   A track with no write() — CS·1 — simply ignores this and is captured whole when a row
   is pressed. Being armed still means something for it. */
function note(id, midi, vel, when){
  if (!armed.has(id)) return -1;
  const it = kit.find(x => x.id === id);
  if (!it || !it.write) return -1;
  let i = -1;
  try{ i = it.write(midi, vel, when); }catch(e){ return -1; }
  /* The note is on the instrument's grid; the BLOCK it is playing out of has to follow, or
     you are recording into something the next row-fire quietly discards. write() returns
     the step it landed on, or -1 when it landed nowhere — a transport that is not running
     has no step to write to — so nothing is re-stored for a note that was not taken. */
  if (i >= 0) Patchwork.scenes.restore(id);
  return i;
}

/* ---- the arm control ----
   Injected, not written into six panel.html files — the arrangement faces.js uses for the
   Panel button, and for the same reason: one implementation, and an instrument added later
   gets it without being told to.

   It used to live as a row above the live grid. That put the choice of WHAT you are
   recording six columns away from the instrument you were playing, and made the grid's
   header a control panel rather than a set of labels. On the plate it sits on whichever
   instrument you are looking at, and it is on the face as well as the panel — arming is a
   performance decision. */
function mount(){
  Patchwork.roots.forEach(root => {
    if (root.querySelector(".arm-toggle")) return;
    const id = root.dataset.instrument;
    const it = kit.find(x => x.id === id);
    if (!it || !it.canRecord) return;
    const plate = root.querySelector(".plate");
    if (!plate) return;
    const b = document.createElement("button");
    b.className = "btn ghost sm arm-toggle";
    b.type = "button";
    b.dataset.arm = id;
    b.textContent = "Arm";
    /* Every track can be armed. What differs is whether playing also writes to the grid as
       you go, which the tooltip says rather than leaving you to find out. */
    b.title = it.slots ? "Armed: pressing a row records an audio take into it"
            : it.live  ? "Armed: notes you play land on the grid, and pressing a row puts the pattern there"
                       : "Armed: pressing a row puts this instrument's current pattern into it";
    b.addEventListener("click", () => toggleArm(id));
    const screws = plate.querySelector(".screws");
    if (screws) plate.insertBefore(b, screws); else plate.appendChild(b);
  });
  paintArms();
}
function paintArms(){
  Patchwork.roots.forEach(root => {
    const b = root.querySelector(".arm-toggle");
    if (!b) return;
    const on = armed.has(b.dataset.arm);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "Armed" : "Arm";
  });
}
subs.push(paintArms);

return {register, setArmed, toggleArm, captureRow, note, onChange, track, mount,
        /* A track saying its OWN state moved — the looper starting, stopping, filling or
           emptying a slot. Arming is the shell's and notifies itself; a slot track keeps
           its transport privately, so without this the launcher had no way to know a take
           had appeared. The live page was papering over it with a 400 ms repaint, which is
           why the bug only showed on the studio launcher. */
        changed: notify,
        isArmed: id => armed.has(id),
        get tracks(){ return kit.map(k => ({id: k.id, name: k.name,
                                            canRecord: k.canRecord, live: k.live,
                                            slots: k.slots})); },
        get armedCount(){ return armed.size; }};
})();
