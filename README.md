# Harvest Jam Session

Six instruments that run entirely in the browser, separately or together. One HTML file
each, no dependencies —
generate and play music, shape it with a small synth engine, and drive external hardware
over MIDI. Each ships as a single self-contained file; they are assembled from `src/` by a
concatenation script that needs nothing but Python.

| | | |
| --- | --- | --- |
| **CS·1** | `patchwork-chord-synth.html` | chord synthesizer — progressions, pads, harmony |
| **PM·1** | `patchwork-poly-synth.html` | poly/mono synth — the main voice |
| **VC·1** | `patchwork-vocoder.html` | vocoder, with its own carrier and sequencer |
| **BS·1** | `patchwork-bass.html` | bass pedals, with a 303-style sequencer |
| **DR·1** | `patchwork-drums.html` | drum machine — eight synthesised voices, sixteen steps |
| **LP·1** | `patchwork-looper.html` | audio looper — record, loop and overdub in time |
| **Studio** | `patchwork-studio.html` | all three on one page, sharing a clock and an audio bus |

Each is a complete program on its own — CS·1 plays the changes, PM·1 plays the line over
them, BS·1 holds the bottom, VC·1 sings, DR·1 keeps time and LP·1 catches it all — and each can drive hardware by itself. The **studio** build hosts
all three on one page, where they share a single audio context, one transport and one MIDI
router: start a second instrument while the first is running and it joins on the next bar
rather than wherever you happened to press the button.

---

## Patchwork CS·1 — chord synthesizer

**Progressions.** Eleven moods, each a pool of hand-written templates with a distinct
harmonic identity — Lydian, Dorian, gospel, quartal, minor jazz and so on. Pick a key, force
major or minor, and choose 3–12 chords. Chord names are spelled by scale degree rather than
from a lookup table, so a borrowed ♭VII in C reads `B♭` and not `A♯`.

**Pads.** Chords are laid out three across, filled bottom-up, so pad 1 sits bottom-left and
the grid mirrors a 3×4 hardware pad layout. Each pad can be edited independently — any root,
any of 16 chord types, and a length from ¼ bar to 8 bars in quarter-bar steps.

**Sound.** Twelve voices, including custom wavetables, bandpass and highpass designs. Six
faders (tone, attack, release, space, spread, level) that move under sounding notes rather
than waiting for the next one. Four motions: hold, strum, arpeggiator and a step-sequenced
pulse, with swing for the stepped ones.

**MIDI.** Chord pads and clock sync in, note events out, mirroring the internal engine so the
two can't drift. An **In ch** filter (Omni or 1–16) decides which channel it listens on;
clock and start/stop are unaffected by it, since they carry no channel. MIDI learn maps hardware pads to chord slots and hardware knobs to faders.
A phase lock keeps the transport from drifting against an external clock. A panic button
sends all-notes-off on every channel.

---

## Patchwork PM·1 — poly/mono synthesizer

Aimed at the two jobs CS·1 cannot do: **leads and basses.** Inspired by early-80s analog
polysynths, and built to sit next to a CS·1 chord rather than fight it.

**Voice.** Two DCOs plus a sub-oscillator and noise, each with octave, semitone, fine detune
and level. Waveforms are saw, triangle, sine and a genuine variable-width pulse with PWM.
Ring modulation and osc-2→osc-1 FM for the aggressive end.

**Filter.** A 24 dB/oct resonant ladder, built as two `BiquadFilterNode`s placed on the pole
pairs of the analog `1/((1+s)⁴+k)` prototype rather than two lowpasses stacked by eye. It
reproduces the prototype exactly, resonance is even across the knob's travel, and the low end
thins as resonance rises the way a real ladder does. Plus pre-filter drive, a non-resonant
highpass, keyboard tracking and velocity→cutoff.

**Modulation.** Two ADSRs — one on the filter in the cents domain, one on the amp. An LFO
with triangle, sine, saw, square and sample & hold, a fade-in delay, and separate depths to
pitch, cutoff and amplitude. PWM gets its own LFO, because sharing one makes every pulse
patch wobble in pitch too.

Every knob except the waveform selectors moves **under a sounding note** rather than waiting
for the next one — including oscillator levels and tuning, drive, ring and FM, and the
envelopes' sustain. Release is read at the moment you let go, so turning it up while holding
a note lengthens that note's tail.

**Playing.** Mono with constant-rate portamento, unison up to ×5 with detune and stereo
spread, **or 6-voice polyphonic**. Low/high/last note priority, legato or retrigger, pitch
bend, and a Hold that latches **per note** — press a held note again to release just that
one. Hold stacks notes where more than one can be heard (poly, the vocoder, the arp); in
mono or with the sequencer it replaces, since only one note sounds anyway.

The paper card names whatever is sounding — `Cmaj7`, `C/E`, `C5` — which is useful well
beyond the arpeggiator.

