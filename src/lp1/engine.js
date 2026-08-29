
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
  pos: 0, len: 0, peak: 0,
  bpmAtRecord: null         // the tempo the loop was cut at — see the note in the panel
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

function onWorklet(m){
  if (m.ev === "pos"){ LP.pos = m.pos; LP.len = m.len; LP.peak = m.peak; return; }
  if (m.ev === "started" || m.ev === "looped"){ setMode(m.mode); }
}

function setMode(mode){
  LP.mode = mode;
  paintState();
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
    src = Patchwork.audio.tap("lp1");
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
async function arm(mode){
  const n = await ensureNode();
  if (!n) return;
  if (!stream && (mode === "rec" || mode === "dub")){
    const ok = await openInput(LP.input);
    if (!ok) return;
  }
  if (mode === "rec"){
    allocate();
    LP.bpmAtRecord = Patchwork.clock.bpm;
  }
  const at = Patchwork.clock.claim(LP.bars * 4);
  n.port.postMessage({op: "at", mode: mode, frame: Math.round(at * ctx.sampleRate)});
  setMode("armed");
  paintState();
}
function stopLoop(){
  if (!node) return;
  node.port.postMessage({op: "now", mode: "idle"});
  setMode("idle");
}
function play(){
  if (!node) return;
  node.port.postMessage({op: "now", mode: "play", reset: true});
  setMode("play");
}
function clearLoop(){
  if (!node) return;
  node.port.postMessage({op: "clear"});
  LP.bpmAtRecord = null;
  setMode("idle");
}
function undo(){
  if (!node) return;
  node.port.postMessage({op: "undo"});
}
