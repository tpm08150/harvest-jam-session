
/* ============ ui ============ */

const stateEl = $("#loopState"), cutEl = $("#loopCut"), noteEl = $("#loopNote"),
      fillEl = $("#loopFill"), headEl = $("#loopHead"), meterEl = $("#inMeter"),
      recBtn = $("#rec"), dubBtn = $("#dub"), playBtn = $("#playStop"),
      takesEl = $("#loopTakes");
const clampf = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function say(msg, bad){
  noteEl.innerHTML = msg;
  noteEl.classList.toggle("err", !!bad);
}

const LABEL = {idle:"Empty", armed:"Armed", rec:"Recording", play:"Playing", dub:"Overdub"};

/* ---- the take strip ----
   One take per scene row, the same rows the live grid fires. Without this the panel had no
   way to say WHICH loop Record was about to fill, so it behaved like a one-loop pedal with
   a bank hidden behind it.

   Drawn in rows of eight, which is how MS·1, DR·1 and the shared step grid all settled on
   drawing sixteen: sixteen across is unhittable at a face's width, and eight is the widest
   run that stays countable without labels. */
const TAKES = Patchwork.scenes.rows.length;   // the launcher's rows, and the worklet's filled()
function buildTakes(){
  takesEl.textContent = "";
  for (let i = 0; i < TAKES; i++){
    const b = document.createElement("button");
    b.className = "take"; b.type = "button"; b.dataset.i = i;
    b.textContent = String(i + 1);
    takesEl.appendChild(b);
  }
}
buildTakes();

/* One state word per take, so the strip carries the whole picture: which hold a take,
   which one the transport is pointed at, and what that one is doing. The colours are the
   studio's — mint plays, yellow waits for a seam, red records — so a take reads the same
   here as its cell does in the launcher. */
function paintTakes(){
  const m = LP.mode;
  takesEl.querySelectorAll(".take").forEach(b => {
    const i = +b.dataset.i, sel = i === LP.slot;
    b.classList.toggle("has", hasSlot(i));
    b.classList.toggle("sel", sel);
    b.classList.toggle("on-play", sel && m === "play");
    b.classList.toggle("on-dub",  sel && m === "dub");
    b.classList.toggle("on-rec",  sel && m === "rec");
    b.classList.toggle("on-arm",  sel && m === "armed");
    /* the same wait the pads flash, on the screen, so the two views cannot disagree */
    b.classList.toggle("on-queued", i === LP.queued);
    b.title = "Take " + (i + 1) + " — scene row " + (i + 1)
            + (hasSlot(i) ? ", recorded" : ", empty");
  });
}

/* Selecting a take IS switching the looper to it: the worklet has one active buffer, so
   there is no such thing as pointing at slot 5 while slot 1 keeps playing. That makes the
   click the launcher's gesture — play what is there, fall silent where there is not —
   rather than a separate idea the panel would have to explain. fireSlot() sets the
   selection before it checks for a worklet, so this works on a panel that has recorded
   nothing yet, which is when you most need to say where the first take goes. */
takesEl.addEventListener("click", e => {
  const b = e.target.closest(".take"); if (!b) return;
  const i = +b.dataset.i;
  if (LP.mode === "rec" || LP.mode === "dub"){
    say("Finish or stop the take first — a pass in progress does not move rooms.", true);
    return;
  }
  /* armed and not yet started: re-aim it, which is the useful reading of the click */
  if (LP.mode === "armed"){ arm("rec", i); return; }
  fireSlot(i);
});

