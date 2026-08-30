/* ============ patches ============ */
const PATCH_KEY = "patchwork-cs1-patches";
const PATCH_VERSION = 3;
/* Tone range as it stood in each earlier patch version, used to migrate saved values */
const TONE_RANGES = {1:[260, 8500], 2:[25, 8500]};
const patchSel = $("#patchSel"), patchName = $("#patchName"), patchNote = $("#patchNote"),
      patchFile = $("#patchFile"), patchProg = $("#patchProg"),
      patchTrig = $("#patchTrig"), recallWhen = $("#recallWhen");

patchProg.appendChild(Object.assign(document.createElement("option"),
  {value:"", textContent:"— none —"}));
for (let p = 0; p < 128; p++)
  patchProg.appendChild(Object.assign(document.createElement("option"),
    {value:String(p), textContent:String(p)}));

function patchSay(msg, bad){
  patchNote.style.display = msg ? "" : "none";
  patchNote.innerHTML = msg || "";
  patchNote.classList.toggle("bad", !!bad);
}

function loadStore(){
  try{ return JSON.parse(localStorage.getItem(PATCH_KEY)) || {}; }catch(e){ return {}; }
}
function saveStore(o){
  try{ localStorage.setItem(PATCH_KEY, JSON.stringify(o)); return true; }
  catch(e){ patchSay("Couldn't save — browser storage is full or blocked.", true); return false; }
}

/* Voicings are derived, so they're rebuilt on load rather than stored. */
function snapshot(){
  return {
    app:"patchwork-cs1", v:PATCH_VERSION,
    key:keySel.value, keyPc:state.keyPc,
    mood:moodSel.value, mode:modeSel.value, len:lenSel.value,
    bpm:state.bpm, voice:state.voice, motion:state.motion, bass:state.bass,
    params:Object.assign({}, P),
    arp:Object.assign({}, ARP),
    pulse:{steps:PULSE.steps, on:PULSE.on.slice()},
    bassSeq:{steps:BASSQ.steps, on:BASSQ.on.slice()},
    swing:SW.ratio,
    clockOffset:SYNC.offsetMs,
    clockLock:SYNC.lock,
    prog:state.prog ? {
      mood:state.prog.mood, minor:!!state.prog.minor,
      chords:state.prog.chords.map(c => ({r:c.r, q:c.q, bars:c.bars || 1}))
    } : null
  };
}

const clamp = (v, lo, hi, dflt) =>
  typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
const oneOf = (v, list, dflt) => list.indexOf(v) >= 0 ? v : dflt;

