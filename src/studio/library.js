
/* ---- the library ----
   The shelf, the deck, and the drag between them. Tapes come from Patchwork.library; the
   audio is decoded here and played straight to the speakers.

   ⚠️ PLAYBACK BYPASSES THE MASTER BUS, for the same reason TP·1's repro head does: a tape
   monitored through the bus it was recorded from is one the recorder would happily print
   onto itself, with the punch rack applied a second time. Listening is not performing. */
(() => {
"use strict";
const view = document.querySelector("#stLib");
const LIB = Patchwork.library;
if (!view || !LIB) return;
const $ = id => document.getElementById(id);

const shelf = $("libShelf"), empty = $("libEmpty"), note = $("libNote");
const slot = $("libSlot"), deck = $("libDeck"), nowEl = $("libNow");
const platter = $("libPlatter"), bed = $("libBed"), arm = $("libArm");
const tray = $("libTray"), well = $("libWell");
const fmtSeg = $("libFmt"), rackTitle = $("libRackTitle"), deckName = $("libDeckName");
const bPlay = $("libPlay"), bStop = $("libStop"), bEject = $("libEject");
const timeEl = $("libTime"), bar = $("libBar");
const cones = [$("libWooferL"), $("libWooferR")];
const cloudBar = $("libCloud"), cloudState = $("libCloudState"), cloudMsg = $("libCloudMsg");
const signInForm = $("libSignIn"), emailIn = $("libEmail"), bGoogle = $("libGoogle");
const bSync = $("libSync"), bOut = $("libOut");
const whoWrap = $("libWhoWrap"), whoIn = $("libWho");
const tweets = [$("libTweetL"), $("libTweetR")];

/* ⚠️ ONE LIBRARY, TWO MACHINES. The stored item is just audio — nothing about it is a
   cassette or a record — so this is purely how it is drawn and which stage it drops onto.
   Switching format must never touch what is saved. */
const FMT_KEY = "patchwork-library-format";
let fmt = "tape";
try{ const v = localStorage.getItem(FMT_KEY); if (v === "vinyl" || v === "tape" || v === "cd") fmt = v; }catch(e){}
const vinyl = () => fmt === "vinyl";
const cd = () => fmt === "cd";
const stage = () => cd() ? tray : (vinyl() ? platter : slot);
/* where a loaded item actually sits inside its stage */
const cradle = () => cd() ? well : (vinyl() ? bed : slot);

/* ⚠️ Object URLs are REVOKED on every re-render. One per sleeve per render leaks a blob
   each time the shelf redraws, which on a page that redraws whenever anything changes adds
   up to the whole library held twice over and then again. */
const artUrls = new Map();
function artUrl(id, blob){
  const had = artUrls.get(id);
  if (had) URL.revokeObjectURL(had);
  const u = URL.createObjectURL(blob);
  artUrls.set(id, u);
  return u;
}
/* ⚠️ NEVER SWEEP THE URL THE DECK IS USING. insert() builds the loaded item — which takes
   an object URL for its art — and then calls render(), which used to revoke every URL in
   the map including that one. The element kept its `url(blob:…)` and computed perfectly;
   the blob behind it was simply gone, so artwork on the platter and the spindle silently
   rendered as nothing while every style property said it was fine. render() skips drawing
   the loaded item, so its URL is never recreated either — it has to be kept, not rebuilt. */
function dropArtUrls(keep){
  artUrls.forEach((u, id) => {
    if (id === keep) return;
    URL.revokeObjectURL(u);
    artUrls.delete(id);
  });
}

let tapes = [];                      // the merged shelf: mine, and everyone else's
let remoteTapes = [], remoteAt = 0;
/* ⚠️ THE REMOTE LIST IS CACHED, and it has to be. Building it costs a root listing, one
   listing per person, and one small GET per take — so a shelf of a hundred takes is a
   hundred-odd requests. Rebuilt on every view switch that is a slow Library tab and a
   steady drain on the egress allowance, for a list that changes when somebody records
   something, which is not often. Sync forces it. */
const REMOTE_TTL = 60000;
let loaded = null;                   // {meta, el, buffer}
let src = null, gain = null, an = null, freq = null;
let playAt = 0, playFrom = 0, playing = false;
let raf = 0, open = false;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function clock(s){
  s = Math.max(0, s|0);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/* ---- drawing a cassette ---- */
/* ⚠️ The PACK is the animation at this size, not the spin. A 22px hub turning is nearly
   invisible; a pack visibly draining from one side to the other is not. The splines still
   turn, but they are the detail rather than the signal. Wound to the start by default —
   a cassette on a shelf reads full on the left, empty on the right. */
function hubSvg(full){
  return '<svg class="lib-hub" viewBox="0 0 24 24">' +
           '<circle class="hp" cx="12" cy="12" r="' + (full ? 11 : 5.2) + '"/>' +
           '<circle class="hh" cx="12" cy="12" r="5"/>' +
           '<g class="ha-g">' +
             '<rect class="ha" x="11.2" y="4.2" width="1.6" height="3.4" rx=".7"/>' +
             '<rect class="ha" x="11.2" y="4.2" width="1.6" height="3.4" rx=".7" transform="rotate(120 12 12)"/>' +
             '<rect class="ha" x="11.2" y="4.2" width="1.6" height="3.4" rx=".7" transform="rotate(240 12 12)"/>' +
           '</g>' +
         '</svg>';
}
/* A record: sleeve on the shelf, disc on the platter. Same data, same id, same colour. */
function record(t){
  const el = document.createElement("div");
  el.className = "lib-rec";
  el.dataset.id = t.id;
  el.dataset.c = t.colour == null ? 0 : t.colour;
  if (t.art) el.style.setProperty("--art", "url(" + artUrl(t.id, t.art) + ")");
  el.classList.toggle("lib-art", !!t.art);
  el.innerHTML =
    '<span class="lib-rec-name"' + (t.mine ? ' title="double-click to rename"' : '') + '>' +
      esc(t.name) + '</span>' +
    '<span class="lib-rec-sub">' + esc(subtitle(t)) + '</span>' +
    '<div class="lib-disc-label"></div>' +
    (t.mine ? artBtn("Sleeve art — click to pick an image, or drop one on the sleeve") : '') +
    (t.synced || t.remote ? '<span class="lib-tape-cloud" title="In the shared library">☁</span>' : '') +
    (t.mine ? '<button class="lib-tape-x" title="Delete this recording">×</button>' : '');
  return el;
}
/* A disc: a jewel case on the shelf, the disc itself on the spindle. */
function disc(t){
  const el = document.createElement("div");
  el.className = "lib-cd";
  el.dataset.id = t.id;
  el.dataset.c = t.colour == null ? 0 : t.colour;
  if (t.art) el.style.setProperty("--art", "url(" + artUrl(t.id, t.art) + ")");
  el.classList.toggle("lib-art", !!t.art);
  el.innerHTML =
    '<span class="lib-cd-name"' + (t.mine ? ' title="double-click to rename"' : '') + '>' +
      esc(t.name) + '</span>' +
    '<span class="lib-cd-sub">' + esc(subtitle(t)) + '</span>' +
    '<div class="lib-cd-hole"></div>' +
    (t.mine ? artBtn("Cover art — click to pick an image, or drop one on the case") : '') +
    (t.synced || t.remote ? '<span class="lib-tape-cloud" title="In the shared library">☁</span>' : '') +
    (t.mine ? '<button class="lib-tape-x" title="Delete this recording">×</button>' : '');
  return el;
}
function item(t){ return cd() ? disc(t) : (vinyl() ? record(t) : cassette(t)); }

function cassette(t){
  const el = document.createElement("div");
  el.className = "lib-tape";
  el.dataset.id = t.id;
  el.dataset.c = t.colour == null ? 0 : t.colour;
  el.innerHTML =
    '<div class="lib-label">' +
      '<span class="lib-label-name"' + (t.mine ? ' title="double-click to rename"' : '') + '>' +
        esc(t.name) + '</span>' +
      '<span class="lib-label-sub">' + esc(subtitle(t)) + '</span>' +
    '</div>' +
    '<div class="lib-win">' + hubSvg(true) + hubSvg(false) + '</div>' +
    (t.synced || t.remote ? '<span class="lib-tape-cloud" title="In the shared library">☁</span>' : '') +
    (t.mine ? '<button class="lib-tape-x" title="Delete this tape">×</button>' : '');
  return el;
}
/* Whose take it is comes FIRST on a shared shelf. Length and date are the same for
   everything on it; the name of the person who played it is the thing you are scanning for. */
function subtitle(t){
  const when = new Date(t.made);
  const date = when.toLocaleDateString(undefined, {month: "short", day: "numeric"});
  const who = t.mine ? "you" : (t.artist || "someone");
  return who + " · " + clock(t.seconds) + " · " + date;
}
function artBtn(title){
  return '<button class="lib-art-btn" title="' + title + '">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<rect x="1.6" y="3" width="12.8" height="10" rx="1.4"/>' +
      '<circle class="pk" cx="5.4" cy="6.4" r="1.25"/>' +
      '<path class="pk" d="M2.6 12.4 L6.4 8.6 L8.7 10.9 L11.2 8.4 L13.4 10.6 L13.4 12.4 Z"/>' +
    '</svg></button>';
}
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ⚠️ THE SHELF IS A MERGE, and the audio is not part of it. What is held locally and what
   is on the shared shelf are two different lists keyed by the same ids: a take can be here
   only (recorded, not yet shared), both (yours, uploaded), or there only (someone else's,
   or yours from another machine). Only the third needs fetching, and only when played. */
async function refresh(){
  let local = [];
  try{ local = await LIB.list(); }
  catch(e){
    note.textContent = "The library would not open — " + (e && e.message ? e.message : "storage is blocked.");
    return;
  }
  if (C && C.signedIn && member !== false){
    if (Date.now() - remoteAt > REMOTE_TTL){
      try{ remoteTapes = await C.list(); remoteAt = Date.now(); }
      catch(e){ /* offline is not an error here — the local shelf still works */ }
    }
  } else { remoteTapes = []; remoteAt = 0; }

  const byId = new Map();
  local.forEach(t => byId.set(t.id, Object.assign({}, t, {
    local: true, remote: false,
    /* a take with no owner recorded is one made on this machine before anyone signed in */
    mine: !t.owner || !C || !C.uid || t.owner === C.uid,
    artist: t.artist || "",
  })));
  remoteTapes.forEach(r => {
    const ex = byId.get(r.id);
    if (ex) Object.assign(ex, {remote: true, artist: r.artist, owner: r.owner, mine: r.mine,
                              hasArt: r.hasArt});
    else byId.set(r.id, Object.assign({}, r, {local: false, remote: true}));
  });
  tapes = [...byId.values()].sort((a, b) => b.made - a.made);
}

async function render(){
  await refresh();
  const keep = loaded ? loaded.meta.id : null;
  /* ⚠️ Forget any armed delete. The shelf redraws on sync, on a rename, on a format switch
     — and the rebuilt button loses its "sure?" styling while `armed` still held the id, so
     the NEXT single click deleted a take with no confirmation at all. */
  disarm();
  dropArtUrls(keep);
  shelf.textContent = "";
  tapes.forEach(t => { if (t.id !== keep) shelf.appendChild(item(t)); });
  empty.hidden = tapes.length > 0;
  /* only where art is actually shown — a cassette gets a written label, as it did */
  const hint = $("libHint");
  if (hint) hint.hidden = !tapes.some(t => t.mine) || (!vinyl() && !cd());
  const mine = tapes.filter(t => t.mine).length;
  const word = cd() ? "discs" : vinyl() ? "records" : "tapes";
  note.textContent = tapes.length
    ? tapes.length + " " + word + (tapes.length > mine ? " · " + mine + " yours" : "")
    : "";
}
LIB.onChange(() => { if (open) render(); });

/* ---- the drag ----
   Pointer events rather than HTML5 drag-and-drop: a dragged cassette has to be visible,
   rotated, and hit-tested against the deck, and the native API gives a browser-drawn ghost
   and no control over any of it. It also gets touch for free. */
let drag = null;
shelf.addEventListener("pointerdown", e => {
  const el = e.target.closest(".lib-tape, .lib-rec, .lib-cd");
  if (!el || e.button) return;
  /* ⚠️ EVERY control on the item has to be excluded HERE, not just in the click handler.
     Starting a drag calls setPointerCapture, and capture RETARGETS the click that follows to
     the captured sleeve — so the click handler's own `.lib-art-btn` guard never matched and
     pressing the art button dropped the record onto the platter instead. A synthetic
     .click() skips pointerdown entirely and looks fine, which is exactly how this got
     through the first time. */
  if (e.target.closest(".lib-tape-x, .lib-art-btn")) return;
  if (e.target.isContentEditable) return;
  const r = el.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "lib-ghost";
  ghost.style.height = r.height + "px";
  if (vinyl() || cd()) ghost.style.aspectRatio = "1/1";
  el.after(ghost);
  drag = {el, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, from: r, moved: false};
  el.classList.add("lib-drag");
  el.style.left = r.left + "px";
  el.style.top = r.top + "px";
  el.setPointerCapture(e.pointerId);
  e.preventDefault();
});
shelf.addEventListener("pointermove", e => {
  if (!drag) return;
  drag.moved = true;
  drag.el.style.left = (e.clientX - drag.dx) + "px";
  drag.el.style.top = (e.clientY - drag.dy) + "px";
  stage().classList.toggle("lib-over", overStage(e.clientX, e.clientY));
});
shelf.addEventListener("pointerup", e => {
  if (!drag) return;
  const d = drag; drag = null;
  stage().classList.remove("lib-over");
  const hit = d.moved && overStage(e.clientX, e.clientY);
  if (hit){
    /* fly it home, then load once it lands */
    const s = cradle().getBoundingClientRect();
    const round = vinyl() || cd();
    d.el.classList.add("lib-flying");
    d.el.style.left = (round ? s.left + (s.width - 132) / 2 : s.left + 4) + "px";
    d.el.style.top = (round ? s.top + (s.height - 132) / 2 : s.top + 4) + "px";
    d.el.style.transform = "rotate(0deg) scale(.98)";
    setTimeout(() => { d.ghost.remove(); insert(d.el.dataset.id); }, 290);
    return;
  }
  /* nothing under it — put it back where it came from */
  d.el.classList.add("lib-flying");
  d.el.style.left = d.from.left + "px";
  d.el.style.top = d.from.top + "px";
  d.el.style.transform = "rotate(0deg) scale(1)";
  setTimeout(() => {
    d.el.classList.remove("lib-drag", "lib-flying");
    d.el.style.cssText = "";
    d.ghost.remove();
  }, 290);
});
function overStage(x, y){
  const r = cradle().getBoundingClientRect();
  if (!vinyl() && !cd()) return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  /* platter and spindle are round, so hit-test the circle rather than its bounding box */
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return Math.hypot(x - cx, y - cy) <= r.width / 2 + 12;
}
/* Clicking a cassette loads it too. The drag is the fun way; this is the way you actually
   want on the fifth listen, and on a phone where dragging across a room is a nuisance. */
shelf.addEventListener("click", e => {
  const el = e.target.closest(".lib-tape, .lib-rec, .lib-cd");
  /* every control that lives ON an item has to be excluded here, or pressing it also
     drops the thing into the deck */
  if (!el || e.target.closest(".lib-tape-x, .lib-art-btn") || e.target.isContentEditable) return;
  if (drag) return;
  insert(el.dataset.id);
});

/* ---- loading and playing ---- */
async function insert(id){
  const meta = tapes.find(t => t.id === id);
  if (!meta) { render(); return; }
  eject(true);
  const el = item(meta);
  /* the loaded copy is built from the same record, so it carries the same art onto the
     platter or the spindle without a second lookup */
  el.classList.add(cd() ? "lib-onspindle" : (vinyl() ? "lib-onplatter" : "lib-inslot"));
  cradle().appendChild(el);
  stage().classList.add("lib-loaded");
  nowEl.textContent = meta.name;
  loaded = {meta, el, buffer: null};
  bEject.disabled = false;
  bPlay.disabled = true;
  timeEl.textContent = "0:00";
  bar.style.width = "0%";
  render();
  try{
    let blob = null;
    const rec = await LIB.get(id);
    if (rec) blob = rec.wav;
    else if (meta.remote && C && C.signedIn){
      /* ⚠️ FETCHED HERE, NOT AT SYNC. Downloading everybody's audio onto everybody's
         machine turns a shared shelf into a broadcast — a hundred takes is half a gigabyte
         each, for music most people will never press play on. The shelf carries names;
         the audio arrives when someone actually wants to hear it, and is then kept. */
      nowEl.textContent = meta.name + " — fetching…";
      blob = await C.getAudio(meta.owner, id);
      let art = null;
      if (meta.hasArt) try{ art = await C.getArt(meta.owner, id); }catch(e){}
      await LIB.save(meta.name, blob, {id, made: meta.made, seconds: meta.seconds,
                                       colour: meta.colour, rate: 48000,
                                       owner: meta.owner, artist: meta.artist,
                                       art, synced: Date.now()});
    }
    if (!blob || !loaded || loaded.meta.id !== id) return;
    const ctx = Patchwork.audio.context();
    Patchwork.audio.resume();
    loaded.buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    nowEl.textContent = meta.name;
    bPlay.disabled = false;
    timeEl.textContent = clock(0);
  }catch(e){
    nowEl.textContent = "could not read that tape";
  }
}

/* ---- what the format does to the sound ----
   ⚠️ THE MEDIUM IS THE POINT. A cassette, a record and a CD of the same take are the same
   audio; choosing between them is choosing what the playback chain does to it, and if all
   three sounded identical the format switch would be a costume. So each one gets the
   colouration its medium actually has — and CD gets none at all, which is the whole reason
   CD exists and is worth hearing next to the other two. */
let colour = null;                   // {tape:{in,out}, vinyl:{in,out}, cd:{in,out}, sum}

/* A soft-knee saturation curve. tanh rather than a hard clip: tape compresses into
   distortion gradually, and the gradual part is the sound people mean by "warm". */
function satCurve(ctx, drive){
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return c;
}

/* Surface noise: mostly silence with sparse decaying pops, plus a whisper of hiss. Built
   once as a few seconds of buffer and looped — generating clicks live would mean a worklet
   for something nobody can tell apart from a loop. */
function crackleBuffer(ctx){
  const secs = 6, n = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++){
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.0016;   // surface hiss
    let i = 0;
    while (i < n){
      i += Math.floor(200 + Math.random() * ctx.sampleRate * 0.22);        // to the next pop
      if (i >= n) break;
      /* a pop is a couple of milliseconds of decaying noise, not a single sample — one
         sample is a click you cannot hear over anything */
      const len = Math.floor(ctx.sampleRate * (0.0008 + Math.random() * 0.0035));
      const amp = 0.05 + Math.random() * 0.22;
      for (let k = 0; k < len && i + k < n; k++)
        d[i + k] += (Math.random() * 2 - 1) * amp * Math.pow(1 - k / len, 3);
      i += len;
    }
  }
  return buf;
}

function buildColour(ctx){
  const sum = ctx.createGain(); sum.gain.value = 1;

  /* ---- CD: nothing at all ---- */
  const cdIn = ctx.createGain(); cdIn.gain.value = 1;
  cdIn.connect(sum);

  /* ---- cassette ----
     drive into saturation, a bass bump, the bandwidth a cassette actually has, and a
     delay line wobbled by two LFOs for wow and flutter. */
  const tIn = ctx.createGain(); tIn.gain.value = 1.6;      // into the curve
  const tSat = ctx.createWaveShaper();
  tSat.curve = satCurve(ctx, 2.2); tSat.oversample = "4x";
  /* ⚠️ LEVEL-MATCHED TO CD, and measured to get there. Saturation raises RMS as it squashes
     peaks, so an untrimmed tape chain came out 4.1 dB hotter than the clean one — and a
     format that is merely LOUDER always wins a blind comparison. Matching the levels is what
     makes the difference actually be about character. */
  const tMake = ctx.createGain(); tMake.gain.value = .45;
  const tLow = ctx.createBiquadFilter();
  tLow.type = "lowshelf"; tLow.frequency.value = 110; tLow.gain.value = 2.5;
  const tHi = ctx.createBiquadFilter();
  tHi.type = "lowpass"; tHi.frequency.value = 13000; tHi.Q.value = .7;
  /* ⚠️ Wow and flutter are a MODULATED DELAY, which is how you bend pitch in Web Audio
     without a worklet: moving the read point is moving through the tape. Depths are in
     fractions of a millisecond — a few cents. Anything you can clearly hear as vibrato is
     a broken machine, not a nostalgic one. */
  const tDly = ctx.createDelay(0.05);
  tDly.delayTime.value = .004;
  const wow = ctx.createOscillator(); wow.frequency.value = .7;
  const wowD = ctx.createGain(); wowD.gain.value = .0004;
  const flut = ctx.createOscillator(); flut.frequency.value = 9.3;
  const flutD = ctx.createGain(); flutD.gain.value = .00003;
  wow.connect(wowD); wowD.connect(tDly.delayTime);
  flut.connect(flutD); flutD.connect(tDly.delayTime);
  wow.start(); flut.start();
  tIn.connect(tSat); tSat.connect(tMake); tMake.connect(tLow);
  tLow.connect(tHi); tHi.connect(tDly); tDly.connect(sum);

  /* ---- vinyl ----
     a gentler saturation than tape, a low-mid lift, the top rolled off, and the record
     surface underneath it. */
  const vIn = ctx.createGain(); vIn.gain.value = 1.25;
  const vSat = ctx.createWaveShaper();
  vSat.curve = satCurve(ctx, 1.5); vSat.oversample = "4x";
  const vMake = ctx.createGain(); vMake.gain.value = .58;   /* 3.5 dB, likewise measured */
  const vLow = ctx.createBiquadFilter();
  vLow.type = "lowshelf"; vLow.frequency.value = 200; vLow.gain.value = 1.8;
  const vTop = ctx.createBiquadFilter();
  vTop.type = "highshelf"; vTop.frequency.value = 7500; vTop.gain.value = -3;
  const vLp = ctx.createBiquadFilter();
  vLp.type = "lowpass"; vLp.frequency.value = 16000; vLp.Q.value = .7;
  vIn.connect(vSat); vSat.connect(vMake); vMake.connect(vLow);
  vLow.connect(vTop); vTop.connect(vLp); vLp.connect(sum);

  const crackleGain = ctx.createGain(); crackleGain.gain.value = 0;
  crackleGain.connect(sum);
  /* the mechanical thump of the stylus landing, separate from the surface noise so it can
     be a one-off event rather than part of a loop */
  const thumpGain = ctx.createGain(); thumpGain.gain.value = 0;
  const thumpLp = ctx.createBiquadFilter();
  thumpLp.type = "lowpass"; thumpLp.frequency.value = 220; thumpLp.Q.value = 1.2;
  thumpGain.connect(thumpLp); thumpLp.connect(sum);

  return {sum, cd: cdIn, tape: tIn, vinyl: vIn,
          crackle: {gain: crackleGain, buffer: crackleBuffer(ctx), src: null,
                    thump: thumpGain, thumpBuf: null}};
}

function ensureOut(){
  const ctx = Patchwork.audio.context();
  if (gain) return ctx;
  gain = ctx.createGain(); gain.gain.value = 1;
  colour = buildColour(ctx);
  an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = .72;
  freq = new Uint8Array(an.frequencyBinCount);
  /* the meters watch the sum, so the speakers move to what you are actually hearing —
     crackle included */
  colour.sum.connect(an);
  colour.sum.connect(ctx.destination);
  routeColour();
  return ctx;
}

/* ⚠️ Reconnected rather than gain-mixed. Leaving all three chains fed and muting two means
   a saturator and a delay line running on every playback for nothing — and it means CD is
   only clean if two gain nodes are exactly zero, which is a worse guarantee than not being
   connected at all. */
function routeColour(){
  if (!colour || !gain) return;
  try{ gain.disconnect(); }catch(e){}
  gain.connect(colour[fmt] || colour.cd);
}
/* ⚠️ A NEEDLE DROP, NOT A CONTINUOUS BED. Surface noise held at a constant level for the
   length of a take is exhausting within about thirty seconds — you stop hearing the music
   and start hearing the noise. What people actually remember about vinyl is the moment the
   stylus lands: a thump, a scatter of pops, and then it settles into the groove and gets
   out of the way. So the crackle is an ENVELOPE, loud for a beat and then almost gone. */
function needleDrop(ctx, c){
  const t = ctx.currentTime;
  c.gain.gain.cancelScheduledValues(t);
  c.gain.gain.setValueAtTime(0, t);
  c.gain.gain.linearRampToValueAtTime(.5, t + .035);   // touchdown
  c.gain.gain.setValueAtTime(.5, t + .17);             // finding the groove
  /* settles exponentially to a whisper — present if you listen for it, gone if you are
     listening to the music */
  c.gain.gain.setTargetAtTime(.022, t + .17, .42);

  if (!c.thumpBuf){
    const n = Math.floor(ctx.sampleRate * .18);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5);
    c.thumpBuf = b;
  }
  const th = ctx.createBufferSource();
  th.buffer = c.thumpBuf;
  th.connect(c.thump);
  c.thump.gain.cancelScheduledValues(t);
  c.thump.gain.setValueAtTime(.3, t);
  c.thump.gain.setTargetAtTime(0, t + .02, .05);
  th.start(t);
  th.stop(t + .25);
}

function crackleOn(on){
  if (!colour) return;
  const ctx = Patchwork.audio.context();
  const c = colour.crackle;
  if (on && fmt === "vinyl"){
    if (c.src) return;
    c.src = ctx.createBufferSource();
    c.src.buffer = c.buffer; c.src.loop = true;
    c.src.connect(c.gain);
    c.src.start(0, Math.random() * c.buffer.duration);
    needleDrop(ctx, c);
  } else if (c.src){
    const s = c.src; c.src = null;
    c.gain.gain.cancelScheduledValues(ctx.currentTime);
    c.gain.gain.setValueAtTime(c.gain.gain.value, ctx.currentTime);
    c.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + .2);
    try{ s.stop(ctx.currentTime + .3); }catch(e){}
  }
}

