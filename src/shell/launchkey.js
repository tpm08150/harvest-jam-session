
/* Novation Launchkey MK4 — the numbers in here come from Novation's Programmer's
   Reference Guide v2.0, and every one of them is quoted beside the line that uses it so
   the next person does not have to go and find the PDF again.

   The shape of the device, as this file uses it:

     MIDI port ──── keys, wheels, aftertouch          → the page's performance input
     DAW port  ──── pads, encoders, transport, LEDs   → claimed by the surface

   Two USB ports, and that split is the reason the shell grew claim(): the keys have to
   reach the instruments through the ordinary router, while the pads and encoders have to
   reach only this file. One port could not do both without the surface either swallowing
   every note or every instrument having to learn what a pad note number means.

   ⚠️ DAW MODE IS A MODE THE DEVICE STAYS IN. Enter it and the surface stops behaving like
   a plain MIDI controller until something tells it otherwise — including after the tab is
   gone. stop() is therefore not tidy-up, it is the other half of start(), and it is wired
   to pagehide as well as to the disconnect button. A Launchkey left in DAW mode by a
   closed tab is a controller whose pads have gone dark for no reason the user can see. */
(() => {
"use strict";
if (!window.Patchwork || !Patchwork.surface) return;

/* ---- the wire ----------------------------------------------------------------- */

/* SysEx header. The last byte is the only difference between the full-size and the Mini
   SKUs, and getting it wrong is silent: the device ignores a message addressed to a
   product it is not. Guide, "SysEx message format used by the device". */
const HDR_FULL = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x14];
const HDR_MINI = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x13];

/* Guide, "DAW mode control": note-on channel 16, note 12. */
const DAW_ON  = [0x9F, 0x0C, 0x7F];
const DAW_OFF = [0x9F, 0x0C, 0x00];
/* Guide, "Launchkey MK4 feature controls": the same shape, note 11. */
const FEAT_ON = [0x9F, 0x0B, 0x7F];

/* Feature controls live on channel 7 (B6h). Guide, feature control table. */
const FEAT = 0xB6;
const F_PADS = 0x1D,      // 29 — pad layout select
      F_ENCS = 0x1E,      // 30 — encoder layout select
      F_SHIFT = 0x3F,     // 63 — Shift, reported here as well as on the button channel
      F_DRUM = 0x54,      // 84 — DAW takes the drum rack (0 leaves it in MIDI mode)
      F_TIMEOUT = 0x71;   // 113 — temporary display timeout, in tenths of a second
/* Feature controls are queried by sending the same CC on channel 8; the answer comes back
   on channel 7. Guide, "Launchkey MK4 feature controls". */
const FEAT_ASK = 0xB7;
/* ⚠️ HALF A SECOND, DOWN FROM THE DEVICE'S OWN FOUR OR FIVE. A temporary display is an answer
   to something you just did, and it sits on top of the legend while it lasts — so anything
   past "long enough to read" is time spent hiding the thing you actually navigate by. Mostly
   what it answers now is a turned encoder, where the value has already been read by the time
   the hand stops moving.

   The guide gives the units as tenths of a second and says "minimum of 1 sec at 0", which
   leaves it unclear whether anything under ten is honoured. Five is the ask; a device that
   clamps it will land on one second, which was the previous setting and no worse.

   ⚠️ AND IT IS NON-VOLATILE, marked (*) in the guide: it survives a power cycle, so this is
   not a setting to change and walk away from. It is read before it is written and put back
   on the way out — see start() and stop(). An app that quietly re-tunes somebody's hardware
   and leaves it that way is a bad guest. */
const TIMEOUT_TENTHS = 5;
const PAD_DRUM = 1, PAD_DAW = 2;
const ENC_PLUGIN = 2, ENC_MIXER = 1;   // absolute CC 21-28; Mixer and Sends send the same CCs
/* ⚠️ THE FOUR ENCODER MODES ARE THE FOUR VIEWS, which is a coincidence worth taking. Shift
   and a pad is already how a Launchkey chooses what its knobs are for, and the app already
   has four screens; wiring one to the other means the surface has no navigation of its own
   to learn and no button to spend on it. Mixer is the only one that also retargets the
   encoders, because it is the only one of the four that is a thing to turn knobs at. */
const ENC_VIEW = {1: {view: "tape",   page: "mixer"},
                  2: {view: "studio", page: ""},
                  4: {view: "live",   page: "scenes"},
                  5: {view: "lib",    page: ""}};

/* Pads. DAW layout reports as notes on channel 1; Drum layout on channel 10 once the DAW
   has taken the rack. Guide, "DAW mode" and "Drum mode" pad index figures.

   ⚠️ The guide prints the Drum-mode status byte as 9Ah while calling it Channel 10, and
   those two disagree — 9Ah is channel 11. Rather than pick a side, both are accepted on
   the way in. Nothing else on this port uses either, so the cost of being wrong in the
   generous direction is nothing at all. */
const DAW_NOTE_TOP = [96, 97, 98, 99, 100, 101, 102, 103];
const DAW_NOTE_BOT = [112, 113, 114, 115, 116, 117, 118, 119];
const DRUM_NOTE_TOP = [40, 41, 42, 43, 48, 49, 50, 51];
const DRUM_NOTE_BOT = [36, 37, 38, 39, 44, 45, 46, 47];

/* Cell 0 is bottom-left, running right, then the top row — the same order CS·1 lays its
   chord pads out in, "filled bottom-up, so pad 1 sits bottom-left". Matching it means the
   hardware grid and the on-screen grid are the same picture. */
const cellNote = (mode, i) => i < 8
  ? (mode === PAD_DRUM ? DRUM_NOTE_BOT : DAW_NOTE_BOT)[i]
  : (mode === PAD_DRUM ? DRUM_NOTE_TOP : DAW_NOTE_TOP)[i - 8];
function noteCell(mode, n){
  const bot = mode === PAD_DRUM ? DRUM_NOTE_BOT : DAW_NOTE_BOT;
  const top = mode === PAD_DRUM ? DRUM_NOTE_TOP : DAW_NOTE_TOP;
  let i = bot.indexOf(n); if (i >= 0) return i;
  i = top.indexOf(n); return i < 0 ? -1 : i + 8;
}

/* Encoders: absolute CC 21-28 on channel 16 in Plugin, Mixer and Sends modes. Guide,
   "Encoder modes / Absolute Mode", cross-checked against the display targets on p17
   ("15h-1Ch: encoders"). */