function paintState(){
  const m = LP.mode;
  stateEl.textContent = (m === "idle" && hasTake()) ? "Stopped" : (LABEL[m] || m);
  root.classList.toggle("recording", m === "rec" || m === "dub");
  root.classList.toggle("armed", m === "armed");
  root.classList.toggle("playing", m === "play" || m === "dub");
  playBtn.textContent = (m === "play" || m === "dub") ? "■ Stop" : "▶ Play";
  /* the switch and what it is doing are two facts: `on` is the latch, `dubbing` is a pass
     actually being layered right now, and before the first wrap you are in the first
     without being in the second */
  dubBtn.classList.toggle("on", LP.dubOn);
  /* ⚠️ ARMING WRITES THE LATCH from the preference, so the Overdub light has to be painted
     from LP.dubOn and not only from a click on it — and this row has to follow too, since a
     surface can move it without touching the panel. */
  $$("#loopAfter button").forEach(b => b.classList.toggle("on", b.dataset.a === LP.after));
  dubBtn.classList.toggle("dubbing", m === "dub");
  $$("#click button").forEach(b => b.classList.toggle("on", (b.dataset.c === "on") === Patchwork.click.on));
  cutEl.textContent = LP.bpmAtRecord ? (LP.bars + " bars · cut at " + LP.bpmAtRecord + " bpm") : "—";
  /* A loop cut at another tempo no longer fits the bar, and silently drifting is worse
     than being told. */
  const now = Patchwork.clock.bpm;
  cutEl.classList.toggle("bad", !!LP.bpmAtRecord && now !== LP.bpmAtRecord);
  paintTakes();
  /* the take strip and the launcher's LP·1 column are the same eight-and-eight facts, so
     whatever moved this has to reach the launcher too */
  if (Patchwork.record && Patchwork.record.changed) Patchwork.record.changed();
}

/* The playhead comes from the worklet's own position, not from a timer — a timer would
   show where the main thread thinks the loop is, which is not where it is.

   ARMED is the exception, because there is no position yet: the bar runs a COUNT-IN
   instead, filling towards the frame the take starts on, with the beats left written where
   the state word goes. The wait is the loop line, not the bar line — up to eight beats at
   four bars — and a still bar reading "Armed" was the single most confusing thing here. */
function paintLoop(){
  if (LP.mode === "armed" && LP.armedAt != null && ctx){
    const beat = 60 / (Patchwork.clock.bpm || 120);
    const left = Math.max(0, LP.armedAt - ctx.currentTime);
    const span = Math.max(beat, LP.bars * 4 * beat);
    const p = clampf(1 - left / span, 0, 1) * 100;
    fillEl.style.width = p + "%";
    headEl.style.left = p + "%";
    /* the state word is paintState's everywhere else; while counting in it is this loop's,
       because it changes every frame and paintState only runs on a mode change */
    stateEl.textContent = "In " + Math.max(1, Math.ceil(left / beat));
  } else if (LP.len > 0 && LP.mode !== "idle"){
    const p = (LP.pos / LP.len) * 100;
    fillEl.style.width = p + "%";
    headEl.style.left = p + "%";
  } else if (LP.mode === "idle"){
    fillEl.style.width = "0%"; headEl.style.left = "0%";
  }
  meterEl.style.width = Math.min(100, LP.peak * 140) + "%";
  requestAnimationFrame(paintLoop);
}
requestAnimationFrame(paintLoop);

recBtn.addEventListener("click", () => {
  if (LP.mode === "rec" || LP.mode === "armed") stopLoop();
  else arm("rec");
});
const takeName = () => "Take " + (LP.slot + 1);
/* A switch, with nothing to check. There is no "record something first" any more, because
   switching it on before a take is now the useful thing to do — it is the difference
   between pressing Overdub at the exact wrap and deciding in advance that this one layers. */
dubBtn.addEventListener("click", () => {
  setDub(!LP.dubOn);
  say(LP.dubOn
    ? "Overdub on — this take will keep layering at every pass. Flip it off to stop."
    : "Overdub off.");
});
/* The standing answer the latch above starts each new take from — see LP.after. */
$("#loopAfter").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  LP.after = b.dataset.a === "dub" ? "dub" : "once";
  $$("#loopAfter button").forEach(x => x.classList.toggle("on", x === b));
  say(LP.after === "dub"
    ? "New takes roll straight into overdub at the end of the first pass."
    : "New takes record one pass and then play it back.");
});
playBtn.addEventListener("click", () => {
  if (LP.mode === "play" || LP.mode === "dub") stopLoop();
  else if (hasTake()) play();
  else say(takeName() + " is empty. Pick a take that is lit, or record this one.", true);
});
/* ---- pushing a take to the jam ----
   Visible only in a session, because outside one there is nobody to push to. */
