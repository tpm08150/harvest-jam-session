# Session brief — 2026-08-29

Written to hand this to a fresh context window. `HANDOFF.md` is the reference for *how
things work*; this is *what happened and where it stands*.

## Where it stands

Branch **`playable`**, pushed to `origin`. `main` is untouched and even with the remote, so
nothing here is merged. Eight commits on top of `d2683ab`:

```
cf331f5 Talkback, on a strip the looper cannot hear
90dbd9d Hear each other play, and push a take to the room
71d0fdd Share the pattern being played, and say who is holding each instrument
4e7e9bf Share the sound as well as the pattern
eea80b0 A cell writes, the row button plays
1726d11 Pick a jam instead of naming it from memory
df25e7c One sequencer model, three instruments
027ca22 A relay, so a jam can cross machines
85af67a One tempo grid, a page metronome, and the first slice of shared jams
952b12f Make the whole rack playable while it is running
```

`python3 tools/build.py --check` passes on all seven outputs. Nothing is merged and nothing
is deployed — Netlify builds `main`.

## What this session was

It started as a studio you played alone and ended as one two people can play together over a
network. Roughly three phases:

1. **Making the rack playable** — faces carrying the controls you need mid-performance, the
   launcher behaving like a launcher, one tempo for the page, one keyboard for every
   instrument, one sequencer model across three of them.
2. **The looper becoming a real looper** — a take per row reachable from the panel, a
   count-in, overdub as a switch rather than a moment.
3. **Shared jams** — state sync, a relay, live notes, pushed takes, talkback.

## How to run a jam

```bash
python3 serve.py      # the page, 8123
python3 tools/jam-relay.py                                       # the relay, 8124
```

Then open the studio with **`?relay`** — the bare form means "the relay is on this host,
port 8124", which exists because retyping an IP twice in one URL is a trap that cost a real
two-laptop test:

```
http://<this machine>:8123/?relay
```

Both machines, same URL, then **Join…** and pick the room rather than typing its name. The
head bar says what it is actually connected to; `via this machine` means the `?relay` did
not take and you are on BroadcastChannel, which reaches other tabs and nothing else.

## The five ideas worth not losing

- **The seam is why any of this works over a network.** Nothing says "change now", it says
  "change at boundary N", and each client works out when that is on its own. A message only
  has to BEAT the boundary. The 200 ms scheduling lookahead was built for audio and turns out
  to be a jitter buffer.
- **State is polled; events are pushed.** Patterns and patches are "what is true now" and are
  compared against the last thing sent, which catches every way they can change including the
  ones added later. A note is an event and goes immediately. Getting this backwards means
  either flooding the wire or hooking a dozen call sites and missing the next one.
- **What travels as audio is what has no pattern.** Synths are patterns everyone renders. The
  looper, the metronome and the talkback are the exceptions, and each needs a strip the
  looper's tap excludes or it ends up printed into every take.
- **Measure, and validate the detector.** Three separate "bugs" this session were the
  measurement: a 26 ms clock agreement that meant nothing because both sides were
  self-consistent about a meaningless number; a `pips: 4` that was rAF not running in a hidden
  tab; a silent take that was a wrong test key rather than broken sync.
- **A cell writes, the row button plays.** The launcher's whole grammar, arrived at late and
  worth keeping.

## Known open items

- ⚠️ **Talkback's send half is untested.** Microphone capture is blocked in the harness, so
  `start()` has been read and not run. The receive path, the strip exclusion and the failure
  mode are all verified. **This is the first thing to try on real hardware.**
- ⚠️ **Patterns are last-writer-wins.** Two people editing one grid overwrite each other every
  220 ms tick. The owner label is the only coordination on offer. Real locks need the relay to
  arbitrate, which is a small addition now that the relay exists.
- **The relay speaks text frames only**, so all audio is base64 — a third larger than it needs
  to be. Binary frames are worth adding the day something bigger than a loop travels.
- **`[hidden]{display:none !important}` ships only in the studio build**, so script-hidden
  controls stay visible in the standalone pages. PM·1's arp controls are the visible symptom.
- **No hardware MIDI test**, still. All MIDI is verified against `tools/build-midi-harness.py`.
- ⚠️ **Phase 7, the Arcade, is still not done** — different repo, and the notes for it are in
  the previous session brief in git history.

## What a jam does not share yet

CS·1 has no patch channel: its progression, key and mood *are* its pattern and the scene
already carries them. LP·1 shares takes only when pushed, never automatically. Nobody's
transport position is shared — everyone fires their own rows, which is deliberate.

## The clock runs off the audio thread now

⚠️ **`setInterval` stops in a tab you cannot see.** Measured side by side, same tab, same
4.9 seconds:

| | ticks/second |
| --- | --- |
| `setInterval(fn, 25)` | **1.0** |
| the AudioWorklet ticker | **47.9** |

The scheduler needs better than 5/s to keep its 200 ms lookahead fed, so the old mechanism
was not degraded, it was stopped. Chrome exempts pages that are *playing audio*, which is why
this stayed invisible: a jam in progress was never the case that broke. The case that breaks
is a client sitting in a session with nothing sounding, waiting to fire a row.

`shell/clock.js` drives `pump()` from an AudioWorklet that posts every 8 render quanta — 21 ms
at 48 kHz, and indifferent to visibility. `Patchwork.clock.driver` reports `worklet`,
`interval` or `none`, and `.ticks` counts them; both are there for the next person who thinks
a session has stalled.

Three things it needed, all of them recorded in the file:

- **The node must be connected** or `process()` is never pulled. It goes through a zero gain
  to `destination` — audible to nothing, pulled by the graph all the same.
- **The module loads asynchronously**, so the interval keeps running until the worklet is
  live. Double-ticking across the handover is harmless: an instrument's `tick()` only
  schedules inside the lookahead, so the second call finds nothing to do.
- **A slow interval stays as a backstop**, because a suspended context stops the audio thread
  too. At 500 ms it is far too slow to be the mechanism and is not meant to be — it is there
  so a failure sounds like gaps rather than silence, and it heals when the worklet returns.

Verified: driver hands over to `worklet` on the first `run()`, 47.9 ticks/s against a
throttled 1.0, survives a stop/restart cycle, and schedules audio events at a steady rate.
⚠️ **Audible timing was not verified in the harness** — the step playhead is rAF-painted and
the automation tab is hidden, which is the same throttling one layer up. Worth one listen on
real hardware.

## Where this stopped

Everything asked for is built and pushed. The tree is clean.

⚠️ **Housekeeping learned the hard way:** the browser automation pane plays through the
machine's own speakers, and test tabs left with DR·1 running are audible to whoever is
sitting there. Stop every transport AND suspend the audio context at the end of a test, not
just at the end of a session.

## Working habits that paid off again

Reproduce before fixing: every bug this session that got fixed properly was measured first,
and two of them turned out to be different bugs than they looked. Test through the real call
path — the Program-mode note write passed when driven through the on-screen keys and failed
from the computer keyboard, which is how the wrong hook was found. And when a measurement
looks like a pass, check that it is measuring the thing you think: the clock epoch bug was
hiding behind a plausible 26 ms.
