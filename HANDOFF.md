# Patchwork — handoff

Context for picking this up cold. Everything below is verified unless it says otherwise.

- **Repo** <https://github.com/tpm08150/chord-synth-1>
- **Live** <https://chord-synth-1.netlify.app/> (auto-deploys on push to `main`)
- **Hardware** Teenage Engineering EP-133 (MIDI in + clock, class-compliant USB audio),
  EP-136 mixer fed from the synth's audio out. Mac + iPhone 17 Pro (iOS 26.5.1).

## What it is

Two independent instruments in one repo, each **one HTML file**, no build step, no
dependencies.

- **CS·1** — `patchwork-chord-synth.html`, ~3100 lines. A chord synthesizer that generates
  progressions, plays them through a small Web Audio engine, and drives hardware over MIDI.
  An iOS wrapper hosts this file unmodified and supplies the one API iOS lacks.
- **MS·1** — `patchwork-mono-synth.html`, ~3000 lines. A mono synth for leads and basses,
  added later. Deliberately standalone: its own transport, no clock follow, no dependency
  on CS·1. See the MS·1 section near the end.

## Layout

```
patchwork-chord-synth.html   CS·1 — BUILT. Do not edit; edit src/cs1/ and rebuild
patchwork-mono-synth.html    MS·1 — likewise, from src/ms1/
patchwork-studio.html        both instruments on one page, from src/studio/
src/
  shell/                     what only one of can exist on a page
    host.js                  panel roots and keyboard arbitration
    tokens.css, reset.css    one copy, shared by every build
  cs1/, ms1/                 each instrument: panel.html, panel.css, and its script
  studio/                    the page that hosts both
  */parts.txt                the fragments that build, in order, as paths under src/
tools/build.py               joins them. `--check` fails if a built file was hand-edited
serve.py                     dev server that disables caching (see gotchas)
netlify.toml                 publish from root, rewrite / to the html, no-store on html
ios/
  midi-bridge.js             Web MIDI shim over a native bridge, injected at document start
  Sources/*.swift            canonical Swift; copied into Patchwork/Patchwork/ when changed
  build-test-harness.py      generates _iostest.html — the app + a mocked native side
  README.md                  bridge contract and Xcode setup
tools/
  build-phase-harness.py     generates _phasetest.html — the app + a synthetic MIDI clock
Patchwork/                   the Xcode project (Xcode 16 synchronized groups)
```

`ios/Sources/*.swift` and `Patchwork/Patchwork/*.swift` are duplicates — **edit `ios/Sources`
and copy across**, or they drift. The two web resources are *not* duplicated: a build phase
copies them from the repo root into the bundle on every build.

### The two HTML files are build output

They stay committed, because Netlify publishes from the root with no build step and the iOS
build phase copies them into the bundle — the one-file, no-dependency rule is about what
*ships*, not about what you edit. At 13,000 lines across two apps, editing them by hand was
the thing that had to go.

The build is a **pure join**: every line of a shipped file lives in exactly one fragment, and
`tools/build.py` concatenates them in the order `parts.txt` gives. No templating, no
substitution — so `git diff` after a rebuild is the whole verification, and there is nothing
a diff could miss.

```bash
python3 tools/build.py           # write both apps from src/
python3 tools/build.py --check   # verify they match src/, write nothing
```

`--check` catches the one way this layout rots: a shipped file edited directly, whose change
the next build silently reverts. Worth a pre-commit hook. It also fails on a fragment that
exists but is absent from `parts.txt`, since that would otherwise just quietly not ship.

### Instruments are built into a panel, not into the document

Both apps were written as whole pages, which is why they share 28 element ids and 30 CSS
class names and never noticed. An instrument now receives a **root element** and queries
inside it:

```js
Patchwork.instrument("cs1", root => {
  const $  = s => root.querySelector(s);
  const $$ = s => root.querySelectorAll(s);
```

That one change is what makes the duplicate ids harmless — `#play` resolves per panel. It
was cheap because neither app ever used `getElementById`; every lookup already went through
`$`.

CSS is scoped with **`@scope`, not nesting**, because `@scope` adds no specificity: every
rule inside keeps exactly the weight it had when the stylesheet was a whole page. Rules that
cannot be scoped — `:root`, `*`, `html`, `body` — moved to `shell/`. They were byte-identical
in both apps, and so were all 12 shared tokens, so this merged rather than picked a winner.

**The shell's own stylesheet is the one that can still collide**, since it is page-wide by
definition. `tools/build.py` fails the build if it uses a class name an instrument owns —
added after the studio's layout class `.rack` silently restyled the inside of MS·1, which
already had one.

⚠️ **The computer keyboard goes through `Patchwork.onKey`, never `document`.** Both apps
listening on `document` meant every instrument saw every key: with both on one page, `n`
made a new progression while you were playing MS·1. A **keyup is routed to whichever panel
received its keydown**, not to whatever has focus now — route it by focus and a note held
while you click the other panel never gets released.

A page with one instrument takes the identical path, so the standalone builds are not a
second configuration that can rot untested.

## Running it

```bash
python3 tools/build.py              # after ANY edit under src/
python3 serve.py                    # http://localhost:8123/patchwork-chord-synth.html
PORT=9000 python3 serve.py          # ...or anywhere else
python3 ios/build-test-harness.py   # then open _iostest.html to test MIDI without hardware
python3 tools/build-phase-harness.py  # _phasetest.html — synthetic clock + drift measurement
```

`_phasetest.html` drives the app from a fake Web MIDI input and records what the app actually
schedules, so drift is measured from oscillator times rather than from the app's own opinion
of its accuracy. Press Play, then in the console: `__phase.start(120)`, and after a few
minutes `__phase.slope()` for ms/min. `__phase.step(ms)` shoves the clock grid sideways to
watch the loop pull it back. **It plays audio until you stop it** — `__phase.stop()` halts the
clock, and the Play button still stops the transport.

Web MIDI needs a secure context, so `file://` will not work — localhost or the Netlify URL.
iOS builds need full Xcode (26.x for this device) and run to the phone from Xcode.

## CS·1 map

| Area | Where |
| --- | --- |
| Chord theory, spelling | `QUAL`, `POOLS`, `DIATONIC`, `rootName()`, `makeProgression()` |
| Synth voices | `VOICES` (12), `PERIODIC_SPEC` for wavetables |
| Note scheduling | `chordEvents()` — single source of truth for engine *and* MIDI out |
| Envelopes | `trigger()` |
| Transport | `tick()` — 25ms interval, 200ms lookahead |
| Held MIDI pads | `padTick()` — separate scheduler for pads held down |
| Params | `P` (faders), `state`, `MIDI`, `ARP`, `PULSE`, `BASSQ`, `SW`, `SYNC` |
| Patches | `snapshot()` / `restore()`, `PATCH_VERSION`, `TONE_RANGES` |
| Patch recall by MIDI | `patchNotes`, `progMap`, `RECALL`, `queueRecall()`, `takePending()` |

### Design decisions worth not undoing

- **`chordEvents()` builds one event list** consumed by both the internal engine and MIDI
  out, so the two cannot drift apart. Anything that changes what's played goes there.
- **Chord names are spelled from scale degree**, not a chromatic lookup — that's the only
  way `♭VII` in C reads as `B♭` rather than `A♯`. A lookup table cannot spell borrowed
  chords no matter how the key signature is chosen.
- **Pads fill bottom-up** via explicit `grid-row`/`grid-column`, so document order stays
  `1..n` and `paint()`, `flashPad()` and the pad badges all index into it correctly.
  Do not "simplify" this by reversing the DOM.
- **Patterns repeat over longer pads rather than stretching.** A 2-bar pad plays the
  8-step pattern twice at the same speed.
- **`bpmExact` drives the transport; `state.bpm` is display only.** Deriving bar length
  from a rounded tempo caused ~180ms/min of drift against external clock.
- **Horizontal faders register in `faderCtl`** exactly like the vertical bank, so they get
  MIDI learn, patch save and CC control for free.

## iOS wrapper

The web app is **not modified** for iOS. `midi-bridge.js` is injected as a `WKUserScript`
at document start and defines `navigator.requestMIDIAccess()` over CoreMIDI. It declines to
install when a real implementation exists, so the same file still runs in a desktop browser.

Bridge contract (also in `ios/README.md`):

```js
// JS -> native, via window.webkit.messageHandlers.patchworkMIDI.postMessage
{op:"init"} | {op:"send", port, bytes, delayMs} | {op:"clear", port}
// native -> JS
window.__patchworkMIDI.onDevices([{id,name,type}])
window.__patchworkMIDI.onMessage(portId, [bytes])
```

`delayMs` matters: the sequencer schedules up to ~2.8s ahead, and the shim converts Web
MIDI's absolute timestamps to a delay so CoreMIDI places the packet. Re-timing those in a
JS timer would throw away the lookahead's accuracy.