function play(){
  if (!loaded || !loaded.buffer || playing) return;
  const ctx = ensureOut();
  Patchwork.audio.resume();
  src = ctx.createBufferSource();
  src.buffer = loaded.buffer;
  src.connect(gain);
  src.onended = () => { if (playing) stop(true); };
  const from = playFrom >= loaded.buffer.duration - .05 ? 0 : playFrom;
  src.start(0, from);
  playFrom = from;
  playAt = ctx.currentTime;
  playing = true;
  crackleOn(true);
  paint();
}
function stop(ended){
  if (src){
    const s = src; src = null;
    try{ s.onended = null; s.stop(); }catch(e){}
  }
  if (playing && !ended){
    const ctx = Patchwork.audio.context();
    playFrom = clamp(playFrom + (ctx.currentTime - playAt), 0, loaded && loaded.buffer ? loaded.buffer.duration : 0);
  } else if (ended){
    playFrom = 0;
  }
  playing = false;
  crackleOn(false);
  paint();
}
function eject(quiet){
  stop();
  playFrom = 0;
  if (loaded){
    loaded.el.remove();
    loaded = null;
  }
  slot.classList.remove("lib-loaded");
  platter.classList.remove("lib-loaded");
  if (tray) tray.classList.remove("lib-loaded");
  if (arm) arm.style.transform = "rotate(0deg)";
  nowEl.textContent = cd() ? "no disc" : (vinyl() ? "no record" : "no tape");
  bPlay.disabled = true; bEject.disabled = true;
  timeEl.textContent = "0:00"; bar.style.width = "0%";
  if (!quiet) render();
}
function position(){
  if (!loaded || !loaded.buffer) return 0;
  if (!playing) return playFrom;
  return clamp(playFrom + (Patchwork.audio.context().currentTime - playAt), 0, loaded.buffer.duration);
}
function paint(){
  bPlay.classList.toggle("lib-on", playing);
  bPlay.textContent = playing ? "⏸" : "▶";
}

