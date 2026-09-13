
/* ============ boot ============ */

/* A scene row can arm a transition, which is the point of it being on the launcher at all:
   the row you fire to change the part is the row that should announce the change. `capture`
   is the whole setting, so different rows can hold different transitions — a 1-bar fill on
   one, an 8-bar riser on another. */
Patchwork.scenes.register("ts1", {
  name: "TS·1",
  isPlaying: () => TS.armed,
  /* ⚠️ start() ARMS rather than starting a transport. TS·1 has none: it is a gesture with
     an end, so "playing" means "one is on its way" and it ends by itself. */
  start: () => { ensureAudio(); if (!TS.armed) schedule(); },
  stop: () => cancel(),
  capture: () => ({bars: TS.bars, shape: TS.shape, character: TS.character,
                   depth: TS.depth, impact: TS.impact, fill: TS.fill,
                   fillVariant: TS.fillVariant, carry: TS.carry,
                   fxLevel: TS.fxLevel, fillLevel: TS.fillLevel, space: TS.space}),
  apply: pat => {
    ["bars","shape","character","depth","impact","fill","fillVariant","carry",
     "fxLevel","fillLevel","space"].forEach(k => {
      if (pat[k] != null) TS[k] = pat[k];
    });
    paintBars(); paintShape(); paintChar(); paintFill(); paintCarry(); paintImpact();
    fillVariants();
    paintDepth(); paintSpace(); paintFx(); paintFillLvl(); paintRead();
  }
});

/* The sound, for a jam. Same list as the scene, because for this instrument the settings
   ARE the sound — there is no patch underneath them. */
Patchwork.session.registerPatch("ts1", {
  capture: () => ({bars: TS.bars, shape: TS.shape, character: TS.character,
                   depth: TS.depth, impact: TS.impact, fill: TS.fill,
                   fillVariant: TS.fillVariant, carry: TS.carry,
                   fxLevel: TS.fxLevel, fillLevel: TS.fillLevel, space: TS.space}),
  apply: p => {
    ["bars","shape","character","depth","impact","fill","fillVariant","carry",
     "fxLevel","fillLevel","space"].forEach(k => {
      if (p[k] != null) TS[k] = p[k];
    });
    paintBars(); paintShape(); paintChar(); paintFill(); paintCarry(); paintImpact();
    fillVariants();
    paintDepth(); paintSpace(); paintFx(); paintFillLvl(); paintRead();
  }
});

/* ---- MIDI ----
   Any note arms one. There is nothing to pitch, so which note you press does not matter,
   and making it matter would invent a mapping nobody asked for — this is a footswitch. */
const MIDI = {inCh: -1};
function midiPanic(){ cancel(); paintRead(); }
function onMidi(e){
  const d = e.data; if (!d || !d.length) return;
  const s = d[0];
  if (s >= 0xF0) return;
  if (MIDI.inCh >= 0 && (s & 0x0F) !== MIDI.inCh) return;
  const type = s & 0xF0;
  if (type === 0x90 && d[2] > 0){ ensureAudio(); if (!TS.armed) schedule(); paintRead(); }
  else if (type === 0xB0 && (d[1] === 120 || d[1] === 123)) midiPanic();
}
/* ---- and out ----
   ⚠️ A TRANSITION IS ONE EVENT, so its MIDI out is one note rather than a stream. It fires
   when the sweep LANDS, not when you arm it: the whole shape of this instrument is that you
   ask for something up to eight bars before it happens, and a receiver told at the arming
   would drop its impact at the wrong end of the run-up.

   The note is the middle C the rest of this rack would call C4, because there is nothing to
   transpose — one gesture, one trigger, and the channel is what separates it from anything
   else on the wire. */
const TS_NOTE = 60;
const OUT = Patchwork.midi.sender(() => MIDI.outCh);
/* ⚠️ SCHEDULED, NOT WATCHED FOR. The landing is an audio time that is known the moment the
   transition is armed — up to eight bars ahead — so the trigger is put on the wire with a
   timestamp exactly as the sweep is put on the audio clock. Waiting for a state change would
   send it a main-thread tick late, which for the one event this instrument exists to
   announce is the wrong place by exactly the amount that matters.

   Called from schedule() and fireNow() in engine.js, which are the two places a landing time
   is decided. Hoisted, so the engine can reach it although it is written here. */
function sendLanding(landAt){
  const c = Patchwork.audio.ctx;
  if (!c) return;
  const at = Patchwork.midi.portTime(landAt);   // port time, not audio time — see shell/midi.js
  OUT.noteOn(TS_NOTE, 110, at);
  /* A trigger with no length: a receiver wants an edge, and a note left on is a note
     somebody else has to chase. */
  OUT.noteOff(TS_NOTE, at + 120);
}

if (navigator.requestMIDIAccess && window.isSecureContext){
  Patchwork.midi.route("ts1", onMidi, function(){}, {
    name: "TS·1", panic: midiPanic,
    controls: surfaceControls, shiftControls: surfaceShiftControls, shiftName: "Set",
    action: surfaceAction, actionName: "TS\u00b71",
    inCh: {get: () => MIDI.inCh, set: c => { MIDI.inCh = c; }},
    outCh: {get: () => MIDI.outCh, set: c => { OUT.allOff(); MIDI.outCh = c; }}
  });
  Patchwork.midi.open().catch(() => {});
}

/* The fill needs a kit; without one the sweep still works and the fill silently does not.
   Saying so on the panel beats leaving somebody to wonder why Roll does nothing. */
function paintKit(){
  const seg = $("#tsFill");
  if (!seg) return;
  const ok = Patchwork.kit && Patchwork.kit.ready;
  seg.classList.toggle("ts-nokit", !ok);
  seg.title = ok ? "Played on " + Patchwork.kit.name + "'s voices"
                 : "No drum machine on this page — fills need one";
}
if (Patchwork.kit) Patchwork.kit.onChange(paintKit);
paintKit();

window.__ts1 = {TS, schedule, fireNow, cancel, untilLanding, ensureAudio,
                get ctx(){ return ctx; }};
