#!/usr/bin/env bash
# Turn a fresh Raspberry Pi OS Lite (64-bit, Bookworm) into a Jam Session box.
#
# ⚠️ NOT TESTED ON HARDWARE. Every line here was written from the documentation and none
# of it has been run on a Pi. Read it before you run it; it installs packages, writes a
# Chromium policy and enables two services that start at boot.
#
#   sudo ./setup.sh
#
# Undo:  sudo systemctl disable --now jam-kiosk jam-server
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"

[[ $EUID -eq 0 ]] || { echo "run me with sudo" >&2; exit 1; }

# The user the browser runs as. Not root: Chromium refuses, and it should.
RUN_USER="${SUDO_USER:-pi}"
id "$RUN_USER" >/dev/null 2>&1 || { echo "no such user: $RUN_USER" >&2; exit 1; }

source "$HERE/jam-session.conf"
install -m 644 "$HERE/jam-session.conf" /etc/jam-session.conf

echo "==> packages"
apt-get update
# cage is a kiosk compositor: one window, fullscreen, no desktop, no window manager.
# Lighter than a full desktop and it is the whole of what "boots into the app" needs.
apt-get install -y --no-install-recommends \
  chromium-browser cage seatd python3 alsa-utils

echo "==> app -> $APP_DIR"
install -d -o "$RUN_USER" -g "$RUN_USER" "$APP_DIR"
# The built pages and the server. Nothing else is needed at runtime — no node, no build.
for f in *.html serve.py netlify.toml; do
  [[ -e "$REPO/$f" ]] && install -o "$RUN_USER" -g "$RUN_USER" -m 644 "$REPO/$f" "$APP_DIR/"
done
chmod 755 "$APP_DIR/serve.py"

echo "==> audio"
case "$AUDIO_OUT" in
  headphone)
    # ⚠️ Pi 4 only. The Pi 5 has no analogue jack; this is a no-op there and you will
    # get silence until you pick a device from the controller or set AUDIO_OUT=usb.
    if command -v raspi-config >/dev/null; then raspi-config nonint do_audio 1 || true; fi ;;
  hdmi)
    if command -v raspi-config >/dev/null; then raspi-config nonint do_audio 2 || true; fi ;;
  usb|auto) : ;;
  *) echo "unknown AUDIO_OUT: $AUDIO_OUT" >&2; exit 1 ;;
esac

# A period size ALSA will actually honour. dmix is what lets more than one thing open the
# card at once, which matters the moment Chromium and anything else want it together.
cat > /etc/asound.conf <<ASOUND
pcm.!default {
  type plug
  slave.pcm "dmixer"
}
pcm.dmixer {
  type dmix
  ipc_key 1024
  slave {
    pcm "hw:${AUDIO_CARD:-0},0"
    period_size $ALSA_PERIOD
    buffer_size $((ALSA_PERIOD * ALSA_PERIODS))
    rate $SAMPLE_RATE
  }
}
ctl.!default { type hw card ${AUDIO_CARD:-0} }
ASOUND

echo "==> chromium policy"
# ⚠️ THE PROMPTS ARE THE WHOLE PROBLEM ON A BOX WITH NO MOUSE. MIDI and SysEx are
# permissions, not flags — a command line switch will not grant them. This is a managed
# policy, which is how Chromium lets an operator answer for a machine they own.
# `1` = allow; the URL is the origin the kiosk actually loads.
install -d /etc/chromium/policies/managed
cat > /etc/chromium/policies/managed/jam-session.json <<POLICY
{
  "MidiSysexAskForUrls": [],
  "MidiSysexAllowedForUrls": ["http://localhost:$PORT"],
  "DefaultMidiSysexSetting": 1,
  "AutoplayAllowed": true,
  "AutoplayAllowlist": ["http://localhost:$PORT"],
  "AudioCaptureAllowed": true,
  "AudioCaptureAllowedUrls": ["http://localhost:$PORT"],
  "DefaultNotificationsSetting": 2,
  "PasswordManagerEnabled": false,
  "MetricsReportingEnabled": false,
  "BackgroundModeEnabled": false
}
POLICY

echo "==> services"
for unit in jam-server.service jam-kiosk.service; do
  sed -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@RUN_USER@|$RUN_USER|g" \
      "$HERE/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now jam-server.service
systemctl enable --now jam-kiosk.service

cat <<DONE

Done. The rack is at http://localhost:$PORT/$APP_PAGE and should be on screen now.

  journalctl -fu jam-kiosk     what the browser is doing
  journalctl -fu jam-server    what the page server is doing
  aplay -l                     which cards ALSA can see
  speaker-test -c2 -twav       is anything coming out at all

⚠️ Nothing here has been run on real hardware. If the screen stays black, the browser is
the first place to look and the audio device is the second.
DONE
