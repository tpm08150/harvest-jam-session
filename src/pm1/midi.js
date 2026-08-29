/* ============ midi ============ */
const midiInSel = $("#midiIn"), midiOutSel = $("#midiOut"), midiChSel = $("#midiCh"),
      ledEl = $("#midiLed"), midiNoteEl = $("#midiNote");
for (let c = 0; c < 16; c++)
  midiChSel.appendChild(Object.assign(document.createElement("option"),
    {value:String(c), textContent:String(c+1)}));
midiChSel.value = "0";

/* ctx.currentTime counts audio the graph has accepted; performance.now() is wall time.
   getOutputTimestamp pairs them at the frame actually leaving the device, so the base it
   returns already carries output latency — which is what MIDI out wants, so a note lands
   on the hardware when the internal voice is audible. */
function ctxPerfBase(){
  if (ctx.getOutputTimestamp){
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.contextTime != null && ts.performanceTime != null && ts.performanceTime > 0)
      return ts.performanceTime - ts.contextTime*1000;
  }
  return performance.now() - ctx.currentTime*1000;
}
const perfTime = t => ctx ? ctxPerfBase() + t*1000 : performance.now();

/* A timestamped note-off lives in the browser's queue until its moment arrives — if the
   page dies first it is never delivered and the external synth holds that note forever.
   Short offs are pre-scheduled; longer ones are held here and sent as they come due. */
const MAX_OFF_AHEAD = 4;
const pendingOffs = [];
let offTimer = null;
function flushOffs(){
  if (!ctx) return;
  const horizon = ctx.currentTime + .25;
  for (let i = pendingOffs.length - 1; i >= 0; i--){
    const o = pendingOffs[i];
    if (o.at <= horizon){
      if (MIDI.out){ try{ MIDI.out.send([0x80|o.ch, o.p, 0], perfTime(o.at)); }catch(e){} }
      pendingOffs.splice(i, 1);
    }
  }
  if (!pendingOffs.length && offTimer != null){ clearInterval(offTimer); offTimer = null; }
}
function sendNote(n, t, dur, vel){
  const out = MIDI.out; if (!out || !MIDI.noteOut) return;
  const p = clampf(Math.round(n), 0, 127), v = clampf(Math.round(vel == null ? 96 : vel), 1, 127);
  try{
    out.send([0x90|MIDI.ch, p, v], perfTime(t));
    if (dur <= MAX_OFF_AHEAD) out.send([0x80|MIDI.ch, p, 0], perfTime(t + dur));
    else {
      pendingOffs.push({p, ch:MIDI.ch, at:t + dur});
      if (offTimer == null) offTimer = setInterval(flushOffs, 40);
    }
  }catch(e){}
}
/* Live playing needs a note-on and a note-off as separate events — sendNote()'s duration
   form suits the sequencer, which knows the length up front, and nothing else.
   `outNotes` is what has been sent and not yet released, so panic and all-notes-off can
   always close the books. */
const outNotes = new Set();
function sendNoteOn(n, t, vel){
  const out = MIDI.out; if (!out || !MIDI.noteOut) return;
  const p = clampf(Math.round(n), 0, 127);
  const v = clampf(Math.round(vel == null ? 96 : vel), 1, 127);
  try{
    /* re-attacking a pitch that is already out: release it first, so the receiver sees a
       clean retrigger rather than two on-messages it has to guess about */
    if (outNotes.has(p)) out.send([0x80 | MIDI.ch, p, 0], perfTime(t));
    out.send([0x90 | MIDI.ch, p, v], perfTime(t));
    outNotes.add(p);
  }catch(e){}
}
/* Deliberately NOT gated on MIDI.noteOut: if the switch is turned off while a note is
   held, that note still has to be released. */
function sendNoteOff(n, t){
  const out = MIDI.out; if (!out) return;
  const p = clampf(Math.round(n), 0, 127);
  if (!outNotes.has(p)) return;
  outNotes.delete(p);
  try{ out.send([0x80 | MIDI.ch, p, 0], perfTime(t)); }catch(e){}
}
function sendAllOff(t){
  if (!MIDI.out){ outNotes.clear(); return; }
  const when = t == null ? (ctx ? ctx.currentTime : 0) : t;
  Array.from(outNotes).forEach(p => sendNoteOff(p, when));
}

