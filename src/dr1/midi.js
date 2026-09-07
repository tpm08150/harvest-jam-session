
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
  drumNote(d[1], d[2]);
}

/* One drum hit, addressed by its General MIDI note. Split out of onMidi because a control
   surface arrives at exactly the same place by a different road: a Launchkey's Drum layout
   is on its own USB port and never passes the channel filter above, and routing it through
   the filter anyway would mean a pad going silent because of a channel setting on a panel
   the user is not even looking at.

   Returns whether the note meant anything here, so a caller can tell a drum pad from a pad
   this kit has no voice for. */
function drumNote(n, vel){
  const id = GM[n];
  if (!id) return false;
  ensureAudio();
  Patchwork.record.note("dr1", id, vel);
  fire(id, ctx.currentTime + .003, vel / 127);
  flashLane(id);
  return true;
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

/* ---- control surface ----
   See the same section in cs1/midi.js. DR·1 offers three things rather than two, because
   a drum machine is the one instrument a controller already has an opinion about: a pad
   grid in Drum layout is General MIDI, and DR·1 has spoken General MIDI since before any
   of this existed.

   ⚠️ THE PADS TAKE THE PANEL'S LANE ORDER, NOT GENERAL MIDI'S. Handing the surface raw GM
   notes looked elegant — both ends already spoke it — and it laid the kit out
   BD RS SD CP CH LT OH HT, because that is what the GM numbers happen to spell in the
   order a pad grid runs. The panel lists them BD SD CP LT HT CH OH RS. Two orders for one
   kit is one too many, and the one that wins is the one you can see on screen: pad n is
   lane n, counting the way the lanes are drawn.

   So a surface asks by lane index and never learns a note number. GM notes are still what
   onMidi() answers to — that is a DAW's language and it is not changing — but they are no
   longer how the pads are addressed. */
/* The third entry is the name for a screen four names wide — see the note in cs1/midi.js. */
const SURFACE_CTL = [
  ["#tuneF", "Tune", "Tun"], ["#toneF", "Tone", "Ton"],
  ["#decayF", "Decay", "Dec"], ["#levelF", "Level", "Lvl"],
  ["#verbF", "Verb", "Vrb"], ["#gateF", "Gate", "Gat"],
  ["#swingF", "Swing", "Swg"], ["#accentF", "Accent", "Acc"]
];
function surfaceControls(){
  return SURFACE_CTL.filter(c => faderCtl[c[0]]).map(c => ({
    id: c[0].slice(1), label: c[1], short: c[2],
    get: () => faderCtl[c[0]].get(),
    set: v => faderCtl[c[0]].set(v)
  }));
}

/* ⚠️ DR·1'S ENCODER BANKS ARE ITS LANES, not groups of parameters, and that falls out of
   the panel rather than being imposed on it: six of the eight faders already edit whichever
   lane is selected — "one set of faders serving whichever lane is selected, rather than four
   controls per voice times eight voices" — so choosing the lane IS choosing the eight.
   Swing and Accent are the pattern's and sit still across all of them, which is what they
   are: not a voice's.

   The pads follow too, since the step grid shows the selected lane. One button, and the
   whole surface moves to the next drum. */
function drumBanks(){ return ORDER.map(id => ({name: VOICES[id].name})); }
function drumBank(){ const i = ORDER.indexOf(SEQ.lane); return i < 0 ? 0 : i; }
function setDrumBank(i){
  const id = ORDER[i];
  if (id) selectLane(id);
}

/* The step the sequencer is on, from the same `marks` the on-screen playhead reads. */
function surfaceStep(){
  if (!SEQ.playing || !ctx) return -1;
  const now = ctx.currentTime;
  for (let k = marks.length - 1; k >= 0; k--)
    if (marks[k].t <= now && now < marks[k].end) return marks[k].i;
  return -1;
}

/* The kit in the order the panel draws it, which is the order the pads take. */
function drumLanes(){ return ORDER.map(id => ({id, label: VOICES[id].name})); }

/* ⚠️ HITTING A PAD SELECTS THAT LANE, which is not an invention: clicking a lane name on
   the panel already "selects AND sounds it", and every drum machine with pads on it works
   the same way. It is also what makes the surface usable at all — the step grid and the
   eight encoders both follow the selected lane, and without this the only way to change
   which lane they are editing would be to reach past the controller for the mouse. */
function drumFire(i, vel){
  const id = ORDER[i];
  if (!id) return false;
  if (id !== SEQ.lane) selectLane(id);
  ensureAudio();
  Patchwork.record.note("dr1", id, vel);
  fire(id, ctx.currentTime + .003, vel / 127);
  flashLane(id);
  return true;
}

function drumCell(i){
  const id = ORDER[i];
  if (!id) return null;
  const step = surfaceStep();
  const hitting = step >= 0 && !!steps[id][step % SEQ.len];
  /* The selected lane is the one the eight encoders are editing, so it says so. */
  return {colour: id === SEQ.lane ? "amber" : "sky", on: hitting};
}

/* ---- the selected lane's steps, sixteen at a time ----
   ⚠️ READ TOP ROW FIRST, which is the opposite of CS·1's grid and deliberately so: a chord
   bank is a pad layout filled bottom-up, and a sequencer is a line of time read left to
   right from the top. Cell 0 is still bottom-left — that is the surface's contract — so
   step 1 is cell 8.

   A pattern is up to 64 steps and a grid is 16, so the pads show one bank and the surface's
   page buttons move between them. The bank is sixteen wide because that is what the panel
   does too: past 16 steps its own grid "wraps into rows of 16 inside the same grid", so a
   page here is one row there and the two views agree without either knowing about the
   other. */
const PAGE = 16;
/* Derived from the length rather than stored beside it: shortening a 64-step pattern to 16
   while looking at steps 49-64 must not leave the pads on a page that no longer exists. */
function pageCount(){ return Math.max(1, Math.ceil(SEQ.len / PAGE)); }
function pageNow(){ return Math.min(SEQ.bank, pageCount() - 1); }

const surfaceGrid = {
  /* ⚠️ THE RANGE IS ALWAYS SHOWN, even on a pattern with only one page. Hiding it when
     there was nowhere to go made a 16-step pattern look identical to a 64-step one parked
     on its first bank, so "the page buttons do nothing" and "there is only one page" were
     the same picture — and the second is the answer to the first. */
  label: () => (VOICES[SEQ.lane] ? VOICES[SEQ.lane].name : "Steps")
             + "  " + (pageNow() * PAGE + 1) + "-"
             + Math.min(SEQ.len, (pageNow() + 1) * PAGE),
  pages: pageCount,
  page: pageNow,
  /* Repaints the panel as well as moving the pads: the band of sixteen the hardware is
     editing is drawn on screen, and a page you can only see on a two-inch display is a
     page you have to keep count of. */
  setPage: p => { SEQ.bank = Math.max(0, Math.min(pageCount() - 1, p)); paintPads(); },
  cells: () => {
    const out = new Array(16).fill(null);
    const lane = steps[SEQ.lane];
    if (!lane) return out;
    const head = surfaceStep(), base = pageNow() * PAGE;
    for (let k = 0; k < PAGE; k++){
      const step = base + k;
      if (step >= SEQ.len) continue;                  // a shorter pattern leaves them dark
      const cell = k < 8 ? k + 8 : k - 8;
      const v = lane[step];
      /* The playhead is a colour, not the device's pulse: pulsing is locked to the
         Launchkey's own beat clock, which this page never sends it, so it would blink at
         whatever tempo the controller last saw rather than at ours. */
      out[cell] = head === step
        ? {colour: "white", on: true}
        : {colour: v === 2 ? "red" : "cyan", on: v > 0};
    }
    return out;
  },
  /* ⚠️ One pad gesture on every panel: press is on/off, and a press with the surface's
     accent modifier held is the accent — see the same note beside makeSeqSurface in
     seq/step-seq.js. It reaches the accent without leaving the controller, which the
     panel's own Step/Accent switch cannot do.

     No tie: `mods.from` is ignored here on purpose. A tie extends the note before it, and a
     drum voice is a one-shot with no note to extend — holding two pads to make a longer
     kick would be a gesture that quietly did nothing. */
  down: (cell, vel, mods) => {
    const step = pageNow() * PAGE + (cell < 8 ? cell + 8 : cell - 8);
    if (step >= SEQ.len) return;
    const lane = steps[SEQ.lane];
    if (mods && mods.accent) lane[step] = lane[step] === 2 ? 1 : 2;
    else lane[step] = nextValue(lane[step]);
    paintPads();
  }
};

/* ---- the pattern's own settings, on the modifier ----
   Only two, because a drum pattern has no key and no scale — and two that are worth
   reaching without the mouse is still two. Swing and Accent are already among the ordinary
   eight, being the pattern's rather than a voice's. They are lists rather than ranges, which is why they were never among the
   ordinary eight — see option() in shell/surface.js, where the awkward parts of putting
   a menu under a knob are handled once. */
const SURFACE_ALT = [["#len", "Steps", "Stp"], ["#rate", "Rate", "Rat"]];
function surfaceShiftControls(){
  return SURFACE_ALT.map(a => Patchwork.surface.option($(a[0]), a[1], a[2])).filter(Boolean);
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
  /* What this instrument answers on, so the studio can show the whole rig's channels in
     one place. The setters keep this panel's own selects in step: the two views are the
     same setting and must never disagree about it. */
  Patchwork.midi.route("dr1", onMidi, pt => { fillPorts(); followInput(pt); bindOutput(); describe(); }, {
    name: "DR·1", panic: midiPanic,
    controls: surfaceControls, shiftControls: surfaceShiftControls,
    shiftName: "Seq", grid: surfaceGrid,
    controlBanks: drumBanks, controlBank: drumBank, setControlBank: setDrumBank,
    drumNote, drumLanes, drumFire, drumCell,
    inCh:  {get: () => MIDI.inCh,
            set: c => { MIDI.inCh = c; midiInChSel.value = String(c); describe(); }},
    outCh: {get: () => MIDI.ch,
            set: c => { MIDI.ch = c; midiChSel.value = String(c); }}
  });
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
