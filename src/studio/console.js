
/* ---- MX·8, the console ----
   Seven channels down to two tracks, in front of the tape.

   ⚠️ IT OWNS NO AUDIO. Every node this touches lives in bus.js, on the same strips the
   scene launcher's faders and the mute/solo buttons already write to — so a level set here
   is the level a scene recalls, and there is exactly one mixer rather than two that
   disagree. This file is knobs and persistence. */
(() => {
"use strict";
const desk = document.querySelector("#mxDesk");
const A = window.Patchwork && Patchwork.audio;
if (!desk || !A || !A.eq) return;
const $ = id => document.getElementById(id);
const strips = $("mxStrips"), KEY = "patchwork-console";

/* ⚠️ FREQ IS LOGARITHMIC and the others are not. 200 Hz to 6 kHz linearly puts everything
   below 1 kHz in the first sixth of the travel, which is precisely the half that matters
   for a sweepable mid. */
/* ⚠️ HIGH AT THE TOP, LOW AT THE BOTTOM — the order every desk uses, because the column
   reads as a frequency axis. FREQ stays directly under MID: it is that band's sweep, not a
   control of its own, and separating them makes the pair meaningless. */
const CONTROLS = [
  {k: "high", lab: "HIGH", min: -15, max: 15,   def: 0,   fmt: v => v.toFixed(1) + " dB", set: (id, v) => A.eq.high(id, v)},
  {k: "mid",  lab: "MID",  min: -15, max: 15,   def: 0,   fmt: v => v.toFixed(1) + " dB", set: (id, v) => A.eq.mid(id, v)},
  {k: "freq", lab: "FREQ", min: 200, max: 6000, def: 900, log: true,
   fmt: v => v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : Math.round(v) + " Hz", set: (id, v) => A.eq.midFreq(id, v)},
  {k: "low",  lab: "LOW",  min: -15, max: 15,   def: 0,   fmt: v => v.toFixed(1) + " dB", set: (id, v) => A.eq.low(id, v)},
  {k: "comp", lab: "COMP", min: 0,   max: 1,    def: 0,   fmt: v => Math.round(v * 100) + "%", set: (id, v) => A.compression(id, v)},
  {k: "rev",  lab: "REV",  min: 0,   max: 1,    def: 0,   fmt: v => Math.round(v * 100) + "%", set: (id, v) => A.send(id, "reverb", v)},
  {k: "dly",  lab: "DLY",  min: 0,   max: 1,    def: 0,   fmt: v => Math.round(v * 100) + "%", set: (id, v) => A.send(id, "delay", v)},
  {k: "pan",  lab: "PAN",  min: -1,  max: 1,    def: 0,
   fmt: v => Math.abs(v) < .02 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100), set: (id, v) => A.pan(id, v)},
];
const MASTER = [
  {k: "revRet", lab: "REV",   min: 0,   max: 1.4, def: .8,   fmt: v => Math.round(v * 100) + "%", set: v => A.masterFx.reverbReturn(v)},
  {k: "dlyRet", lab: "DLY",   min: 0,   max: 1.4, def: .8,   fmt: v => Math.round(v * 100) + "%", set: v => A.masterFx.delayReturn(v)},
  {k: "dlyT",   lab: "TIME",  min: .05, max: 1.2, def: .375, log: true,
   fmt: v => Math.round(v * 1000) + " ms", set: v => A.masterFx.delayTime(v)},
  {k: "dlyFb",  lab: "FDBK",  min: 0,   max: .85, def: .34,  fmt: v => Math.round(v * 100) + "%", set: v => A.masterFx.delayFeedback(v)},
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/* 0..1 of knob travel <-> a value, through whichever curve the control wants */
function toNorm(c, v){
  return c.log ? Math.log(v / c.min) / Math.log(c.max / c.min)
               : (v - c.min) / (c.max - c.min);
}
function fromNorm(c, n){
  n = clamp(n, 0, 1);
  return c.log ? c.min * Math.pow(c.max / c.min, n) : c.min + n * (c.max - c.min);
}

/* ---- saved settings ----
   A desk that forgets every EQ move on reload is one nobody will trust with a take. */
let saved = {};
try{ saved = JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){}
let saveTimer = 0;
function persist(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try{ localStorage.setItem(KEY, JSON.stringify(saved)); }catch(e){}
  }, 250);
}

