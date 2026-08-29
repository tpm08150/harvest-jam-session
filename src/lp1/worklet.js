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
    /* One buffer per scene row. Allocated lazily — sixteen slots of eight bars would be
       ~100 MB reserved for takes nobody has recorded yet, so a slot exists only once
       something has been played into it. */
    this.slots = [];
    this.slot = 0;
    this.buf = null;      // [Float32Array per channel] — the active slot
    this.undo = null;     // one level, taken before each overdub
    this.len = 0;
    this.pos = 0;
    this.mode = "idle";   // idle | rec | play | dub
    /* Overdub is a LATCH, not a mode you schedule. Held here rather than inferred from
       this.mode so it can be set before there is anything to overdub onto: switch it on
       during the first pass and the take rolls into dub at the wrap instead of into play. */
    this.dub = false;
    this.next = null;     // {mode, frame} — a change waiting for its sample
    this.tick = 0;
    this.peak = 0;
    this.port.onmessage = e => this.msg(e.data);
  }

  msg(m){
    if (m.op === "alloc"){
      /* Changing the length invalidates every take, because a loop IS its sample count. */
      this.len = m.frames|0;
      this.slots = [];
      this.buf = null;
      this.undo = null;
      this.pos = 0; this.mode = "idle"; this.next = null;
      this.port.postMessage({ev:"slots", filled:[]});
    }
    else if (m.op === "slot"){
      this.slot = m.i|0;
      this.buf = this.slots[this.slot] || null;
      this.pos = 0;
      if (!this.buf && this.mode !== "idle"){ this.mode = "idle"; }
      this.port.postMessage({ev:"slots", filled:this.filled(), slot:this.slot});
    }
    else if (m.op === "at"){
      /* A mode change scheduled for an exact sample, so record starts on the bar line
         rather than whenever a message happened to arrive. The slot rides along with it,
         because a take belongs to a particular scene row and the switch has to happen on
         the same frame — selecting the slot separately would put the first samples of a
         take into the previous row.

         NOTE: this whole processor is a template literal. A backtick anywhere in here,
         including in a comment, ends the string and takes the rest of the app with it. */
      this.next = {mode: m.mode, frame: m.frame, slot: m.slot == null ? null : (m.slot | 0),
                   reset: !!m.reset};
    }
    else if (m.op === "now"){ this.mode = m.mode; if (m.reset) this.pos = 0; }
    else if (m.op === "dub"){
      this.dub = !!m.on;
      /* A live punch, and NOTHING here touches pos. Turning it on adds what you play from
         this instant; turning it off stops adding. The loop keeps running under your hand
         either way, which is the whole point of a switch you can flip mid-take. */
      if (this.mode === "play" && this.dub){
        this.snapshot();
        this.mode = "dub";
        this.port.postMessage({ev:"started", mode:"dub", slot:this.slot, filled:this.filled()});
      } else if (this.mode === "dub" && !this.dub){
        this.mode = "play";
        this.port.postMessage({ev:"started", mode:"play", slot:this.slot, filled:this.filled()});
      }
    }
    else if (m.op === "clear"){
      /* clears the ACTIVE slot only — a clear that wiped the bank would be unrecoverable */
      this.slots[this.slot] = null;
      this.buf = null;
      this.undo = null; this.mode = "idle"; this.pos = 0; this.next = null;
      this.port.postMessage({ev:"slots", filled:this.filled(), slot:this.slot});
    }
    else if (m.op === "undo"){
      if (this.undo){ this.buf = this.undo; this.slots[this.slot] = this.buf; this.undo = null; }
    }
  }

  /* Copy before an overdub, so one level of undo is always available. A looper without
     undo punishes the take you were happy with. */
  snapshot(){
    if (this.buf) this.undo = [this.buf[0].slice(), this.buf[1].slice()];
  }

  /* Which slots hold a take — the live grid draws its column from this. Sixteen, matching
     COUNT in shell/scenes.js; the worklet is a separate global scope and cannot read it,
     so the two are kept in step by hand and this comment is the link.

     Sixteen buffers is only sixteen buffers if you fill them. They are allocated at the
     moment a take starts, so an unrecorded row costs nothing — which is the whole reason
     the count can go up without reserving ~100 MB for takes nobody has played. */
  filled(){
    const out = [];
    for (let i = 0; i < 16; i++) if (this.slots[i]) out.push(i);
    return out;
  }

  process(inputs, outputs){
    const out = outputs[0];
    const inp = inputs[0];
    const n = out[0].length;
    /* Only the LENGTH gates the whole block. A null buf means the active slot holds no
       take yet, which is the normal state right before a first record — bailing out on it
       skipped the pending-transition check below, so a slot's first take could never
       start. Silence for that slot is handled per sample instead. */
    if (!this.len){
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }
    const inL = inp && inp[0] ? inp[0] : null;
    const inR = inp && inp[1] ? inp[1] : inL;

    for (let i = 0; i < n; i++){
      /* the scheduled change lands on its exact frame, inside the block */
      if (this.next && currentFrame + i >= this.next.frame){
        if (this.next.slot != null) this.slot = this.next.slot;
        /* a take into an empty slot allocates it at the moment it starts, not before */
        if (this.next.mode === "rec" && !this.slots[this.slot]){
          this.slots[this.slot] = [new Float32Array(this.len), new Float32Array(this.len)];
        }
        this.buf = this.slots[this.slot] || null;
        if (this.next.mode === "dub") this.snapshot();
        this.mode = this.buf ? this.next.mode : "idle";
        /* ⚠️ ONLY a fresh take starts at the top, or a caller that asks. This used to reset
           unconditionally, so arming a dub yanked the playhead back to the beginning of the
           loop — the scheduled frame is a grid boundary and the loop's phase is its own pos,
           and once the shell has dropped its origin the two have nothing to do with each
           other. A row fired from the launcher DOES want the top, and says so with reset;
           overdub does not, and does not. */
        if (this.next.mode === "rec" || this.next.reset) this.pos = 0;
        this.next = null;
        this.port.postMessage({ev:"started", mode:this.mode, slot:this.slot,
                               filled:this.filled()});
      }

      if (!this.buf){
        out[0][i] = 0;
        if (out[1]) out[1][i] = 0;
        continue;
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
             recording until you press stop records your reaction time onto the end. Where
             it goes next is the latch's to say: with overdub switched on before or during
             the take, the pass rolls straight into dubbing rather than needing a second
             press at the one moment you are least able to make it. */
          if (this.mode === "rec"){
            const nx = this.dub ? "dub" : "play";
            if (nx === "dub") this.snapshot();
            this.mode = nx;
            this.port.postMessage({ev:"looped", mode:nx});
          }
          else this.port.postMessage({ev:"looped", mode:this.mode});
        }
      }
    }

    /* position and peak, a few times a second — enough for a playhead and a meter */
    if ((this.tick = (this.tick + 1) % 8) === 0){
      this.port.postMessage({ev:"pos", pos:this.pos, len:this.len, mode:this.mode,
                             peak:this.peak, slot:this.slot, filled:this.filled()});
      this.peak = 0;
    }
    return true;
  }
}
registerProcessor("pw-looper", LoopProcessor);
`;
