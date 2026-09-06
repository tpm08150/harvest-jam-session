# Jam Session

Six instruments that run entirely in the browser, separately or together. One HTML file
each, no dependencies —
generate and play music, shape it with a small synth engine, and drive external hardware
over MIDI. Each ships as a single self-contained file; they are assembled from `src/` by a
concatenation script that needs nothing but Python.

| | | |
| --- | --- | --- |
| **CS·1** | `chord-synth.html` | chord synthesizer — progressions, pads, harmony |
| **PM·1** | `poly-synth.html` | poly/mono synth — the main voice |
| **VC·1** | `vocoder.html` | vocoder, with its own carrier and sequencer |
| **BS·1** | `bass.html` | bass pedals, with a 303-style sequencer |
| **DR·1** | `drums.html` | drum machine — eight synthesised voices, sixteen steps |
| **LP·1** | `looper.html` | audio looper — record, loop and overdub in time |
| **Studio** | `index.html` | all three on one page, sharing a clock and an audio bus |

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

A row is a complete picture: an instrument with nothing in the row you fire **stops**, rather
than carrying the previous row's part underneath.

**When** a fired row lands is a setting — instant, next bar, or when CS·1's progression comes
round, which is the default. **Cmd-shift-click** empties a block.

LP·1 keeps a **separate audio take per row**, so a row can carry a loop as well as patterns.
Every track can be armed. PM·1, VC·1, BS·1 and DR·1 also take notes you play onto the grid
as you play them; CS·1 and LP·1 do not — a row press captures CS·1's progression and records
LP·1 an audio take.

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

## Controllers

Under **MIDI** in the studio there is a **Controller** menu. It lists the controllers the
app has a profile for *and can currently see* — an empty list means nothing it knows about
is plugged in, rather than a menu of things that would do nothing if picked. Pick one and
it maps itself; the choice is remembered and comes back on the next load, and survives
unplugging the cable to move a desk.

Profiles do the thing MIDI learn cannot. Learn is still there and still right for a knob
box nobody has ever seen, but a controller with a published specification does not need to
be taught which pad is which, and a learned map can never light an LED back.

### Novation Launchkey MK4

Encoded from Novation's Programmer's Reference Guide v2.0, for the Mini and full-size SKUs.
The Launchkey shows up as two USB ports and the app uses both: the keys stay on the ordinary
MIDI port and reach the instruments through the usual router, while the pads, encoders,
transport and LEDs run over the DAW port, which the surface takes for itself.

| | |
| --- | --- |
| **Keys** | play whichever panel has the focus — turn on *Plays the selected panel* |
| **Pads, DAW layout** | the focused panel's grid — see below |
| **Pads, Drum layout** | DR·1's kit, wherever the focus is, one lane per pad in the order the panel lists them |
| **Encoders** | the focused panel's eight main controls, named on the screen as you turn them |
| **∧ ∨ right of the encoders** | which eight — the drum lane on DR·1, a parameter bank on PM·1 |
| **▶ / ■** | the rack transport, the same button the launcher's Play is |
| **∧ ∨ left of the pads** | page the grid — see the sequencers below |
| **Shift + ∧ ∨**, or **Func + ∧ ∨** | move the focus to the previous / next panel |
| **Func + a pad** | the accent |
| **Hold a pad, press another** | tie the steps between them into one held note |
| **Func + Record** | panic |
| **Screen** | which panel, which bank, and what all eight encoders are |

Eight encoders and more than eight things worth turning — every synth here, and PM·1 by a
factor of ten — so the arrows beside the encoders move **which eight they point at**. The
instrument decides what a bank is:

- **DR·1** — a bank is a **drum**. Six of its eight faders already edit whichever lane is
  selected, so choosing the lane *is* choosing the eight; Swing and Accent are the pattern's
  and sit still across all of them. The pads follow too, since the step grid shows the
  selected lane — one button and the whole surface moves to the next drum.
- **PM·1** — a bank is a group of parameters: **Perform, Filter, Flt env, Amp env, Osc,
  Shape, LFO, Keys**. ⚠️ The first is not a group but a *hand* — cutoff, resonance, envelope
  amount and the amp envelope, gathered from three different sections of the panel, because
  those are what you reach for while a part is playing. Starting at Oscillator 1 because that
  is where the panel starts would put the least-touched knobs under your fingers by default.
- **Everything else** has eight controls or fewer, one bank, and the arrows stay dark.

