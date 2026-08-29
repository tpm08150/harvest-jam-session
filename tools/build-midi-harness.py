#!/usr/bin/env python3
"""Generate _miditest.html — the studio build plus a fake Web MIDI input.

Same trick as tools/build-phase-harness.py and ios/build-test-harness.py: the app is
untouched and everything it needs is supplied from outside.

What this one exists to test is the router. `port.onmidimessage` is a single-handler
property, so before the shell owned it, two instruments each assigning it meant the
second silently replaced the first — one instrument went deaf with no error anywhere.
That failure is invisible without a way to inject a message and ask BOTH instruments
whether they saw it, which is what this provides.

    python3 tools/build-midi-harness.py && open _miditest.html
    __midi.note(0, 60, 100)     # note on, channel 1 (0-based), middle C
    __midi.raw([0xB0, 74, 64])  # any bytes you like
    __midi.seen                 # every message the fake port emitted
    __midi.handlers()           # how many handlers the port actually has
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "index.html"
OUT = ROOT / "_miditest.html"

HARNESS = r"""
<script>
/* ---- test rig: runs BEFORE the app, so the app finds this already in place ---- */
(() => {
"use strict";

function Port(id, name, type){
  this.id = id; this.name = name; this.manufacturer = "test"; this.type = type;
  this.state = "connected"; this.connection = "open"; this.onmidimessage = null;
}
Port.prototype.open = function(){ return Promise.resolve(this); };
Port.prototype.close = function(){ return Promise.resolve(this); };
Port.prototype.addEventListener = function(){};
Port.prototype.removeEventListener = function(){};
Port.prototype.send = function(){};
Port.prototype.clear = function(){};

const input = new Port("test-in", "Test Keyboard", "input");
const output = new Port("test-out", "Test Sink", "output");
const sent = [];
output.send = function(bytes, when){ sent.push({bytes:Array.from(bytes), when:when||0}); };

const access = {
  inputs: new Map([["test-in", input]]),
  outputs: new Map([["test-out", output]]),
  sysexEnabled: false,
  onstatechange: null,
  addEventListener(){}, removeEventListener(){}
};
navigator.requestMIDIAccess = () => Promise.resolve(access);

const R = window.__midi = {
  seen: [],
  out: sent,
  input: input,
  /* How many handlers the port carries. It can only ever be 0 or 1 — that is the whole
     point. A router that fans out shows 1 here while every instrument still hears the
     message; two instruments assigning it directly ALSO shows 1, and one of them is
     deaf. So this number is a precondition, not the test. The test is asking each
     instrument what it received. */
  handlers(){ return input.onmidimessage ? 1 : 0; },
  raw(bytes){
    const t = performance.now();
    R.seen.push({bytes:bytes.slice(), t:t});
    if (input.onmidimessage)
      input.onmidimessage({data:new Uint8Array(bytes), receivedTime:t, target:input});
  },
  note(ch, n, vel){ R.raw([0x90 | (ch & 15), n & 127, vel & 127]); },
  off(ch, n){ R.raw([0x80 | (ch & 15), n & 127, 0]); },
  cc(ch, num, val){ R.raw([0xB0 | (ch & 15), num & 127, val & 127]); },
  clock(){ R.raw([0xF8]); },
  reset(){ R.seen.length = 0; sent.length = 0; }
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
    print("  __midi.note(0,60,100) / .cc(0,74,64) / .clock() / .handlers() / .out")


if __name__ == "__main__":
    main()
