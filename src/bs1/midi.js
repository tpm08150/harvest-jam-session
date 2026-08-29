
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

function initMidi(){
  if (!navigator.requestMIDIAccess){
    say("Web MIDI isn't available in this browser. Chrome and Edge support it.", true); return;
  }
  if (!window.isSecureContext){
    say("Web MIDI needs a secure context — serve over <code>localhost</code>.", true); return;
  }
  Patchwork.midi.route("bs1", onMidi, pt => { fillPorts(); followInput(pt); describe(); });
  Patchwork.midi.open().then(a => {
    MIDI.access = a; fillPorts();
    const ins = ports("inputs");
    if (!Patchwork.midi.port && ins.length){ midiInSel.value = ins[0].id; bindInput(); }
    else followInput(Patchwork.midi.port);
    describe();
  }).catch(err => say("MIDI access was denied or failed (" + ((err && err.name) || "error") + ").", true));
}
