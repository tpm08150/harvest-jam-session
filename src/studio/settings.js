
/* ---- Settings, on the controller ----
   ⚠️ EVERY CONTROL HERE IS THE PAGE'S OWN SELECT, driven through option() rather than
   reimplemented. A surface page that kept its own idea of which channel DR·1 answers on
   would be a second answer to a question that already has one, and the two would drift the
   first time either was changed from the other end. So this page is a MAP of the tab, and
   the tab is where the behaviour lives.

   ⚠️ AND IT IS A PAGE, NOT A PANEL. A page outranks the focus while its mode is on — see
   rig.focus in shell/surface.js — which is exactly right here: the whole point is to reach
   VC·1's channels without first going and clicking on VC·1. */
(() => {
"use strict";
const S = window.Patchwork && Patchwork.surface;
if (!S || !S.mount) return;

const q = sel => document.querySelector(sel);
const opt = (sel, label, short) => Patchwork.surface.option(q(sel), label, short);

/* Which panels have a row, in the order the tab lists them. Read fresh every time: a page
   built once at boot would be missing whatever registered after it. */
function panels(){
  const midi = (Patchwork.midi && Patchwork.midi.list) ? Patchwork.midi.list() : [];
  /* ⚠️ WHO REGISTERED AS AN INSTRUMENT, not who has a data-instrument attribute. The
     launcher carries one so that it can be selected like a panel, and it has no strip, no
     channel and no audio of its own — a row for it here would be three dead selects. Asking
     the registries rather than the DOM is what keeps the two ideas apart. */
    const plays = (Patchwork.scenes && Patchwork.scenes.instruments) || [];
    const takes = (Patchwork.record && Patchwork.record.tracks) || [];
    const real = id => midi.some(x => x.id === id) || plays.some(x => x.id === id)
                    || takes.some(x => x.id === id);
    return (Patchwork.roots || []).map(r => {
      const id = r.dataset.instrument;
      const m = midi.find(x => x.id === id);
      const t = Patchwork.record && Patchwork.record.track ? Patchwork.record.track(id) : null;
      return {id, name: (m && m.name) || (t && t.name) || id.toUpperCase()};
    }).filter(x => x.id && real(x.id));
}

/* ---- the banks ----
   Global first, because "which interface" and "which MIDI port" are the questions you have
   to answer before any of the per-instrument ones mean anything. */
function banks(){
  return [{name: "Global"}].concat(panels().map(p => ({name: p.name})));
}
let bank = 0;
const bankNow = () => Math.min(bank, banks().length - 1);

function globalControls(){
  return [
    opt("#stAudioOut", "Output device", "Dev"),
    opt("#stMidiIn", "MIDI in", "MIn"),
    opt("#stMidiOut", "MIDI out", "MOu"),
    /* A checkbox is not a list, so it is the one control here that has to be built by hand.
       Two positions, and nudge() is what makes a two-position control usable on an encoder
       at all — see stepper() in shell/surface.js. */
    follow(),
    controller()
  ].filter(Boolean);
}
/* ---- which controller, when there is more than one ----
   ⚠️ THIS WAS THE FOURTH KNOB ONCE AND WAS TAKEN OUT: it was the Controller menu, whose first entry is
   "none", and one detent from a Launchkey disconnected the Launchkey turning it — DAW mode, pads and
   screen gone with it. So this is a list of the controllers the page can SEE and nothing else: no
   "none", and with one controller plugged in a list of one, which a detent cannot leave. With two, a
   detent hands the surface from one to the other, which is the case a box with no screen needed
   (2026-09-20); the kiosk connects the one it finds and refuses to guess between two. */
function controller(){
  const S = Patchwork.surface;
  const list = () => S.available;
  const at = () => Math.max(0, list().findIndex(p => p.id === S.connected));
  const go = i => { const p = list()[i]; if (p && p.id !== S.connected) S.connect(p.id); };
  return {
    id: "controller", label: "Controller", short: "Ctl", stepped: true,
    text: () => { const p = list()[at()]; return p ? p.label || p.name : "none seen"; },
    get: () => { const n = list().length; return n > 1 ? at() / (n - 1) : 0; },
    set: v => { const n = list().length; if (n > 1) go(Math.round(v * (n - 1))); },
    nudge: d => { const n = list().length; if (n > 1) go(Math.max(0, Math.min(n - 1, at() + (d > 0 ? 1 : -1)))); }
  };
}
function follow(){
  const el = q("#stMidiFollow");
  if (!el) return null;
  const set = on => {
    if (!!el.checked === !!on) return;
    el.checked = !!on;
    el.dispatchEvent(new Event("change", {bubbles: true}));
  };
  return {
    id: "follow", label: "Plays selected", short: "Sel", stepped: true,
    text: () => (el.checked ? "On" : "Off"),
    get: () => (el.checked ? 1 : 0),
    set: v => set(v >= .5),
    nudge: d => set(d > 0)
  };
}

/* One bank per instrument: where its sound goes, where its sound comes from, and the two
   channels it answers and speaks on. Absent controls are simply absent — an instrument with
   no MIDI out has three, not four with a dead one. */
function instControls(id){
  return [
    opt("#stOut-" + id, "Audio out", "Out"),
    opt("#stAIn-" + id, "Audio in", "In"),
    opt("#stMidi-inCh-" + id, "MIDI in ch", "MIn"),
    opt("#stMidi-outCh-" + id, "MIDI out ch", "MOu")
  ].filter(Boolean);
}

function controls(){
  const i = bankNow();
  if (i === 0) return globalControls();
  const p = panels()[i - 1];
  return p ? instControls(p.id) : [];
}

/* ⚠️ THE PADS ARE THE BANKS. Sixteen of them and one page per instrument plus a global one
   is at most eight — so rather than leave the grid dark on the one page where a hand is
   hunting for a panel by name, each pad IS a page. Which beats paging through them with the
   arrows while reading a four-character name off a screen. */
const grid = {
  label: () => {
    const b = banks()[bankNow()];
    return "Settings  " + (b ? b.name : "");
  },
  cells: () => {
    const out = new Array(16).fill(null);
    const list = banks();
    for (let k = 0; k < list.length && k < 16; k++){
      const cell = k < 8 ? k + 8 : k - 8;      // top row first, as every grid here reads
      out[cell] = k === bankNow()
        ? {colour: "white", on: true}
        : {colour: k === 0 ? "amber" : "cyan", on: false};
    }
    return out;
  },
  down: cell => {
    const k = cell < 8 ? cell + 8 : cell - 8;
    if (k < banks().length) bank = k;
  }
};

S.mount("settings", {
  name: "Settings",
  /* Entering the mode brings the tab up, so the screen and the encoders are looking at the
     same thing. Leaving it is the surface's own business — another encoder mode, or a tab
     clicked with a mouse. */
  show: () => { if (S.rig && S.rig.goto) S.rig.goto("set"); },
  controls,
  controlBanks: banks,
  controlBank: bankNow,
  setControlBank: i => { bank = Math.max(0, Math.min(banks().length - 1, i)); },
  grid
});
})();
