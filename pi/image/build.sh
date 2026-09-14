#!/usr/bin/env bash
# Build the Jam Session SD card image: Raspberry Pi OS Lite (64-bit) with the rack on it.
#
#   sudo pi/image/build.sh [out-dir]     writes out-dir/jam-session-pi-DATE-REV.img.xz and its .sha256
#
# ⚠️ LINUX, ROOT, ARM64. It loop-mounts the image and runs pi/provision.sh inside it with chroot, so
# the image's arm64 programs have to run on the build machine itself. That is why the image is built
# on GitHub's ubuntu-24.04-arm runners (.github/workflows/pi-image.yml) and not on a Mac.
#
# Environment:
#   BASE_IMAGE_URL  the Raspberry Pi OS Lite image to start from; its published .sha256 is checked
#   GROW_MB         room added for Chromium and friends (default 1800)
#   SMOKE=0         skip the headless check that the rack comes up inside the image
#   IMAGE_REV       the revision in the file name (default: git's short hash)
set -Eeuo pipefail
# A failure says where. The build runs where its log needs a sign-in to read, and "exit code 1" on
# its own sent the first run's diagnosis to guesswork.
trap 'echo "!! build.sh stopped at line $LINENO: $BASH_COMMAND" >&2' ERR

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT_ARG="${1:-$REPO/out}"
BASE_IMAGE_URL="${BASE_IMAGE_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-06-19/2026-06-18-raspios-trixie-arm64-lite.img.xz}"
GROW_MB="${GROW_MB:-1800}"
SMOKE="${SMOKE:-1}"

[[ $EUID -eq 0 ]] || { echo "run me as root" >&2; exit 1; }
[[ "$(uname -m)" == aarch64 ]] || { echo "needs an arm64 Linux machine; this one is $(uname -m)" >&2; exit 1; }
for tool in curl xz parted sfdisk python3 losetup e2fsck resize2fs zerofree sha256sum findmnt chroot; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
mkdir -p "$OUT_ARG"
OUT="$(cd "$OUT_ARG" && pwd)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/jam-image.XXXXXX")"
ROOT="$WORK/root"
ROOT_LOOP=""
BOOT_LOOP=""

