
/* ============ engine ============ */

let ctx = null, out = null, node = null, monitor = null, inGain = null,
    stream = null, src = null, ready = false;

/* The sentinel for "the studio's own output" in the input list. */
const BUS = "__bus";

const LP = {
  bars: 2,                  // loop length, in bars of the shell's grid
  monitorOn: true,
  level: .9,
  input: "__bus",           // device id, or __bus for the studio's own output
  mode: "idle",             // idle | armed | rec | play | dub
  dubOn: false,             // the overdub LATCH — see setDub()
  pos: 0, len: 0, peak: 0,
  slot: 0, filled: [],      // one take per scene row — see the live page

  bpmAtRecord: null,        // the tempo the loop was cut at — see the note in the panel
  /* The audio time the armed take starts on, so the panel can count it in. "Armed" with
     no idea how long you are waiting is the state that made this thing feel unpredictable:
     the seam is the LOOP line, up to eight beats away at four bars, and a still bar with
     one small word on it tells you none of that. */
  armedAt: null
};

function initAudio(useCtx){
  if (ctx) return;
  ctx = useCtx || Patchwork.audio.context();
  out = useCtx ? ctx.destination : Patchwork.audio.strip("lp1");
  inGain = ctx.createGain(); inGain.gain.value = 1;
  monitor = ctx.createGain(); monitor.gain.value = LP.monitorOn ? 1 : 0;
  monitor.connect(out);
}

/* addModule takes a URL, so the processor source becomes a Blob. Nothing is fetched and
   the app stays one file. */
let modulePromise = null;
function loadWorklet(){
  if (modulePromise) return modulePromise;
  const url = URL.createObjectURL(new Blob([LOOP_WORKLET], {type: "text/javascript"}));
  modulePromise = ctx.audioWorklet.addModule(url)
    .then(() => { URL.revokeObjectURL(url); ready = true; })
    .catch(e => { modulePromise = null; throw e; });
  return modulePromise;
}

async function ensureNode(){
  initAudio();
  Patchwork.audio.resume();
  if (node) return node;
  if (!ctx.audioWorklet){
    say("This browser has no AudioWorklet, so the looper can't record.", true);
    return null;
  }
  await loadWorklet();
  node = new AudioWorkletNode(ctx, "pw-looper", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
  });
  const lvl = ctx.createGain(); lvl.gain.value = LP.level;
  node.connect(lvl); lvl.connect(out);
  node.__level = lvl;
  inGain.connect(node);
  node.port.onmessage = e => onWorklet(e.data);
  allocate();
  /* the latch is the panel's, not the node's — a node built after it was switched on has
     to be told, or the switch would silently mean nothing until you flipped it twice */
  if (LP.dubOn) node.port.postMessage({op: "dub", on: true});
  return node;
}

/* Loop length is fixed in SAMPLES at the moment you arm, from the tempo then. That is how
   hardware loopers behave and it is the honest choice: the audio cannot stretch, so a
   tempo change afterwards means the loop no longer fits the bar. The panel shows the
   tempo the loop was cut at for exactly that reason. */
function loopFrames(){
  const bpm = Patchwork.clock.bpm || 120;
  return Math.max(1, Math.round(LP.bars * 4 * (60 / bpm) * ctx.sampleRate));
}
function allocate(){
  if (!node) return;
  LP.len = loopFrames();
  node.port.postMessage({op: "alloc", frames: LP.len});
  LP.bpmAtRecord = null;
  setMode("idle");
}

/* ---- sharing a take ----
   Pulled out of the worklet, encoded, and pushed by hand. NOT automatically: a take is
   private until you decide it is worth other people hearing, which is the whole difference
   between a looper you can experiment on and one you perform into. */
