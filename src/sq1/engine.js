
/* ============ engine ============ */
/* Sixteen tracks, one per MIDI channel, each sixty-four steps long.

   ⚠️ THIS INSTRUMENT MAKES NO SOUND. Every other panel here ends at the audio bus; this one
   ends at a MIDI cable, and what it is for is the box on the other side of it. That single
   fact decides most of what follows — there is no strip, no fader, no patch of its own, and
   the only thing it can be wrong about is timing.

   ⚠️ AND EACH TRACK KEEPS ITS OWN TRANSPORT, which is the whole reason to own one of these
   rather than run everything off one grid. A twelve-step hat against a sixteen-step bass is
   a polyrhythm; the same two locked to one length is a fill you have to write out longhand.
   So a track has its own length, its own rate and its own playhead, and they meet only at
   the shell's clock — which is what keeps them phase-locked to the rest of the rack rather
   than merely near it. */

const TRACKS = 16;
const MAX_STEPS = 64;
const LANES = 8;

/* ⚠️ THE GENERAL MIDI DRUM MAP AS A STARTING POINT, NOT AS A RULE. Outboard gear agrees
   about almost nothing, and a sequencer that could only address the notes a 1991 sound
   module used would be useless in front of most of it — so these are defaults you edit, and
   the panel says so. Named for what they usually are rather than what the spec calls them. */
const GM = [{note: 36, name: "BD"}, {note: 38, name: "SD"}, {note: 39, name: "CP"},
            {note: 45, name: "LT"}, {note: 50, name: "HT"}, {note: 42, name: "CH"},
            {note: 46, name: "OH"}, {note: 37, name: "RS"}];

const RATES = {"1/4":1, "1/4t":1.5, "1/8":2, "1/8t":3, "1/16":4, "1/16t":6, "1/32":8};

const clampf = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const beatSeconds = () => 60 / (Patchwork.clock.bpm || 120);

/* ⚠️ UP WHILE A PATTERN IS BEING PUT DOWN ON THE TRACKS — see the scene apply in boot.js. A track
   that apply() starts or restyles ticks before its start() returns, and every tick asks take() for
   a queued row; asking from in there could land a row halfway through somebody else's pattern. So
   while this is up no track asks, and the row lands whole on the next step that does. */
let landing = false;

/* ---- a drum track ----
   Eight lanes of on/off/accent, which is DR·1's model with the voices taken out: there is no
   kit here, only note numbers, and 0/1/2 in a flat array is what a hundred and twenty-eight
   cells per lane should cost. */