function restore(s){
  if (!s || typeof s !== "object") throw new Error("not a patch");
  if (s.app && s.app !== "patchwork-cs1") throw new Error("different app");

  const moodNames = MOODS.concat(["any"]);
  keySel.value = (s.key === "rand" || /^\d+$/.test(String(s.key))) ? String(s.key) : "0";
  state.keyPc = clamp(s.keyPc, 0, 11, 0) | 0;
  if (keySel.value !== "rand") state.keyPc = parseInt(keySel.value, 10);
  /* mode first — it decides which moods are even listed — then re-apply the saved mood
     if it survived the filter, so an incompatible patch degrades instead of breaking */
  modeSel.value = oneOf(s.mode, ["auto","major","minor"], "auto");
  syncMoodOptions();
  const wantMood = oneOf(s.mood, moodNames, "any");
  moodSel.value = [...moodSel.options].some(o => o.value === wantMood) ? wantMood : "any";
  lenSel.value  = oneOf(String(s.len), ["auto","3","4","5","6","7","8","9","10","11","12"], "auto");

  state.voice  = oneOf(s.voice, Object.keys(VOICES), "soft");
  state.motion = oneOf(s.motion, ["hold","strum","arp","pulse"], "hold");
  const bassPatch = normBass(s.bass);
  state.bass = bassPatch.on;
  /* an off/decay/sustain-era patch pins the fader; newer ones carry it in params */
  if (bassPatch.sus != null && (!s.params || s.params.bassSus == null)) P.bassSus = bassPatch.sus;
  syncSeg("#voice", "v", state.voice);
  syncSeg("#motion", "m", state.motion);
  syncSeg("#bass", "b", state.bass ? "on" : "off");

  /* always run this, even with no params block — it's what re-renders the fader caps,
     and it has to happen after the bass fallback above so that value survives */
  const sp = Object.assign({}, (s.params && typeof s.params === "object") ? s.params : {});
  /* A tone position only means a cutoff relative to the range in force when it was saved.
     Work out the Hz the patch meant, then re-solve it against the current range, so a
     patch keeps sounding the way it was saved however often the range is widened. */
  const pv = +s.v || 1;
  if (pv < PATCH_VERSION && typeof sp.tone === "number"){
    const was = TONE_RANGES[pv] || TONE_RANGES[1];
    const hz = was[0] * Math.pow(was[1] / was[0], Math.min(1, Math.max(0, sp.tone)));
    sp.tone = Math.log(hz / TONE_MIN) / Math.log(TONE_MAX / TONE_MIN);
  }
  Object.keys(P_DEFAULT).forEach(id => {   // keyed off defaults, so every param resets
    const v = clamp(sp[id], 0, 1, P_DEFAULT[id]);
    if (faderCtl[id]) faderCtl[id].set(v); else P[id] = v;
  });

  ARP.dir     = oneOf(s.arp && s.arp.dir, ["up","down","updown","random"], "updown");
  ARP.octaves = clamp(s.arp && s.arp.octaves, 1, 3, 1) | 0;
  ARP.rate    = (s.arp && s.arp.rate === "auto") ? "auto"
              : oneOf(parseInt(s.arp && s.arp.rate, 10), [4,6,8,12,16,24,32], "auto");
  syncSeg("#arpDir", "d", ARP.dir);
  syncSeg("#arpOct", "o", String(ARP.octaves));
  arpRateSel.value = String(ARP.rate);

  const steps = oneOf(s.pulse && s.pulse.steps, [4,6,8,12,16], 8);
  PULSE.steps = steps;
  PULSE.on = Array.from({length:steps}, (_, i) =>
    (s.pulse && Array.isArray(s.pulse.on) && s.pulse.on[i]) ? 1 : 0);
  pulseStepsSel.value = String(steps);
  buildStepGrid();

  const bSteps = oneOf(s.bassSeq && s.bassSeq.steps, [4,6,8,12,16], 8);
  BASSQ.steps = bSteps;
  BASSQ.on = Array.from({length:bSteps}, (_, i) =>
    (s.bassSeq && Array.isArray(s.bassSeq.on)) ? (s.bassSeq.on[i] ? 1 : 0)
                                               : (i === 0 ? 1 : 0));   // older patches
  bassStepsSel.value = String(bSteps);
  renderSteps(bassGrid, BASSQ);

  SW.ratio = clamp(s.swing, .5, .75, .5);
  swingSel.value = SWING_OPTS.some(o => o[0] === SW.ratio) ? String(SW.ratio) : ".5";
  if (!SWING_OPTS.some(o => o[0] === SW.ratio)){ SW.ratio = .5; swingSel.value = "0.5"; }

  setClockOffset(clamp(s.clockOffset, -200, 200, 0));
  setClockLock(s.clockLock === true);       // absent in older patches, which predate it
  setBpm(clamp(s.bpm, 50, 180, 88));

  /* Rebuild the progression from its chords; anything unusable falls back to a fresh one. */
  const pc = s.prog && Array.isArray(s.prog.chords) ? s.prog.chords : null;
  const chords = pc ? pc.filter(c => c && QUAL[c.q]).slice(0, 12).map(c => ({
    r:((clamp(c.r, -60, 60, 0) | 0) % 12 + 12) % 12,
    q:c.q,
    bars:oneOf(+(clamp(c.bars, .25, 8, 1)).toFixed(2),
               BAR_STEPS.map(v => +v.toFixed(2)), 1)
  })) : [];

  if (chords.length){
    state.prog = {mood:oneOf(s.prog.mood, MOODS, MOODS[0]), minor:!!s.prog.minor, chords};
    buildVoicings(state.prog);
    openPad = null;
    renderProgression();
    modeNote.style.display = "none";
  } else {
    newProgression();
  }
  syncMotionOpts();
}

function syncSeg(sel, attr, value){
  const g = $(sel); if (!g) return;
  g.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset[attr] === String(value)));
}

