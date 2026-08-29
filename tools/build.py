#!/usr/bin/env python3
"""Assemble the Patchwork apps from src/ into the single files that ship.

The build is a pure join — every line of the output lives in exactly one fragment,
concatenated in the order parts.txt gives. No templating, no substitution, nothing
that could put the source and the shipped file out of step in a way a diff would
miss. That is what keeps the "one HTML file, no build dependencies" rule honest at
13,000 lines: `python3 tools/build.py` needs nothing but a Python interpreter.

    python3 tools/build.py              # write the apps
    python3 tools/build.py --check      # verify they match src/ without writing

--check is the Phase 1 contract and belongs in any pre-commit or CI hook: it fails
if a shipped file was hand-edited instead of its source, which is the one way this
layout can silently rot.
"""
import sys, pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = REPO / "src"

APPS = {"cs1": "patchwork-chord-synth.html",
        "ms1": "patchwork-mono-synth.html"}


def parts(app):
    """The fragments of one app, in build order.

    Every file in the directory must be listed. A fragment that exists but is not in
    parts.txt would otherwise be silently dropped from the build — the failure mode
    an explicit manifest exists to catch, so it is an error rather than a warning.
    """
    d = SRC / app
    listed = [ln.strip() for ln in (d / "parts.txt").read_text().splitlines()]
    listed = [ln for ln in listed if ln and not ln.startswith("#")]

    on_disk = {p.name for p in d.iterdir() if p.name != "parts.txt"}
    missing = [n for n in listed if n not in on_disk]
    unlisted = sorted(on_disk - set(listed))
    if missing:
        sys.exit(f"{app}/parts.txt lists files that do not exist: {', '.join(missing)}")
    if unlisted:
        sys.exit(f"{app}/ has fragments missing from parts.txt: {', '.join(unlisted)}")
    return [d / n for n in listed]


def render(app):
    return "".join(p.read_text() for p in parts(app))


if __name__ == "__main__":
    check = "--check" in sys.argv[1:]
    stale = []
    for app, out in APPS.items():
        built, dest = render(app), REPO / out
        if check:
            current = dest.read_text() if dest.exists() else None
            state = "ok" if current == built else "STALE"
            if current != built:
                stale.append(out)
            print(f"{state:>5}  {out}")
        else:
            dest.write_text(built)
            print(f"{len(built.splitlines()):>5} lines  {out}")
    if stale:
        sys.exit(f"\n{len(stale)} file(s) differ from src/. Run: python3 tools/build.py")
