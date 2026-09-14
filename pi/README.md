# Jam Session on a Raspberry Pi

Burn the image to an SD card, put it in a Raspberry Pi, plug in a Launchkey and power it on: the
Launchkey becomes a groovebox. No screen, keyboard or mouse needed — plug in an HDMI screen whenever
you want to see the whole rack.

> ⚠️ **On a Pi 4, 2026-09-13.** The first image booted, HDMI showed the rack and sound came out of a
> USB audio interface, but the rack was too slow to play and the Launchkey was not recognised. The
> second image's report found a 1 GB board, a 4K television being driven at 3840x2160, and no Launchkey
> on the USB bus at all — a bad cable. Images from here set the screen's mode (`SCREEN`) and report the
> audio thread's load (HANDOFF.md, "The second Pi"). Every image is still checked headless, inside the
> image, by GitHub Actions before it is uploaded.

## Get the image

1. On GitHub, open **Actions → Pi image**, pick the latest green run, and download the
   `jam-session-pi-…` artifact (GitHub asks you to be signed in). It arrives as a `.zip`: open it
   to get the `.img.xz` and its `.sha256`. A `pi-v…` release, when there is one, has the same files
   without the zip or the sign-in.
2. Open **Raspberry Pi Imager** → *Choose OS* → *Use custom* → the `.img.xz`. No need to unpack it.
3. Write the card. ⚠️ Imager offers no customisation — user, Wi-Fi, SSH — for a custom image (found on
   the first Pi), and the groovebox needs none of it. *Getting in* says how to see what it is doing.

## Play

- **Launchkey:** any USB port on the Pi. It lights up once the rack is running.
- **Sound:** a USB audio interface if one is plugged in, otherwise the Pi 4's 3.5 mm headphone
  jack (noisy, but it needs nothing else). To pick another output from the Launchkey: Shift +
  Custom 1 opens Settings, and its first knob is the output device.
- **Screen:** plug HDMI into the port next to the power socket, before or after powering on.

⚠️ **This copy is offline.** No sign-in and no cloud sync: songs, patterns and patches are saved on
the SD card. The website is unchanged.

⚠️ **Pulling the plug is how it is turned off**, and an SD card can be damaged if that happens while
it is writing. There is no read-only mode yet — see *Not done yet*.

## Settings

`jam-session.txt`, on the card's boot partition (the drive called `bootfs` on a Mac or PC):

- `APP_PAGE` — boot into one instrument instead of the whole rack.
- `SCREEN` — the mode a screen on HDMI runs at: `1920x1080` unless changed, `1280x720` for less drawing,
  `native` for whatever the screen asks for. A screen without the mode gets the largest one inside it.
  ⚠️ A 4K screen's own mode is four times the drawing of 1080p, which a Pi 4 cannot keep up with.
- `EXTRA_CHROMIUM_FLAGS` — for example `--force-device-scale-factor=0.8` to fit more on screen.

`video=HDMI-A-1:1920x1080@60D` in `cmdline.txt`, beside it, keeps HDMI switched on with nothing plugged
in, so a screen can be added later. It does not choose a connected screen's mode: cage runs a screen at
its own preferred one unless `SCREEN` says otherwise.

## Getting in

**No network needed:** the Pi writes `jam-diagnose.txt` to the card's boot partition three minutes
after power on, and every five minutes after that — the MIDI ports it can see and what the kiosk made
of them, the kernel's USB messages, CPU and memory per process, temperature and throttling, the GPU and
the mode the screen really runs at, PipeWire's buffer and dropouts, what was playing, how busy the
page's main thread is, and how much of the audio thread's time the rack needs (`renderCapacity`: at 1.0
the sound breaks up). Power off, put the card in a Mac or PC, and open it from the `bootfs` drive.
⚠️ Leave the Pi on for three minutes first, or the card still holds the report from the boot before. A report is written in a second or two; pulling the plug in the middle of one costs only that
report.

**A keyboard on the Pi:** Ctrl+Shift+I may open Chromium's DevTools over the rack.
`Patchwork.kiosk.log` is what connected and when; `Patchwork.midi.ports("inputs")` is what the page
can see.

**SSH**, on a Pi provisioned with `pi/setup.sh` — the image itself has no login:

```bash
ssh you@your-pi.local python3 - < pi/jam-diagnose        # the same report, from your computer
ssh -L 9222:127.0.0.1:9222 you@your-pi.local              # then chrome://inspect, add localhost:9222
journalctl -fu jam-kiosk                                   # on the Pi: permissions, page loads, restarts
```

## How it works

`jam-server` serves the built pages on `127.0.0.1:8123`: Web MIDI needs a secure context, and
`http://localhost` is one. `jam-kiosk` opens a login session on tty7 for the locked user `jam` and
runs `cage`, a one-window Wayland compositor, which runs `jam-browser`. That starts Chromium, grants
the rack its permissions, loads `index.html?kiosk`, and restarts the browser if the page stops
answering. In the page, `src/shell/kiosk.js` does the rest: asks for SysEx, brings the audio up,
and connects the one Launchkey it finds.

The things that had to be solved, because every default in the app assumes a person:

**MIDI is a permission, and no policy grants it.** Checked against all 1,424 policy definitions in
Chromium's source on 2026-09-13: there is none for MIDI or SysEx. The two names the first version of
this directory wrote into a managed policy do not exist, and Chromium ignores a policy it does not
know without a word — that Pi would have waited forever on a prompt. `jam-browser` grants MIDI,
SysEx and the microphone with DevTools' `Browser.setPermission` before the page asks, which is the
permission the click would have given. (Not `grantPermissions` one permission at a time: each of
those calls revokes whatever the one before it granted.)

**Nobody signs in.** The site's sign-in gate stands down when cloud sync is not configured, so
`provision.sh` turns the one line `src/shell/cloud.js` keeps for it — `const OFFLINE = false;` — to
`true` in the copy it installs, and fails unless `index.html` has exactly one.

**No screen is still a screen.** Whether cage and Chromium cope with no display at all has not been
tried, so the first HDMI port is forced on (`video=…D`) whether or not anything is plugged in: cage
always has a display for the rack, and a screen plugged in later just shows it. Chromium also runs
with the flags that stop it throttling a page it thinks nobody can see. The sequencers' clock is
safe on its AudioWorklet regardless, but the Launchkey's LEDs and screen repaint on timers.

**Sound picks its way out.** PipeWire, with WirePlumber told to prefer a USB interface, then the
headphone jack, then HDMI; without that, the always-on HDMI port could take the sound. The buffer
is 1024 frames at 48 kHz, in `/etc/pipewire/pipewire.conf.d/10-jam-latency.conf` — the first image's
256 went with a rack that could barely play, though how much of that was the buffer is not yet known.
Chromium may give its audio thread realtime priority (`LimitRTPRIO` on `jam-kiosk`), the CPU stays at
full speed (`jam-performance`), and the ALSA sequencer Web MIDI runs on is loaded at boot rather than
whenever a MIDI device happens to arrive.

**The first-boot wizard is masked** in the image. It asks for a username on a console nobody is
looking at.

## Building the image

GitHub Actions builds it (`.github/workflows/pi-image.yml`) on an arm64 runner, so the image's own
programs run natively in a chroot. Start it with *Run workflow* in the Actions tab, a push to the
`pi-image` branch, or a `pi-v*` tag, which also makes a release.

On any arm64 Linux machine:

```bash
sudo apt-get install parted e2fsprogs xz-utils zerofree curl
sudo pi/image/build.sh out
```

It downloads Raspberry Pi OS Lite (64-bit, Trixie) and checks it against its published checksum,
adds 1.8 GB, runs `pi/provision.sh --image` inside it, runs `jam-browser --smoke` inside it, and
writes `out/jam-session-pi-DATE-REV.img.xz`.

**A Pi you already have:** `sudo pi/setup.sh` runs the same `provision.sh` on it (it needs a network
connection), then reboot.

## Not done yet

- **Playing it on a Pi.** The Pi 4 boots it and makes sound, and the Launchkey trouble was a cable. The
  speed to play the whole rack on the 1 GB board it was tried on is the open question.
- **Read-only root.** An overlay filesystem, with a writable partition for the Chromium profile
  (where songs and patches live), so pulling the plug cannot damage the system.
- **Updates** without burning a new card.
- **Pi 5.** The same image should boot; it has no headphone jack, so it needs USB audio or HDMI.
- **Per-instrument output devices**, and the multi-channel routing on real hardware — see the main
  README's *On a Raspberry Pi*.