The arpeggiator draws its run as a **piano roll**: horizontal is order, vertical is pitch,
and the current note lights as it plays, so you can see the shape the arp is tracing. The
roll replaces the step grid while the arp is selected — they are different instruments and
only one of them is listening.
A two-octave on-screen keyboard, plus the computer keyboard from `a`.

**Motion.** A 16-step sequencer (8/12/16/32) with per-step pitch, gate, **accent**, **slide**
and **tie** — a 303-style line, where slide glides into a step without re-attacking it. Or an
arpeggiator over held notes, up to three octaves. Swing is the same model CS·1 uses, so the
two shuffle identically.

The sequencer has a **Play** and a **Program** mode. In Program, keys write to the selected
step instead of starting anything, arrow keys walk the pattern, and **every knob you move is
locked to that step** — so one step can be darker, or more resonant, or longer, than the rest.
A locked knob and a locked step are both marked, double-clicking a knob removes its lock, and
`Clear locks` clears the step (shift-click clears the whole pattern).

**In Play mode both start from the keyboard** — playing a note starts the arp or sequence and releasing
the last one stops it, so the Play button is only needed to hear a sequence at its written
pitch with nothing held. Hold latches it. Each pad shows the note it will play, in the
current key.

The sequencer has a **key and scale**. Hold a note and click a step to record it — no record
mode to arm. While it plays, holding a note transposes the pattern **in scale degrees**, so
it stays in key: in C major, holding the 2nd turns C-E-G into D-F-A rather than C♯-F-G♯. Set
the scale to Chromatic for straight semitone transposition. Held notes steer the pattern
rather than sounding on top of it.

**Bass.** A dedicated pedal voice, Taurus-shaped: one oscillator with a square sub an octave
below, a ladder filter, and a single Decay knob shaping filter contour and release together.
Monophonic with lowest-note priority, dry by design — no chorus, delay or reverb — and it
answers its own MIDI channel, so a pedalboard or a DAW track can drive it while you play
something else on the keyboard.


**Effects.** A BBD-style chorus (I, II, I+II, Ensemble), a tempo-syncable stereo delay, and
a reverb send. The vocoder runs through them as well; a chorused vocoder is most of the sound.

**Patches.** Twenty factory presets — eight basses, eight leads, and a key, a stab, a sync-ish
scream and a pad. Program change 0–19 recalls them. Saved patches live alongside the factory
bank and shadow it rather than overwriting it, so the bank is always recoverable.

### Levels

Every factory patch is trimmed against a measured target rather than by ear, so switching
patches does not change how loud the instrument is:

| | |
| --- | --- |
| basses | −22 dBFS |
| leads, keys, stabs, fx | −24 dBFS |
| pad | −30 dBFS (it is meant to sit *under* a CS·1 chord) |

Measured as RMS over the first 500 ms of the note — a window that reflects what you hear
rather than punishing a plucked patch for the silence after it decays. All twenty land
within **±0.4 dB** of target, against CS·1's own 8.2 dB spread across its twelve voices.
That target is itself measured: a typical CS·1 chord sits near −24 dBFS, so a single PM·1
note matches it without a gain ride in the mixer.

---

## Patchwork VC·1 — vocoder

A 16-band vocoder (8/16/24) with a carrier of its own. Sing or speak into any input and the
notes carry your voice — or point it at the **studio output** and run the drums through the
bank, which needs no microphone and cannot feed back.

The carrier is **paraphonic**: up to six notes summed into one shared bank, so a chord costs
what one note costs. Measured at 2.95 dB over a single note, not the ~9.5 dB six independent
voices would cost.

**Squeeze** compresses the modulator before the bank, which is what stops the vocoder needing
a hot input — a band opens in proportion to its energy, so without it the whole output level
tracks how loudly you speak. **Unvoiced** is a separate noise path, because a pitched carrier
physically cannot produce “s” or “t”. Its own 64-step sequencer, and its own MIDI channel.

**Use headphones.** A microphone into speakers will feed back.

## Patchwork BS·1 — bass

A Taurus-shaped pedal synth: one oscillator with a square sub an octave below, a ladder
filter, and a single **Decay** knob shaping filter contour and release together. Monophonic
with lowest-note priority — a pedalboard plays the lowest note you are standing on — and dry
by design, because a bass wants to stay centred.

Its own 64-step sequencer with **slide**, which glides into a step without re-attacking it.
Every control moves under a held pedal except resonance, which sets the filter's poles when
the note is built.

## Patchwork DR·1 — drum machine

**Voices.** Eight, synthesised: kick, snare, clap, two toms, closed and open hats, and a
rimshot. 808-shaped rather than 808-cloned — the kick is a sine with a pitch envelope, the
snare is two tones crossfaded against filtered noise, and both hats come from six square
oscillators at inharmonic ratios, which is how the original made metal without a sample. A
closed hat chokes an open one, because they are one hi-hat.

