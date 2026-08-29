/* ============ the recording core ============ */
/* An AudioWorklet, as source, loaded from a Blob URL at runtime.

   It has to be a worklet. Recording means reading every input sample, and the only two
   other options are worse: MediaRecorder encodes to Opus and hands back something that
   needs decoding and is not sample-aligned, and ScriptProcessorNode runs on the main
   thread, where the click investigation's own findings say a stall is exactly what you
   get under load. A worklet runs on the audio thread and sees every frame.

   The Blob URL is what keeps the one-file rule: addModule() needs a URL, and this is the
   repo's first use of the trick the handoff already proposed for a PolyBLEP sync
   oscillator. Nothing is fetched. */
const LOOP_WORKLET = `
class LoopProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.buf = null;      // [Float32Array per channel]
    this.undo = null;     // one level, taken before each overdub
    this.len = 0;
    this.pos = 0;
    this.mode = "idle";   // idle | rec | play | dub
    this.next = null;     // {mode, frame} — a change waiting for its sample
    this.tick = 0;
    this.peak = 0;
    this.port.onmessage = e => this.msg(e.data);
  }

  msg(m){
    if (m.op === "alloc"){
      this.len = m.frames|0;
      this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
      this.undo = null;
      this.pos = 0; this.mode = "idle"; this.next = null;
    }
    else if (m.op === "at"){
      /* A mode change scheduled for an exact sample, so record starts on the bar line
         rather than whenever a message happened to arrive. */
      this.next = {mode: m.mode, frame: m.frame};
    }
    else if (m.op === "now"){ this.mode = m.mode; if (m.reset) this.pos = 0; }
    else if (m.op === "clear"){
      if (this.buf){ this.buf[0].fill(0); this.buf[1].fill(0); }
      this.undo = null; this.mode = "idle"; this.pos = 0; this.next = null;
    }
    else if (m.op === "undo"){
      if (this.undo){ this.buf = this.undo; this.undo = null; }
    }
  }

  /* Copy before an overdub, so one level of undo is always available. A looper without
     undo punishes the take you were happy with. */
  snapshot(){
    this.undo = [this.buf[0].slice(), this.buf[1].slice()];
  }

  process(inputs, outputs){
    const out = outputs[0];
    const inp = inputs[0];
    const n = out[0].length;
    if (!this.buf || !this.len){
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }
    const inL = inp && inp[0] ? inp[0] : null;
    const inR = inp && inp[1] ? inp[1] : inL;

    for (let i = 0; i < n; i++){
      /* the scheduled change lands on its exact frame, inside the block */
      if (this.next && currentFrame + i >= this.next.frame){
        if (this.next.mode === "dub") this.snapshot();
        this.mode = this.next.mode;
        this.pos = 0;
        this.next = null;
        this.port.postMessage({ev:"started", mode:this.mode});
      }

      const rec = this.mode === "rec", dub = this.mode === "dub";
      const old0 = this.buf[0][this.pos], old1 = this.buf[1][this.pos];

      if (rec || dub){
        const s0 = inL ? inL[i] : 0, s1 = inR ? inR[i] : 0;
        const a = Math.abs(s0);
        if (a > this.peak) this.peak = a;
        this.buf[0][this.pos] = rec ? s0 : old0 + s0;
        this.buf[1][this.pos] = rec ? s1 : old1 + s1;
      }

      /* Output the material as it was BEFORE this pass. Overdubbing outputs the new sum
         instead would double the live input, which is already being monitored. */
      const play = this.mode !== "idle" && this.mode !== "rec";
      out[0][i] = play ? old0 : 0;
      if (out[1]) out[1][i] = play ? old1 : 0;

      if (this.mode !== "idle"){
        this.pos++;
        if (this.pos >= this.len){
          this.pos = 0;
          /* A first pass records exactly one loop and then plays it — a looper that keeps
             recording until you press stop records your reaction time onto the end. */
          if (this.mode === "rec"){ this.mode = "play"; this.port.postMessage({ev:"looped", mode:"play"}); }
          else this.port.postMessage({ev:"looped", mode:this.mode});
        }
      }
    }

    /* position and peak, a few times a second — enough for a playhead and a meter */
    if ((this.tick = (this.tick + 1) % 8) === 0){
      this.port.postMessage({ev:"pos", pos:this.pos, len:this.len, mode:this.mode, peak:this.peak});
      this.peak = 0;
    }
    return true;
  }
}
registerProcessor("pw-looper", LoopProcessor);
`;