/* Deliberately blunt: every channel, because a stuck note may predate a channel change. */
function midiPanic(){
  pendingOffs.length = 0;
  outNotes.clear();
  if (offTimer != null){ clearInterval(offTimer); offTimer = null; }
  const out = MIDI.out; if (!out) return;
  try{
    if (out.clear) out.clear();
    for (let ch = 0; ch < 16; ch++){
      out.send([0xB0|ch, 120, 0]);      // all sound off
      out.send([0xB0|ch, 123, 0]);      // all notes off
      out.send([0xB0|ch, 64, 0]);       // sustain up, in case it is latching
    }
  }catch(e){}
}

function saveMap(){
  try{ localStorage.setItem(MAP_KEY, JSON.stringify({ccs:[...ccMap],
    synCh:MIDI.synCh, vocCh:MIDI.vocCh, ccCh:MIDI.ccCh, bassCh:MIDI.bassCh,
  })); }catch(e){}
}
function loadMap(){
  try{
    const raw = localStorage.getItem(MAP_KEY); if (!raw) return;
    const o = JSON.parse(raw) || {};
    (o.ccs || []).forEach(c => { if (ctlReg[c[1]]) ccMap.set(+c[0], c[1]); });
    if (typeof o.synCh === "number" && o.synCh >= -1 && o.synCh < 16) MIDI.synCh = o.synCh;
    if (typeof o.vocCh === "number" && o.vocCh >= -1 && o.vocCh < 16) MIDI.vocCh = o.vocCh;
    if (typeof o.ccCh  === "number" && o.ccCh  >= -1 && o.ccCh  < 16) MIDI.ccCh  = o.ccCh;
    if (typeof o.bassCh === "number" && o.bassCh >= -1 && o.bassCh < 16) MIDI.bassCh = o.bassCh;
  }catch(e){}
}
function arm(target, el){
  $$(".arm").forEach(x => x.classList.remove("arm"));
  LEARN.target = target;
  if (el) el.classList.add("arm");
  learnSay();
}
function refreshBinds(){
  Object.keys(ctlReg).forEach(id => {
    let cc = null;
    for (const [c, cid] of ccMap) if (cid === id) cc = c;
    const b = ctlReg[id].el.querySelector(".bind");
    if (b) b.textContent = cc == null ? "" : "CC "+cc;
  });
}
function bindLearn(cc){
  const t = LEARN.target; if (!t) return;
  ccMap.forEach((id, c) => { if (id === t.id) ccMap.delete(c); });   // one CC per control
  ccMap.set(cc, t.id);
  saveMap();
  LEARN.target = null;
  $$(".arm").forEach(x => x.classList.remove("arm"));
  refreshBinds(); learnSay();
}
function learnSay(){
  if (!LEARN.on){ if (MIDI.access) describe(); return; }
  if (!LEARN.target) say("<b>Learn is on.</b> Click a knob, then move the hardware control "
                       + "you want to drive it. Click Learn again when you're done.");
  else say("<b>" + LEARN.target.id + "</b> armed — move a knob or fader that sends CC.");
}
function setLearn(on){
  LEARN.on = on; LEARN.target = null;
  root.classList.toggle("learning", on);
  $$(".arm").forEach(x => x.classList.remove("arm"));
  const b = $("#learn");
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", on ? "true" : "false");
  learnSay();
}
function applyCC(cc, val){
  const id = ccMap.get(cc);
  if (id && ctlReg[id]) ctlReg[id].set(val/127);
}


/* One voice, so one question: is this channel ours? Omni (-1) answers yes to everything.
   MS·1 needed a three-way arbitration here because three sections shared an instrument;
   each of them now answers on a channel of its own. */
