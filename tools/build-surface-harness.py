#!/usr/bin/env python3
"""Generate _surfacetest.html — the studio build plus a fake Launchkey Mini MK4.

Same trick as tools/build-midi-harness.py: the app is untouched and the hardware is
supplied from outside. What this one exists to test is the half of shell/launchkey.js
that no amount of reading can check — that the bytes going OUT are the ones the
Programmer's Reference asks for, and that the bytes coming IN land on the right pad of
the right instrument.

A control surface fails in a way a unit test of its decoder would not catch: the decode
is right, the handshake is wrong, and the device simply never enters the mode the decode
was written for. So this fakes both ports of the device, records everything sent to the
DAW port, and lets a test press a pad the way the hardware would.

    python3 tools/build-surface-harness.py && open _surfacetest.html
    __lk.connect()              # pick the profile, as the Controller menu does
    __lk.out                    # every message sent to the device, decoded
    __lk.pad(3, 100)            # press DAW-layout pad cell 3 (bottom row, 4th)
    __lk.drumPad(0, 100)        # press Drum-layout pad cell 0 (note 36, the kick)
    __lk.enc(0, 64)             # first encoder to halfway
    __lk.customEnc(0, 5)        # the same knob in Custom 1: channel 1, on the MIDI port
    __lk.btn(115)               # Play
    __lk.leds()                 # the last colour sent to each of the 16 pads
    __lk.bitmaps()              # every screen bitmap sent, decoded into rows of "#" and "."
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# The studio by default; `--box` takes the groovebox build instead, into _boxtest.html.
BOX = "--box" in sys.argv[1:]
APP = ROOT / ("groovebox.html" if BOX else "index.html")
OUT = ROOT / ("_boxtest.html" if BOX else "_surfacetest.html")

HARNESS = r"""
<script>
/* ---- test rig: a Launchkey Mini MK4 37, on two USB ports like the real one ---- */
(() => {
"use strict";

function Port(id, name, type){
  this.id = id; this.name = name; this.manufacturer = "Focusrite A.E. Ltd";
  this.type = type; this.state = "connected"; this.connection = "open";
  this.onmidimessage = null;
}
Port.prototype.open = function(){ return Promise.resolve(this); };
Port.prototype.close = function(){ return Promise.resolve(this); };
/* ⚠️ LISTENERS AS WELL AS THE PROPERTY. The surface hears the Launchkey's MIDI port with addEventListener
   so the router keeps its one onmidimessage — see start() in shell/surface.js — and a fake that only
   called the property would test a path nothing uses. */
Port.prototype.addEventListener = function(type, fn){
  if (type === "midimessage") (this.listeners || (this.listeners = [])).push(fn);
};
Port.prototype.removeEventListener = function(type, fn){
  if (this.listeners) this.listeners = this.listeners.filter(f => f !== fn);
};
Port.prototype.send = function(){};
Port.prototype.clear = function(){};

/* Names as macOS reports them. The profile matches on "launchkey", "mk4" and "daw", so
   these are the three facts the detector is actually being tested against.

   ⚠️ DELIBERATELY DOES NOT SAY "MINI". The profile used to pick its SysEx header from
   whether the port name contained that word, and a harness that spelled the name the
   convenient way proved only that the guess agreed with itself. The screen must work on a
   port whose name gives the SKU away and on one that does not. */
const keysIn  = new Port("lk-midi-in",  "Launchkey MK4 37 MIDI Out", "input");
const dawIn   = new Port("lk-daw-in",   "Launchkey MK4 37 DAW Out",  "input");
const keysOut = new Port("lk-midi-out", "Launchkey MK4 37 MIDI In",  "output");
const dawOut  = new Port("lk-daw-out",  "Launchkey MK4 37 DAW In",   "output");

const sent = [];
/* ⚠️ A MINI ANSWERS A BITMAP, and only one addressed to it: `f0 00 20 29 02 13 09 f7`, 84-88 ms
   after the frame, read off a Mini MK4 25 on 2026-09-13. The profile paces its animations on
   that answer, so a fake that never gave one would only ever test the fallback. Turn
   `__lk.bitmapAck` off to test the fallback on purpose. */
dawOut.send = function(bytes){
  const m = Array.from(bytes);
  sent.push(m);
  if (R.bitmapAck && m[0] === 0xF0 && m[5] === 0x13 && m[6] === 0x09)
    setTimeout(() => feed(dawIn, [0xF0, 0x00, 0x20, 0x29, 0x02, 0x13, 0x09, 0xF7]), R.bitmapMs);
};
/* ⚠️ RECORDED, because the keys port is not only the keys: in Custom 1 the Launchkey's knobs speak
   on it, and the profile asks them back to the middle there. See keys() in shell/launchkey.js. */
const keysSent = [];
keysOut.send = function(bytes){ keysSent.push(Array.from(bytes)); };

const access = {
  inputs: new Map([["lk-midi-in", keysIn], ["lk-daw-in", dawIn]]),
  outputs: new Map([["lk-midi-out", keysOut], ["lk-daw-out", dawOut]]),
  sysexEnabled: true,
  onstatechange: null,
  addEventListener(){}, removeEventListener(){}
};
/* Grants SysEx without asking, which is the point: the screen path is the one half of
   this file that a permission prompt would otherwise make untestable. */
navigator.requestMIDIAccess = () => Promise.resolve(access);

const DAW_BOT = [112,113,114,115,116,117,118,119], DAW_TOP = [96,97,98,99,100,101,102,103];
const DRUM_BOT = [36,37,38,39,44,45,46,47], DRUM_TOP = [40,41,42,43,48,49,50,51];
const cellNote = (bot, top, i) => i < 8 ? bot[i] : top[i - 8];

function feed(port, bytes){
  const ev = {data:new Uint8Array(bytes), receivedTime:performance.now(), target:port};
  if (port.onmidimessage) port.onmidimessage(ev);
  (port.listeners || []).forEach(fn => fn(ev));
}

const R = window.__lk = {
  out: sent,
  keysOut: keysSent,
  bitmapAck: true, bitmapMs: 85,
  dawIn, keysIn, dawOut,
  reset(){ sent.length = 0; },

  /* What the Controller menu does, without needing the menu to exist yet. */
  connect(){ return Patchwork.surface.connect("launchkey-mk4"); },
  disconnect(){ Patchwork.surface.disconnect(); },

  /* ---- in ---- */
  raw(bytes){ feed(dawIn, bytes); },
  key(bytes){ feed(keysIn, bytes); },
  pad(cell, vel){ feed(dawIn, [0x90, cellNote(DAW_BOT, DAW_TOP, cell), vel == null ? 100 : vel]); },
  padOff(cell){ feed(dawIn, [0x80, cellNote(DAW_BOT, DAW_TOP, cell), 0]); },
  drumPad(cell, vel){ feed(dawIn, [0x99, cellNote(DRUM_BOT, DRUM_TOP, cell), vel == null ? 100 : vel]); },
  enc(i, v){ feed(dawIn, [0xBF, 21 + i, v]); },
  /* ⚠️ A KNOB IN CUSTOM 1 IS A DIFFERENT MESSAGE ON A DIFFERENT PORT: CC 21-28 on channel 1 of the
     MIDI port, absolute from the device's own counter. Read off a Mini MK4 25 on 2026-09-13 with
     _midimon.html bound to that port; the DAW port carries nothing for them. */
  customEnc(i, v){ feed(keysIn, [0xB0, 21 + i, v]); },
  /* ⚠️ Channel 1 and CC 51/52, because that is what a real Launchkey Mini MK4 sends for the
     two buttons beside the encoders — not the channel-16 55/56 its figure prints. Captured
     with Patchwork.surface.traffic; the harness follows the hardware, not the document, or
     it is only testing that the code agrees with the same wrong guess twice. */
  encUp(){ feed(dawIn, [0xB0, 51, 127]); feed(dawIn, [0xB0, 51, 0]); },
  encDn(){ feed(dawIn, [0xB0, 52, 127]); feed(dawIn, [0xB0, 52, 0]); },
  btn(cc, v){ feed(dawIn, [0xBF, cc, v == null ? 127 : v]); feed(dawIn, [0xBF, cc, 0]); },
  /* The device telling us the user pressed a pad-mode button on the hardware. */
  padMode(v){ feed(dawIn, [0xB6, 0x1D, v]); },

  /* ---- out ---- */
  /* Only the non-SysEx messages, as [status, d1, d2] triples. */
  chan(){ return sent.filter(m => m[0] !== 0xF0); },
  sysex(){ return sent.filter(m => m[0] === 0xF0); },
  /* Every SysEx that set screen text, as readable strings: [target, field, text]. */
  text(){
    return sent.filter(m => m[0] === 0xF0 && m[6] === 0x06)
               .map(m => [m[7], m[8], m.slice(9, -1).map(c => String.fromCharCode(c)).join("")]);
  },
  /* Which product headers the screen messages were addressed to. Both must appear: the
     device answers to one of them and the profile does not know which. */
  sysexHeaders(){
    const seenH = {};
    sent.filter(m => m[0] === 0xF0).forEach(m => { seenH[m[5].toString(16)] = true; });
    return Object.keys(seenH).sort();
  },
  /* The last colour sent to each of the sixteen pads, in cell order, for whichever pad
     layout the surface currently has selected. */
  leds(drum){
    const bot = drum ? DRUM_BOT : DAW_BOT, top = drum ? DRUM_TOP : DAW_TOP;
    const st = drum ? [0x99, 0x9B] : [0x90, 0x92];
    const out = new Array(16).fill(null);
    sent.forEach(m => {
      if (st.indexOf(m[0]) < 0) return;
      let i = bot.indexOf(m[1]); if (i < 0){ i = top.indexOf(m[1]); if (i < 0) return; i += 8; }
      out[i] = {colour: m[2], pulse: m[0] === st[1]};
    });
    return out;
  },
  /* The last value sent to each button LED. */
  btnLeds(){
    const out = {};
    sent.forEach(m => { if (m[0] === 0xB0) out[m[1]] = m[2]; });
    return out;
  },
  /* The last position sent back to each encoder. */
  encPos(){
    const out = new Array(8).fill(null);
    sent.forEach(m => { if (m[0] === 0xBF && m[1] >= 21 && m[1] < 29) out[m[1] - 21] = m[2]; });
    return out;
  },
  /* Every screen bitmap sent, decoded: {target, sku, rows}, each row 128 characters of "#" and
     "." — enough to read a frame in the console and to turn into a picture outside it. */
  bitmaps(){
    return sent.filter(m => m[0] === 0xF0 && m[6] === 0x09 && m.length === 1225).map(m => {
      const rows = [];
      for (let y = 0; y < 64; y++){
        let line = "";
        for (let x = 0; x < 128; x++) line += (m[8 + y * 19 + ((x / 7) | 0)] >> (6 - x % 7)) & 1 ? "#" : ".";
        rows.push(line);
      }
      return {target: m[7], sku: m[5], rows};
    });
  },
  /* Did the DAW-port handler get bound, and only once? */
  bound(){ return {daw: !!dawIn.onmidimessage, keys: !!keysIn.onmidimessage}; }
};
})();
</script>
"""


def main():
    if not APP.exists():
        sys.exit(f"missing {APP} — run tools/build.py first")
    html = APP.read_text()
    i = html.index("<script>")
    OUT.write_text(html[:i] + HARNESS + html[i:])
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(html):,} -> {OUT.stat().st_size:,} bytes)")
    print("  __lk.connect() / .pad(3) / .enc(0,64) / .btn(115) / .leds() / .text()")


if __name__ == "__main__":
    main()
