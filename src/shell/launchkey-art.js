
/* ---- the Launchkey's screen, as pictures ----
   shell/launchkey.js speaks to the screen; this draws what the screen shows when it is not
   showing words. Two pictures so far: a card that says where you have just gone, and the tape
   deck turning while it rolls.

   ⚠️ DRAWN ON A CANVAS AND THRESHOLDED, not set pixel by pixel. The screen is 128 × 64 and one
   bit deep, and the browser already has type, arcs and anti-aliasing — a hand-made pixel font
   and a hand-rolled circle would be a second, worse copy of both. White is lit; a canvas pixel
   brighter than THRESH on its red channel lights one.

   ⚠️ ELEVEN FRAMES A SECOND AT BEST, read off the wire on 2026-09-13: a Mini MK4 25 answers each
   bitmap in 84-88 ms and the profile waits for the answer before sending another. So everything
   here is drawn from the CLOCK rather than from a frame count — a late frame lands further along
   the motion instead of slowing it down. */
Patchwork.launchkeyArt = (() => {
"use strict";

const W = 128, H = 64, ROW = 19;
const THRESH = 110;
const FACE = "'Saira Semi Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";

let cx = null;
function ctx(){
  if (cx) return cx;
  const cv = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(W, H)
           : Object.assign(document.createElement("canvas"), {width: W, height: H});
  cx = cv.getContext("2d", {willReadFrequently: true});
  return cx;
}
function blank(){
  const c = ctx();
  c.globalCompositeOperation = "source-over";
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#fff"; c.strokeStyle = "#fff"; c.lineWidth = 1;
  c.textBaseline = "alphabetic"; c.textAlign = "left";
  if ("letterSpacing" in c) c.letterSpacing = "0px";
  return c;
}
/* The screen's own packing: nineteen 7-bit bytes a row, the highest bit the leftmost pixel.
   Guide, "Bitmap". */
function pack(c){
  const px = c.getImageData(0, 0, W, H).data;
  const out = new Array(ROW * H).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (px[(y * W + x) * 4] > THRESH) out[y * ROW + ((x / 7) | 0)] |= 1 << (6 - x % 7);
  return out;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function type(c, px){ c.font = "700 " + px + "px " + FACE; }
/* the largest size at which `text` fits `width` */
function fit(c, text, width, max, min){
  for (let px = max; px > min; px--){ type(c, px); if (c.measureText(text).width <= width) return px; }
  type(c, min);
  return min;
}

/* ---- the card ---- */
/* A little picture per place, in a 24 × 24 box. Drawn rather than stored, so each is a handful
   of shapes you can read and change. */
const ICONS = {
  keys(c, x, y){
    c.fillRect(x, y + 3, 24, 18);
    c.fillStyle = "#000";
    for (let k = 1; k < 4; k++) c.fillRect(x + k * 6, y + 3, 1, 18);
    [6, 12, 18].forEach(b => c.fillRect(x + b - 2, y + 3, 4, 11));
    c.fillStyle = "#fff";
  },
  saw(c, x, y){
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, y + 19); c.lineTo(x + 8, y + 5); c.lineTo(x + 8, y + 19);
    c.lineTo(x + 16, y + 5); c.lineTo(x + 16, y + 19); c.lineTo(x + 24, y + 5);
    c.stroke();
    c.lineWidth = 1;
  },
  voice(c, x, y){
    c.beginPath();
    if (c.roundRect) c.roundRect(x + 8, y + 1, 8, 13, 4); else c.rect(x + 8, y + 1, 8, 13);
    c.fill();
    c.lineWidth = 2;
    c.beginPath(); c.arc(x + 12, y + 9, 8, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    c.beginPath(); c.moveTo(x + 12, y + 17); c.lineTo(x + 12, y + 22);
    c.moveTo(x + 7, y + 23); c.lineTo(x + 17, y + 23); c.stroke();
    c.lineWidth = 1;
  },
  pads(c, x, y){
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++){
      const px = x + k * 8 + 1, py = y + 5 + r * 8;
      if ((r + k) % 2) c.fillRect(px, py, 6, 6); else c.strokeRect(px + .5, py + .5, 5, 5);
    }
  },
  loop(c, x, y){
    c.lineWidth = 2;
    c.beginPath(); c.arc(x + 12, y + 12, 8, 0.25 * Math.PI, 1.85 * Math.PI); c.stroke();
    const a = 1.85 * Math.PI, ex = x + 12 + Math.cos(a) * 8, ey = y + 12 + Math.sin(a) * 8;
    c.beginPath(); c.moveTo(ex + 5, ey - 1); c.lineTo(ex - 2, ey - 5); c.lineTo(ex - 1, ey + 3); c.closePath(); c.fill();
    c.lineWidth = 1;
  },
  sweep(c, x, y){
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + 1, y + 21); c.quadraticCurveTo(x + 17, y + 21, x + 19, y + 7); c.stroke();
    c.beginPath(); c.moveTo(x + 19, y + 1); c.lineTo(x + 24, y + 10); c.lineTo(x + 14, y + 9); c.closePath(); c.fill();
    c.lineWidth = 1;
  },
  steps(c, x, y){
    [9, 16, 5, 20, 12, 7].forEach((h, k) => c.fillRect(x + k * 4, y + 22 - h, 3, h));
  },
  grid(c, x, y){
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++){
      const px = x + 2 + k * 7, py = y + 2 + r * 7;
      if (r === 1 && k === 1) c.fillRect(px, py, 6, 6); else c.strokeRect(px + .5, py + .5, 5, 5);
    }
  },
  reels(c, x, y){
    [x + 6, x + 18].forEach(rx => {
      c.beginPath(); c.arc(rx, y + 10, 5.5, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(rx, y + 10, 1.5, 0, Math.PI * 2); c.fill();
    });
    c.fillRect(x + 2, y + 19, 20, 2);
  },
  bolt(c, x, y){
    c.beginPath();
    c.moveTo(x + 14, y); c.lineTo(x + 4, y + 13); c.lineTo(x + 11, y + 13);
    c.lineTo(x + 8, y + 24); c.lineTo(x + 20, y + 9); c.lineTo(x + 13, y + 9);
    c.closePath(); c.fill();
  },
  gear(c, x, y){
    const gx = x + 12, gy = y + 12;
    for (let k = 0; k < 8; k++){
      c.save(); c.translate(gx, gy); c.rotate(k * Math.PI / 4); c.fillRect(-2, -12, 4, 6); c.restore();
    }
    c.beginPath(); c.arc(gx, gy, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#000"; c.beginPath(); c.arc(gx, gy, 3.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff";
  }
};
/* What each place is, in a word over its name, and its picture. Keyed by the id the surface
   already reports for a panel or a page — a panel added later gets a card with its name and
   nothing else rather than needing to be taught one. */
const PLACES = {
  cs1: ["CHORDS", "keys"], pm1: ["POLY SYNTH", "keys"], bs1: ["BASS", "saw"],
  vc1: ["VOCODER", "voice"], dr1: ["DRUMS", "pads"], lp1: ["LOOPER", "loop"],
  ts1: ["TRANSITIONS", "sweep"], sq1: ["SEQUENCER", "steps"],
  scenes: ["LAUNCHER", "grid"], mixer: ["TAPE + DESK", "reels"],
  punch: ["PUNCH-IN FX", "bolt"], settings: ["RACK SETUP", "gear"]
};

/* `t` runs 0 → 1 over the card's life, and only the bar along the bottom moves with it —
   filling to say how long until the controls come back.

   ⚠️ ONE PICTURE, NOT A SEQUENCE. The name used to glide in and its word type itself out, and at
   eleven frames a second the first frames — a name with no picture beside it yet — read as a
   different screen from the card that followed. Reported from the hardware as two screens, of
   which the second, with its picture, was the one to keep: so the card arrives whole. */
function card(to, t){
  const c = blank();
  const place = PLACES[to && to.id] || null;
  const name = String((to && to.name) || "").toUpperCase();
  const icon = place && ICONS[place[1]];
  fit(c, name, icon ? 92 : 120, 36, 12);
  c.fillText(name, 4, 45);
  if (icon) icon(c, 100, 18);
  if (place){
    /* ⚠️ ELEVEN PIXELS AND SPACED, not nine. At nine, thresholded to one bit, an S came out as a
       5 and "DRUMS" read DRUM5: small anti-aliased type loses exactly the curves that tell
       letters apart. */
    type(c, 11);
    if ("letterSpacing" in c) c.letterSpacing = "1px";
    c.fillText(place[0], 4, 12);
    if ("letterSpacing" in c) c.letterSpacing = "0px";
  }
  c.fillRect(4, 59, Math.round(120 * clamp(t, 0, 1)), 2);
  return pack(c);
}

/* ---- the deck ----
   The deck the Tape view draws, at the size of a thumbnail: two reels whose packs grow and
   shrink by AREA, turning at the tape's speed over their own radius — so the emptier reel
   spins faster, the way a real machine's does. The rate is measured from how far the tape
   actually moved, as the view's is, so rewind turns them backwards with no case of its own. */
const HUB = 5, FULL = 18, FLANGE = 20;
const SUP = {x: 29, y: 26}, TAKE = {x: 99, y: 26};
/* tape speed in pixels a second, scaled so a full reel turns at the Tape view's rate */
const SPEED = 34;
let deck = null;
const packR = f => Math.sqrt(HUB * HUB + (FULL * FULL - HUB * HUB) * clamp(f, 0, 1));

function reel(c, at, r, ang){
  c.beginPath(); c.arc(at.x, at.y, FLANGE, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(at.x, at.y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#000"; c.beginPath(); c.arc(at.x, at.y, HUB, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#fff"; c.beginPath(); c.arc(at.x, at.y, 1.5, 0, Math.PI * 2); c.fill();
  /* ⚠️ THE SPOKES INVERT what they cross, so they read black on the tape pack and white off it
     — one colour would vanish on one or the other, and the pack is most of the reel at the
     start of a take and almost none of it at the end. */
  c.globalCompositeOperation = "difference";
  c.lineWidth = 2;
  for (let k = 0; k < 3; k++){
    const a = ang + k * 2 * Math.PI / 3;
    c.beginPath();
    c.moveTo(at.x + Math.cos(a) * (HUB + 1), at.y + Math.sin(a) * (HUB + 1));
    c.lineTo(at.x + Math.cos(a) * (FLANGE - 2), at.y + Math.sin(a) * (FLANGE - 2));
    c.stroke();
  }
  c.globalCompositeOperation = "source-over";
  c.lineWidth = 1;
}
function ribbon(c, rs, rt){
  const L = {x: 47, y: 55}, R = {x: 81, y: 55};
  c.beginPath();
  c.moveTo(SUP.x + rs * .6, SUP.y + rs * .8); c.lineTo(L.x, L.y);
  c.lineTo(R.x, R.y); c.lineTo(TAKE.x - rt * .6, TAKE.y + rt * .8);
  c.stroke();
  [L, R].forEach(p => { c.beginPath(); c.arc(p.x, p.y, 2, 0, Math.PI * 2); c.fill(); });
  c.fillRect(61, 56, 6, 5);                   // the head
}

/* `pic` is what the tape page says is happening: {state, position, reel} in seconds. */
function tape(pic, now){
  const c = blank();
  const len = +pic.reel || 1, pos = Math.max(0, +pic.position || 0);
  if (!deck || now - deck.at > 1000) deck = {angS: 0, angT: 0, pos, at: now};
  const dt = (now - deck.at) / 1000;
  const rate = dt > 0 ? clamp((pos - deck.pos) / dt, -20, 20) : 0;
  deck.pos = pos; deck.at = now;
  const f = clamp(pos / len, 0, 1);
  const rs = packR(1 - f), rt = packR(f);
  /* ⚠️ A TURN IS CAPPED PER FRAME. At eleven frames a second a rewinding empty reel would jump
     most of a revolution between two of them, and three spokes stepping 100° read as turning
     the other way. Under a third of the gap between spokes, rewind still reads as fast. */
  const turn = r => clamp(SPEED * rate / r * dt, -0.7, 0.7);
  deck.angS += turn(rs);
  deck.angT += turn(rt);
  reel(c, SUP, rs, deck.angS);
  reel(c, TAKE, rt, deck.angT);
  ribbon(c, rs, rt);

  const blink = Math.floor(now / 260) % 2 === 0;
  c.textAlign = "center";
  if (pic.state === "rec"){
    if (blink){ c.beginPath(); c.arc(64, 9, 4, 0, Math.PI * 2); c.fill(); }
  } else if (pic.state === "rew"){
    [63, 70].forEach(tx => { c.beginPath(); c.moveTo(tx, 5); c.lineTo(tx - 5, 9); c.lineTo(tx, 13); c.closePath(); c.fill(); });
  } else if (pic.state === "ff"){
    [58, 65].forEach(tx => { c.beginPath(); c.moveTo(tx, 5); c.lineTo(tx + 5, 9); c.lineTo(tx, 13); c.closePath(); c.fill(); });
  } else {
    c.beginPath(); c.moveTo(61, 5); c.lineTo(68, 9); c.lineTo(61, 13); c.closePath(); c.fill();
  }
  type(c, 12);
  c.fillText(Math.floor(pos / 60) + ":" + String(Math.floor(pos % 60)).padStart(2, "0"), 64, 31);
  if (pic.state === "rec"){
    /* and in words, in a box that blinks with the dot — recording is the one state on this page
       worth being impossible to miss */
    type(c, 10);
    if (blink){
      c.fillRect(49, 37, 30, 12);
      c.fillStyle = "#000"; c.fillText("REC", 64, 47); c.fillStyle = "#fff";
    } else c.fillText("REC", 64, 47);
  }
  c.textAlign = "left";
  return pack(c);
}

/* A page's picture, drawn, or null for a kind this screen does not know how to draw. */
function picture(pic, now){
  if (pic && pic.kind === "tape") return tape(pic, now);
  return null;
}

return {width: W, height: H, card, picture, get places(){ return PLACES; }};
})();