const pushBtn = $("#push");
pushBtn.addEventListener("click", async () => {
  const n = LP.slot;
  if (!hasTake()){ say(takeName() + " is empty — record it before pushing it.", true); return; }
  pushBtn.disabled = true;
  say("Pushing " + takeName() + "…");
  const r = await Patchwork.session.pushTake(n);
  pushBtn.disabled = false;
  say(r.ok
    ? takeName() + " pushed — " + Math.round(r.bytes / 1024) + " KB as " + r.kind
      + ". Everyone in the jam has it now."
    : "Could not push: " + r.why, !r.ok);
});
Patchwork.session.onChange(() => { pushBtn.hidden = !Patchwork.session.active; });

$("#undo").addEventListener("click", undo);
$("#clear").addEventListener("click", () => { const n = takeName(); clearLoop(); say(n + " cleared."); });
$("#clearAll").addEventListener("click", () => {
  if (!node){ say("Nothing recorded yet."); return; }
  allocate();                    // alloc is what empties the bank — see the worklet
  LP.filled = [];
  say("Every take cleared. The loop can be given a different length now.");
  paintState();
});

/* ⚠️ Re-lengthing empties the bank — a loop IS its sample count, so the worklet drops
   every slot on alloc. That used to happen silently on a stray change of this select,
   taking the takes with it. It is refused while anything is recorded, and Clear all is
   the way through. */
$("#bars").addEventListener("change", e => {
  const want = parseInt(e.target.value, 10);
  if (LP.filled.length){
    e.target.value = String(LP.bars);
    say("Changing the length would empty all " + LP.filled.length
      + " take" + (LP.filled.length > 1 ? "s" : "")
      + " — the loop is a fixed number of samples. <b>Clear all</b> first.", true);
    return;
  }
  LP.bars = want;
  if (node) allocate();
  paintState();
});

$("#click").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.click.set(b.dataset.c === "on");
  say(Patchwork.click.on
    ? "Click on. It is on its own strip, so it is never recorded into a take."
    : "Click off.");
});
Patchwork.click.onChange(paintState);

$("#mon").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  LP.monitorOn = b.dataset.m === "on";
  $$("#mon button").forEach(x => x.classList.toggle("on", x === b));
  if (monitor) monitor.gain.setTargetAtTime(LP.monitorOn ? 1 : 0, ctx.currentTime, .01);
});

const inSel = $("#inSel");
inSel.addEventListener("change", () => { LP.input = inSel.value; if (stream) openInput(LP.input); });

let devices = [];

/* The instruments this page actually has, as the input list should name them.

   ⚠️ LP·1 is filtered out, and it is the one entry that would break the feature rather
   than merely be useless: pointing the looper at its own strip is the feedback path the
   bus tap already names an exclusion to avoid, and it would build until it clips.

   Taken from what has REGISTERED rather than from a list written here, so an instrument
   added to a build appears without this file being told about it. */
function pageInstruments(){
  const S = window.Patchwork && Patchwork.scenes;
  if (!S || !S.instruments) return [];
  return S.instruments.filter(i => i.id !== "lp1" && i.name);
}
function instName(id){
  const it = pageInstruments().find(i => i.id === id);
  return it ? it.name : id;
}
function inputLabel(id){
  if (id === BUS) return "the studio output";
  const one = instOf(id);
  if (one) return instName(one);
  const d = devices.find(x => x.deviceId === id);
  return d && d.label ? d.label : (id ? "the selected input" : "the default input");
}

const option = (value, text) => Object.assign(document.createElement("option"),
  {value, textContent: text});

