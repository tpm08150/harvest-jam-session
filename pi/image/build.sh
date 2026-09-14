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
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT_ARG="${1:-$REPO/out}"
BASE_IMAGE_URL="${BASE_IMAGE_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-06-19/2026-06-18-raspios-trixie-arm64-lite.img.xz}"
GROW_MB="${GROW_MB:-1800}"
SMOKE="${SMOKE:-1}"

[[ $EUID -eq 0 ]] || { echo "run me as root" >&2; exit 1; }
[[ "$(uname -m)" == aarch64 ]] || { echo "needs an arm64 Linux machine; this one is $(uname -m)" >&2; exit 1; }
for tool in curl xz parted partx losetup e2fsck resize2fs zerofree sha256sum findmnt chroot; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
mkdir -p "$OUT_ARG"
OUT="$(cd "$OUT_ARG" && pwd)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/jam-image.XXXXXX")"
ROOT="$WORK/root"
LOOP=""

unmount_all() {
  findmnt -rn -o TARGET | grep -E "^$ROOT(/|$)" | sort -r | while read -r m; do
    umount "$m" || umount -l "$m"
  done
}
cleanup() {
  set +e
  unmount_all
  [[ -n $LOOP ]] && losetup -d "$LOOP"
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
LOOP="$(losetup --find --show --partscan "$WORK/jam.img")"
parted -s "$LOOP" resizepart 2 100%
partx -u "$LOOP"
for _ in $(seq 1 40); do [[ -b ${LOOP}p2 ]] && break; sleep 0.25; done
e2fsck -pf "${LOOP}p2" || [[ $? -le 1 ]]            # 1 means it corrected something, which is fine
resize2fs "${LOOP}p2"

echo "==> mount"
mkdir -p "$ROOT"
mount "${LOOP}p2" "$ROOT"
mkdir -p "$ROOT/boot/firmware"
mount "${LOOP}p1" "$ROOT/boot/firmware"
mount --bind /dev "$ROOT/dev"
mount --bind /dev/pts "$ROOT/dev/pts"
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
unmount_all
e2fsck -pf "${LOOP}p2" || [[ $? -le 1 ]]
zerofree "${LOOP}p2"                                # zeroed free space is what makes it compress
losetup -d "$LOOP"
LOOP=""

rev="${IMAGE_REV:-$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo local)}"
name="jam-session-pi-$(date -u +%Y%m%d)-$rev.img"
mv "$WORK/jam.img" "$OUT/$name"
echo "==> compress: $name.xz"
xz -T0 -6 -f "$OUT/$name"
(cd "$OUT" && sha256sum "$name.xz" > "$name.xz.sha256")
ls -lh "$OUT"
