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
bank and shadow it rather than overwriting it, so the bank is always recoverable. A saved or
exported patch carries the sequence along with the sound: every step, with its chord, accent,
slide, tie and parameter locks. ⚠️ **Until 2026-09-13 a saved patch dropped the chords**, so a
chord step saved before then holds only its root in the file, and loads as that.

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

**Punch** is the row of pads over the launcher: sixteen master effects you **hold** — press and
the effect is in, let go and it is out. The number row plays them too (`1`–`0`, then `Q`–`Y`),
the arrows or the wheel move the last one's number, and **Latch** turns every press into a
toggle for when both hands are busy. They sit after the looper's taps, so a stutter thrown over
a take is not printed into it. On a Launchkey, Func opens them as a page of their own — see
*The punch page*.

⚠️ **An LP·1 cell names a take rather than holding one.** Clicking it puts the take the looper
is currently on into that row — the same sentence every other cell answers, theirs holding a
pattern and this one a take number, which is why the cell shows the number. Two rows can name
the same loop. Shift-clicking **forgets the reference and keeps the audio**: clearing a cell
is tidying an arrangement, and destroying a recording is something you ask for on the take
strip rather than get as a side effect. An *empty* take cannot be put on a scene at all — a
reference to silence looks exactly like a loop until the row comes round and nothing happens.
Every track can be armed. PM·1, VC·1, BS·1 and DR·1 also take notes you play onto the grid
as you play them; CS·1 and LP·1 do not — a row press captures CS·1's progression and records
LP·1 an audio take.

**Clear** empties a sequence, and reads *Undo* until you put something back into it — no
timer to beat and no confirm to click through, because the button says what it will do and
the undo expires exactly when it stops being safe.

⚠️ **LP·1 records into the scene that is playing.** Arming with no slot used the last take you
selected, which starts at 1 and only moves when somebody picks one — so a loop recorded over a
running scene 2 landed in scene 1 every time, and the take strip said so afterwards in a place
you were not looking. A looper's row is the rack's row; that is the whole premise of one take
per scene. With nothing playing there is no scene to join and the selected take is right.

**Arming a take moves you to what you are recording.** The pad that starts a take and the
panel that makes the sound are two different places, and the count-in is the worst moment to
be finding the second one — so the hop that Func + `>` does by hand happens on its own. Only
on *record*: firing a take back is listening, and being thrown at an instrument you did not
ask for would be the surface moving under you. Func + `>` is still how you come back.

**Hold a note and it records as long as you held it**, as a run of ties on the steps it
covered — the three pitched instruments all do this, and a drum does not, because a drum has
no length to record. Playing a shorter note over a longer one takes the old tail with it, so
a part is something you can play again rather than something you have to go and shorten by
hand afterwards.

## On a Raspberry Pi

Plug a Launchkey into a Pi, power it on, play. `pi/setup.sh` provisions Raspberry Pi OS
Lite: a local server (Web MIDI needs a secure context, and `http://localhost` is one), then
Chromium fullscreen inside `cage` at `index.html?kiosk`.

⚠️ **Every default in this app assumes a person is in front of it** — the surface waits to
be picked from a list, SysEx waits for a deliberate click, the audio context waits for a
gesture. `?kiosk` says the operator already answered those by building the machine: it asks
for SysEx up front, brings the audio up, and connects the one detected controller. *One* —
it will not guess between two, because a rack with two known controllers on it is a
decision and decisions belong to a person even when the person is not in the room.

The thing that would normally kill this was already fixed for another reason: a
`setInterval` in a tab you cannot see throttles to about 1.3 Hz, so `shell/clock.js` runs
the tick off an AudioWorklet. Every sequencer on the box keeps time with no screen attached.

**The output device is selectable from the controller** — the mixer's last encoder bank —
because a machine with no screen still has to be told whether it is playing out of the
headphone jack or a USB interface.

⚠️ **Which device and which channels are different questions.** The device belongs to the
whole `AudioContext`, so it is one global choice that overrides everything. Which *channels
of that device* an instrument lands on costs a merger and a splitter, so that one is per
instrument — on the **Settings** tab, laid out the same way as the MIDI rows beside them. Plug in an eight-out
interface, put the drums on 3-4 and the bass on 5-6, take separate feeds to a desk. A pair
takes the instrument off the main mix; the tape and the looper are unaffected, because they
tap strips directly rather than the master sum. LP·1 and VC·1 get an audio *input* row too.

⚠️ **The browser decides how many channels a device has.** On a Mac, Chrome counts only the
outputs named in **Audio MIDI Setup → Configure Speakers**. The EP-136 in Multi mode has four
(`1 L/R` and `2 L/R`) and opened as stereo, every row greyed out, until they were named; then
the rows offered 3-4. Reload the page after changing it. Inputs have no such fix: Chrome on a
Mac opens any input with more than two channels as its first two, so VC·1 and LP·1 hear the
EP-136's `MAIN L/R` and never `CH1`, `CH2` or `AUX`. Nobody has yet listened to what arrives at
the mixer on 3-4.

See `pi/README.md`, and read `pi/setup.sh` before you run it: none of the Pi half has been
run on real hardware.

## The launcher on the pads

There are **thirty-two rows**. ⚠️ Sixteen was chosen because a controller has sixteen pads,
which quietly made the number a coincidence two other things had come to depend on: the
shell's fallback pad grid drew rows 1–16 and stopped, and the looper's worklet scanned a fixed
sixteen slots for the takes it held. Both were invisible while the two numbers agreed. The
grid pages now, and the worklet scans its own array.

⚠️ **The pads are the matrix, not the row list.** Sixteen pads and sixteen rows made this one
pad per row — a tidy coincidence and the wrong picture. The launcher on screen is instruments
*across* and rows *down*, and a grid flattened to a column of rows could tell you a row held
something and never which instrument held it.

So the pads are two rows of the real grid: **the top eight are the row the cursor is on, the
bottom eight the row after it**, and the columns are the instruments in the order the screen
draws them. The controller's screen says which two rows those are, because two rows out of
sixteen on pads with no numbers is otherwise a guess every time you look down.

