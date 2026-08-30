# Session brief — 2026-08-29 (second session)

Written to hand this to a fresh context window. `HANDOFF.md` is the reference for *how
things work*; this is *what happened, where it stands, and what to do next*.

## Where it stands

**Merged, pushed and live.** `main` is at `6123fb2`, deployed at **harvest-jam.netlify.app**
— the app is called *Jam Session* now; only the hostname still says Harvest, deliberately,
because renaming that would break the live site and the relay. `python3 tools/build.py
--check` passes on all **eight** outputs.

```
6123fb2 Check a relay you cannot empty
b1cd55e A mixer, a transition synth, and a bar that was never late
e7353e9 Give the relay a home, so the link jams
9ca2b60 Hand this to the next context window        <- the previous session ends here
```

⚠️ `b1cd55e` is one commit doing about fifteen things, which is not this repo's habit. The
reason is mechanical: `--check` requires the eight built HTML files to match `src/` exactly,
so every intermediate commit needs its own rebuild, and splitting a tree that already
contains every change produces commits that fail their own contract. Split future batches
*as they are made* rather than at the end.

## What this session was

The jam went from "works on a LAN if you run a Python script" to "open the link". Then a
long run of instrument work on top of it: a mixer, a new instrument, and the bug that had
been making CS·1 a bar late since before anyone noticed.

## Running a jam

**Open harvest-jam.netlify.app.** That is the whole procedure now. `HOME_RELAY` in
`shell/session.js` points at a Cloudflare Worker, and a page with no `?relay=` uses it.

- The relay is `relay/worker.js`, deployed at `wss://harvest-jam-relay.tmorton-e18.workers.dev`
  on the free plan. `cd relay && npx wrangler deploy` redeploys it; `npx wrangler tail` reads
  its logs. Redeploying needs no studio rebuild — only *changing its address* does.
- ⚠️ The subdomain is `tmorton-e18`, not the `hmxlive` that was typed into the dashboard;
  that registration did not take and Cloudflare fell back to an email-derived name. It is
  invisible plumbing, but changing it means rebuilding all eight pages.
- `?relay` alone still means "a relay on this host, port 8124" for two laptops on a LAN.
  `?relay=off` is same-machine-only, for testing the model with two tabs.

⚠️ **There are two relays and one protocol.** `tools/jam-relay.py` is not legacy — it is what
you run on a LAN with no account and no internet. Nothing stops them drifting except
`tools/relay-check.py`, which holds both to the same 25 assertions. Run it against both after
touching either; it is safe to point at the live relay with strangers on it.

## Do these first

1. ⚠️ **Nobody has LISTENED to TS·1.** Every claim about it is a measurement — sweep
   envelopes, fill positions, reverb tails, voice counts — and not one note of it has been
   heard by a human. The thirty fills are verified to fire the right voices at the right
   times and are entirely unproven as *music*. Play it before building anything on top.
2. ⚠️ **Talkback's send half has still never run.** Microphone capture is blocked in the
   automation harness, so `start()` in `shell/talk.js` has been read and not executed. The
   receive path and the denied-mic failure are verified. Carried over, still true.
3. ⚠️ **Audible timing is still unverified by ear.** The clock ticks off an AudioWorklet, and
   `claim()` gained a boundary window this session. Both were measured carefully and neither
   was listened to. One pass of a drum pattern with two instruments settles it.

## Then

- ⚠️ **Patterns are last-writer-wins.** Two people editing one grid overwrite each other every
  220 ms tick. The owner label on each plate is the only coordination. Real locks need the
  relay to arbitrate, which is a small addition now that a relay exists.
- **The relay speaks text frames only**, so audio is base64 — a third larger than it needs to
  be. There is a second reason now: the hosted relay caps a message at 1 MiB and closes the
  socket over it, so `pushTake()` refuses a take that would not fit. Opus is nowhere near the
  cap; the PCM fallback, on a browser with no WebCodecs, is.
- **CS·1 keeps its own patch browser.** The other five share `shell/patches.js`. CS·1's
  carries a progression, a MIDI program number and a trigger note, so converging them is real
  work rather than a tidy-up.
