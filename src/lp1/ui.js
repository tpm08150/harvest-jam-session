
/* ============ ui ============ */

const stateEl = $("#loopState"), cutEl = $("#loopCut"), noteEl = $("#loopNote"),
      fillEl = $("#loopFill"), headEl = $("#loopHead"), meterEl = $("#inMeter"),
      recBtn = $("#rec"), dubBtn = $("#dub"), playBtn = $("#playStop");
const clampf = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function say(msg, bad){
  noteEl.innerHTML = msg;
  noteEl.classList.toggle("err", !!bad);
}

const LABEL = {idle:"Empty", armed:"Armed", rec:"Recording", play:"Playing", dub:"Overdub"};

function paintState(){
  const m = LP.mode;
  stateEl.textContent = (m === "idle" && LP.bpmAtRecord) ? "Stopped" : (LABEL[m] || m);
  root.classList.toggle("recording", m === "rec" || m === "dub");
  root.classList.toggle("armed", m === "armed");
  playBtn.textContent = (m === "play" || m === "dub") ? "■ Stop" : "▶ Play";
  dubBtn.classList.toggle("on", m === "dub");
  cutEl.textContent = LP.bpmAtRecord ? (LP.bars + " bars · cut at " + LP.bpmAtRecord + " bpm") : "—";
  /* A loop cut at another tempo no longer fits the bar, and silently drifting is worse
     than being told. */
  const now = Patchwork.clock.bpm;
  cutEl.classList.toggle("bad", !!LP.bpmAtRecord && now !== LP.bpmAtRecord);
}

/* The playhead comes from the worklet's own position, not from a timer — a timer would
   show where the main thread thinks the loop is, which is not where it is. */
function paintLoop(){
  if (LP.len > 0 && LP.mode !== "idle"){
    const p = (LP.pos / LP.len) * 100;
    fillEl.style.width = p + "%";
    headEl.style.left = p + "%";
  } else if (LP.mode === "idle"){
    fillEl.style.width = "0%"; headEl.style.left = "0%";
  }
  meterEl.style.width = Math.min(100, LP.peak * 140) + "%";
  requestAnimationFrame(paintLoop);
}
requestAnimationFrame(paintLoop);

recBtn.addEventListener("click", () => {
  if (LP.mode === "rec" || LP.mode === "armed") stopLoop();
  else arm("rec");
});
dubBtn.addEventListener("click", () => {
  if (LP.mode === "dub"){ node && node.port.postMessage({op:"now", mode:"play"}); setMode("play"); }
  else if (LP.bpmAtRecord) arm("dub");
  else say("Record a loop first — there is nothing to overdub onto.", true);
});
playBtn.addEventListener("click", () => {
  if (LP.mode === "play" || LP.mode === "dub") stopLoop();
  else if (LP.bpmAtRecord) play();
  else say("Nothing recorded yet.", true);
});
$("#undo").addEventListener("click", undo);
$("#clear").addEventListener("click", () => { clearLoop(); say("Cleared."); });

$("#bars").addEventListener("change", e => {
  LP.bars = parseInt(e.target.value, 10);
  if (node) allocate();
  paintState();
});

$("#mon").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  LP.monitorOn = b.dataset.m === "on";
  $$("#mon button").forEach(x => x.classList.toggle("on", x === b));
  if (monitor) monitor.gain.setTargetAtTime(LP.monitorOn ? 1 : 0, ctx.currentTime, .01);
});

const inSel = $("#inSel");
inSel.addEventListener("change", () => { LP.input = inSel.value; if (stream) openInput(LP.input); });

let devices = [];
function inputLabel(id){
  if (id === "__bus") return "the studio output";
  const d = devices.find(x => x.deviceId === id);
  return d && d.label ? d.label : (id ? "the selected input" : "the default input");
}
async function listInputs(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try{
    const devs = await navigator.mediaDevices.enumerateDevices();
    devices = devs.filter(d => d.kind === "audioinput");
    const keep = inSel.value;
    inSel.textContent = "";
    inSel.appendChild(Object.assign(document.createElement("option"),
      {value:"__bus", textContent:"Studio output"}));
    inSel.appendChild(Object.assign(document.createElement("option"),
      {value:"", textContent:"Default microphone"}));
    devices.forEach((d, i) => inSel.appendChild(Object.assign(document.createElement("option"),
      {value:d.deviceId, textContent:d.label || ("Input " + (i + 1))})));
    if (keep && devices.some(d => d.deviceId === keep)) inSel.value = keep;
  }catch(e){}
}
listInputs();
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener("devicechange", listInputs);

/* level */
(function(){
  const el = $("#levelF"), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  function paintF(){
    cap.style.left = (LP.level * 100) + "%";
    val.textContent = Math.round(LP.level * 100) + "%";
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      LP.level = clampf((cx - r.left) / r.width, 0, 1);
      if (node && node.__level) node.__level.gain.setTargetAtTime(LP.level, ctx.currentTime, .01);
      paintF();
    };
    move(e); el.classList.add("dragging");
    const up = () => { el.classList.remove("dragging");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  paintF();
})();

/* Space records, and only when this panel owns the keyboard. */
onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ recBtn.click(); e.preventDefault(); }
});

paintState();
