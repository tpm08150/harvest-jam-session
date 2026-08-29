# Patchwork Studio — plan

Merging CS·1 and MS·1 into one program, adding a drum machine and a scene launcher, and
landing the result on the Harvest Hub's Arcade tab.

Everything in the "What we know" section below is measured against the current files.
Everything in "The plan" is intent.

---

## What we know

The merge is smaller than 360KB of HTML suggests, because of four things that are already
true:

**Both scripts are `(() => { "use strict"; … })()`.** Nothing either file defines is global.
Two 4,000-line bodies that both declare `P`, `MIDI`, `tick()` and `$` can sit in the same
document today without colliding. The expensive half of merging two large scripts has
already been paid.

**Neither file uses `getElementById`.** Every DOM lookup in both goes through one line:

```js
const $ = s => document.querySelector(s);   // chord-synth:1437, mono-synth:2641
```

Change `document` to a per-instrument root and all 28 duplicate ids stop mattering. The
scoping job is that line plus 7 direct `document.querySelector` calls per file, not a sweep
through thousands of queries.

**The transports are the same transport.** 25 ms interval, 200 ms lookahead, `bpmExact`
driving the grid with the rounded value for display only — CS·1 at `chord-synth:988`, MS·1 at
`mono-synth:2384`, and MS·1's comment says outright it came from CS·1. Collapsing them into
one clock is deletion, not design.

**No `fetch`, no `decodeAudioData`, anywhere.** Both instruments are pure synthesis. Drums
built the same way cost no payload and keep the single-file deploy intact.

### What it actually costs

| | |
| --- | --- |
| 28 duplicate DOM ids | Solved by the `$` change above, once each instrument owns a root element |
| 30 divergent CSS selectors | Of 70 shared, 40 are already byte-identical. `.card`, `.plate`, `.btn.primary`, `.hfader`, `.led`, `.seg` and 24 others have drifted and need one version to win |
| 12 document/window listeners | Enumerable and small. Both files listen for `keydown` on `document`; the shell has to decide who owns the computer keyboard |
| Two MIDI stacks | Each calls `requestMIDIAccess` and owns learn, channel filtering, panic and note-out. One router that fans out by channel is the largest genuinely new piece of architecture |
| One `AudioContext`, one `setSinkId` | Per-instrument channel strips into a master bus |

### The real risk is render cost, not correctness

The click investigation in `HANDOFF.md` found the constraint: CoreAudio gives the browser's
render thread a **10.67 ms budget per IO cycle** at 512 frames / 48 kHz, and punches a hole in
the output when it overruns. Four instruments sounding at once — a 12-voice chord, six poly
voices at ×5 unison, a 16-band vocoder and drums — is a materially larger graph than
anything measured so far.

This is measurable before it is a problem. `tools/build-capture-harness.py` already records
the master bus to a WAV and injects a known 1.5 ms click for validating detectors. Phase 3
should render the worst case offline and check the budget rather than waiting to hear it.

---

## The shape

```
Shell
├── Clock         one transport. bpmExact, 200ms lookahead, MIDI clock follow,
│                 CS·1's phase lock promoted to serve every instrument
├── Bus           one AudioContext. per-instrument strip → master → setSinkId
├── Router        one requestMIDIAccess. routes notes in by channel, fans out,
│                 owns learn and panic across all four
├── Keys          arbitrates the computer keyboard between instruments
├── Scenes        pattern banks per instrument, switched on a musical seam
└── Instruments   each a factory(root, ctx, clock, bus, router)
    ├── CS·1      chord synthesizer      (existing)
    ├── MS·1      mono/poly + vocoder    (existing)
    └── DR·1      drum machine           (new)
```

Each instrument keeps its `chordEvents()` / `stepEvent()` discipline — one event list feeding
both the internal engine and MIDI out, so the two cannot drift. The shell never generates
notes; it only says when.

### Source layout

Split for editing, concatenated for shipping. `tools/build-phase-harness.py` and
`ios/build-test-harness.py` already generate HTML from Python, so this is the pattern the
repo has rather than a new one — and it keeps the zero-npm, one-file-deploys rule.

```
src/
  index.html            template with slots
  style/                base.css, controls.css, per-instrument sheets
  shell/                clock.js, bus.js, router.js, keys.js, scenes.js
  instruments/          cs1.js, ms1.js, dr1.js
tools/build.py          → patchwork-studio.html
```

The two existing apps keep building from the same sources for as long as that is useful, so
there is never a window where the working instruments are unavailable.

### Scene launcher

Clip-based, not a timeline. Each instrument owns a bank of patterns; firing one queues it and
it takes effect on the next musical seam — the same quantised-recall behaviour CS·1 already
has in `queueRecall()` / `takePending()`, generalised. A scene is a row: one pattern per
instrument, fired together.

Nothing is a take. Everything is a switch. That is what makes it playable rather than edited.

### Live face and deep panel

Each instrument shows a small performance face by default — the handful of controls you touch
while playing — with its full existing panel one click away. No control is lost; MS·1 keeps
all 50 knobs. This is what makes four instruments fit the Arcade's 721px floor without
becoming a wall.

### Drums

Synthesized, 808/909-shaped: kick, snare, hats, clap, toms from oscillators and noise. Same
per-step model as MS·1's grid — gate, accent, and parameter locks — and the same offline
measurement discipline, so kit levels are trimmed against a target rather than dialled by ear
the way CS·1's twelve voices were not.

---

## The plan

**Phase 0 — commit MS·1.** It is 4,700 lines and 221KB, and it is untracked. Nothing else
starts first.

**Phase 1 — build script, no behaviour change.** Split both files into modules; `tools/build.py`
reassembles them. Checkpoint: the two apps still build and still work, and the output diffs
cleanly against what is deployed today.

**Phase 2 — scope the DOM.** `$` takes a root. The 12 document listeners move to the shell.
Checkpoint: both instruments on one page, both playable, nothing collides.

**Phase 3 — one clock, one bus, one router.** Delete the second transport. Promote the phase
lock. Checkpoint: a CS·1 chord and an MS·1 line lock together and both follow external clock;
worst-case render cost measured against the 10.67 ms budget.

**Phase 4 — DR·1.** New instrument, existing patterns.

**Phase 5 — scene launcher.**

**Phase 6 — live faces.** The performance UI, and the 721px layout.

**Phase 7 — Arcade.** See below.

---

## Landing it in the Harvest Hub

Adding it is one entry in the `GAMES` array in `pm-toolbox/src/components/Game.jsx`. Two
things block it as that file stands:

**The iframe's `allow` is `"autoplay; fullscreen"`** (`Game.jsx:113`). Web MIDI is gated by
the `midi` Permissions Policy and the vocoder by `microphone`; both are denied silently in a
cross-origin iframe without them. The array is uniform today, so this needs a per-entry
`allow` field rather than a change to the shared one — the games have no business asking for
MIDI or a microphone.

**The wide gate is `(min-width: 721px) and (min-height: 620px)`** (`Game.jsx:57`). Below it a
phone opens the app in a new tab instead of embedding it, which is right. It also means 721px
is the width the live faces must actually work at.

Worth saying plainly: this is a break-room tab next to a forklift time trial and a boxing
game. The thing that belongs there is the scene launcher with four live faces — something
someone can make a loop on in ninety seconds. The deep panels are for the standalone build.