const ENC_CC0 = 21, ENC_N = 8;
/* Where a list's encoder is parked between turns — mid-travel, so there is room to go either
   way. See the encoder branch in message(). */
const ENC_MID = 64;

/* Buttons, all Control Change on channel 16 (BFh). Guide, "The surface in DAW mode".
   The Mini SKUs carry the subset this file uses; the full-size adds a transport row whose
   Stop and Loop are 116 and 118, harmless to listen for on a Mini that never sends them. */
const CH_BTN = 0xBF;
const B_PLAY = 115, B_STOP = 116, B_REC = 117, B_LOOP = 118,
      B_ARROW_UP = 106, B_ARROW_DN = 107,      // ∧ ∨, left of the pads
      /* ⚠️ SHIFT DOES NOT PASS A MODIFIER, IT REMAPS THE KEY. Holding Shift and pressing the
         same two arrows sends 103 and 102 instead of 106 and 107 — the device's own Track
         pair, which is what the unit prints above them. So there is no such thing as
         "Shift + arrow" to listen for; there is a different button. Read off the hardware
         as `b0 67 7f` / `b0 66 7f`, after two wrong guesses that assumed a modifier. */
      B_TRACK_PREV = 103, B_TRACK_NEXT = 102,
      /* ⚠️ 51 AND 52, NOT THE 55 AND 56 THE GUIDE PRINTS. The Mini's DAW-mode figure labels
         the two buttons beside the encoders 55 and 56; the hardware sends 51 and 52, on
         channel 1, which is what the FULL-SIZE figure gives for the same pair. Read off a
         real Launchkey Mini MK4 37 with Patchwork.surface.traffic — `b0 33 7f` and
         `b0 34 7f` — so the document is wrong about this one and the device is not.
         Three of this file's numbers have now been settled by the traffic log rather than
         by the PDF; when they disagree, the log wins. */
      B_ENC_UP = 51, B_ENC_DN = 52,          // ∧ ∨, right of the encoders
      B_SCENE = 104,                          // ">", right of the pads — return to zero
      B_FUNC = 105,                           // "Func", right of the pads
      B_SHIFT = 63;

/* Button numbers that may also arrive on the feature channel — see the note in message().
   B_SCENE (104) and B_FUNC (105) are deliberately absent: they collide with the velocity
   curve feature controls, which report the same three bytes. */
const FEAT_THROUGH = [B_ENC_UP, B_ENC_DN, B_ARROW_UP, B_ARROW_DN,
                      B_TRACK_PREV, B_TRACK_NEXT, B_PLAY, B_STOP, B_REC, B_LOOP];

/* ⚠️ FUNCTION IS THE MODIFIER. SHIFT IS MOSTLY A SECOND KEYBOARD.

   Shift reaches us — it reports on channel 7 as `b6 3f` — but the device does most of the
   combining itself rather than leaving it to the host: hold Shift and the arrows beside the
   pads stop sending 106/107 and send 103/102, its own Track pair. Shift and a pad go further
   still and never arrive at all, being how the device's own pad-mode menu is driven.

   So for the most part what Shift produces are simply OTHER BUTTONS, listed above and bound
   like any other, and the one modifier this profile holds is Func.

   ⚠️ ONE THING READS IT AS STATE, and this note used to say nothing did: layerHeld() takes it
   as a second way into the alt layer. That is safe because it is built on Shift's own report,
   which always arrives, rather than on some other button changing number underneath it.

   ⚠️ NOTHING ELSE IS, AND THE HOP TRIED TO BE. Shift+Func was the gesture for hopping a linked
   pair and it read as unreliable on the hardware — which is exactly what the paragraph above
   predicts: this device does its own combining, and a host that builds a two-key gesture on
   Shift is competing with the device for the same press. Func + ">" instead, which is two keys
   this profile owns outright, sitting next to each other under one thumb. See jump().

   If a gesture ever seems dead, `Patchwork.surface.traffic` with the thing plugged in is the
   answer, and it is the answer to every question in this file. */

/* Colouring. "Channel 1: stationary, Channel 2: flashing, Channel 3: pulsing" for
   everything except the drum rack, which uses channels 10, 11 and 12. A pad LED is a note
   on those channels; a button LED is a control change with the button's own CC number. */
const LED_PAD_STATIC = 0x90, LED_PAD_PULSE = 0x92;
const LED_DRUM_STATIC = 0x99, LED_DRUM_PULSE = 0x9B;
const LED_BTN = 0xB0;

/* The Launchpad palette, by the indices worth naming. Within a hue, n is full brightness
   and n+2 is the dark version of the same colour — which is what makes "this pad exists"
   and "this pad is doing something" the same colour at two levels rather than two colours
   the eye has to learn. Guide, "Colour palette". */
const PAL = {off:0, white:3, red:5, amber:9, yellow:13, lime:17, green:21,
             spring:25, turquoise:29, cyan:33, sky:37, ocean:41, blue:45,
             orchid:49, magenta:53, pink:57};
const dim = c => (c && c !== PAL.white) ? c + 2 : (c === PAL.white ? 1 : 0);

/* An instrument's adapter names a colour; this is the only place those names mean an
   index. An unknown name lights white rather than nothing, because a pad that is on and
   the wrong colour is debuggable and a pad that is off is not. */
function hue(name){ return PAL[name] == null ? PAL.white : PAL[name]; }

/* ---- either modifier reaches the encoders' second eight ----
   ⚠️ SHIFT MAY NOT SURVIVE THE TRIP. It is reported, so the display follows it — but this
   device remaps rather than passes a modifier, and whether an encoder turned under Shift
   still sends its own CC is a fact about firmware, not about the guide. Func is ours and is
   known to arrive, and it means nothing else while a knob is moving.

   So either one opens it. That is not indecision: they are two keys asking the same
   question, and accepting both costs a boolean and removes the only way this feature can be
   dead on arrival. */
/* ⚠️ WHICH LAYER THE HANDS ARE ASKING FOR. Func and Shift both open the general one — see
   above for why both. ">" opens the other, and it is the one key here that is a BUTTON as
   well: held with a knob it is a modifier, pressed and released on its own it is an action.
   Which of the two it turned out to be is only knowable at the release, so `actUsed` records
   whether anything happened in between. */
function layerHeld(io){
  if (!io.state) return "";
  if (io.state.act) return "act";
  return (io.state.fn || io.state.shift) ? "alt" : "";
}
function altHeld(io){ return !!(io.state && (io.state.fn || io.state.shift)); }

/* The pair beside the encoders: pages the banks where there are banks, and where there are
   not, does whatever the panel offers instead. The same fallthrough the pad arrows use. */
