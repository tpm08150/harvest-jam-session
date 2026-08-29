# Session brief — 2026-08-29

Written to hand this to a fresh context window. `HANDOFF.md` is the reference for *how
things work*; this is *what happened, where it stands, and what to do next*.

## Where it stands

**Merged, pushed and live.** `main` is at `2871386`, fourteen commits on from `d2683ab`, and
deployed at **harvest-jam.netlify.app**. `python3 tools/build.py --check` passes on all seven
outputs. The `playable` branch is gone; every commit is reachable from `main`. A stale local
`studio` branch remains and can be deleted (`git branch -D studio`).

```
2871386 Say why an https page cannot reach a ws:// relay
72128ad Drive the clock off the audio thread
59334a7 Measure the clock throttling before fixing it
90ebb1a Hand this to the next context window
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

## What this session was

It started as a studio you played alone and ended as one two people play together over a
network. Three phases: making the rack playable, making the looper a real looper, and shared
jams.

## Running a jam — and the trap

There are two routes, and **the deployed site is not the easy one**.

**Local, two laptops on one network.** Simplest, nothing to babysit:

```bash
python3 serve.py                    # the studio, 8123
python3 tools/jam-relay.py          # the relay, 8124
```

Both machines open `http://<that machine>:8123/?relay`. The bare `?relay` means "the relay is
on this host, port 8124" and exists because retyping an IP twice in one URL is a trap that
cost a real two-laptop test.

**From harvest-jam.netlify.app.** ⚠️ **An https page cannot open a `ws://` socket.** Chrome
blocks it as mixed content before the socket is constructed, so `join()` fails silently — the
symptom is "the other computer cannot see my jam" with nothing on screen to say why. That is
now caught and explained, but the constraint stands: **a relay reachable from the deployed
site needs TLS.** `cloudflared` is installed on the dev machine:

```bash
cloudflared tunnel --url http://localhost:8124
```

It prints an `https://…trycloudflare.com` host; open both machines on
`https://harvest-jam.netlify.app/?relay=wss://<that host>`. Note **wss**. The URL changes
every restart, which is the argument for giving the relay a real home.

Whichever route: press **Join…** and pick the room rather than typing its name, and read the
head bar — it names the transport. `via this machine` means BroadcastChannel, which reaches
other tabs and nothing else.

## Do these first

1. ⚠️ **Talkback's send half has never run.** Microphone capture is blocked in the automation
   harness, so `start()` in `shell/talk.js` has been read and not executed. The receive path,
   the strip exclusion and the denied-mic failure are all verified. **Try it on real hardware
   before building anything on top of it.**
2. ⚠️ **Audible timing after the clock change is unverified.** `shell/clock.js` now ticks off
   an AudioWorklet — 47.9 ticks/s where `setInterval` gave 1.0 in a hidden tab. The mechanism
   changed, not what it calls, so the risk is low, but the step playhead is rAF-painted and
   the harness tab is hidden, so nobody has *listened*. One pass of a drum pattern settles it.
3. **Give the relay a home with TLS**, if the public site is meant to work without a tunnel
   running. It is a 200-line stdlib Python file; Fly, Railway or Render will each host it.
   Netlify cannot — it serves static files only.

## Then

- ⚠️ **Patterns are last-writer-wins.** Two people editing one grid overwrite each other every
  220 ms tick. The owner label on each plate is the only coordination on offer. Real locks
  need the relay to arbitrate, which is a small addition now that the relay exists.
- **The relay speaks text frames only**, so all audio is base64 — a third larger than it needs
  to be. Binary frames are worth adding the day something bigger than a loop travels.
- **`[hidden]{display:none !important}` ships only in the studio build**, so script-hidden
  controls stay visible in the standalone pages. PM·1's arp controls are the visible symptom.
- **No hardware MIDI test**, still. All MIDI is verified against `tools/build-midi-harness.py`.
- ⚠️ **Phase 7, the Arcade, is still not done** — different repo; its notes are in the earlier
  session brief in git history.

## What a jam does not share

CS·1 has no patch channel: its progression, key and mood *are* its pattern and the scene
already carries them. LP·1 shares takes only when pushed, never automatically. Nobody's
transport position is shared — everyone fires their own rows, deliberately.

## The six ideas worth not losing

- **The seam is why any of this works over a network.** Nothing says "change now", it says
  "change at boundary N", and each client works out when that is on its own. A message only
  has to BEAT the boundary. The 200 ms lookahead was built for audio and turns out to be a
  jitter buffer.
- **State is polled; events are pushed.** Patterns and patches are "what is true now" and are
  compared against the last thing sent, which catches every way they can change including the
  ones added later. A note is an event and goes immediately. Backwards, this either floods the
  wire or needs a dozen hooks that the next gesture forgets to join.
- **What travels as audio is what has no pattern.** Synths are patterns everyone renders. The
  looper, the metronome and the talkback are the exceptions, and each needs a strip the
  looper's tap excludes or it ends up printed into every take.
- **The tick belongs on the audio thread.** `setInterval` stops in a tab you cannot see, and
  Chrome's audio-playing exemption hides that until the one case that matters: a client in a
  session with nothing sounding, waiting to fire a row.
- **A cell writes, the row button plays.** The launcher's whole grammar.
- **Measure, and validate the detector.** Four "bugs" this session were the measurement: a
  26 ms clock agreement that meant nothing because both sides were self-consistent about a
  meaningless number; `pips: 4` that was rAF not running in a hidden tab; a silent take that
  was a wrong test key; and a "~11 expected" that was a bad estimate, not bad code.

## Working habits that paid off again

Reproduce before fixing — every bug fixed properly this session was measured first, and two
turned out to be different bugs than they looked. Test through the real call path: the
Program-mode note write passed when driven through the on-screen keys and failed from the
computer keyboard, which is how the wrong hook was found. When a measurement looks like a
pass, check it is measuring the thing you think.

⚠️ And: **the browser automation pane plays through the machine's own speakers.** A test tab
left with DR·1 running is audible to whoever is sitting there. Stop every transport *and*
suspend the audio context at the end of each test, not at the end of the session.
