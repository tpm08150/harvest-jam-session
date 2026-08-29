
/* ============ ui ============ */

const playBtn = $("#play"), tempoOut = $("#tempoOut"), nowNote = $("#nowNote"),
      meterEl = $("#inMeter"), vocNote = $("#vocNote");
const NOTES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const noteName = n => NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

function say(msg, bad){ vocNote.innerHTML = msg; vocNote.classList.toggle("err", !!bad); }

/* ---- the sequencer ---- */
const seq = Patchwork.makeSeq({
  id: "vc1", maxSteps: 64, len: 16, rate: "1/8", root: 48,
  /* ⚠️ The release is scheduled on the AUDIO clock, not a setTimeout. The old form fired
     the note-off whenever a main-thread timer got round to it, so note lengths wandered by
     however late the timer was — see BS·1's fire(), where the same fault displaced onsets
     rather than lengths because that instrument is monophonic and picks by pitch. */
  fire: (ev, t) => {
    ensureAudio();
    noteOn(ev.n, Math.round(ev.vel * 127), t);
    noteOff(ev.n, t + ev.dur);
  },
  onState: on => {
    playBtn.classList.toggle("on", on);
    playBtn.textContent = on ? "■ Stop" : "▶ Play";
    if (!on) allNotesOff();
  }
});
const grid = Patchwork.mountSeqGrid($("#seqWrap"), seq);

const lenSel = $("#seqLen"), rateSel = $("#seqRate"), keySel = $("#seqKey"), scaleSel = $("#seqScale");
[8,12,16,24,32,48,64].forEach(n => lenSel.appendChild(Object.assign(
  document.createElement("option"), {value:String(n), textContent:n + " steps"})));
lenSel.value = "16";
Object.keys(seq.RATES).forEach(r => rateSel.appendChild(Object.assign(
  document.createElement("option"), {value:r, textContent:r})));
rateSel.value = "1/8";
for (let n = 36; n <= 60; n++) keySel.appendChild(Object.assign(
  document.createElement("option"), {value:String(n), textContent:noteName(n)}));
keySel.value = "48";
Object.keys(seq.SCALES).forEach(s => scaleSel.appendChild(Object.assign(
  document.createElement("option"),
  {value:s, textContent:s.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase())})));
scaleSel.value = "minor";

lenSel.addEventListener("change", () => { seq.setLen(+lenSel.value); grid.render(); });
rateSel.addEventListener("change", () => { seq.SEQ.rate = rateSel.value; });
keySel.addEventListener("change", () => { seq.SEQ.root = +keySel.value; grid.paint(); });
scaleSel.addEventListener("change", () => { seq.SEQ.scale = scaleSel.value; grid.paint(); });

playBtn.addEventListener("click", () => { ensureAudio(); seq.toggle(); });
$("#panic").addEventListener("click", () => { seq.stop(); allNotesOff(); });

let latch = false;
$("#hold").addEventListener("click", () => {
  latch = !latch;
  $("#hold").classList.toggle("on", latch);
  if (!latch) allNotesOff();
});
$("#listen").addEventListener("click", async () => {
  ensureAudio();
  if (modStream){ closeInput(); $("#listen").classList.remove("on"); say("Modulator closed."); return; }
  const ok = await openInput($("#inSel").value === "__bus" ? "__bus" : "");
  $("#listen").classList.toggle("on", !!ok);
});
$("#inSel").addEventListener("change", () => { if (modStream) openInput($("#inSel").value === "__bus" ? "__bus" : ""); });

/* ---- carrier keyboard ---- */
const keysEl = $("#keys");
const KEY_BASE = 48;
const BLACK = {1:1,3:1,6:1,8:1,10:1};
for (let i = 0; i < 25; i++){
  const n = KEY_BASE + i;
  const k = document.createElement("div");
  k.className = "k" + (BLACK[n % 12] ? " b" : "");
  k.dataset.n = n;
  if (BLACK[n % 12]) k.appendChild(document.createElement("i"));
  keysEl.appendChild(k);
}
keysEl.addEventListener("pointerdown", e => {
  const k = e.target.closest(".k"); if (!k) return;
  ensureAudio();
  const n = +k.dataset.n;
  /* a played note reaches the grid only while armed and recording — see shell/record.js */
  Patchwork.record.note("vc1", n, 100);
  if (latch && carriers.has(n)) noteOff(n); else noteOn(n, 100);
});
window.addEventListener("pointerup", () => { if (!latch) allNotesOff(); });