function buildInputs(){
  /* ⚠️ Restored from LP.input, not from inSel.value. The old line only put back DEVICE
     ids, so a rebuild — a headset appearing, say — silently dropped the selection back to
     the first option. That was invisible while "the first option" and "the only internal
     source" were the same thing, and stops being invisible the moment there are six. */
  const keep = LP.input;
  inSel.textContent = "";

  const here = document.createElement("optgroup");
  here.label = "From this page";
  here.appendChild(option(BUS, "Studio output"));
  pageInstruments().forEach(i => here.appendChild(option(INST + i.id, i.name + " only")));
  inSel.appendChild(here);

  /* Offered only when the browser has any, rather than listed and then apologised for on
     the one path that cannot work. */
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    const mics = document.createElement("optgroup");
    mics.label = "Microphone";
    mics.appendChild(option("", "Default microphone"));
    devices.forEach((d, i) => mics.appendChild(
      option(d.deviceId, d.label || ("Input " + (i + 1)))));
    inSel.appendChild(mics);
  }

  if ([].some.call(inSel.options, o => o.value === keep)) inSel.value = keep;
}

async function listInputs(){
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){
    try{
      const devs = await navigator.mediaDevices.enumerateDevices();
      devices = devs.filter(d => d.kind === "audioinput");
    }catch(e){}
  }
  buildInputs();
}
listInputs();
/* ⚠️ Again once the page has finished assembling. The instrument options come from what
   has registered, and this file happens to be built after every other instrument today —
   but that is parts.txt's business, not this file's, and an instrument listed below LP·1
   would otherwise be missing from the menu with nothing to explain why. A timeout of 0
   runs after every synchronous script on the page, whatever the order turns out to be. */
setTimeout(listInputs, 0);
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener("devicechange", listInputs);

/* The loop's level and the click's are the same control twice, so it is written once. */
/* A control surface reads and writes these the same way a pointer does — see the same
   registry in bs1/ui.js and the note about ranges beside it. These are already 0-1. */
const faderReg = {};
function mountFader(sel, get, set){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  faderReg[sel] = {get, set: v => { set(Math.max(0, Math.min(1, v))); paintF(); }};
  function paintF(){
    cap.style.left = (get() * 100) + "%";
    val.textContent = Math.round(get() * 100) + "%";
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      set(clampf((cx - r.left) / r.width, 0, 1));
      paintF();
    };
    move(e); el.classList.add("dragging");
    const up = () => { el.classList.remove("dragging");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  paintF();
  return paintF;
}
mountFader("#levelF", () => LP.level, v => {
  LP.level = v;
  if (node && node.__level) node.__level.gain.setTargetAtTime(v, ctx.currentTime, .01);
});
/* The click is loud on purpose — it has to cut through what you are playing to — so it
   gets its own level rather than riding the loop's. */
mountFader("#clickF", () => Patchwork.click.level, v => Patchwork.click.setLevel(v));

/* Space records, and only when this panel owns the keyboard. */
onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ recBtn.click(); e.preventDefault(); }
});

paintState();
/* ---- LP·1 on a control surface ----
   ⚠️ REGISTERED WITH surface.panel(), NOT WITH THE MIDI ROUTER. This instrument takes no
   notes, so it has no channel and never called Patchwork.midi.route() — which is where every
   other panel's adapters live, and therefore where the surface looked for them. Focus LP·1
   and the encoders went blank. Claiming a MIDI channel purely to be findable would be a lie
   about what the panel does; the other door is in shell/surface.js.

   ⚠️ AND THE PADS ARE THE SLOTS, WHICH ARE THE SCENE ROWS. A looper's takes are already
   addressed by row — recordSlot(n) and playSlot(n) are how the launcher fires them — so the
   grid is not a new idea about LP·1, it is the launcher's own column with sixteen pads under
   it instead of sixteen cells. Which also means a pad and the cell above it always agree. */
