
/* ---- the live page ----
   The scene launcher, made big, with an arm per track and one record button over the top.

   Ableton's gesture, which is the one worth copying: the transport is already running,
   you arm a track, you press record, and what you play lands on the grid. Nothing stops
   and nothing is a take. Arming is a standing choice; record is the momentary one. */
(() => {
"use strict";
const live = document.querySelector("#stLive");
const rack = document.querySelector(".st-rack");
const scenes = document.querySelector(".st-scenes");
const tape = document.querySelector("#stTape");
const lib = document.querySelector("#stLib");
/* the console sits above the deck on the Tape page and is a sibling of it, so it is hidden
   with the view rather than by whatever happens to draw it */
const mix = document.querySelector("#mxWrap");
const settings = document.querySelector("#stSettings");
const grid = document.querySelector("#liveGrid");
if (!live || !window.Patchwork || !Patchwork.record) return;

/* The columns, the cell states and the click table are `Patchwork.launch`'s — shared with
   the studio's small launcher, because the two are views of one grid and drifted apart
   once already. */
/* ---- the punch-in rack ----
   HOLD is the gesture. Press, the effect is in; let go, it is out — which is why these are
   pads rather than knobs and why they are here rather than on a panel: a control you set is
   a mixing decision, a control you hold for two bars is playing.

   The number row does the same thing, because the interesting live gesture is one hand on
   the launcher and one on the effects, and a mouse can only be in one place. */
/* ⚠️ SIXTEEN PADS AND SIXTEEN KEYS, in reading order: the number row, then the row above it.
   Q, W, E, R, T and Y are note keys in shell/keys.js, and on the live page they are taken
   from it — the panels are hidden there, so a note key is playing an instrument you cannot
   see, and an effect is the thing in front of you. The handler preventDefaults, which is
   what keys.js checks. */
const FXKEYS = "1234567890qwerty";
/* `short` is the controller's legend, which packs three characters to a field; `pad` is the
   colour the effect's pad wears there, by family — the filters, the ones that play time back,
   the chops, the rooms, the modulations, the ones that break it, and the one that stops the
   machine — because a pad hit without looking is found by colour before it is found by place. */
const FX = [
  {id: "lp",      name: "LP",      short: "LP",  pad: "cyan",    hint: "how far down the top comes off"},
  {id: "hp",      name: "HP",      short: "HP",  pad: "cyan",    hint: "how far up the bottom goes"},
  {id: "iso",     name: "Iso",     short: "Iso", pad: "cyan",    hint: "which slice is left"},
  {id: "stutter", name: "Stutter", short: "Stt", pad: "orchid",  hint: "how long a slice repeats"},
  {id: "loop",    name: "Loop",    short: "Lop", pad: "orchid",  hint: "how much goes round"},
  {id: "reverse", name: "Reverse", short: "Rev", pad: "orchid",  hint: "how long a slice plays backwards"},
  {id: "repitch", name: "Repitch", short: "Pit", pad: "orchid",  hint: "how far it is shifted"},
  {id: "gate",    name: "Gate",    short: "Gat", pad: "lime",    hint: "how fast it chops"},
  {id: "pump",    name: "Pump",    short: "Pmp", pad: "lime",    hint: "how fast it breathes"},
  {id: "delay",   name: "Delay",   short: "Dly", pad: "blue",    hint: "how much it feeds back"},
  {id: "space",   name: "Space",   short: "Spc", pad: "blue",    hint: "how much goes to the room"},
  {id: "flange",  name: "Flange",  short: "Flg", pad: "magenta", hint: "how fast the notch sweeps"},
  {id: "ring",    name: "Ring",    short: "Rng", pad: "magenta", hint: "what it is multiplied by"},
  {id: "drive",   name: "Drive",   short: "Drv", pad: "amber",   hint: "how hard it is pushed"},
  {id: "crush",   name: "Crush",   short: "Crs", pad: "amber",   hint: "how many bits are left"},
  {id: "stop",    name: "Stop",    short: "Stp", pad: "red",     hint: "how long the machine takes to stop"}
];
const fxPads = document.querySelector("#stFxPads");
const fxLatch = document.querySelector("#stFxLatch");
const fxHint = document.querySelector("#stFxHint");
let latched = false;

function buildFx(){
  if (!fxPads || !window.Patchwork || !Patchwork.fx) return;
  fxPads.textContent = "";
  FX.forEach((f, i) => {
    const b = document.createElement("button");
    b.className = "st-fx-pad";
    b.dataset.fx = f.id;
    b.dataset.key = FXKEYS[i] || "";
    b.title = f.name + " — " + f.hint + ". Hold, or hold " + b.dataset.key.toUpperCase() +
              ". Arrows or the wheel move its number.";
    b.innerHTML = '<span class="st-fx-name"></span><span class="st-fx-val"></span>' +
                  '<span class="st-fx-key"></span>';
    b.querySelector(".st-fx-name").textContent = f.name;
    b.querySelector(".st-fx-key").textContent = b.dataset.key;
    fxPads.appendChild(b);
  });
  paintFx();
}
function paintFx(){
  if (!fxPads) return;
  const focus = Patchwork.fx.focus;
  fxPads.querySelectorAll(".st-fx-pad").forEach(b => {
    const id = b.dataset.fx;
    b.classList.toggle("st-on", Patchwork.fx.active(id));
    b.classList.toggle("st-focus", id === focus);
    b.querySelector(".st-fx-val").textContent = Patchwork.fx.paramText(id);
  });
  fxLatch.classList.toggle("st-on", latched);
  fxLatch.setAttribute("aria-pressed", latched ? "true" : "false");
  const f = FX.find(x => x.id === focus);
  fxHint.textContent = f ? "\u2190 \u2192  " + f.name + " \u00b7 " + f.hint : "";
}
/* Latched, a press is a toggle; held, it is a press. One function so the pointer, the number
   row and the controller's pads cannot end up with different ideas about which.

   `stick` latches this one press and no other — Func and a pad on the controller, where a hand
   on the pads cannot reach over to the Latch button. The answer is whether the matching
   release should let go, which only a caller that remembers its presses one by one asks. */
function fxDown(id, stick){
  const toggle = latched || !!stick;
  if (toggle && Patchwork.fx.active(id)){ Patchwork.fx.release(id); return false; }
  Patchwork.fx.press(id);
  return !toggle;
}
function fxUp(id){ if (!latched) Patchwork.fx.release(id); }

/* What each pointer and each key is holding, so that letting go of one lets go of that one
   and nothing else — see the release note below. */
const byPointer = new Map();
const byKey = new Set();

if (fxPads){
  fxPads.addEventListener("pointerdown", e => {
    const b = e.target.closest(".st-fx-pad"); if (!b) return;
    if (e.pointerId != null) try{ b.setPointerCapture(e.pointerId); }catch(x){}
    byPointer.set(e.pointerId != null ? e.pointerId : 0, b.dataset.fx);
    fxDown(b.dataset.fx);
    e.preventDefault();
  });
  /* The wheel is the pointer's arrow keys. Over a pad it moves that pad's number and takes
     the focus with it, so reaching for one with the mouse and then reaching for the arrows
     carries on where you left off. */
  fxPads.addEventListener("wheel", e => {
    const b = e.target.closest(".st-fx-pad"); if (!b) return;
    Patchwork.fx.setFocus(b.dataset.fx);
    Patchwork.fx.nudge(e.deltaY < 0 ? 1 : -1);
    e.preventDefault();
  }, {passive: false});
  /* ⚠️ RELEASED FROM THE WINDOW, not from the pad. A pad stuck down is an effect you cannot
     turn off, which is the worst failure available to this control — and every way of
     letting go that does not end in a pointerup ON the pad leads there: dragging off it,
     a capture that did not take, the pointer being cancelled, the window losing focus.

     ⚠️ BUT ONLY WHAT THAT POINTER WAS HOLDING. This released everything, which came to the same
     thing while the pointer and the number row were the only hands on the rack — and stopped
     being the same thing when the controller's pads became a third: a click anywhere on the
     page cut an effect a finger on the pads was still holding. Losing the window still lets go
     of whatever the pointer and the keys hold, because their releases will never arrive here.
     A controller's will, so its pads are left alone. */
  const letGo = e => {
    const k = e && e.pointerId != null ? e.pointerId : 0;
    if (!byPointer.has(k)) return;
    const id = byPointer.get(k);
    byPointer.delete(k);
    fxUp(id);
  };
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", letGo);
  window.addEventListener("blur", () => {
    byPointer.forEach(id => fxUp(id)); byPointer.clear();
    byKey.forEach(id => fxUp(id)); byKey.clear();
  });

  fxLatch.addEventListener("click", () => {
    latched = !latched;
    if (!latched) Patchwork.fx.releaseAll();
    paintFx();
  });

  /* ⚠️ Only while the live page is showing, and never while something is being typed into.
     The digits are not in the keyboard map shell/keys.js uses, so nothing is being taken
     from an instrument — but a room name being typed into a prompt is still text. */
  const typing = e => {
    const t = (e.target.tagName || "").toLowerCase();
    return t === "input" || t === "select" || t === "textarea";
  };
  const mine = e => !(live.hidden || e.metaKey || e.ctrlKey || e.altKey || typing(e));
  const keyFx = e => {
    if (!mine(e)) return null;
    const i = FXKEYS.indexOf((e.key || "").toLowerCase());
    return i >= 0 && i < FX.length ? FX[i].id : null;
  };
  /* ⚠️ CAPTURING, and that is not a detail. shell/keys.js takes the left and right arrows to
     move an instrument's octave, and its listener is installed by host.js at load — earlier
     than this one, so in the bubble phase it would win. A capturing listener on document runs
     before every bubble listener on it, and preventDefault here is what keys.js checks for
     before it does anything. On the live page an octave is the wrong thing for an arrow to
     mean anyway: you cannot see the keyboard it would be moving. */
  /* ⚠️ AND STOPPED THERE, not only prevented. host.js hands every key to the focused panel's own
     shortcuts whether or not something already took it, and the panels are hidden on this page —
     so a punch key carried on to a panel you could not see: CS·1 plays a chord on the digits, and
     a held key played it again on every repeat. keys.js was the one handler that looked. */
  document.addEventListener("keydown", e => {
    if (mine(e) && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
      if (Patchwork.fx.nudge(e.key === "ArrowRight" ? 1 : -1)){ e.preventDefault(); e.stopPropagation(); }
      return;
    }
    const id = keyFx(e); if (!id) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    fxDown(id); byKey.add(id);
  }, true);
  document.addEventListener("keyup", e => {
    const id = keyFx(e); if (!id) return;
    e.stopPropagation();
    byKey.delete(id);
    fxUp(id);
  }, true);
  Patchwork.fx.onChange(paintFx);
  buildFx();
}

/* ---- the rack, as a page on the controller ----
   ⚠️ A PAGE, NOT A FACE, and it was a face first. As the launcher's other face it kept the
   launcher's buttons — ">" still launched the row under the cursor, the arrows still walked it,
   and anything that moved the focus took the pads away with it — which, played, was the punch
   page launching scenes. A page outranks the focus for as long as it is up (rig.focus in
   shell/surface.js), so nothing but this spec answers the pads, the encoders, ">" or the arrows.
   The keys still play, and Play and Stop still run the rack.

   Func tapped on the launcher opens it and Func tapped here closes it, back to wherever the
   surface was before. Shift and a mode pad leaves it too, like any page. */
const Surf = window.Patchwork && Patchwork.surface;
if (Surf && Surf.mount && Patchwork.fx){
  let back = "";                             // the mode it was opened from
  let bank = 0;
  const BANKS = [{name: "Top row"}, {name: "Bottom row"}];
  /* reading order onto the surface's cells, where cell 0 is bottom-left — its own inverse */
  const cellOf = i => (i < 8 ? i + 8 : i - 8);
  /* cell -> whether that finger's release lets its effect go, decided at the press: by the
     release, a latched press and a held one look the same to the rack */
  const fingers = new Map();
  const padGrid = {
    label: () => "Punch",
    cells: () => {
      const out = new Array(16).fill(null);
      FX.forEach((f, i) => {
        const cell = cellOf(i), on = Patchwork.fx.active(f.id);
        /* ⚠️ IN WITH NO FINGER ON IT PULSES. A latched effect is the one you can forget is in,
           and an effect you cannot find to take out is the worst failure this rack has. */
        out[cell] = {colour: f.pad, on, hot: on && !fingers.has(cell)};
      });
      return out;
    },
    /* Func and a pad latches that pad; the Latch button on screen latches all of them */
    down: (cell, vel, mods) => {
      const f = FX[cellOf(cell)]; if (!f) return;
      fingers.set(cell, fxDown(f.id, !!(mods && mods.accent)));
      bank = cell >= 8 ? 0 : 1;              // the encoders follow the row you just played
    },
    up: cell => {
      const f = FX[cellOf(cell)], lets = fingers.get(cell);
      fingers.delete(cell);
      if (f && lets) fxUp(f.id);
    }
  };
  Surf.mount("punch", {
    name: "Punch",
    /* read by paint() below, to ring the rack while the pads are on it */
    punching: true,
    show: () => Surf.rig.goto("live"),
    grid: padGrid,
    /* One control per effect: its number, the one the arrows and the wheel move on screen, by
       detent. It takes the focus with it, so the ring on screen follows the knob. */
    controls: () => FX.slice(bank * 8, bank * 8 + 8).map(f => ({
      id: "fx-" + f.id, label: f.name, short: f.short, stepped: true,
      text: () => Patchwork.fx.paramText(f.id),
      nudge: d => { Patchwork.fx.setFocus(f.id); Patchwork.fx.nudge(d); }
    })),
    controlBanks: () => BANKS,
    controlBank: () => bank,
    setControlBank: i => { bank = Math.max(0, Math.min(BANKS.length - 1, i)); },
    face: () => {
      Surf.rig.setMode(back);
      const f = Surf.rig.focus;
      return f ? f.name : "Off";
    },
    faceName: "Pads",
    /* ">" takes everything out: the one thing a hand on the pads cannot otherwise do in one
       press, and the answer to a latched effect you have lost track of */
    actionName: "Punch",
    action: () => {
      if (!Patchwork.fx.any) return null;
      Patchwork.fx.releaseAll();
      return "All out";
    }
  });
  Patchwork.punchUI = {
    open(){
      const was = Surf.rig.mode;
      if (was === "punch") return null;
      back = was;
      Surf.rig.setMode("punch");
      return "Punch";
    }
  };
}

function build(){
  const cols = Patchwork.launch.columns();
  grid.style.setProperty("--cols", cols.length);
  grid.textContent = "";

  const head = document.createElement("div");
  head.className = "st-live-row st-live-head";
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-live-num"}));
  /* Just labels. Arming moved onto each instrument's plate — see shell/record.js — because
     a row of six arm buttons put the choice of what you are recording six columns away
     from the instrument you were playing. */
  cols.forEach(c => {
    const cell = document.createElement("div");
    cell.className = "st-track";
    cell.appendChild(Object.assign(document.createElement("span"),
      {className: "st-track-name", textContent: c.name}));
    head.appendChild(cell);
  });
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-live-num"}));
  grid.appendChild(head);

  Patchwork.scenes.rows.forEach((row, ri) => {
    const el = document.createElement("div");
    el.className = "st-live-row";
    el.appendChild(Object.assign(document.createElement("span"),
      {className: "st-live-num", textContent: row.name}));
    cols.forEach(c => {
      const b = document.createElement("button");
      b.className = "st-cell"; b.dataset.row = ri; b.dataset.inst = c.id;
      Patchwork.launch.mark(b, c.id);
      b.setAttribute("aria-label", c.name + " scene " + row.name);
      el.appendChild(b);
    });
    const fire = document.createElement("button");
    fire.className = "st-fire"; fire.dataset.row = ri;
    el.appendChild(fire);
    grid.appendChild(el);
  });
  paint();
}

function paint(){
  const q = Patchwork.scenes.queued, on = Patchwork.scenes.onRow;
  grid.querySelectorAll(".st-cell").forEach(b =>
    Patchwork.launch.paintCell(b, +b.dataset.row, b.dataset.inst, q, on));
  /* With something armed, the row buttons ARE the record: they take what is on the armed
     tracks now and put it in that row. Nothing armed and they are plain scene fires. */
  const arming = Patchwork.record.armedCount > 0;
  grid.querySelectorAll(".st-fire").forEach(b => {
    b.classList.toggle("st-rec-row", arming);
    b.textContent = arming ? "●" : "▶";
    b.title = arming
      ? "Record the armed tracks into this scene, and play the rest of the row"
      : "Fire this scene (shift-click to capture)";
  });
  document.querySelector("#liveHint").textContent = arming
    ? "Armed. Play, then hit ● on a row to put it there — unarmed tracks just play that row."
    : "Arm an instrument on its own panel to record into a scene row.";
  const anyPlaying = Patchwork.transport.anyPlaying;
  const pb = document.querySelector("#livePlay");
  pb.textContent = anyPlaying ? "■ Stop all" : "▶ Play all";
  pb.classList.toggle("st-on", anyPlaying);
  document.querySelector("#liveBpm").textContent = Patchwork.clock.shown;
  quant.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", b.dataset.q === Patchwork.scenes.quantum));
  quant.querySelector('[data-q="pattern"]').title =
    "Every " + Patchwork.scenes.patternBars + " bars — the pattern length in the Scenes head";
  /* Whether the controller's pads are on the rack, asked of the surface rather than kept here:
     the answer is wherever the pads point, and that is the surface's to know. */
  const Sf = Patchwork.surface, f = Sf && Sf.connected ? Sf.rig.focus : null;
  const rackEl = document.querySelector("#stFx");
  if (rackEl) rackEl.classList.toggle("st-onpads", !!(f && f.spec && f.spec.punching));
}

grid.addEventListener("click", e => {
  const cell = e.target.closest(".st-cell");
  if (cell){
    if (!cell.disabled) Patchwork.launch.click(e, +cell.dataset.row, cell.dataset.inst);
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  if (Patchwork.record.armedCount) Patchwork.record.captureRow(ri);
  else if (e.shiftKey) Patchwork.scenes.storeAll(ri);
  else Patchwork.launch.fireRowShared(ri);
});

/* Master transport. Presses the instruments' own Play buttons rather than reaching into
   their transports, so whatever a panel does when you press Play — arm checks, autostart,
   painting — happens here too instead of being reimplemented and drifting. */
/* ⚠️ Shared, because the console has a Play too. This is the ONE place that knows "play
   all" means clicking each panel's own Play button — so the arm checks, autostart and
   painting each panel does happen, instead of being reimplemented twice and drifting. */
Patchwork.transport = {
  get anyPlaying(){ return rackPlaying(); },
  toggleAll,
};
/* ⚠️ WHILE A TAKE IS ROLLING, THE LOOPER COUNTS. Play all has never started LP·1 and still does
   not — but a take can now begin from a scene, and a scene can hold a looper take. So for as long
   as tape is recording, a looper that is going is part of the band the take is of: a row holding
   only a take leaves the rack reading "stopped" while tape rolls, and the next press would start
   every instrument instead of ending the take.

   Only while recording. A looper you started by hand with the tape idle is not something Play all
   should stop — pressing it to bring the band in over a loop is the ordinary thing to do. */
function rackPlaying(){
  if (Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id))) return true;
  const T = Patchwork.tape;
  return !!(T && T.state === "rec" && Patchwork.launch.anyPlaying());
}
function toggleAll(){
  const anyPlaying = rackPlaying();
  const T = Patchwork.tape;
  /* ⚠️ AN ARMED DECK STARTS THE SONG, NOT THE RACK. With anything on the launcher, the press that
     rolls a take fires the first row that holds something, rather than every panel's Play — so
     what the tape prints is the arrangement, played from its first scene and fired onwards by
     hand, instead of every instrument's current pattern at once, which is a mix of whatever each
     panel was last left holding and is nobody's song.

     Through fireRowShared() for the same reason a row's own ▶ goes there: it is the same gesture,
     and it moves the looper and a jam exactly as that button would. The cursor follows, so ">" on
     the controller walks on from where the song started rather than from wherever it last was.

     An empty launcher has no song, and Play is the rack as it always was. */
  if (!anyPlaying && T && T.armed){
    const row = Patchwork.launch.firstRow();
    if (row >= 0){
      Patchwork.launch.setCursor(row);
      Patchwork.launch.fireRowShared(row);
      T.record();
      return;
    }
  }
  Patchwork.roots.forEach(r => {
    const id = r.dataset.instrument;
    const btn = r.querySelector("#play");
    if (!btn) return;
    const isSeq = Patchwork.scenes.instruments.some(i => i.id === id);
    if (!isSeq) return;                     // the looper is not part of "play all"
    if (Patchwork.scenes.playing(id) === anyPlaying) btn.click();
  });
  /* ⚠️ AN ARMED DECK ROLLS WITH THE RACK, which is the whole reason Record arms rather than
     rolling: the take has to start when the music does, not a reaction time later. Here
     rather than on the deck's own play button because "play" for a rack of instruments is
     THIS, and a take that started when you pressed the tape's play instead would be the one
     button on the page that meant something different from the others.

     Stopping is the mirror: the rack stopping ends the take. Leaving tape running over a
     silent rack records the room going quiet, which nobody has ever wanted. */
  if (!T) return;
  if (!anyPlaying && T.armed) T.record();
  else if (anyPlaying && T.state === "rec"){
    /* ...and the looper stops with it, because a take that began from a scene may be what
       started it — see rackPlaying(). A slot track keeps its transport privately, so it is
       asked to stop rather than having a Play pressed. */
    Patchwork.record.tracks.forEach(t => {
      const k = Patchwork.launch.slotted(t.id);
      if (k && k.stop) k.stop();
    });
    T.stop();
  }
}
document.querySelector("#livePlay").addEventListener("click", () => {
  toggleAll();
  setTimeout(paint, 60);
});
/* When a fired row lands. "Pattern" is CS·1's progression coming round — the harmony is
   the thing everything else should change with. */
const quant = document.querySelector("#liveQuant");
quant.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.scenes.setQuantum(b.dataset.q);
});