bPlay.addEventListener("click", () => playing ? stop() : play());
bStop.addEventListener("click", () => { stop(); playFrom = 0; frame(0); });
bEject.addEventListener("click", () => eject());

/* ---- rename and delete ---- */
shelf.addEventListener("dblclick", e => {
  const n = e.target.closest(".lib-label-name, .lib-rec-name, .lib-cd-name");
  if (!n) return;
  /* The button is not drawn on someone else's take, but the handler refuses it too: a
     rename would be written to a folder RLS will not accept, and the shelf would show a
     name the shared library never agreed to. */
  const owner = tapes.find(t => t.id === n.closest(".lib-tape, .lib-rec, .lib-cd").dataset.id);
  if (owner && !owner.mine) return;
  n.contentEditable = "true";
  n.focus();
  document.execCommand && document.getSelection().selectAllChildren(n);
});
shelf.addEventListener("keydown", e => {
  const n = e.target.closest(".lib-label-name, .lib-rec-name, .lib-cd-name");
  if (!n || !n.isContentEditable) return;
  if (e.key === "Enter"){ e.preventDefault(); n.blur(); }
  if (e.key === "Escape"){ n.textContent = nameOf(n); n.blur(); }
  e.stopPropagation();               // letters here are text, not notes
});
shelf.addEventListener("blur", e => {
  const n = e.target.closest && e.target.closest(".lib-label-name, .lib-rec-name, .lib-cd-name");
  if (!n || !n.isContentEditable) return;
  n.contentEditable = "false";
  const id = n.closest(".lib-tape, .lib-rec, .lib-cd").dataset.id;
  const name = n.textContent.trim().slice(0, 60);
  if (name && name !== nameOf(n)) LIB.rename(id, name);
  else n.textContent = nameOf(n);
}, true);
function nameOf(n){
  const id = n.closest(".lib-tape, .lib-rec, .lib-cd").dataset.id;
  const t = tapes.find(x => x.id === id);
  return t ? t.name : "";
}