**A press puts that instrument's current pattern into that cell; a second press takes it out
again** — the same call clicking and shift-clicking the box makes, which is also why a slot
track records a real audio take here without the pads knowing they did anything different.

**The launcher on screen and the pads say the same thing in the same colours** — empty is dim
white, full is the column's own hue, playing is green, coming is the hue flashing. One table
drives both, so what you learn looking down you already know looking up.

⚠️ **And a departing cell flashes white.** Firing a row queues the instruments it has *nothing*
for as well — their pending pattern is a null meaning "stop at the seam" — and those used to
flash in the column's own colour, which reads as arriving. An arm with nothing behind it is an
ending, and white is what this grid already uses for "nothing here".

⚠️ **Colour means "there is something here."** It used to mean "this column is the bass" in
every state, with brightness carrying whether the cell was full — so a grid of eight columns
was lit in eight colours whether or not anything was in it, and the one question you actually
ask it was answered by a brightness step you had to compare against neighbours to read. An
empty cell is **white** and dim: white belongs to no instrument, so it reads as absence rather
than as a ninth column. Only a cell with something in it wears a colour, and which colour
still says whose it is.

(Elsewhere, an empty pad sits at the dimmest shade of its own hue — each has four levels and
"nothing here" used to be the middle one. `DIM_STEP` in `shell/launchkey.js` is the number to
raise if a dark room makes them vanish. Off is not an option: an empty cell you can still
press must not look like a pad that does nothing.)

⚠️ **A column is an instrument, so a *pad* has its colour** — and the boxes on screen do not.
Tried both and took the second back out: on the hardware the columns are unlabelled and colour
is the only thing that says which instrument a pad belongs to, while on screen the column
headers already say it in words, so the same idea that earns its place there is noise here —
seven hues competing with the one distinction the grid exists to draw, which is full against
empty. Green stays reserved on the pads for the thing louder than either axis: this cell is
playing right now.

⚠️ **A cursor is not a page.** The pads show two rows and the cursor walks all thirty-two,
so paging them would be a second way to move through the same list. The pair beside the pads walks the cursor and `>`
fires the row it is on, which is the whole gesture on a controller you are not looking at.
**The screen shows where it is aimed** — a marker down the left edge of the row, in a colour
of its own, because playing is already green here and queued is already amber and a cursor
borrowing either would read as a row doing something. Clicking a row aims it too: two ways to
say "this row" that disagreed would make `>` fire something you were not looking at.

⚠️ **And the launcher is selectable like a panel.** It carries a `data-instrument` although it
is not an instrument — that attribute is what makes a block on this page focusable, and the
launcher was the one thing on the Studio view you could not point at. Click it and the
encoders and pads follow, exactly as they do for a synth. The lists that are genuinely *about*
instruments — the Settings tab's audio and MIDI rows — filter it out by asking the registries
who registered as one, rather than by reading the attribute.
Stop is the transport's own square button and always was; spending `>` on a second way to do
that left the one thing this page exists for with no button at all.

**Func turns the pads into mute and solo** — the same grid the mixer page draws, borrowed
rather than rebuilt, so the two cannot disagree about what is muted. ⚠️ The grid is told what
is held, because a modifier that changes what a pad *does* has to change what it *shows*: a
mute grid you cannot see the state of is a row of identical buttons.

Two encoder banks: **Levels** first, because the reason you are on this page with your hands
on a controller is usually that something is too loud — then click, tempo, bars and *lands
on*. Tempo keeps the pair beside the encoders as well as having a knob, because a nudge of
exactly one is what that pair is for.

## SQ·1 — the external sequencer

⚠️ **The one panel here that makes no sound.** Every other instrument ends at the audio bus;
this one ends at a five-pin cable, and what it is for is the box on the other side of it. It
has no voice, no strip and no fader — which is a fact other things have to be told, because
anything drawing a channel per panel would otherwise grow a fader that moves nothing. The
panel says so in its own markup (`data-silent`), and the desk, the audio rows and the output
routing all ask.

**Sixteen tracks, one per MIDI channel, sixty-four steps each.** The track selector *is* the
channel selector: there is no second control asking which channel a track is on, because that
is the whole model.

A track is either a **drum** track — eight lanes of on/off/accent, each lane sending a note
number you set — or a **synth** track, which is the shared sequencer wholesale: pitch as a
scale degree, accent, slide, tie, parameter locks and live recording. ⚠️ Both models exist for
every track and only one plays. Switching while you are looking for something should not cost
you the pattern you already wrote.

⚠️ **A press turns a step on and off; accent is its own gesture.** It used to be off → on →
accent → off on the one control, which is elegant right up to the moment you want a step gone
and the only route there is through accenting it first — two presses to undo one, on the
gesture you make most often with a pattern running. DR·1 reached the same conclusion about the
same cycle and this follows it.

⚠️ **And it is answered differently by each hand.** On the controller **Func + a pad** writes
the accent, because there is no second control to reach for mid-take and a modifier under the
same thumb is free. On screen it is a **Step / Accent** mode, because the downbeat of a kick is
accented nearly every time and holding a key to draw the thing you draw most is worse than
pressing a button once. Shift-click still works for anyone who reaches for it. Accent on an
*empty* step writes an accented step rather than nothing — you are asking for a loud hit
there, and drawing it twice is the second press this whole change removes.

⚠️ **The General MIDI drum map is a starting point, not a rule.** Outboard gear agrees about
almost nothing, and a sequencer that could only address the notes a 1991 module used would be
useless in front of most of it — so each lane carries a note number you edit, with the note
name beside it, because 46 and A♯2 are the same fact and only one of them is a sound you can
hum.

⚠️ **Each track keeps its own length and rate.** That is the reason to own one of these: a
twelve-step hat against a sixteen-step bass is a polyrhythm, and the same two locked to one
grid is a fill you write out longhand. They meet only at the shell's clock, which is what
keeps them locked to the rest of the rack rather than merely near it.

On the controller the pads are the **selected track's steps** — the shared paged grid on a
synth track, and on a drum track the top row is the lane's steps with the bottom row picking
the lane, because which lane you are on is something you change constantly while writing
drums. The pair beside the encoders walks the sixteen tracks; `>` flips the selected one
between the two kinds.

