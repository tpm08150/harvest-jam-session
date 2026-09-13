
/* ---- SQ·1 in the rack ----
   ⚠️ IT REGISTERS AS AN INSTRUMENT ALTHOUGH IT HAS NO VOICE. A scene is "what everything is
   playing", and a sequencer whose patterns were not part of that would be the one thing on
   the page a scene could not recall — which on a rig where the drums live in a box on the
   desk is most of the arrangement.

   All sixteen tracks go into one scene cell, because they are one instrument: firing a row
   should change the whole sequencer, not one channel of it. */
Patchwork.scenes.register("sq1", {
  name: "SQ·1",
  isPlaying: () => anyPlaying(),
  start: () => playAll(true),
  stop: () => playAll(false),
  capture: () => ({tracks: tracks.map(t => ({style: t.style, mute: t.mute,
                                             drum: t.drum.capture(),
                                             synth: t.synth.capture()}))}),
  apply: pat => {
    if (!pat || !Array.isArray(pat.tracks)) return;
    pat.tracks.forEach((s, i) => {
      const t = track(i);
      if (!s) return;
      /* ⚠️ Both halves are restored whatever the style, for the reason both halves exist:
         a scene that dropped the drum pattern of a track set to synth would quietly empty it
         the first time somebody switched over to look. */
      t.drum.apply(s.drum);
      t.synth.apply(s.synth);
      t.mute = !!s.mute;
      setStyle(i, s.style === "drum" ? "drum" : "synth");
    });
    showTrack();
  }
});

/* ---- sixteen of them ----
   See shell/sequences.js. A sequence here is all sixteen tracks, for the reason a scene cell is:
   they are one instrument, and choosing a sequence changes the whole sequencer. The strip sits
   above the track row, because a sequence holds tracks and not the other way round. Any track's
   shared sequencer knows what an empty synth half is. */
Patchwork.sequences.register("sq1", {
  after: ".plate",
  blank: p => ({tracks: ((p && Array.isArray(p.tracks)) ? p.tracks : []).map(t => Object.assign({}, t, {
    drum: Object.assign({}, t && t.drum, {lanes: ((t && t.drum && t.drum.lanes) || []).map(l =>
      ({note: l.note, steps: new Array(MAX_STEPS).fill(0)}))}),
    synth: track(0).synth.seq.blankOf(t && t.synth)
  }))}),
  used: p => !!(p && Array.isArray(p.tracks) && p.tracks.some(t => t && (
    ((t.drum && t.drum.lanes) || []).some(l => (l.steps || []).some(v => v))
    || track(0).synth.seq.usedIn(t.synth))))
});

/* The whole sequencer as a patch, so a set of channel assignments and lane notes is
   something you can keep — which for outboard gear is most of the setup. */
Patchwork.session.registerPatch("sq1", {
  name: "SQ·1",
  capture: () => ({v: 1, sel,
                   tracks: tracks.map(t => ({style: t.style, mute: t.mute,
                                             drum: t.drum.capture(),
                                             synth: t.synth.capture()}))}),
  apply: p => {
    if (!p || !Array.isArray(p.tracks)) return;
    p.tracks.forEach((s, i) => {
      const t = track(i);
      if (!s) return;
      t.drum.apply(s.drum);
      t.synth.apply(s.synth);
      t.mute = !!s.mute;
      setStyle(i, s.style === "drum" ? "drum" : "synth");
    });
    if (p.sel != null) sel = Math.max(0, Math.min(TRACKS - 1, p.sel | 0));
    showTrack();
  }
});

/* ⚠️ LIVE RECORDING GOES TO THE SELECTED TRACK, and only to a synth one. A drum track has no
   pitch to take — a note played into it would have to guess which of eight lanes it meant,
   and guessing is worse than not offering. The shared recorder already answers "which step"
   and "how long you held it"; this only says which sequencer is listening. */
Patchwork.record.register("sq1", {
  name: "SQ·1",
  write: (midi, vel, when) => {
    const t = cur();
    if (t.style !== "synth") return -1;
    const i = t.synth.seq.recordAt(midi, vel, when);
    if (i >= 0 && grid) grid.paint();
    return i;
  },
  hold: (from, when) => {
    const t = cur();
    if (t.style !== "synth") return 0;
    const n = t.synth.seq.holdTo(from, when);
    if (n && grid) grid.paint();
    return n;
  }
});

/* ---- what it answers on ----
   ⚠️ ONE INPUT CHANNEL FOR THE PANEL, sixteen output channels for the tracks. The output
   channel is not a setting here and must not become one: it IS the track number, which is the
   whole model. The input is how you play notes INTO the selected track, and it is the only
   channel this instrument listens on. */
const MIDI = {inCh: -1};
function onMidi(e){
  const d = e.data, s = d[0];
  if (s >= 0xF0) return;
  if (MIDI.inCh >= 0 && (s & 0x0F) !== MIDI.inCh) return;
  const type = s & 0xF0;
  if (type === 0xB0 && (d[1] === 120 || d[1] === 123)){ panic(); return; }
  if (type === 0x90 && d[2] > 0){
    const t = cur();
    if (t.style === "synth"){
      t.synth.seq.played(d[1], d[2]);
      Patchwork.record.note("sq1", d[1], d[2]);
      if (grid) grid.paint();
    }
  } else if (type === 0x80 || (type === 0x90 && d[2] === 0)){
    Patchwork.record.noteOff("sq1", d[1]);
  }
}

if (navigator.requestMIDIAccess && window.isSecureContext){
  Patchwork.midi.route("sq1", onMidi, function(){}, {
    name: "SQ·1", panic,
    controls: surfaceControls,
    grid: surfaceGrid,
    bump: surfaceBump, bumpName: "Track",
    action: surfaceAction, actionName: "Style",
    altAction: surfaceAltAction, altActionName: "Mode",
    inCh: {get: () => MIDI.inCh, set: c => { MIDI.inCh = c; }}
  });
  Patchwork.midi.open().catch(() => {});
}

window.__sq1 = {tracks, track, TRACKS, MAX_STEPS, LANES, RATES,
                playAll, anyPlaying, setStyle, setMute, panic,
                get sel(){ return sel; }, showTrack};