/* ---- sleeve art ----
   ⚠️ HTML5 FILE DROP, which is a different event family from the pointer drag that loads a
   take into the deck — dragover/drop never fire for a pointer gesture, so the two cannot
   collide. A file picker as well, because dragging a file is not a gesture that exists on a
   phone. */
const artPick = document.createElement("input");
artPick.type = "file"; artPick.accept = "image/*"; artPick.hidden = true;
document.body.appendChild(artPick);
let artFor = null;
artPick.addEventListener("change", async () => {
  const f = artPick.files && artPick.files[0];
  if (f && artFor) await setArt(artFor, f);
  artPick.value = ""; artFor = null;
});
shelf.addEventListener("click", e => {
  const b = e.target.closest(".lib-art-btn");
  if (!b) return;
  e.stopPropagation();
  artFor = b.closest(".lib-tape, .lib-rec, .lib-cd").dataset.id;
  artPick.click();
});

async function setArt(id, file){
  const t = tapes.find(x => x.id === id);
  if (!t || !t.mine) return;
  try{
    const blob = await LIB.makeArt(file);
    /* a new sleeve means the copy in the cloud is out of date, same as a rename */
    await LIB.update(id, {art: blob, synced: 0});
    render();
  }catch(err){
    say(err && err.message ? err.message : "Could not use that image.", true);
  }
}