⚠️ **The last encoder is always what a press writes** — the lane on a synth track
(gate/pitch/accent/slide/tie), the write mode on a drum one. Both answer the same question,
which is what a pad or a click is about to do to a step, and it is the one thing you change
with the other hand still on the grid. Pinned to eight rather than appended, because the two
faces have different numbers of controls before it: a knob meaning "the last one" should not
be the seventh on one track and the eighth on the next.

**Func + `>` walks Play and Step programming.** ⚠️ That gesture is the linked-pair hop, and
only LP·1 declares a partner — so on every other panel it was two keys held for no result,
and it is the last free pair on the surface. It falls through to the panel now, the same way
the arrows fall through to a bump when there is nowhere to page.

⚠️ **Style is not on a knob.** Drum or synth changes what a track *is* — which grid the pads
are, which controls exist, what the screen says — and a decision that large arriving from a
knob brushed in passing is the wrong shape for it. It is on `>`, which is a press, and on the
panel, which is where you were when you decided. Mute stays on a knob, because muting is a
performance and you do it mid-bar.

⚠️ **One encoder bank, and that is what makes the arrows the track selector.** There were two,
and the pair beside the encoders pages banks *before* it asks a panel for its own bump — so
walking to track 5 meant paging past a bank first, and the arrows appeared to do nothing every
other press. On a sixteen-track sequencer the track *is* the navigation, and everything worth
turning fits in eight knobs anyway.

The screen carries **which track**, not just which steps: every other panel has one sequencer
so its grid never had to say, and here "1-16" alone names the step range of a track you cannot
otherwise see. Changing track flashes it, and the resting display keeps it.

**The part being edited is drawn on screen**, on both faces — the sixteen the pads hold on a
synth track and the eight on a drum one, as a wash and a left edge rather than a fourth
outline, and only while a surface is connected. A window nobody can move is a window that
means nothing.

⚠️ **A scene lands on SQ·1 on the row's seam, like everything else.** It used to wait forever:
SQ·1 never asked for a queued row, so firing one while it played left the cell flashing armed,
and a row with nothing for SQ·1 never stopped it. Every playing track asks now, and the first step
at or past the seam on any of them changes all sixteen — notes, lengths, rates, styles and mutes.
**A track the row mutes stops on the seam and one it unmutes comes in on it**, which holds for a
jam's live pattern and a sequence chosen on the strip too.

## MIDI out

⚠️ **One cable out for the rack, one channel per instrument** — the same shape the input
already had, and the same shape the audio bus arrived at separately. PM·1, CS·1 and DR·1 each
grew their own output port select: three answers to a question with one answer, each behind a
panel you had to open to find it. The channel is the instrument's; the cable is the page's,
and it lives on the Settings tab.

BS·1, VC·1 and TS·1 speak now. A bass line written here drives the room as well as the
speakers; TS·1 sends **one note when the sweep lands**, not when you arm it — the whole shape
of that instrument is asking for something up to eight bars before it happens, and a receiver
told at the arming would drop its impact at the wrong end of the run-up. It is scheduled with
a timestamp for the same reason.

⚠️ **LP·1 takes a channel although it takes no notes**, which is the distinction that kept it
off the router for so long. A looper has no pitch to play — that is why it registered with
`surface.panel()` instead — but *no pitch* is not *no MIDI*. Sixteen notes from **C1** are the
sixteen slots: press one and it plays if it holds a take, records if it does not, exactly as
the pad does, because it is the same call.

## Projects

⚠️ **Everything on this page was persistent except the thing you actually made.** Sounds save
as patches, the desk remembers its knobs, the tape keeps its take, the MIDI map survives a
reload — and the scenes, the grid of patterns that *is* the arrangement, lived only in memory.
Close the tab and the song was gone while every setting around it stayed.

**Project** sits in the header between the view tabs and the jam controls: a list of what you
have saved, a Save button, and a menu with Save as, Revert, Export, Import and Delete. Save
overwrites what you opened; with nothing open it asks for a name, and the button says which of
the two it is about to do. Loading replaces the desk, so it asks first — but only once there is
something to replace, because a confirm on an empty page is a dialogue that teaches people to
click through dialogues.

⚠️ **The last project opens itself.** Without that the whole thing looked broken: the *name*
survived a reload and the state did not, so the list came back reading "My song" over an empty
desk — and picking "My song" out of it did nothing at all, because it was already what the
list said and browsers do not report choosing what was already chosen. A project you have to
remember to re-open is a project you will lose.

That same rule is why **Revert** exists: it is the only gesture for re-opening what is already
open, which is what "throw away what I have done since" means. And **— unsaved —** steps out of
a project without touching the desk, so the next reload starts blank — an escape hatch rather
than a way to lose work.

⚠️ **A project is the sum of what registers with it**, not a list one file keeps:

    Patchwork.project.part("scenes", {capture, apply});

Writing out "rows, live patterns, sounds, mixer, tempo" in one place would mean a project
silently missing whatever is added next — and the thing added next is exactly the thing nobody
remembers to come back and add. Today that is the transport, the scenes, every instrument's
sixteen sequences and its sound, CS·1's whole patch and the desk.

Two things it took a round-trip test to notice:

- **The unstored patterns matter as much as the grid.** What an instrument is playing right
  now is usually not in any row — you build a part live and store it into a scene afterwards,
  or never — so a project saving only the rows would lose the thing you reached for Save to
  keep.
- **The faders were not in the desk's own saved state.** A channel's *level* belongs to the
  bus, read back rather than kept by the console, precisely so the desk and the launcher's
  faders cannot hold two ideas of it. Which meant the first version saved every EQ move and
  none of the balance, and came back with the mix flat.

**Export** writes a `.jam.json` you can keep or send; **Import** reads it back and saves it
into the list, because an import you cannot get back to after a reload has not really been
imported. A project that lives only in this browser is one cleared cache from gone, which is
not what Save promises.

## Scenes

The studio build adds a **scene launcher** over the three panels: eight rows, one cell per
instrument. Click a cell to fire that instrument's pattern, the row's ▶ to fire all three,
shift-click either to capture what is currently playing into it.

