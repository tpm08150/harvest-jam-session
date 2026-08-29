
/* Audio, small enough to send.

   The looper is the one thing in this studio that is not reducible to state. A pattern is a
   few hundred bytes and a patch is a few dozen; a two-bar take at 48k stereo is 1.5 MB of
   Float32, which is not something to put on a wire once, let alone every time somebody likes
   a take.

   ENCODE TO OPUS when the browser has WebCodecs, which is ~50 KB for those two bars at
   96 kbps — thirty times smaller, and inaudibly so for a loop. Fall back to 16-bit PCM
   where it does not, because half size and definitely-works beats thirty times smaller and
   maybe. The fallback is not a nicety: WebCodecs' AudioEncoder is still missing from some
   browsers this app otherwise runs in perfectly.

   ⚠️ EVERYTHING HERE IS BASE64 at the edge, because the relay speaks text frames and
   nothing else. That is a third larger than the bytes it carries, which is a real cost and
   still leaves Opus far ahead of raw. Teaching the relay binary frames is the obvious
   improvement and is worth doing the day something bigger than a loop needs to travel. */
Patchwork.codec = (() => {
"use strict";

const hasWebCodecs = typeof AudioEncoder !== "undefined" && typeof AudioDecoder !== "undefined";

/* ---- base64, in chunks ----
   String.fromCharCode.apply with a whole megabyte of bytes overflows the argument list and
   throws — a failure that looks like the encoder breaking on large takes only. */
function toBase64(bytes){
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(out);
}
function fromBase64(s){
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---- the fallback: 16-bit PCM ----
   Interleaved, because it is going straight back out as one blob and de-interleaving on
   arrival is cheaper than carrying two arrays through base64. */
function pcmEncode(chans){
  const n = chans[0].length, ch = chans.length;
  const out = new Int16Array(n * ch);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++){
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out[i * ch + c] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
  return new Uint8Array(out.buffer);
}
function pcmDecode(bytes, ch, frames){
  const src = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const out = [];
  for (let c = 0; c < ch; c++) out.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < ch; c++) out[c][i] = src[i * ch + c] / 0x8000;
  return out;
}

/* ---- Opus ----
   Every Opus packet is a key frame, so each encoded chunk is self-contained and the wire
   format is just their lengths and their bytes. */
function packChunks(chunks){
  let total = 0;
  chunks.forEach(c => { total += 4 + c.length; });
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let o = 0;
  chunks.forEach(c => { view.setUint32(o, c.length); o += 4; out.set(c, o); o += c.length; });
  return out;
}
function unpackChunks(bytes){
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let o = 0;
  while (o + 4 <= bytes.length){
    const n = view.getUint32(o); o += 4;
    if (o + n > bytes.length) break;
    out.push(bytes.subarray(o, o + n)); o += n;
  }
  return out;
}

/* Opus runs at 48k and takes 20 ms frames. Anything else is resampled by the encoder, but
   the FRAME SIZE is ours to get right: feeding it ragged lengths produces chunks that
   decode to a different total than they went in as, and a loop that is a few samples short
   is a loop that drifts a little further out of the bar on every pass. */
const FRAME = 960;                                   // 20 ms at 48 kHz

async function encode(chans, sampleRate){
  const frames = chans[0].length, ch = chans.length;
  if (!hasWebCodecs) return {kind: "pcm", sampleRate, ch, frames, data: toBase64(pcmEncode(chans))};

  const packets = [];
  let fail = null;
  const enc = new AudioEncoder({
    output: c => { const b = new Uint8Array(c.byteLength); c.copyTo(b); packets.push(b); },
    error: e => { fail = e; }
  });
  try{
    enc.configure({codec: "opus", sampleRate, numberOfChannels: ch, bitrate: 96000});
    /* one planar block per 20 ms, padded at the end so the last frame is whole */
    for (let off = 0; off < frames; off += FRAME){
      const n = Math.min(FRAME, frames - off);
      const flat = new Float32Array(FRAME * ch);
      for (let c = 0; c < ch; c++) flat.set(chans[c].subarray(off, off + n), c * FRAME);
      enc.encode(new AudioData({
        format: "f32-planar", sampleRate, numberOfFrames: FRAME, numberOfChannels: ch,
        timestamp: Math.round(off / sampleRate * 1e6), data: flat
      }));
    }
    await enc.flush();
    enc.close();
  }catch(e){ fail = e; try{ enc.close(); }catch(e2){} }

  /* Anything at all wrong and it goes as PCM. A take that arrives large is a take that
     arrived; a take that fails to encode is silence nobody can explain. */
  if (fail || !packets.length)
    return {kind: "pcm", sampleRate, ch, frames, data: toBase64(pcmEncode(chans))};
  return {kind: "opus", sampleRate, ch, frames, data: toBase64(packChunks(packets))};
}

async function decode(p){
  const bytes = fromBase64(p.data);
  if (p.kind === "pcm") return pcmDecode(bytes, p.ch, p.frames);

  const out = [];
  for (let c = 0; c < p.ch; c++) out.push(new Float32Array(p.frames));
  let wrote = 0, fail = null;
  const dec = new AudioDecoder({
    output: d => {
      const n = Math.min(d.numberOfFrames, p.frames - wrote);
      if (n > 0){
        const tmp = new Float32Array(d.numberOfFrames);
        for (let c = 0; c < p.ch; c++){
          d.copyTo(tmp, {planeIndex: c, format: "f32-planar"});
          out[c].set(tmp.subarray(0, n), wrote);
        }
        wrote += n;
      }
      d.close();
    },
    error: e => { fail = e; }
  });
  try{
    dec.configure({codec: "opus", sampleRate: p.sampleRate, numberOfChannels: p.ch});
    unpackChunks(bytes).forEach((b, i) => dec.decode(new EncodedAudioChunk({
      type: "key", timestamp: Math.round(i * FRAME / p.sampleRate * 1e6), data: b
    })));
    await dec.flush();
    dec.close();
  }catch(e){ fail = e; try{ dec.close(); }catch(e2){} }
  if (fail) return null;
  return out;
}

return {encode, decode, get opus(){ return hasWebCodecs; }};
})();