One mechanism, two meanings, and that is the point rather than a compromise: the surface asks
for the next bank and gets the next eight. It never learns that one instrument spells that as
a parameter group and another as a drum.

### The desk, on the controller

**Shift + Mixer** on the Launchkey — the way that keyboard has always said "these knobs are
the desk now" — points the surface at MX·8 instead of at a panel, and brings the Tape tab up
with it. **Shift + Plug-in** goes back to following the focused panel. Nothing is invented:
the surface honours a choice the hardware already offers rather than growing a mode the
device knows nothing about.

Nine controls per strip and eight encoders, so the banks are forced into a shape — and it is
the right one. Volume is the control you want across *all* the channels at once, because that
is what a mix is, so it gets a bank with every strip on it. The other eight are per-channel
questions, so they get a bank each, which is also what a strip *is*.

| bank | encoders |
| --- | --- |
| **Levels** | the seven instruments and the master |
| **DR·1 … TS·1** | that strip's `Hi Mid Frq Low Cmp Rev Dly Pan` |
| **Returns** | reverb and delay returns, delay time and feedback |

**Pads are mute and solo** — mute on the bottom row, solo above it, the way every desk prints
them and the way this panel's own M and S buttons sit. Seven channels, so the eighth pad in
each row is dark: the master has no channel, no EQ and no mute, and a pad that quietly did
nothing would be worse than no pad.

**Record rolls tape.** It does nothing on a panel, where it would obviously mean "capture into
the armed scene row" and could not be undone — but a take is *added*, and Erase, the control
that throws one away, is the deck's own and asks twice. Play stays the rack transport
everywhere, so a take is Play then Record, which is the order you would work in anyway.

⚠️ **The desk owns no audio and neither does this.** Every value is read and written through
the knobs and faders already on screen, so a move from the encoders is the same move a hand
would have made — persisted, painted, and recalled by a scene exactly as if you had dragged
it.

What the sixteen pads mean follows the panel you clicked:

- **CS·1** — the chord slots, filled bottom-up so pad 1 is bottom-left, exactly as they are
  laid out on screen. A held pad pulses; the slot the transport is playing is lit. CS·1 is
  the one panel whose pads are not steps, because its pattern is a progression rather than a
  line of notes.
- **DR·1** — the steps of the selected lane, read from the top left. Accented steps are red,
  the playhead is white. A pattern can be 64 steps and the grid is 16, so the arrows to the
  left of the pads page through it in banks of sixteen — 1–16, 17–32, 33–48, 49–64 — and
  they light only while there is somewhere to go. A page here is one row of the panel's own
  grid, which already wraps at sixteen, so the two views agree.

  Where you are is said in three places, because a page you have to keep count of is a page
  you will lose — and this is true of every sequencer here, not just DR·1: the controller's
  screen shows the range on its resting display (`BD 33-48`,
  always, so a pattern with only one page says so rather than looking identical to one parked
  on its first bank), a press raises a temporary display over it so the answer arrives while
  your finger is still on the button, and the panel tints the sixteen steps being edited —
  one row of its own grid, which already wraps at sixteen. The tint appears only while a
  surface is connected and the pattern is longer than one page.

  In Drum layout, **hitting a pad selects that lane** as well as sounding it — the same
  thing clicking a lane name on the panel does. It is what makes the step grid and the eight
  encoders reachable without going back to the mouse.
- **PM·1, BS·1, VC·1** — their step sequencers, same grid and same paging. ⚠️ **A step you
  switch on takes the note you last played**, so writing a line is playing the pitch once
  and tapping the steps that want it, rather than turning steps on and then correcting every
  one. Hold a key while you tap and that note wins instead — a key under a finger is a more
  specific statement than one you let go of, and on PM·1 a held chord records as a chord.
  The controller's screen shows which note is queued (`17-32  G2`), because it is the one
  fact you cannot see from the pads. Accented steps are red, ties and slides amber.

  **Holding one pad and pressing another ties everything between them** into one held note —
  which is how you write a note longer than a step without leaving the controller. Holding,
  rather than two presses in a row: sequential presses cannot be told apart from two ordinary
  edits, so every second press would silently become a tie. The gesture is idempotent rather
  than a toggle — the anchor pad's own press has already run by the time the second pad
  arrives, so an "undo" would depend on what the step happened to be before you touched it.
  Clearing a held note is pressing its steps, which is what a press has always meant.

  This is the panel's own gesture, not a second one: the pads and the on-screen grid run the
  same `press()`, so a lane or a modifier added to one is in the other by construction.

