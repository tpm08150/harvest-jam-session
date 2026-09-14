#!/usr/bin/env bash
# Make Raspberry Pi OS Lite (64-bit, Trixie) a Jam Session groovebox.
#
# One script, two ways in, so the image and a hand-built Pi are the same machine:
#   pi/image/build.sh runs it inside the SD card image, in a chroot:   provision.sh --image
#   pi/setup.sh runs it on a Pi that is already running:              provision.sh
#
# ⚠️ WHAT IT CHANGES. Installs Chromium, cage, PipeWire and python3-websocket. Adds a locked user
# `jam` for the kiosk. Copies the built pages to /opt/jam-session and switches that copy's cloud
# sync off. Writes a Chromium policy, PipeWire and WirePlumber settings, a PAM file and two
# systemd units. Adds video=HDMI-A-1:... to cmdline.txt so HDMI is always on. With --image it
# also names the machine jam-session and masks the first-boot user wizard. pi/README.md says why
# for each.
set -Eeuo pipefail
trap 'echo "!! provision.sh stopped at line $LINENO: $BASH_COMMAND" >&2' ERR

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
MODE=live
[[ "${1:-}" == "--image" ]] && MODE=image
[[ $EUID -eq 0 ]] || { echo "run me as root" >&2; exit 1; }

JAM_USER=jam
APP_DIR=/opt/jam-session
BOOT=/boot/firmware
# shellcheck source=jam-session.conf
source "$HERE/jam-session.conf"

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
# cage: a one-window Wayland compositor — fullscreen, no desktop, nothing to click away. Mesa for
# the Pi's GPU. PipeWire so a USB interface plugged in later is a device the page can pick.
apt-get install -y --no-install-recommends \
  chromium \
  cage libgl1-mesa-dri libegl-mesa0 libpam-systemd dbus-user-session kbd \
  pipewire pipewire-pulse pipewire-alsa wireplumber rtkit alsa-utils \
  python3 python3-websocket \
  fonts-dejavu-core

echo "==> user: $JAM_USER"
if ! id "$JAM_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "Jam Session kiosk" "$JAM_USER"
fi
for group in audio video render input plugdev; do
  if getent group "$group" >/dev/null; then usermod -aG "$group" "$JAM_USER"; fi
done
# Nobody signs in as jam: the kiosk unit opens its session. SSH in as your own user.
passwd -l "$JAM_USER" >/dev/null
# ⚠️ LINGER, so jam's PipeWire runs from boot. Nobody will ever "log in" to start it.
if [[ $MODE == live ]]; then
  loginctl enable-linger "$JAM_USER"
else
  install -d -m 755 /var/lib/systemd/linger
  touch "/var/lib/systemd/linger/$JAM_USER"
fi