function encArrow(io, rig, dir){
  /* ⚠️ A HELD PAD CLAIMS THIS PAIR wherever the grid has lengths to change, and claims it
     whether or not there is a note under the pad: holding a step is an unambiguous statement
     about which step you mean, and the pair's ordinary job — paging the encoder banks — is
     not something anyone reaches for with their other hand on a pad. Falling through would
     page a bank you cannot see under a gesture you meant for the grid.

     DR·1 has no stretch and wants none, because a drum hit has no length; there the pair goes
     on paging the lane with a pad held, which is what it always did. ∧ is longer: up is more. */
  if (io.state.down.length){
    const g = rig.grid();
    if (g && g.stretch){
      said(io, g.stretch(io.state.down[io.state.down.length - 1], dir < 0 ? 1 : -1));
      return;
    }
  }
  if (rig.controlBankBy(dir)) return;
  /* ⚠️ Func here is a SECOND PAIR, not the second eight. Holding it while TURNING a knob
     swaps what the eight are; holding it while PRESSING these two swaps what the pair does.
     Different gestures on different controls, and neither is in the other's way. */
  said(io, rig.bump(dir, altHeld(io)));
}

/* ---- Shift + Func: hop to the panel this one is paired with ----
   ⚠️ THIS WAS THE ARROWS AND THE ARROWS WERE WRONG FOR IT. They answered last, after banks
   and after the panel's own bump — which kept DR·1's lanes and PM·1's pages intact, and made
   the hop something you reached by paging to the end of a list first. A toggle you have to
   walk to is not a toggle.

   Two modifiers, held together, are free on every panel here: neither does anything on its
   own press, both are already tracked, and nothing else in this profile wants the pair. So
   the gesture costs nothing and is the same everywhere, which is what "quick" needed.

   Arriving somewhere changes what the pads are FOR, and the hardware has two layouts for
   that. A kit wants the Drum layout — the whole point of hopping to DR·1 is to hit drums,
   and landing on its step grid would mean a second press every time. Everything else wants
   the DAW layout, which is where its own grid is drawn. */
function jump(io, rig){
  const r = rig.jump();
  if (!r) return;
  /* ⚠️ ASKED OF THE PANEL, not matched against "dr1". A panel that offers drum lanes IS the
     kit — that is what the property means — and a second place in this file that knows the
     kit's name is a second place to update when there are two kits. */
  const f = rig.focus;
  const want = (f && f.spec && typeof f.spec.drumLanes === "function") ? PAD_DRUM : PAD_DAW;
  if (io.state.padMode !== want){
    io.state.padMode = want;
    io.state.pads.fill(-1);          // different note numbers; nothing cached applies
    io.send([FEAT, F_PADS, want]);
  }
  said(io, r);
}
/* Put what just happened on the screen. A button whose effect you cannot see is one you
   press twice to check, which on a toggle puts it back where it started. */
function said(io, r){
  if (!r || r.value == null || r.value === false) return;
  flash(io, r.name || "", String(r.value));
}

/* ---- the screen --------------------------------------------------------------
   Guide, "Controlling the screen". Configure a display once to say how many lines it has,
   then fill its fields with text. Both are SysEx, so both are silently skipped on a page
   that was not granted it — which is why nothing below returns a value anyone checks. */
const SCR_STATIONARY = 0x20;          // the display shown when nothing else is
const SCR_TEMP = 0x21;                // 33 — the global temporary display, ours to raise
const SCR_ENC0 = 0x15;                // 21 — encoder temp displays, same index as the CC
const ARR_2LINE = 1;                  // Parameter name over a text value
const ARR_3LINE = 2;                  // Title / Parameter name / Text value
/* ⚠️ THE ONE THE DEVICE USES FOR ITS OWN ARP PAGE: a title over a 2x4 grid of encoder
   names. It is what the Launchkey shows when it is driving its own encoders, so a profile
   that shows anything else has made the app a worse citizen of its own screen than the
   firmware is. Nine fields: 0 is the title, 1-8 are the names, left to right, top row
   first. */
const ARR_ENC8 = 3;
const ARR_NAME_VALUE = 4;             // Parameter name over a numeric value
const CFG_AUTO = 0x60;                // bits 5 and 6: let the device raise its own temps
const CFG_SHOW = 0x7F;                // "bring up the display with its current contents"

/* The screen takes ASCII 32-126 and reassigns four control codes for symbols it has. The
   instrument names on this page are full of characters it does not have — CS·1's middle
   dot, a flat sign in a chord name — so anything outside the range is folded rather than
   sent, since one bad byte truncates the whole string. */
function ascii(s, max){
  const out = [];
  String(s == null ? "" : s).split("").forEach(ch => {
    if (out.length >= (max || 16)) return;
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) out.push(c);
    else if (ch === "·") out.push(45);        // · in CS·1, PM·1 … → hyphen
    else if (ch === "♭") out.push(0x1D);      // ♭ → the device's own flat symbol
    else if (ch === "♯") out.push(35);        // ♯ → #
    /* ⚠️ A TYPOGRAPHIC MINUS IS NOT A HYPHEN. Panels are set with U+2212 because it lines up
       with digits; the screen has never heard of it, and "−2" arrived as " 2" — a value that
       read as positive on a control that only goes down. */
    else if (ch === "−" || ch === "–" || ch === "—") out.push(45);
    else out.push(32);
  });
  return out;
}

/* ---- detection ---------------------------------------------------------------- */

const isKey = p => /launchkey/i.test(p.name || "");
const isMk4 = p => /mk\s*4|mk4/i.test(p.name || "");
const isDaw = p => /daw/i.test(p.name || "");

function detect(inputs, outputs){
  const ins = inputs.filter(p => isKey(p) && isMk4(p));
  const outs = outputs.filter(p => isKey(p) && isMk4(p));
  if (!ins.length || !outs.length) return null;

  /* Novation names the second interface "DAW" on every platform this runs on. The
     positional fallback is for the case where it does not: the DAW interface is the second
     one the device enumerates, which is also what "MIDIIN2" means on Windows. */
  const ctrlIn = ins.find(isDaw) || (ins.length > 1 ? ins[1] : null);
  const ctrlOut = outs.find(isDaw) || (outs.length > 1 ? outs[1] : null);
  if (!ctrlIn || !ctrlOut) return null;
  const keysIn = ins.find(p => p.id !== ctrlIn.id) || null;

  return {
    ctrlIn: ctrlIn.id,
    ctrlOut: ctrlOut.id,
    keysIn: keysIn ? keysIn.id : null,
    /* The port name carries the key count — "Launchkey Mini MK4 37" — so the label the
       picker shows is the device's own word for itself rather than a guess. */
    label: (ctrlIn.name || "Launchkey MK4").replace(/\s*(daw|midi)\s*(in|out)?\s*$/i, "").trim()
  };
}