# Anything still running with its root in the image — a browser's crash handler outliving the smoke
# test, say — keeps its filesystems busy, and a busy root cannot be checked or zeroed cleanly.
chroot_pids() {
  local p
  for p in /proc/[0-9]*; do
    if [[ "$(readlink "$p/root" 2>/dev/null)" == "$ROOT" ]]; then echo "${p#/proc/}"; fi
  done
  return 0
}
stop_chroot() {
  local pids
  pids="$(chroot_pids)"
  [[ -z $pids ]] && return 0
  echo "    stopping what is still running in the image: $(echo $pids)"
  kill $pids 2>/dev/null || true
  sleep 2
  pids="$(chroot_pids)"
  if [[ -n $pids ]]; then kill -9 $pids 2>/dev/null || true; sleep 1; fi
  return 0
}
unmount_all() {
  findmnt -rn -o TARGET | grep -E "^$ROOT(/|$)" | sort -r | while read -r m; do
    umount "$m" || umount -l "$m"
  done
}
cleanup() {
  set +e
  stop_chroot
  unmount_all
  [[ -n $BOOT_LOOP ]] && losetup -d "$BOOT_LOOP"
  [[ -n $ROOT_LOOP ]] && losetup -d "$ROOT_LOOP"
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> base image"
echo "    $BASE_IMAGE_URL"
curl -fsSL --retry 3 -o "$WORK/base.img.xz" "$BASE_IMAGE_URL"
expected="$(curl -fsSL --retry 3 "$BASE_IMAGE_URL.sha256" | awk '{print $1}')"
actual="$(sha256sum "$WORK/base.img.xz" | awk '{print $1}')"
if [[ -z $expected || $expected != "$actual" ]]; then
  echo "checksum mismatch: got $actual, published ${expected:-nothing}" >&2
  exit 1
fi
xz -dc "$WORK/base.img.xz" > "$WORK/jam.img"
rm -f "$WORK/base.img.xz"

echo "==> room for the rack: +$GROW_MB MB"
truncate -s "+${GROW_MB}M" "$WORK/jam.img"
# THE PARTITION IS GROWN IN THE FILE, NOT ON A LOOP DEVICE. Resizing on a partition-scanned loop
# device leaves the kernel to be told about the new table, which a build machine's udev may or may not
# manage, so each filesystem gets a loop device of its own at its byte offset and the kernel never sees
# a partition table at all. This was the first suspect when the first CI run died 75 s in with its log
# out of reach — but the second run, at 77 s, got past it and died on /dev/shm in the smoke test (see
# the mounts below), so the first most likely did too. Kept anyway: it needs nothing from udev.
parted -s "$WORK/jam.img" resizepart 2 100%
part() {   # partition number -> "offset size", in bytes
  sfdisk -J "$WORK/jam.img" | python3 -c '
import json, sys
t = json.load(sys.stdin)["partitiontable"]
sector = t.get("sectorsize", 512)
p = [p for p in t["partitions"] if p["node"].endswith(sys.argv[1])][0]
print(p["start"] * sector, p["size"] * sector)' "$1"
}
read -r boot_offset boot_size <<< "$(part 1)"
read -r root_offset root_size <<< "$(part 2)"
[[ -n ${boot_size:-} && -n ${root_size:-} ]] || { echo "could not read the image's partition table" >&2; exit 1; }
echo "    boot: $boot_size bytes at $boot_offset; root: $root_size bytes at $root_offset"
ROOT_LOOP="$(losetup --find --show --offset "$root_offset" --sizelimit "$root_size" "$WORK/jam.img")"
BOOT_LOOP="$(losetup --find --show --offset "$boot_offset" --sizelimit "$boot_size" "$WORK/jam.img")"
e2fsck -pf "$ROOT_LOOP" || [[ $? -le 1 ]]           # 1 means it corrected something, which is fine
resize2fs "$ROOT_LOOP"

echo "==> mount"
mkdir -p "$ROOT"
mount "$ROOT_LOOP" "$ROOT"
mkdir -p "$ROOT/boot/firmware"
mount "$BOOT_LOOP" "$ROOT/boot/firmware"
mount --bind /dev "$ROOT/dev"
# ⚠️ PRIVATE, WITH A /dev/shm OF ITS OWN. A bind of /dev does not bring the mounts inside it, so the
# image's /dev/shm was the bare directory under the build machine's — root's, mode 755 — and Chromium,
# run as jam for the smoke test, died on it: "Unable to access(W_OK|X_OK) /dev/shm: Permission denied".
# The bind is made private first, so the tmpfs mounted over it stays in the image instead of landing
# on top of the build machine's own /dev/shm.
mount --make-rprivate "$ROOT/dev"
mount --bind /dev/pts "$ROOT/dev/pts"
mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs "$ROOT/dev/shm"
mount -t proc proc "$ROOT/proc"
mount -t sysfs sysfs "$ROOT/sys"
mount -t tmpfs -o mode=755 tmpfs "$ROOT/run"
mount -t tmpfs -o mode=1777 tmpfs "$ROOT/tmp"

# Put back afterwards exactly as found: a Pi makes its own machine id at first boot, and its own
# resolver settings.
cp -a "$ROOT/etc/machine-id" "$WORK/machine-id" 2>/dev/null || true
if [[ -e $ROOT/etc/resolv.conf || -L $ROOT/etc/resolv.conf ]]; then mv "$ROOT/etc/resolv.conf" "$WORK/resolv.conf"; fi
cp -L /etc/resolv.conf "$ROOT/etc/resolv.conf"
printf '#!/bin/sh\n# nothing starts inside the build chroot\nexit 101\n' > "$ROOT/usr/sbin/policy-rc.d"
chmod 755 "$ROOT/usr/sbin/policy-rc.d"

echo "==> the base image"
chroot "$ROOT" /bin/sh -c '. /etc/os-release; echo "    $PRETTY_NAME"'
echo "    cmdline.txt: $(cat "$ROOT/boot/firmware/cmdline.txt")"
echo "    uid 1000: $(chroot "$ROOT" getent passwd 1000 || echo none)"
chroot "$ROOT" systemctl list-unit-files --no-pager --no-legend 2>/dev/null \
  | grep -Ei 'userconf|cloud-init|firstboot|resize|regenerate' | sed 's/^/    /' || true

echo "==> provision"
SRC="$ROOT/tmp/jam-src"
mkdir -p "$SRC"
cp "$REPO/serve.py" "$SRC/"
find "$REPO" -maxdepth 1 -name '*.html' ! -name '_*' -exec cp {} "$SRC/" \;
cp -r "$REPO/pi" "$SRC/pi"
chroot "$ROOT" /bin/bash /tmp/jam-src/pi/provision.sh --image

if [[ $SMOKE == 1 ]]; then
  echo "==> smoke: the rack, headless, inside the image"
  # Everything the check writes lives under /tmp, a tmpfs that is gone when the image is unmounted.
  chroot "$ROOT" /bin/bash -c '
    set -uo pipefail
    set -a; . /etc/jam-session.conf; set +a
    install -d -o jam -g jam /tmp/smoke
    cd /opt/jam-session
    runuser -u jam -- env HOST=127.0.0.1 PORT="$PORT" python3 serve.py > /tmp/smoke/serve.log 2>&1 &
    server=$!
    runuser -u jam -- env HOME=/tmp/smoke XDG_CONFIG_HOME=/tmp/smoke/config XDG_CACHE_HOME=/tmp/smoke/cache \
      JAM_PROFILE=/tmp/smoke/profile JAM_NO_SANDBOX=1 DEVTOOLS_PORT=9333 PORT="$PORT" APP_PAGE="$APP_PAGE" \
      python3 /opt/jam-session/jam-browser --smoke --expect-offline
    status=$?
    kill "$server" 2>/dev/null
    wait "$server" 2>/dev/null
    exit "$status"
  '
fi

echo "==> finish"
rm -f "$ROOT/usr/sbin/policy-rc.d" "$ROOT/etc/resolv.conf"
if [[ -e $WORK/resolv.conf || -L $WORK/resolv.conf ]]; then mv "$WORK/resolv.conf" "$ROOT/etc/resolv.conf"; fi
if [[ -e $WORK/machine-id ]]; then cp -a "$WORK/machine-id" "$ROOT/etc/machine-id"; fi
rm -rf "$SRC"
df -h "$ROOT" | awk 'NR == 2 {print "    root filesystem: " $3 " used, " $4 " free"}'
stop_chroot
unmount_all
e2fsck -pf "$ROOT_LOOP" || [[ $? -le 1 ]]
zerofree "$ROOT_LOOP"                               # zeroed free space is what makes it compress
losetup -d "$BOOT_LOOP"
BOOT_LOOP=""
losetup -d "$ROOT_LOOP"
ROOT_LOOP=""

rev="${IMAGE_REV:-$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo local)}"
name="jam-session-pi-$(date -u +%Y%m%d)-$rev.img"
mv "$WORK/jam.img" "$OUT/$name"
echo "==> compress: $name.xz"
xz -T0 -6 -f "$OUT/$name"
(cd "$OUT" && sha256sum "$name.xz" > "$name.xz.sha256")
ls -lh "$OUT"
