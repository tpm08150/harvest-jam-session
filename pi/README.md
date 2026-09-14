# Jam Session on a Raspberry Pi

Burn the image to an SD card, put it in a Raspberry Pi, plug in a Launchkey and power it on: the
Launchkey becomes a groovebox. No screen, keyboard or mouse needed — plug in an HDMI screen whenever
you want to see the whole rack.

> ⚠️ **Built, not yet run on a Pi.** GitHub Actions builds the image and checks it: inside the
> finished image it starts the rack headless and confirms MIDI and SysEx are granted, kiosk mode is
> on and the sign-in gate is out of the way. That first passed on 2026-09-13. Nobody has yet burned a
> card, booted a Pi 4 with it or played a Launchkey through it.

## Get the image

1. On GitHub, open **Actions → Pi image**, pick the latest green run, and download the
   `jam-session-pi-…` artifact (GitHub asks you to be signed in). It arrives as a `.zip`: open it
   to get the `.img.xz` and its `.sha256`. A `pi-v…` release, when there is one, has the same files
   without the zip or the sign-in.
2. Open **Raspberry Pi Imager** → *Choose OS* → *Use custom* → the `.img.xz`. No need to unpack it.
3. *Optional:* if Imager offers OS customisation, set a username and password and turn on SSH
   (and Wi-Fi). That is how you get in later to read logs. The groovebox needs none of it.
4. Write the card.

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
- `EXTRA_CHROMIUM_FLAGS` — for example `--force-device-scale-factor=0.8` to fit more on screen.

The HDMI picture is `video=HDMI-A-1:1280x720@60D` in `cmdline.txt`, beside it: change `1280x720`
to `1920x1080` for a big screen.

## Getting in

With SSH turned on in Imager:

```bash
ssh you@jam-session.local
journalctl -fu jam-kiosk          # the browser: permissions granted, page loaded, restarts
journalctl -fu jam-server         # the page server
wpctl status                      # the audio outputs, and which one is the default
sudo systemctl restart jam-kiosk
```

**The Pi's browser in your own Chrome's DevTools:**

```bash
ssh -L 9222:127.0.0.1:9222 you@jam-session.local
```

then open `chrome://inspect` on the laptop, *Configure…* → add `localhost:9222`, and inspect the
rack. `Patchwork.kiosk.log` is what connected and when; `Patchwork.surface.traffic` is what the
Launchkey sent.

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
is 256 frames at 48 kHz, in `/etc/pipewire/pipewire.conf.d/10-jam-latency.conf`: raise it to 512
the moment you hear crackle.

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

- **Running it on a Pi.** Everything past the smoke test is untested on hardware: cage on the Pi's
  GPU, forced HDMI, the Launchkey's port names under Linux, PipeWire's choices, latency.
- **Read-only root.** An overlay filesystem, with a writable partition for the Chromium profile
  (where songs and patches live), so pulling the plug cannot damage the system.
- **Updates** without burning a new card.
- **Pi 5.** The same image should boot; it has no headphone jack, so it needs USB audio or HDMI.
- **Per-instrument output devices**, and the multi-channel routing on real hardware — see the main
  README's *On a Raspberry Pi*.
