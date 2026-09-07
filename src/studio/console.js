
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
  $("mxBpm").textContent = Patchwork.clock.shown;
}
/* ⚠️ Repaint immediately, not on the next poll. The half-second tick would catch up on its
   own, but a tempo readout that lags the button you just pressed reads as the button having
   missed — so you press it again, and now you are two BPM out. */
/* ⚠️ Nudged from the SHOWN tempo, not the exact one. Following a Launchkey's clock at
   119.98, "+1" off the raw value lands on 120.98 and reads 121 — a button that says it
   adds one and adds two. From the rounded figure it always lands where the readout says. */
function nudgeBpm(d){ Patchwork.clock.setBpm(Patchwork.clock.shown + d); paintTransport(); }
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

/* ---- the desk, on a controller ----
   ⚠️ IT OWNS NO AUDIO EITHER, and for the same reason the rest of this file does not: every
   value below is read and written through the knobs and faders already on screen, so a move
   from the encoders is the same move a hand would have made — persisted, painted, and
   recalled by a scene exactly as if you had dragged it.

   Nine controls per strip and eight encoders, so the shape of the banks is forced. Volume
   is the one control you want across ALL the channels at once — it is the mix — so it gets
   a bank of its own with every strip on it. The other eight are per-channel questions, so
   they get a bank per channel, which is also what a strip IS. Then the returns, which
   belong to nobody's channel.

   See shell/surface.js. The mixer is a `page` rather than a panel: it has no MIDI channel
   and is on nobody's focus, and is reached by choosing Mixer on the controller. */
const SHORT = {high:"Hi", mid:"Mid", freq:"Frq", low:"Low",
               comp:"Cmp", rev:"Rev", dly:"Dly", pan:"Pan",
               revRet:"Rev", dlyRet:"Dly", dlyT:"Tim", dlyFb:"Fbk"};
/* "DR·1" is four characters and a middle dot; a legend three letters wide wants DR1. */
const shortName = id => id.toUpperCase().slice(0, 3);

function stripIds(){
  return (Patchwork.roots || []).map(r => r.dataset.instrument).filter(Boolean);
}

/* ⚠️ MASTER IS NOT A STRIP. It has no channel, no EQ and no mute — it is the bus everything
   lands on — so it appears on the volume bank and nowhere else, and the pads have no pad
   for it. Giving it a mute button that quietly did nothing would be worse than not having
   one.

   ⚠️ 1.3, WHICH IS THE FADER'S RANGE AND NOT THE BUS'S. setMasterLevel accepts up to 1.5,
   and scaling the encoder to that put full travel at 1.5 while the fader it drives stopped
   at 1.3 — so the encoder read back 0.87 having been turned to the top, and would have
   crept every time the surface pushed its position. The control on screen is the one with a
   range; this follows it. */
const MASTER_MAX = 1.3;

let surfBank = 0;
function surfBanks(){
  return [{name: "Levels"}]
    .concat(stripIds().map(id => ({name: niceName(id)})))
    .concat([{name: "Returns"}, {name: "Out"}]);
}

/* ---- which way out, from the controller ----
   ⚠️ A BOX WITH NO SCREEN HAS TO BE ABLE TO CHOOSE ITS OWN OUTPUT. On a laptop you change
   the output in the OS and this page never needed to know; on a Raspberry Pi that boots into
   the rack there is no OS to change it in, and the difference between the headphone jack and
   a USB interface is the difference between a synth and a brick. So the last bank on the
   mixer is the output device, and it is a list under an encoder like any other.

   ⚠️ ENUMERATION IS ASYNCHRONOUS AND CONTROLS ARE READ SYNCHRONOUSLY, which is the whole
   awkwardness here. The list is refreshed in the background and read from a cache — so the
   first look after boot may be short, and the one after that is right. Refreshed whenever
   this bank is asked for, which is exactly when it matters and never otherwise. */
let sinks = [], sinksAt = 0;
function refreshSinks(){
  const now = Date.now();
  if (now - sinksAt < 2000) return;
  sinksAt = now;
  A.outputs().then(list => { sinks = list; }).catch(() => {});
}
function sinkControls(){
  refreshSinks();
  /* "System default" is the empty id, and it is first because it is the answer that works
     on a machine nobody has configured. */
  const list = [{id: "", label: "System default"}].concat(sinks);
  const at = () => {
    const i = list.findIndex(o => o.id === A.sink);
    return i < 0 ? 0 : i;
  };
  const last = Math.max(1, list.length - 1);
  const go = i => {
    const o = list[Math.max(0, Math.min(list.length - 1, i))];
    if (!o || o.id === A.sink) return;
    A.setSink(o.id);
  };
  return [{
    id: "sink", label: "Output", short: "Out", stepped: true,
    /* Device labels are long and the screen is four names wide, so the readout is trimmed
       rather than left to be cut in the middle of a word. */
    text: () => { const o = list[at()]; return o ? o.label.slice(0, 14) : ""; },
    get: () => at() / last,
    set: v => go(Math.round(v * last)),
    nudge: d => go(at() + (d > 0 ? 1 : -1))
  }];
}
function surfBankNow(){ return Math.min(surfBank, surfBanks().length - 1); }

