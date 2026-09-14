#!/usr/bin/env bash
# Turn a Raspberry Pi you already have — Raspberry Pi OS Lite, 64-bit, Trixie — into a Jam Session box.
#
# ⚠️ MOST PEOPLE WANT THE IMAGE: burn it and boot, see pi/README.md. This runs the same provisioning
# (pi/provision.sh) on a live Pi instead, which needs a network connection, and a reboot at the end
# for the HDMI setting to take.
#
#   git clone https://github.com/tpm08150/harvest-jam-session
#   cd harvest-jam-session && sudo pi/setup.sh
#
# Undo: sudo systemctl disable --now jam-kiosk jam-server
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
[[ $EUID -eq 0 ]] || { echo "run me with sudo" >&2; exit 1; }

"$HERE/provision.sh"

cat <<'DONE'

Done. Reboot (sudo reboot) so HDMI comes up switched on; the rack starts by itself after that.

  journalctl -fu jam-kiosk     what the browser is doing
  journalctl -fu jam-server    what the page server is doing
  wpctl status                 the audio outputs PipeWire sees, and which one is the default
DONE