function refreshPatchList(selected){
  const store = loadStore();
  const names = Object.keys(store).sort((a,b) => a.localeCompare(b));
  patchSel.innerHTML = "";
  patchSel.appendChild(Object.assign(document.createElement("option"),
    {value:"", textContent: names.length ? "— select —" : "— none saved —"}));
  names.forEach(n => patchSel.appendChild(
    Object.assign(document.createElement("option"),
      {value:n, textContent:n + (progFor(n) == null ? "" : "  ·  PC " + progFor(n))})));
  patchSel.value = selected && store[selected] ? selected : "";
  refreshProgSel();
  return names;
}

/* which program / note, if any, recalls this patch */
function progFor(name){
  for (const [p, n] of progMap) if (n === name) return p;
  return null;
}
function noteFor(name){
  for (const [n, pn] of patchNotes) if (pn === name) return n;
  return null;
}
function refreshProgSel(){
  const name = patchSel.value;
  patchProg.disabled = !name;
  const p = name ? progFor(name) : null;
  patchProg.value = p == null ? "" : String(p);
  const nt = name ? noteFor(name) : null;
  patchTrig.disabled = !name;
  patchTrig.textContent = nt == null ? "— none —" : midiNoteLabel(nt);
  patchTrig.classList.toggle("on", nt != null);
}

/* Click to learn: the next note that arrives is bound to the selected patch. Click again
   once bound to clear it. Learning by playing the pad beats picking a number out of 128. */
patchTrig.addEventListener("click", () => {
  const name = patchSel.value;
  if (!name){ patchSay("Pick a saved patch first.", true); return; }
  const cur = noteFor(name);
  if (cur != null){
    patchNotes.delete(cur);
    saveMap(); refreshBinds();
    patchSay("<b>" + name + "</b> no longer answers to " + midiNoteLabel(cur) + ".");
    return;
  }
  setLearn(true);
  arm({type:"patch", name}, patchTrig);
  patchSay("Play the pad that should recall <b>" + name + "</b>.");
});

recallWhen.addEventListener("change", () => {
  RECALL.when = recallWhen.value;
  saveMap();
});
patchProg.addEventListener("change", () => {
  const name = patchSel.value;
  if (!name){ patchProg.value = ""; return; }
  /* one program per patch and one patch per program, so clear both directions first */
  for (const [p, n] of [...progMap]) if (n === name) progMap.delete(p);
  if (patchProg.value !== ""){
    const p = parseInt(patchProg.value, 10);
    progMap.set(p, name);
  }
  saveMap();
  refreshPatchList(name);
  patchSay(patchProg.value === ""
    ? "<b>" + name + "</b> no longer answers to a program change."
    : "Program " + patchProg.value + " now recalls <b>" + name + "</b>.");
});

$("#patchSave").addEventListener("click", () => {
  const name = (patchName.value || "").trim()
    || (noteName(state.keyPc, state.keyPc, keyMinor()) + " " + (state.prog ? title(state.prog.mood) : "patch"));
  const store = loadStore();
  const existed = !!store[name];
  store[name] = Object.assign(snapshot(), {name});
  if (!saveStore(store)) return;
  patchName.value = name;
  refreshPatchList(name);
  patchSay((existed ? "Replaced" : "Saved") + " <b>" + name + "</b>.");
});

$("#patchDelete").addEventListener("click", () => {
  const name = patchSel.value;
  if (!name){ patchSay("Pick a saved patch to delete.", true); return; }
  const store = loadStore();
  delete store[name];
  if (!saveStore(store)) return;
  /* drop both assignments with it, or the number and the note stay claimed by a patch
     that no longer exists */
  for (const [p, n] of [...progMap]) if (n === name) progMap.delete(p);
  for (const [n, pn] of [...patchNotes]) if (pn === name) patchNotes.delete(n);
  saveMap();
  refreshBinds();
  refreshPatchList();
  patchSay("Deleted <b>" + name + "</b>.");
});

patchSel.addEventListener("change", () => {
  const name = patchSel.value;
  if (!name) return;
  const store = loadStore();
  try{
    restore(store[name]);
    patchName.value = name;
    refreshProgSel();
    patchSay("Loaded <b>" + name + "</b>.");
  }catch(err){
    patchSay("Couldn't load that patch (" + (err && err.message) + ").", true);
  }
});

$("#patchExport").addEventListener("click", () => {
  const name = (patchName.value || "patchwork-patch").trim();
  const data = Object.assign(snapshot(), {name});
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^\w\-. ]+/g, "_") + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  patchSay("Exported <b>" + a.download + "</b>.");
});

