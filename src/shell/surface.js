
/* Control surfaces — a controller you pick from a list, not one you teach.

   MIDI learn already exists and is not going anywhere: it is the right answer for a knob
   box nobody has ever seen. It is the wrong answer for a Launchkey, where the pads, the
   encoders and the transport buttons are all documented, all fixed, and all knowable
   before the thing is plugged in. Teaching a controller that ships with a specification
   is thirty clicks spent re-deriving a table someone already published.

   So a profile is that table, plus the two things a learned map can never do:

     - it knows what the LEDs mean, so the surface can be a DISPLAY as well as an input;
     - it knows the whole layout at once, so "pads" can mean the chord slots on CS·1 and
       the sixteen steps on DR·1 without either instrument knowing a Launchkey exists.

   ⚠️ THE PROFILE NEVER TOUCHES AN INSTRUMENT. It speaks to `rig` below, which speaks to
   the adapters instruments already register with Patchwork.midi.route(). One more surface
   is one more file in this directory; one more instrument is two more adapter methods.
   Neither is a change to the other, which is the only reason this stays small.

   The other half of that rule is the reason the LEDs are POLLED rather than pushed. Six
   instruments would otherwise each have to remember to announce every state change that
   could light a pad — a playhead moving, a chord slot sounding, a step being drawn — and
   the one they forgot would be a pad that goes dark for reasons nobody can reproduce.
   Reading the state on a timer and sending only what changed is the same bargain
   shell/session.js already makes with patterns, and for the same reason. */
