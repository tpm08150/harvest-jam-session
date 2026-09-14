# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Jam Session (the code calls itself Patchwork): instruments built on Web Audio and Web MIDI, each
shipped as one self-contained HTML file with no dependencies, plus a studio page that hosts them
all on one clock and one audio bus. `README.md` documents features and controller gestures;
`HANDOFF.md` records design decisions and measurements (its opening "Layout" section predates the
MS·1 split); `SESSION.md` is a dated brief from 2026-08-29. README's intro undercounts the
instruments — `tools/build.py` is the authoritative list.

## Commands

```bash
python3 tools/build.py            # after ANY edit under src/ — rewrites the nine .html files
python3 tools/build.py --check    # the commit contract: fails if a built file differs from src/
python3 serve.py                  # no-cache dev server on http://localhost:8123 (PORT=… to change)
```

There is no test runner, linter or package manager. Verification uses generated harness pages
(`_*.html`, gitignored) built from the current output — rebuild first, serve, open the page, and
drive it from the console:

| Command | Page | What it supplies |
| --- | --- | --- |
| `python3 tools/build-surface-harness.py` | `_surfacetest.html` | a fake Launchkey MK4 on both USB ports: `__lk.connect()`, `.pad(cell, vel)`, `.padOff(cell)`, `.btn(cc)`, `.enc(i, v)`, `.customEnc(i, v)` (a knob in Custom 1, on the MIDI port), `.raw(bytes)`, `.leds()`, `.text()`, `.bitmaps()`, `.out` |
| `python3 tools/build-midi-harness.py` | `_miditest.html` | a fake MIDI input for the router: `__midi.note(ch, n, vel)`, `.raw(bytes)`, `.seen`, `.handlers()` |
| `python3 tools/build-phase-harness.py` | `_phasetest.html` | a synthetic 24 ppqn clock and recorded oscillator times: `__phase.start(120)`, `.slope()`, `.step(ms)`, `.stop()` — plays audio until stopped |
| `python3 tools/build-capture-harness.py` | `_capture.html` | CS·1 with a 10 s master recorder and an injected test click, for "is this artefact in the audio?" |
| `python3 ios/build-test-harness.py` | `_iostest.html` | the iOS Web MIDI shim with a mocked native side: `window.__native.*` |

Modules also expose `window.__<id>` hooks (e.g. `__vc1.renderVoc`, `__fx.render`) that render the
real graph into an `OfflineAudioContext`, so a sound can be measured rather than described.

Jam relays — two implementations of one protocol:

```bash
python3 tools/jam-relay.py                        # LAN relay on 8124; open the studio with ?relay=ws://<host>:8124
cd relay && npx wrangler deploy                   # the hosted Cloudflare Worker the site uses (HOME_RELAY in src/shell/session.js)
python3 tools/relay-check.py ws://localhost:8124  # holds either relay to the same assertions; safe against the live one
```

`?relay=off` keeps a jam to tabs on one machine.

## Build model

- The `.html` files at the root are **build output, and committed**: Netlify publishes the root
  with no build step, and the iOS app copies HTML from it. Edit `src/`, never a built file.
- `tools/build.py` is a **pure join**: `src/<app>/parts.txt` lists fragments (paths under `src/`)
  concatenated in order — no templating, so `git diff` of the output is the whole review. Outputs:
  `index.html` (studio), `chord-synth.html` CS·1, `poly-synth.html` PM·1, `vocoder.html` VC·1,
  `bass.html` BS·1, `drums.html` DR·1, `looper.html` LP·1, `transitions.html` TS·1,
  `sequencer.html` SQ·1.
- The build also fails when a fragment under `src/` is in no manifest (a new file must be added to
  every `parts.txt` that should carry it), when a manifest lists a missing file, or when the
  studio stylesheet uses a class name an instrument owns.
- Because every commit must pass `--check`, commit each change with its own rebuild. Splitting an
  already-mixed tree later means rebuilding each intermediate state.

## Architecture

**Panels on one page.** An instrument's scripts are wrapped by `src/<id>/_open.js` and `_close.js`
into `Patchwork.instrument(id, root => …)`, where `$`/`$$` query inside the panel root — element
ids repeat across panels harmlessly. Panel CSS is wrapped in `@scope` by `_panel-open.css` and
`_panel-close.css`; page-wide rules live in `src/shell/`. Keys go through `Patchwork.onKey(root, …)`,
never `document`: `shell/host.js` hands each key to the focused panel's handlers, whether or not
something else already handled it, and a keyup to the panel that got its keydown. Markup attributes
decide where things show: `data-hosted` (the panel's own control, hidden when the studio provides
it), `data-silent` (no audio strip), `data-face` / `data-deep` (performance face vs opened panel).

**Shell singletons (`src/shell/`, each `Patchwork.<name>`).** Instruments never reach each other
or hardware directly; they register adapters:
- `midi.route(id, onMidi, onPort, spec)` — MIDI channels plus the controller adapters (`controls`,
  `controlBanks`, `grid`, `face`, …). `midi.claim(portId, fn)` gives a controller one port
  exclusively. `surface.panel(id, spec)` is the same door for a panel that takes no MIDI (LP·1).