/* ---- the knob ----
   Drag up and down. ⚠️ Vertical only, and pointer-locked to the element: a knob that also
   answers to horizontal movement fights the page underneath it on a trackpad, and one that
   loses the pointer at the edge of its own box stops mid-turn. */
function knob(c, initial, onChange){
  const wrap = document.createElement("div");
  wrap.className = "mx-knob";
  wrap.dataset.k = c.k;                // the row colour comes from this
  wrap.innerHTML =
    '<svg viewBox="0 0 40 40">' +
      '<circle class="mx-k-track" cx="20" cy="20" r="15" pathLength="100" transform="rotate(135 20 20)"/>' +
      '<circle class="mx-k-arc"   cx="20" cy="20" r="15" pathLength="100" transform="rotate(135 20 20)"/>' +
      '<circle class="mx-k-body"  cx="20" cy="20" r="10.5"/>' +
      '<line class="mx-k-mark" x1="20" y1="12" x2="20" y2="6.5"/>' +
    '</svg>' +
    '<span class="mx-k-lab">' + c.lab + '</span>' +
    '<span class="mx-k-val"></span>';
  const arc = wrap.querySelector(".mx-k-arc");
  const mark = wrap.querySelector(".mx-k-mark");
  const val = wrap.querySelector(".mx-k-val");
  let v = initial;

  function paint(){
    const n = clamp(toNorm(c, v), 0, 1);
    /* the arc is drawn from the centre for anything that cuts as well as boosts, and from
       the left for anything that only goes up — so "flat" reads as empty either way */
    const bipolar = c.min < 0;
    const from = bipolar ? 0.5 : 0;
    arc.setAttribute("stroke-dasharray", Math.abs(n - from) * 75 + " 100");
    arc.setAttribute("stroke-dashoffset", -Math.min(n, from) * 75);
    mark.setAttribute("transform", "rotate(" + (-135 + n * 270).toFixed(1) + " 20 20)");
    val.textContent = c.fmt(v);
    wrap.classList.toggle("mx-k-touched", Math.abs(n - toNorm(c, c.def)) > .004);
  }
  function set(nv, quiet){
    v = clamp(nv, Math.min(c.min, c.max), Math.max(c.min, c.max));
    paint();
    if (!quiet) onChange(v);
  }
  let drag = null;
  wrap.addEventListener("pointerdown", e => {
    drag = {y: e.clientY, n: toNorm(c, v), fine: e.shiftKey};
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add("mx-k-live");
    e.preventDefault();
  });
  wrap.addEventListener("pointermove", e => {
    if (!drag) return;
    /* 160px of travel is the full sweep; shift makes it 640 for setting a mid by ear */
    const span = (drag.fine || e.shiftKey) ? 640 : 160;
    set(fromNorm(c, drag.n + (drag.y - e.clientY) / span));
  });
  const end = () => { drag = null; wrap.classList.remove("mx-k-live"); };
  wrap.addEventListener("pointerup", end);
  wrap.addEventListener("pointercancel", end);
  /* double-click is the way back to default, which on a desk is the thing you reach for
     most after "what did I just do to this channel" */
  wrap.addEventListener("dblclick", () => set(c.def));
  /* ⚠️ NO WHEEL HANDLER, deliberately. It was here and it had to go: the desk is taller
     than the window, so reaching the faders means scrolling, and a wheel-to-adjust knob
     silently re-EQs whatever the cursor happened to be over on the way past. It cost a
     channel a 15 dB mid cut during testing before anyone noticed — on a take that would be
     a ruined recording nobody could explain. Drag is the gesture; double-click resets. */

  paint();
  onChange(v);
  return {el: wrap, set, get value(){ return v; }, reset: () => set(c.def)};
}

