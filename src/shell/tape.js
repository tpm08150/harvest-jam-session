
/* ---- the tape machine ----
   A stereo recorder listening to the last node before the speakers, so what lands on the
   tape is the performance as the room heard it: every instrument, the mix you set, and
   whatever the punch rack was doing while you played.

   ⚠️ THE OPPOSITE CHOICE FROM LP·1, DELIBERATELY. The looper taps each instrument
   pre-fader so a loop it prints can be re-mixed afterwards — a take that is going to be
   played back INSIDE the session must not have your monitor balance baked into it. This is
   the other kind of recording entirely: a record of what happened, which is worth nothing
   if it leaves out the stutter you threw in the last bar. See bus.js's monitor().

   ⚠️ IT IS A REEL, NOT A BUFFER, and that is a feature rather than an apology. Five minutes
   of 48 kHz stereo is 57 MB held as 16-bit and 115 MB again as floats the moment you press
   play; an unbounded recorder in a browser tab is a tab that dies twenty minutes into a jam
   with no warning and nothing saved. A reel that visibly runs out is the honest version of
   the same limit, and it is what the machine it looks like actually did. */
Patchwork.tape = (() => {
"use strict";

const REEL_SECONDS = 300;           // five minutes a side
const BLOCK = 4096;                 // frames per message: ~12 a second rather than 375

/* ⚠️ SIXTEEN BIT AT THE WORKLET, not floats kept and converted at the end. Halves both the
   thread traffic and everything held, and it is the depth a WAV export would land on
   anyway — converting later would only mean carrying twice the memory to arrive at the
   same file. Clamped, because a master bus can and does go past full scale, and a wrapped
   sample is a click where a pinned one is a machine being driven hard. */
const SRC = `
class TapeRec extends AudioWorkletProcessor {
  static get parameterDescriptors(){
    return [{name: "rec", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate"}];
  }
  constructor(){
    super();
    this.n = 4096;
    this.buf = new Int16Array(this.n * 2);
    this.i = 0;
    this.was = 0;
    this.clip = 0;
  }
  flush(){
    if (!this.i) return;
    const out = this.buf.slice(0, this.i * 2);
    this.port.postMessage({frames: this.i, pcm: out, clip: this.clip}, [out.buffer]);
    this.clip = 0;
    this.buf = new Int16Array(this.n * 2);
    this.i = 0;
  }
  process(inputs, outputs, params){
    const on = params.rec[0] > .5;
    if (!on){
      if (this.was) this.flush();
      this.was = 0;
      return true;
    }
    this.was = 1;
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const L = inp[0], R = inp[1] || inp[0];
    for (let k = 0; k < L.length; k++){
      let l = L[k], r = R[k];
      if (l > 1 || l < -1 || r > 1 || r < -1) this.clip = 1;
      if (l > 1) l = 1; else if (l < -1) l = -1;
      if (r > 1) r = 1; else if (r < -1) r = -1;
      this.buf[this.i * 2] = l * 32767;
      this.buf[this.i * 2 + 1] = r * 32767;
      this.i++;
      if (this.i === this.n) this.flush();
    }
    return true;
  }
}
registerProcessor("tape-rec", TapeRec);
`;

let ctx = null, node = null, mon = null, sink = null, repro = null, ready = null;
let recGain = null;
let rate = 48000;

/* The tape itself: a list of Int16 blocks and how many frames are on it. A list rather than
   one growing buffer, because growing one means reallocating and copying 57 MB while audio
   is running through the same thread. */
let blocks = [], frames = 0;
let head = 0;                        // where the transport is, in frames
let recAt = 0, startedAt = 0;        // ctx time recording started, and from where
let playing = null;                  // the BufferSource, while playing back
let playAt = 0, playFrom = 0;
let cached = null;                   // the AudioBuffer built for playback
let level = .85, recLevel = 1, clipped = false;
let state = "stop";                  // stop | rec | play | rew
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const capacity = () => Math.floor(REEL_SECONDS * rate);

async function build(){
  if (ready) return ready;
  ready = (async () => {
    ctx = Patchwork.audio.context();
    rate = ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([SRC], {type: "application/javascript"}));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, "tape-rec",
      {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]});
    node.port.onmessage = e => {
      const d = e.data;
      if (!d || !d.pcm || state !== "rec") return;
      if (d.clip && !clipped){ clipped = true; notify(); }
      const room = capacity() - frames;
      if (room <= 0){ stop(); return; }
      if (d.frames > room){
        blocks.push(d.pcm.subarray(0, room * 2));
        frames += room;
        head = frames;               // ⚠️ or the counter reads wherever it was before
        stop();                      // the reel ran out; the machine stops itself
        return;
      }
      blocks.push(d.pcm);
      frames += d.frames;
      head = frames;
      if (frames >= capacity()) stop();
    };
    mon = Patchwork.audio.monitor();
    /* ⚠️ A RECORD LEVEL, because the master really does run past full scale — DR·1 alone
       peaks around +6 dBFS at its defaults, and the recorder clamps. Without this the only
       fix for a distorted take is remixing the whole session. It sits between the monitor
       and the tape, so backing it off changes what is printed and NOT what you hear, which
       is the same split a real deck has. */
    recGain = ctx.createGain();
    recGain.gain.value = recLevel;
    mon.connect(recGain);
    recGain.connect(node);
    /* ⚠️ A worklet nothing pulls is a worklet that never runs. It has no audible output —
       process() leaves its channels at zero — but it has to be connected to something the
       destination reaches or the graph never asks it for a block, and the tape stays blank
       with every other sign saying it is recording. */
    sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);
    /* ⚠️ THE REPRO HEAD GOES STRAIGHT TO THE SPEAKERS, past master and past the punch rack.
       A tape monitored through the bus it was recorded from is one the recorder would
       happily print onto itself, and one you could accidentally put a filter sweep on a
       second time. One persistent node rather than a gain per take, so the meters have
       something to watch between takes and setLevel always has somewhere to write. */
    repro = ctx.createGain();
    repro.gain.value = level;
    repro.connect(ctx.destination);
    return node;
  })();
  return ready;
}

