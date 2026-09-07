
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

/* ---- the pattern's own settings, on the modifier ----
   The four menus above the grid: what the line is, as opposed to what it sounds like. They
   are lists rather than ranges, which is why they were never among the ordinary eight — see
   option() in shell/surface.js, which is where the awkward parts of putting a menu under a
   knob are handled once. */
const SURFACE_ALT = [["#seqLen", "Steps", "Stp"], ["#seqRate", "Rate", "Rat"],
                     ["#seqKey", "Key", "Key"], ["#seqScale", "Scale", "Scl"]];
function surfaceShiftControls(){
  return SURFACE_ALT.map(a => Patchwork.surface.option($(a[0]), a[1], a[2])).filter(Boolean);
}

/* ---- the two spare buttons ----
   BS·1 has one bank of encoders and no tape, so the pair beside the encoders and the ">"
   beside the pads are both free — and the two switches on this panel that a hand reaches
   for mid-line are exactly two. Both go through the panel's own segmented controls, so
   what the click does happens here too, and both answer with a word for the display. */
function surfaceBump(dir){
  /* ⚠️ UP IS UP, and the arrow the hand pressed has to agree with the ear: down goes to the
     lower octave whatever order the buttons happen to sit in.

     ⚠️ AND THE CURRENT VALUE COMES FROM THE PARAMETER, not from which button is wearing the
     `on` class. The parameter is the truth here — a patch load writes it and the class
     follows — so reading the class would put this one step behind any change that did not
     come through a click. */
  const want = Math.max(-2, Math.min(-1, P.subOct + (dir > 0 ? -1 : 1)));
  if (want === P.subOct) return null;
  const b = Array.prototype.find.call($$("#subOct button"), x => +x.dataset.s === want);
  if (!b) return null;
  b.click();                          // the panel's own control, so the class follows too
  return P.subOct + " oct";
}
function surfaceAction(){
  const b = $$("#wave button");
  const at = Array.prototype.findIndex.call(b, x => x.classList.contains("on"));
  const to = b[(at + 1) % b.length];
  if (!to) return null;
  to.click();
  return to.textContent.trim();
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
    bump: surfaceBump, bumpName: "Sub",
    action: surfaceAction, actionName: "Wave",
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
