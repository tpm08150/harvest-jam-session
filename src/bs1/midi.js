
/* ============ midi ============ */
/* Its own input channel, which is what splitting MS·1 buys: the bass used to share one
   instrument's channel map with the synth and the vocoder, and each of the three now
   simply answers on a channel of its own. */

const MIDI = {access:null, in:null, inCh:-1};
const ledEl = $("#midiLed"), midiInSel = $("#midiIn"), midiInChSel = $("#midiInCh");

midiInChSel.appendChild(Object.assign(document.createElement("option"),
  {value:"-1", textContent:"Omni"}));
for (let c = 0; c < 16; c++)
  midiInChSel.appendChild(Object.assign(document.createElement("option"),
    {value:String(c), textContent:String(c + 1)}));
midiInChSel.value = "-1";
midiInChSel.addEventListener("change", () => {
  MIDI.inCh = parseInt(midiInChSel.value, 10); allNotesOff(); describe();
});

function ports(kind){ return Patchwork.midi.ports(kind); }
function fillPorts(){
  const keep = midiInSel.value;
  midiInSel.textContent = "";
  midiInSel.appendChild(Object.assign(document.createElement("option"),
    {value:"", textContent:"— none —"}));
  ports("inputs").forEach(p => midiInSel.appendChild(Object.assign(
    document.createElement("option"), {value:p.id, textContent:p.name || p.id})));
  if (keep && ports("inputs").some(p => p.id === keep)) midiInSel.value = keep;
}

function onMidi(e){
  const d = e.data, s = d[0];
  if (s >= 0xF0) return;                    // realtime carries no channel
  if (MIDI.inCh >= 0 && (s & 0x0F) !== MIDI.inCh) return;
  const type = s & 0xF0;
  if (type === 0x90 && d[2] > 0){ ensureAudio();
    Patchwork.record.note("bs1", d[1], d[2]);
    played(d[1]);
    noteOn(d[1], d[2]); }
  else if (type === 0x80 || (type === 0x90 && d[2] === 0)) noteOff(d[1]);
  else if (type === 0xB0 && d[1] === 123) allNotesOff();
}
function midiPanic(){ allNotesOff(); }

function bindInput(){ MIDI.in = Patchwork.midi.select(midiInSel.value); }
function followInput(pt){
  MIDI.in = pt;
  if (midiInSel.value !== (pt ? pt.id : "")) midiInSel.value = pt ? pt.id : "";
  ledEl.classList.toggle("ready", !!pt && !ledEl.classList.contains("err"));
}
midiInSel.addEventListener("change", bindInput);

function say(msg, bad){ $("#midiNote").innerHTML = msg; ledEl.classList.toggle("err", !!bad); }
function describe(){
  const i = ports("inputs").length;
  say(i + " input" + (i === 1 ? "" : "s") + " — "
    + (MIDI.inCh < 0 ? "listening on <b>every channel</b>."
                     : "listening on <b>channel " + (MIDI.inCh + 1) + "</b> only."));
}

/* ---- control surface ----
   The eight faders this panel already has, as the eight things a hardware encoder row can
   turn. Order is the panel's own left-to-right, so encoder 3 is the third fader down the
   strip and there is nothing to look up. See shell/surface.js. */
const SURFACE_CTL = [["cut","Cutoff","Cut"], ["res","Reso","Res"], ["env","Env","Env"],
                     ["dec","Decay","Dec"], ["sub","Sub","Sub"], ["level","Level","Lvl"],
                     ["glide","Glide","Gld"]];
function surfaceControls(){
  return SURFACE_CTL.filter(c => faderReg[c[0]] && faderReg[c[0]].get).map(c => ({
    id: c[0], label: c[1], short: c[2],
    get: () => faderReg[c[0]].get(),
    set: v => faderReg[c[0]].set(v)
  }));
}

/* ---- the pattern's own settings, on Shift ----
   ⚠️ THESE ARE LISTS, NOT RANGES, and that is the whole reason they were not among the
   eight. Cutoff has a value anywhere between two ends; Rate is one of seven names and Scale
   is one of a dozen, and a knob that lands between two of them means nothing. So the encoder
   picks an INDEX — its travel divided by however many options there are — which is the only
   honest way to put a list under a continuous control.

   And they go through the panel's own <select>, dispatching the change event a click would,
   so the sequencer rebuilds its grid and re-spells its notes exactly as if the menu had been
   used. Setting seq.SEQ.len from here would move the number and leave the panel drawing the
   old one. */
function optCtl(sel, label, short){
  const el = $(sel);
  if (!el) return null;
  const last = () => Math.max(1, el.options.length - 1);
  return {
    id: sel.slice(1), label, short,
    get: () => el.selectedIndex / last(),
    set: v => {
      const i = Math.max(0, Math.min(el.options.length - 1, Math.round(v * last())));
      if (i === el.selectedIndex) return;
      el.selectedIndex = i;
      el.dispatchEvent(new Event("change", {bubbles: true}));
    }
  };
}
function surfaceShiftControls(){
  return [optCtl("#seqLen", "Steps", "Stp"), optCtl("#seqRate", "Rate", "Rat"),
          optCtl("#seqKey", "Key", "Key"), optCtl("#seqScale", "Scale", "Scl")]
    .filter(Boolean);
}

function initMidi(){
  if (!navigator.requestMIDIAccess){
    say("Web MIDI isn't available in this browser. Chrome and Edge support it.", true); return;
  }
  if (!window.isSecureContext){
    say("Web MIDI needs a secure context — serve over <code>localhost</code>.", true); return;
  }
  /* What this instrument answers on, so the studio can show the whole rig's channels in
     one place. The setters keep this panel's own selects in step: the two views are the
     same setting and must never disagree about it. */
  Patchwork.midi.route("bs1", onMidi, pt => { fillPorts(); followInput(pt); describe(); }, {
    name: "BS\u00b71", panic: midiPanic,
    controls: surfaceControls, shiftControls: surfaceShiftControls,
    shiftName: "Seq", grid: surfaceGrid,
    inCh: {get: () => MIDI.inCh,
           set: c => { MIDI.inCh = c; midiInChSel.value = String(c); allNotesOff(); describe(); }}
  });
  Patchwork.midi.open().then(a => {
    MIDI.access = a; fillPorts();
    const ins = ports("inputs");
    if (!Patchwork.midi.port && ins.length){ midiInSel.value = ins[0].id; bindInput(); }
    else followInput(Patchwork.midi.port);
    describe();
  }).catch(err => say("MIDI access was denied or failed (" + ((err && err.name) || "error") + ").", true));
}