/* the whole shelf is the drop zone; which item you dropped on decides where it lands */
["dragenter", "dragover"].forEach(ev => shelf.addEventListener(ev, e => {
  const el = e.target.closest(".lib-rec, .lib-cd, .lib-tape");
  if (!el) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  shelf.querySelectorAll(".lib-art-over").forEach(n => n.classList.remove("lib-art-over"));
  const t = tapes.find(x => x.id === el.dataset.id);
  if (t && t.mine) el.classList.add("lib-art-over");
}));
shelf.addEventListener("dragleave", e => {
  const el = e.target.closest(".lib-rec, .lib-cd, .lib-tape");
  if (el) el.classList.remove("lib-art-over");
});
shelf.addEventListener("drop", async e => {
  const el = e.target.closest(".lib-rec, .lib-cd, .lib-tape");
  if (!el) return;
  e.preventDefault();
  el.classList.remove("lib-art-over");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) await setArt(el.dataset.id, f);
});

/* Two-step, like the deck's Erase: a tape is the only thing here that cannot be got back. */
let armed = null, armTimer = 0;
shelf.addEventListener("click", e => {
  const x = e.target.closest(".lib-tape-x");
  if (!x) return;
  e.stopPropagation();
  const id = x.closest(".lib-tape, .lib-rec, .lib-cd").dataset.id;
  const t = tapes.find(v => v.id === id);
  if (t && !t.mine) return;
  if (armed !== id){
    if (armed) disarm();
    armed = id; x.classList.add("lib-arm"); x.textContent = "sure?";
    armTimer = setTimeout(disarm, 4000);
    return;
  }
  disarm();
  /* ⚠️ Off the shared shelf as well, not just off this machine. A take deleted locally but
     left in the bucket reappears the moment the list refreshes, which reads as the delete
     having silently failed. Local first so it still goes if the network does not. */
  LIB.remove(id).then(() => {
    if (t && t.remote && C && C.signedIn && t.mine)
      C.remove(id).catch(() => say("Removed here, but not from the shared shelf.", true));
  }).then(render);
});
function disarm(){
  clearTimeout(armTimer);
  shelf.querySelectorAll(".lib-tape-x.lib-arm").forEach(b => {
    b.classList.remove("lib-arm"); b.textContent = "×";
  });
  armed = null;
}