The wrapper also fixes two things beyond MIDI: an `AVAudioSession` `.playback` category so
the ring/silent switch doesn't mute it, and a 5ms preferred IO buffer — the phone reports
**1.8ms output latency**, far better than desktop's ~32ms.

## MIDI input channels — both instruments

**`MIDI.ch` is the OUTPUT channel and always was.** Neither app ever tested the channel
nibble on input, so both answered on every channel whatever the selector said. CS·1's
`onMidi` had no channel test at all; MS·1 extracted `ch` but only consulted it in "by
channel" routing mode, leaving split mode omni.

Both now have an **In ch** filter (Omni | 1–16), defaulting to Omni so the old behaviour is
the default. The selector previously labelled `Channel` is now `Out ch` in both.

**The filter must sit AFTER the system-realtime handling.** Clock (`0xF8`), start, continue
and stop carry no channel — filtering them would silently break clock sync, which is CS·1's
most carefully tuned feature. In CS·1 the test goes immediately after `if (s >= 0xF0) return;`,
which is already past all of it. There is a regression check for exactly this.

MS·1 has **three** input channels and no global one: `synCh`, `vocCh` and `ccCh`, each
Omni or 1–16. There is deliberately **no "route by split / by channel" mode** — a mode
switch on top of three channel selects was one control too many, and the modes overlapped.

`routeFor(ch)` returns `"syn"`, `"voc"`, `"both"` or `"ignore"`. Omni means "anything the
other section has not claimed", so an explicit channel beats Omni; both Omni, or both on the
same channel, returns `"both"` and the note **layers** — a real sound (a dry lead doubling a
vocoder line) rather than an error state. A section that is switched off claims nothing.

| synCh | vocCh | ch1 | ch2 | ch3 |
| --- | --- | --- | --- | --- |
| Omni | Omni | both | both | both |
| Omni | 2 | syn | voc | syn |
| 1 | 2 | syn | voc | ignore |
| 1 | 1 | both | ignore | ignore |

**CC and program change ride `ccCh`, not a section's channel** — they are control, not
performance. Pitch bend does NOT: it stays with whichever section owns the note channel, so
bending the lead cannot drag the vocoder chord with it. All-sound-off and all-notes-off are
honoured on **any** channel: a panic that only works if you guessed the right channel is not
a panic.

**The keyboard split is gone.** Once the vocoder has its own MIDI channel the split is
redundant, and half a keyboard was never really a routing scheme. What it did locally — the
on-screen and computer keyboards carry no MIDI channel — is now an explicit `Keys play:
Synth | Vocoder | Both` control, which is one control instead of two (split point plus
direction) and says plainly where local keys go. The keyboard tints whenever local keys
reach the vocoder at all.

CS·1 now carries a `window.__cs1` test hook (`MIDI`, `onMidi`, `state`, `held`, `litPads`),
the same idea as `__ms1`, because the channel filter could not otherwise be driven and
asserted on without hardware.

## Gotchas that cost real time

**Testing through a headless or hidden browser pane invalidates two whole classes of
measurement**, and both produce confident, plausible, wrong answers:

- **`innerWidth`/`innerHeight` report 0**, so *every* `max-width` media query matches. A
  computed-style baseline captured with the pane visible and compared against one captured
  while hidden shows a scatter of "regressions" in exactly the properties a media query
  touches. Emulate an explicit viewport before capturing anything, and compare only
  like-for-like.
- **Transitions never advance**, because no frames are produced, so a transitioning
  property reports its START value forever. A focus ring with `transition:outline-color`
  reads as `transparent` no matter what the rule says. `requestAnimationFrame` never fires
  either, which will hang any test that awaits one.

Both of these cost time during Phase 4 and each looked exactly like a CSS bug.

- **iOS has no Web MIDI, in any browser.** All iOS browsers are WebKit. A PWA doesn't
  change it. That's the entire reason the wrapper exists.
- **The ring/silent switch mutes WebKit audio** in the browser. Cost an hour of
  misdiagnosis. The native wrapper is immune.
- **Xcode's script sandbox** (`ENABLE_USER_SCRIPT_SANDBOXING = YES`) denies writes a run
  script hasn't declared. Verifying with `-derivedDataPath /tmp` hides this because /tmp is
  permitted — always verify against the default DerivedData location.
- **Browsers cache the local dev page aggressively.** `serve.py` sends `no-store`; plain
  `python3 -m http.server` does not, and will serve a stale page after edits.
- **`localStorage` is per-origin and per-device**, so patches don't move between localhost,
  Netlify and the phone. Export/import JSON to carry them.
- The Claude Code Browser pane runs **hidden**, so `requestAnimationFrame` never fires
  there — anything rAF-driven can't be verified by DOM polling alone, only by screenshot.
- **Intermittent clicks are not this app's fault.** Cost the better part of a day. See below.

## Render cost, measured

The plan's open question was whether four instruments fit inside CoreAudio's IO budget.
Measured on a 2.0 GHz-class Mac at 48 kHz, `baseLatency` 5.33 ms — **note that is a
256-frame cycle, not the 512-frame/10.67 ms one the click investigation logged.** The
budget is the device's, not a constant.

Method: render offline at several durations and fit a line. Graph construction — the
reverb IR, the chorus, the vocoder bank — is a constant ~100 ms per render and would
otherwise swamp everything; the SLOPE is the per-second cost and the intercept is setup.
The first attempt skipped this and reported one note and unison ×5 as identical, which is
what a fixed cost looks like when you divide by duration.

| configuration | ms per audio second | % of realtime |
| --- | --- | --- |
| CS·1, 6-note chord, lightest voice (`wood`) | 27.5 | 2.8% |
| CS·1, 6-note chord, heaviest voice (`chrome`) | 35.4 | 3.5% |
| MS·1, one note, mono | 57.4 | 5.7% |
| MS·1, one note, unison ×5 | 62.1 | 6.2% |
| MS·1, 6-note poly chord | 132.7 | 13.3% |
| MS·1, 6-note poly, heaviest lead (`cobalt`) | 161.4 | 16.1% |
| DR·1, ordinary pattern (8 hits/sec) | 54.4 | 5.4% |
| **all three at their worst, summed** | **251.2** | **~25%** |
| ⚠️ DR·1, every voice on every sixteenth (64 hits/sec) | 838.1 | **83.8%** |

Unison ×5 costing 8% more than one note rather than five times as much is the shared
filter doing its job — the known compromise in the MS·1 section, showing up as the
measurement predicts.

The last row is the one to remember. A realistic arrangement sits near 25%, but **DR·1
alone can exceed the budget** if every voice fires on every sixteenth: nothing is pooled,
so 64 hits a second is 64 independent node graphs alive at once. Nobody programs that
pattern on purpose, and a busy one is nearer 20 hits/sec, but the ceiling is real and it
is the first place to look if the kit ever glitches. Pooling voices, or capping
simultaneous hits per voice, is the fix if it becomes one.

**Caveats, because these numbers will be quoted.** Offline rendering is a proxy: no IO
thread, no per-cycle overhead, and it can schedule differently from realtime. And the
click investigation's conclusion still stands above all of it: the overruns it found came
from **system load, not from this app's render cost**, and an old Chromebook played the
same app cleanly. Headroom here is necessary, not sufficient.

`__cs1.renderChord()` is new, and mirrors `__ms1.renderPatch()`. CS·1 had no offline rig,
which is why its twelve voices carry a measured 8.2 dB spread while MS·1's twenty patches
sit within a fraction of a dB — one instrument's levels were dialled and the other's were
measured. Trimming CS·1's is now possible.

## The level harness is stochastic — one run proves nothing

`__ms1.renderPatch()` is not deterministic, and the spread is **larger than the
differences people try to measure with it.** Four sweeps of all 20 factory patches, same
build, same page load, nothing changed between them:

| run | worst deviation from target |
| --- | --- |
| 1 | 1.29 dB |
| 2 | 0.81 dB |
| 3 | 0.41 dB |
| 4 | 0.45 dB |

**18 of the 20 patches move between runs**, `moss` by 1.12 dB on its own.

The cause is `Math.random()` in the audio graph: the noise buffers, the reverb IR and the
S&H table are filled at init and regenerated per page load, and `audio.js` starts each
noise source at **a random offset into its buffer per note**. Any patch touching noise,
S&H or reverb renders differently every time.

So the README's **±0.4 dB** is one draw from this distribution, not a bound. The trims are
still right — the mean is on target — but a single sweep cannot confirm or refute a change,
and reading one as if it could is how a change gets blamed for the harness. Average several
runs, or measure only the two patches that do not move.

⚠️ This bit during Phase 3: a shared-audio-bus change appeared to shift levels by 0.8 dB.
It had not. The change did not even touch the offline path — `renderPatch` always passes a
context, so the render still goes straight to `ctx.destination` — and the difference was
entirely the harness. **Verify by code path before believing a number from this rig.**

## The click investigation, so nobody repeats it

Symptom: a click or crunch every 5–10 seconds while playing, sometimes clean for minutes.
It is **not in the audio this app renders**, and no change to this code fixes it.