let grabWait = null;
function grabTake(slot){
  return new Promise(resolve => {
    if (!node) return resolve(null);
    grabWait = resolve;
    node.port.postMessage({op: "grab", slot: slot | 0});
    setTimeout(() => { if (grabWait){ grabWait = null; resolve(null); } }, 3000);
  });
}
/* ⚠️ A received take has to bring its own LENGTH. The receiving browser may never have
   touched its looper — no worklet, no allocation, this.len still zero — and the load would
   land in a bank with no room in it and do nothing at all, silently. The take's own frame
   count is the honest source: it is what the room is already looping to. */
async function loadTake(slot, chans, meta){
  if (!chans || !chans.length) return;
  const n = await ensureNode();
  if (!n) return;
  if (!LP.len){
    LP.len = chans[0].length;
    if (meta && meta.bars) LP.bars = meta.bars;
    const barsSel = $("#bars"); if (barsSel) barsSel.value = String(LP.bars);
  }
  /* the tempo it was CUT at, not ours — the panel warns when the two disagree, and it
     should be warning about the take that exists rather than one we never made */
  LP.bpmAtRecord = (meta && meta.bpm) || LP.bpmAtRecord || Patchwork.clock.bpm || 120;
  loadingTake = true;
  n.port.postMessage({op: "load", slot: slot | 0, len: chans[0].length,
                      ch0: chans[0], ch1: chans[1] || chans[0]});
  /* never leave the guard up if the worklet never answers */
  setTimeout(() => { loadingTake = false; }, 3000);
  paintState();
}

function onWorklet(m){
  if (m.ev === "take"){
    const fn = grabWait; grabWait = null;
    if (fn) fn(m.empty ? null : [m.ch0, m.ch1]);
    return;
  }
  if (m.filled){
    LP.filled = m.filled;
    if (m.filled.length) loadingTake = false;      // it landed
    releaseLength();
  }
  if (m.slot != null) LP.slot = m.slot;
  if (m.ev === "pos"){ LP.pos = m.pos; LP.len = m.len; LP.peak = m.peak; return; }
  if (m.ev === "slots"){ paintState(); return; }
  if (m.ev === "started" || m.ev === "looped"){ setMode(m.mode); }
}

function setMode(mode){
  LP.mode = mode;
  if (mode !== "armed") LP.armedAt = null;
  paintState();
}

/* The length is committed only while a take exists. An arm cancelled before it recorded,
   or the last take cleared, leaves the bank free to be given a different number of bars —
   which is otherwise refused, because re-lengthing empties every slot. */
/* ⚠️ Not while a pushed take is on its way in. ensureNode() allocates, and an allocation
   answers with an empty `filled` — which this reads as "no takes, so no committed length"
   and uses to drop the tempo the arriving take was cut at. The flag covers exactly the
   window between setting that tempo and the take landing; it cost three attempts to see,
   because the take itself always arrived correctly and only the drift warning was wrong. */
let loadingTake = false;
function releaseLength(){
  if (loadingTake) return;
  if (LP.mode === "idle" && !LP.filled.length) LP.bpmAtRecord = null;
}