document.querySelector("#liveUp").addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.shown + 1));
document.querySelector("#liveDown").addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.shown - 1));

/* ---- the view switch ---- */
const seg = document.querySelector("#stView");
/* A control surface can ask for a view by name. Pressed through the same segmented control
   a click uses, so whatever switching views does happens here too — see shell/surface.js,
   which knows that views exist and nothing whatever about what they are. */
if (window.Patchwork && Patchwork.surface){
  Patchwork.surface.onView(name => {
    const b = seg.querySelector('button[data-v="' + name + '"]');
    if (b) b.click();
  });
}
/* ⚠️ Three views now, so this asks which one is wanted rather than whether it is the live
   one. Written as `rack.hidden = isLive` this breaks the moment a third view exists: the
   rack stays on screen underneath the tape deck, because "not live" stopped meaning
   "studio". Deriving isStudio from the others is what keeps that impossible. */
function show(which){
  const isLive = which === "live", isTape = which === "tape", isLib = which === "lib";
  const isSet = which === "set";
  /* ⚠️ AND THE NEGATION GROWS WITH IT, which is the trap the note above warns about and the
     reason Studio is derived rather than named: a fifth view added without this line leaves
     the rack and the launcher on screen underneath the settings page, because "not live, not
     tape, not library" quietly stopped meaning "studio". */
  const isStudio = !isLive && !isTape && !isLib && !isSet;
  live.hidden = !isLive;
  if (tape) tape.hidden = !isTape;
  if (lib) lib.hidden = !isLib;
  if (mix) mix.hidden = !isTape;
  if (settings) settings.hidden = !isSet;
  rack.hidden = !isStudio;
  scenes.hidden = !isStudio;
  document.body.classList.toggle("living", isLive);
  document.body.classList.toggle("taping", isTape);
  document.body.classList.toggle("shelving", isLib);
  document.body.classList.toggle("setting", isSet);
  seg.querySelectorAll("button").forEach(b => b.classList.toggle("st-sel", b.dataset.v === which));
  if (isLive){
    paint();
    /* the punch rack's reverse is a worklet and loads asynchronously — built here so it is
       ready by the time a pad is pressed rather than a beat after */
    if (Patchwork.fx) try{ Patchwork.fx.prime(); }catch(e){}
  }
  /* The deck's paint loop is started and stopped here rather than left running: the reels
     are a requestAnimationFrame every frame for as long as the page is open, and nobody is
     watching them from the Studio view. Same reason the punch rack primes above. */
  if (Patchwork.tapeUI){
    if (isTape) Patchwork.tapeUI.show(); else Patchwork.tapeUI.hide();
  }
  if (Patchwork.libraryUI){
    if (isLib) Patchwork.libraryUI.show(); else Patchwork.libraryUI.hide();
  }
  if (Patchwork.consoleUI){
    if (isTape) Patchwork.consoleUI.show(); else Patchwork.consoleUI.hide();
  }
}
seg.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  show(b.dataset.v);
});

Patchwork.launch.mountMeasure(document.querySelector("#liveBars"));
Patchwork.scenes.onChange(paint);
Patchwork.record.onChange(paint);
if (Patchwork.sequences) Patchwork.sequences.onChange(paint);
Patchwork.clock.onTempo("live", () => paint(), null);
build();
show("studio");
/* the launcher and the live grid are two views of one model, so a change to either repaints
   whichever is showing */
setInterval(() => { if (!live.hidden) paint(); }, 400);
})();