function makeDrum(ch, send){
  const lanes = GM.map(g => ({note: g.note, name: g.name,
                              steps: new Array(MAX_STEPS).fill(0)}));
  const T = {len: 16, rate: "1/16", swing: .5, playing: false, sel: 0, lane: 0, bank: 0,
             vel: 100, accentAmt: .35,
             /* ⚠️ WHAT A PRESS WRITES IS A SETTING, not a cycle — DR·1's words and DR·1's
                reason. Off → on → accent → off is elegant right up to the moment you want a
                step gone and the only route there is through accenting it first: two presses
                to undo one, on the gesture you make most often with a pattern running. */
             write: "step"};
  let nextTime = 0, stepIndex = 0, marks = [];

  const stepSeconds = () => beatSeconds() / (RATES[T.rate] || 4);
  function fire(i, at){
    const gate = stepSeconds() * .5;
    lanes.forEach(l => {
      const v = l.steps[i % T.len];
      if (!v) return;
      const vel = clampf(Math.round(T.vel * (v === 2 ? 1 + T.accentAmt : 1)), 1, 127);
      send.noteOn(l.note, vel, at);
      /* ⚠️ A drum is a trigger and the note-off is a courtesy, but it is not optional: a
         receiver that latches would hold the note forever, and "forever" on a hi-hat is a
         sound nobody can explain afterwards. Half a step is long enough to register and
         short enough never to overlap the next hit. */
      send.noteOff(l.note, at + gate);
    });
  }
  return {
    kind: "drum", T, lanes, get steps(){ return lanes; },
    stepSeconds,
    playingStep(){
      const ctx = Patchwork.audio.ctx;
      if (!ctx || !T.playing) return -1;
      const now = ctx.currentTime;
      for (let k = marks.length - 1; k >= 0; k--)
        if (marks[k].t <= now && now < marks[k].end) return marks[k].i;
      return -1;
    },
    start(){
      if (T.playing) return;
      T.playing = true; stepIndex = 0; marks = [];
      nextTime = Patchwork.clock.claim(4);
      this.tick(); Patchwork.clock.run(this.tick);
    },
    stop(){
      if (!T.playing) return;
      T.playing = false;
      Patchwork.clock.stop(this.tick);
      marks = [];
      send.allOff();
    },
    tick: function tick(){
      const ctx = Patchwork.audio.ctx;
      if (!ctx || !T.playing) return;
      /* Once per tick as well as once per step — see the note in pm1's tick. */
      if (!landing) Patchwork.scenes.take("sq1", ctx.currentTime);
      if (!T.playing) return;
      while (nextTime < ctx.currentTime + .2){
        const at = Math.max(ctx.currentTime + .005, nextTime);
        /* ⚠️ EVERY PLAYING TRACK ASKS, BEFORE EVERY STEP, AND ALL UNDER ONE NAME.

           A row fired at a running rack waits in shell/scenes.js until the instrument calls take()
           from inside its own scheduling loop, and nothing in SQ·1 ever did. So a row that changed
           it while it played flashed armed for as long as it kept playing, and a row with nothing
           for it never stopped it. Measured on Bar before this: nearly two bars past the seam the
           cell still read armed, take() had not been called for "sq1" once, and all sixteen notes
           sent after the line were the old row's.

           WHICH track asks was the real question, and the answer is every one that is playing.
           The rule every other instrument keeps is that nothing at or past the seam is scheduled
           from the old pattern. Here sixteen transports at their own rates each schedule their own
           steps, in whatever order the clock runs their ticks — and a track goes to the back of
           that order every time it restarts — so one appointed track could ask second, after a
           faster one had already put the old pattern on the line. With every track asking before
           every step, the first step at or past the seam, on whichever track reaches it, lands
           the row for all sixteen, and nothing after it on any track is scheduled from the old
           row.

           ⚠️ AND THE ROW LANDS ONCE. There is one pending entry, under "sq1", and take() deletes
           it before it calls apply() — so the other fifteen find nothing left to take. The one
           way left to run an apply inside another is from apply() itself, where a track it starts
           ticks at once and would ask; `landing` is what stops that. */
        if (!landing) Patchwork.scenes.take("sq1", at);
        /* take() can stop this track: a row with nothing for SQ·1 stops all sixteen, and one that
           mutes this track or changes its style stops this half of it. Scheduling on would leave
           a step of the old row sounding after the stop. */
        if (!T.playing) return;
        fire(stepIndex, at);
        /* ⚠️ READ AFTER take(), NOT BEFORE THE LOOP — see the same note in pm1's tick. A row can
           change this track's rate and swing, and a length read above the loop would advance the
           rest of this pass by the old one, with the error kept in nextTime for good. */
        const step = stepSeconds();
        marks.push({i: stepIndex % T.len, t: at, end: at + step});
        const r = Patchwork.clock.rate;
        nextTime += r * ((stepIndex % 2 === 0) ? 2*T.swing*step : (2 - 2*T.swing)*step);
        stepIndex++;
      }
      while (marks.length > 40) marks.shift();
    },
    /* One place, so a mouse press, a pad press and a modifier cannot disagree about what a
       step becomes. ⚠️ Accent on an EMPTY step writes an accented step rather than nothing:
       you are asking for a loud hit there, and making you draw it twice would be the second
       press this whole change exists to remove. Straight from DR·1's nextValue(). */
    press(lane, i, accent){
      const l = lanes[lane]; if (!l || i >= MAX_STEPS) return;
      const v = l.steps[i];
      const wantAccent = accent == null ? T.write === "accent" : !!accent;
      l.steps[i] = wantAccent ? (v === 2 ? 1 : 2) : (v ? 0 : 1);
    },
    clear(){ lanes.forEach(l => l.steps.fill(0)); },
    count(){ return lanes.reduce((n, l) => n + l.steps.reduce((m, v) => m + (v ? 1 : 0), 0), 0); },
    capture(){ return {len: T.len, rate: T.rate, swing: T.swing, vel: T.vel,
                       lanes: lanes.map(l => ({note: l.note, steps: l.steps.slice()}))}; },
    apply(p){
      if (!p) return;
      if (p.len) T.len = p.len;
      if (p.rate) T.rate = p.rate;
      if (p.swing != null) T.swing = p.swing;
      if (p.vel != null) T.vel = p.vel;
      if (Array.isArray(p.lanes)) p.lanes.forEach((s, k) => {
        const l = lanes[k]; if (!l || !s) return;
        if (s.note != null) l.note = clampf(s.note | 0, 0, 127);
        if (Array.isArray(s.steps))
          for (let i = 0; i < MAX_STEPS; i++) l.steps[i] = s.steps[i] ? (s.steps[i] === 2 ? 2 : 1) : 0;
      });
    }
  };
}