function setRec(on){
  if (!node) return;
  node.parameters.get("rec").setValueAtTime(on ? 1 : 0, ctx.currentTime);
}

/* ---- the transport ---- */
async function record(){
  if (state === "rec") return;
  stopPlayback();
  await build();
  Patchwork.audio.resume();
  /* ⚠️ RECORDING TRUNCATES AT THE HEAD, which is what pressing record on a machine parked
     mid-tape does. Rewind first for a fresh take; stop and record again to carry on from
     where you were. Anything past the head is gone, and that is the same bargain the
     machine this looks like makes. */
  if (head < frames) trimTo(head);
  cached = null;
  clipped = false;
  recAt = ctx.currentTime;
  startedAt = frames / rate;
  state = "rec";
  setRec(true);
  notify();
}

function stop(){
  if (state === "stop") return;
  if (state === "rec"){ setRec(false); state = "stop"; }
  else { stopPlayback(); state = "stop"; }
  notify();
}

async function play(){
  if (state === "play") return;
  if (state === "rec") stop();
  if (!frames || head >= frames) return;
  await build();
  Patchwork.audio.resume();
  const buf = toBuffer();
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(repro);
  src.onended = () => {
    if (playing !== src) return;
    head = frames;
    playing = null;
    state = "stop";
    notify();
  };
  playFrom = head;
  playAt = ctx.currentTime;
  src.start(0, head / rate);
  playing = src;
  state = "play";
  notify();
}

function stopPlayback(){
  if (!playing) return;
  const s = playing;
  playing = null;
  head = clamp(Math.round(playFrom + (ctx.currentTime - playAt) * rate), 0, frames);
  try{ s.onended = null; s.stop(); }catch(e){}
}

/* Rewind is animated by whoever is drawing the reels — this only says where the head is. */
function seek(f){
  head = clamp(Math.round(f), 0, frames);
  notify();
}
function rewind(){
  stop();
  state = "rew";
  notify();
}
function rewindDone(){
  if (state === "rew") state = "stop";
  head = 0;
  notify();
}

function erase(){
  stop();
  blocks = [];
  frames = 0;
  head = 0;
  cached = null;
  notify();
}

/* ⚠️ Trimming walks the blocks rather than flattening and slicing, so cutting a take at the
   head costs one partial block instead of a copy of the whole reel. */
function trimTo(f){
  const keep = [];
  let n = 0;
  for (const b of blocks){
    const len = b.length / 2;
    if (n + len <= f){ keep.push(b); n += len; continue; }
    if (n < f){ keep.push(b.subarray(0, (f - n) * 2)); n = f; }
    break;
  }
  blocks = keep;
  frames = n;
  head = n;
  cached = null;
}

/* ---- reading the tape back ---- */
function toBuffer(){
  if (cached) return cached;
  if (!frames) return null;
  const buf = ctx.createBuffer(2, frames, rate);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let i = 0;
  for (const b of blocks){
    const len = b.length / 2;
    for (let k = 0; k < len; k++){
      L[i] = b[k * 2] / 32768;
      R[i] = b[k * 2 + 1] / 32768;
      i++;
    }
  }
  cached = buf;
  return buf;
}

/* A WAV rather than anything cleverer: it is the format every editor on every machine
   opens, it is what the samples already are, and it needs no library. */
function wav(){
  if (!frames) return null;
  const bytes = frames * 4;
  const out = new ArrayBuffer(44 + bytes);
  const v = new DataView(out);
  const put = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  put(0, "RIFF"); v.setUint32(4, 36 + bytes, true); put(8, "WAVE");
  put(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, bytes, true);
  let off = 44;
  for (const b of blocks){
    for (let k = 0; k < b.length; k++){ v.setInt16(off, b[k], true); off += 2; }
  }
  return new Blob([out], {type: "audio/wav"});
}

/* Where the head is RIGHT NOW, in seconds. While something is running this is worked out
   from the audio clock rather than from a counter something has to remember to tick —
   which is also why it stays right when a tab is throttled and the paint loop is not. */
function position(){
  /* ⚠️ While recording this runs off the audio clock, NOT off frames/rate. The worklet
     posts a block every ~85 ms, so a counter fed by what has arrived sits up to a tenth of
     a second behind and the reels visibly stutter forward in steps. */
  if (state === "rec" && ctx) return Math.min(REEL_SECONDS, startedAt + (ctx.currentTime - recAt));
  if (state === "play" && ctx && playing)
    return clamp(playFrom / rate + (ctx.currentTime - playAt), 0, frames / rate);
  return head / rate;
}
return {record, stop, play, rewind, rewindDone, erase, seek, wav, toBuffer,
        get repro(){ return repro; },
        onChange: fn => subs.push(fn),
        prime: () => build(),
        get reelSeconds(){ return REEL_SECONDS; },
        get recorded(){ return frames / (rate || 48000); },
        get position(){ return position(); },
        get state(){ return state; },
        get level(){ return level; },
        get recLevel(){ return recLevel; },
        get clipped(){ return clipped; },
        get meterPoint(){ return recGain; },
        setRecLevel(v){
          recLevel = clamp(+v || 0, 0, 2);
          if (recGain) recGain.gain.value = recLevel;
          notify();
        },
        setLevel(v){
          level = clamp(+v || 0, 0, 1.5);
          if (repro) repro.gain.value = level;
          notify();
        },
        get sampleRate(){ return rate; }};
})();