/* ---- session ------------------------------------------------------------------ */

/* ⚠️ BOTH HEADERS, EVERY TIME, rather than guessing which one this unit answers to.

   The two SKUs differ by one byte, and a device ignores a message addressed to a product it
   is not — silently, which is the whole problem. Everything else this profile sends is plain
   MIDI and works whatever the header would have been, so a wrong guess here produces exactly
   one symptom: the pads light, the encoders turn, the transport runs, and the screen stays
   dark. That is a long way to look for one byte.

   It was guessed from whether the port name contained "Mini", which is a fact about how a
   driver chose to spell itself and not a fact about the hardware. Sending both costs one
   extra message on a display that only updates when something changes, and cannot be
   wrong. */
function sysex(io, body){
  io.sendSysex(HDR_FULL.concat(body, [0xF7]));
  io.sendSysex(HDR_MINI.concat(body, [0xF7]));
}

function configureScreen(io){
  if (!io.sysex) return;
  /* The resting display is the encoder legend: which panel, and what the eight are. */
  sysex(io, [0x04, SCR_STATIONARY, CFG_AUTO | ARR_ENC8]);
  /* Each encoder's own display is arranged in paintEncoders, because which arrangement it
     wants depends on what is under it — a number the device can write itself, or a word only
     we know. */
  /* The global temporary display, for things that happen rather than things that are true.
     No auto bits: the device raises its own temps for the analogue controls, and this one
     is only ever raised deliberately by flash(). */
  sysex(io, [0x04, SCR_TEMP, ARR_2LINE]);
}

/* Put something on the screen NOW, over whatever is resting there, for the display timeout.

   ⚠️ THE RESTING DISPLAY IS NOT ENOUGH FOR AN EVENT. Pressing a button raises the device's
   own temporary display of that button's name, so anything the press changed on the resting
   lines is hidden behind it until the timeout expires — which is exactly the moment you
   wanted to be told. Answering a press with a temp display of our own is the only way the
   feedback arrives while the finger is still on the button. */
function flash(io, name, value){
  if (!io.sysex) return;
  sysex(io, [0x06, SCR_TEMP, 0].concat(ascii(name, 16)));
  sysex(io, [0x06, SCR_TEMP, 1].concat(ascii(value, 16)));
  sysex(io, [0x04, SCR_TEMP, CFG_SHOW]);
}

function start(io, rig){
  io.state = {
    padMode: PAD_DAW,
    fn: false,                         // Function held — the accent modifier
    fnUsed: false,                     // ...and whether it was used as one
    shift: false,                      // Shift held — the encoders' second eight
    act: false,                        // ">" held — a modifier while it is down, a button when it is not
    actUsed: false,                    // ...and whether it was used as one
    /* Where each encoder last reported itself, so a list can be moved by the CHANGE rather
       than by the value. Null means "no baseline yet" — the control under it just changed. */
    encAt: new Array(ENC_N).fill(null),
    scrub: 0,                          // which arrow is scrubbing the tape, if either
    /* Pads currently down, newest last. A range gesture needs to know what a finger is
       still holding, and note-on/note-off is the only place that is knowable. */
    down: [],
    pads: new Array(16).fill(-1),      // last colour SENT, so paint() can send only changes
    btns: {},
    encs: new Array(ENC_N).fill(-1),
    encNames: new Array(ENC_N).fill(""),
    encIds: new Array(ENC_N).fill(""),     // which control each encoder is on
    encText: new Array(ENC_N).fill(""),    // the value shown, for the ones that read as words
    encMode: new Array(ENC_N).fill(""),    // how that encoder's display is arranged
    /* Nine fields of the resting display: title, then the eight encoder names. */
    screen: ["", "", "", "", "", "", "", "", ""],
    inst: "",                          // the panel it is currently describing
    timeout: null,                     // the device's own display timeout, to be given back
    page: null,                        // null until the first paint, so connecting is not an "event"
    unload: null
  };

  io.send(DAW_ON);
  io.send(FEAT_ON);
  io.send([FEAT, F_PADS, PAD_DAW]);
  io.send([FEAT, F_ENCS, ENC_PLUGIN]);
  /* Take the drum rack too. Without this the hardware's own Drum layout keeps sending on
     the MIDI port, where DR·1 would still hear it — but its pads would stay whatever
     colour the device chose, and half the point of a profile is that the pads say what
     they will do before you hit them. */
  io.send([FEAT, F_DRUM, 1]);
  /* Ask before setting, so there is something to put back. The reply lands in message(). */
  io.send([FEAT_ASK, F_TIMEOUT, 0]);
  io.send([FEAT, F_TIMEOUT, TIMEOUT_TENTHS]);
  configureScreen(io);

  /* ⚠️ pagehide, not beforeunload: beforeunload does not fire on a tab restored from the
     back/forward cache on any browser this page runs in, and a Launchkey left in DAW mode
     is the failure this whole handler exists to prevent. */
  io.state.unload = () => { try{ stop(io); }catch(e){} };
  window.addEventListener("pagehide", io.state.unload);
}

function stop(io){
  if (io.state && io.state.unload){
    window.removeEventListener("pagehide", io.state.unload);
    io.state.unload = null;
  }
  /* Dark before leaving. The device keeps whatever it was last told, so a surface that
     exits without clearing leaves sixteen pads lit for an app that is no longer there. */
  for (let i = 0; i < 16; i++){
    io.send([LED_PAD_STATIC, cellNote(PAD_DAW, i), 0]);
    io.send([LED_DRUM_STATIC, cellNote(PAD_DRUM, i), 0]);
  }
  [B_PLAY, B_REC, B_ARROW_UP, B_ARROW_DN, B_ENC_UP, B_ENC_DN,
   B_TRACK_PREV, B_TRACK_NEXT, B_SCENE, B_FUNC].forEach(cc =>
    io.send([LED_BTN, cc, 0]));
  if (io.state) io.state.down.length = 0;
  /* Their timeout back, if we ever learned it. If the query went unanswered we leave ours
     rather than inventing a number — a wrong guess written to non-volatile memory is worse
     than a setting the user can see and change. */
  if (io.state && io.state.timeout != null) io.send([FEAT, F_TIMEOUT, io.state.timeout]);
  io.send([FEAT, F_DRUM, 0]);
  io.send(DAW_OFF);
}