$("#patchImport").addEventListener("click", () => patchFile.click());
patchFile.addEventListener("change", () => {
  const f = patchFile.files && patchFile.files[0];
  patchFile.value = "";               // so re-picking the same file fires again
  if (!f) return;
  const rd = new FileReader();
  rd.onerror = () => patchSay("Couldn't read that file.", true);
  rd.onload = () => {
    let data;
    try{ data = JSON.parse(rd.result); }
    catch(e){ patchSay("That file isn't valid JSON.", true); return; }
    try{
      restore(data);
      if (data.name) patchName.value = data.name;
      patchSay("Imported <b>" + (data.name || f.name) + "</b>. Save it to keep it in this browser.");
    }catch(err){
      patchSay("That doesn't look like a Patchwork patch (" + (err && err.message) + ").", true);
    }
  };
  rd.readAsText(f);
});

refreshPatchList();

window.addEventListener("pagehide", () => { allPadsOff(); midiPanic(); });

setBpm(88);
loadMap();
recallWhen.value = RECALL.when;      // loadMap may have restored a different choice
/* the patch list was built before loadMap ran, so its options carry no program numbers yet */
refreshPatchList(patchSel.value);
newProgression();
refreshBinds();
initMidi();

/* ---- scenes ----
   A CS·1 pattern is the progression — the changes, not the voice. Firing a scene swaps
   what the chords ARE and leaves the sound you dialled alone, which is the rule the whole
   scene bank follows.

   Reuses snapshot()'s shape for `prog` so there is one description of a progression
   rather than two that can disagree. */
Patchwork.scenes.register("cs1", {
  name: "CS\u00b71",
  isPlaying: () => state.playing,
  start: () => { ensureAudio(); if (!state.playing) startPlay(); },
  stop: () => { if (state.playing) stopPlay(); },
  capture: () => ({
    prog: state.prog ? {mood: state.prog.mood, minor: !!state.prog.minor,
                        chords: state.prog.chords.map(c => ({r: c.r, q: c.q, bars: c.bars || 1}))} : null,
    keyPc: state.keyPc, key: keySel.value
  }),
  apply: pat => {
    if (!pat.prog) return;
    state.prog = {mood: pat.prog.mood, minor: !!pat.prog.minor,
                  chords: pat.prog.chords.map(c => ({r: c.r, q: c.q, bars: c.bars || 1}))};
    if (typeof pat.keyPc === "number") state.keyPc = pat.keyPc;
    if (pat.key != null) keySel.value = pat.key;
    /* buildVoicings before rendering — restore() does the same, and without it the
       chords have no voicings and the engine plays nothing */
    buildVoicings(state.prog);
    openPad = null;
    renderProgression();
  }
});

/* CS·1 is armable like everything else. It has no write(): a played note cannot be
   written into a chord progression the way it can into a step grid, so nothing is captured
   as you play. What arming means here is the other half — press a row and the progression
   you have right now goes into it. */
Patchwork.record.register("cs1", {name: "CS\u00b71"});

/* A test hook, not a feature — the same one MS·1 carries. It exists so the MIDI input
   path can be driven and asserted on without hardware, which is how the channel filter
   above was verified. */
/* ---- what the rest of the rack can play along to ----
   Resolved notes, not chord symbols: voicing is this instrument's theory and stays here.
   Read on a poll rather than pushed, because state.prog is set from three places already —
   see shell/chords.js. */
Patchwork.chords.provide(() => {
  const p = state.prog;
  if (!p || !p.chords || !p.chords.length) return null;
  let prev = null;
  return {
    key: state.keyPc, minor: !!p.minor, mood: p.mood,
    chords: p.chords.map(ch => {
      const v = voiceChord(ch, state.keyPc, prev);
      prev = v.center;
      return {name: chordName(ch, state.keyPc, !!p.minor),
              roman: romanName(ch),
              bass: bassNote(ch, state.keyPc),
              notes: v.notes.slice()};
    })
  };
});

window.__cs1 = {MIDI, onMidi, state, P, renderChord, VOICES,
                get held(){ return held; }, get litPads(){ return litPads; },
                get ctx(){ return ctx; }, get active(){ return active; }, ensureAudio};
