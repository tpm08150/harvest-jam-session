
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

/* ---- a drum track ----
   Eight lanes of on/off/accent, which is DR·1's model with the voices taken out: there is no
   kit here, only note numbers, and 0/1/2 in a flat array is what a hundred and twenty-eight
   cells per lane should cost. */
function makeDrum(ch, send){
  const lanes = GM.map(g => ({note: g.note, name: g.name,
                              steps: new Array(MAX_STEPS).fill(0)}));
  const T = {len: 16, rate: "1/16", swing: .5, playing: false, sel: 0, lane: 0, bank: 0,
             vel: 100, accentAmt: .35};
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
      const step = stepSeconds();
      while (nextTime < ctx.currentTime + .2){
        const at = Math.max(ctx.currentTime + .005, nextTime);
        fire(stepIndex, at);
        marks.push({i: stepIndex % T.len, t: at, end: at + step});
        const r = Patchwork.clock.rate;
        nextTime += r * ((stepIndex % 2 === 0) ? 2*T.swing*step : (2 - 2*T.swing)*step);
        stepIndex++;
      }
      while (marks.length > 40) marks.shift();
    },
    /* press cycles off → on → accent → off, the same three states DR·1's pads walk. */
    press(lane, i){
      const l = lanes[lane]; if (!l || i >= MAX_STEPS) return;
      l.steps[i] = (l.steps[i] + 1) % 3;
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