/* ---- the picture ----
   Hubs turn at constant linear tape speed and the packs transfer, exactly as TP·1's reels
   do; the cones are scaled from real band energy. */
const HUB = 5.2, FULL = 11;
function radius(f){ return Math.sqrt(HUB*HUB + (FULL*FULL - HUB*HUB) * clamp(f, 0, 1)); }
let angle = 0, last = 0;

function spinHubs(f, dt){
  const hubs = loaded.el.querySelectorAll(".lib-hub");
  const rs = radius(1 - f), rt = radius(f);
  if (hubs[0]) hubs[0].querySelector(".hp").setAttribute("r", rs.toFixed(2));
  if (hubs[1]) hubs[1].querySelector(".hp").setAttribute("r", rt.toFixed(2));
  if (playing && dt) angle += (26 / Math.max(rs, HUB)) * dt * 180 / Math.PI;
  hubs.forEach(h => {
    const g = h.querySelector(".ha-g");
    if (g) g.setAttribute("transform", "rotate(" + (angle % 360).toFixed(1) + " 12 12)");
  });
}

/* ⚠️ A CD spins FAR faster than a record — around 500 rpm at the inner edge — and drawing
   it at 33 would make the fast clean format look like the slow warm one. Fast enough to
   blur is the point. */
function spinCd(dt){
  if (playing && dt) angle += 430 * 6 * dt;
  loaded.el.style.transform = "translate(-50%,-50%) rotate(" + (angle % 360).toFixed(1) + "deg)";
}