Nothing lands where you click it. A fired scene is *armed* — the cell pulses — and takes
effect at that instrument's next loop point, so switching mid-bar stays in time instead of
lurching. A scene changes what an instrument **plays**, never the sound it plays with; the
patch you dialled survives the switch.

## Sequences

Every instrument that plays a pattern keeps **sixteen of them**. The strip of numbers under the
patch row — on DR·1, BS·1, PM·1 and VC·1, above the track row on SQ·1, and called *Progression*
on CS·1 — is the bank. The grid is whichever one is up; click another number and the one you were
on is put away and that one comes up, empty if nothing has been written there. Go back and it is
exactly as you left it.

| gesture | what it does |
| --- | --- |
| **click a number** | bring that sequence up. An empty one starts blank, at the same length, rate and key |
| **shift-click a number** | copy the grid into it and go there — how a variation starts. Over a slot that holds something it replaces it, so copying a blank grid over one is how a slot is emptied |

A lit number has something in it; the ring is the one on the grid. CS·1 has no such thing as an
empty progression, so an empty slot there starts as a copy of the one you are on and stays unlit
until you change it — *New progression* makes it yours.

**The launcher is how they become a song.** A cell still copies what the instrument is playing,
which is now the sequence that is up, so writing a song is: write sequence 1 and click the rows it
belongs in, pick 2, write it, click its rows. **Each cell says which sequence it holds**, so a
column reads as the song's form — 1, 1, 2, 1. A cell shows a number only while it and that sequence
still match: rewrite sequence 2 and the cells stored from the old one stop claiming to be it.
Firing a row brings up the sequence it holds, so editing while you play edits that sequence.

⚠️ **A pattern that is in no slot is left on the grid, never filed into one.** A row holding
something no sequence matches, a jam partner's edit, or an older patch puts a pattern on the grid
and the ring goes out — the sequence you were on keeps what it had. Edits then live on the grid
only, and the next number you click replaces them, which is what firing another row always did to
an edit nobody stored. **Shift-click a number to keep it.** An empty slot has nothing to lose, so a
pattern arriving while you are on one lands in it.

**Sequences save with the patch.** Save a patch and all sixteen go with it; recall it and they come
back, with the one that was up — *Loaded Acid with 4 sequences*. An older patch carries none and
leaves them alone. A project saves every instrument's sixteen as well. On PM·1, choosing a sequence
never touches Motion — Off stays Off — though firing a row still puts it into Seq, as it always has.

A jam shares the grid, not the bank: your sixteen are yours.

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
| **Keys** | play whichever panel has the focus — *Plays the selected panel*, on by default |
| **Panel focus** | scrolls the page to the panel it moved to, since the rack is taller than the window |
| **Pads, DAW layout** | the focused panel's grid — see below |
| **Pads, Drum layout** | DR·1's kit, wherever the focus is, one lane per pad in the order the panel lists them |
| **Encoders** | the focused panel's eight main controls, named on the screen as you turn them |
| **An encoder over a list** | one detent, one position — see below |
| **Func + `>`** | hop between a linked pair — LP·1 and whatever it is recording |
| **∧ ∨ right of the encoders** | which eight — the drum lane on DR·1, a parameter bank on PM·1 |
| **Hold a pad + ∧ ∨ right of the encoders** | that note's length, a step at a time |
| **Func, tapped** | a panel's other face where it has one — on CS·1, the bass voice and its pattern; on the launcher, it opens the punch page |
| **▶ / ■** | the rack transport, the same button the launcher's Play is |
| **∧ ∨ left of the pads** | page the grid — see the sequencers below |
| **Shift + ∧ ∨**, or **Func + ∧ ∨** | move the focus to the previous / next panel |
| **Func + a pad** | the accent |
| **Hold a pad, press another** | tie the steps between them into one held note |
| **Func + Record** | panic |
| **Screen** | which panel, which bank, and what all eight encoders are — and pictures: see *The screen* |

Eight encoders and more than eight things worth turning — every synth here, and PM·1 by a
factor of ten — so the arrows beside the encoders move **which eight they point at**. The
instrument decides what a bank is:

- **DR·1** — a bank is a **drum**. Six of its eight faders already edit whichever lane is
  selected, so choosing the lane *is* choosing the eight; Swing and Accent are the pattern's
  and sit still across all of them. The pads follow too, since the step grid shows the
  selected lane — one button and the whole surface moves to the next drum.
- **PM·1** — a bank is a group of parameters: **Key, Filter, Flt env, Amp env, Osc, Shape,
  LFO**. The first is the panel's key-assign row — `Key Gld Pri Tim Det Wid Bnd`: how the
  voice is allocated, whether it glides, which note wins, and the four knobs beside them.
  ⚠️ Three of those are *segmented rows* rather than knobs, which is why they were unreachable
  before — a list under a continuous control needs the index treatment, and `segment()` in
  `shell/surface.js` does it once for every panel that has one.

  ⚠️ **A stepped knob is a short list wearing a knob's clothes**, and the octave selectors are
  the proof: five positions across their whole range, so a surface pushing the position back
  rounded every nudge to where it started and pinned them. Marking them means the position is
  sent once and then left alone — and the formatted value goes on the display, because `84` is
  not `+2 st`.
- **Everything else** has eight controls or fewer, one bank, and the arrows stay dark.

One mechanism, two meanings, and that is the point rather than a compromise: the surface asks
for the next bank and gets the next eight. It never learns that one instrument spells that as
a parameter group and another as a drum.

### The desk, on the controller

⚠️ **The four encoder modes are the four views**, which is a coincidence worth taking. Shift
and a pad is already how a Launchkey chooses what its knobs are for, and the app already has
four screens — so wiring one to the other means the surface has no navigation of its own to
learn and no button spent on it.

| | |
| --- | --- |
| **Shift + Sends** | Live — the launcher on the pads, ∧∨ walk the rows, `>` fires the one you are on; **Func** opens the punch page |
| **Shift + Custom 1** | Settings — a Global bank, then one bank per instrument, and the pads are the banks |
| **Shift + Plug-in** | Studio, and the encoders follow the focused panel |
| **Shift + Mixer** | Tape, and the encoders become MX·8 |
| **Shift + Transport** | Library |