function surfControls(){
  const ids = stripIds(), i = surfBankNow();
  if (i === surfBanks().length - 1) return sinkControls();
  if (i === 0){
    return ids.map(id => ({
      id: "lvl:" + id, label: niceName(id), short: shortName(id),
      get: () => A.level(id),
      set: v => setStripLevel(id, v)
    })).concat([{
      id: "lvl:master", label: "Master", short: "MST",
      get: () => A.masterLevel() / MASTER_MAX,
      set: v => setMasterFader(v * MASTER_MAX)
    }]);
  }
  if (i <= ids.length){
    const id = ids[i - 1], mine = knobs.get(id);
    if (!mine) return [];
    return CONTROLS.map(c => ({
      id: id + ":" + c.k, label: c.lab, short: SHORT[c.k] || c.lab,
      get: () => toNorm(c, mine[c.k].value),
      set: v => mine[c.k].set(fromNorm(c, v))
    }));
  }
  return MASTER.filter(c => masterKnobs[c.k]).map(c => ({
    id: "ret:" + c.k, label: c.lab, short: SHORT[c.k] || c.lab,
    get: () => toNorm(c, masterKnobs[c.k].value),
    set: v => masterKnobs[c.k].set(fromNorm(c, v))
  }));
}

/* The fader on screen is the thing that moves, not the bus underneath it — otherwise the
   desk would show one level and play another until the next rebuild. */
function setStripLevel(id, v){
  const f = strips.querySelector('.mx-fader[data-inst="' + id + '"]');
  if (!f) return A.setLevel(id, v);
  f.value = String(Math.round(Math.max(0, Math.min(1, v)) * 100));
  f.dispatchEvent(new Event("input", {bubbles: true}));
}
function setMasterFader(v){
  const f = $("mxMasterFader");
  if (!f) return A.setMasterLevel(v);
  f.value = String(Math.round(v * 100));
  f.dispatchEvent(new Event("input", {bubbles: true}));
}

/* ---- mute and solo, on the pads ----
   ⚠️ MUTE ON THE BOTTOM ROW, SOLO ABOVE IT, which is the way round every desk on earth
   prints them and the way round this panel's own M and S buttons sit. A grid that reversed
   them would be right once and wrong every time somebody looked away and back.

   Both rows are the same seven channels; the eighth pad in each is dark because there is no
   eighth channel to mute. */
const surfGrid = {
  label: () => "Mute / Solo",
  cells: () => {
    const out = new Array(16).fill(null);
    stripIds().slice(0, 8).forEach((id, i) => {
      out[i] = {colour: "red", on: A.muted(id)};
      out[i + 8] = {colour: "yellow", on: A.soloed(id)};
    });
    return out;
  },
  down: cell => {
    const ids = stripIds();
    const id = ids[cell % 8];
    if (!id || cell % 8 >= ids.length) return;
    /* The panel's own buttons, so whatever a click does happens here too. */
    const col = strips.querySelector('.mx-strip[data-inst="' + id + '"]');
    const b = col && col.querySelector(cell < 8 ? ".mx-m" : ".mx-s");
    if (b) b.click();
  }
};