**Grid.** Sixteen steps per voice, eight lanes, all visible at once. A click cycles a step
off → on → accent, so the thing you most want to program — an accented downbeat — takes one
gesture rather than a modifier. Lengths of 8, 12, 16 or 32, rates from 1/8 to 1/32 including
triplets, and the same swing model every instrument here uses, so they all shuffle identically.

**Levels.** Every voice is trimmed against a measured target rather than dialled. The eight
started **30.6 dB apart** and land within **0.31 dB** of where they should be.

**MIDI.** GM drum notes in — 36 kick, 38 snare, 42 hat — so a pad controller drives the kit
with no mapping. Hits mirror out on channel 10 by default.

## Patchwork LP·1 — audio looper

**Record, loop, overdub** — in time, without you having to be. Arming does not start
anything: the take begins on the next bar line and runs for exactly the loop length you
chose, so you can arm it a beat early and play into the count. A first pass records one
loop and then plays; overdub keeps layering until you stop it, with one level of undo.

**It records the studio by default**, not a microphone — everything the other instruments
are playing, minus the looper itself, so an overdub can never record its own output. Point
it at a microphone instead and it behaves the same way (**use headphones**).

The loop is a fixed number of samples, worked out from the tempo when you armed it. Audio
cannot stretch, so the panel shows the tempo it was cut at and tells you when that no
longer matches.

## Live

The studio has two views. **Studio** is the rack — every instrument's face, uniform height,
with the launcher beside them; opening a panel gives it the whole window and Escape backs
out. **Live** is the launcher made big, with an arm per track and a record button.

Recording is Ableton's gesture, and there is no global record button. **Arm a track, then
hit ● on a row.** Every armed track has whatever is in its sequencer copied into that row;
every unarmed track just plays that row back. The row buttons turn from ▶ to ● the moment
anything is armed.

LP·1 keeps a **separate audio take per row**, so a row can carry a loop as well as patterns.
CS·1 cannot be armed — its pattern is a chord progression rather than a step grid, and its
arm says so.

## Scenes

The studio build adds a **scene launcher** over the three panels: eight rows, one cell per
instrument. Click a cell to fire that instrument's pattern, the row's ▶ to fire all three,
shift-click either to capture what is currently playing into it.

Nothing lands where you click it. A fired scene is *armed* — the cell pulses — and takes
effect at that instrument's next loop point, so switching mid-bar stays in time instead of
lurching. A scene changes what an instrument **plays**, never the sound it plays with; the
patch you dialled survives the switch.

## Faces

Every instrument has a **face** — the handful of controls you touch while playing — with
its full panel one click away. Nothing is hidden permanently and nothing is removed: PM·1
keeps all fifty knobs, and a control you cannot see is still bound and still responds to
MIDI.

A single instrument opens as its whole self. The studio opens on faces, because three full
panels is a wall rather than an instrument. The switch in the header moves all three at
once; the button on a panel moves just that one.

## Running it

Web MIDI requires a secure context, so `file://` will not work — it needs `localhost` or
HTTPS. There is a tiny no-cache dev server included:

```bash
python3 serve.py
```

Then open any of `patchwork-chord-synth.html`, `patchwork-mono-synth.html`,
`patchwork-drums.html` or `patchwork-studio.html` on that port. One server serves them all.

The two HTML files are assembled from `src/` by `tools/build.py` — **edit the fragments, not
the built files.** The build is a plain concatenation and needs nothing but Python, so the
shipped app is still one file with no dependencies:

```bash
python3 tools/build.py
```

Deployed on Netlify, CS·1 is at the root and the rest have clean paths of their own:
`/poly`, `/vocoder`, `/bass`, `/drums`, `/looper` and `/studio`. `/mono` was MS·1 and now
points at PM·1, which is most of what MS·1 was.

## Browser support

Chrome or Edge are the target. Both of the hardware-facing features are Chromium-first:

| Feature | Requirement |
| --- | --- |
| Web MIDI | Chrome, Edge, Safari 18+. Firefox prompts for permission. |
| `AudioContext.setSinkId` (output device routing) | Chrome 110+ |

Everything else — progression generation, both synth engines, patches — works in any modern
browser. Both apps degrade with an explanatory message rather than breaking when MIDI is
unavailable.

## Hardware notes

Built against a Teenage Engineering EP-133. It enumerates as a class-compliant USB audio
device (2 in / 2 out at 44.1 kHz) and a USB MIDI device, so macOS picks it up with no driver
and the browser can reach both directly.

Latency is the one real limitation of staying in the browser: Chrome's output latency runs
roughly 15–40 ms and is not tunable. Fine for sequencing and recording, less so for tight
live playing against an external clock. The stats line under Audio I/O reports the actual
figure for your device.