Mixer is the only one that also retargets the encoders, because it is the only one of the
four that is a thing to turn knobs at. A Custom mode is somebody else's and leaves the app
where it is rather than guessing.

⚠️ **The tab strip is in the Launchkey's order** — Studio, Tape, Live, Library — rather than
the order the views were built in. The controller's four pads read Plug-in, Mixer, Sends,
Transport left to right, and Shift and one of them is how you change view now; a tab strip in
a different order means the second pad and the second tab are different places, and the hand
learns one of them wrong.

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

⚠️ **Record arms, Play rolls.** One rule across three different recorders, and it is the rule
they already followed separately:

| where | Record arms | and then |
| --- | --- | --- |
| **Tape** | the deck | the rack transport rolls it |
| **a panel** | that instrument for scene capture | firing a scene row records it |
| **LP·1** | the looper | a row takes real audio |

None of that is invented. Every one of those arms is a button already on the panel — the
deck's own Record, the arm toggle `shell/record.js` puts on every plate — so the controller
presses the arm that is already there rather than growing a fourth meaning for a fourth
recorder. The Record light is red when the thing you are pointed at is armed, and dark when
it is not; never dim, because a record light that is only slightly on is one nobody trusts.

Rolling on the press meant the first bar of every take was the sound of somebody reaching for
play; arming lets the take and the music start on the same gesture. An armed deck rolls with
the **rack** transport rather than the tape's own Play, because "play" for a rack of
instruments is that button. The rack stopping ends the take.

⚠️ **With anything on the launcher, that Play starts the song rather than the rack.** An armed
deck fires the **first row that holds something** — a pattern or an LP·1 take, whichever row
that is — instead of pressing every panel's Play, and the take rolls with it. From there you
fire rows by hand and the tape prints the arrangement as you play it. Every Play at once was a
take of whatever each instrument was last left holding, which is nobody's song. An empty
launcher has no song, so Play is the rack as it always was, and so is Play with the deck not
armed. While a take rolls, a playing looper counts as part of the rack, so stopping the take
stops the looper too: the scene that started the take may be what put it there.

Armed is a steady ring on the deck's record button and a steady light on the tab; rolling
keeps the filled blink it has always had. Two states of one button, and the one that decides
whether the next take exists cannot be ambiguous.

⚠️ **Shift + Play is not a modifier and a key — it is the device's Stop button**, which is
why it stops rather than plays. It stops **everything**, rack and tape: a Stop that leaves
something running is worse than none, because you press it, the room does not go quiet, and
now you are hunting. Distinct from Func + Record, which is panic and also chases stuck notes
out of external gear.

⚠️ **Play does the obvious thing, and which one is obvious is the page's business.** Two
transports and one button:

| where | Play | Func + Play |
| --- | --- | --- |
| **Studio, Live, Library** | the rack | — |
| **Tape**, armed *or rolling a take* | the rack — from the first scene when the launcher has one — and the deck rolls with it | hear the tape back |
| **Tape**, not armed | play the tape back | the rack |

Armed you are making a take, so Play has to start the *band*; not armed you are listening
back, so it has to start the *tape*. ⚠️ **A take in progress still counts as armed** — the arm
is spent the moment recording fires, and keying on it alone flipped Play's meaning underneath
you: the press that *started* the take was the band, and the very next press was the tape,
which stopped the tape, left the rack running, and offered nothing on that page to stop it
with. What the rule is about is whether you are making a take, and you are for as long as it
is rolling. Which of those you want is never ambiguous — it is
written on the record button. Func always means the other one, so neither is ever out of
reach and there is no state to be in the wrong half of.

Tape playback toggles here although the deck's own Play does not, because the deck has a Stop
beside it and the controller has one button for the pair. ⚠️ And Func + Play is **playback,
never a take** — it is the one place the deck's own Play button cannot be used, because when
the deck is armed that button *rolls*, and rolling truncates the tape at the head. "Let me
hear that back" would have erased the thing you asked to hear.

**The arrows scrub the tape**, up for rewind, while you hold them — plain for fast, Func for
slow. Eight times realtime crosses a three-minute reel in twenty seconds, which is finding a
section; one times is finding a bar within it, and a single speed made one of those two jobs
annoying whichever number was picked. How fast "fast" is belongs to the tape rather than to
the controller that asked, because it is a fact about the length of a take.

⚠️ **The same two buttons, four meanings, and no mode.** Plain pages the grid — and where
there is nowhere to page, scrubs fast. Func scrubs slow — and where there is nothing to
scrub, walks the rack. A panel has pages and no tape; the mixer has a tape and one page, so
whichever of the pair applies is the one that answers and neither button ever sits dead. The
arrows go sky-blue when they are moving tape rather than pages, because a colour is the only
warning that a familiar button is doing something else.

⚠️ **Parked at the end, Play means play from the start.** It used to do nothing, which is
defensible — there is nothing after the head — and reads as a broken button, hardest right
after a take, which leaves the head at the end: you finish, press play to hear it, nothing
happens. On screen the counter at least shows you why; on a controller there is no counter.

⚠️ A seek rather than the deck's Rewind, which means "wind back to the start" and animates
itself to zero. Playback stops first: a deck you can scrub while it plays is one whose
counter and audio disagree.

**The reels turn and the deck spools audibly while you scrub.** ⚠️ The reel rate is
*measured* rather than declared — it used to be read off the transport state, which meant
the reels sat still through a scrub, because a scrub is a seek and leaves the state at
"stop". Every way of moving tape moves the position, so taking the rate from how far it
actually went covers all of them, including the next one.

⚠️ The spooling noise goes **past the mixer, straight to the output, and is therefore never
on the tape**. It is the sound of the *machine*, not of the reel: a real deck's winding is
acoustic — in the room, not in the monitor mix and not on the take. The bus records from its
own end, so routing this through a strip or the master would bake it into the very recording
you were winding through.

