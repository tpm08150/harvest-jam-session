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

## Working style that suited this project

Measure rather than assume — most of the real bugs here were found by rendering audio
offline in an `OfflineAudioContext` and checking dB/RMS, or by capturing scheduled
oscillator times, not by listening. Several "fixes" were wrong until measured: the Space
fader was inaudible at −23dB, `brass` was +3.3dB too loud, Tone's bottom end did nothing
at −0.7dB, and the first bass "decay" was indistinguishable from sustain.

Test harnesses that paid for themselves: `ios/build-test-harness.py` (mocked native MIDI),
and patching `AudioContext.prototype.createOscillator` to capture scheduled note times.