/* ---- in ----------------------------------------------------------------------- */

function message(io, d, rig){
  if (!d || !d.length || !io.state) return;
  const st = d[0];

  /* The DAW port also carries the device's own clock and transport when it is running its
     arpeggiator. The page's clock is the page's; ignore all of it. */
  if (st >= 0xF0) return;

  const type = st & 0xF0, ch = st & 0x0F;

  /* ⚠️ ONE PLACE, ABOVE EVERYTHING. Func is a modifier the moment anything else happens while
     it is down — an encoder turned, a pad hit, an arrow pressed, Play — and every one of
     those is a message that arrives here. Marking it at each of the handlers that read
     io.state.fn is the same one-case patch to a class problem that let the encoder arrows
     fall through the feature channel: the next thing to grow a Func gesture would forget,
     and the symptom would be the panel quietly flipping face under it. */
  if (io.state.fn && !(type === 0xB0 && d[1] === B_FUNC)) io.state.fnUsed = true;

  /* Mode reports: the user pressed a pad-mode button on the hardware. Following it rather
     than forcing our own back is the difference between a profile and a fight. */
  if (st === FEAT){
    if (d[1] === F_PADS){
      io.state.padMode = d[2] === PAD_DRUM ? PAD_DRUM : PAD_DAW;
      io.state.pads.fill(-1);            // different note numbers; nothing cached applies
      io.state.down.length = 0;          // and nothing held under the old layout still is
      return;
    }
    /* ⚠️ THE DEVICE'S OWN ENCODER MODE PICKS WHAT THE ENCODERS ARE FOR. Shift and the Mixer
       pad is how a Launchkey has always said "these knobs are the desk now", so it says it
       here too — and the app has a desk. Anything else means the ordinary state: whichever
       panel has the focus. Nothing is invented; the surface honours a choice the hardware
       already offers rather than growing a mode of its own that the device knows nothing
       about and cannot light. */
    if (d[1] === F_ENCS){
      const to = ENC_VIEW[d[2]];
      /* A Custom mode is somebody else's; leave the app where it is rather than guessing. */
      if (to){ rig.setMode(to.page); rig.goto(to.view); }
      return;
    }
    /* ⚠️ SHIFT IS STATE AGAIN, and this time it earns it. It cannot be combined with another
       BUTTON — the device remaps those rather than passing a modifier — but it is reported
       here, and an ENCODER is not a button: turning one while Shift is down still sends its
       own CC. So the one thing Shift can modify is the eight knobs, which is exactly where a
       second handful of controls was wanted. */
    if (d[1] === F_SHIFT){ io.state.shift = d[2] > 0; return; }
    /* The answer to the query in start(). ⚠️ FIRST REPLY ONLY: the device may also confirm
       the value we then set, and capturing that would mean "restoring" our own setting and
       losing theirs for good. MIDI is ordered, so the first answer is the one we asked for. */
    if (d[1] === F_TIMEOUT){
      if (io.state.timeout == null) io.state.timeout = d[2];
      return;
    }
    /* ⚠️ A CHANNEL TEST IN A FILE THAT IGNORES CHANNELS, and it has now eaten two buttons.
       This branch used to end in a blanket `return` — "other feature reports are not ours"
       — which was true of feature reports and false of anything else that happens to arrive
       on channel 7. Shift was the first casualty and was patched one case at a time; the
       encoder arrows were the second, which is what a one-case patch to a whole-class
       problem buys you.

       So the surface's own buttons are let through wherever they arrive, and only the ones
       that would be ambiguous are not. `>` and Func are held back deliberately: 104 and 105
       are ALSO the decimal numbers of the Keys and Pads velocity-curve feature controls, so
       a velocity-curve report and a button press are the same three bytes and there is no
       way to tell them apart. Those two are read from the button channel only. */
    if (FEAT_THROUGH.indexOf(d[1]) < 0) return;
    /* and fall through to the buttons below */
  }

  /* ---- pads ---- */
  if (type === 0x90 || type === 0x80){
    const on = type === 0x90 && d[2] > 0;
    /* Drum layout: channel 10 or 11, see the note on the constants above. */
    if (ch === 9 || ch === 10){
      const i = noteCell(PAD_DRUM, d[1]);
      if (i < 0) return;
      /* ⚠️ THE NOTE NUMBER STOPS HERE. It says which pad was hit and nothing else — the
         kit is asked for its nth lane, not for whatever General MIDI calls note 45. The
         two orders are different (GM spells the bottom row BD RS SD CP CH LT OH HT; the
         panel lists BD SD CP LT HT CH OH RS) and the panel's is the one you can see. */
      if (on) rig.drumFire(i, d[2]);
      return;
    }
    if (ch !== 0) return;
    const i = noteCell(PAD_DAW, d[1]);
    if (i < 0) return;
    const g = rig.grid();
    const held = io.state.down;
    /* ⚠️ TRACKED WHETHER OR NOT THERE IS A GRID. A pad pressed while one panel is focused
       and released while another is would otherwise stay "down" forever, and the next press
       anywhere would read as a range from a pad nobody is touching. */
    if (on){ if (held.indexOf(i) < 0) held.push(i); }
    else { const k = held.indexOf(i); if (k >= 0) held.splice(k, 1); }
    if (!g) return;
    try{
      /* The grid is told what the press MEANS, not which button is down — `accent` rather
         than `fn`, `from` rather than "the pad before this one". A controller with two
         modifiers fills in more of this object and no instrument learns a new word. */
      if (on && g.down){
        const from = held.length > 1 ? held[held.length - 2] : null;
        g.down(i, d[2], {accent: io.state.fn, from});
      }
      else if (!on && g.up) g.up(i);
    }catch(e){}
    return;
  }

  /* ---- encoders and buttons ----
     ⚠️ THE CHANNEL IS NOT CHECKED, and that is deliberate rather than lazy. The guide gives
     channel 16 for the surface's control changes in standalone mode and prints the DAW-mode
     button table as a picture with no channel on it at all, so "channel 16" here was read
     across from the other section rather than stated. On a port that carries nothing but
     this device's own surface, CC 21-28 and the handful of button numbers below are unique
     whatever channel they arrive on — so matching the number and ignoring the channel is
     both safer and more honest than asserting a channel the document never gave. */
  if (type !== 0xB0) return;
  const cc = d[1], v = d[2];

  if (cc >= ENC_CC0 && cc < ENC_CC0 + ENC_N){
    /* Turning a knob while ">" is down is what makes it a modifier rather than a press. */
    if (io.state.act) io.state.actUsed = true;
    const list = rig.controls(layerHeld(io));
    const i = cc - ENC_CC0;
    const c = list[i];
    if (!c) return;
    /* ⚠️ A LIST MOVES BY DETENT, NOT BY POSITION. These encoders are endless but report an
       absolute 0-127, so a control with N positions used to need 127/N detents per step:
       sixty-four to flip a two-way segment, twenty-one for a four-way select. Bars, Monitor
       and Metronome on LP·1 were all reported as simply not working, and they were — you
       would have had to spin them most of a full sweep to see anything move.

       So the travel is read as a DIRECTION and the knob is re-centred afterwards. Centring is
       not tidiness: the device's own counter saturates at 0 and 127, and an encoder parked at
       either end stops reporting change in that direction — the control would work until it
       had been turned far enough one way and then be stuck for good. */
    if (typeof c.nudge === "function"){
      const was = io.state.encAt[i];
      io.state.encAt[i] = v;
      if (was == null || v === was) return;      // the first turn after a switch is a baseline
      try{ c.nudge(v > was ? 1 : -1); }catch(e){}
      io.send([CH_BTN, cc, ENC_MID]);
      io.state.encAt[i] = ENC_MID;
      io.state.encs[i] = ENC_MID;
      return;
    }
    if (typeof c.set !== "function") return;
    try{ c.set(v / 127); }catch(e){}
    /* Remember what we just heard so paint() does not immediately send the same value
       back and fight the hand that is still turning it. */
    io.state.encs[cc - ENC_CC0] = v;
    return;
  }

  /* Both are state, so both need the release as well as the press. Shift arrives twice —
     here and on the feature channel above — and either road sets the same flag. */
  if (cc === B_SHIFT){ io.state.shift = v > 0; return; }
  /* ⚠️ FUNC ACTS ON THE RELEASE, for the reason ">" does below: until then nobody knows it
     was a press at all. Held with anything else it is the modifier it has always been; let go
     having modified nothing and it turns the panel you are pointed at to its other face. A
     panel with only one face never sees it, and Func there is exactly what it was. */
  if (cc === B_FUNC){
    if (v > 0){
      io.state.fn = true;
      /* ⚠️ SPENT ON THE PRESS when ">" is already down, or the release would ALSO turn the
         panel to its other face — the Func message is the one thing the blanket rule at the
         top of message() cannot mark, because that rule is what stops Func marking itself. */
      io.state.fnUsed = !!io.state.act;
      if (io.state.act){ io.state.actUsed = true; jump(io, rig); }
      return;
    }
    io.state.fn = false;
    if (!io.state.fnUsed) said(io, rig.face());
    return;
  }
  /* ⚠️ ">" ACTS ON THE RELEASE, not the press, because until then nobody knows whether it was
     a press at all. Held with an encoder it is a layer; let go having moved nothing and it is
     the button it has always been. Acting on the press would fire the action every time you
     reached for the layer. */
  if (cc === B_SCENE){
    if (v > 0){
      io.state.act = true;
      /* ⚠️ Func + ">" hops a linked pair, and it is spent HERE so the release does not also
         fire whatever ">" means on this panel — return-to-zero on the mixer, Loop play/stop
         on LP·1. Either order: whichever of the two arrives second is the one that fires,
         which is what makes the gesture need only one of the two presses to reach us. */
      io.state.actUsed = !!io.state.fn;
      if (io.state.fn) jump(io, rig);
      return;
    }
    io.state.act = false;
    if (!io.state.actUsed) said(io, rig.act());
    return;
  }

  /* ---- the arrows beside the pads ----
     ⚠️ ALL OF IT LIVES HERE, above the press-only guard, because one of the four things
     they do is HELD and the guard would eat its release. Which arrow is down is remembered
     rather than re-derived: Func can be let go before the arrow is, and a tape that kept
     winding because the modifier changed under it would be the worst bug on this surface.

     Four meanings, and none of them overlap:

       plain   page the grid — and where there is nowhere to page, scrub FAST
       Func    scrub SLOW — and where there is nothing to scrub, walk the rack

     ⚠️ THE FALLTHROUGHS ARE WHAT MAKE THAT ONE RULE RATHER THAN FOUR. A panel has pages
     and no tape; the mixer has a tape and one page. Neither needs a mode, and neither
     button ever sits dead: whichever of the pair applies is the one that answers. */
  if (cc === B_ARROW_UP || cc === B_ARROW_DN){
    const dir = cc === B_ARROW_UP ? -1 : 1;
    if (!v){
      if (io.state.scrub === dir){ io.state.scrub = 0; rig.scrub(dir, false); }
      return;
    }
    if (io.state.scrub) return;              // one arrow at a time
    if (io.state.fn){
      if (rig.scrub(dir, true, "slow")) io.state.scrub = dir;
      else rig.step(dir);
      return;
    }
    if (rig.gridPageBy(dir)) return;
    if (rig.scrub(dir, true, "fast")) io.state.scrub = dir;
    return;
  }
  if (!v) return;                         // buttons report a release too; act on the press

  switch (cc){
    /* ⚠️ Play does the obvious thing and Func-Play does the other one — which of the two
       transports is obvious being the page's business, not this file's. See transport() in
       shell/surface.js. */
    case B_PLAY:  rig.transport(io.state.fn); break;
    /* Shift-Play on this device is not a modifier and a key — it is the Stop button, which
       is why it arrives here rather than at B_PLAY. */
    case B_STOP:  rig.stopAll(); break;
    /* ⚠️ Record belongs to the PAGE, and on a panel there is no page, so it still does
       nothing there. Capture into the armed scene row is what it would obviously mean and
       cannot be undone; a controller that overwrites a take on a stray thumb is worse than
       one that ignores a button. The mixer offers it, because rolling tape adds a take
       rather than replacing one — and Erase, the control that does throw a take away, is
       the deck's own and asks twice. Func-Record is panic, which is the thing you want to
       reach for without looking. */
    case B_REC:   if (io.state.fn) rig.panic(); else rig.record(); break;
    case B_LOOP:  break;
    /* The device's Track pair — what the same two arrows send under Shift. "Which track"
       is which panel here, so this is the Launchkey's own word for it honoured rather than
       reinvented, and it reaches the same place Func and the arrows do. */
    case B_TRACK_PREV: rig.step(-1); break;
    case B_TRACK_NEXT: rig.step(1); break;
    /* ⚠️ AND THE ARROWS BESIDE THE ENCODERS BELONG TO THE ENCODERS — the same rule as the
       pair beside the pads, applied to the other half of the surface. They move which eight
       the encoders point at, which on DR·1 means which drum and on PM·1 means which group
       of parameters. Neither fact is known here; see controlBanks() in shell/surface.js. */
    case B_ENC_UP: encArrow(io, rig, -1); break;
    case B_ENC_DN: encArrow(io, rig, 1); break;
  }
}

