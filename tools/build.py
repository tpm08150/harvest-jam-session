#!/usr/bin/env python3
"""Assemble the Patchwork apps from src/ into the single files that ship.

The build is a pure join — every line of the output lives in exactly one fragment,
concatenated in the order parts.txt gives. No templating, no substitution, nothing
that could put the source and the shipped file out of step in a way a diff would
miss. That is what keeps the "one HTML file, no build dependencies" rule honest at
13,000 lines: `python3 tools/build.py` needs nothing but a Python interpreter.

    python3 tools/build.py              # write the apps
    python3 tools/build.py --check      # verify they match src/ without writing

--check is the build contract and belongs in any pre-commit or CI hook: it fails if
a shipped file was hand-edited instead of its source, which is the one way this
layout can silently rot.

Manifest entries are paths relative to src/, so an app can pull in shared fragments —
shell/host.js is built into all three outputs, and the token and reset sheets are one
copy rather than a matched pair that can drift.
"""
import re, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = REPO / "src"

APPS = {"cs1": "chord-synth.html",
        "dr1": "drums.html",
        "lp1": "looper.html",
        "bs1": "bass.html",
        "vc1": "vocoder.html",
        "pm1": "poly-synth.html",
        "studio": "index.html"}


def manifest(app):
    """The fragments of one app, in build order, as paths relative to src/."""
    listed = [ln.strip() for ln in (SRC / app / "parts.txt").read_text().splitlines()]
    return [ln for ln in listed if ln and not ln.startswith("#")]


def audit():
    """Every fragment under src/ must be built into something.

    A file that exists but appears in no manifest is silently dropped from every
    output — the failure an explicit manifest exists to catch, and one a diff of the
    built files cannot show you, because the missing lines were never there.
    """
    listed, problems = set(), []
    for app in APPS:
        for rel in manifest(app):
            listed.add(rel)
            if not (SRC / rel).is_file():
                problems.append(f"{app}/parts.txt lists a file that does not exist: {rel}")
    on_disk = {str(p.relative_to(SRC)) for p in SRC.rglob("*")
               if p.is_file() and p.name != "parts.txt"}
    for orphan in sorted(on_disk - listed):
        problems.append(f"no manifest builds src/{orphan}")
    if problems:
        sys.exit("\n".join(problems))


# The panel identity classes are shared on purpose: the shell styles the panel it hosts.
# Shared on purpose: the shell styles the panel it hosts, and "armed" is a state word
# that means the same thing in the launcher and in LP·1 — waiting for a musical seam —
# deliberately in the same yellow, so it reads as one idea across the studio.
# "face" is the same kind of word: the shell sets it on the panel root and the studio
# sizes the rack by it, and a panel has to be allowed to lay ITSELF out differently while
# it is on — which is a rule about that panel's own blocks, so it belongs in that panel's
# sheet rather than in the shell reaching in after it.
PANEL_CLASSES = {"unit", "focused", "armed", "face", "hosted"} | set(APPS)


def collisions():
    """The shell's own chrome must not use a class name an instrument uses.

    Both instruments were written as whole pages, so their class names are short and
    generic — `rack`, `row`, `card`, `brand`. An unscoped rule in the studio stylesheet
    silently restyles the inside of a panel, which is the exact failure this layout
    exists to prevent. Instrument sheets cannot collide with each other, because @scope
    confines them; only the shell's is page-wide, so only the shell needs checking.
    """
    def in_css(rel):
        s = re.sub(r"/\*.*?\*/", "", (SRC / rel).read_text(), flags=re.S)
        return set(re.findall(r"\.([a-zA-Z][\w-]*)", s))
    def in_html(rel):
        return {c for m in re.findall(r'class="([^"]+)"', (SRC / rel).read_text())
                for c in m.split()}

    owned = set()
    for rel in (r for r in manifest("studio") if r.startswith("studio/")):
        owned |= in_css(rel) if rel.endswith(".css") else in_html(rel) if rel.endswith(".html") else set()
    # derived, not listed — adding an instrument should not mean remembering to add it
    # here as well, and forgetting would silently weaken the check
    instrument = set()
    for d in sorted(SRC.iterdir()):
        if (d / "panel.css").is_file() and (d / "panel.html").is_file():
            instrument |= in_css(f"{d.name}/panel.css") | in_html(f"{d.name}/panel.html")

    clash = sorted((owned & instrument) - PANEL_CLASSES)
    if clash:
        sys.exit("the studio stylesheet uses class names an instrument already owns: "
                 + ", ".join(clash) + "\nprefix them st- so they cannot reach inside a panel")


def render(app):
    return "".join((SRC / rel).read_text() for rel in manifest(app))


if __name__ == "__main__":
    audit()
    collisions()
    check = "--check" in sys.argv[1:]
    stale = []
    for app, out in APPS.items():
        built, dest = render(app), REPO / out
        if check:
            current = dest.read_text() if dest.exists() else None
            if current != built:
                stale.append(out)
            print(f"{'ok' if current == built else 'STALE':>5}  {out}")
        else:
            dest.write_text(built)
            print(f"{len(built.splitlines()):>5} lines  {out}")
    if stale:
        sys.exit(f"\n{len(stale)} file(s) differ from src/. Run: python3 tools/build.py")
