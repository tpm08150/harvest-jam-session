# Session brief — 2026-08-28/29

Written to hand this to a fresh context window. `HANDOFF.md` is the reference for *how
things work*; this is *what happened and where it stands*.

## Where it started and where it is

It started as **Patchwork**: two independent one-file synths, CS·1 and MS·1, with MS·1
untracked in the working tree.

It is now **Harvest Jam Session** — one browser DAW on the `studio` branch, 23 commits,
none pushed.

| | |
| --- | --- |
| **DR·1** | drum machine, eight synthesised voices |
| **BS·1** | bass, was MS·1's bass section |
| **CS·1** | chord synthesizer, unchanged in character |
| **PM·1** | poly/mono synth, was MS·1 minus the other two |
| **VC·1** | vocoder, was MS·1's vocoder section |
| **LP·1** | audio looper, one take per scene row |

That is the rack order, and it is set by registration order in `src/studio/parts.txt`.

`MS·1 is gone` — split into PM·1, VC·1 and BS·1, its build removed, `/mono` pointing at
PM·1 so saved links survive. Recoverable from git if ever needed.

## What was built, in order

1. **A build.** `tools/build.py` joins fragments under `src/` into the shipped HTML. A pure
   concatenation — no templating — so `git diff` after a rebuild is the whole verification.
   `--check` fails if a shipped file was hand-edited. Phase 1 proved it byte-for-byte.
2. **A shell** (`src/shell/`) owning everything singular: the audio context and per-instrument
   strips, one clock with one grid origin, one MIDI router, panel roots and keyboard focus,
   scenes, faces, recording.
3. **Instruments** as panels rather than pages. `$` takes a root; CSS is `@scope`d per panel.
4. **DR·1**, then **LP·1**, then the MS·1 split, then the live page.

## The four ideas worth not losing

- **The seam.** Everything schedules ~200 ms ahead, so anything that changes what plays has
  to happen *inside* the scheduling loop, not on the click. Scene fires, pattern swaps,
  stops, and the looper's take all land on a grid boundary this way.
- **Measure, don't dial.** DR·1's kit went from 30.6 dB apart to 0.34. VC·1's carrier trim
  was found by running one modulator through both instruments and reading a constant 23.07 dB
  offset. Every such number is in `HANDOFF.md` next to how it was taken.
- **The level harness is stochastic.** `Math.random()` fills the noise buffers, so one sweep
  proves nothing — four runs of the same build spanned 1.29 dB. This bit twice.
- **Validate the detector.** Three of the session's "bugs" were bad measurements: a wrong
  MIDI test note, a fixed window that under-measured short sounds, and a computed-style
  baseline captured at a different viewport.

## Live page — the current shape

Arm tracks; the row ▶ buttons become red ●. Pressing one **records the armed tracks into
that row and fires the rest**. There is no global record button — a row is the destination,
so a row is the button.

- Armed + `live` (PM·1, VC·1, BS·1, DR·1): notes you play land on the grid as you play them.
- Armed, not live (CS·1): a row press stores its progression.
- Armed with slots (LP·1): a row press records an audio take into that row.
- **An empty cell stops that instrument.** A row is a complete picture.
- **When** a row lands: Instant / Bar / Pattern, where Pattern is CS·1's progression coming
  round. Computed from the shared clock, so no cross-instrument signalling.
- **Cmd-shift-click** empties a block.

## Known open items

- ⚠️ **Phase 7, the Arcade, is not done.** `pm-toolbox/src/components/Game.jsx` needs one
  entry in `GAMES`, and two fixes: the iframe's `allow` is `"autoplay; fullscreen"` and
  needs `midi; microphone` **per entry** (the other games should not request either), and
  the wide gate is `721×620`, which is the width the faces must survive. Different repo.
- ⚠️ **Six instruments no longer fit one 2000 px screen in faces mode** — seven grid items
  at a 350 px floor is five columns, so two rows. Fitted at four. Needs a narrower face or a
  way to hide an instrument; that is a design call, not a bug.
- **Nothing is pushed**, and the branch is `studio`, not `main`.
- **No hardware test.** All MIDI is verified against `tools/build-midi-harness.py`.
- The `Patchwork` JS namespace is deliberately unchanged — it is the codename, not the brand.

## Working habits that paid off here

Build after every block when removing interwoven code, and let the browser find the next
dangling reference rather than guessing the whole set. Cutting by line or by regex broke
multi-line statements three separate times; matching braces did not. Take a measured
baseline *before* touching anything you will have to prove you did not break.

And stop the dev server and every transport when a test finishes — a looping drum machine
left running is somebody's actual afternoon.
