# Jam Session on a Raspberry Pi

Plug a Launchkey into a Pi, power it on, and play. No desktop, no mouse, no monitor
needed once it works.

> ⚠️ **None of this has been run on a Pi.** The app-side half — kiosk mode, the output
> picker — is tested in a browser. Everything in this directory was written from
> documentation and is scaffolding until you flash a card and find out. Read `setup.sh`
> before running it.

## What it does

`jam-server` serves the built HTML on `http://localhost:8123`. `jam-kiosk` waits for that
port and starts Chromium fullscreen at `index.html?kiosk` inside `cage`, a one-window
Wayland compositor. Both start at boot.

## Try it

On Raspberry Pi OS Lite (64-bit, Bookworm):

```bash
git clone https://github.com/tpm08150/harvest-jam-session
cd harvest-jam-session
nano pi/jam-session.conf     # AUDIO_OUT, buffer size
sudo pi/setup.sh
```

## The four things that had to be solved

Everything below is a consequence of one fact: **every default in this app assumes there
is a person in front of it.**

**The clock does not stall.** This one was already solved, for a different reason. A
`setInterval` in a tab you cannot see is throttled to about 1.3 Hz — measured — which
would stop every sequencer on a headless box. `src/shell/clock.js` drives the tick from an
AudioWorklet instead, because a client sitting in a shared jam with nothing sounding had
exactly the same problem. Nothing here had to change.

**MIDI and SysEx are permissions, not flags.** No command-line switch grants them; a
dialogue asks, and there is nobody to click it. `setup.sh` writes a Chromium *managed
policy* under `/etc/chromium/policies/managed/`, which is how an operator answers for a
machine they own. Without it the pads work and the controller's screen stays dark.

**The page is served, not opened.** Web MIDI requires a secure context. `file://` is not
one and `http://localhost` is, which is the entire reason `jam-server` exists for a pile
of static files.

**Nothing connects itself.** The surface waits to be picked from a list, SysEx waits for a
click, and the audio context waits for a gesture. `?kiosk` (see `src/shell/kiosk.js`) turns
those into: ask for SysEx up front, bring the audio context up, and connect the one
detected controller — *one*, never a guess between two. It retries every two seconds,
because a Pi cold-starts the browser, the audio device and the USB controller at once with
no agreed order, and the controller may be plugged in long after boot.

## Audio

`AUDIO_OUT=headphone` is the Pi 4's 3.5 mm jack — nothing to buy, PWM-driven, noisy, and
fine for proving the thing works. **The Pi 5 has no analogue jack**; set `AUDIO_OUT=usb`
there or you get silence.

`ALSA_PERIOD` is the latency dial and the number worth measuring. 256 frames at 48 kHz is
~5.3 ms a period; three of them is ~16 ms of buffer, and Chromium adds its own on top.
Realistically expect 20–40 ms round trip. Drop to 128 if the Pi keeps up; raise to 512 the
moment you hear crackle, because a synth that stutters is worse than one that is late.

**The output device is also selectable from the Launchkey** — the mixer page's last encoder
bank is the output, so a box with no screen can still be told where to send its sound.
`AUDIO_OUT` only decides what it comes up on.

### A multi-out interface

⚠️ **Which device and which channels are different questions.** The device belongs to the
whole `AudioContext` — that is where `setSinkId` lives, and every strip shares one context so
the master, the sends and the tape all see the same signal — so it is global and it overrides
everything. Which *channels of that device* an instrument lands on costs a merger and a
splitter, so that one is per instrument, on the Audio panel beside MIDI.

Plug in an eight-out interface, put the drums on 3-4 and the bass on 5-6, and take separate
feeds to a desk. A pair takes the instrument **off** the main mix — audible on 1-2 as well as
on 3-4 is not routed anywhere, it is doubled. The tape and the looper are unaffected: they
tap strips directly rather than the master sum.

Direct outs follow the master fader, which a hardware desk would not do. On a box whose only
volume control is that fader, an instrument that ignored it would be a surprise.

**LP·1 and VC·1 also get an audio input row** — the looper's source and the vocoder's
modulator — because those are the two panels that take sound in, and on a Pi the answer is
"whatever is plugged into the interface" rather than anything you can pick from a laptop.

## Getting back in

```bash
journalctl -fu jam-kiosk        # what the browser is doing
journalctl -fu jam-server       # what the page server is doing
aplay -l                        # which cards ALSA can see
speaker-test -c2 -twav          # is anything coming out at all
sudo systemctl stop jam-kiosk   # give the screen back
```

Over SSH, with the browser still running, `Patchwork.kiosk.log` in its console is the
record of what auto-connected and when. `Patchwork.kiosk.off()` stops it coming back up in
kiosk after a reload.

## Not done yet

- **A flashable `.img`.** This is a script you run on Raspberry Pi OS Lite. Baking an image
  with `pi-gen` is the next step and a bigger one.
- **Per-instrument *devices*.** Channels are done (above); devices are not, and are not
  cheap: `setSinkId` belongs to the `AudioContext`, so sending two instruments to two
  different interfaces needs a `MediaStreamDestination` per strip and buys the choice at the
  price of latency. One interface with many channels is the better answer anyway.
- **Verifying any of the multi-channel routing on real hardware.** It is written and it has
  never met an interface with more than two outputs.
- **Read-only root.** An SD card that loses power mid-write is an SD card you re-flash. An
  overlay filesystem with a writable partition for the Chromium profile (which is where
  projects and patches live) is the fix.
- **Measuring the latency** rather than estimating it.
