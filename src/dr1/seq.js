
/* ============ sequencer ============ */
/* Eight lanes of sixteen steps, on the shell's clock. Same swing model CS·1 and MS·1 use,
   so all three shuffle identically — a kit that swings differently from the line over it
   is worse than no swing at all. */

const SEQ = {
  len: 16, rate: "1/16", swing: .5, playing: false,
  accentAmt: .35,          // how much louder an accented step is
  lane: "bd",              // which lane the voice faders are editing
  mode: "play",            // play | program — see the locks below
  sel: 0                   // the step a lock is written to, in program mode
};

/* steps[voice][i] = 0 off, 1 on, 2 on+accent. A flat integer per step rather than an
   object, because there are 128 of them and two states beyond off. */
const steps = {};
const MAX_STEPS = 64;
ORDER.forEach(k => { steps[k] = new Array(MAX_STEPS).fill(0); });

/* ---- parameter locks ----
   A hit can carry its own tune, tone, decay or level, in force only while that step is
   being scheduled. It is what turns eight voices into a kit that can move: a tom line that
   walks down in pitch, a hat that opens on the offbeat, a kick that drops a fifth on the
   last step of the bar — none of which are reachable when a lane has exactly one sound.

   ⚠️ KEPT BESIDE `steps`, NOT INSIDE IT. The comment on `steps` is right and still holds:
   it is a flat integer per step because there are hundreds of them and only three states.
   Locks are rare — a handful of steps in a pattern ever carry one — so a sparse map costs
   nothing for the steps that have none and leaves the hot path reading plain integers.

     locks[voiceId][stepIndex] = {tune?, tone?, decay?, level?} */
const locks = {};
const LOCKABLE = ["tune", "tone", "decay", "level"];

function lockAt(id, i){
  const L = locks[id];
  return (L && L[i]) || null;
}
function lockCount(id){
  const L = locks[id];
  return L ? Object.keys(L).length : 0;
}
/* In program mode, moving a voice fader IS the lock gesture — no separate arm step. The
   same rule BS·1, VC·1 and PM·1 use, so one habit works across the whole rack. */
function lock(param){
  if (SEQ.mode !== "program" || LOCKABLE.indexOf(param) < 0) return false;
  const id = SEQ.lane, i = SEQ.sel;
  const L = locks[id] || (locks[id] = {});
  (L[i] || (L[i] = {}))[param] = P[id][param];
  return true;
}
function unlock(param){
  const L = locks[SEQ.lane], st = L && L[SEQ.sel];
  if (!st || !Object.prototype.hasOwnProperty.call(st, param)) return false;
  delete st[param];
  if (!Object.keys(st).length) delete L[SEQ.sel];
  return true;
}
function isLocked(param, i){
  const st = lockAt(SEQ.lane, i == null ? SEQ.sel : i);
  return !!(st && Object.prototype.hasOwnProperty.call(st, param));
}
function clearLocks(all){
  if (all) delete locks[SEQ.lane];
  else if (locks[SEQ.lane]) delete locks[SEQ.lane][SEQ.sel];
}
/* ⚠️ Restored in a finally. A throw mid-step would otherwise leave the voice stuck on one
   step's settings for good, which reads as the kit breaking rather than the sequencer.
   Lifted from PM·1's withLocks(), including this note — fire() reads P[id] when it is
   called, so swapping the values around the call is all it takes. */
function withLocks(id, i, fn){
  const L = lockAt(id, i);
  if (!L) return fn();
  const p = P[id], saved = {};
  for (const k in L){ saved[k] = p[k]; p[k] = L[k]; }
  try { return fn(); } finally { for (const k in saved) p[k] = saved[k]; }
}

const RATES = {"1/8": 2, "1/8t": 3, "1/16": 4, "1/16t": 6, "1/32": 8};

/* A starter pattern, so the panel makes a sound the first time Play is pressed rather
   than asking you to program one before you can hear anything. Four on the floor with a
   backbeat and offbeat hats — the most boring possible bar, which is the right default:
   it is recognisable enough to check the kit against, and nobody will mistake it for a
   creative choice. */
function loadDefaultPattern(){
  ORDER.forEach(k => steps[k].fill(0));
  [0, 4, 8, 12].forEach(i => steps.bd[i] = i === 0 ? 2 : 1);
  [4, 12].forEach(i => steps.sd[i] = 2);
  for (let i = 0; i < 16; i += 2) steps.ch[i] = 1;
  steps.oh[14] = 1;
}
loadDefaultPattern();

let timer = null, nextTime = 0, stepIndex = 0, marks = [];

const beatSeconds = () => 60 / (Patchwork.clock.bpm || 120);
const stepSeconds = () => beatSeconds() / (RATES[SEQ.rate] || 4);

/* The single source of truth for what a step plays — engine and MIDI out both read it,
   so they cannot drift. Returns null for a rest rather than a zero-velocity hit, because
   a zero-velocity note-on is a note-off on most hardware. */
function stepEvent(id, i, t){
  const v = steps[id][i % SEQ.len];
  if (!v) return null;
  return {id, t, vel: v === 2 ? 1 : 1 - SEQ.accentAmt, accent: v === 2};
}

function scheduleStep(idx, t){
  const i = idx % SEQ.len;
  ORDER.forEach(id => {
    const ev = stepEvent(id, i, t);
    if (!ev) return;
    withLocks(id, i, () => fire(ev.id, ev.t, ev.vel));
    sendHit(ev);
  });
  return i;
}

function tick(){
  const step = stepSeconds();
  while (nextTime < ctx.currentTime + .2){
    const at = Math.max(ctx.currentTime + .005, nextTime);
    /* A queued scene lands here, on the loop point, BEFORE anything for this step is
       scheduled — so the pattern that plays from this boundary is the new one. Doing it
       on wall time instead would land it 200 ms late, behind the lookahead. */
    Patchwork.scenes.take("dr1", at);
    /* take() can STOP this instrument, when the row it fired has nothing for it.
       The loop would otherwise carry on scheduling into a transport that is no
       longer running and leave a bar of notes behind after the stop. */
    if (!SEQ.playing) return;
    const i = scheduleStep(stepIndex, at);
    marks.push({i, t: at, end: at + step});
    /* swing advances alternately 2*sw*step and (2-2*sw)*step, summing to 2*step over a
       pair, so the bar's total length is unchanged however hard it shuffles — CS·1's
       model, copied deliberately rather than reinvented */
    const r = Patchwork.clock.rate;
    nextTime += r * ((stepIndex % 2 === 0) ? 2 * SEQ.swing * step : (2 - 2 * SEQ.swing) * step);
    stepIndex++;
  }
  while (marks.length > 24) marks.shift();
}

function startPlay(){
  ensureAudio();
  SEQ.playing = true;
  stepIndex = 0; marks = [];
  /* lands on the running grid when another instrument is already going — see shell/clock.js */
  nextTime = Patchwork.clock.claim(4);
  tick();
  Patchwork.clock.run(tick);
  timer = tick;
  playBtn.classList.add("on");
  playBtn.textContent = "■ Stop";
  requestAnimationFrame(paint);
}

function stopPlay(){
  SEQ.playing = false;
  Patchwork.clock.stop(tick); timer = null;
  chokeOpenHat(ctx ? ctx.currentTime : 0);
  midiPanic();
  playBtn.classList.remove("on");
  playBtn.textContent = "▶ Play";
  clearMarks();
}
