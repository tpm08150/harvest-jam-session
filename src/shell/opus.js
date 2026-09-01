
/* ---- Opus, for the takes that leave this machine ----
   A five-minute stereo take is 57 MB as WAV and about 5 MB as Opus at 128k. That ratio is
   the difference between seventeen takes fitting in a free Supabase tier and two hundred.

   ⚠️ WebCodecs, NOT MediaRecorder. MediaRecorder only records a live stream, so encoding a
   finished take means playing it through a MediaStreamDestination at wall-clock speed — a
   five-minute take costs five minutes. AudioEncoder does the same job in a few seconds
   because nothing has to be played. The price is that WebCodecs hands back bare Opus
   packets with no container, so the Ogg framing below is ours to write.

   ⚠️ THE MUXER IS VERIFIED BY ROUND TRIP, not by reading the spec twice. A subtly wrong
   page CRC or granule position produces a file that plays in one decoder and not another,
   which is the kind of bug that only shows up on somebody else's machine. encode() output
   is decoded back through the browser's own decoder in the tests. */
Patchwork.opus = (() => {
"use strict";

const RATE = 48000;                  // Ogg Opus is always 48k, whatever went in
const FRAME = 960;                   // 20 ms at 48k — one Opus packet
const BITRATE = 128000;
/* libopus looks ahead 312 samples at 48k. Those are encoder priming and the decoder throws
   them away; the number has to be in the header or every file starts 6.5 ms late. */
const PRESKIP = 312;

const available = () => typeof AudioEncoder !== "undefined";

/* ---- Ogg framing ---- */
const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++){
  let r = i << 24;
  for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? (((r << 1) ^ 0x04c11db7) >>> 0) : ((r << 1) >>> 0);
  CRC[i] = r >>> 0;
}
/* ⚠️ NOT the usual zlib CRC32. Ogg uses the same polynomial with no input or output
   reflection and no final xor — feeding it a reflected implementation produces pages every
   decoder rejects, and it is the single easiest thing to get wrong here. */
function crc32(b){
  let c = 0;
  for (let i = 0; i < b.length; i++) c = (((c << 8) >>> 0) ^ CRC[((c >>> 24) ^ b[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

function page(serial, seq, headerType, granule, packets){
  /* segment table: a packet of length L is L/255 bytes of 255 then L%255 */
  const segs = [];
  packets.forEach(p => {
    let n = p.length;
    while (n >= 255){ segs.push(255); n -= 255; }
    segs.push(n);
  });
  const body = packets.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(27 + segs.length + body);
  const dv = new DataView(buf.buffer);
  buf[0] = 79; buf[1] = 103; buf[2] = 103; buf[3] = 83;   // "OggS"
  buf[4] = 0;
  buf[5] = headerType;
  /* granule is 64-bit; takes stay far under 2^32 samples (that is 24 hours) but write the
     high word properly anyway rather than leaving it zero by accident */
  dv.setUint32(6, granule >>> 0, true);
  dv.setUint32(10, Math.floor(granule / 4294967296), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  dv.setUint32(22, 0, true);                              // CRC, filled in below
  buf[26] = segs.length;
  buf.set(segs, 27);
  let off = 27 + segs.length;
  packets.forEach(p => { buf.set(p, off); off += p.length; });
  dv.setUint32(22, crc32(buf), true);
  return buf;
}

function opusHead(channels, inRate){
  const b = new Uint8Array(19);
  const dv = new DataView(b.buffer);
  b.set([79,112,117,115,72,101,97,100], 0);               // "OpusHead"
  b[8] = 1;                                               // version
  b[9] = channels;
  dv.setUint16(10, PRESKIP, true);
  dv.setUint32(12, inRate, true);                         // original rate, informational
  dv.setInt16(16, 0, true);                               // output gain
  b[18] = 0;                                              // mapping family 0
  return b;
}
function opusTags(){
  const vendor = new TextEncoder().encode("harvest-jam");
  const b = new Uint8Array(8 + 4 + vendor.length + 4);
  const dv = new DataView(b.buffer);
  b.set([79,112,117,115,84,97,103,115], 0);               // "OpusTags"
  dv.setUint32(8, vendor.length, true);
  b.set(vendor, 12);
  dv.setUint32(12 + vendor.length, 0, true);              // no user comments
  return b;
}

/* Opus only speaks 48k. Anything else is resampled first rather than lied about in the
   header — an input-rate field does not make a 44.1k stream decode as one. */
async function at48k(buffer){
  if (buffer.sampleRate === RATE) return buffer;
  const frames = Math.ceil(buffer.duration * RATE);
  const off = new OfflineAudioContext(Math.min(2, buffer.numberOfChannels), frames, RATE);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

async function encode(buffer, onProgress){
  if (!available()) throw new Error("This browser cannot encode Opus.");
  const buf = await at48k(buffer);
  const ch = Math.min(2, buf.numberOfChannels);
  const total = buf.length;
  const L = buf.getChannelData(0);
  const R = ch > 1 ? buf.getChannelData(1) : L;

  const packets = [];
  let err = null;
  const enc = new AudioEncoder({
    output: c => {
      const d = new Uint8Array(c.byteLength);
      c.copyTo(d);
      packets.push(d);
    },
    error: e => { err = e; },
  });
  enc.configure({codec: "opus", sampleRate: RATE, numberOfChannels: ch, bitrate: BITRATE});

  /* Fed one 20 ms frame at a time so the packet count and the granule positions stay in
     step with each other by construction rather than by arithmetic afterwards. */
  const plane = new Float32Array(FRAME * ch);
  for (let i = 0; i < total; i += FRAME){
    const n = Math.min(FRAME, total - i);
    plane.fill(0);
    for (let k = 0; k < n; k++){
      plane[k] = L[i + k];
      if (ch > 1) plane[FRAME + k] = R[i + k];
    }
    enc.encode(new AudioData({
      format: "f32-planar", sampleRate: RATE, numberOfFrames: FRAME,
      numberOfChannels: ch, timestamp: Math.round(i / RATE * 1e6),
      data: plane,
    }));
    if (onProgress && (i / FRAME) % 200 === 0) onProgress(i / total);
    if (err) break;
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  if (!packets.length) throw new Error("The encoder produced nothing.");

  /* ---- pages ---- */
  const serial = (Math.random() * 0xffffffff) >>> 0;
  const out = [];
  let seq = 0;
  out.push(page(serial, seq++, 2, 0, [opusHead(ch, buffer.sampleRate)]));   // BOS
  out.push(page(serial, seq++, 0, 0, [opusTags()]));

  /* The last page's granule trims the encoder's tail padding, so the file is exactly as
     long as what went in rather than rounded up to the next 20 ms. */
  const last = total + PRESKIP;
  let done = 0, batch = [], segs = 0;
  for (let i = 0; i < packets.length; i++){
    const need = Math.floor(packets[i].length / 255) + 1;
    if (segs + need > 255){
      done += batch.length;
      out.push(page(serial, seq++, 0, Math.min(done * FRAME, last), batch));
      batch = []; segs = 0;
    }
    batch.push(packets[i]); segs += need;
  }
  done += batch.length;
  out.push(page(serial, seq++, 4, Math.min(done * FRAME, last), batch));    // EOS
  if (onProgress) onProgress(1);
  return new Blob(out, {type: "audio/ogg"});
}

return {encode, get available(){ return available(); },
        get bitrate(){ return BITRATE; }};
})();
