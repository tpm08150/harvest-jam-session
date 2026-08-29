
/* ============ midi ============ */
/* General MIDI drum notes, so a pad controller or a DAW track drives the kit without a
   mapping dialogue. These are the GM percussion numbers; anything not in the map is
   ignored rather than triggering the nearest voice, because a wrong drum is worse than
   no drum. */
const GM = {36:"bd", 35:"bd", 38:"sd", 40:"sd", 39:"cp", 41:"lt", 45:"lt",
            47:"ht", 48:"ht", 42:"ch", 44:"ch", 46:"oh", 37:"rs"};
const OUT_NOTE = {bd:36, sd:38, cp:39, lt:41, ht:47, ch:42, oh:46, rs:37};

const MIDI = {access:null, in:null, out:null, ch:9, inCh:-1, noteOut:false};
const ledEl = $("#midiLed");
const midiInSel = $("#midiIn"), midiOutSel = $("#midiOut"),
      midiChSel = $("#midiCh"), midiInChSel = $("#midiInCh");

/* Channel 10 (index 9) is where drums live by convention, so that is the default out. */
function fillChannels(){
  midiInChSel.appendChild(Object.assign(document.createElement("option"),
    {value:"-1", textContent:"Omni"}));
  for (let c = 0; c < 16; c++){
    midiInChSel.appendChild(Object.assign(document.createElement("option"),
      {value:String(c), textContent:String(c + 1)}));
    midiChSel.appendChild(Object.assign(document.createElement("option"),
      {value:String(c), textContent:String(c + 1)}));
  }
  midiInChSel.value = "-1";
  midiChSel.value = "9";
}
fillChannels();
midiInChSel.addEventListener("change", () => { MIDI.inCh = parseInt(midiInChSel.value, 10); describe(); });
midiChSel.addEventListener("change", () => { MIDI.ch = parseInt(midiChSel.value, 10); });

function ports(kind){ return Patchwork.midi.ports(kind); }

function fillPorts(){
  [[midiInSel, "inputs"], [midiOutSel, "outputs"]].forEach(([sel, kind]) => {
    const keep = sel.value;
    sel.textContent = "";
    sel.appendChild(Object.assign(document.createElement("option"),
      {value:"", textContent:"— none —"}));
    ports(kind).forEach(p => sel.appendChild(Object.assign(document.createElement("option"),
      {value:p.id, textContent:p.name || p.id})));
    if (keep && ports(kind).some(p => p.id === keep)) sel.value = keep;
  });
}

function onMidi(e){
  const d = e.data, s = d[0];
  if (s >= 0xF0) return;                       // realtime carries no channel; the clock is the shell's
  if (MIDI.inCh >= 0 && (s & 0x0F) !== MIDI.inCh) return;
  const type = s & 0xF0;
  if (type !== 0x90 || d[2] === 0) return;     // note-off is meaningless for a one-shot
  const id = GM[d[1]];
  if (!id) return;
  ensureAudio();
  fire(id, ctx.currentTime + .003, d[2] / 127);
  flashLane(id);
}

/* Mirrors the sequencer only, and goes through the same stepEvent() the engine reads, so
   what sounds and what leaves the port cannot drift. A drum hit has no duration worth
   sending, so note-off follows immediately — the note length of a one-shot means nothing
   to the receiver, and holding it open risks a stuck note on a panic. */
function sendHit(ev){
  if (!MIDI.noteOut || !MIDI.out) return;
  const n = OUT_NOTE[ev.id];
  if (n == null) return;
  const t = (ev.t - ctx.currentTime) * 1000 + performance.now();
  try{
    MIDI.out.send([0x90 | MIDI.ch, n, Math.round(ev.vel * 127)], t);
    MIDI.out.send([0x80 | MIDI.ch, n, 0], t + 20);
  }catch(err){}
}

function midiPanic(){
  if (!MIDI.out) return;
  for (let c = 0; c < 16; c++){
    try{ MIDI.out.send([0xB0 | c, 123, 0]); }catch(e){}
  }
}

$("#noteOut").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  MIDI.noteOut = b.dataset.o === "on";
  $$("#noteOut button").forEach(x => x.classList.toggle("on", x === b));
});

function bindInput(){ MIDI.in = Patchwork.midi.select(midiInSel.value); }
function followInput(pt){
  MIDI.in = pt;
  if (midiInSel.value !== (pt ? pt.id : "")) midiInSel.value = pt ? pt.id : "";
  ledEl.classList.toggle("ready", !!pt && !ledEl.classList.contains("err"));
}
function bindOutput(){
  midiPanic();
  MIDI.out = midiOutSel.value ? ports("outputs").find(p => p.id === midiOutSel.value) || null : null;
}
midiInSel.addEventListener("change", bindInput);
midiOutSel.addEventListener("change", bindOutput);

function say(msg, bad){
  $("#midiNote").innerHTML = msg;
  ledEl.classList.toggle("err", !!bad);
}
function describe(){
  const i = ports("inputs").length, o = ports("outputs").length;
  say(i + " input" + (i === 1 ? "" : "s") + " · " + o + " output" + (o === 1 ? "" : "s")
    + " — GM drum notes trigger the kit (36 kick, 38 snare, 42 hat). "
    + (MIDI.inCh < 0 ? "Listening on <b>every channel</b>."
                     : "Listening on <b>channel " + (MIDI.inCh + 1) + "</b> only."));
}

function initMidi(){
  if (!navigator.requestMIDIAccess){
    say("Web MIDI isn't available in this browser. Chrome and Edge support it.", true);
    return;
  }
  if (!window.isSecureContext){
    say("Web MIDI needs a secure context — serve over <code>localhost</code>.", true);
    return;
  }
  Patchwork.midi.route("dr1", onMidi, pt => { fillPorts(); followInput(pt); bindOutput(); describe(); });
  Patchwork.midi.open().then(a => {
    MIDI.access = a;
    fillPorts();
    const ins = ports("inputs");
    if (!Patchwork.midi.port && ins.length){ midiInSel.value = ins[0].id; bindInput(); }
    else followInput(Patchwork.midi.port);
    describe();
  }).catch(err => {
    say("MIDI access was denied or failed (" + ((err && err.name) || "error") + ").", true);
  });
}