if (window.Patchwork && Patchwork.surface){
  Patchwork.surface.mount("mixer", {
    name: "Mixer",
    controls: surfControls,
    controlBanks: surfBanks,
    controlBank: surfBankNow,
    setControlBank: i => { surfBank = Math.max(0, Math.min(surfBanks().length - 1, i)); },
    grid: surfGrid,
    /* ⚠️ ROLLING TAPE, NOT CAPTURING A SCENE. A take is added; nothing is overwritten, and
       Erase is the deck's own control and asks twice. Pressed through the deck's button so
       the reels, the meters and the tab's record light all do what they already do. */
    record: () => { const b = document.getElementById("tpRec"); if (b) b.click(); },
    get armed(){ return !!(Patchwork.tape && Patchwork.tape.armed); },
    /* ⚠️ ARMED MEANS PLAY STARTS THE BAND; NOT ARMED MEANS IT STARTS THE TAPE. On this page
       those are the two things Play could possibly mean, and which one you want is never
       ambiguous — it is written on the record button. Armed, you are about to make a take
       and the deck rolls with the rack anyway; not armed, you are listening back. `alt` is
       Func and always means the other one, so neither is ever out of reach.

       Both go through the panel's own buttons. ⚠️ Tape playback TOGGLES here although the
       deck's Play does not, because the deck has a Stop beside it and the controller has one
       button for the pair — a surface button that starts a thing and cannot stop it is one
       you have to leave the controller to undo. */
    transport: alt => {
      const T = Patchwork.tape;
      /* ⚠️ A TAKE IN PROGRESS STILL COUNTS AS ARMED, and leaving that out was a trap you
         fell into on the second press rather than the first. record() spends the arm the
         moment it fires — it has to, or the next Play would start a second take — so keying
         Play's meaning on `armed` alone flipped it underneath you: the press that STARTED
         the take was the band, and the very next press was the tape. Which stopped the tape,
         left the rack running, and offered nothing on this page that would stop it.

         What the rule is really about is whether you are making a take, and you are making
         one for as long as it is rolling. */
      const taking = !!(T && (T.armed || T.state === "rec"));
      const wantTape = T ? (taking ? !!alt : !alt) : false;
      if (!wantTape){
        if (Patchwork.transport) Patchwork.transport.toggleAll();
        return;
      }
      if (T.state === "play" || T.state === "rec"){
        const b = document.getElementById("tpStop");
        if (b) b.click();
        return;
      }
      /* ⚠️ PLAYBACK, NEVER A TAKE — and this is the one place the deck's own Play button
         cannot be used, because when the deck is armed that button ROLLS, and rolling
         truncates the tape at the head. So Func-Play while armed, meaning "let me hear
         that back", would have erased the very thing you asked to hear. T.play() is what
         the button calls anyway once its arm branch is taken out, which is exactly the
         branch being overridden here. */
      T.play();
    },
    get rolling(){
      const T = Patchwork.tape;
      return !!((Patchwork.transport && Patchwork.transport.anyPlaying)
                || (T && (T.state === "play" || T.state === "rec")));
    },
    /* ⚠️ Instant, and it stops first — "back to the top" is a thing you do in order to play
       from there, and arriving still rolling means arriving somewhere else. */
    actionName: "Tape",
    action: () => {
      const T = Patchwork.tape;
      if (!T) return null;
      if (T.state === "play" || T.state === "rec") T.stop();
      T.seek(0);
      return "Start";
    },
    /* ⚠️ SCRUB IS A SEEK, NOT THE DECK'S REWIND. `rewind()` means "wind back to the start"
       and is animated to zero by the panel; this is a position you hold and let go of, in
       both directions, so it moves the head and nothing else. Playback stops first, because
       a deck you can scrub while it plays is one whose counter and audio disagree. */
    scrub: (dir, on, speed) => {
      const T = Patchwork.tape;
      if (!T) return;
      clearInterval(scrubTimer);
      if (!on) return;
      if (T.state === "play" || T.state === "rec") T.stop();
      /* ⚠️ HOW FAST "FAST" IS BELONGS HERE, not to the controller that asked for it — it is
         a fact about the length of a take. Eight times realtime crosses a three-minute reel
         in twenty seconds, which is finding a section; one time is finding a bar within it.
         A single speed made one of those two jobs annoying whichever number was picked. */
      const step = (speed === "slow" ? 0.05 : 0.4) * dir;
      scrubTimer = setInterval(() => {
        const at = T.position + step;
        T.seek(Math.max(0, Math.min(T.recorded, at)) * T.sampleRate);
      }, 50);
    }
  });
}
let scrubTimer = 0;


/* ---- the desk's share of a project ----
   ⚠️ THE SAME `saved` OBJECT THE DESK PERSISTS, replayed through the knobs rather than
   written past them. Assigning it and calling it done would leave every knob drawing its old
   angle over a channel that had already moved, which is the exact split this file exists to
   avoid — see the note at the top about owning no audio. */
if (window.Patchwork && Patchwork.project){
  Patchwork.project.part("mix", {
    /* ⚠️ THE FADERS ARE NOT IN `saved` AND HAD TO BE ASKED FOR SEPARATELY. This file keeps
       the knobs; the LEVEL of a channel is the bus's, read back rather than stored here,
       precisely so the desk and the launcher's faders cannot hold two ideas of it — the note
       on buildStrips() says so. Which means a project that saved `saved` alone saved every
       EQ move and none of the balance, and came back with the mix flat. */
    capture(){
      const levels = {}, mutes = [], solos = [];
      stripIds().forEach(id => {
        levels[id] = A.level(id);
        if (A.muted(id)) mutes.push(id);
        if (A.soloed(id)) solos.push(id);
      });
      return {desk: saved, levels, mutes, solos};
    },
    apply(p){
      if (!p) return;
      const desk = p.desk || p;                 // a project saved before levels existed
      Object.keys(desk).forEach(k => { saved[k] = desk[k]; });
      /* ⚠️ Levels BEFORE the rebuild, because building a strip reads its fader position off
         the bus — set them after and every fader would draw where it used to be. */
      stripIds().forEach(id => {
        if (p.levels && typeof p.levels[id] === "number") A.setLevel(id, p.levels[id]);
        if (p.mutes) A.setMute(id, p.mutes.indexOf(id) >= 0);
        if (p.solos) A.setSolo(id, p.solos.indexOf(id) >= 0);
      });
      /* Rebuilding is how the desk reads `saved` — every knob starts from it. */
      buildStrips();
      buildMaster();
      buildMasterFader();
      persist();
    }
  });
}

})();