⚠️ **Every number in it was fitted to two reference recordings, not chosen.** Reasoning about
what a tape rewind "is" produced two wrong answers in a row — first filtered noise that got
brighter with speed, then a pitched motor whirr on the grounds that a motor has a note. Both
were plausible and neither matched. Measuring the references settled it in one pass:

| | reference | synth |
| --- | --- | --- |
| spectral centroid | 5.3 / 6.6 kHz | 6.1 kHz |
| median frequency | 4.3 / 5.4 kHz | 5.5 kHz |
| 90th percentile | 11.4 / 13.9 kHz | 11.2 kHz |
| energy above 5 kHz | 51 / 55 % | 55 % |
| modulation rate | 4–9 Hz | 6.3 and 8.3 Hz |
| modulation depth | 0.36–0.88 | 0.49 |
| tonality (autocorrelation) | **0.20 / 0.09** | noise |

That last row is the one that mattered: these are **barely pitched at all**. The motor whirr
was audible reasoning rather than an audible machine. What is actually there is bright noise
wobbling slowly and deeply, with a little rumble underneath — the references put only 1–4% of
their energy below 200 Hz. Two LFOs at rates that do not divide into each other, because one
is a tremolo and a machine is never that regular. ⚠️ The lowpass is not optional: white noise
through a highpass keeps rising to Nyquist, and without it the fit measured 10 kHz against
their 5–7.

Plus a thunk when it stops, because every tape machine ends a wind with one and its absence
is what makes a stopped transport feel unfinished.

**`>`, the button above Func, is return to zero** — instant, and it stops the deck first.
The deck's own Rewind spools back at fourteen times and is a picture of a machine doing
something; this is the button you press to get to the top of a take and play it again, and
waiting through the animation to do that is the whole reason real decks have both.

⚠️ **The desk owns no audio and neither does this.** Every value is read and written through
the knobs and faders already on screen, so a move from the encoders is the same move a hand
would have made — persisted, painted, and recalled by a scene exactly as if you had dragged
it.

What the sixteen pads mean follows the panel you clicked:

- **CS·1** — the chord slots, filled bottom-up so pad 1 is bottom-left, exactly as they are
  laid out on screen. A held pad pulses; the slot the transport is playing is lit. Its pattern
  is a progression rather than a line of notes, so these are the one set of pads here that are
  not steps.

  ⚠️ **Unless you tap Func**, which turns the panel to its other face. CS·1 has two
  instruments in it — the chord voice and the root bass — and the bass is a step sequencer
  that was the only one in the rack with no way to program it from the pads. Sixteen pads
  cannot be chord slots and bass steps at once, so Func says which: tapped rather than held,
  because programming a pattern with a modifier down is not something a hand can do for
  sixteen presses. Held, Func is the modifier it has always been everywhere else. The panel
  starts on Chords and a tap always brings it back.

  The encoders follow the face. On Chords they page **Voice** (the seven faders, and the
  twelve-way sound selector on the eighth, which was empty) and **Prog** (key, how many
  chords, major/minor, mood, hold/strum/arp/pulse, arp rate, pulse, swing). On Bass they are
  the bass's own: on/off, how many steps, decay, level.
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

  ⚠️ **PM·1's live recorder was never connected.** It registered a `write()` handler with
  `shell/record.js` the way every panel does, and nothing ever called `record.note()` for it —
  DR·1, BS·1 and VC·1 all do from their own note-on, PM·1 did not. So its arm toggle armed a
  recorder with nothing feeding it: you could play a part over a running pattern for as long
  as you liked and nothing was written. And when it was fed, two things it *said* it did it
  did not — it took the step about to sound rather than the nearest one, so a note struck a
  hair late landed a whole step early; and it wrote the single note that arrived rather than
  the held chord, which is the one way of writing a step on that panel that dropped the chord.

  **Holding one pad and pressing another ties everything between them** into one held note —
  which is how you write a note longer than a step without leaving the controller. Holding,
  rather than two presses in a row: sequential presses cannot be told apart from two ordinary
  edits, so every second press would silently become a tie. It **sets** the run rather than
  growing it, so the same gesture shortens a note as well as lengthens it.

  ⚠️ **And the note survives it.** The anchor pad's own press has already run by the time the
  second pad arrives, so the note you reached out to lengthen had been switched off and got
  rebuilt from the last pitch you played — changing a note's *length* destroyed the note,
  which is the one thing the gesture is for. The pads remember what the last press emptied,
  so the anchor comes back exactly: the chord, the accent and the parameter locks with it.

  **Holding a pad and pressing the pair beside the encoders walks that note's length**, a
  step at a time, with the new length on the screen. The range gesture writes a length in one
  go and this adjusts one — which is what you are doing once it is nearly right. It stops at
  one step rather than deleting: pressing the pad is already how you delete, and a pair of
  arrows that quietly turns destructive at the end of its travel is one you stop trusting.

  Which is also an **undo for a mis-press**. Pressing a lit step clears it, and pressing the
  same pad again puts it back — unless you have played something in between, because the last
  note played is what a step switched on becomes and putting the old one back would ignore
  what you just said. A press takes the whole run, head and ties together: a tie extends the
  step in front of it and nothing else, so a tie whose note is gone lights a pad and sounds
  nothing.

  This is the panel's own gesture, not a second one: the pads and the on-screen grid run the
  same `press()`, so a lane or a modifier added to one is in the other by construction.