/* ---- out ---------------------------------------------------------------------- */

/* Everything below sends only what changed. The surface repaints sixteen pads, eight
   encoders and a screen every 60 ms; sending all of that every time would be roughly
   500 messages a second down a USB MIDI cable that has better things to do, and the
   device would render a flicker rather than a picture. */

function paintPads(io, rig){
  const s = io.state;
  const drum = s.padMode === PAD_DRUM;
  const stat = drum ? LED_DRUM_STATIC : LED_PAD_STATIC;
  const puls = drum ? LED_DRUM_PULSE : LED_PAD_PULSE;

  let cells = [];
  if (drum){
    /* The drum layout is DR·1's, wherever the focus is — see rig.drum. Asked note by note,
       so which pad carries note 38 stays a fact about this file. The eight voices DR·1 has
       happen to land on the bottom row and the top row comes back null, but that is the
       kit's shape rather than an assumption made here. */
    cells = new Array(16);
    for (let i = 0; i < 16; i++) cells[i] = rig.drumCell(i);
  } else {
    const g = rig.grid();
    try{ cells = g ? (g.cells() || []) : []; }catch(e){ cells = []; }
  }

  for (let i = 0; i < 16; i++){
    const c = cells[i] || null;
    const base = c ? hue(c.colour) : 0;
    const colour = !c ? 0 : (c.on ? base : dim(base));
    const pulse = !!(c && c.hot);
    /* The pulse channel and the static channel are two different messages to the same LED,
       so "which channel did we last use" is part of the cached state, not just the colour.
       Packing it into one number keeps the diff a single comparison. */
    const want = colour + (pulse ? 1000 : 0);
    if (s.pads[i] === want) continue;
    s.pads[i] = want;
    io.send([pulse ? puls : stat, cellNote(s.padMode, i), colour]);
  }
}