function routeFor(ch){
  return (MIDI.synCh < 0 || ch === MIDI.synCh) ? "syn" : "ignore";
}
function onMidi(e){
  const d = e.data; if (!d || !d.length) return;
  const s = d[0];
  ledBlink();
  if (s >= 0xF0) return;                       // PM·1 runs its own clock — see the README
  const type = s & 0xF0, ch = s & 0x0F;

  /* ---- control messages ride the Control channel, not a section's ---- */
  if (type === 0xB0 || type === 0xC0){
    /* All-sound-off and all-notes-off are honoured on ANY channel. A panic that only works
       if you guessed the right channel is not a panic. */
    if (type === 0xB0 && (d[1] === 123 || d[1] === 120)) return allNotesOff();
    if (MIDI.ccCh >= 0 && ch !== MIDI.ccCh) return;
    if (type === 0xC0){
      const n = FACTORY_ORDER[d[1]];
      if (n){ loadFactory(n); refreshPatchList("f:"+n); }
      return;
    }
    if (d[1] === 64){                          // sustain pedal behaves as Hold
      latch = d[2] >= 64;
      $("#hold").classList.toggle("on", latch);
      if (!latch) allNotesOff();
      return;
    }
    if (d[1] === 1){                           // mod wheel -> LFO depth, the usual place
      if (lfoPitchG && ctx) lfoPitchG.gain.setTargetAtTime(P.lfop + (d[2]/127)*40, ctx.currentTime, .02);
      return;
    }
    if (d[1] > 119) return;
    if (LEARN.on && LEARN.target) return bindLearn(d[1]);
    applyCC(d[1], d[2]);
    return;
  }

  /* ---- notes and bend belong to a section, decided by channel ---- */
  const sec = routeFor(ch);
  if (sec === "ignore") return;
  if (type === 0x90 && d[2] > 0){
    noteOn(d[1] - octave*12, d[2], null, sec); paintKeys();
  } else if (type === 0x80 || (type === 0x90 && d[2] === 0)){
    noteOff(d[1] - octave*12, null, sec); paintKeys();
  } else if (type === 0xE0){
    const bend = ((d[2] << 7) | d[1]) - 8192;
    const cents = (bend/8192) * P.bend * 100;
    const now = ctx ? ctx.currentTime : 0;
    /* the bend belongs to whichever section owns that channel; "both" bends both */
    if (bendSrc) bendSrc.offset.setTargetAtTime(cents, now, .01);
    bendCents = cents; paintNow();
  }
}

let ledT = 0;
function ledBlink(){
  const now = performance.now();
  if (now - ledT < 90) return;
  ledT = now;
  ledEl.classList.add("lit");
  setTimeout(() => ledEl.classList.remove("lit"), 80);
}
function say(msg, bad){
  midiNoteEl.innerHTML = msg;
  midiNoteEl.classList.toggle("bad", !!bad);
  ledEl.classList.toggle("err", !!bad);
  ledEl.classList.toggle("ready", !bad && !!MIDI.in);
}
function ports(kind){ return MIDI.access ? Array.from(MIDI.access[kind].values()) : []; }
function fillSel(sel, list, keepId){
  sel.innerHTML = '<option value="">— none —</option>';
  list.forEach(p => sel.appendChild(Object.assign(document.createElement("option"),
    {value:p.id, textContent:p.name || p.id})));
  sel.value = (keepId && list.some(p => p.id === keepId)) ? keepId : "";
}
function fillPorts(){
  fillSel(midiInSel, ports("inputs"), MIDI.in && MIDI.in.id);
  fillSel(midiOutSel, ports("outputs"), MIDI.out && MIDI.out.id);
}
function describe(){
  const i = ports("inputs").length, o = ports("outputs").length;
  const how = "Synth on <b>" + chName(MIDI.synCh) + "</b>, vocoder on <b>"
    + chName(MIDI.vocCh) + "</b>"
    + ", CC on <b>" + chName(MIDI.ccCh) + "</b>.";
  say(i + " input" + (i === 1 ? "" : "s") + " · " + o + " output" + (o === 1 ? "" : "s")
    + " — " + how + " Learn a knob to any CC. Program change 0–19 recalls the factory bank. "
    + "PM·1 runs its own clock and ignores incoming MIDI clock.");
}
/* The port belongs to the page, not to this panel — see shell/midi.js. Assigning
   onmidimessage here is what made the two instruments steal it from each other. */