const LP_SHORT = [["#levelF", "Level", "Lvl"], ["#clickF", "Click", "Clk"]];
function surfaceControls(){
  const out = LP_SHORT.filter(c => faderReg[c[0]]).map(c => ({
    id: c[0].slice(1), label: c[1], short: c[2],
    get: () => faderReg[c[0]].get(),
    set: v => faderReg[c[0]].set(v)
  }));
  const bars = Patchwork.surface.option($("#bars"), "Bars", "Bar");
  const after = Patchwork.surface.segment($("#loopAfter"), "After", "Aft");
  const mon = Patchwork.surface.segment($("#mon"), "Monitor", "Mon");
  const click = Patchwork.surface.segment($("#click"), "Metronome", "Met");
  /* ⚠️ EIGHT, WITH A HOLE AT SEVEN. Input belongs beside the arrows because the arrows are
     what it puts within reach — pick an instrument here and the pair hops to it — and a
     control whose meaning is "the thing next to me" should not drift a position every time
     this panel grows a knob. A missing control is a dark encoder and a blank name, which is
     what an empty slot should look like. */
  const list = out.concat([bars, after, mon, click].filter(Boolean));
  while (list.length < 7) list.push(null);
  list.length = 7;
  list.push(inputControl());
  return list;
}

/* ---- what the looper is listening to ----
   ⚠️ NOT option(#inSel), which is the obvious thing and the wrong one. That select carries
   every microphone the browser will name — six on a laptop with a headset and a webcam
   plugged in — and turning past all of them to reach "Studio output" is not a knob, it is a
   penance. Under an encoder the only mic worth offering is the default one: the machine
   already has a notion of which input is yours, choosing between the others is a setup
   decision, and setup decisions belong on the page where you can read them.

   So this is the same list with the device rows collapsed to one, written THROUGH the select
   so the panel's own change handler runs and the two views cannot disagree. */
function inputChoices(){
  const outs = [{v: BUS, t: "Studio out"}];
  pageInstruments().forEach(i => outs.push({v: INST + i.id, t: i.name}));
  /* "" is the default-microphone row buildInputs() already writes — see it there. */
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    outs.push({v: "", t: "Mic"});
  return outs;
}
function inputControl(){
  const list = inputChoices();
  const at = () => {
    const i = list.findIndex(o => o.v === LP.input);
    return i < 0 ? 0 : i;
  };
  const last = Math.max(1, list.length - 1);
  const go = i => {
    const o = list[Math.max(0, Math.min(list.length - 1, i))];
    if (!o || o.v === LP.input) return;
    inSel.value = o.v;
    inSel.dispatchEvent(new Event("change", {bubbles: true}));
  };
  return {
    id: "inSel", label: "Input", short: "In", stepped: true,
    text: () => { const o = list[at()]; return o ? o.t : ""; },
    get: () => at() / last,
    set: v => go(Math.round(v * last)),
    nudge: d => go(at() + (d > 0 ? 1 : -1))
  };
}

/* ⚠️ SLOT 1 IS THE TOP-LEFT PAD, and it was the bottom-left one. Cell 0 is bottom-left —
   that is the surface's contract — so a grid read from the top has to say so, and this one
   did not: the takes ran up the hardware while the list ran down the screen. The launcher
   already does the same arithmetic for the same reason (a scene list is an arrangement going
   down the page), and these slots ARE the scene rows, so it is the same conversion. */
const slotCell = c => (c < 8 ? c + 8 : c - 8);

const surfaceGrid = {
  label: () => "Loops",
  cells: () => {
    const out = new Array(16).fill(null);
    /* ⚠️ "Armed" is not playing. The same rule boot.js gives the launcher: a slot about to
       start on the bar line is queued, not live, and drawing it as live would light a pad
       for a loop nobody can hear yet. */
    const live = (LP.mode === "idle" || LP.mode === "armed") ? -1 : LP.slot;
    for (let i = 0; i < 16; i++){
      const has = hasSlot(i);
      if (!has && live !== i && LP.queued !== i) continue;   /* empty is dark, not dim */
      /* ⚠️ FLASHING GREEN IS "COMING", SOLID GREEN IS "PLAYING", and the pad has to say both
         or the gesture looks broken. A take fires at the next loop line, which at four bars
         is up to eight beats away — press a pad, get nothing at all for that long, and the
         only reading available is that the pad does not work. Same colour, because it is the
         same take; the flashing is the wait, and it stops the instant it lands. */
      out[slotCell(i)] = LP.queued === i ? {colour: "green", on: true, hot: true}
                       : live === i      ? {colour: "green", on: true}
                                         : {colour: "cyan", on: false};
    }
    /* Recording is the one state you must be able to see from across a room. */
    if (LP.mode === "rec" || LP.mode === "dub"){
      const i = LP.slot;
      if (i >= 0 && i < 16) out[slotCell(i)] = {colour: "red", on: true, hot: true};
    }
    return out;
  },
  /* A pad with a take plays it; an empty one records into it. Both through the same calls
     the launcher makes, so a pad and the cell above it cannot mean different things. */
  down: (cell, vel, mods) => {
    const i = slotCell(cell);
    /* ⚠️ FUNC EMPTIES IT, AND THERE IS NO UNDO. A take is audio and clearing one frees the
       buffer, so this is the only destructive gesture on these pads — which is exactly why
       it is the one that needs a second hand on the surface. An empty slot is left alone
       rather than armed: a modifier that falls through to "record" on a miss would turn a
       fumbled delete into a live take. */
    if (mods && mods.accent){ if (hasSlot(i)) clearSlot(i); return; }
    if (hasSlot(i)) queueSlot(i); else arm("rec", i);
  }
};