/* ⚠️ 33⅓ RPM, not "some rotation per frame". 100/3 turns a minute is 200 degrees a second,
   and it is a speed people have watched for sixty years — a platter turning at the wrong
   rate is noticed even by someone who could not tell you what the right one is. */
const RPM = 100 / 3;
/* The arm sweeps from the outer groove to the run-out. Small numbers: a real arm crosses
   about 20° across a side, and swinging it further looks like a windscreen wiper. */
const ARM_IN = 42, ARM_OUT = 58;
function spinDisc(f, dt){
  if (playing && dt) angle += RPM * 6 * dt;         // 6 = 360° per rev ÷ 60 s
  loaded.el.style.transform = "translate(-50%,-50%) rotate(" + (angle % 360).toFixed(1) + "deg)";
  if (arm) arm.style.transform = "rotate(" + (ARM_IN + (ARM_OUT - ARM_IN) * clamp(f, 0, 1)).toFixed(2) + "deg)";
}

function frame(now){
  if (!open){ raf = 0; return; }
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min(.1, (now - last) / 1000) : 0;
  last = now;

  if (loaded && loaded.buffer){
    const dur = loaded.buffer.duration, pos = position();
    const f = dur ? pos / dur : 0;
    timeEl.textContent = clock(pos);
    bar.style.width = (f * 100).toFixed(2) + "%";
    if (cd()) spinCd(dt); else if (vinyl()) spinDisc(f, dt); else spinHubs(f, dt);
  }

  /* ⚠️ BAND ENERGY, NOT OVERALL LEVEL. A woofer driven by the full-band average moves on
     hi-hats, which is exactly the tell that it is decoration. Bins are picked by frequency,
     so this stays right whatever rate the context opened at. */
  if (an && freq){
    an.getByteFrequencyData(freq);
    const ctx = Patchwork.audio.context();
    const hz = ctx.sampleRate / 2 / freq.length;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hz)), b = Math.min(freq.length - 1, Math.ceil(hi / hz));
      let s = 0; for (let i = a; i <= b; i++) s += freq[i];
      return b >= a ? s / (b - a + 1) / 255 : 0;
    };
    const low = playing ? band(30, 160) : 0;
    const high = playing ? band(4000, 12000) : 0;
    cones.forEach(c => { if (c) c.style.transform = "scale(" + (1 + low * .16).toFixed(3) + ")"; });
    tweets.forEach(c => { if (c) c.style.transform = "scale(" + (1 + high * .10).toFixed(3) + ")"; });
  }
}

/* ---- switching machines ----
   Ejects first: a cassette cannot stay in a turntable, and carrying the loaded item across
   would mean two code paths for what is in the deck. Cheap, and it is what changing your
   mind about how to listen actually looks like. */
function applyFormat(){
  const v = vinyl(), c = cd();
  slot.hidden = v || c;
  platter.hidden = !v;
  if (tray) tray.hidden = !c;
  shelf.classList.toggle("lib-vinyl", v);
  shelf.classList.toggle("lib-cds", c);
  rackTitle.textContent = c ? "Discs" : (v ? "Records" : "Tapes");
  deckName.innerHTML = c ? "HV&middot;4 &mdash; compact disc player"
                         : (v ? "HV&middot;3 &mdash; turntable" : "HV&middot;2 &mdash; cassette deck");
  nowEl.textContent = c ? "no disc" : (v ? "no record" : "no tape");
  fmtSeg.querySelectorAll("button").forEach(b => b.classList.toggle("st-sel", b.dataset.f === fmt));
  bEject.title = v ? "Lift the arm" : "Eject";
}
fmtSeg.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b || b.dataset.f === fmt) return;
  eject(true);
  fmt = b.dataset.f;
  try{ localStorage.setItem(FMT_KEY, fmt); }catch(e){}
  routeColour();
  applyFormat();
  render();
});
applyFormat();

/* ---- sync ----
   Local first, always. The shelf is IndexedDB and works with no account and no network;
   this copies it up and pulls down anything recorded on another machine. */
const C = Patchwork.cloud;
function say(msg, bad){
  if (!cloudMsg) return;
  cloudMsg.textContent = msg || "";
  cloudMsg.classList.toggle("lib-bad", !!bad);
}
function paintCloud(){
  if (!C || !cloudBar) return;
  cloudBar.hidden = !C.configured;
  if (!C.configured) return;
  const inn = C.signedIn;
  const ok = inn && member !== false;
  cloudState.textContent = inn ? (member === false ? "Not on the Harvest list" : C.email)
                               : "Not signed in";
  cloudState.classList.toggle("lib-in", ok);
  cloudState.classList.toggle("lib-out", inn && member === false);
  signInForm.hidden = inn;
  if (bGoogle) bGoogle.hidden = inn;
  /* nothing to sync if the door is shut, so do not offer it */
  bSync.hidden = !ok;
  bOut.hidden = !inn;
  if (whoWrap){
    whoWrap.hidden = !inn;
    if (inn && document.activeElement !== whoIn) whoIn.value = C.displayName;
  }
}
if (C){
  C.onChange(paintCloud);
  if (signInForm) signInForm.addEventListener("submit", async e => {
    e.preventDefault();
    const em = emailIn.value.trim();
    if (!em) return;
    say("Sending…");
    try{ await C.signIn(em); say("Check your email for the link."); }
    catch(err){ say(err.message || "Could not send the link.", true); }
  });
  /* Changing your name does not rewrite anything here and now — that would mean touching
     every object you own on every keystroke. The next "Share mine" catches the back
     catalogue up, re-putting only the sidecars whose artist has actually drifted. */
  if (whoIn) whoIn.addEventListener("change", () => {
    C.setDisplayName(whoIn.value);
    say(whoIn.value.trim() ? "New takes will go up as " + whoIn.value.trim() + "." : "");
  });
  if (bGoogle) bGoogle.addEventListener("click", () => {
    say("Taking you to Google…");
    try{ C.signInWithGoogle(); }
    catch(err){ say(err.message || "Could not start sign-in.", true); }
  });
  if (bOut) bOut.addEventListener("click", async () => { await C.signOut(); say("Signed out."); render(); });
  if (bSync) bSync.addEventListener("click", sync);
  /* arriving back from the emailed link */
  if (C.justArrived) say("Signed in.");
  if (C.signedIn) checkMember();
}

