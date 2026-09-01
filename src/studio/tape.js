
/* ---- the deck ----
   Draws TP·1 and drives it. The transport itself is Patchwork.tape; everything here is the
   picture of it: two reels whose sizes and speeds follow the tape, a counter off the audio
   clock, and a pair of meters. */
(() => {
"use strict";
const T = Patchwork.tape;
const $ = id => document.getElementById(id);
const view = $("stTape");
if (!view || !T) return;

const HUB = 26, FULL = 72, SUP = 128, TAKE = 392, CY = 96;
/* SVG units a second. Chosen by eye: a full reel turns about 3.5 times a minute and an
   empty one about three times that, which is the difference you actually see on a deck. */
const SPEED = 130;
const REW = 14;                     // rewind runs at 14×, and backwards

const path = $("tpPath");
const counter = $("tpCounter"), left = $("tpLeft");
const used = $("tpUsed"), headMark = $("tpHead");
const vuL = $("tpVuL"), vuR = $("tpVuR");
const bRec = $("tpRec"), bPlay = $("tpPlay"), bStop = $("tpStop"), bRew = $("tpRew");
const bSave = $("tpSave"), bErase = $("tpErase"), lvl = $("tpLevel"), note = $("tpNote");
const recLvl = $("tpRecLevel"), clip = $("tpClip"), bKeep = $("tpKeep");
const nameIn = $("tpName");
const supply = $("tpSupply"), take = $("tpTake"), dot = $("tpDot");
const supplyPack = supply.querySelector(".tp-pack"), takePack = take.querySelector(".tp-pack");
const supplySpokes = $("tpSupplySpokes"), takeSpokes = $("tpTakeSpokes");

/* Three arms from hub to rim — the reel's own spokes, and the only thing that shows it
   turning. Rectangles rather than circles-in-the-hub: they have to be readable while you
   are looking at something else, which is most of the time this deck is running. */
function spokes(g, cx){
  const NS = "http://www.w3.org/2000/svg";
  for (let i = 0; i < 3; i++){
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", (cx - 4).toFixed(2));
    r.setAttribute("y", (CY - FULL + 3).toFixed(2));
    r.setAttribute("width", "8");
    r.setAttribute("height", (FULL - HUB + 4).toFixed(2));
    r.setAttribute("rx", "3");
    r.setAttribute("transform", "rotate(" + (i * 120) + " " + cx + " " + CY + ")");
    g.appendChild(r);
  }
}
spokes(supplySpokes, SUP);
spokes(takeSpokes, TAKE);

/* ⚠️ RADIUS BY AREA, NOT BY LENGTH. Tape wound on a reel fills an annulus, so the pack's
   radius goes as the square root of how much is on it — wound linearly the take-up reel
   shoots out to full size in the first thirty seconds and then barely moves, which reads
   as broken rather than as a reel. */
function radius(frac){
  return Math.sqrt(HUB * HUB + (FULL * FULL - HUB * HUB) * Math.max(0, Math.min(1, frac)));
}

let angS = 0, angT = 0, last = 0, rewFrom = 0, rewAt = 0;

/* Tangent off each pack down to its roller, then straight across the head block. Both ends
   move as the packs change size, which is the detail that makes it look threaded rather
   than drawn on. */
function ribbon(rs, rt){
  const sx = SUP + rs * .70, sy = CY + rs * .71;
  const tx = TAKE - rt * .70, ty = CY + rt * .71;
  return "M " + sx.toFixed(1) + " " + sy.toFixed(1) +
         " L 206 162 L 314 162 L " + tx.toFixed(1) + " " + ty.toFixed(1);
}

function clock(sec){
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}

/* ---- meters ----
   Fed from both ends: the bus, so you can set a level before pressing record, and the repro
   head, so a take you are playing back moves them too. */
let an = null;
function meters(){
  if (an) return an;
  const ctx = Patchwork.audio.context();
  const sum = ctx.createGain(); sum.gain.value = 1;
  /* ⚠️ FORCE TWO CHANNELS BEFORE THE SPLITTER. A ChannelSplitter interprets its input as
     discrete, so a mono source lands entirely on channel 0 and the R meter sits dead while
     the tape itself is recording that signal to both sides. That is a broken meter, not a
     broken mix, and it looks exactly like the latter. */
  sum.channelCount = 2;
  sum.channelCountMode = "explicit";
  sum.channelInterpretation = "speakers";
  /* ⚠️ Metered AFTER the record level, not before. These are the RECORD meters: what they
     show has to be the thing the slider under them moves, or the one control that fixes a
     clipping take is the one control the meters cannot see. The repro head is summed in as
     well so a take being played back moves them too. */
  const point = T.meterPoint || Patchwork.audio.monitor();
  point.connect(sum);
  if (T.repro) T.repro.connect(sum);
  const sp = ctx.createChannelSplitter(2);
  sum.connect(sp);
  const mk = () => { const a = ctx.createAnalyser(); a.fftSize = 1024; return a; };
  const L = mk(), R = mk();
  sp.connect(L, 0); sp.connect(R, 1);
  an = {L, R, bufL: new Float32Array(L.fftSize), bufR: new Float32Array(R.fftSize), sum};
  return an;
}
let pkL = 0, pkR = 0;
function peak(a, buf){
  a.getFloatTimeDomainData(buf);
  let m = 0;
  for (let i = 0; i < buf.length; i++){ const v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > m) m = v; }
  return m;
}
/* dBFS across the last 48 dB, because a linear meter spends its whole length in the top
   6 dB and says nothing about the quiet half of a mix. */
function meterWidth(v){
  if (v <= 0.0001) return 0;
  const db = 20 * Math.log10(v);
  return Math.max(0, Math.min(100, (db + 48) / 48 * 100));
}

function paintTransport(){
  const st = T.state;
  bRec.classList.toggle("tp-on", st === "rec");
  bPlay.classList.toggle("tp-on", st === "play");
  bRew.classList.toggle("tp-on", st === "rew");
  view.classList.toggle("tp-recording", st === "rec");
  if (dot) dot.hidden = st !== "rec";
  if (clip) clip.hidden = !T.clipped;
  view.classList.toggle("tp-playing", st === "play");
  bRec.setAttribute("aria-pressed", st === "rec" ? "true" : "false");
  const has = T.recorded > 0.05;
  bSave.disabled = !has || st === "rec";
  if (bKeep) bKeep.disabled = !has || st === "rec";
  bErase.disabled = !has || st === "rec";
  bPlay.disabled = !has;
}
T.onChange(paintTransport);

let raf = 0, open = false;
function frame(now){
  if (!open){ raf = 0; return; }
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min(.1, (now - last) / 1000) : 0;
  last = now;

  const st = T.state;
  let pos = T.position;
  if (st === "rew"){
    /* Rewind is drawn here rather than being a thing the engine counts, because it is
       entirely a picture: nothing is being read off the tape while it spools back. */
    pos = Math.max(0, rewFrom - (performance.now() - rewAt) / 1000 * REW);
    T.seek(pos * T.sampleRate);
    if (pos <= 0){ T.rewindDone(); }
  }
  const reel = T.reelSeconds;
  const f = Math.max(0, Math.min(1, pos / reel));
  const rs = radius(1 - f), rt = radius(f);
  supplyPack.setAttribute("r", rs.toFixed(2));
  takePack.setAttribute("r", rt.toFixed(2));
  path.setAttribute("d", ribbon(rs, rt));

  /* ⚠️ CONSTANT LINEAR SPEED, so each reel's angular rate is the tape speed over its own
     radius. That is the whole reason a real deck looks alive: the two reels are visibly
     turning at different speeds and the difference reverses over the course of a take.
     Spinning both at one rate looks like a screensaver. */
  const moving = st === "rec" || st === "play" ? 1 : (st === "rew" ? -REW : 0);
  if (moving && dt){
    angS += (SPEED * moving / rs) * dt * 180 / Math.PI;
    angT += (SPEED * moving / rt) * dt * 180 / Math.PI;
  }
  supplySpokes.setAttribute("transform", "rotate(" + (angS % 360).toFixed(2) + " " + SUP + " " + CY + ")");
  takeSpokes.setAttribute("transform", "rotate(" + (angT % 360).toFixed(2) + " " + TAKE + " " + CY + ")");

  counter.textContent = clock(pos);
  const rec = T.recorded;
  used.style.width = (rec / reel * 100).toFixed(2) + "%";
  headMark.style.left = (f * 100).toFixed(2) + "%";
  const rem = Math.max(0, reel - rec);
  left.textContent = Math.floor(rem / 60) + ":" + String(Math.round(rem % 60)).padStart(2, "0") + " left";

  if (an){
    /* Falls at about 30 dB a second and jumps instantly — a meter that decays as slowly as
       it rises never shows you a transient, and one with no decay at all is unreadable. */
    const l = peak(an.L, an.bufL), r = peak(an.R, an.bufR);
    const fall = Math.pow(.06, dt || .016);
    pkL = Math.max(l, pkL * fall);
    pkR = Math.max(r, pkR * fall);
    vuL.style.width = meterWidth(pkL).toFixed(1) + "%";
    vuR.style.width = meterWidth(pkR).toFixed(1) + "%";
  }
}

/* ---- buttons ---- */
bRec.addEventListener("click", () => {
  if (T.state === "rec") T.stop();
  else { T.record().then(() => { meters(); }); }
});
bPlay.addEventListener("click", () => { T.play().then(() => meters()); });
bStop.addEventListener("click", () => T.stop());
bRew.addEventListener("click", () => {
  if (T.state === "rew"){ T.rewindDone(); return; }
  rewFrom = T.position; rewAt = performance.now();
  T.rewind();
});
lvl.addEventListener("input", () => T.setLevel(lvl.value / 100));
recLvl.addEventListener("input", () => T.setRecLevel(recLvl.value / 100));

/* ⚠️ Erase arms first. Everything else on this deck is recoverable by pressing something
   else; this is the one control that throws away a take with nothing behind it. Four
   seconds, and it disarms on blur, so a half-pressed Erase cannot sit waiting. */
let armed = 0, armTimer = 0;
function disarm(){ armed = 0; clearTimeout(armTimer); bErase.textContent = "Erase"; bErase.classList.remove("tp-arm"); }
bErase.addEventListener("click", () => {
  if (!armed){
    armed = 1; bErase.textContent = "Sure?"; bErase.classList.add("tp-arm");
    armTimer = setTimeout(disarm, 4000);
    return;
  }
  disarm();
  T.erase();
});
bErase.addEventListener("blur", disarm);

/* ⚠️ NAMED WITHOUT ASKING. A modal here lands in the two seconds after a take you liked,
   which is the worst possible moment to make someone type — the tape gets a number and can
   be renamed on the shelf, exactly like writing on a cassette afterwards.

   ⚠️ NUMBERED, NOT DATED. A timestamp to the minute gives two takes cut in the same minute
   the same label, which is precisely when you most need to tell them apart. The shelf
   already prints the date under the name. Counts from the highest number in use rather than
   from how many there are, so deleting Take 2 does not make the next one collide. */
if (bKeep) bKeep.addEventListener("click", async () => {
  const blob = T.wav();
  if (!blob || !Patchwork.library) return;
  let n = 0;
  try{
    (await Patchwork.library.list()).forEach(t => {
      const m = /^Take (\d+)$/.exec(t.name || "");
      if (m) n = Math.max(n, +m[1]);
    });
  }catch(e){}
  const typed = nameIn ? nameIn.value.trim() : "";
  const name = typed || ("Take " + (n + 1));
  const was = bKeep.textContent;
  bKeep.disabled = true;
  try{
    await Patchwork.library.save(name, blob, {seconds: T.recorded, rate: T.sampleRate,
      owner: (Patchwork.cloud && Patchwork.cloud.uid) || "",
      artist: (Patchwork.cloud && Patchwork.cloud.signedIn) ? Patchwork.cloud.displayName : ""});
    if (nameIn) nameIn.value = "";
    bKeep.textContent = "Saved \u2713";
  }catch(e){
    bKeep.textContent = "Couldn't save";
    if (note) note.textContent = e && e.message ? e.message : "The library would not take it.";
  }
  setTimeout(() => { bKeep.textContent = was; paintTransport(); }, 1800);
});

bSave.addEventListener("click", () => {
  const blob = T.wav();
  if (!blob) return;
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  const name = "jam-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
               "-" + p(d.getHours()) + p(d.getMinutes()) + ".wav";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});

/* The view switch calls these. The paint loop only runs while the deck is on screen —
   spinning reels nobody is looking at is a repaint every frame for nothing. */
Patchwork.tapeUI = {
  show(){
    open = true; last = 0;
    /* ⚠️ Loading the worklet here rather than on the first press, exactly as the punch rack
       primes when the Live page opens: the first take is the one worth not losing to a
       module that had not finished loading. */
    T.prime().then(() => { meters(); }).catch(() => {});
    paintTransport();
    if (!raf) raf = requestAnimationFrame(frame);
  },
  hide(){ open = false; }
};
})();