/* ---- input ---- */
async function openInput(deviceId){
  initAudio();
  /* Recording the studio itself rather than a microphone. On a jam tool this is the more
     useful of the two — capture the band, then overdub over it — and it needs no
     permission, no headphones and no feedback risk, because the tap excludes this
     instrument's own strip. */
  if (deviceId === BUS){
    closeInput();
    /* the metronome's strip is excluded too — a click on the bus prints into every take */
    /* the metronome's strip and the talkback's are excluded too — a click or a voice on
       the bus would be printed into every take from then on */
    src = Patchwork.audio.tap(["lp1", Patchwork.click.STRIP, Patchwork.talk.STRIP]);
    src.connect(inGain);
    stream = BUS;                   // "an input is open", without a MediaStream
    say("Recording the <b>studio output</b> — everything the other instruments play, but "
      + "not this looper, so an overdub cannot record itself.");
    return true;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    say("This browser can't open an audio input.", true);
    return false;
  }
  closeInput();
  try{
    /* Same three flags off as the vocoder, and for the same reason: echo cancellation and
       noise suppression are built to remove exactly the signal being recorded, and AGC
       rides the level of a take you wanted flat. */
    stream = await navigator.mediaDevices.getUserMedia({audio:{
      deviceId: deviceId ? {exact: deviceId} : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false
    }});
    src = ctx.createMediaStreamSource(stream);
    src.connect(inGain);
    inGain.connect(monitor);
    say("Listening on <b>" + inputLabel(deviceId) + "</b>. <b>Use headphones</b> — an open "
      + "microphone into speakers will record its own output and build until it howls.");
    return true;
  }catch(e){
    say("Couldn't open that input (" + ((e && e.name) || e) + ").", true);
    return false;
  }
}
function closeInput(){
  if (src){ try{ src.disconnect(); }catch(e){} src = null; }
  if (stream && stream !== BUS){
    stream.getTracks().forEach(t => { try{ t.stop(); }catch(e){} });
  }
  stream = null;
}

/* ---- transport ----
   Arming schedules the mode change for an exact sample rather than applying it now, so a
   take starts on the bar line however early or late the button was pressed. That is the
   same seam the scene launcher fires on, and it comes from the same place. */
/* `slot` is the scene row. Recording into a row and firing a row are the same gesture the
   rest of the studio uses, so the looper joins the launcher rather than sitting beside it
   with a transport of its own. */
async function arm(mode, slot){
  const n = await ensureNode();
  if (!n) return;
  if (slot != null) LP.slot = slot | 0;
  if (!stream && (mode === "rec" || mode === "dub")){
    const ok = await openInput(LP.input);
    if (!ok) return;
  }
  if (mode === "rec" && !LP.bpmAtRecord){
    /* the length is fixed by the first take; later rows record at the same length, or the
       rows would be different lengths and the launcher could not fire them together */
    allocate();
    /* the same fallback loopFrames() uses. Nothing calls clock.onTempo in a standalone
       looper — no instrument is there to set a tempo — so this was recording a null, and
       the readout said "—" for a loop that had in fact been cut at 120. */
    LP.bpmAtRecord = Patchwork.clock.bpm || 120;
  }
  const at = Patchwork.clock.claim(LP.bars * 4);
  n.port.postMessage({op: "at", mode: mode, slot: LP.slot,
                      frame: Math.round(at * ctx.sampleRate)});
  setMode("armed");
  LP.armedAt = at;               // after setMode, which clears it for every other mode
  paintState();
}
function stopLoop(){
  if (!node) return;
  node.port.postMessage({op: "now", mode: "idle"});
  setMode("idle");
  /* cancelling an arm before it recorded committed no length, and no worklet message is
     coming to say so — this transition is entirely ours */
  releaseLength();
}
/* ---- overdub, as a switch ----
   It used to be a scheduled mode like record: press it, wait for a boundary, and the take
   restarted from the top. As a latch it is three things at once, which is what makes it
   feel like one thing: set it BEFORE a take and the first pass rolls into dubbing at the
   wrap; flip it while playing and it punches in where you are; flip it off and it punches
   out. The worklet never moves `pos` for any of them.

   Opening the input is why this is async. Overdub needs a live input exactly as record
   does, and that used to come free because both went through arm(). */
async function setDub(on){
  LP.dubOn = !!on;
  if (LP.dubOn){
    const n = await ensureNode();
    if (!n){ LP.dubOn = false; paintState(); return; }
    if (!stream){
      const ok = await openInput(LP.input);
      if (!ok){ LP.dubOn = false; paintState(); return; }
    }
  }
  if (node) node.port.postMessage({op: "dub", on: LP.dubOn});
  paintState();
}