/* ---- LP·1 on a MIDI channel ----
   ⚠️ IT TAKES NO NOTES AND IT STILL WANTS A CHANNEL, which is the distinction that kept this
   panel off the router for so long. A looper has no pitch to play — that is why it registered
   with surface.panel() instead — but "no pitch" is not "no MIDI": a take you can fire from a
   sequencer, a foot pedal or another machine is the difference between a looper you drive by
   hand and one that is part of a rig.

   So the notes are SLOTS rather than pitches. Sixteen from the root up, one per take, laid
   out like the pads and the scene rows they already are — press one and it plays if it holds
   a take, records if it does not, exactly as the pad does. Nothing new to learn and nothing
   new to keep in step, because it is the same call.

   The root is C1, low enough to sit under anything you would actually play. */
const LP_ROOT = 24;
const LP_MIDI = {inCh: -1};
function onMidi(e){
  const d = e.data, s = d[0];
  if (s >= 0xF0) return;
  if (LP_MIDI.inCh >= 0 && (s & 0x0F) !== LP_MIDI.inCh) return;
  const type = s & 0xF0;
  if (type === 0xB0 && (d[1] === 120 || d[1] === 123)){ stopLoop(); return; }
  if (type !== 0x90 || !d[2]) return;                 // a slot fires on the press
  const i = d[1] - LP_ROOT;
  if (i < 0 || i > 15) return;
  if (hasSlot(i)) queueSlot(i); else arm("rec", i);
}
if (navigator.requestMIDIAccess && window.isSecureContext){
  Patchwork.midi.route("lp1", onMidi, function(){}, {
    name: "LP\u00b71",
    panic: () => stopLoop(),
    inCh: {get: () => LP_MIDI.inCh, set: c => { LP_MIDI.inCh = c; }}
  });
  Patchwork.midi.open().catch(() => {});
}

if (window.Patchwork && Patchwork.surface){
  Patchwork.surface.panel("lp1", {
    name: "LP\u00b71",
    controls: surfaceControls,
    grid: surfaceGrid,
    /* ⚠️ RECORD IS THE OVERDUB SWITCH HERE, not an arm. Everywhere else on this surface
       Record arms a track so that playing writes to its grid; a looper has no grid to write
       to and the thing you reach for mid-loop is whether this pass layers. The light follows
       the latch, so the button says what it is about to do. */
    record: () => { setDub(!LP.dubOn); return true; },
    get armed(){ return LP.dubOn; },
    /* ⚠️ THE PANEL THIS ONE IS RECORDING, when that is a panel at all. Declared here because
       this is the only end that knows — see linked() in shell/surface.js, which reads it from
       both. Null for the studio bus and for a microphone: there is nowhere to hop to. */
    link: () => instOf(LP.input),
    /* The deck's own Play/Stop, so whatever it does when clicked happens here too. */
    actionName: "Loop",
    action: () => {
      const b = $("#playStop");
      if (!b || b.disabled) return null;
      b.click();
      return b.textContent.trim();
    }
  });
}