/* ⚠️ SIGNED IN AND ALLOWED IN ARE DIFFERENT THINGS. Any Google account completes the
   sign-in; the allowlist decides whether the bucket answers. Without this the shelf would
   simply come back empty for an outsider, which looks like a broken app rather than a
   closed door — and would have someone reporting a bug instead of asking to be added. */
let member = null;                   // null = not asked yet
async function checkMember(){
  if (!C || !C.signedIn){ member = null; return; }
  member = await C.allowed();
  paintCloud();
  if (member === false)
    say(C.email + " is not on the Harvest list — ask whoever runs the Hub to add you.", true);
}

let syncing = false;
async function sync(){
  if (syncing || !C || !C.signedIn) return;
  syncing = true;
  bSync.disabled = true;
  let up = 0;
  try{
    const remote = await C.list();
    remoteTapes = remote; remoteAt = Date.now();
    const local = await LIB.list();
    const remoteIds = new Set(remote.map(r => r.id));
    const localIds = new Set(local.map(l => l.id));

    /* up: anything not yet in the cloud, or renamed since it was */
    /* ⚠️ A SIDECAR REFRESH IS NOT A RE-UPLOAD. The audio is the expensive part and never
       changes; the few hundred bytes naming you do. So a take already up there whose label
       or artist has drifted gets its metadata re-put on its own — which is also what fixes
       takes shared before there was an artist field at all, and what makes changing your
       name catch up your back catalogue instead of stranding it. */
    const byId = new Map(remote.map(r => [r.id, r]));
    for (const t of local){
      if (t.owner && C.uid && t.owner !== C.uid) continue;
      const r = byId.get(t.id);
      if (t.synced && r){
        /* a cover added after the take went up is the other thing that drifts — cheap to
           push on its own, and the audio never has to move again */
        const needsArt = t.art && !r.hasArt;
        if (r.artist !== C.displayName || r.name !== t.name || needsArt){
          say("Updating " + t.name + "…");
          if (needsArt){
            const full = await LIB.get(t.id);
            if (full && full.art) await C.putArt(t.id, full.art);
          }
          await C.putMeta(t.id, {name: t.name, made: t.made,
                                 seconds: t.seconds, colour: t.colour});
          up++;
        }
        continue;
      }
      /* ⚠️ ONLY YOUR OWN GO UP — checked above, before the relabel branch. A take fetched
         from the shared shelf sits in the same local store as one you recorded; without
         that check every listen quietly re-uploads someone else's music into your folder,
         attributed to you. RLS would not stop it: the copy WOULD be in your folder,
         legitimately. */
      say("Encoding " + t.name + "…");
      const rec = await LIB.get(t.id);
      if (!rec) continue;
      /* ⚠️ ENCODED HERE, NOT AT RECORD TIME. The reel can be rewound and recorded over, so
         an Opus stream captured live alongside the take would not match what ended up on
         the tape. Encoding the finished buffer is the only version that always agrees. */
      let blob = rec.wav;
      if (Patchwork.opus && Patchwork.opus.available && /wav/i.test(rec.wav.type || "")){
        const ctx = Patchwork.audio.context();
        const buf = await ctx.decodeAudioData(await rec.wav.arrayBuffer());
        blob = await Patchwork.opus.encode(buf);
      }
      say("Uploading " + t.name + "…");
      await C.putAudio(t.id, blob);
      if (rec.art) await C.putArt(t.id, rec.art);
      await C.putMeta(t.id, {name: t.name, made: t.made, seconds: t.seconds, colour: t.colour});
      await LIB.update(t.id, {synced: Date.now()});
      up++;
    }

    /* ⚠️ NOTHING COMES DOWN HERE ANY MORE. A shared shelf means the cloud list is everyone's
       music, and pulling all of it onto every machine is hundreds of megabytes of audio
       nobody asked for. Sync now means "publish mine and refresh the list"; the audio for
       somebody else's take arrives when you put it in the deck. */
    const fresh = remote.filter(r => !localIds.has(r.id)).length;
    say(up ? ("Shared " + up + (up === 1 ? " take." : " takes."))
           : (fresh ? "Up to date — " + fresh + " to listen to." : "Up to date."));
    remoteAt = 0;                    // force a rebuild so the shelf shows what just changed
  }catch(e){
    say(e && e.message ? e.message : "Sync failed.", true);
  }
  syncing = false;
  bSync.disabled = false;
  render();
}
paintCloud();

/* A way in for the measurement harness, like fx.js's __fx. The colouration is the whole
   reason the format switch is not a costume, so it has to be measurable rather than taken
   on trust — the numbers are in the notes beside each chain. */
window.__lib = {
  get colour(){ ensureOut(); return colour; },
  get format(){ return fmt; },
  setFormat(f){ fmt = f; routeColour(); applyFormat(); },
};

Patchwork.libraryUI = {
  show(){ open = true; last = 0; paintCloud(); render(); if (!raf) raf = requestAnimationFrame(frame); },
  hide(){ open = false; stop(); }
};
})();