function play(slot){
  if (!node) return;
  if (slot != null) selectSlot(slot);
  node.port.postMessage({op: "now", mode: "play", reset: true});
  setMode("play");
}
/* Fire a row FROM THE LAUNCHER, at the next loop line rather than on the click — which is
   what the launcher promises for everything else, and what is written on the page: nothing
   lands until the next loop point.

   One message covers both halves of the rule. Posting `play` for a slot with no take leaves
   the worklet's buf null, and `mode = this.buf ? next.mode : "idle"` drops it to idle — so
   "a row with nothing for this instrument falls silent" happens on the same seam, for free,
   rather than as a second scheduled message that could land a frame apart from the first.

   `reset` is what makes it start at the TOP. Without it a scheduled change keeps the loop's
   current position, which is right for punching overdub in and wrong for firing a scene. */
function queueSlot(i){
  if (!node) return;
  const at = Patchwork.clock.claim(LP.bars * 4);
  /* The slot rides on the SAME message, so it changes on the same frame the mode does. A
     separate op:"slot" would switch buffers now and cut the take that is still playing out
     the rest of this bar. */
  node.port.postMessage({op: "at", mode: "play", slot: i | 0, reset: true,
                         frame: Math.round(at * ctx.sampleRate)});
  /* LP.slot is deliberately NOT moved here. It follows the worklet's `started` message at
     the seam, so between the press and the loop line the strip and the launcher keep
     ringing the take you can actually still hear. An optimistic update would light the new
     row while the old one is sounding, which is the one thing the ring is for. */
}

/* Fire a row on LP·1's OWN panel: immediate, the way an instrument's own Play button is.
   The launcher is the quantised surface; a panel is direct manipulation.

   Silence is the honest answer for an empty row — it should not keep the previous row's
   playing under it.

   ⚠️ The SELECTION is set before the no-node bail, and has to be. On a panel that has not
   recorded anything yet there is no worklet, and bailing first made every take click a
   no-op — you would pick take 4, press Record, and fill take 1. Choosing where the first
   take goes is exactly the moment there is nothing to play. */
function fireSlot(i){
  selectSlot(i);
  if (!node) return;
  if (hasSlot(i)) play();
  else stopLoop();
}
function selectSlot(i){
  LP.slot = i | 0;
  if (node) node.port.postMessage({op: "slot", i: LP.slot});
  paintState();                  // the take strip has to follow, however it was moved
}
function hasSlot(i){ return LP.filled.indexOf(i | 0) >= 0; }
/* Does the slot the transport is pointed at hold anything? Play and Overdub used to ask
   `bpmAtRecord`, which is one flag for the whole bank — so once ANY take existed, Play on
   an empty slot reported "Playing" and put out silence. */
function hasTake(){ return hasSlot(LP.slot); }
function clearLoop(){
  if (!node) return;
  node.port.postMessage({op: "clear"});
  setMode("idle");
}
/* Empty one row's take. The LENGTH survives — bpmAtRecord stays — because the other rows
   are still that long and a bank of mixed lengths could not be fired together.

   ⚠️ Only the take you removed stops. `op:"clear"` acts on the worklet's CURRENT slot, so
   emptying another row means selecting it first — and this used to leave the selection
   there and go idle unconditionally, which stopped whatever you were hearing. Deleting
   row 4 killed row 1's loop. The pattern instruments follow the same rule from the other
   side: clearing a cell you are not playing out of is housekeeping, not a transport
   gesture.

   Armed still stops. The arm was scheduled against a slot, and the selection has just
   been moved off it to reach the one being wiped — letting that fire would record into
   the row you deleted. */
function clearSlot(i){
  if (!node) return;
  const n = i | 0, was = LP.slot;
  const running = LP.mode === "play" || LP.mode === "dub" || LP.mode === "rec";
  selectSlot(n);
  node.port.postMessage({op: "clear"});
  if (running && was !== n) selectSlot(was);
  else setMode("idle");
}
function undo(){
  if (!node) return;
  node.port.postMessage({op: "undo"});
}