function paintButtons(io, rig){
  const s = io.state;
  const want = {};
  want[B_PLAY] = rig.rolling ? PAL.green : dim(PAL.green);
  /* Armed is the state you can forget you are in, and the one that decides whether the next
     thing you play is kept. Lit red for armed, dark for not — and never dim, because a
     record light that is only slightly on is a record light nobody trusts. */
  want[B_REC] = rig.armed ? PAL.red : 0;
  /* The arrows say whether there is anywhere to go — a 16-step pattern leaves both dark and
     a 64-step one lights the way you can move — and they change colour under Func to say
     they now mean panels rather than pages. A modifier you cannot see on a key cap should
     at least be visible in what it has changed. */
  const page = rig.gridPage(), pages = rig.gridPages();
  if (rig.canScrub && pages < 2){
    /* Nothing to page, so both arrows are the tape — sky rather than cyan, because they
       are moving something else now and a colour is the only warning of that. */
    want[B_ARROW_UP] = PAL.sky; want[B_ARROW_DN] = PAL.sky;
  } else if (io.state.fn){
    const many = rig.instruments.length > 1 ? PAL.white : 0;
    want[B_ARROW_UP] = many; want[B_ARROW_DN] = many;
  } else {
    want[B_ARROW_UP] = page > 0 ? dim(PAL.cyan) : 0;
    want[B_ARROW_DN] = page < pages - 1 ? dim(PAL.cyan) : 0;
  }
  /* The encoder arrows, like the pad arrows, say whether there is anywhere to go. An
     instrument with eight controls or fewer has one bank and leaves them dark. */
  const bank = rig.controlBank(), banks = rig.controlBanks().length;
  if (banks < 2 && rig.canBump){
    /* Nothing to page, so the pair is the panel's own pair — lit, and a different colour,
       because a familiar button doing something else should say so. */
    want[B_ENC_UP] = dim(PAL.spring); want[B_ENC_DN] = dim(PAL.spring);
  } else {
    want[B_ENC_UP] = bank > 0 ? dim(PAL.orchid) : 0;
    want[B_ENC_DN] = bank < banks - 1 ? dim(PAL.orchid) : 0;
  }
  /* ⚠️ Track shares its LEDs with the arrows on the hardware — they are the same two lamps —
     so writing a second colour to 102/103 would fight the page indicator for the same
     bulbs. Left alone deliberately. */
  /* Function lights while it is held, so a modifier you cannot see on the key cap is at
     least visible on it. ">" has no job yet and stays dark rather than inviting a press. */
  want[B_FUNC] = io.state.fn ? PAL.white : dim(PAL.white);
  want[B_SCENE] = rig.canAct ? dim(PAL.sky) : 0;
  Object.keys(want).forEach(cc => {
    if (s.btns[cc] === want[cc]) return;
    s.btns[cc] = want[cc];
    io.send([LED_BTN, +cc, want[cc]]);
  });
}