- **LP·1** — the sixteen loop **takes**, take 1 on the **top-left** pad, read down like the
  launcher. ⚠️ These are a *bank*, not the scene rows. They used to be the same list — slot n
  was row n — which meant a loop you wanted in three places had to be recorded three times as
  three copies of the same audio, and thirty-two rows against sixteen takes would have left
  half the launcher unable to hold a loop at all. A pad with a
  take plays it, an empty one records into it, and a recording slot is red so you can see it
  from across the room. `>` is the loop's Play/Stop.

  ⚠️ **A queued take flashes green and goes solid when it lands.** A take fires at the next
  loop line, which at four bars is up to eight beats away — press a pad, get nothing at all for
  that long, and the only reading available is that the pad does not work. Same colour, because
  it is the same take: the flashing *is* the wait. The take strip on screen pulses the same way
  in the same teal, and deliberately not in the yellow an *arming* take pulses — arming is
  "about to be recorded", queued is "about to play", and the two wait alike and mean opposite
  things.

  ⚠️ **The pad you are already playing is not a request to play it.** Pressing the live take
  used to queue a switch to the take it was already on — the one press on this grid that could
  do nothing at all — so it means the other thing you would want from a running loop: start
  layering. Press again to come back out; Record still toggles the same latch.

  **Double-tapping a different take means "and keep layering when it gets here."** Which has to
  be an intention held until the seam rather than a switch thrown now: overdub belongs to the
  looper and not to a take, so setting it at the press would put the take that is *still
  playing* into overdub for the rest of its bar. The first tap of the double still queues, so
  nothing waits on a timer to find out whether a second one is coming.

  Flashing green is *coming*; flashing **red** is *coming, and will layer* — the colour this
  panel already uses for recording, because arriving in overdub is recording, and a double tap
  that looked identical to a single one would be a gesture you could only confirm by waiting to
  hear it.

  **Func + a pad empties that slot**, and there is no undo — a take is audio and clearing one
  frees the buffer, which is exactly why the only destructive gesture on these pads is the one
  that needs a second hand. An empty slot is left alone rather than armed: a modifier that fell
  through to "record" on a miss would turn a fumbled delete into a live take.

  ⚠️ **Record is the overdub switch here**, not an arm. Everywhere else Record arms a track so
  that playing writes to its grid; a looper has no grid to write to, and the thing you reach
  for mid-loop is whether this pass layers. The light follows the latch.

  Which is a different question from **After**, the encoder beside Bars: what a take you have
  not recorded yet does when it reaches its end — play back once, or roll straight into
  overdub. The latch is the live switch; this is the standing answer each new take starts from,
  so a looper used for layering does not need the same press before every take and one used for
  one-shot phrases never dubs by accident.

  **Input is the eighth encoder**, hard against the arrows, because the arrows are what it puts
  within reach. It offers the studio output, each instrument on its own, and **one** microphone
  — the default one. ⚠️ Not the panel's own list: that carries every mic the browser will name,
  six on a laptop with a headset and a webcam plugged in, and turning past all of them to reach
  "Studio output" is not a knob but a penance. Choosing between microphones is a setup decision
  and belongs on the page, where you can read them.

  ⚠️ **Pick an instrument and Func + `>` hops between the two panels**, from either end —
  LP·1 knows what it is recording, but the panel you jumped *to* has no idea it is half of
  anything, so the link is declared once by the end that knows and read in both directions.
  Either order: hold one, press the other. Landing on DR·1 brings up the hardware's **Drum**
  layout, since the point of hopping to the kit is to hit drums; landing anywhere else restores
  the DAW layout. With the input set to the studio bus or a microphone there is nowhere to hop
  to, and the gesture does nothing.

  ⚠️ This was the pair beside the encoders first, and then Shift + Func, and both were wrong.
  The arrows answered *last*, after banks and after the panel's own bump — which kept DR·1's
  lanes and PM·1's pages intact, and made the hop something you reached by paging to the end of
  a list first; a toggle you have to walk to is not a toggle. Shift read as unreliable on the
  hardware, which is what the profile's own note about Shift predicts: this device does its own
  combining, and a host building a two-key gesture on Shift is competing with it for the same
  press. Func and `>` are two keys this profile owns outright, side by side under one thumb.

  Neither loses what it does alone: `>` still fires the panel's action on its release, Func
  still turns CS·1 to its other face, and the combination does neither — whichever of the two
  arrives second is the one that fires, and it spends the other's tap on the way past.

  ⚠️ LP·1 takes no notes, so it never registered with the MIDI router — which was the only
  door the surface knew, so focusing it left the encoders blank. Claiming a MIDI channel just
  to be findable would be a lie about what the panel does, so `surface.panel()` is the other
  door: same adapters, no channel.

- **TS·1** — its four faders, with the six rows of buttons on the modifier. This panel is
  mostly *lists*, so the split lands in a different place than elsewhere and for the same
  reason: what you turn while it runs, then what you set before you arm it. `>` is Arm, because
  there is exactly one thing this instrument does.

- **The scene launcher** — thirty-two rows, sixteen pads at a time, amber for a stored row, pulsing for
  one that is armed, green for one that is sounding. It is the fallthrough for any panel with
  no grid of its own, and **Shift + Sends** aims at it deliberately: the Live view *is* the
  launcher, and pads that followed whichever panel was last clicked meant looking at a grid you
  could not press. There the encoders are the head's own — where a fired row lands, and the
  pattern length — and the pair beside them nudges the tempo.

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

