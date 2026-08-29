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
- ⚠️ **`setInterval(pump, 25)` in `shell/clock.js` — MEASURED, and worse than assumed.**
  A plain `setInterval(fn, 25)` in a non-visible tab produced **4 ticks in 3 seconds** where
  120 were asked for: about 1.3 Hz, against a scheduler that looks 200 ms ahead. That is not
  a degraded tick, it is a stopped one.

  ⚠️ **Caveat on that number:** it was taken in an automation pane whose visibility state is
  not a normal foreground tab, so read it as "throttling is real and severe when hidden",
  not as "this happens in the foreground". Chrome also exempts pages that are *playing audio*
  from timer throttling, which is why a jam in progress has looked fine — the exposure is a
  client that is **in a session but silent**, waiting to fire a row, whose clock has stalled
  by the time it does.

  **The fix, in order of preference.** An **AudioWorklet ticker** is the right one: the audio
  thread is real-time and never throttled while the context runs, and this clock is about
  audio time anyway. A processor that posts a message every 8 render quanta is ~21 ms at
  48 kHz. Two details it will need — the node must be connected (through a zero gain to
  `destination`) or `process()` is never pulled, and the module loads asynchronously, so keep
  the `setInterval` running until it is live. Double-ticking during the overlap is harmless:
  every instrument's `tick()` only schedules while `nextTime < now + .2`, so an extra call
  finds nothing to do. A Worker timer is the easier second choice and is what the classic
  "Tale of Two Clocks" recommends, but it is not as certain: Chrome has throttled worker
  timers owned by hidden pages.

  ⚠️ **Do not put the AudioWorklet source in a template literal with a backtick in it.** See
  `lp1/worklet.js` and the note in `HANDOFF.md`; it cost this session an afternoon-shaped
  bug where every script after it silently failed to parse.
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

## Where this stopped

Mid-way through the clock fix above: the problem was measured and the approach settled, and
**no code was written for it**. The tree is clean and everything below is committed and
pushed. Picking it up means starting at `shell/clock.js` with the plan in the open items.

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