macOS logs the cause directly:

```bash
/usr/bin/log show --last 10m --predicate 'process == "coreaudiod"' --style compact \
  | grep -i overload
```

```
cause: ClientProcessIsThrottled, ClientHALIODurationExceededBudget, SafetyViolationOccurred
io_buffer_size: 512   sample_rate: 48000        # a 10.67ms budget per IO cycle
HAL_client_IO_duration: 13.5ms / 36.5ms / 14.5ms  # the browser overran it every time
safety_violation_sample_gap: 142 / 1759 / 681     # 3-37ms of audio missing = the click
```

The browser's audio render thread misses its deadline under system load, and CoreAudio
punches a hole in the output *below* the Web Audio graph. Hence: present in Chrome and
Safari alike, on every output device including built-in with no USB attached, absent from
buffered media playback (YouTube), immune to `latencyHint` (a larger Web Audio buffer does
not change the HAL's 512-frame IO cycle), and completely absent from a master-bus recording.
An old Chromebook plays the same app cleanly, so the synth's render cost is not the issue.

Things that are NOT the cause, each ruled out by measurement: clipping (level-independent,
zero samples at full scale), the reverb (still clicks with the ConvolverNode disconnected),
main-thread jank (zero stalls over 15ms), buffer size, MIDI, the phase lock, sample-rate
mismatch, and the output device.

If it returns, check system load first — `uptime`, and WindowServer / other apps in `ps` —
before touching audio code. Stale HAL plug-ins in `/Library/Audio/Plug-Ins/HAL/` that
predate a macOS upgrade are also worth clearing.

**The method that got there** is worth more than the answer: `tools/build-capture-harness.py`
records the master bus to a WAV *and* injects a known 1.5ms click on demand. Several
automatic artefact detectors gave confident wrong answers before that control existed —
one flagged 40 "discontinuities" in audio that was clean to the ear. Validate a detector
against a known-bad case before believing what it says about a known-unknown.

## State of play

Working and tested on hardware: MIDI in with chord pads, clock follow, MIDI out, panic,
audio to the EP-133/EP-136, the iOS app on the phone, background/foreground recovery.

**Verified only synthetically** (no hardware in the loop):
- CoreMIDI device discovery beyond "it found the EP-133" — deeper paths are untested
- MIDI learn on the phone
- Clock drift over long takes; measured 54ms/min in a test rig whose own jitter accounts
  for most of that. See the phase lock section below — a synthetic clock generated on the
  same machine can only ever show the ctx-vs-perf part of the skew, never a real device's
  crystal, so the EP-133 run is the one that counts

**Phase lock — implemented, off by default, not yet hardware-tested.** The transport used to
only *follow* clock tempo, so residual tempo error accumulated. `phaseSample()` now measures
where the grid sits against the incoming pulses and `phaseAdjust()` feeds that back into the
length of the next chord. The `Lock` switch in the MIDI row turns the feedback on; the
readout beside it shows live phase error and a fitted drift slope, and works with Lock off
too, so it can be used to measure before deciding to correct.

The root cause is worth knowing: tempo is measured from `performance.now()` timestamps but
spent against the `ctx.currentTime` grid, and those are two different crystals. A rate
mismatch between them becomes a tempo error that integrates forever. Simulated at 900ppm it
reproduces the ~54ms/min figure below almost exactly.

Measured so far — all without hardware, which is the gap:

| | |
| --- | --- |
| Open loop, simulated 900ppm skew | −562ms at 10 min |
| Proportional term only | −7.6ms standing offset — a P term cannot cancel a rate |
| With the integral trim | ±2ms held over 10 min, insensitive to gain, skew and jitter |
| Live in the browser rig, after lock | settles ±5ms, recovers from a disturbance at 5ms/s |

Two knobs earned their values by measurement rather than taste: `maxAdj` is 10ms because 4ms
took minutes to pull in and 20ms doubled the overshoot for little speed, and the integrator
only accumulates while the proportional term is unsaturated — without that anti-windup a
119ms pull-in overshot by 31ms and rang for 70 seconds.

**Also unproven:** incoming MIDI crosses the bridge one `evaluateJavaScript` call per
message. Clock alone is ~48/sec at 120bpm. If sync turns out jittery on hardware, batching
into an array flushed on a timer is the fix.


## MS·1 — mono synthesizer

Added after CS·1, as a separate program. Scope was settled deliberately: **standalone** —
its own transport, no MIDI clock follow, no phase lock, no reading CS·1's harmony. It does
take MIDI notes in (play it from a keyboard), mirror notes out (drive the EP-133), and learn
CCs to knobs. CS·1 plays the changes; MS·1 plays the line over them.

### Map

| Area | Where |
| --- | --- |
| The whole patch | `FACTORY_DEFAULT` (62 keys), live copy in `P` |
| Factory bank | `FACTORY` (20 patches), `FACTORY_ORDER` = program change 0–19 |
| Voice construction | `buildVoice()`, one unison member per `mkStack()` |
| Ladder filter | `ladder(res)` → two biquads, `RCOMP` for the low-end trade |
| Envelopes | `schedEnv()` / `schedRelease()` / `envValueAt()` |
| Note priority, glide | `pick()`, `glideTime()`, `noteOn()` / `noteOff()` |
| Step events | `stepEvent()` — single source of truth for engine *and* MIDI out |
| Transport | `tick()` — 25 ms interval, 200 ms lookahead, same shape as CS·1 |
| Knobs | `makeKnob()` / `KNOBS`, all registered in `ctlReg` |
| Offline measurement | `__ms1.renderPatch()` |

### Design decisions worth not undoing

- **A pulse is `saw(t) − saw(t−w/f)` from ONE oscillator through a `DelayNode`**, not a
  sawtooth clipped by a waveshaper. Measured with a 65536-pt FFT that buckets every bin as
  harmonic or not:

  | f₀ | shaper + DC, `oversample:"4x"` | saw − delayed saw |
  | --- | --- | --- |
  | 110.6 Hz | −55.3 dB | **−84.0 dB** |
  | 440.2 Hz | −38.7 dB | **−79.3 dB** |
  | 1758.5 Hz | −32.5 dB | **−96.7 dB** |

  40–64 dB less alias energy, and **exactly zero DC at every width** (the two saws' means
  cancel), which deletes the whole DC-compensation network the shaper version needs. −32 dB
  at 1758 Hz is audible grit, so the shaper is not merely worse, it is unusable for leads.

  Two earlier "findings" that pointed the other way were both **measurement artefacts**, and
  are worth knowing about because they are easy to repeat:
  - An alias metric that samples ~200 frequencies midway between harmonics misses aliases
    entirely — they land at |n·f₀ − k·f_s|, an arbitrary frequency. Use a full FFT.
  - A zero-crossing frequency counter reports the delay version "wobbling" 100↔120 Hz under
    PWM. It does not: the FFT fundamental holds at 220.05 Hz. A narrowing pulse simply gives
    the counter extra upward crossings.

- **`delayTime` must be ramped exponentially, never linearly, during glide.** A linear ramp
  wanders the pulse width by ~19% and collapses the tone toward a square mid-glide.
- **The filter is the analog ladder's own pole pairs**, not two lowpasses stacked by eye.
  `H(s) = 1/((1+s)⁴+k)` factors into two conjugate pairs; two RBJ sections placed there
  reproduce it exactly. Driving the knob from Q₁ rather than from k is what makes resonance
  even across the travel. Note `BiquadFilterNode.Q` is in **decibels** for lowpass/highpass.
  Verified in the running engine: resonance adds **+18.6 dB at the cutoff** and takes
  **−6.5 dB out of the bass**, which is the authentic ladder trade, and `fc₂` climbs to
  2.23× `fc` while `fc₁` barely moves — recompute both when resonance changes.
- **Web Audio normalises a biquad's DC gain to unity; a ladder does not.** So the cascade
  hands you the bass-*compensated* filter for free and you attenuate to get the real thing.
  `RCOMP = 0.30` is that dial.
- **`beginRelease()` exists because the ordering here is a trap that shipped broken.**
  `envValueAt(e, t)` decides which segment it is on by testing `t < e.tOff`. At exactly
  `t = tOff` that is false, so it takes the RELEASE branch and returns the old `e.vOff` —
  which is 0 on a note that has never been released. So writing

  ```js
  e.tOff = t;  e.vOff = envValueAt(e, t);   // WRONG — vOff always comes back 0
  ```

  starts every release from silence, and the Release control does nothing whatsoever. All
  three call sites had it. Measured before the fix: release 0.2 s and release 10 s produced
  **byte-identical output**, silent 50 ms after note-off. After: at 10 s the tail runs
  −24 → −43 dBFS over three seconds, matching `τ = R/6.9` to within about 1 dB.

  Read the value first, then mark the release — which is all `beginRelease()` does. Do not
  inline it again.

  **How this got missed** is worth more than the fix. The original envelope check measured
  `release at 1.5R = 0.0000 of sustain` and passed it, because the expected figure was
  `~0.001` and 0.0000 looked like "even better". It was the bug reporting itself. A later
  check measured "rms after the tail = −240 dBFS" and read that as *correctly silent*, when
  it actually meant *silent far too early*. **Assert the tail EXISTS, not just that it ends** —
  sample the decay at several points and require them to differ between release settings.

- **`AMP_REL_MIN = 10 ms` is a floor, not a taste call.** Below it a note-off is an abrupt
  amplitude step, which splatters broadband energy even though no individual sample jumps
  far — the click is the ENVELOPE's abruptness, not a discontinuity, which is why a
  max-sample-step metric shows *nothing* here and a spectral one shows it plainly. Measured
  on a 110 Hz sine with the filter open, so any HF at the release is the click and nothing
  else: energy falls ~6 dB per doubling of release time, and 0.5 ms → 10 ms is a **23.7 dB**
  reduction. No factory preset goes below 40 ms, so the floor costs nothing. Attack has no
  floor — a fast attack from silence is a legitimate transient, not a defect.

- **Envelopes are tracked analytically in JS as well as scheduled.** `param.value` cannot be
  read back for a running envelope (in an `OfflineAudioContext` it returns the value at time
  0), and a retrigger has to start its ramp from where the envelope actually is or it steps
  and clicks. Also: **`cancelAndHoldAtTime` followed by `linearRampToValueAtTime` drops to
  zero in Chrome** — do not use that pairing.
- **Attack is linear, decay and release are `setTargetAtTime` with τ = time/6.9.** A linear
  attack *terminates*; an RC attack never arrives and leaves the voice mid-ramp. Verified
  linear to within measurement noise over a 1 s ramp.
- **PWM has its own LFO.** Sharing the main LFO makes every pulse patch wobble in pitch too.
- **Chorus is a blend, not an addition.** Dry and wet are both scaled by 1/(1+wet) so the
  mode changes width and not level. Before that, switching chorus on was +3.5 dB and pushed
  `mercury` to a peak of 1.016 — clipping.
- **`stepEvent()` is the single event list** for the engine and MIDI out, the same rule as
  CS·1's `chordEvents()`.

- **Held notes are INPUT to a running pattern, never notes in their own right.** `noteOn`
  used to sound them directly *as well*, stacking a second voice on top of the arp's own
  output — which is why adding a key while others were held jumped out so loudly. Guarded by
  `seqOwnsVoice()`; with the transport stopped the keyboard plays normally. The same guard
  already suppressed MIDI-out mirroring, and the audio path should have had it from the
  start.

- **The sequencer transposes in scale DEGREES, not semitones.** Steps are stored as
  semitones from the root and quantised through `SEQ.scale` on the way out, so a held note
  moves the pattern by degrees and the pattern stays in key — holding the 2nd in C major
  turns C-E-G into D-F-A, not C#-F-G#. `toDegree()` rounds an off-scale semitone DOWN to the
  degree below it, so a recording made in one scale re-reads sensibly in another rather than
  being destroyed. `chromatic` is the default and is a straight semitone shift, which is the
  original behaviour.

- **Polyphony is a SEPARATE path, not "mono with a limit of 1".** `polyVoices` is a Map of
  note → voice; mono keeps one voice and re-pitches it. Glide, legato and note priority are
  all statements about a single voice *moving* and mean nothing with six of them, so poly
  simply does not use them. `buildVoice()` collapses unison to 1 outside `mode:"uni"`,
  because six voices times five unison members is thirty oscillator stacks and not a better
  sound. `MAX_POLY = 6`, stealing the oldest — and a stolen voice has to be released on MIDI
  out too, or the external synth holds it forever.

  Measured level budget, 1 → 6 voices: **−21.9 → −15.1 dBFS**, worst peak **0.844** on the
  pad. That is only ~7 dB of rise where a linear sum would give ~16, because the master
  compressor is doing real work; nothing clips.

- **Chord naming is the opposite problem from CS·1's.** CS·1 knows the key and spells from
  scale degree; MS·1 is handed a set of notes and has to guess. `CHORD_SHAPES` is ordered
  longest-first so a 7th is not reported as the triad hiding inside it, the bass is tried as
  root before the others because that is what the ear does, and a non-root bass is reported
  as an inversion (`C/E`) rather than silently renamed. Verified across triads, sevenths,
  suspensions, an inversion, a power chord and a bare interval.

- **Hold accumulates only where more than one note can be heard.** In poly, on the
  vocoder's paraphonic carrier, and in the arp — whose whole purpose is reading a held
  chord — a second latched note is a second sound. With a single mono voice, or a sequencer
  that takes exactly one transposition, it is not: the older note just becomes an entry
  fighting the newer one over one voice, and unreachable. So `latchReplaces()` makes Hold
  REPLACE there instead.

  `releaseLatched()` drops only notes that are latched — sounding but no longer physically
  held. A key still under a finger is left alone, because that one belongs to the player and
  note priority already governs it.

- **Hold is a toggle per note, not a global latch.** Pressing a note that is already
  latched releases just that one. It needs `downKeys` — the set of PHYSICALLY held keys —
  because once Hold is on, "sounding" and "key is down" stop being the same thing, and
  without that distinction a deliberate re-press is indistinguishable from the duplicate
  note-on some controllers send while a key is held. The release runs the ordinary
  `noteOff` path with `latch` momentarily false, so there is one release routine rather
  than a second copy of it. Works across mono, poly and the vocoder carriers alike.

- **The arp and the sequencer never show at once.** `paintMotionView()` swaps the roll for
  the step grid and hides the controls the other one does not read (`data-arponly` /
  `data-seqonly` on the markup). They are different instruments sharing a rack — one plays
  what you hold, the other plays what you wrote — and a step grid the arp never reads was
  just a second thing to scan past.

- **The arp roll is rebuilt on change, re-classed on playback.** Rebuilding the DOM every
  frame for a 24-note run would be wasteful; `renderRoll()` runs when the run itself changes
  (held notes, direction, octave range) and `paintRoll()` only toggles one class per frame.
  `scheduleStep()` returns the arp index it fired so the roll can light the right block —
  the step index alone cannot say which note of the run is sounding. `ROLL_H`/`ROLL_NOTE`
  mirror the CSS: the highest note's position has to stop at `height − block − padding`,
  or the top of the run is clipped by the strip's own `overflow:hidden`.

- **Play mode vs Program mode.** `SEQ.mode`. In **play**, keys start and steer the pattern.
  In **program**, keys WRITE to the selected step and every knob you move locks to it —
  nothing auto-starts, and `seqOwnsVoice()` returns false so you hear each note as you
  enter it, even with the sequence running underneath.

- **Parameter locks are applied by swapping `P` around the step, not by a parallel state.**
  `withLocks(st, fn)` saves the affected keys, writes the locked values, runs `fn`, and
  restores in a `finally`. Voices read `P` at build time so this is all it takes, and
  because scheduling is synchronous the UI never observes the swapped values. The `finally`
  is load-bearing: a throw mid-step would otherwise leave the whole patch stuck on one
  step's settings — there is a test for exactly that.

  Capture has no arm step, the same as note recording: in program mode, moving a knob IS
  locking it. CC goes through the same `ctlReg.set`, so a hardware knob p-locks too.
  Double-click removes the LOCK before it resets the value, or there would be no way to
  unlock without also losing your patch setting.

  **Loaded locks are clamped against `PARAM_RANGE`**, which is built from the `KNOBS`
  descriptors themselves so it cannot drift from them. Validating type alone was not enough:
  a hand-edited patch with `fres: 9999` got through the first version, and while the ladder
  happens to clamp its own input, plenty of parameters do not (`aa` has a floor but no
  ceiling, and a huge attack simply eats the note).

- **`writeStep()` splits a played note across `oct` AND `pitch`.** Pitch alone is only ±24,
  so forcing `oct` to 0 silently truncated anything beyond two octaves from the root —
  G4 over a C2 root recorded as C4.

- **The pattern starts from the keyboard, not the Play button.** The FIRST held note starts
  it; later notes do not restart it, because adding a note to a running arp should thicken
  it rather than knock it back to step 1. `SEQ.autoStart` records that a key started it, so
  releasing the last key stops it again — while a transport the player started with the
  button stays running until they stop it. The Play button still works, and is the way to
  hear a sequence at its written pitch with nothing held.

  Three paths empty the held set and all three must stop a key-started pattern: `noteOff`,
  `allNotesOff` (panic, and switching Hold off), and stopping by hand. `allNotesOff` does
  not go through `noteOff`, so the check is repeated there — without it, switching Hold off
  left the pattern running with nothing feeding it.

- **Hold keeps notes in the HELD set, not merely sounding.** An arp latches by continuing to
  read `heldNotes`, so removing them on release silently emptied the arp's input. Hold used
  to do exactly that.

- **Pad labels show the note, quantised to the key, at rest.** `stepNote(st, atRest)` skips
  the held-note transposition for labelling — a label that moved with whatever was being
  held would be unreadable. They re-quantise when the key or scale changes, so switching
  from C chromatic to C major visibly turns an A♯ into an A. Measured to fit: a label needs
  15.7px in a 28.9px pad at 375px wide, the tightest case.

- **Step recording has no record mode.** Hold a note and click a step and it records; click
  with nothing held and it edits. A mode to arm is a mode to forget you left armed. Pitches
  are stored raw, so changing key afterwards re-interprets the pattern.
- **Slide needs one step of lookahead.** A 303 slide is portamento *into* a step with no amp
  retrigger, which only works if the previous note was never released — so the scheduler
  checks `nextSounding(i)` and holds the gate through.

### Levels — measured, not dialled

Every factory patch is trimmed to a target measured through the real graph, so switching
patches does not change how loud the instrument is.

| category | target | measured spread |
| --- | --- | --- |
| bass | −22 dBFS | all 20 patches land within **±0.4 dB** |
| lead / key / stab / fx | −24 dBFS | (CS·1's own twelve voices span 8.2 dB) |
| pad | −30 dBFS | it is meant to sit *under* a CS·1 chord |

RMS over the **first 500 ms** of the note — a whole-buffer RMS punishes a plucked patch for
the silence after it decays, which is what made `pearl` look 20 dB quiet. Peaks run
0.17–0.46, so there is real headroom. The −24 dBFS target is itself measured: CS·1 averages
−30.1 dBFS per note and sounds 3–4 at once, so a CS·1 chord lands near −24.

`__ms1.renderPatch({patch, midi, dur, gate})` renders a patch through **the real graph** by
pointing the module's `ctx` at an `OfflineAudioContext` and putting it back afterwards. Every
number above came from there. Do not rebuild the engine in a test rig — a rig that
reimplements the engine measures the rig.

**A bug that harness had, worth not repeating:** `initAudio()` wires the effects from
whatever `P` held when it ran, so applying the patch *after* it silently measured the
previous patch's chorus, delay and reverb. It cost an entire level sweep, and only showed up
because an envelope ratio made no sense. Effects change patch level by up to **+7.5 dB**.

### The vocoder

Added after the rest. The architecture question is the interesting one: a vocoder is not a
*voice*, it is a processor whose carrier happens to be a synth. And because the bank does
its own filtering, the carrier never needs the ladder — so the carrier can be
**paraphonic**: six notes summed into ONE shared bank. Vocoder chords therefore cost the
same as a single note, and a strict duophonic split would have bought nothing but a thinner
sound. The keyboard splits at a movable point; the vocoder's half is tinted, because an
invisible split is a bug report.

**No AudioWorklet anywhere.** The only real question was whether an envelope follower can be
built from graph nodes, and it can: bandpass -> WaveShaper `abs` -> two lowpasses -> connect
that signal to a `GainNode.gain`. Measured before any of it was written:

| test | result |
| --- | --- |
| gated tone, follower driving a carrier's gain | **651:1** between open and closed |
| formant sweep onto a saw carrier, standalone probe | −5.8 dB @700 Hz, +4.7 dB @2400 Hz |
| same, through the finished app graph | **F1 −7.4 dB, F2 +7.6 dB** — vowels clearly distinct |

Bands are log-spaced 150 Hz–5 kHz, the span that carries intelligibility (VP-330 used 10
bands, VC-10 20, EMS 5000 22).

**Things that bit, and are worth not repeating:**

- **The sibilance path was 20 dB too hot.** At the original gain, `vocsib:0.35` added
  **+19.7 dB** and peaked at 2.35 — clipping — and worse, the gate ran so far past unity
  that it saturated and stopped tracking. Now it moves +7.7 dB across the full travel with
  peaks under 0.9. Note the test modulator is white noise, which has far more sustained HF
  than any voice, so this is the worst case rather than the typical one.
- **Measuring a vocoder at a single frequency reads as silence.** The output only contains
  carrier harmonics, so probing at 2400 Hz against a 110 Hz carrier lands between them and
  reported "no transfer" when the transfer was fine. Integrate over the harmonics inside the
  band. This is the *same* mistake as the PWM alias metric above, made a second time.
- **`echoCancellation`, `noiseSuppression` and `autoGainControl` must all be off** in the
  `getUserMedia` constraints. The first two are built to remove exactly the signal a vocoder
  wants, and AGC pumps the band envelopes.
- **The default split was at C3**, the bottom of the on-screen keyboard, so the vocoder's
  whole half sat below the visible keys and looked broken. It is C4 now — the middle.
- The carrier taps **pre-filter**. Running it through the ladder first would eat the very
  bands the vocoder needs.

**Note routing.** Two modes, in `MIDI.route`:

- `split` — every channel is accepted and the note's pitch decides. One keyboard, two parts.
- `channel` — `MIDI.vocCh` claims one channel; `MIDI.synCh` takes the rest when it is `-1`
  (Omni) or one named channel otherwise, and anything else is dropped. `routeFor(ch)`
  returns `"voc"`, `"syn"`, `"ignore"`, or `null` meaning "defer to the split".

Both live in the midimap `localStorage` key, not in the patch: which channel your controller
sends on is a property of the rig, not of the sound.

`noteOn`/`noteOff` take an optional `forceSec`. It matters most on note-OFF: in channel mode
the *same pitch* can be sounding in both sections at once, and without an explicit section
the synth's note-off gets eaten by the vocoder's copy of that pitch. There is a test for
exactly that case.

**Pitch bend is per-section**, which is why there are two pitch buses (`pitchMod` for the
synth voice, `pitchVoc` for the carrier) and two `ConstantSourceNode`s. In split mode both
are driven together — one keyboard has one wheel — and in channel mode only the sender's.
`mkStack` picks its bus from `voice.voc` and remembers it on each part as `pbus`, because
teardown has to disconnect from the same bus it connected to.

Measured, with a note held in each section: bend on the synth channel gave **syn +200¢, voc
0¢**; on the vocoder channel **syn 0¢, voc −200¢**; in split mode **both +200¢**.

**A trap when testing this:** an `AudioParam` only advances if its subgraph is actually
being rendered. With no note sounding, `bendSrc → pitchMod` reaches nothing, so `.value`
stays at 0 however much automation you schedule — and it looks exactly like a broken
feature. Hold a note before reading it back.

**The unvoiced path must be gated by the CARRIER as well as by the modulator.** The voiced
bands get this for free — the carrier is what flows through them, so no note means no
output. The unvoiced path has its own noise source, so without an explicit gate it sings
whenever the modulator has HF in it, note or no note. Measured before the fix: **−28.0 dBFS
after a note had fully released**, where it should be silence. Losing the voiced part
against that standing noise bed is what reads as a click on release, and it is why the
first report of it blamed the amp envelope.

The gate follows the carrier **bus**, not a voice count — that stays correct for one note,
six notes, or a note in mid-release.

**A WaveShaper `abs` curve must have an ODD length.** The curve maps input 0 to index
`(n-1)/2`; with an even `n` that index is fractional, so it interpolates between the two
samples either side of zero and returns `1/(n-1)` instead of 0. At n=1024 that is a floor of
9.8e-4, which after the follower's drive is about **−37 dB of gate that never closes** —
which is why the carrier gate alone only got the tail down to −65 dBFS. Odd length puts a
sample exactly at zero. Both fixes together: **−240 dBFS, true silence**, at every sibilance
setting, and silent with no note held however loud the input is.

**The modulator is compressed, and that is not optional.** A band follower opens *in
proportion* to the energy in its band, so without compression the vocoder's entire output
level tracks how loudly you happen to be speaking — and a quiet line input never opens the
bands at all. Measured, sweeping the modulator level with everything else fixed:

| modulator in | out, squeeze 0 | out, squeeze 0.75 (default) |
| --- | --- | --- |
| −6 dBFS | −25.8 | −21.2 |
| −24 dBFS | −44.4 | −22.8 |
| −36 dBFS | **−56.2** (inaudible) | **−25.5** |
| −48 dBFS | −63.6 | −36.4 |

Uncompressed, a 36 dB input swing moves the output 31.8 dB — essentially 1:1. Compressed,
the output holds within ~4 dB across a 30 dB input swing. That is a **30 dB improvement at
−36 dBFS**, which is the level a modest USB return actually arrives at, and it is the
difference between "works" and "crank your preamp until it does".

`Squeeze` sweeps threshold (−6 → −40 dB) and ratio (1.5:1 → 12:1) together, with makeup
computed as `|thr|·(1 − 1/ratio)` capped at 30 dB — a compressor only holds peaks *down*,
so lifting quiet material is entirely the makeup's job, which is why the two must move
together.

**`VOC_TRIM = 0.2` is load-bearing.** Sixteen band gains summing, plus the unvoiced path,
plus chorus and reverb, put the vocoder bus ~14 dB hotter than the synth voice: measured
peaks of **1.70–1.84** on a realistic patch, i.e. hard clipping. An earlier level check
missed it because it ran with sibilance and effects off. With the trim, worst peak is 0.49
and the section lands on the same −24 dBFS target as every synth patch.

**Mod gain is ±26 dB, exponential, not 0–4× linear.** The old range topped out at +12 dB;
a −40 dBFS input needs about +28 dB before the bands open, so the control ran out of road
exactly where it was needed. Patches store `vocmod` in real units, so widening the range
moved no saved value — the argument for real units over normalised ones, paying off.

**There is an input meter**, tapped off the RAW modulator before `modGain` and before the
section's on/off, so it answers "is signal arriving?" independently of whether the vocoder
is configured to use it. It only reads; it never routes the input to the output, so watching
it cannot feed back. It runs on a 100 ms timer rather than rAF, because it has to keep
reading while the window is in the background — which is exactly when someone is in their
interface's routing panel working out why nothing is arriving.

It also names the two failure modes that look identical from the outside, because neither
makes a sound: **nothing on the input**, and **signal present but no notes held**. A vocoder
is not an effect on incoming audio — it is incoming audio shaping notes you play, so with no
notes down it is correctly silent.

Feedback is the real operational hazard: a microphone into speakers howls. The panel says so
in the section note rather than leaving it to be discovered.

### The bass section

A pedal voice, deliberately not a third general-purpose synth. One oscillator (saw or
square), a square sub an octave under it, the same `ladder()` the main filter uses, and one
Decay knob that shapes the filter contour and the release together. No LFO, no PWM, no
sequencer, no effects sends — a Taurus has none of those either, and every send is a way to
smear a bass.

- **It bypasses chorus, delay and reverb**, going straight to the compressor. A bass wants
  to stay dry and centred.
- **Monophonic, lowest-note priority**, which is what a pedalboard is. Adding a higher note
  does not interrupt the root.
- **It claims exactly one MIDI channel and never Omni.** A pedal voice that quietly answered
  everything would steal the keyboard the first time it was switched on. With no channel set
  it is playable only from `Keys play → Bass`, and the panel says so rather than being
  silently mute.
- **`routeFor()` checks it first**, and only when the section is on — a section that is off
  claims nothing.
- `BASS_UNITY = 0.27` puts it at **−22.0 dBFS**, the same target the bass presets are
  trimmed to, and within 0.2 dB across two octaves. 0.22 measured −23.8 and sat noticeably
  under everything else. Worst case (square + full sub + 16 dB resonance) peaks at 0.370.

### Known compromises

- **No hard sync.** Web Audio cannot restart one oscillator's phase from another without an
  `AudioWorklet`. One patch (`shard`) was written for it; it now gets its scream from a large
  filter-envelope-to-osc-2 pitch sweep instead. The `sync` key remains in the patch schema,
  unused. Doing it properly means a PolyBLEP sync oscillator in a worklet loaded from a Blob
  URL — which would keep the one-file rule, and is the obvious next addition.
- **Unison shares one filter**, rather than a filter per voice as a real polysynth has. The
  stack is divided by √n; the residual 1–2 dB of coherence at n≥4 lives in the patch trim.
- **The vocoder follower is symmetric.** One "Response" control, not separate attack and
  release: asymmetric smoothing needs a `max()` that pure graph nodes cannot express. A
  separate attack/release pair would be a control that does not do what its label says.
- **The sequencer and arpeggiator drive the synth section only.** The vocoder and the bass
  are played by hand, which is what they are for.
- **The bass has no velocity curve, no LFO and no effects.** That is the point of it; if it
  grows those it stops being a pedal voice and becomes a second synth with a worse panel.
- **CC, mod wheel and the sustain pedal stay global** even in channel mode — they act on
  whichever section is relevant rather than being filtered by channel. Only notes and pitch
  bend are routed.
- **MIDI out mirrors the sequencer only, not hand-played notes.** `sendNote()` is called
  from `seqFire()` and nowhere else, so `Note out: On` does not echo the keyboard. Worth
  fixing; it needs a separate note-on/note-off pair rather than the duration-based call.
- **Only the waveform selectors are structural.** Everything else moves under a sounding
  note, which is the whole point of CS·1's fader design and something MS·1 originally fell
  well short of: **25 of its 50 knobs did nothing until you played another note.**

  The fix was mostly in `mkStack()`: oscillator, sub and noise nodes are now built even at
  level 0, and the ring/FM network is built even at depth 0. A gain of zero is silent but
  PRESENT, and present is what lets the knob move. Only `wave:"off"` skips a node.

  The stack exposes `setLevels`, `setTuning`, `setDrift` (unison detune/spread) and
  `setCross` (ring/FM); `eachVoice`/`eachStack` reach synth voices and vocoder carriers
  alike, so a knob move lands on both sections. Carriers deliberately use the same field
  names as voices (`stacks`, `aEnv`, `ampEG`) so one code path serves both.

  **Release is read at RELEASE, not captured at note-on** — otherwise turning the knob
  while holding a note does nothing to that note. Sustain re-aims the decay from wherever
  the envelope currently is, and re-anchors `e.t0` so `envValueAt()` stays honest afterwards.

  Nine knobs remain per-note, all legitimately so: **attack and decay** (those segments have
  already happened), **LFO delay** (a per-note fade), and **glide, bend range and release**,
  which are read at the moment they are used rather than through `applyParam`.

  There is a coverage check worth keeping: parse the `KNOBS` table, parse the `case` labels
  in `applyParam()`, and diff them. That is what found the original 25.

### Not yet done

- **No hardware test.** Everything above is browser-measured. MIDI in/out, note mirroring to
  the EP-133 and CC learn are all unproven against the actual device. The vocoder has never
  had a real microphone in it — every number above comes from a synthetic vowel.
- The iOS wrapper still loads CS·1 only. Hosting MS·1 needs an instrument picker in
  `WebHostViewController`; the web file itself needs no change (it already exposes
  `window.__patchworkResume` and resumes on any non-running context state). **The vocoder is
  a further complication on iOS**: `getUserMedia` needs `NSMicrophoneUsageDescription` *and*
  the `AVAudioSession` category moved from `.playback` to `.playAndRecord` — which brings
  back the ring/silent-switch mute documented above. Desktop-first is much cleaner.
- The step grid has no copy/paste, randomise, or pattern length beyond 32.

## DR·1 — drum machine

Eight synthesised voices, a sixteen-step grid per voice, on the shell's clock. Added in
Phase 4 as the third instrument, and the first one written after the shell existed — so it
is the shape the other two are being moved towards rather than a fourth exception.

### Map

| Area | Where |
| --- | --- |
| Voice synthesis | `src/dr1/voices.js` — one function per drum, `HITS` dispatches |
| Metal ratios | `METAL` — the 808's six inharmonic squares, shared by both hats |
| Levels | `TRIM` (measured), `BALANCE` (the ratios), `TARGET_BD` (the absolute) |
| Step events | `stepEvent()` — single source of truth for engine *and* MIDI out |
| Transport | `tick()` in `seq.js`, same 25 ms / 200 ms shape as the other two |
| Offline rig | `__dr1.renderHit()`, `__dr1.measure()` |

### Design decisions worth not undoing

- **The metal voices are six square oscillators at inharmonic ratios**, not filtered
  noise. That is how the original made a cymbal without a sample, and it is the only
  reason a hat reads as metal. Any harmonic set rings as a pitch, which a cymbal must not
  have.
- **A closed hat chokes an open one.** They are one physical hi-hat; without the choke
  they overlap into a wash no drum machine has ever made.
- **The kick's pitch envelope is the kick.** A sine at 48 Hz is a test tone; the same sine
  swept from 3.5× down to 48 Hz in 45 ms is a drum. Tone stretches the sweep rather than
  raising the pitch, so the knob changes character and not the note.
- **A clap is three bursts and a tail**, ~10 ms apart. One burst through the same filter
  is a short snare.
- **Nothing is pooled.** A drum voice is a few nodes for a few hundred milliseconds, and
  pooling buys nothing but a class of bug where a retrigger inherits the last hit's
  envelope. The cost of that choice is the 83.8% row in the render table above.
- **Sixteen pads across, one row per lane.** MS·1 wraps its 16 steps into two rows of
  eight because it has one lane and the height is free; eight lanes wrapped is sixteen
  rows, and a drum grid that does not read left-to-right as a bar is not a drum grid.
- **One set of voice faders serving the selected lane**, not four per voice. Thirty-two
  controls on this panel is a wall, and a drum machine is played on the grid.

### Levels — measured, and the window matters more than anywhere else

The kit spans 45 ms (closed hat) to 420 ms (kick), so **any fixed measurement window is
wrong for one end of it**:

| window | what it does |
| --- | --- |
| 500 ms — MS·1's | divides a hat's energy by ten parts silence |
| 150 ms — the obvious fix | still under-measures a 45 ms hat by ~5 dB while measuring a 380 ms open hat in full. Handed two voices from the **same generator** trims 13 dB apart |
| **30 ms peak-RMS** | self-scaling: every voice measured over the part of itself that is loud |

The 150 ms attempt is worth knowing about because its output looked plausible — an ordered
table of sensible-looking trims — and was wrong in a way only visible by noticing that CH
and OH share a generator and should not have needed different corrections.

Result, all eight voices, ten runs averaged:

| | |
| --- | --- |
| spread before trimming | **30.6 dB** |
| spread after | **0.34 dB** |
| worst deviation from target | **0.31 dB** |
| mean deviation | 0.09 dB |

⚠️ **The harness is stochastic**, exactly as MS·1's is and for the same reason — every
noise source starts at a random offset per hit. `measure()` averages 8 runs by default.
Never read a single one.

## LP·1 — audio looper

Record, loop and overdub audio in time with the pattern. A fourth instrument, and the
first one that is not a synthesiser.

### It has to be an AudioWorklet

Recording means seeing every input sample, and the two alternatives are both worse:
`MediaRecorder` encodes to Opus and returns something that needs decoding and is not
sample-aligned, and `ScriptProcessorNode` runs on the main thread — where the click
investigation's own findings say a stall is exactly what you get under load.

The processor source is a template literal turned into a **Blob URL** at runtime, because
`addModule()` needs a URL. Nothing is fetched and the app stays one file. This is the first
use of the trick the MS·1 notes already proposed for a PolyBLEP sync oscillator, so it is
now proven if anyone wants hard sync.

### The take starts on the bar line

Arming does not start anything. It posts the mode change to the worklet **with the exact
sample frame to apply it at**, taken from `Patchwork.clock.claim()` — the same seam the
scene launcher fires on. The worklet compares `currentFrame + i` per sample, so the switch
is sample-accurate rather than block-accurate.

Measured, arming at 407, 914 and 1533 ms into a bar: the take started 0, 16 and 5.3 ms off
the line. **Those residuals are the measurement, not the mechanism** — position is posted
to the main thread every 8 render quanta (~21 ms), so the test cannot resolve better than
that.

A first pass records **exactly one loop length and then plays**. A looper that keeps
recording until you press stop records your reaction time onto the end of the take.

### It records the studio, not just a microphone

The default input is the studio's own output — `Patchwork.audio.tap("lp1")`, a sum of every
instrument's strip **except this one**. On a jam tool that is the more useful of the two:
capture what the band just played, then overdub over it. It also needs no permission, no
headphones and cannot feed back.

⚠️ **The exclusion is load-bearing.** Tapping `master` instead would record the looper
recording itself, and an overdub would build that up every pass until it clips. Taps are
re-wired when a new strip appears, because an instrument can be built after the tap was
made.

### Details worth not undoing

- **Overdub outputs the material as it was BEFORE this pass.** Outputting the new sum
  would double the live input, which is already being monitored.
- **Overdub keeps layering until you stop it**, like hardware. Record does not.
- **One level of undo**, snapshotted at the start of each overdub. A looper without undo
  punishes the take you were happy with. Measured: 0.21 after record, 0.62 after
  overdubbing, 0.19 after undo, 0 after clear.
- **The loop length is fixed in SAMPLES**, from the tempo when you armed. Audio cannot
  stretch, so a tempo change afterwards means it no longer fits the bar. The panel shows
  the tempo it was cut at and marks it when the two disagree, because silently drifting is
  worse than being told.
- **LP·1 is deliberately not a scene member.** A scene changes what an instrument *plays*,
  and a looper's content is a recording — firing one from a scene row would either throw
  away a take or make the bank carry audio. It is played by hand, like MS·1's vocoder and
  bass.
- **The playhead is the worklet's own position**, not a main-thread timer, which would show
  where the main thread *thinks* the loop is.

## Scenes

A scene is a row: one pattern per instrument, fired together. Eight of them, in the studio
build only — the model in `shell/scenes.js` is headless and runs in every build, so the
standalone apps register and simply never draw a launcher.

### The seam is a scheduling boundary, not a wall-clock one

This is the whole reason the module exists rather than a `setTimeout`. Every instrument
schedules **~200 ms ahead**, so swapping a pattern when `ctx.currentTime` crosses the bar
line lands the change a fifth of a second late: the old pattern has already been placed
past the seam.

CS·1 solved this before the shell existed — `takePending()` is called inside `tick()`,
right before the next chord is scheduled. `Patchwork.scenes.take(id)` generalises it: each
instrument calls it at its own loop point, inside its scheduling loop, so the swap happens
in the same time domain the notes are placed in.

Measured: after firing a scene mid-bar, every hit of the new pattern landed **0.0 ms** off
the bar line.

### A scene captures the pattern, not the sound

Firing one changes what an instrument plays and leaves the filter you just dialled alone.
That keeps the deep panels for setting up and the launcher for performing, and it is the
least surprising rule — a scene that silently retuned the kit would make the bank unusable
mid-take.

| | what a pattern is |
| --- | --- |
| CS·1 | the progression — chords, mood, key |
| MS·1 | the step sequence, plus len/rate/motion/scale |
| DR·1 | the eight lanes, plus len/rate/swing/accent |

### Details worth not undoing

- **An instrument that is not running takes the change immediately.** There is no seam
  coming, and firing a scene with the transport stopped otherwise does nothing visible and
  reads as broken.
- **Capture is a deep copy.** Storing a live reference makes every scene captured from the
  same grid point at one object, so editing the grid silently rewrites the whole bank.
- **Shift is capture, plain click is fire.** A modifier rather than a record-arm mode,
  because a launcher with a mode is one you can be in the wrong half of while playing.
- **The armed state pulses.** "Queued" and "playing" have to be tellable apart at a glance
  while something else has your attention.
- **CS·1's loop point is its whole progression**, so an armed scene can wait several bars —
  four chords at 120 bpm is eight seconds. That is correct, not a hang.

## Live faces

Each instrument shows a small performance face, with its full panel one click away.
**Nothing is removed** — MS·1 keeps all fifty knobs, and a hidden control is still in the
DOM, still bound, still MIDI-learnable.

That is the whole design decision. A curated performance panel written separately would be
a second copy of every control's wiring and the first thing to go stale. Instead each
panel marks the blocks worth having while playing with **`data-face`**, and face mode hides
the rest:

```css
:scope.face > :not([data-face]){display:none}
```

| | what stays on the face |
| --- | --- |
| CS·1 | the progression card, the transport, key/mood/tempo |
| MS·1 | the keyboard, what it plays, the transport, the patch selector |
| DR·1 | the transport and the grid — the grid *is* the performance surface |

| | full panel | face |
| --- | --- | --- |
| CS·1 | 1610 px | **465 px** |
| MS·1 | 3140 px | **593 px** |
| DR·1 | 849 px | **570 px** |
| studio page | 4177 px | **1646 px** |

### Details worth not undoing

- **The default derives from the page, not from a build flag.** `shell/boot.js` turns
  faces on when there is more than one instrument. A lone instrument is its whole self; a
  page with three opens on faces, because three full panels is the wall this exists to
  avoid. An instrument added later gets the right default without anyone remembering.
- **The toggle button is injected by the shell**, not written into three `panel.html`
  files, for the same reason.
- **The studio's header segment cannot borrow the panels' `.seg`** — that lives inside
  `@scope (.unit)` and does not reach outside a panel. It is styled to match instead. The
  build's collision check catches this if you forget, which is how it was caught.

### The 721 px floor

The Arcade embeds at a minimum of 721×620. At that size the scene launcher was taking half
the window before you reached an instrument, so `@media (max-height:760px)` tightens it —
**keyed on height, because the problem is height**; a wide short window has it just as
badly. All eight scenes stay reachable, the cells just stop being generous.

| at 721×620 | |
| --- | --- |
| chrome above the first instrument | 299 px |
| instrument visible without scrolling | 321 px |
| horizontal scroll | none |

## The MS·1 split

MS·1 was one instrument with three sections — synth, vocoder, bass — sharing a graph, a
patch object, a keyboard and a four-way MIDI channel map. It is now three:

| | | |
| --- | --- | --- |
| **PM·1** | `patchwork-poly-synth.html` | the main voice — MS·1 minus the other two |
| **VC·1** | `patchwork-vocoder.html` | the bank, with a simple carrier of its own |
| **BS·1** | `patchwork-bass.html` | the pedal voice |

Each has its own 64-step sequencer and its own MIDI input channel, which is most of what
the split was for. MS·1's own notes said plainly that "the sequencer and arpeggiator drive
the synth section only" — a fair limit for a section, and an unacceptable one for an
instrument.

`voice/core.js` holds what all three need and none should own three copies of: the ladder
with its closed-form inverse, RCOMP, the envelope helpers and their measured release floor.
`seq/step-seq.js` is a factory — one call per instrument gives it its own state, grid and
transport on the shell's clock.

### VC·1's carrier gain was measured, not guessed

MS·1's carrier came off its full voice stack, with per-patch trims and a unison divisor;
VC·1's is a bare oscillator, and a bare oscillator at unity is far hotter. Running one
synthetic modulator through both put VC·1 **exactly 23.07 dB above MS·1 at two different
modulator levels** — the signature of a constant gain error rather than a behavioural
difference. `CARRIER_UNITY` is that offset. With it applied VC·1 matches MS·1 to 0.00 and
−0.01 dB, landing at −24.84 / −24.18 dBFS.

### The orphaned engine is out

PM·1 shipped for one commit with the vocoder and bass engine present but unreachable, and
that is now removed. **605 lines out of the built file** (5559 → 4954), and 19 keys out of
the patch schema (81 → 62).

The order mattered, and it is the order to repeat for anything like this:

1. **Make it unreachable** — panels, controls, channels, routing — and prove nothing can
   turn it on.
2. **Take a measured baseline** while it is still there. Five renders per patch, averaged,
   because the harness is stochastic.
3. **Remove it in blocks, building between each**, and let the browser find the next
   dangling reference rather than guessing at the whole set up front.
4. **Re-measure against the baseline.**

Result: all twenty patches within **0.528 dB** of the pre-removal baseline, mean 0.085 —
both draws from the harness's own spread, which is up to 1.29 dB run to run. Live voice
plays, no console errors on a fresh tab, and every other instrument and the studio load
clean.

⚠️ **What made the first attempt fail was cutting by line and by pattern.** Deleting every
line that mentioned a symbol broke multi-line statements twice, and a regex that guessed
where a comment began ate half a function. What worked was matching braces to find whole
syntactic blocks, and removing one thing at a time with a build after each.

Things the removal simplified rather than merely deleted, each worth keeping:

- `routeFor()` was a three-way arbitration between synth, vocoder and bass over Omni and
  explicit channels. One voice means one question, and it is one line.
- `isLatched()` looked in three places for a note; there is one place now.
- Pitch bend had two destinations, because bending the lead must not drag the vocoder
  chord. There is one.
- `seg()` returns a no-op painter when its control is absent — added during the split, and
  the reason the last few removals did not throw at boot.

### Other notes

- `seg()` returns a **no-op painter** when its control is absent, rather than `undefined`.
  A control whose section moved is missing, not broken, and every caller stores the result.
- The patch storage key is still `patchwork-ms1-patches`, deliberately — renaming it would
  silently orphan every patch anyone had saved. `restore()` accepts both app names.
- The build's collision check now **derives** its instrument list from the panels present,
  rather than naming them, so adding an instrument cannot silently weaken it.
- ⚠️ **With six instruments the studio no longer fits one 2000 px screen in faces mode** —
  seven grid items at a 350 px floor is five columns, so two rows. It fitted at four
  instruments. Either a narrower face or a way to hide an instrument is the fix, and that
  is a design decision rather than a bug.

## The live page

The scene launcher made big, with an arm per track. `Live` / `Studio` in the header.

### Firing a row starts what it lands on

⚠️ **This was missing and it made the whole gesture look broken.** A launcher whose cells
load a pattern but leave the transport where it was appears to do nothing: the cell lit,
and nothing sounded. `fire()` now starts any instrument it lands on that was stopped, and
`captureRow()` starts an armed track BEFORE taking its copy.

The order matters twice over. An armed track has to be *running* for live note capture to
reach the grid at all — a step index is meaningless with no transport — so starting it is
also what lets you arm a second track and play into the same row a moment later, which is
the workflow this is for:

```
arm DR·1  →  ● row 1     drums start, and land in row 1
arm BS·1  →  ● row 1     bass starts and joins the row; drums keep going
```

**A track with nothing in the fired row STOPS.** A row is a complete picture of what should
be playing, so an instrument with no clip in it falls silent — otherwise firing row 2 leaves
row 1's bass running underneath and what you hear is neither row. This was originally the
other way round, on the theory that silently killing a track was the worse surprise; playing
it proved the opposite, and it is Ableton's behaviour for the same reason.

The stop is **queued to that instrument's loop point**, exactly like a pattern swap — a null
in `pending` is the pending stop, and `take()` reads it at the seam. Nothing cuts mid-bar.

⚠️ `take()` can therefore stop the very instrument whose tick is calling it, and the
scheduling loop has to notice: every tick checks `playing` immediately after `take()` and
returns, or it carries on filling the lookahead for a transport that is no longer running
and leaves a bar of notes sounding after the stop.

### The row button IS the record

There is no global record switch. **Arm a track, then hit ● on a row**: every armed track
has whatever is currently in its sequencer copied into that row, and every unarmed track
fires that row and plays back what is already there. One gesture, one destination.

That is why the global button went. "Record" with no destination is a mode you can be in by
accident; the row is the destination, so the row is the button. It turns from ▶ to ● and
from grey to red the moment anything is armed — on the live page and the small launcher
both, because a track stays armed across views and the two must show the same truth.

The copy is instant, from the live pattern. Nothing is quantised after the fact because
nothing needs to be: an armed track writes what you play onto its grid as you play it, at
the nearest step.

| | what an armed track contributes to a row |
| --- | --- |
| PM·1, VC·1, BS·1, DR·1 | a copy of the pattern in its sequencer right now |
| LP·1 | a real audio take, into that row's slot |
| CS·1 | a copy of its progression |

### Arming is about capture, not about writing notes

⚠️ **CS·1 was greyed out for the wrong reason.** `canRecord` defaulted to "has a `write()`
hook", and `write()` is the narrow capability of taking notes you play onto a grid *as you
play them* — which a chord progression genuinely cannot do. But arming for the row gesture
does not need it: pressing a row copies whatever the instrument has right now, and a
progression captures as readily as a step grid.

Every registered track is armable by default now. `live` is the separate flag for whether
played notes also land on the grid, and the arm's tooltip says which kind it is rather than
leaving you to find out:

| | armed means |
| --- | --- |
| PM·1, VC·1, BS·1, DR·1 | notes land on the grid as you play, and a row press stores the pattern |
| CS·1 | a row press stores the progression |
| LP·1 | a row press records an audio take into that row |

### LP·1 has a slot per row

Eight takes, one per scene row, **allocated lazily** — eight slots of eight bars reserved up
front is fifty megabytes for takes nobody has recorded. Firing a row plays that row's take,
or falls silent if it has none; silence is the honest answer, because a row with no loop
should not leave the previous row's playing underneath it.

The loop LENGTH is fixed by the first take and shared by every slot. Rows of different
lengths could not be fired together, which is the whole point of a row.

⚠️ **The worklet is a template literal.** A backtick anywhere inside it — including in a
comment — ends the string and takes the rest of the app with it. That happened once, while
adding a comment about the slot field. There is a note in the file now.

⚠️ **Two bugs the slots exposed**, both worth knowing:

- `process()` bailed out early when the active slot held no buffer, which skipped the
  pending-transition check below it — so a slot's *first* take could never start. Only the
  length gates the block now; an empty slot is silence per sample.
- The scheduled transition carries the slot with it. Selecting the slot in a separate
  message would put the first samples of a take into the previous row, because the two
  messages land on different frames.

### Notes

- The master Play presses the instruments' own Play buttons rather than reaching into
  their transports, so arm checks, autostart and painting happen as they would from a panel.
- ⚠️ `[hidden]` needed `display:none !important` — the attribute is `display:none` from the
  UA sheet, which any explicit `display` on a class beats, and `.st-rack` is `display:grid`.
- ⚠️ The live page must live OUTSIDE `.st-rack`, or hiding the rack hides it too.
- The studio's own state class is `st-on`. `armed` and `focused` are declared shared in the
  build's collision check; `on` is too generic to exempt without weakening it.

## The plate

One definition, in `shell/chrome.css`. Only CS·1 and PM·1 ever had one, so on every other
panel the header had no layout at all and the injected Panel button fell to its own line —
which is what "the Panel button is not consistent" looked like.

`align-items:flex-start` and `align-self:flex-start` on the button, because PM·1's model
wraps to two lines on a narrow panel and centring pushed its button 19 px below everyone
else's. All six now measure identically: 40 px from the plate's right edge, 0 from its top.

**The brand is not on the panels.** It is the page's name — six copies of it down a rack is
six times less useful than one at the top. What is left on the plate is the model, which is
what actually tells the panels apart.

## Working style that suited this project

Measure rather than assume — most of the real bugs here were found by rendering audio
offline in an `OfflineAudioContext` and checking dB/RMS, or by capturing scheduled
oscillator times, not by listening. Several "fixes" were wrong until measured: the Space
fader was inaudible at −23dB, `brass` was +3.3dB too loud, Tone's bottom end did nothing
at −0.7dB, and the first bass "decay" was indistinguishable from sustain.

Test harnesses that paid for themselves: `ios/build-test-harness.py` (mocked native MIDI),
and patching `AudioContext.prototype.createOscillator` to capture scheduled note times.