⚠️ **Hold Func — or Shift — and the encoders become a second eight**, where a panel offers
one. Either key opens it, which is not indecision: they are two keys asking the same question,
and accepting both costs a boolean and removes the only way this can be dead on arrival.
⚠️ **A list under an encoder moves by detent, not by position.** These encoders are endless
but report an absolute 0–127, so a control with *N* positions used to need 127/*N* detents per
step: sixty-four to flip a two-way segment, twenty-one for a four-way select. LP·1's Bars,
Monitor and Metronome were all reported as simply not working, and they were — you would have
had to spin them most of a full sweep to see anything move. Key and Scale, with two dozen
options each, felt fine, which is why this hid behind an earlier fix that only stopped the
knob *fighting* the value.

So the travel is read as a direction and the knob is parked mid-range afterwards. Parking is
not tidiness: the device's own counter saturates at 0 and 127, and an encoder sitting at either
end stops reporting change in that direction — the control would work until it had been turned
far enough one way, and then be stuck for good.

Shift is *reported* by the device, so the display follows it — but this controller remaps
rather than passes a modifier, and whether an encoder turned under Shift still sends its own
CC is a fact about firmware rather than about the guide. Func is the profile's own modifier,
is known to arrive, and means nothing else while a knob is moving.

What that second eight is depends on the panel — in every case, the pattern's own settings
rather than its sound:

| | second eight |
| --- | --- |
| **CS·1** | `Key Mod Len M/m Arp Pls Swg Bas` — key, mood, chord count, major/minor, arp rate, pulse, swing, bass |
| **PM·1, BS·1, VC·1** | `Stp Rat Key Scl` — steps, rate, key, scale |
| **DR·1** | `Stp Rat` — a drum pattern has no key and no scale |

**BS·1 also uses the two spare buttons.** It has one encoder bank and no tape, so the pair
beside the encoders and the `>` beside the pads are both free:

| | |
| --- | --- |
| **∧ ∨** | the instrument's octave |
| **Func + ∧ ∨** | the sub oscillator's octave |
| **`>`** | flips saw to square |

⚠️ Func on these two is a **second pair, not the second eight**. Holding it while *turning* a
knob swaps what the eight are; holding it while *pressing* this pair swaps what the pair does.
Different gestures on different controls, and neither is in the other's way.

Everything here flashes what it did on the screen — `Octave 0`, `Sub -2 oct`, `Wave Square` —
because a button whose effect you cannot see is one you press twice, which on a toggle puts it
back where it started.

⚠️ The sub octave is **new**. BS·1's square sub was hard-wired one octave below in three
places; it is now a parameter with its own switch on the panel, saved with the patch, and it
retunes under a held pedal like everything else there. One octave down stays the default —
two is the one you reach for when the line is already low and you want weight rather than
another note.

⚠️ CS·1's Mood and Mode are one letter apart on the panel and would be one letter apart in a
three-character legend, so Mode is spelled `M/m`: it is the major-or-minor switch, and saying
so beats a name you have to squint at. ⚠️ Those are *lists, not ranges*, which is why they were never among the ordinary
eight: Cutoff has a value anywhere between two ends, while Rate is one of seven names and a
knob landing between two of them means nothing. The encoder picks an **index** — its travel
divided by however many options there are — and goes through the panel's own menu, so the
sequencer rebuilds its grid and re-spells its notes exactly as if you had used it.

⚠️ **A list gets its knob position once and is then left alone.** Continuous controls are
sent their position constantly, which is what stops a knob jumping when the focus moves to a
panel whose Cutoff sits somewhere else. Do that to a seven-item list and the knob cannot
move: it travels a little, rounds to the option it started on, and gets pushed straight back
there. Steps and Rate were almost immovable and Key and Scale seemed fine, which is exactly
what two dozen options versus seven predicts.

⚠️ **And the display shows the words, not the number.** The device writes the value itself
for an ordinary knob, which is right for Cutoff and useless for Scale — `84` says nothing
about Phrygian. A control that can say what it is in words gets a different display
arrangement and we fill the value in: `1/32`, `F2`, `Dorian`.

The legend retitles itself to `BS-1  Seq` while you hold it, because the eight names under it
have just been replaced and a legend that did not say so would look like the bank had changed
by itself. ⚠️ It names **what the second eight are, not which key reached them** — "Shift"
was a guess about the hardware written into the part of the app furthest from it, and the
wrong guess at that. A panel with no second eight keeps its ordinary controls and its ordinary
title, so holding Shift never makes a familiar encoder do nothing.

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

### The punch page

**Tap Func on the Live page** and the controller opens the punch page: the sixteen pads become
the punch rack, in the order the rack is drawn — LP, HP, Iso, Stutter, Loop, Reverse, Repitch
and Gate across the top; Pump, Delay, Space, Flange, Ring, Drive, Crush and Stop along the
bottom. Tap Func again to go back. Each pad wears its family's colour and brightens while its
effect is in, and the rack on screen is ringed while the page is up.

| | |
| --- | --- |
| **Hold a pad** | the effect is in until you let go |
| **Func + a pad** | latch it — it stays in, and its pad pulses so it can be found again |
| **Press a pad that is already in** | it comes out when you let go |
| **Encoders** | the numbers of the row you last touched; ∧ ∨ right of the encoders swap rows |
| **`>`** | takes every effect out |
| **∧ ∨ left of the pads** | nothing |

⚠️ **Nothing else answers while it is up.** It was first the launcher's other face and kept the
launcher's buttons: `>` still launched the row under the cursor, the arrows still walked it, and
anything that moved the focus took the pads with it. A page outranks the focus, so the pads,
encoders, `>` and arrows are the rack's alone; the keys still play, and Play and Stop still run
the rack. A pad's release always reaches the page that had its press, so leaving with a finger
down cannot strand an effect in.

⚠️ **One tab.** Web MIDI hands a controller's input to every tab listening to it, so two copies
of the page open at once both answer the same pad — one punching, one launching.

### The screen

The Launchkey MK4's screen takes 128 × 64 bitmaps as well as text, and the app uses both.

- **Moving somewhere** — another panel, a page, the punch page — shows a card for about a
  second: the name, a word for what it is, a small picture, and a bar counting down to the
  controls coming back. It arrives whole, and on the screen's temporary display, where the
  Launchkey shows the name of a button you press — so the two do not show one after the other.
- **On the Tape page, while the tape moves** — playing, recording, rewinding, or scrubbed with the
  arrows beside the pads — the screen is the deck: two reels that fill and empty by area and turn
  at the tape's speed over their own radius, the counter, and a play, rewind or fast-forward
  mark. **Recording** blinks a dot and a REC badge. Stop, and the controls come back.

⚠️ **About eleven frames a second is all there is.** The device answers each bitmap once it has
drawn it — 84–88 ms later on a Mini MK4 25 — and the next frame waits for that answer, so every
picture is drawn from the clock rather than counted in frames. The answer is
`f0 00 20 29 02 13 09 f7`; the guide ends both it and the bitmap message in `7F`, where they end
in `F7`.

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
- **Custom 1 is encoder layout 6.** The guide barely documents the Custom modes, so this was
  a guess until the device was asked directly: it falls back to layout 6 on leaving DAW mode,
  where only a Custom layout is possible, and it keeps layouts 1, 2 and 4-10 and no others.

`tools/probe-launchkey.py` asks that kind of question over CoreMIDI with no browser in the
way — useful because the desktop app's preview pane is never granted Web MIDI. It reads
every setting before it writes one and puts them all back; see its docstring, and disconnect
the controller in Settings first if a page is holding it.

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