- **LP·1, TS·1** — no sequencer of their own, so the pads fall through to the scene launcher.

- **The scene launcher** — sixteen rows on sixteen pads, amber for a stored row, pulsing for
  one that is armed, green for one that is sounding.

The pads are lit from what is actually true rather than from anything an instrument
remembers to announce, so a chord arriving on the transport's own schedule lights its pad
without CS·1 knowing a Launchkey exists.

If a control seems to do nothing, ask the device rather than guessing. Every message the
surface port delivers is kept sixty-four deep and readable from the console while it is
plugged in — `Patchwork.surface.traffic`, newest last, as hex. An empty list means the
control sends nothing at all, which is a different problem from one that is sending
something unexpected.

The resting display is the encoder legend, in the same layout the Launchkey uses for its own
Arp page — a title over a 2x4 grid of names:

```
        DR-1  HT
Tun Ton Dec Lvl
Vrb Gat Swg Acc
```

⚠️ **The title carries the bank, because the eight names below cannot.** On PM·1 they can —
`Cutof` and `Reso` say "Filter" between them — but on DR·1 every bank has the *same* eight
names and only the drum changes, so a legend without a title would be identical for the kick
and the snare.

⚠️ **Names are three characters, because the device packs rather than pads.** Four five-letter
names came out as `CutofResoEnvAmKeyTk` — one unbroken word with no way to see where each
began. The row is about twenty characters wide whatever goes in it, so three letters each is
what leaves gaps between them. Chosen rather than truncated: `Rel` is a better word than
`Releas`. A control carries a `short` for this and falls back to its panel label, which will
be cut.

Turning an encoder raises its own name and value over the top; paging the steps flashes the
new range. The resting display is for what is *true*, the temporary one for what just
*happened* — and a temporary display sits on top of the legend while it lasts, so it has to
earn its place. ⚠️ **Changing encoder bank raises nothing**, because it rewrites the legend
itself: title and all eight names, in more detail than two temporary lines could give.
Flashing over that hid the very thing that had just become correct. Paging keeps its flash
because the step range is *not* in the legend, so without it nothing says which sixteen.

The timeout is set to **half a second**, down from the four or five the device ships with.
⚠️ That setting is **non-volatile** — it survives a power cycle — so it is read before it is
written and put back when the controller is disconnected. An app that quietly re-tunes
somebody's hardware and leaves it that way is a bad guest. (If the browser is killed outright
the restore cannot run; the Launchkey's own Settings will put it back.)

**SysEx** is asked for only when you pick a profile that wants it, because Chrome's prompt
for it is a different and more alarming one than plain MIDI's. Refusing costs the screen and
nothing else. The answer is remembered.

⚠️ **Record does nothing on purpose.** It is the one button whose obvious meaning — capture
into the armed scene row — cannot be undone, and a stray thumb should not overwrite a take.

## Running it

Web MIDI requires a secure context, so `file://` will not work — it needs `localhost` or
HTTPS. There is a tiny no-cache dev server included:

```bash
python3 serve.py
```

Then open `index.html` for the studio, or any single instrument — `chord-synth.html`,
`poly-synth.html`, `vocoder.html`, `bass.html`, `drums.html`, `looper.html`. One server
serves them all.

The two HTML files are assembled from `src/` by `tools/build.py` — **edit the fragments, not
the built files.** The build is a plain concatenation and needs nothing but Python, so the
shipped app is still one file with no dependencies:

```bash
python3 tools/build.py
```

Deployed on Netlify, CS·1 is at the root and the rest have clean paths of their own:
`/poly`, `/vocoder`, `/bass`, `/drums`, `/looper` and `/studio`. `/mono` was MS·1 and now
points at PM·1, which is most of what MS·1 was.

## Jamming

Everyone on a jam plays the same grid. **Nobody streams audio** — every browser synthesises
its own sound from the patterns and parameters that cross the wire, which are a few KB. The
looper, the metronome and the talkback microphone are the exceptions, because they are the
things that have no pattern to send.

That works over a network because of the seam: nothing in this app says *change now*, it
says *change at boundary N*, and each client works out when that is from a clock the relay
hands out. A message only has to beat the boundary, so 150 ms of internet still lands on the
same bar line for everyone.

Press **Join…** and pick a running jam rather than typing its name — typing the same string
on two machines is the single most likely way to end up in two empty rooms. Read the head
bar: it names the transport, so a two-laptop test that is quietly two tabs is visible.

### Where the jam meets