- `scenes.register(id, {capture, apply, start, stop, …})` — the launcher. A row lands on a seam, a
  boundary each client computes from a shared clock origin, never "now"; `clock.js` ticks from an
  AudioWorklet so timing survives background tabs.
- `sequences.register(id, {blank, used})` — sixteen patterns per instrument (the strip under the
  patch row); the grid is whichever one is up. Anything that writes a pattern from outside a panel
  goes through `sequences.around(id, fn)`, or the sequence you were on absorbs it.
- `record.register`, `patches.mount`, the `chords` and `kit` registries, and
  `session.registerPatch` / `registerVoice` for jams: patterns and patches are polled and diffed,
  fires, notes and takes are pushed, and only looper takes, the metronome and talkback travel as
  audio.

**Audio graph (`shell/bus.js`).** One `AudioContext`. Each instrument plays into
`audio.strip(id)`: EQ → compressor → fader → pan → master (sends post-fader), then the punch rack
spliced in with `audio.insert` (`shell/fx.js`), then `end` → a discrete channel merger →
destination. The device is `setSink`; per-instrument output pairs are `setOut`. `tap` / `tapOnly`
listen **pre-fader** at strip inputs (the looper records and the vocoder modulates dry; release
with `untap`), while `monitor()` listens after everything (the tape records the performance).

**Controllers (`shell/surface.js` + a profile).** `rig.focus` is the mounted page for the current
mode, else the focused panel's spec, and a profile talks only to `rig`. `shell/launchkey.js`
(Launchkey MK4) claims the DAW port, hands the keys port to the router, polls state and repaints
LEDs and screen every 60 ms sending only changes, maps the device's encoder modes to studio views
(`ENC_VIEW`), and draws on the screen with SysEx text and 128×64 bitmaps
(`shell/launchkey-art.js`, frames paced by the device's reply). The studio mounts pages: `scenes`
(`studio/scenes.js`), `mixer` (`studio/console.js`), `settings` (`studio/settings.js`), `punch`
(`studio/live.js`).

**Studio (`src/studio/`).** Views — Studio, Tape, Live, Library, Settings — are switched by
`show()` in `studio/live.js`, where Studio is derived as "none of the others", so a new view must
be added there. With cloud sync configured (`shell/cloud.js`, Supabase; SQL in `docs/`),
`studio/gate.js` covers the page with a Google sign-in; the panels still boot underneath.

**Elsewhere.** `relay/` is the hosted relay (a Durable Object). `ios/` holds the Web MIDI shim for
the WKWebView app; `ios/Sources/*.swift` is canonical and is copied into `Patchwork/Patchwork/`.
`pi/` is the Raspberry Pi groovebox: `pi/image/build.sh` makes a burnable Raspberry Pi OS image and
needs an arm64 Linux host, so `.github/workflows/pi-image.yml` runs it on GitHub's arm64 runners;
`pi/provision.sh` installs the offline kiosk, on the image or a live Pi; `pi/jam-browser` grants MIDI
over DevTools and has a `--smoke` check. ⚠️ The image rewrites `const OFFLINE = false;` in
`shell/cloud.js` and fails unless it finds that exact line. Not yet run on a Pi.

## Working here

- **Comments carry the reasoning.** Code explains why at length, flags traps as
  `⚠️ CAPITALISED HEADLINE`, and records what was measured and when. Match it, and update
  `README.md` / `HANDOFF.md` with behaviour changes.
- **The hardware beats the guide.** Several `shell/launchkey.js` constants from Novation's
  Programmer's Reference were wrong on the device. The surface harness proves decoding only; with a
  controller connected, `Patchwork.surface.traffic` (last 64 messages in) and `.sent` (last 160
  out) show what really crossed the cable. `tools/probe-launchkey.py` asks the device over CoreMIDI
  (needs `python-rtmidi` in a venv) and knocks a connected page out of DAW mode.
- **Web MIDI needs a secure context** (`localhost` or HTTPS); `AudioContext.setSinkId` needs Chrome
  110+. The Claude desktop browser pane is never granted Web MIDI or microphone access, so it cannot
  exercise a controller or an input device — use a harness page, or a separate Chrome.
- **Two open copies of the app both receive the controller's MIDI** and both write its LEDs. Check
  for a second tab before debugging "one press does two things".
- **Automated runs make real sound** through the machine's output. Stop the transports and suspend
  or close the `AudioContext` when a test is done.
- **Chrome on macOS decides a device's channels**: an output gets only the channels named in Audio
  MIDI Setup → Configure Speakers, and an input with more than two channels opens as stereo.
- **Pushing `main` deploys to Netlify.** Commit subjects are plain sentences about the behaviour;
  bodies explain why.
- `tools/sync-allowlist.py` prints colleagues' email addresses as SQL — redirect it outside the
  repo.