/* The computer keyboard is the shell's — see shell/keys.js. VC·1 has no octave control of
   its own, so the arrows move the offset the keys module keeps; the carrier is voiced from
   the note it is given, so shifting it is the whole of what an octave means here. */
Patchwork.keys.mount(root, {
  map: (i, oct) => KEY_BASE + oct * 12 + i,
  on: (n, v) => {
    ensureAudio();
    Patchwork.record.note("vc1", n, v);
    if (latch && carriers.has(n)) noteOff(n); else noteOn(n, v);
  },
  off: n => { if (!latch) noteOff(n); },
  paint: () => paintNow()
});

function paintNow(){
  const held = [...carriers.keys()].filter(n => { const c = carriers.get(n); return c && !c.released; });
  nowNote.textContent = held.length ? held.sort((a,b)=>a-b).map(noteName).join(" ") : "—";
  keysEl.querySelectorAll(".k").forEach(k => k.classList.toggle("on", held.indexOf(+k.dataset.n) >= 0));
}

/* meter and playhead */
const mbuf = new Float32Array(1024);
(function paintLoop(){
  grid.paint();
  if (modMeter){
    modMeter.getFloatTimeDomainData(mbuf);
    let s = 0; for (let i = 0; i < mbuf.length; i++) s += mbuf[i]*mbuf[i];
    meterEl.style.width = Math.min(100, Math.sqrt(s/mbuf.length) * 320) + "%";
  }
  requestAnimationFrame(paintLoop);
})();

/* ---- tempo ---- */
function setBpm(v, fromShell){
  const b = Math.round(clampf(v, 40, 240));
  tempoOut.textContent = b;
  if (!fromShell) Patchwork.clock.setBpm(b, "vc1");
}
Patchwork.clock.onTempo("vc1", v => setBpm(v, true), 120);
setBpm(Patchwork.clock.bpm, true);
$("#bpmUp").addEventListener("click", () => setBpm(Patchwork.clock.bpm + 1));
$("#bpmDown").addEventListener("click", () => setBpm(Patchwork.clock.bpm - 1));

/* ---- bank controls ---- */
function fader(sel, get, set, fmt, min, max){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  function paintF(){
    cap.style.left = (clampf((get() - min) / (max - min), 0, 1) * 100) + "%";
    val.textContent = fmt(get());
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      set(min + clampf((cx - r.left) / r.width, 0, 1) * (max - min));
      applyVocoder(); paintF();
    };
    move(e); el.classList.add("dragging");
    const up = () => { el.classList.remove("dragging");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  paintF();
}
fader("#qF",    () => P.q,       v => { P.q = v; },       v => v.toFixed(1), .5, 12);
fader("#respF", () => P.resp,    v => { P.resp = v; },    v => v.toFixed(0) + " Hz", 4, 80);
fader("#sibF",  () => P.sib,     v => { P.sib = v; },     v => Math.round(v*100) + "%", 0, 1);
fader("#compF", () => P.comp,    v => { P.comp = v; },    v => Math.round(v*100) + "%", 0, 1);
fader("#modF",  () => P.mod,     v => { P.mod = v; },     v => Math.round(v*100) + "%", 0, 3);
fader("#carrF", () => P.carrier, v => { P.carrier = v; }, v => Math.round(v*100) + "%", 0, 1.5);
fader("#mixF",  () => P.mix,     v => { P.mix = v; },     v => Math.round(v*100) + "%", 0, 1.5);
fader("#relF",  () => P.release, v => { P.release = v; }, v => (v*1000).toFixed(0) + " ms", .02, 1.5);

$("#bands").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  P.bands = +b.dataset.b;
  $$("#bands button").forEach(x => x.classList.toggle("on", x === b));
  ensureAudio(); applyVocoder();
});
$("#wave").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  P.wave = b.dataset.w;
  $$("#wave button").forEach(x => x.classList.toggle("on", x === b));
});

onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ ensureAudio(); seq.toggle(); e.preventDefault(); }
});

paintNow();