function paintEncoders(io, rig){
  const s = io.state;
  const list = rig.controls(layerHeld(io));
  for (let i = 0; i < ENC_N; i++){
    const c = list[i] || null;
    const id = c ? (c.id || "") : "";
    const arrived = s.encIds[i] !== id;         // a different control is under this knob
    s.encIds[i] = id;
    /* ⚠️ AND THE BASELINE GOES WITH IT. A list is moved by how far the knob turned since its
       last report, and "since" means nothing across a change of what the knob is pointed at —
       the first turn on the new control would jump by whatever the old one had left behind.

       For a list we park the knob mid-travel below and therefore KNOW where it is, so the
       baseline is that rather than nothing: an unknown baseline costs the first detent after
       every switch, which on a two-way segment is half the gesture. */
    if (arrived) s.encAt[i] = (c && typeof c.nudge === "function") ? ENC_MID : null;

    /* Position feedback. The guide's phrase for the absolute modes is "If the DAW sends
       them position information, they automatically pick that up" — which is what stops a
       parameter jumping the moment an encoder is touched after the focus moved to an
       instrument whose Cutoff sits somewhere else.

       ⚠️ NOT FOR A STEPPED CONTROL, EXCEPT ON ARRIVAL, and leaving that out made Steps and
       Rate almost immovable. Seven options means the position we send back is one of seven
       values; the knob moves a little, we round it to the same option, and push it straight
       back to where it started. The knob fights and loses. So a list gets its position once,
       when it lands under the encoder, and then the encoder is left to travel freely across
       the range — which is also why Key and Scale, with two dozen options each, were the
       two that seemed to work. */
    let v = 0;
    if (c && typeof c.nudge === "function") v = ENC_MID;   // parked, not positioned
    else if (c && typeof c.get === "function"){
      try{ v = Math.max(0, Math.min(127, Math.round(c.get() * 127))); }catch(e){ v = 0; }
    }
    /* ⚠️ ARRIVAL ALWAYS SENDS FOR A LIST, cache or no cache. The cache says what we last
       TOLD this encoder, and a knob the user has since spun is nowhere near it — parking it
       is the whole reason the baseline above can be trusted. */
    const push = !!c && (!c.stepped || arrived);
    const force = arrived && !!c && typeof c.nudge === "function";
    if (push && (force || s.encs[i] !== v)) io.send([CH_BTN, ENC_CC0 + i, v]);
    s.encs[i] = v;

    if (!io.sysex) continue;

    /* ⚠️ A NUMBER IS NOT ALWAYS THE ANSWER. Arrangement 4 lets the device write the value
       itself, which is right for Cutoff and useless for Scale — "84" tells you nothing about
       Phrygian. A control that can say what it is in words gets arrangement 1 instead, and
       we fill the value field too. Re-arranged only when the kind under the knob changes,
       because reconfiguring a display is not free. */
    const wantsText = !!(c && typeof c.text === "function");
    const mode = !c ? "" : (wantsText ? "t" : "n");
    if (s.encMode[i] !== mode){
      s.encMode[i] = mode;
      s.encText[i] = "\u0000";                   // force the value to be written afresh
      sysex(io, [0x04, SCR_ENC0 + i,
                 CFG_AUTO | (wantsText ? ARR_2LINE : ARR_NAME_VALUE)]);
    }
    const name = c ? (c.label || c.id || "") : "";
    if (s.encNames[i] !== name){
      s.encNames[i] = name;
      sysex(io, [0x06, SCR_ENC0 + i, 0].concat(ascii(name, 16)));
    }
    if (!wantsText) continue;
    let txt = "";
    try{ txt = String(c.text() == null ? "" : c.text()); }catch(e){ txt = ""; }
    if (s.encText[i] === txt) continue;
    s.encText[i] = txt;
    sysex(io, [0x06, SCR_ENC0 + i, 1].concat(ascii(txt, 16)));
  }
}

function paintScreen(io, rig){
  if (!io.sysex) return;
  const s = io.state;
  const f = rig.focus;
  const g = rig.grid();
  let sub = "";
  try{ sub = g && g.label ? (typeof g.label === "function" ? g.label() : g.label) : ""; }catch(e){}

  /* ⚠️ THE TITLE CARRIES THE BANK, because the eight names below cannot. On PM·1 they can —
     Cutoff and Reso say "Filter" between them — but on DR·1 every bank has the SAME eight
     names and only the drum changes, so a legend with no title would be identical for the
     kick and the snare. */
  /* Holding Shift retitles the legend, because the eight names under it have just been
     replaced and a legend that did not say so would look like the bank had changed by
     itself. Only where there IS a second eight — announcing one that does not exist would
     be worse than saying nothing. */
  const layer = layerHeld(io);
  const showing = layer && rig.hasLayer(layer) ? layer : "";
  const bankLabel = showing ? rig.layerName(showing) : rig.controlBankName();
  const inst = f ? f.name : "no panel";
  const want = [inst + (bankLabel ? "  " + bankLabel : "")];
  const list = rig.controls(showing);
  for (let i = 0; i < 8; i++){
    const c = list[i];
    want.push(c ? (c.short || c.label || c.id || "") : "");
  }
  const moved = s.inst !== inst;                // the focus changed on this pass
  s.inst = inst;
  /* ⚠️ THREE CHARACTERS, because the device does not pad — it packs. Four five-letter names
     across the row came out as `CutofResoEnvAmKeyTk`, one unbroken word, and the eye cannot
     find the boundaries. The row is about twenty characters wide whatever you put in it, so
     three letters and a space each is what leaves gaps between them. A control offers a
     `short` for this reason; the label is only a fallback and will be cut. */
  let wrote = false;
  for (let i = 0; i < 9; i++){
    if (s.screen[i] === want[i]) continue;
    s.screen[i] = want[i];
    sysex(io, [0x06, SCR_STATIONARY, i].concat(ascii(want[i], i === 0 ? 18 : 3)));
    wrote = true;
  }
  /* ⚠️ WRITING A FIELD IS NOT SHOWING IT. Setting text fills the display's memory; what is
     on the glass is whatever was last brought up. Trigger it once at connect and the legend
     appears and then never changes again however many fields are written under it — which
     is precisely what a real Launchkey did: the first panel's legend, frozen, while the app
     knew perfectly well the focus had moved. So the trigger goes with the write, every
     time, not once.

     7Fh is the guide's "bring up the display with its current contents", and it is a
     special value that leaves the arrangement alone. One extra message on a display that
     only changes when something else already has. */
  if (wrote) sysex(io, [0x04, SCR_STATIONARY, CFG_SHOW]);

  /* Paging is a press, so it gets a temp display. ⚠️ Not on the first paint, and not on the
     pass that changed panels: arriving at an instrument that happens to be parked on page 3
     is not the same event as pressing the button that put it there, and flashing "33-48"
     at somebody who just clicked a different panel is noise pretending to be feedback. */
  const page = rig.gridPage();
  const changed = s.page !== page;
  s.page = page;
  if (changed && !moved && s.inst && rig.gridPages() > 1) flash(io, "Steps", sub);

  /* ⚠️ NO FLASH FOR THE ENCODER BANK, and there used to be. Changing bank rewrites the
     legend — its title and all eight names — so the answer is already on the screen in more
     detail than a two-line temporary display could give, and raising one on top of it hid
     the very thing that had just become correct. Paging the steps is different and keeps
     its flash: the range is not in the legend, so without it nothing says which sixteen. */
}

function paint(io, rig){
  if (!io.state) return;
  paintPads(io, rig);
  paintButtons(io, rig);
  paintEncoders(io, rig);
  paintScreen(io, rig);
}

Patchwork.surface.register({
  id: "launchkey-mk4",
  name: "Novation Launchkey MK4",
  /* Optional, not required: the pads, encoders and transport are all plain MIDI. SysEx
     buys the screen and nothing else, so a refused permission costs a readout. */
  sysex: true,
  detect, start, stop, message, paint
});
})();