/* ---- the strips ---- */
const knobs = new Map();               // id -> {k: knob}
/* ⚠️ BUILT FROM WHAT IS MOUNTED, not from Patchwork.scenes.instruments. That list is the
   things a scene row can fire, and it deliberately leaves out LP·1 — the looper has no
   sequencer to launch. But it very much makes noise, through the same bus strip as
   everything else, so a desk built from the scene list silently had no channel for it and
   no way to EQ, pan or fade the loops. Every mounted instrument is a channel. */
function niceName(id){
  const m = /^([a-z]+)(\d+)$/.exec(id);
  return m ? m[1].toUpperCase() + "\u00b7" + m[2] : id.toUpperCase();
}
function buildStrips(){
  const insts = (Patchwork.roots || []).map(r => r.dataset.instrument).filter(Boolean);
  strips.textContent = "";
  knobs.clear();
  insts.forEach(id => {
    saved[id] = saved[id] || {};
    const col = document.createElement("div");
    col.className = "mx-strip";
    col.dataset.inst = id;
    const head = document.createElement("div");
    head.className = "mx-strip-name";
    head.textContent = niceName(id);
    col.appendChild(head);

    const mine = {};
    CONTROLS.forEach(c => {
      const start = typeof saved[id][c.k] === "number" ? saved[id][c.k] : c.def;
      const k = knob(c, start, v => { saved[id][c.k] = v; c.set(id, v); persist(); });
      col.appendChild(k.el);
      mine[c.k] = k;
    });
    knobs.set(id, mine);

    /* The fader is the SAME value the launcher's fader writes, read back from the bus
       rather than kept here — two mixers with two ideas of one channel's level is the bug
       this whole file is arranged to avoid. */
    const fWrap = document.createElement("div");
    fWrap.className = "mx-faderwrap";
    const f = document.createElement("input");
    f.type = "range"; f.className = "mx-fader";
    f.min = "0"; f.max = "130"; f.step = "1";
    f.value = String(Math.round(A.level(id) * 100));
    f.dataset.inst = id;
    const fv = document.createElement("span");
    fv.className = "mx-faderval"; fv.textContent = f.value;
    f.addEventListener("input", () => { A.setLevel(id, +f.value / 100); fv.textContent = f.value; });
    fWrap.appendChild(f); fWrap.appendChild(fv);
    col.appendChild(fWrap);

    const btns = document.createElement("div");
    btns.className = "mx-btns";
    const m = document.createElement("button");
    m.className = "mx-m"; m.textContent = "M"; m.title = "Mute";
    const s = document.createElement("button");
    s.className = "mx-s"; s.textContent = "S"; s.title = "Solo";
    m.addEventListener("click", () => { A.setMute(id, !A.muted(id)); paintButtons(); });
    s.addEventListener("click", () => { A.setSolo(id, !A.soloed(id)); paintButtons(); });
    btns.appendChild(m); btns.appendChild(s);
    col.appendChild(btns);
    strips.appendChild(col);
  });
  paintButtons();
}
function paintButtons(){
  strips.querySelectorAll(".mx-strip").forEach(col => {
    const id = col.dataset.inst;
    col.querySelector(".mx-m").classList.toggle("mx-on", A.muted(id));
    col.querySelector(".mx-s").classList.toggle("mx-on", A.soloed(id));
    col.classList.toggle("mx-dim", A.anySolo && !A.soloed(id) && !A.audible(id));
  });
}

/* ---- the returns ---- */
const masterKnobs = {};
function buildMaster(){
  const row = $("mxMasterKnobs");
  row.textContent = "";
  saved.__master = saved.__master || {};
  MASTER.forEach(c => {
    const start = typeof saved.__master[c.k] === "number" ? saved.__master[c.k] : c.def;
    const k = knob(c, start, v => { saved.__master[c.k] = v; c.set(v); persist(); });
    row.appendChild(k.el);
    masterKnobs[c.k] = k;
  });
}

/* ---- transport ----
   ⚠️ Borrowed, not reimplemented. live.js already knows that "play all" means clicking each
   panel's own Play so its arm checks and painting happen — a second copy here would drift
   the first time either changed. */