echo "==> the rack -> $APP_DIR"
install -d -m 755 "$APP_DIR"
shopt -s nullglob
pages=()
for f in "$REPO"/*.html; do
  [[ "$(basename "$f")" == _* ]] && continue       # harness pages are not the app
  pages+=("$f")
done
(( ${#pages[@]} )) || { echo "no built pages in $REPO — run python3 tools/build.py" >&2; exit 1; }
install -m 644 "${pages[@]}" "$REPO/serve.py" "$APP_DIR/"
install -m 755 "$HERE/jam-browser" "$APP_DIR/jam-browser"

# ⚠️ OFFLINE: the one line src/shell/cloud.js keeps for this. The site has cloud sync behind a
# Google sign-in; a box with no keyboard cannot sign in, so this copy has neither. It must turn
# exactly one line in index.html, or the Pi would boot into the gate.
python3 - "$APP_DIR" <<'PY'
import pathlib, sys
app = pathlib.Path(sys.argv[1])
off, on = "const OFFLINE = false;", "const OFFLINE = true;"
for page in sorted(app.glob("*.html")):
    text = page.read_text(encoding="utf-8")
    n = text.count(off)
    if n > 1:
        sys.exit("%s holds %d OFFLINE lines" % (page.name, n))
    if n:
        page.write_text(text.replace(off, on), encoding="utf-8")
        print("    offline:", page.name)
if (app / "index.html").read_text(encoding="utf-8").count(on) != 1:
    sys.exit("index.html was not switched offline")
PY

echo "==> settings"
install -m 644 "$HERE/jam-session.conf" /etc/jam-session.conf
if [[ -d $BOOT && ! -e $BOOT/jam-session.txt ]]; then
  install -m 644 "$HERE/jam-session.txt" "$BOOT/jam-session.txt"
fi

echo "==> chromium policy"
# Only policies that exist, each checked against Chromium's policy definitions on 2026-09-13.
# There is no MIDI one: jam-browser grants MIDI and SysEx over DevTools instead.
install -d -m 755 /etc/chromium/policies/managed
cat > /etc/chromium/policies/managed/jam-session.json <<POLICY
{
  "AutoplayAllowed": true,
  "AutoplayAllowlist": ["http://localhost:$PORT"],
  "AudioCaptureAllowed": true,
  "AudioCaptureAllowedUrls": ["http://localhost:$PORT"],
  "DefaultNotificationsSetting": 2,
  "PasswordManagerEnabled": false,
  "MetricsReportingEnabled": false,
  "BackgroundModeEnabled": false,
  "TranslateEnabled": false,
  "BrowserSignin": 0,
  "SyncDisabled": true,
  "PromotionsEnabled": false,
  "DefaultBrowserSettingEnabled": false,
  "ComponentUpdatesEnabled": false,
  "SpellcheckEnabled": false
}
POLICY

echo "==> audio"
install -d -m 755 /etc/pipewire/pipewire.conf.d /etc/wireplumber/wireplumber.conf.d
install -m 644 "$HERE/pipewire/10-jam-latency.conf" /etc/pipewire/pipewire.conf.d/
install -m 644 "$HERE/wireplumber/51-jam-outputs.conf" /etc/wireplumber/wireplumber.conf.d/

echo "==> services"
install -m 644 "$HERE/jam-kiosk.pam" /etc/pam.d/jam-kiosk
install -m 644 "$HERE/jam-server.service" "$HERE/jam-kiosk.service" /etc/systemd/system/
systemctl enable jam-server.service jam-kiosk.service
systemctl set-default multi-user.target

echo "==> screen"
# ⚠️ HDMI ALWAYS ON. Whether cage and Chromium cope with no display at all has not been tried, so
# the Pi's first HDMI port is switched on whether or not a screen is attached: cage always has a
# display to put the rack on, and a screen plugged in later simply shows it. 1280x720 is a mode
# every HDMI screen takes.
if [[ -f $BOOT/cmdline.txt ]] && ! grep -q "video=HDMI-A-1:" "$BOOT/cmdline.txt"; then
  sed -i '1 s/[[:space:]]*$/ video=HDMI-A-1:1280x720@60D/' "$BOOT/cmdline.txt"
fi

if [[ $MODE == image ]]; then
  echo "==> image: name, first boot"
  echo jam-session > /etc/hostname
  if grep -q "^127\.0\.1\.1" /etc/hosts; then
    sed -i 's/^127\.0\.1\.1.*/127.0.1.1\tjam-session/' /etc/hosts
  else
    printf '127.0.1.1\tjam-session\n' >> /etc/hosts
  fi
  # ⚠️ THE FIRST-BOOT WIZARD ASKS FOR A USERNAME ON A CONSOLE, and on a box with no keyboard it
  # would ask forever. Masked. Raspberry Pi Imager's own customisation (user, Wi-Fi, SSH) is
  # applied at first boot separately.
  if [[ -n "$(systemctl list-unit-files userconfig.service --no-legend 2>/dev/null)" ]]; then
    systemctl mask userconfig.service
    echo "    masked userconfig.service"
  fi
  apt-get clean
  rm -rf /var/lib/apt/lists/*
else
  systemctl daemon-reload
  systemctl restart jam-server.service jam-kiosk.service
fi
echo "==> provisioned ($MODE)"
