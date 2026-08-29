
/* Talkback.

   Voices, between the people playing. Not an instrument and not a take — nobody wants to
   hear "shall we try it slower?" printed into bar three for the rest of the session.

   ⚠️ IT HAS ITS OWN STRIP, AND THE LOOPER EXCLUDES IT. The looper records a sum of every
   strip except the ones it names, and a voice on the bus would be captured into every take
   from then on. That is the same reason the metronome got a strip of its own; talkback is
   the second instance of the same rule, which is what makes it a rule.

   ---

   WHY THIS IS NOT WEBRTC. It could be, and one day it might be: peer connections would take
   the voices off the relay and shave the round trip. What they would also take is a second
   transport to configure, a second thing to debug when a laptop cannot hear another, and a
   signalling path that runs over this relay anyway. Opus over the socket that is already
   open and already carrying the jam is a fraction of the code and fails in one place
   instead of two. Talking is not playing: nobody needs their voice sample-aligned.

   FRAMES ARE BATCHED, three to a message. One 20 ms Opus frame is about sixty bytes, and a
   JSON envelope and a base64 pass around sixty bytes is mostly envelope. Three costs 60 ms
   of latency and cuts the message rate to seventeen a second.

   ⚠️ THE RECEIVER KEEPS ITS OWN PLAYHEAD. Scheduling each arriving frame at "now" would put
   every network hiccup into the audio as a click. `nextAt` runs ahead of the clock by a
   small lead and each frame is scheduled where the last one ended; when it falls behind —
   a gap, a stall, a tab that was hidden — it resets rather than trying to catch up, because
   catching up on speech means playing it faster and that is worse than a dropout. */
Patchwork.talk = (() => {
"use strict";

const STRIP = "talk";
const RATE = 48000;
const FRAME = 960;              // 20 ms at 48 kHz, Opus's own frame
const BATCH = 3;                // frames per message
const LEAD = .08;               // seconds of jitter buffer

let on = false, stream = null, reader = null, enc = null, gain = null;
let pending = [], seq = 0;
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

/* one decoder and one playhead per person talking */
const voices = new Map();       // peer id -> {dec, nextAt}

function out(){
  const ctx = Patchwork.audio.context();
  if (!gain){
    gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(Patchwork.audio.strip(STRIP));
  }
  return ctx;
}

/* ---- speaking ---- */
async function start(){
  if (on) return {ok: true};
  if (typeof AudioEncoder === "undefined" || typeof MediaStreamTrackProcessor === "undefined")
    return {ok: false, why: "this browser cannot encode audio for talkback"};
  try{
    stream = await navigator.mediaDevices.getUserMedia({audio: {
      /* echo cancellation and noise suppression STAY ON here, unlike everywhere else in
         this app. The vocoder and the looper turn them off because they are recording a
         signal; this is a voice in a room with speakers in it, and without them everyone
         hears themselves back through everyone else. */
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      channelCount: 1, sampleRate: RATE
    }});
  }catch(e){ return {ok: false, why: "no microphone: " + (e && e.name || e)}; }

  out();
  pending = []; seq = 0;
  enc = new AudioEncoder({
    output: c => {
      const b = new Uint8Array(c.byteLength);
      c.copyTo(b);
      pending.push(b);
      if (pending.length >= BATCH) flush();
    },
    error: () => stop()
  });
  enc.configure({codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: 24000});

  const track = stream.getAudioTracks()[0];
  reader = new MediaStreamTrackProcessor({track}).readable.getReader();
  on = true;
  notify();
  pump();
  return {ok: true};
}

async function pump(){
  while (on && reader){
    let r;
    try{ r = await reader.read(); }catch(e){ break; }
    if (r.done) break;
    try{ if (enc && enc.state === "configured") enc.encode(r.value); }catch(e){}
    r.value.close();
  }
}

function flush(){
  if (!pending.length) return;
  const frames = pending;
  pending = [];
  let total = 0;
  frames.forEach(f => { total += 2 + f.length; });
  const buf = new Uint8Array(total), view = new DataView(buf.buffer);
  let o = 0;
  frames.forEach(f => { view.setUint16(o, f.length); o += 2; buf.set(f, o); o += f.length; });
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  if (Patchwork.session) Patchwork.session.talk(btoa(bin), seq++);
}

function stop(){
  on = false;
  try{ if (reader) reader.cancel(); }catch(e){}
  reader = null;
  try{ if (enc && enc.state !== "closed") enc.close(); }catch(e){}
  enc = null;
  if (stream){ stream.getTracks().forEach(t => { try{ t.stop(); }catch(e){} }); stream = null; }
  pending = [];
  notify();
}

/* ---- listening ---- */
function heard(from, b64){
  const ctx = out();
  Patchwork.audio.resume();
  let v = voices.get(from);
  if (!v){
    v = {dec: null, nextAt: 0};
    v.dec = new AudioDecoder({
      output: d => {
        const n = d.numberOfFrames;
        const buf = ctx.createBuffer(1, n, d.sampleRate || RATE);
        d.copyTo(buf.getChannelData(0), {planeIndex: 0, format: "f32-planar"});
        d.close();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        /* behind the clock means the stream stalled: start a fresh lead rather than
           firing everything that queued up at once */
        if (v.nextAt < ctx.currentTime + .01) v.nextAt = ctx.currentTime + LEAD;
        src.start(v.nextAt);
        v.nextAt += n / (d.sampleRate || RATE);
      },
      error: () => {}
    });
    try{ v.dec.configure({codec: "opus", sampleRate: RATE, numberOfChannels: 1}); }
    catch(e){ return; }
    voices.set(from, v);
  }
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  let o = 0;
  while (o + 2 <= bytes.length){
    const n = view.getUint16(o); o += 2;
    if (o + n > bytes.length) break;
    try{
      v.dec.decode(new EncodedAudioChunk({
        type: "key", timestamp: 0, data: bytes.subarray(o, o + n)
      }));
    }catch(e){}
    o += n;
  }
}

function forget(id){
  const v = voices.get(id);
  if (v){ try{ v.dec.close(); }catch(e){} voices.delete(id); }
}

return {start, stop, heard, forget, STRIP,
        toggle: () => (on ? (stop(), Promise.resolve({ok: true})) : start()),
        onChange: fn => subs.push(fn),
        get on(){ return on; },
        get supported(){ return typeof AudioEncoder !== "undefined"
                             && typeof MediaStreamTrackProcessor !== "undefined"; }};
})();