function anyPlaying(){
  return Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id));
}
$("mxPlay").addEventListener("click", () => {
  if (Patchwork.transport) Patchwork.transport.toggleAll();
  setTimeout(paintTransport, 60);
});
function paintTransport(){
  const on = anyPlaying();
  const b = $("mxPlay");
  b.textContent = on ? "■ Stop all" : "▶ Play all";
  b.classList.toggle("st-on", on);
  $("mxBpm").textContent = Patchwork.clock.bpm;
}
/* ⚠️ Repaint immediately, not on the next poll. The half-second tick would catch up on its
   own, but a tempo readout that lags the button you just pressed reads as the button having
   missed — so you press it again, and now you are two BPM out. */
function nudgeBpm(d){ Patchwork.clock.setBpm(Patchwork.clock.bpm + d); paintTransport(); }
$("mxUp").addEventListener("click", () => nudgeBpm(1));
$("mxDown").addEventListener("click", () => nudgeBpm(-1));
/* the tempo can also change from the Live page or a jam partner, hence the poll as well */
if (Patchwork.clock.onTempo) Patchwork.clock.onTempo("console", () => paintTransport(), null);

$("mxFlat").addEventListener("click", () => {
  knobs.forEach(mine => Object.keys(mine).forEach(k => mine[k].reset()));
  /* the master goes back to its measured-safe default too — "zero the desk" that leaves the
     output somewhere hot is not a reset */
  const f = $("mxMasterFader");
  if (f){
    f.value = String(Math.round(A.masterDefault * 100));
    f.dispatchEvent(new Event("input", {bubbles: true}));
  }
  paintButtons();
});

/* ---- the meter bridge ----
   ⚠️ REAL VU BALLISTICS, not a peak bar. A VU meter integrates over about 300 ms, which is
   the whole reason engineers mixed to them: the needle shows how LOUD something is, not how
   spiky. A meter that snapped to every transient would be a different instrument, and a
   worse one for setting a balance — which is the job this bridge exists to do. Peaks are
   not lost, they get their own lamp. */
const VU_TAU = .3;                   // seconds, the needle's integration time
const DB_FLOOR = -42, SWEEP = 42;    // full left at -42 dBFS, full right at 0
const RED_AT = -12;                  // where the scale turns red
const PEAK_AT = -3, PEAK_HOLD = 900; // and where the lamp catches

function angleFor(db){
  const n = clamp((db - DB_FLOOR) / -DB_FLOOR, 0, 1);
  return -SWEEP + n * SWEEP * 2;
}
function vuSvg(label){
  const P = (a) => {
    const r = a * Math.PI / 180;
    return [(30 + 30 * Math.sin(r)).toFixed(2), (44 - 30 * Math.cos(r)).toFixed(2)];
  };
  const [ax, ay] = P(-SWEEP), [bx, by] = P(SWEEP), [rx, ry] = P(angleFor(RED_AT));
  let ticks = "";
  [-42, -30, -20, -12, -6, 0].forEach(d => {
    const a = angleFor(d), r = a * Math.PI / 180;
    const x1 = 30 + 26.5 * Math.sin(r), y1 = 44 - 26.5 * Math.cos(r);
    const x2 = 30 + 30 * Math.sin(r), y2 = 44 - 30 * Math.cos(r);
    ticks += '<line class="mx-vu-tick" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) +
             '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '"/>';
  });
  return '<svg class="mx-vu" viewBox="0 0 60 34" preserveAspectRatio="none">' +
    '<rect class="mx-vu-face" x="0" y="0" width="60" height="34"/>' +
    '<path class="mx-vu-arc" d="M ' + ax + ' ' + ay + ' A 30 30 0 0 1 ' + bx + ' ' + by + '"/>' +
    '<path class="mx-vu-red" d="M ' + rx + ' ' + ry + ' A 30 30 0 0 1 ' + bx + ' ' + by + '"/>' +
    ticks +
    '<circle class="mx-vu-led" cx="54" cy="5" r="2.2"/>' +
    '<text class="mx-vu-lab" x="30" y="31" text-anchor="middle">' + label + '</text>' +
    '<line class="mx-vu-needle" x1="30" y1="44" x2="30" y2="15"/>' +
  '</svg>';
}