function bindInput(){
  allNotesOff();
  MIDI.in = Patchwork.midi.select(midiInSel.value);
  ledEl.classList.toggle("ready", !!MIDI.in && !ledEl.classList.contains("err"));
}
/* Called when the page's input changes, including from the other panel. */
function followInput(pt){
  MIDI.in = pt;
  if (midiInSel.value !== (pt ? pt.id : "")) midiInSel.value = pt ? pt.id : "";
  ledEl.classList.toggle("ready", !!pt && !ledEl.classList.contains("err"));
}
function bindOutput(){
  midiPanic();
  MIDI.out = midiOutSel.value ? ports("outputs").find(p => p.id === midiOutSel.value) || null : null;
}
/* ---- input channels ---- */
/* One input channel and one control channel. MS·1 needed four selectors because three
   sections shared one instrument; each of the three now answers on a channel of its own,
   which is most of what the split was for. */
const synChSel = $("#synCh"), ccChSel = $("#ccCh"), chNote = $("#chNote");
[synChSel, ccChSel].forEach(sel => {
  sel.appendChild(Object.assign(document.createElement("option"),
    {value:"-1", textContent:"Omni"}));
  for (let c = 0; c < 16; c++)
    sel.appendChild(Object.assign(document.createElement("option"),
      {value:String(c), textContent:String(c+1)}));
});
const chName = v => v < 0 ? "any channel" : "channel " + (v + 1);
function paintBassNote(){}                 // the bass note went with the bass rack
function paintRoute(){
  synChSel.value = String(MIDI.synCh);
  ccChSel.value  = String(MIDI.ccCh);
  chNote.innerHTML = "Notes on " + chName(MIDI.synCh)
    + ". CC and program change on " + chName(MIDI.ccCh) + ".";
  chNote.classList.remove("bad");
}
synChSel.addEventListener("change", () => {
  MIDI.synCh = parseInt(synChSel.value, 10); allNotesOff(); paintRoute(); saveMap(); describe();
});
ccChSel.addEventListener("change", () => {
  MIDI.ccCh = parseInt(ccChSel.value, 10); paintRoute(); saveMap(); describe();
});

midiInSel.addEventListener("change", bindInput);
midiOutSel.addEventListener("change", bindOutput);
midiChSel.addEventListener("change", () => { midiPanic(); MIDI.ch = parseInt(midiChSel.value, 10); });
$("#learn").addEventListener("click", () => setLearn(!LEARN.on));
$("#clearMap").addEventListener("click", () => {
  ccMap.clear(); saveMap(); refreshBinds();
  LEARN.target = null;
  $$(".arm").forEach(x => x.classList.remove("arm"));
  say("Map cleared — knobs are mouse and keyboard only again.");
});
function initMidi(){
  if (!navigator.requestMIDIAccess){
    /* every iOS browser is WebKit underneath, so this is a platform limit rather than a
       browser choice — naming Safari here misleads anyone reading it on a phone */
    say(IS_IOS
      ? "Web MIDI isn't available on iOS or iPadOS — every browser there uses WebKit, so "
      + "switching browsers won't help. Everything else works; MIDI needs a desktop."
      : "Web MIDI isn't available in this browser. Chrome and Edge support it, and Firefox "
      + "prompts for permission.", true);
    return;
  }
  if (!window.isSecureContext){
    say("Web MIDI needs a secure context. Serve this file over <code>localhost</code> "
      + "rather than opening it with <code>file://</code>.", true);
    return;
  }
  Patchwork.midi.route("pm1", onMidi, pt => {
    fillPorts(); followInput(pt); bindOutput(); describe();
  });
  Patchwork.midi.open().then(a => {
    MIDI.access = a;
    fillPorts();
    /* Only claim the default port if nothing has claimed one yet — otherwise the second
       instrument to boot rebinds the page's input out from under the first. */
    const ins = ports("inputs");
    if (!Patchwork.midi.port && ins.length){ midiInSel.value = ins[0].id; bindInput(); }
    else followInput(Patchwork.midi.port);
    describe();
  }).catch(err => {
    say("MIDI access was denied or failed (" + ((err && err.name) || "error") + ").", true);
  });
}