- **A room name is not a password.** Anyone who opens the studio can list the running jams and
  join any of them. Somebody was sitting in a room called `jam` while this was written.
- **No hardware MIDI test**, still. All MIDI is verified against `tools/build-midi-harness.py`,
  including the new central routing and follow mode.
- ⚠️ **Phase 7, the Arcade, is still not done** — different repo; notes in git history.

## What is new, and where the ideas live

- **TS·1** (`src/ts1/`) — the transition synth, and the only instrument that answers "what
  happens next" rather than "what is playing". Arm it; it finds the next boundary of the
  chosen length, starts the right distance before it, and resolves on it. Thirty drum fills,
  a gated reverb, and carry-over into the next part.
- **Three shell registries**, each existing to stop a second implementation of something:
  `chords.js` (CS·1 provides a progression, others fill their sequences from it), `kit.js`
  (DR·1 provides its voices, TS·1 plays fills on them), `patches.js` (the save/name/export
  browser). ⚠️ `patches.js` does **not** define what a sound is — `session.registerPatch()`
  already does, and an instrument hands the same object to both so they cannot drift.
- **The mix** (`shell/bus.js`) — faders, mute and solo at the foot of the launcher, never
  shared with a jam, and ⚠️ **pre-fader taps**: your mix changes what you hear and not what
  the looper prints.

## The ideas worth not losing

- **The seam is why any of this works over a network.** Nothing says "change now", it says
  "change at boundary N", and each client works out when that is on its own.
- **State is polled; events are pushed.** Patterns, patches and now the chord progression are
  "what is true now" and are compared against the last thing sent, which catches every way
  they can change including the ones added later.
- **What travels as audio is what has no pattern.** Synths are patterns everyone renders; the
  looper, the metronome and the talkback are the exceptions.
- **The tick belongs on the audio thread.** `setInterval` stops in a tab you cannot see.
- **A cell writes, the row button plays.** The launcher's whole grammar.
- ⚠️ **A hair past a boundary is still that boundary.** One row press could start two
  instruments a bar apart: the first defines the grid, the second calls 5.3 ms later, sees
  itself past the line and `Math.ceil` rounds a hair into a whole quantum. Silent,
  tempo-correct, and only with more than one instrument playing — the hardest shape of bug
  there is, and the user diagnosed it before the code did.
- **One definition of a thing, handed to two consumers.** The pattern that kept recurring:
  the sound object given to both the jam and the patch store; one protocol held by two
  relays; one clear-locks button mounted by three instruments.

## Working habits — and the one that went wrong

Reproduce before fixing, and test through the real call path. Both paid off again.

⚠️ **But the measurements were wrong seven times this session, always the same way: measuring
the quantity that was easy to reach rather than the one that mattered.**

- `level()` read `gain.value`, which reports the last *rendered* value — a ghost on a strip
  that had gone quiet. One fader read 0.5 while its audio measurably ran at 0.2.
- A clear-locks test dispatched `click` at a `pointerdown` handler.
- A PM·1 chord test set the state directly and never touched the UI.
- A tom-cascade test compared tune *ratios* across two differently-tuned toms, where the same
  ratio is a different pitch.
- A duplicate-id sweep matched `id="…"` inside an HTML comment.
- A quantisation test ran with no transport going, so it measured nothing and reported a
  regression that did not exist.
- `relay-check.py` asserted the relay was empty, which is true in a lab and false against the
  one people use — four red lines and a working relay.
- **And the one that reached the user: TS·1's drum fills were tested by setting `TS.fill` in
  JavaScript. The engine worked; the button was wired to the wrong element and had never once
  been clicked.** A duplicate `id` that had been noticed and worked around instead of fixed.

The rule that would have caught all of them: **drive it the way a person does, and when a
measurement looks like a pass, check it is measuring the thing you think.** A green test on a
control nobody has clicked is not evidence.

⚠️ And still: **the browser automation pane plays through the machine's own speakers.** CS·1
was left running audibly this session and the user had to say so. Stop every transport *and*
suspend the audio context at the end of each test, not at the end of the session.