const meters = [];                   // {svg, needle, an, buf, level, peakAt}
function addMeter(host, label, node, channelIndex){
  const holder = document.createElement("div");
  holder.style.flex = channelIndex == null ? "none" : "1";
  holder.style.minWidth = "0";
  holder.innerHTML = vuSvg(label);
  host.appendChild(holder);
  const svg = holder.querySelector(".mx-vu");
  const an = ctxOf().createAnalyser();
  an.fftSize = 1024;
  node.connect(an);
  meters.push({svg, needle: svg.querySelector(".mx-vu-needle"), an,
               buf: new Float32Array(an.fftSize), level: DB_FLOOR, peakAt: 0});
}
function ctxOf(){ return A.context(); }

function buildMeters(){
  const host = $("mxMeters"), mHost = $("mxMasterMeters");
  host.textContent = ""; mHost.textContent = ""; meters.length = 0;
  (Patchwork.roots || []).forEach(r => {
    const id = r.dataset.instrument;
    if (!id) return;
    addMeter(host, niceName(id), A.channel(id).out, 1);
  });
  /* the stereo pair: what is actually going to the tape */
  const ctx = ctxOf();
  const mon = A.monitor();
  const g = ctx.createGain();
  g.channelCount = 2; g.channelCountMode = "explicit"; g.channelInterpretation = "speakers";
  mon.connect(g);
  const sp = ctx.createChannelSplitter(2);
  g.connect(sp);
  const lG = ctx.createGain(), rG = ctx.createGain();
  sp.connect(lG, 0); sp.connect(rG, 1);
  addMeter(mHost, "L", lG, null);
  addMeter(mHost, "R", rG, null);
}

let mRaf = 0, mLast = 0;
function meterFrame(now){
  if (!poll){ mRaf = 0; return; }     // the page is not showing
  mRaf = requestAnimationFrame(meterFrame);
  const dt = mLast ? Math.min(.1, (now - mLast) / 1000) : .016;
  mLast = now;
  const k = 1 - Math.exp(-dt / VU_TAU);
  meters.forEach(m => {
    m.an.getFloatTimeDomainData(m.buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < m.buf.length; i++){
      const v = m.buf[i]; sum += v * v;
      const a = v < 0 ? -v : v; if (a > peak) peak = a;
    }
    const db = 20 * Math.log10(Math.max(Math.sqrt(sum / m.buf.length), 1e-7));
    m.level += (clamp(db, DB_FLOOR, 6) - m.level) * k;
    m.needle.setAttribute("transform",
      "rotate(" + angleFor(m.level).toFixed(2) + " 30 44)");
    if (peak > 0 && 20 * Math.log10(peak) > PEAK_AT) m.peakAt = now;
    m.svg.classList.toggle("mx-hot", now - m.peakAt < PEAK_HOLD);
  });
}

/* ---- the stereo master ----
   Saved like everything else on the desk, but note it writes to the SAME master gain the
   whole app runs through — the Live page and the Studio hear this move too, which is what
   a master fader is. */
function buildMasterFader(){
  const f = $("mxMasterFader"), v = $("mxMasterVal");
  if (!f) return;
  const start = typeof saved.__masterLevel === "number" ? saved.__masterLevel : A.masterDefault;
  f.value = String(Math.round(start * 100));
  v.textContent = f.value;
  A.setMasterLevel(start);
  f.addEventListener("input", () => {
    const g = +f.value / 100;
    A.setMasterLevel(g);
    v.textContent = f.value;
    saved.__masterLevel = g;
    persist();
  });
}

let built = false, poll = 0;
Patchwork.consoleUI = {
  show(){
    if (!built){ buildStrips(); buildMaster(); buildMasterFader(); buildMeters(); built = true; }
    else {
      strips.querySelectorAll(".mx-fader").forEach(f => {
        f.value = String(Math.round(A.level(f.dataset.inst) * 100));
        f.nextSibling.textContent = f.value;
      });
      paintButtons();
    }
    paintTransport();
    if (!poll) poll = setInterval(paintTransport, 500);
    mLast = 0;
    if (!mRaf) mRaf = requestAnimationFrame(meterFrame);
  },
  hide(){ clearInterval(poll); poll = 0; },
};
})();