Patchwork.surface = (() => {
"use strict";

const KEY = "patchwork-surface";
const profiles = [];
const watchers = [];
function notify(){ watchers.forEach(fn => { try{ fn(); }catch(e){} }); }

/* A profile registers itself; shell/launchkey.js is the only caller today.

     {id, name, sysex, detect(inputs, outputs), start(io), stop(io), message(io, data),
      paint(io, rig)}

   `detect` gets the port lists and returns null, or the ports it wants:
     {ctrlIn, ctrlOut, keysIn, label}
   ctrlIn/ctrlOut are the surface's own cable. keysIn is what the page should listen to for
   performance — on a two-port controller that is the OTHER port, and saying so here is
   what makes "pick it from the list" enough to be playing. */
function register(p){ profiles.push(p); notify(); }

/* ---- pages ----
   Not everything worth a controller's encoders is an instrument. The mixer is the obvious
   one: it has no MIDI channel, registers nothing with Patchwork.midi.route(), and is not on
   anybody's focus — and it is exactly the thing you want eight knobs and sixteen pads for.

   A page answers the same adapter contract an instrument does (controls, banks, grid), so
   everything downstream of rig.focus follows it without knowing the difference. What makes
   it a page rather than a panel is only how it is reached: a mode, chosen deliberately,
   rather than whichever panel was last clicked.

     Patchwork.surface.mount("mixer", {name, controls, controlBanks, grid, record, show})

   `show` is optional and is called when the mode is entered — the mixer uses it to bring
   its own tab up, so choosing Mixer on the controller puts the mixer on the screen too.
   Reaching for a page and finding the app still showing something else is the surface and
   the window disagreeing about where you are. */
const pages = new Map();
function mount(id, spec){ pages.set(id, spec); notify(); }

/* ---- where the window is looking ----
   A controller that changes what the encoders do without changing what is on the screen
   leaves the two disagreeing about where you are. The shell has no idea what views exist —
   that is the studio's business, and a standalone build has none — so whoever draws them
   says how to reach one and the profile names the one it wants.

     Patchwork.surface.onView(fn)   // the studio registers its tab switcher
     rig.goto("tape")               // a profile asks for it */
let viewer = null;
function onView(fn){ viewer = fn; }

/* "" is the ordinary state: whatever panel has the focus. Anything else is a mounted page. */
let mode = "";

/* ---- what a profile is allowed to know about the rig ----
   Deliberately small, and deliberately expressed in the words the surface thinks in —
   "the focused instrument's controls", "the grid", "play" — rather than in the words the
   shell thinks in. A profile that reached for Patchwork.scenes directly would be a profile
   that breaks when the launcher changes. */
/* ---- panels that are not MIDI instruments ----
   ⚠️ LP·1 TAKES NO NOTES, so it never registered with Patchwork.midi.route() and the surface
   could not see it at all — focus it and the encoders went blank. Its adapters had nowhere to
   live, because the only door in was the MIDI router's, and claiming a channel purely to be
   findable would be a lie about what the panel does.

     Patchwork.surface.panel("lp1", {name, controls, grid, ...});

   Same spec, other door. An instrument that DOES answer to MIDI keeps handing its adapters to
   route() alongside its channels, because there they sit next to the thing they belong with. */
const panels = new Map();
function panel(id, spec){ panels.set(id, spec); notify(); }
function specOf(id){
  if (panels.has(id)) return panels.get(id);
  const it = Patchwork.midi.list().find(x => x.id === id);
  return it ? it.spec : null;
}
function focusedId(){
  const r = Patchwork.focused;
  return r && r.dataset ? r.dataset.instrument : null;
}

const rig = {
  /* The instrument the surface is aimed at. Focus is already how this page decides where
     the computer keyboard and (in follow mode) incoming notes go, so the pads and encoders
     answering to the same click is one rule rather than a second one to learn. */
  get focus(){
    /* ⚠️ A PAGE OUTRANKS THE FOCUS while its mode is on, and that is the whole mechanism:
       nothing below this line knows whether it is talking to a panel or to the mixer. */
    if (mode && pages.has(mode)){
      const spec = pages.get(mode);
      return {id: mode, name: spec.name || mode, spec};
    }
    const id = focusedId(); if (!id) return null;
    const spec = specOf(id); if (!spec) return null;
    return {id, name: spec.name || id, spec};
  },
  get mode(){ return mode; },
  /* Anything not mounted means "back to the focused panel", so a profile can pass whatever
     its hardware just reported without first checking whether we have a page for it. */
  setMode(id){
    const want = (id && pages.has(id)) ? id : "";
    if (want === mode) return;
    mode = want;
    if (want){
      const spec = pages.get(want);
      try{ if (spec.show) spec.show(); }catch(e){}
    }
    notify();
  },
  /* Bring a view up, if the page this is running on has any. Silent on a standalone build,
     which has one screen and nothing to switch. */
  goto(view){
    if (!viewer || !view) return false;
    try{ viewer(view); return true; }catch(e){ return false; }
  },
  /* ---- record arms, play rolls ----
   ⚠️ ONE RULE ACROSS THREE DIFFERENT RECORDERS, and it is the rule they already followed
   separately. The deck arms and the rack rolls it. An instrument arms and firing a scene row
   records it. The looper arms and a row takes real audio. None of that is new — every one of
   those arms is a button already on the panel — so Record here presses the arm that is
   already there rather than inventing a fourth meaning for a fourth recorder.

   A page says how it arms itself; a panel does not have to, because they all arm the same
   way and shell/record.js put the button on every plate that can take one. */
  record(){
    const f = rig.focus;
    if (f && typeof f.spec.record === "function"){
      try{ f.spec.record(); return true; }catch(e){ return false; }
    }
    const r = Patchwork.focused;
    const b = r && r.querySelector(".arm-toggle");
    if (!b) return false;
    b.click();
    return true;
  },
  /* Whether the thing Record would arm is armed, for a button that should say so. */
  get armed(){
    const f = rig.focus;
    if (f && f.spec && typeof f.spec.armed === "boolean") return f.spec.armed;
    const id = focusedId();
    return !!(id && Patchwork.record && Patchwork.record.isArmed(id));
  },
  /* ⚠️ EVERYTHING, because a Stop button that leaves something running is worse than none —
     you press it, the room does not go quiet, and now you are hunting. Distinct from panic,
     which also chases stuck notes out of external gear. */
  stopAll(){
    if (rig.playing) rig.toggle();
    const T = Patchwork.tape;
    if (T && (T.state === "play" || T.state === "rec")) T.stop();
  },
  /* ---- what Play means here ----
   ⚠️ THE PAGE DECIDES, because on the tape deck the answer depends on what you are about to
   do. Armed, you are making a take and Play has to start the BAND — the deck rolls with it.
   Not armed, you are listening back and Play has to start the TAPE. Both are "play the
   obvious thing", and which one is obvious is a fact about the page rather than about the
   button. A panel has no second transport, so it never has to answer.

   `alt` is the modifier, and it always means the other one — so nothing is ever unreachable
   and there is no state to be in the wrong half of. */
  transport(alt){
    const f = rig.focus;
    if (f && typeof f.spec.transport === "function"){
      try{ f.spec.transport(!!alt); return true; }catch(e){ return false; }
    }
    rig.toggle();
    return true;
  },
  /* Is anything the Play button drives actually running? Broader than `playing`, which is
     the rack alone and is what stopAll and the launcher mean by it. */
  get rolling(){
    const f = rig.focus;
    if (f && f.spec && typeof f.spec.rolling === "boolean") return f.spec.rolling;
    return rig.playing;
  },
  /* ---- the two spare buttons ----
   ⚠️ NAMED FOR THE GESTURE, NOT FOR THE MEANING, because the meaning is the panel's. `>` is
   one press and `bump` is a pair that counts up and down, and what each does is whatever the
   thing you are pointed at says: on the mixer `>` returns the tape to zero, on BS·1 it flips
   saw to square. Same shape as the arrows beside the pads, which page a grid where there is
   one and scrub a tape where there is not.

   Both may return a string, which is what just happened in words — the display flashes it,
   because a button whose effect you cannot see is a button you press twice. */
  get canAct(){
    const f = rig.focus;
    return !!(f && typeof f.spec.action === "function");
  },
  act(){ return said(rig.focus, "action", "actionName", []); },
  /* ⚠️ FUNC TAPPED, WHICH IS THE SAME BARGAIN ">" ALREADY MAKES: held it is a modifier, let
     go having modified nothing it is a button. A panel with two FACES needs one — CS·1 has a
     chord voice and a bass voice and the encoders and pads can only be pointed at one of
     them — and a modifier that has to be held through a whole programming pass is not a
     modifier anyone can use for that. */
  get canFace(){
    const f = rig.focus;
    return !!(f && typeof f.spec.face === "function");
  },
  face(){ return said(rig.focus, "face", "faceName", []); },
  get canBump(){
    const f = rig.focus;
    return !!(f && typeof f.spec.bump === "function");
  },
  /* `alt` is the modifier, so one pair of buttons can carry two things where a panel has
     two worth carrying — BS·1 puts its octave on the plain press and the sub's on the
     modified one. */
  bump(dir, alt){ return said(rig.focus, "bump", "bumpName", [dir, !!alt]); },
  /* Held rather than pressed: a scrub runs while a finger is down and stops when it lifts,
     so a profile passes both edges and the page decides what "moving" means. `speed` is a
     word rather than a number — how fast "fast" is belongs to the thing being scrubbed, not
     to the controller that asked. */
  get canScrub(){
    const f = rig.focus;
    return !!(f && typeof f.spec.scrub === "function");
  },
  scrub(dir, on, speed){
    const f = rig.focus;
    if (!f || typeof f.spec.scrub !== "function") return false;
    try{ f.spec.scrub(dir, on, speed || "fast"); return true; }catch(e){ return false; }
  },
  get instruments(){
    const seen = new Map();
    Patchwork.midi.list().forEach(i => seen.set(i.id, i.name));
    panels.forEach((spec, id) => { if (!seen.has(id)) seen.set(id, spec.name || id); });
    return Array.from(seen, ([id, name]) => ({id, name}));
  },

  /* Up to eight continuous controls for the focused instrument, in the order the
     instrument thinks matters. Missing adapter means an instrument that has not been
     taught this yet, which must read as "no controls" rather than as an error. */
  /* ⚠️ `alt` IS A SECOND EIGHT, NOT A SECOND BANK. Banks are the things you page between and
     stay on; this is the handful you reach for while holding a key and let go of — the
     pattern's own settings rather than its sound. A panel that offers none falls back to its
     ordinary eight, so holding the key never makes a familiar encoder do nothing. */
  /* ⚠️ `layer` NAMES A MODIFIER'S ROLE, NOT ITS KEY. "alt" is the general one and "act" is the
     one that doubles as a button — which is a fact about how a surface is shaped rather than
     about a Launchkey, and the profile decides which of its keys means which. A layer a panel
     does not offer falls back to the ordinary eight, so a familiar encoder never goes dead
     under a key that means nothing here. */
  controls(layer){
    const f = rig.focus;
    if (!f) return [];
    const key = layer === "act" ? "actControls" : layer === "alt" ? "shiftControls" : null;
    if (key && typeof f.spec[key] === "function"){
      try{
        const list = f.spec[key]() || [];
        if (list.length) return list.slice(0, 8);
      }catch(e){}
    }
    if (typeof f.spec.controls !== "function") return [];
    try{ return (f.spec.controls() || []).slice(0, 8); }catch(e){ return []; }
  },
  /* Whether holding that key would actually change anything here, for a display that should
     only announce a layer when there is one. */
  hasLayer(layer){
    const f = rig.focus;
    const key = layer === "act" ? "actControls" : layer === "alt" ? "shiftControls" : null;
    if (!f || !key || typeof f.spec[key] !== "function") return false;
    try{ return (f.spec[key]() || []).length > 0; }catch(e){ return false; }
  },
  /* ⚠️ WHAT THE SECOND EIGHT ARE, NOT WHICH KEY REACHES THEM. The legend used to say
     "Shift", which was a guess about the hardware written into the part of the app furthest
     from it — and the wrong guess, since the key that actually works may be Func. The names
     under it already say what they are; the title should agree with them. */
  layerName(layer){
    const f = rig.focus;
    if (!f || !f.spec) return "Alt";
    return (layer === "act" ? f.spec.actName : f.spec.shiftName) || "Alt";
  },

  /* ---- banks of eight ----
     Eight encoders and more than eight things worth turning, which is every synth here and
     PM·1 by a factor of ten. A bank is "which eight the encoders point at", and the
     instrument decides what that means: on PM·1 it is a group of parameters, on DR·1 it is
     a drum lane, because DR·1's eight encoders were already per-lane and choosing the lane
     IS choosing the eight.

     ⚠️ ONE MECHANISM, TWO MEANINGS, and that is the point rather than a compromise. The
     surface asks "next bank" and gets the next eight; it never learns that one instrument
     spells that as a parameter group and another as a drum. Optional, like paging — an
     instrument with eight or fewer controls says nothing and gets one bank. */
  controlBanks(){
    const f = rig.focus;
    if (!f || typeof f.spec.controlBanks !== "function") return [];
    try{ return f.spec.controlBanks() || []; }catch(e){ return []; }
  },
  controlBank(){
    const f = rig.focus;
    if (!f || typeof f.spec.controlBank !== "function") return 0;
    try{ return Math.max(0, f.spec.controlBank() | 0); }catch(e){ return 0; }
  },
  controlBankBy(d){
    const f = rig.focus;
    if (!f || typeof f.spec.setControlBank !== "function") return false;
    const n = rig.controlBanks().length;
    const to = rig.controlBank() + d;
    if (to < 0 || to >= n) return false;
    try{ f.spec.setControlBank(to); }catch(e){ return false; }
    return true;
  },
  /* What to put on a controller's screen when the bank moves. */
  controlBankName(){
    const b = rig.controlBanks()[rig.controlBank()];
    return b ? (b.name || "") : "";
  },
  /* The grid adapter for the focused instrument, and the launcher when that instrument has
     none. A panel that has not been taught a grid yet would otherwise leave sixteen pads
     dark, which reads as a broken controller rather than as a missing adapter — and the
     scenes are the one thing every studio page has that is worth sixteen pads. */
  grid(){
    const f = rig.focus;
    let g = f && f.spec.grid;
    /* ⚠️ A FUNCTION IS ALLOWED, because a panel can have more than one grid and only knows
       which when asked. CS·1 points the sixteen pads at its chord slots or at its bass
       pattern depending on the face it is showing; a grid captured once at boot would be
       whichever it happened to start on, forever. */
    if (typeof g === "function"){ try{ g = g(); }catch(e){ g = null; } }
    if (g && typeof g.cells === "function") return g;
    return sceneGrid.available() ? sceneGrid : null;
  },
  /* Drums answer wherever the focus is. A drum pad is a drum pad — routing it by focus
     would mean the hardware's own Drum layout stopped making drums the moment you clicked
     another panel, which is not a rule anybody would think to describe.

     ⚠️ ADDRESSED BY LANE INDEX, NOT BY NOTE. Pad n is the kit's nth lane, in the order the
     panel draws them. Going through General MIDI note numbers instead put the kit in a
     different order on the hardware than on the screen — see the same warning in
     dr1/midi.js, which is where that order is decided. */
  drumLanes(){
    const spec = specOf("dr1");
    if (!spec || typeof spec.drumLanes !== "function") return [];
    try{ return spec.drumLanes() || []; }catch(e){ return []; }
  },
  drumFire(i, vel){
    const spec = specOf("dr1");
    if (!spec || typeof spec.drumFire !== "function") return false;
    try{ return !!spec.drumFire(i, vel); }catch(e){ return false; }
  },
  /* What that lane is doing, for the LED over it. Null means the kit has no lane there,
     which a surface should render as a dark pad rather than as an empty one it lights. */
  drumCell(i){
    const spec = specOf("dr1");
    if (!spec || typeof spec.drumCell !== "function") return null;
    try{ return spec.drumCell(i) || null; }catch(e){ return null; }
  },

  /* ---- paging ----
     A grid is sixteen cells and a pattern can be longer than that, so a grid may declare
     more than one page. Most do not — a chord bank and a scene list are both sixteen or
     fewer — so the three methods are optional and this is where "no pages" is turned into
     "exactly one page", rather than in every profile that asks. */
  gridPages(){
    const g = rig.grid();
    if (!g || typeof g.pages !== "function") return 1;
    try{ return Math.max(1, g.pages() | 0); }catch(e){ return 1; }
  },
  gridPage(){
    const g = rig.grid();
    if (!g || typeof g.page !== "function") return 0;
    try{ return Math.max(0, g.page() | 0); }catch(e){ return 0; }
  },
  gridPageBy(d){
    const g = rig.grid();
    if (!g || typeof g.setPage !== "function") return false;
    const at = rig.gridPage(), to = at + d;
    if (to < 0 || to >= rig.gridPages()) return false;
    try{ g.setPage(to); }catch(e){ return false; }
    return true;
  },

  get playing(){
    if (Patchwork.transport) return Patchwork.transport.anyPlaying;
    return !!(Patchwork.clock && Patchwork.clock.running);
  },
  /* Presses the panels' own Play buttons through the studio's shared toggle where there is
     one, and the focused panel's otherwise — a standalone build has exactly one transport
     and no launcher to own it. */
  toggle(){
    if (Patchwork.transport) return Patchwork.transport.toggleAll();
    const r = Patchwork.focused || Patchwork.roots[0];
    const b = r && r.querySelector("#play");
    if (b) b.click();
  },
  get bpm(){ return Patchwork.clock ? Patchwork.clock.bpm : 120; },
  nudgeBpm(d){ if (Patchwork.clock) Patchwork.clock.setBpm(Patchwork.clock.bpm + d); },

  /* Scene rows, when the page has a launcher. A profile asks and gets an empty list on a
     standalone build rather than having to know which build it is running in. */
  get rows(){ return Patchwork.scenes ? Patchwork.scenes.rows.map(r => r.name) : []; },
  fireRow(i){
    if (Patchwork.launch && Patchwork.launch.fireRowShared) Patchwork.launch.fireRowShared(i);
    else if (Patchwork.scenes) Patchwork.scenes.fire(i);
  },
  /* Move the focus one instrument along, which is what a Track button means here. */
  step(dir){
    const roots = Patchwork.roots;
    if (roots.length < 2) return;
    const cur = Patchwork.focused;
    let i = roots.indexOf(cur);
    if (i < 0) i = 0;
    const next = roots[(i + dir + roots.length) % roots.length];
    Patchwork.focus(next);
  },
  panic(){
    Patchwork.midi.list().forEach(it => {
      try{ if (it.spec.panic) it.spec.panic(); }catch(e){}
    });
  }
};


/* ---- the launcher, as a grid ----
   Sixteen scene rows and sixteen pads is not a coincidence worth wasting. Read from the
   top like DR·1's steps and unlike CS·1's chord bank: a scene list is an arrangement going
   down the page, so row 1 belongs on the top-left pad. Cell 0 is still bottom-left — that
   is the surface's contract, not a suggestion — so the arithmetic lives here. */
const cellRow = c => (c < 8 ? c + 8 : c - 8);
const sceneGrid = {
  available(){ return !!(Patchwork.scenes && Patchwork.launch); },
  label: () => "Scenes",
  cells(){
    const out = new Array(16).fill(null);
    if (!Patchwork.scenes) return out;
    const S = Patchwork.scenes;
    const insts = S.instruments;
    const queued = S.queued, onRow = S.onRow;
    S.rows.forEach((row, ri) => {
      if (ri > 15) return;
      const filled = insts.some(i => S.has(ri, i.id));
      if (!filled) return;                       // an empty row is not a pad you can press
      const armed = insts.some(i => queued.get(i.id) === ri);
      const sounding = insts.some(i => onRow.get(i.id) === ri && S.playing(i.id));
      /* Armed pulses, playing is solid green, stored-but-idle is a dim amber you can aim
         at. The three states the launcher already paints on screen, in the three the
         hardware can show. */
      out[cellRow(ri)] = armed ? {colour: "amber", on: true, hot: true}
                               : {colour: sounding ? "green" : "amber", on: sounding};
    });
    return out;
  },
  down(cell){
    const ri = cellRow(cell);
    if (Patchwork.scenes && Patchwork.scenes.rows[ri]) rig.fireRow(ri);
  }
};


/* ---- what the controller actually sent ----
   ⚠️ THE ONE THING A HARNESS CANNOT TELL YOU. tools/build-surface-harness.py fakes both of
   the device's ports and checks every byte in both directions, which proves the profile
   decodes what it was written to decode — and proves nothing whatever about whether the
   hardware sends that. The first button on a real Launchkey that did nothing was a button
   whose number came from a low-resolution figure in a PDF, and there was no way to ask the
   device what it had actually emitted.

   So every message the surface port delivers is kept, sixty-four deep, and can be read from
   the console while the thing is plugged in:

     Patchwork.surface.traffic          // newest last, as hex
     Patchwork.surface.traffic.length   // zero means the control sends nothing at all

   Sixty-four is a couple of seconds of knob-twiddling and one press of everything else,
   which is the window a "that button does nothing" question actually needs. It costs an
   array push per message on a port that carries a few hundred a second at worst. */
const TRAFFIC = 64, SENT = 160;
const traffic = [];
const sent = [];
function record(d, into, note){
  const log = into || traffic;
  if (!d || !d.length) return;
  const hex = Array.from(d).map(b => (b < 16 ? "0" : "") + b.toString(16)).join(" ");
  log.push(note ? hex + "   [" + note + "]" : hex);
  if (log.length > (log === traffic ? TRAFFIC : SENT)) log.shift();
}

/* ---- the connection ----
   One at a time. Two surfaces is a real thing to want and not a thing anyone has asked
   for; supporting it now would mean every LED write carrying an owner, for nobody. */
let live = null;        // {profile, io, timer, release}
let status = "";
let failed = "";

/* What a profile sends through. Sysex is a separate method rather than a flag on send()
   so that a profile written against a page that has the permission cannot silently emit
   nothing on a page that does not — `io.sysex` is the question it is expected to ask. */
function makeIo(profile, det){
  const io = {
    profile,
    ports: det,
    get sysex(){ return Patchwork.midi.sysex; },
    send(bytes){
      const o = Patchwork.midi.output(det.ctrlOut);
      if (!o) return;
      record(bytes, sent);
      try{ o.send(bytes); }catch(e){}
    },
    sendSysex(bytes){
      /* ⚠️ Recorded even when it cannot be sent, and marked. "We never sent it" and "we sent
         it and the device ignored it" are different faults with the same symptom — a dark
         screen — and the log is the only place they look different. */
      if (!Patchwork.midi.sysex){ record(bytes, sent, "no-sysex"); return false; }
      const o = Patchwork.midi.output(det.ctrlOut);
      if (!o){ record(bytes, sent, "no-port"); return false; }
      record(bytes, sent);
      try{ o.send(bytes); return true; }catch(e){ record(bytes, sent, "threw"); return false; }
    },
    state: {}          // the profile's own scratch space, cleared with the connection
  };
  return io;
}

function detectAll(){
  const ins = Patchwork.midi.ports("inputs"), outs = Patchwork.midi.ports("outputs");
  const found = [];
  profiles.forEach(p => {
    let det = null;
    try{ det = p.detect(ins, outs); }catch(e){ det = null; }
    if (det) found.push({profile: p, det});
  });
  return found;
}

/* `keep` is what tells a cable being unplugged from a user choosing "none". Both take the
   surface down; only one of them should mean "and do not come back when it reappears". */
function disconnect(keep){
  if (!live){ if (!keep) save(""); return; }
  try{ if (live.profile.stop) live.profile.stop(live.io); }catch(e){}
  if (live.timer != null) clearInterval(live.timer);
  try{ live.release(); }catch(e){}
  live = null;
  status = "";
  if (!keep) save("");
  notify();
}

/* Connect by profile id. Resolves to true once the surface is running.

   ⚠️ THE SYSEX PROMPT HAPPENS HERE, inside the click that chose the controller, because
   that is the only moment a permission request is explicable. Refusing it is not a
   failure: everything except the screen works without it, so the connection continues. */
function connect(id){
  const hit = detectAll().find(f => f.profile.id === id);
  if (!hit){ failed = "not connected"; notify(); return Promise.resolve(false); }
  const need = hit.profile.sysex && !Patchwork.midi.sysex;
  return (need ? Patchwork.midi.upgrade() : Promise.resolve(true)).then(() => {
    /* Re-detect: an upgrade replaces the MIDIAccess and every port object with it, so the
       ports found a moment ago are stale even though their ids are not. */
    const again = detectAll().find(f => f.profile.id === id);
    if (!again){ failed = "not connected"; notify(); return false; }
    return start(again.profile, again.det);
  });
}

function start(profile, det){
  disconnect(true);
  const io = makeIo(profile, det);
  /* ⚠️ `live` IS SET BEFORE THE PORT IS CLAIMED, and the order is the whole point.
     claim() notifies, restore() below listens for that notification, and restore() calls
     start() — so a start that had not yet marked itself live re-entered itself once per
     notification until the stack ran out. It recovered, because the unwound recursion
     let the outermost call finish, which is exactly why nobody would have found this by
     using it: the surface worked, and only the swallowed errors in the console said
     otherwise. Assigning live first closes the loop at the first hop. */
  live = {profile, io, timer: null, release: function(){}};
  live.release = Patchwork.midi.claim(det.ctrlIn, ev => {
    if (!live || live.io !== io) return;
    record(ev.data);
    try{ profile.message(io, ev.data, rig); }catch(e){ console.error("surface message failed", e); }
  });

  /* The page's performance input follows the profile's word for it. This is the whole
     "pick it from a list and play" claim: on a two-port controller the keys are on the
     port the surface is NOT holding, and nobody should have to know that. */
  if (det.keysIn && (!Patchwork.midi.port || Patchwork.midi.port.id !== det.keysIn))
    Patchwork.midi.select(det.keysIn);

  try{ profile.start(io, rig); }catch(e){ console.error("surface start failed", e); }

  /* 60 ms is under a sixteenth at any tempo this page will run at, so a playhead crossing
     a pad still looks like it lands on the beat, and it is far enough above a frame that
     eight instruments' worth of state reads cost nothing measurable. */
  live.timer = setInterval(() => {
    if (!live) return;
    try{ profile.paint(live.io, rig); }
    catch(e){
      /* ⚠️ SIXTEEN TIMES A SECOND IS TOO OFTEN TO SHOUT AND TOO OFTEN TO SAY NOTHING. This
         used to swallow the error outright, which meant a paint that threw part-way through
         left half the surface frozen — pads still lit, screen stuck on whatever it said when
         it last worked — and nothing anywhere to suggest a reason. Said once, then counted:
         one line names the fault, and the running total is there for anyone who wants to
         know whether it is still happening. */
      live.faults = (live.faults || 0) + 1;
      if (live.faults === 1) console.error("surface paint failed (silenced after this)", e);
    }
  }, 60);

  status = det.label || profile.name;
  failed = "";
  save(profile.id);
  notify();
  return true;
}

/* ---- remembering ----
   The profile id only. Port ids are stable per origin but not across machines, and a
   remembered port that does not exist here is worse than re-detecting one that does. */
function save(id){ try{ localStorage.setItem(KEY, id || ""); }catch(e){} }
function saved(){ try{ return localStorage.getItem(KEY) || ""; }catch(e){ return ""; } }

/* Called once the ports are known. A controller that was chosen before and is plugged in
   now comes back on its own — which is the difference between a setting and a chore.

   ⚠️ It does NOT re-prompt for SysEx. `open()` already asked with the remembered answer,
   so if the page holds it this reconnects with the screen, and if the permission was
   withdrawn it reconnects without one rather than throwing a dialogue at a page load. */
let restoring = false;
function restore(){
  const id = saved();
  if (!id || live || restoring) return;
  const hit = detectAll().find(f => f.profile.id === id);
  if (!hit) return;
  /* Belt as well as braces. The ordering in start() is what actually prevents the
     recursion above; this makes it impossible to reintroduce by moving a line. */
  restoring = true;
  try{ start(hit.profile, hit.det); } finally { restoring = false; }
}

/* Ports come and go while the page is open — that is what onstatechange is for. Two cases
   and they are opposites: the cable this surface is holding has gone, or the cable it was
   waiting for has arrived.

   ⚠️ A SURFACE WHOSE PORT VANISHED IS NOT DISCONNECTED, it is asleep. Clearing the saved
   choice here would mean unplugging a Launchkey to move a desk lost the setting, and the
   user would have to go and find the menu again for a cable they had already chosen. */
Patchwork.midi.onChange(() => {
  if (live){
    const ins = Patchwork.midi.ports("inputs");
    if (!ins.some(p => p.id === live.io.ports.ctrlIn)) disconnect(true);
  }
  if (!live) restore();
});

/* Run one of the spare-button hooks and turn whatever it answers into something to show.
   ⚠️ A hook may return a bare string, in which case the spec's name goes with it, or a
   {name, value} pair when one pair of buttons carries two different things and the name has
   to change with them. Anything else means "nothing happened" and says nothing. */
function said(f, key, nameKey, args){
  if (!f || typeof f.spec[key] !== "function") return null;
  let r;
  try{ r = f.spec[key].apply(null, args); }catch(e){ return null; }
  if (r == null || r === false) return null;
  if (typeof r === "object") return {name: r.name || f.spec[nameKey] || "", value: r.value};
  return {name: f.spec[nameKey] || "", value: r};
}

/* ---- a <select> as a control ----
   ⚠️ HERE RATHER THAN FIVE TIMES OVER. Every panel's second eight is mostly menus — steps,
   rate, key, scale, mood — and each one wrapping its own would be five copies of two
   awkward decisions: that a list under a continuous knob has to be addressed by INDEX, its
   travel divided by however many options there are, and that such a control must be marked
   `stepped` or the surface will push its position back and pin it in place.

   It goes through the element's own change event, so whatever the panel does when the menu
   is used happens here too — a sequencer rebuilding its grid, a progression re-spelling its
   chords. Writing the underlying value instead would move the number and leave the panel
   drawing the old one. */
/* ⚠️ ONE DETENT IS ONE POSITION, and without this a list under an encoder was unusable at
   exactly the sizes people put under one. An absolute encoder travels 0-127; a control with
   N positions rounds that to N, so a two-way segment needs SIXTY-FOUR detents to flip and a
   four-way select needs twenty-one per step. Key and Scale, with two dozen options, felt
   fine — which is why this hid for so long behind "stepped controls are fixed".

   So a list says how to move it by one, and the profile turns the encoder's travel into a
   direction rather than a position. See the encoder branch in shell/launchkey.js. */
function stepper(count, at, go){
  return d => {
    const n = count();
    if (n < 2) return;
    const i = Math.max(0, Math.min(n - 1, at() + (d > 0 ? 1 : -1)));
    if (i === at()) return;
    go(i);
  };
}

function option(el, label, short){
  if (!el || !el.options) return null;
  const last = () => Math.max(1, el.options.length - 1);
  /* ⚠️ A `change` EVENT, NOT JUST THE VALUE. Every panel here listens for change rather than
     polling its selects, and a select written to in script fires nothing on its own — so the
     event is the write. It is also why a panel that REFUSES the change (LP·1 will not resize
     a loop that has takes in it) puts the old value back and this reads it correctly next
     time round. */
  const pick = i => {
    el.selectedIndex = i;
    el.dispatchEvent(new Event("change", {bubbles: true}));
  };
  return {
    id: el.id || label, label, short, stepped: true,
    text: () => {
      const o = el.options[el.selectedIndex];
      return o ? o.textContent.trim() : "";
    },
    get: () => el.selectedIndex / last(),
    set: v => {
      const i = Math.max(0, Math.min(el.options.length - 1, Math.round(v * last())));
      if (i === el.selectedIndex) return;
      pick(i);
    },
    nudge: stepper(() => el.options.length, () => el.selectedIndex, pick)
  };
}

/* ---- a segmented control as a control ----
   The same bargain option() makes, for the other way a panel offers a short list: a row of
   buttons with the current one wearing `on`. Addressed by index, marked `stepped`, and set
   by clicking the button rather than writing anything — so whatever the panel does when the
   row is used happens here too.

   ⚠️ Unlike option(), the current value IS read from the class, because for a segmented
   control that class is not a rendering of the state kept elsewhere — it is where the state
   lives. There is no parameter behind it to prefer. */
function segment(el, label, short){
  if (!el) return null;
  const btns = () => Array.prototype.slice.call(el.querySelectorAll("button"));
  const at = () => {
    const b = btns();
    for (let i = 0; i < b.length; i++) if (b[i].classList.contains("on")) return i;
    return 0;
  };
  const last = () => Math.max(1, btns().length - 1);
  const go = i => { const b = btns()[i]; if (b) b.click(); };
  return {
    id: el.id || label, label, short, stepped: true,
    text: () => { const b = btns()[at()]; return b ? b.textContent.trim() : ""; },
    get: () => at() / last(),
    set: v => {
      const b = btns();
      const i = Math.max(0, Math.min(b.length - 1, Math.round(v * last())));
      if (i === at() || !b[i]) return;
      b[i].click();
    },
    nudge: stepper(() => btns().length, at, go)
  };
}

return {register, mount, panel, onView, option, segment, sceneGrid,
        connect, disconnect, restore, rig,
        get profiles(){ return profiles.map(p => ({id: p.id, name: p.name, sysex: !!p.sysex})); },
        get available(){ return detectAll().map(f => ({id: f.profile.id, name: f.profile.name,
                                                       label: f.det.label || f.profile.name})); },
        get connected(){ return live ? live.profile.id : ""; },
        get traffic(){ return traffic.slice(); },
        /* ...and the other direction, which took three rounds of "is it us or the device?"
           to admit was missing. Deeper than `traffic` because one focus change writes a
           screenful of fields and a grid of LEDs in a single tick. */
        get sent(){ return sent.slice(); },
        /* How many paints have thrown since connecting. Zero is the only good answer. */
        get faults(){ return live ? (live.faults || 0) : 0; },
        get status(){ return status; },
        get error(){ return failed; },
        onChange: fn => watchers.push(fn)};
})();
