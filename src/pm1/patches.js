/* ============ patches ============ */
/* Deliberately still the MS·1 key. PM·1 is what MS·1 became once the vocoder and bass
   moved out, and renaming this would silently orphan every patch anyone had saved. */
const PATCH_KEY = "patchwork-ms1-patches";
const PATCH_VERSION = 2;      // v2 added the vocoder section; v1 patches take its defaults
const patchSel = $("#patchSel"), patchName = $("#patchName"), patchNote = $("#patchNote"),
      patchFile = $("#patchFile");

function sayPatch(msg, bad){
  patchNote.style.display = msg ? "" : "none";
  patchNote.innerHTML = msg || "";
  patchNote.classList.toggle("bad", !!bad);
}
function loadStore(){
  try{ return JSON.parse(localStorage.getItem(PATCH_KEY)) || {}; }catch(e){ return {}; }
}
function saveStore(o){
  try{ localStorage.setItem(PATCH_KEY, JSON.stringify(o)); return true; }
  catch(e){ sayPatch("Couldn't save — browser storage is full or blocked.", true); return false; }
}
function snapshot(){
  return {
    app:"patchwork-pm1", v:PATCH_VERSION,
    params:Object.assign({}, P),
    bpm:SEQ.bpmExact, octave:octave,
    seq:{motion:SEQ.motion, len:SEQ.len, rate:SEQ.rate, gate:SEQ.gate, swing:SEQ.swing,
         dir:SEQ.dir, octaves:SEQ.octaves, root:SEQ.root, scale:SEQ.scale, vel:SEQ.vel,
         accentAmt:SEQ.accentAmt,
         steps:SEQ.steps.map(s => [s.on,s.pitch,s.oct,s.gate,s.accent,s.slide,s.tie,
                                   s.locks || null])}
  };
}
const oneOf = (v, list, dflt) => list.indexOf(v) >= 0 ? v : dflt;
const numOr = (v, lo, hi, dflt) =>
  typeof v === "number" && isFinite(v) ? clampf(v, lo, hi) : dflt;

/* Keyed off FACTORY_DEFAULT, so a patch that omits a parameter RESETS it rather than
   inheriting whatever was dialled in before the load. */
function applyParams(src){
  Object.keys(FACTORY_DEFAULT).forEach(k => {
    const dflt = FACTORY_DEFAULT[k], got = src ? src[k] : undefined;
    P[k] = (typeof dflt === "number")
      ? (typeof got === "number" && isFinite(got) ? got : dflt)
      : (typeof got === "string" ? got : dflt);
  });
  refreshAllControls();
}
function refreshAllControls(){
  Object.keys(ctlReg).forEach(id => { if (ctlReg[id].render) ctlReg[id].render(); });
  Object.keys(segPaint).forEach(k => { if (typeof segPaint[k] === "function") segPaint[k](); });
  if (ctx){
    startLfo();
    if (lfoPitchG) lfoPitchG.gain.value = P.lfop;
    if (lfoFiltG)  lfoFiltG.gain.value = P.lfof*1200;
    if (lfoAmpG)   lfoAmpG.gain.value = P.lfoa;
    if (pwmLfo)    pwmLfo.frequency.value = P.pwmrate;
    applyChorus(); applyDelay(); applySends();
  }
  paintMeta(); paintNow();
}
function restore(s){
  if (!s || typeof s !== "object") throw new Error("not a patch");
  /* Accepts both names, so a file exported from MS·1 still loads. */
  if (s.app && s.app !== "patchwork-pm1" && s.app !== "patchwork-ms1")
    throw new Error("different app");
  applyParams(s.params);
  setBpm(numOr(s.bpm, 40, 240, 120));
  setOctave(numOr(s.octave, -3, 3, 0));
  const q = s.seq || {};
  SEQ.motion = oneOf(q.motion, ["off","arp","seq"], SEQ.motion);
  SEQ.len    = oneOf(q.len, [8,12,16,32], 16);
  SEQ.rate   = oneOf(q.rate, Object.keys(RATES), "1/16");
  SEQ.gate   = numOr(q.gate, .05, 1, .5);
  SEQ.swing  = numOr(q.swing, .5, .75, .5);
  SEQ.dir    = oneOf(q.dir, ["up","down","updown","random"], "up");
  SEQ.octaves= numOr(q.octaves, 1, 3, 1)|0;
  SEQ.root   = numOr(q.root, 0, 127, 36)|0;
  SEQ.scale  = oneOf(q.scale, Object.keys(SCALES), "chromatic");
  SEQ.vel    = numOr(q.vel, 1, 127, 88)|0;
  SEQ.accentAmt = numOr(q.accentAmt, 0, 1, .8);
  if (Array.isArray(q.steps) && q.steps.length){
    SEQ.steps = [];
    for (let i = 0; i < MAX_STEPS; i++){
      const a = q.steps[i];
      const st = Array.isArray(a)
        ? S(a[0]?1:0, numOr(a[1],-24,24,0)|0, numOr(a[2],-2,2,0)|0,
            numOr(a[3],.05,1,.5), a[4]?1:0, a[5]?1:0, a[6]?1:0)
        : S(0,0,0,.5,0,0,0);
      /* locks are read defensively: only known parameters, only finite numbers, so a
         hand-edited or older patch file cannot inject junk into P at schedule time */
      if (Array.isArray(a) && a[7] && typeof a[7] === "object"){
        const L = {};
        Object.keys(a[7]).forEach(k => {
          const r = PARAM_RANGE[k];
          if (r && typeof a[7][k] === "number" && isFinite(a[7][k]))
            L[k] = clampf(a[7][k], r[0], r[1]);
        });
        if (Object.keys(L).length) st.locks = L;
      }
      SEQ.steps.push(st);
    }
  }
  seqLenSel.value = String(SEQ.len);
  seqRateSel.value = SEQ.rate;
  if (ctlReg.gate) ctlReg.gate.render();
  if (ctlReg.swing) ctlReg.swing.render();
  segPaint.motion(); segPaint.arpDir(); segPaint.arpOct(); segPaint.seqMode();
  paintSeqKey(); paintLocks();
  if (typeof paintBassNote === "function") paintBassNote();
  if (typeof paintKeysNote === "function") paintKeysNote();
  renderSteps();
}