/* ---- a synth track ----
   ⚠️ THE SHARED SEQUENCER, TRANSPORT AND ALL. makeSeq() already carries pitch as a scale
   degree, accent, slide, tie, per-step parameter locks, live recording and its own
   lookahead — and a second copy of any of that written here would be a second set of bugs.
   What this supplies is the one thing it does not have: somewhere to send a note.

   It keeps its OWN transport rather than being driven from a scheduler here, which is what
   makes the per-track rate free: each instance claims the shell's grid on start and counts
   at its own rate from there. */
function makeSynth(ch, send){
  let seq = null;
  const outNote = ev => clampf(Math.round(ev.n), 0, 127);
  seq = Patchwork.makeSeq({
    /* ⚠️ THE SAME id ON ALL SIXTEEN. Without one the shared sequencer's tick never calls take(),
       which is how a queued row never landed on a synth track; and it is the instrument's name
       rather than the track's, because a row is for the whole sequencer. See the drum track's
       tick above for why every track asks, and why sixteen of them asking still lands it once.

       ⚠️ A GETTER, because the tick reads it before every call and skips the call without one —
       the only say the shared sequencer gives a caller over whether it asks. None while
       `landing`. */
    get id(){ return landing ? null : "sq1"; },
    maxSteps: MAX_STEPS, len: 16, rate: "1/16", root: 48,
    fire: (ev, at) => {
      const c = Patchwork.audio.ctx;
      const ms = t => performance.now() + Math.max(0, t - (c ? c.currentTime : 0)) * 1000;
      const n = outNote(ev);
      const vel = clampf(Math.round(127 * ev.vel), 1, 127);
      send.noteOn(n, vel, ms(at));
      /* `hold` is how many steps a tie carries the note through, and `dur` already has the
         gate applied — so the length written on the grid is the length on the wire. */
      send.noteOff(n, ms(at + ev.dur));
    }
  });
  return {
    kind: "synth", seq, get T(){ return seq.SEQ; },
    start(){ seq.start(); }, stop(){ seq.stop(); send.allOff(); },
    clear(){ seq.clearPattern(); },
    count(){ return seq.countPattern(); },
    capture(){ return seq.capture(); },
    apply(p){ seq.apply(p); }
  };
}

/* ---- the rack of sixteen ----
   ⚠️ BOTH MODELS LIVE FOR EVERY TRACK, and only one of them plays. Switching a track from
   drum to synth and back is a thing you do while looking for a sound, not a decision you
   commit to — and a switch that threw away the pattern you had just written would be one
   you learn never to touch. Two patterns per track is sixteen kilobytes; a lost pattern is
   the afternoon. */
const tracks = [];
for (let i = 0; i < TRACKS; i++){
  const send = Patchwork.midi.sender(i);
  tracks.push({
    ch: i, style: "synth", mute: false, send,
    drum: makeDrum(i, send),
    synth: makeSynth(i, send),
    get live(){ return this.style === "drum" ? this.drum : this.synth; },
    get playing(){ return this.style === "drum" ? this.drum.T.playing : this.synth.T.playing; }
  });
}
const track = i => tracks[clampf(i | 0, 0, TRACKS - 1)];

/* ⚠️ STOPPING A TRACK STOPS BOTH HALVES OF IT, because switching style while running would
   otherwise leave the half you switched away from still counting — and still sending. */
function stopTrack(t){ t.drum.stop(); t.synth.stop(); }
function setStyle(i, style){
  const t = track(i);
  const was = t.playing;
  if (t.style === style) return;
  stopTrack(t);
  t.style = style === "drum" ? "drum" : "synth";
  if (was) t.live.start();
}
function playAll(on){
  tracks.forEach(t => {
    if (!on){ stopTrack(t); return; }
    if (!t.mute) t.live.start();
  });
}
const anyPlaying = () => tracks.some(t => t.playing);
function setMute(i, on){
  const t = track(i);
  t.mute = !!on;
  if (t.mute) stopTrack(t);
  else if (anyPlaying()) t.live.start();
}
function panic(){ tracks.forEach(t => { stopTrack(t); t.send.allOff(); }); }