| | |
| --- | --- |
| *(no query string)* | the hosted relay this build ships with — the deployed link |
| `?relay` | a relay on this host, port 8124 — two laptops on one network |
| `?relay=192.168.68.51` | that host, port 8124 |
| `?relay=wss://host` | spelled out in full |
| `?relay=off` | no relay: other tabs on this machine, and nothing else |

For two laptops on one network, run the relay on either machine and open both browsers on
`http://<that machine>:8123/?relay` — the bare `?relay` means "the relay is on this host"
and exists because retyping an IP twice in one URL is a trap that cost a real test:

```bash
python3 serve.py                    # the studio, 8123
python3 tools/jam-relay.py          # the relay, 8124
```

Over the internet, the deployed site talks to a Cloudflare Worker — see [`relay/`](relay/)
for what it is and how to deploy your own. ⚠️ **A page served over https cannot open a
`ws://` socket**, which is the whole reason the hosted relay exists; the studio now says so
rather than sitting on "connecting…" forever.

There are two relay implementations and one protocol. `tools/relay-check.py` is what stops
them drifting:

```bash
python3 tools/relay-check.py ws://localhost:8124
```

### What a jam does not share

CS·1 has no patch channel: its progression, key and mood *are* its pattern, and the scene
already carries them. LP·1 shares takes only when you push one — a take you are not sure
about should not be everybody's problem. Nobody's transport position is shared; everyone
fires their own rows, deliberately.

⚠️ **Patterns are last-writer-wins.** Two people editing one grid overwrite each other. The
owner label on each plate says whose hands are on which panel, which is coordination rather
than a lock — a lock needs the relay to arbitrate, which is possible now that there is one.

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

⚠️ **Where the Programmer's Reference and the hardware disagree, the hardware wins.** The
profile is verified against `tools/build-surface-harness.py`, which fakes both of the
device's USB ports and checks the bytes in each direction — the handshake, the pad decode,
the LED colours, the screen text, the teardown. That catches a wrong decode and cannot catch
a wrong *number*, and three of the numbers in `shell/launchkey.js` turned out to be wrong:

- The **encoder arrows** are CC 51 and 52 on channel 1. The Mini's own figure in the guide
  prints 55 and 56; the full-size figure prints 51 and 52 for the same pair, and that is what
  a Launchkey Mini MK4 37 actually sends.
- The **DAW-mode button channel** is not stated anywhere in the guide — it was read across
  from the standalone section, wrongly. The profile matches on the CC number and ignores the
  channel, which is safe on a port carrying nothing but this device's surface.
- **Shift** cannot be combined with anything: the device remaps the keys instead of passing
  a modifier, so "Shift + arrow" is not a thing to listen for — 103 and 102 are. Two wrong
  guesses came from assuming otherwise.

`Patchwork.surface.traffic` is what settled each of those: the last 64 messages from the
surface port, as hex, readable from the console while the thing is plugged in. Reach for it
before changing a constant, not after.

One still unsettled: the guide gives the Drum-layout status byte as `9Ah` while calling it
Channel 10, and those disagree. Both are accepted on the way in, but the colours go out on
channel 10 (`99h`) — if the drum pads respond but stay unlit, that is the constant to flip.

⚠️ **Shift does not pass a modifier, it remaps the key.** This cost two wrong guesses. Shift
is reported — it arrives on channel 7 — but it can never be combined with anything, because
the Launchkey does the combining itself: hold Shift and the arrows beside the pads stop
sending 106/107 and send 103/102, the device's own *Track* pair printed above them. Shift and
a pad go further and never arrive at all, being how its pad-mode menu is driven.

So nothing is built on Shift and it is not even recorded. What it produces are simply *other
buttons*, bound like any other — which is why Shift + ∧∨ changes panel: not because a
modifier was read, but because Track is a different button that means "which track". **Func**
is the one modifier this profile holds, and the only one it needs.

⚠️ **The arrows beside the pads do not do what the unit is printed with.** They read *Track*
and they page the grid; *Func* and the same pair walks the rack, and they turn white under
Func to say so. The rule is that the two buttons a thumb finds without looking are the ones
next to the grid, so they move the grid — one axis inside a pattern, the other across the
rack, the same gesture at two scales. `>` is unassigned and stays dark.

Latency is the one real limitation of staying in the browser: Chrome's output latency runs
roughly 15–40 ms and is not tunable. Fine for sequencing and recording, less so for tight
live playing against an external clock. The stats line under Audio I/O reports the actual
figure for your device.