/* Factory presets sit in the same menu as user patches but cannot be overwritten — a
   Save under a factory name writes a user patch that shadows it, and Delete removes only
   the shadow. That way the bank is always recoverable without a reset button. */
function refreshPatchList(selected){
  const store = loadStore();
  const users = Object.keys(store).sort((a,b) => a.localeCompare(b));
  patchSel.innerHTML = "";
  const mk = (v, t) => Object.assign(document.createElement("option"), {value:v, textContent:t});
  patchSel.appendChild(mk("", "— select —"));
  const gF = document.createElement("optgroup"); gF.label = "Factory";
  FACTORY_ORDER.forEach(n => gF.appendChild(mk("f:"+n, n + (store[n] ? "  ·  edited" : ""))));
  patchSel.appendChild(gF);
  if (users.length){
    const gU = document.createElement("optgroup"); gU.label = "Saved";
    users.forEach(n => gU.appendChild(mk("u:"+n, n)));
    patchSel.appendChild(gU);
  }
  if (selected) patchSel.value = selected;
  return users;
}
function loadFactory(name){
  const f = FACTORY[name]; if (!f) return;
  applyParams(f);
  patchName.value = name;
  patchTag.textContent = name;
  sayPatch("<b>" + name + "</b> — " + (f.tag || ""));
}
patchSel.addEventListener("change", () => {
  const v = patchSel.value; if (!v) return;
  const name = v.slice(2);
  if (v.startsWith("f:")) return loadFactory(name);
  const store = loadStore();
  try{
    restore(store[name]);
    patchName.value = name; patchTag.textContent = name;
    sayPatch("Loaded <b>" + name + "</b>.");
  }catch(err){ sayPatch("Couldn't load that patch (" + (err && err.message) + ").", true); }
});
$("#patchSave").addEventListener("click", () => {
  const name = (patchName.value || "").trim() || "Untitled";
  const store = loadStore();
  const existed = !!store[name];
  store[name] = Object.assign(snapshot(), {name});
  if (!saveStore(store)) return;
  patchName.value = name; patchTag.textContent = name;
  refreshPatchList("u:"+name);
  sayPatch((existed ? "Replaced" : "Saved") + " <b>" + name + "</b>.");
});
$("#patchDelete").addEventListener("click", () => {
  const v = patchSel.value;
  if (!v || !v.startsWith("u:")){ sayPatch("Pick a saved patch to delete — the factory bank can't be removed.", true); return; }
  const name = v.slice(2);
  const store = loadStore();
  delete store[name];
  if (!saveStore(store)) return;
  refreshPatchList();
  sayPatch("Deleted <b>" + name + "</b>.");
});
$("#patchExport").addEventListener("click", () => {
  const name = (patchName.value || "patchwork-pm1-patch").trim();
  const data = Object.assign(snapshot(), {name});
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name.replace(/[^\w\-. ]+/g, "_") + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  sayPatch("Exported <b>" + a.download + "</b>.");
});
$("#patchImport").addEventListener("click", () => patchFile.click());
patchFile.addEventListener("change", () => {
  const f = patchFile.files && patchFile.files[0];
  patchFile.value = "";                 // so re-picking the same file fires again
  if (!f) return;
  const rd = new FileReader();
  rd.onerror = () => sayPatch("Couldn't read that file.", true);
  rd.onload = () => {
    let data;
    try{ data = JSON.parse(rd.result); }
    catch(e){ sayPatch("That file isn't valid JSON.", true); return; }
    try{
      restore(data);
      if (data.name) patchName.value = data.name;
      sayPatch("Imported <b>" + (data.name || f.name) + "</b>. Save it to keep it in this browser.");
    }catch(err){
      sayPatch("That doesn't look like a Patchwork PM·1 patch (" + (err && err.message) + ").", true);
    }
  };
  rd.readAsText(f);
});
$("#init").addEventListener("click", () => {
  applyParams(FACTORY_DEFAULT);
  patchName.value = ""; patchTag.textContent = "init";
  patchSel.value = "";
  sayPatch("Back to the init patch — one saw, filter open, no effects.");
});

