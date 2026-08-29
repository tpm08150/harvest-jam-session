/* ============ ui ============ */
const playBtn = $("#play"), tempoOut = $("#tempoOut"), octOut = $("#octOut"),
      nowNote = $("#nowNote"), nowDetail = $("#nowDetail"), voiceMeta = $("#voiceMeta"),
      patchTag = $("#patchTag");

const NOTE_NAMES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const noteLabel = n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n/12) - 1);

/* ---- chord naming ----
   Note SET to a name, which is the opposite problem from CS·1's: that one knows the key and
   spells from scale degree, this one is handed a fistful of notes and has to guess. Ordered
   longest-first so a 7th is not reported as the triad hiding inside it. */
const CHORD_SHAPES = [
  [[0,2,4,7,11], "maj9"], [[0,2,4,7,10], "9"],   [[0,2,3,7,10], "m9"],
  [[0,4,7,11],   "maj7"], [[0,4,7,10],   "7"],   [[0,3,7,10],   "m7"],
  [[0,3,6,10],   "m7♭5"], [[0,3,6,9],    "dim7"],[[0,5,7,10],   "7sus4"],
  [[0,2,4,7],    "add9"], [[0,4,7,9],    "6"],   [[0,3,7,9],    "m6"],
  [[0,4,7],      ""],     [[0,3,7],      "m"],   [[0,3,6],      "dim"],
  [[0,4,8],      "aug"],  [[0,2,7],      "sus2"],[[0,5,7],      "sus4"],
  [[0,7],        "5"]
];
const INTERVALS = {1:"♭9",2:"9",3:"♭3",4:"3",5:"4",6:"♭5",7:"5",8:"♭6",9:"6",10:"♭7",11:"7"};
const sameSet = (a,b) => a.length === b.length && a.every((x,i) => x === b[i]);

/* Returns a display name for whatever is sounding, or "" if it is not a nameable chord.
   The lowest note is tried as root first, because that is what the ear does. */
function chordName(midis){
  if (!midis.length) return "";
  const uniq = [...new Set(midis.map(n => ((n % 12) + 12) % 12))].sort((a,b) => a-b);
  if (uniq.length === 1) return NOTE_NAMES[uniq[0]];
  const bassPc = ((Math.min.apply(null, midis) % 12) + 12) % 12;
  /* try the bass as root first, then every other note */
  const roots = [bassPc].concat(uniq.filter(pc => pc !== bassPc));
  for (const root of roots){
    const rel = uniq.map(pc => ((pc - root) % 12 + 12) % 12).sort((a,b) => a-b);
    for (const [shape, suffix] of CHORD_SHAPES){
      if (sameSet(rel, shape)){
        const name = NOTE_NAMES[root] + suffix;
        /* an inversion is worth saying out loud — it is why it sounds different */
        return root === bassPc ? name : name + "/" + NOTE_NAMES[bassPc];
      }
    }
  }
  if (uniq.length === 2){
    const iv = ((uniq[1] - uniq[0]) % 12 + 12) % 12;
    const lo = uniq[0] === bassPc ? uniq[0] : uniq[1];
    const hi = uniq[0] === bassPc ? uniq[1] : uniq[0];
    return NOTE_NAMES[lo] + " " + (INTERVALS[((hi - lo) % 12 + 12) % 12] || "");
  }
  return uniq.map(pc => NOTE_NAMES[pc]).join(" ");
}

/* every control that can be MIDI-learned, patch-saved or CC-driven registers here —
   exactly like CS·1's faderCtl, so learn/save/CC all treat knobs and faders alike */
const ctlReg = {};

/* value <-> 0..1, so one drag maths serves a log frequency and a linear percentage alike */
function toNorm(d, v){
  if (d.curve === "exp") return Math.log(clampf(v,d.min,d.max)/d.min) / Math.log(d.max/d.min);
  return (clampf(v,d.min,d.max) - d.min) / (d.max - d.min);
}
function fromNorm(d, n){
  n = clampf(n, 0, 1);
  const v = d.curve === "exp" ? d.min * Math.pow(d.max/d.min, n) : d.min + n*(d.max - d.min);
  return d.step ? Math.round(v/d.step)*d.step : v;
}
const F = {
  hz:   v => v >= 1000 ? (v/1000).toFixed(v >= 10000 ? 1 : 2)+"k" : Math.round(v)+"Hz",
  ms:   v => v < .999 ? Math.round(v*1000)+"ms" : v.toFixed(2)+"s",
  s:    v => v.toFixed(2)+"s",
  pct:  v => Math.round(v*100)+"%",
  db:   v => (v > 0 ? "+" : "")+v.toFixed(1)+"dB",
  cent: v => (v > 0 ? "+" : "")+Math.round(v)+"¢",
  semi: v => (v > 0 ? "+" : "")+Math.round(v)+" st",
  oct:  v => (v > 0 ? "+" : "")+v.toFixed(2)+" oct",
  lvl:  v => v <= 0 ? "off" : Math.round(v*100)+"%",
  off:  v => v <= 0.0005 ? "off" : Math.round(v*100)+"%"
};

/* 270 degrees, 7:30 to 4:30 — the pot convention every player already has in their hands.
   An SVG arc rather than a conic-gradient: stroke-dasharray gives a bipolar arc growing
   out of centre for one attribute write, and the pointer line is a transform on a <line>. */
const SWEEP = 75;                      // pathLength units for 270 of 360 degrees
const FULL_PX = 190;                   // pixels of drag for the full range
const FINE_DIV = 6;

function makeKnob(host, d){
  const el = document.createElement("div");
  el.className = "knob";
  el.tabIndex = 0;
  el.setAttribute("role","slider");
  el.setAttribute("aria-label", d.lab);
  el.setAttribute("aria-valuemin","0");
  el.setAttribute("aria-valuemax","100");
  el.innerHTML =
      '<div class="kface">'
    +   '<svg viewBox="0 0 56 56" aria-hidden="true" focusable="false">'
    +     '<circle class="ktrack" cx="28" cy="28" r="22" pathLength="100" transform="rotate(135 28 28)"/>'
    +     '<circle class="karc"   cx="28" cy="28" r="22" pathLength="100" transform="rotate(135 28 28)"/>'
    +     '<circle class="kbody"  cx="28" cy="28" r="16"/>'
    +     '<line   class="kptr" x1="28" y1="14" x2="28" y2="21"/>'
    +   '</svg>'
    +   '<span class="bind"></span>'
    + '</div>'
    + '<div class="klab">'+d.lab+'</div>'
    + '<div class="kval"></div>';
  host.appendChild(el);
  const arc = el.querySelector(".karc"), ptr = el.querySelector(".kptr"),
        val = el.querySelector(".kval");

  function render(){
    const n = toNorm(d, P[d.id]);
    /* unipolar grows from the minimum; bipolar grows out of the centre either way */
    const start = d.bipolar ? Math.min(n, .5)*SWEEP : 0;
    const len   = (d.bipolar ? Math.abs(n - .5) : n) * SWEEP;
    arc.setAttribute("stroke-dasharray", len.toFixed(2)+" 100");
    arc.setAttribute("stroke-dashoffset", (-start).toFixed(2));
    /* round caps would leave a visible dot at zero length */
    arc.style.display = len < 0.4 ? "none" : "";
    ptr.setAttribute("transform", "rotate("+(-135 + n*270).toFixed(2)+" 28 28)");
    val.textContent = d.fmt(P[d.id]);
    el.setAttribute("aria-valuenow", Math.round(n*100));
    el.setAttribute("aria-valuetext", d.fmt(P[d.id]));
  }
  function setNorm(n){
    P[d.id] = fromNorm(d, n);
    render();
    applyParam(d.id);
    lockKnob(d.id);
  }
  const getNorm = () => toNorm(d, P[d.id]);

  let dragY = 0, dragN = 0, fine = false, startX = 0;
  el.addEventListener("pointerdown", e => {
    if (LEARN.on){ arm({type:"ctl", id:d.id}, el); e.preventDefault(); return; }
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    dragY = e.clientY; startX = e.clientX; dragN = getNorm(); fine = e.shiftKey;
    e.preventDefault();
  });
  el.addEventListener("pointermove", e => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    /* no Shift key on a phone: drifting more than 40px sideways during the drag is the
       standard plugin gesture for fine mode, and the readout turns mint to say so */
    if (!fine && Math.abs(e.clientX - startX) > 40) fine = true;
    const div = (e.shiftKey || fine) ? FINE_DIV : 1;
    val.classList.toggle("fine", div > 1);
    setNorm(dragN + (dragY - e.clientY)/(FULL_PX*div) * 1);
    /* re-anchor so a sensitivity change mid-drag does not jump the value */
    dragN = getNorm(); dragY = e.clientY;
  });
  const end = e => {
    el.classList.remove("dragging"); val.classList.remove("fine"); fine = false;
    try{ el.releasePointerCapture(e.pointerId); }catch(err){}
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("dblclick", () => {
    /* in program mode the first thing a double-click undoes is the LOCK, not the value —
       otherwise there is no way to unlock a knob without also losing your patch setting */
    if (SEQ.mode === "program"){
      const st = SEQ.steps[SEQ.sel];
      if (st && st.locks && Object.prototype.hasOwnProperty.call(st.locks, d.id)){
        delete st.locks[d.id];
        if (!Object.keys(st.locks).length) delete st.locks;
        paintSteps(); paintLocks();
        return;
      }
    }
    P[d.id] = FACTORY_DEFAULT[d.id]; render(); applyParam(d.id);
  });
  el.addEventListener("keydown", e => {
    const big = e.shiftKey ? .002 : .02;
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowRight") setNorm(getNorm() + big);
    else if (k === "ArrowDown" || k === "ArrowLeft") setNorm(getNorm() - big);
    else if (k === "PageUp") setNorm(getNorm() + .1);
    else if (k === "PageDown") setNorm(getNorm() - .1);
    else if (k === "Home") setNorm(0);
    else if (k === "End") setNorm(1);
    else return;
    e.preventDefault();
  });
  /* CC drives this too, so a hardware knob p-locks exactly like an on-screen one */
  ctlReg[d.id] = {set:v => { P[d.id] = fromNorm(d, v); render(); applyParam(d.id); lockKnob(d.id); },
                  render, el};
  render();
}

const KNOBS = {
  kKey:[
    {id:"glide",  lab:"Glide",   min:0, max:1.2, curve:"lin", fmt:v => v<=0?"off":F.ms(v)},
    {id:"unidet", lab:"Uni det", min:0, max:40,  curve:"lin", fmt:F.cent},
    {id:"unispread",lab:"Uni wide",min:0,max:1,  curve:"lin", fmt:F.pct},
    {id:"bend",   lab:"Bend rng",min:0, max:12,  curve:"lin", step:1, fmt:F.semi}
  ],
  kLfo:[
    {id:"lfor", lab:"Rate",    min:.05, max:20, curve:"exp", fmt:v => v.toFixed(2)+"Hz"},
    {id:"lfod", lab:"Delay",   min:0,   max:3,  curve:"lin", fmt:v => v<=0?"off":F.ms(v)},
    {id:"lfop", lab:"→ Pitch", min:0,   max:80, curve:"lin", fmt:F.cent},
    {id:"lfof", lab:"→ Filter",min:0,   max:3,  curve:"lin", fmt:F.oct},
    {id:"lfoa", lab:"→ Amp",   min:0,   max:.6, curve:"lin", fmt:F.off}
  ],
  kOsc:[
    {id:"o1oct", lab:"1 Oct",  min:-2, max:2,  curve:"lin", step:1, bipolar:true, fmt:F.semi},
    {id:"o1lvl", lab:"1 Level",min:0,  max:1,  curve:"lin", fmt:F.lvl},
    {id:"o2oct", lab:"2 Oct",  min:-2, max:2,  curve:"lin", step:1, bipolar:true, fmt:F.semi},
    {id:"o2semi",lab:"2 Semi", min:-12,max:12, curve:"lin", step:1, bipolar:true, fmt:F.semi},
    {id:"o2det", lab:"2 Fine", min:-60,max:60, curve:"lin", bipolar:true, fmt:F.cent},
    {id:"o2lvl", lab:"2 Level",min:0,  max:1,  curve:"lin", fmt:F.lvl},
    {id:"sublvl",lab:"Sub",    min:0,  max:1,  curve:"lin", fmt:F.lvl},
    {id:"noiselvl",lab:"Noise",min:0,  max:1,  curve:"lin", fmt:F.lvl},
    /* 0.5 is a true square; narrowing thins it and costs about 4.5 dB by 0.05, which is
       the authentic behaviour rather than a bug in the level budget */
    {id:"pw",    lab:"Width",  min:.05,max:.5, curve:"lin", fmt:v => Math.round(v*100)+"%"},
    {id:"pwm",   lab:"PWM",    min:0,  max:.45,curve:"lin", fmt:F.off},
    {id:"pwmrate",lab:"PWM rt",min:.05,max:8,  curve:"exp", fmt:v => v.toFixed(2)+"Hz"},
    {id:"ring",  lab:"Ring",   min:0,  max:1,  curve:"lin", fmt:F.off},
    {id:"fm",    lab:"FM",     min:0,  max:1,  curve:"lin", fmt:F.off}
  ],
  kFlt:[
    {id:"fcut", lab:"Cutoff",  min:30, max:16000, curve:"exp", fmt:F.hz},
    {id:"fres", lab:"Reso",    min:0,  max:20,   curve:"lin", fmt:v => v.toFixed(1)+"dB"},
    {id:"fenv", lab:"Env amt", min:-4, max:7,    curve:"lin", bipolar:true, fmt:F.oct},
    {id:"fkey", lab:"Key trk", min:0,  max:1,    curve:"lin", fmt:F.pct},
    {id:"velf", lab:"Vel → f", min:0,  max:3,    curve:"lin", fmt:F.oct},
    {id:"fdrive",lab:"Drive",  min:0,  max:24,   curve:"lin", fmt:v => v<=0?"off":F.db(v)},
    {id:"fhpf", lab:"HPF",     min:20, max:600,  curve:"exp", fmt:v => v<=21?"off":F.hz(v)}
  ],
  kEnvF:[
    {id:"fa", lab:"Attack", min:.0005, max:8, curve:"exp", fmt:F.ms},
    {id:"fd", lab:"Decay",  min:.005,  max:10,curve:"exp", fmt:F.ms},
    {id:"fs", lab:"Sustain",min:0,     max:1, curve:"lin", fmt:F.pct},
    {id:"fr", lab:"Release",min:.0005, max:10,curve:"exp", fmt:F.ms}
  ],
  kEnvA:[
    {id:"aa", lab:"Attack", min:.0005, max:8, curve:"exp", fmt:F.ms},
    {id:"ad", lab:"Decay",  min:.005,  max:10,curve:"exp", fmt:F.ms},
    {id:"as", lab:"Sustain",min:0,     max:1, curve:"lin", fmt:F.pct},
    {id:"ar", lab:"Release",min:.01,   max:10,curve:"exp", fmt:F.ms}
  ],
  kBass:[
    {id:"blvl",   lab:"Level",   min:0,   max:1,     curve:"lin", fmt:F.lvl},
    {id:"boct",   lab:"Octave",  min:-3,  max:0,     curve:"lin", step:1, fmt:v => v + " oct"},
    {id:"bsub",   lab:"Sub",     min:0,   max:1,     curve:"lin", fmt:F.lvl},
    {id:"bcut",   lab:"Cutoff",  min:30,  max:6000,  curve:"exp", fmt:F.hz},
    {id:"bres",   lab:"Reso",    min:0,   max:20,    curve:"lin", fmt:v => v.toFixed(1)+"dB"},
    {id:"benv",   lab:"Contour", min:0,   max:6,     curve:"lin", fmt:F.oct},
    {id:"bdec",   lab:"Decay",   min:.03, max:4,     curve:"exp", fmt:F.ms},
    {id:"bglide", lab:"Glide",   min:0,   max:1.2,   curve:"lin", fmt:v => v<=0?"off":F.ms(v)}
  ],
  kVoc:[
    /* 0..4x linear was not enough range. The vocoder's output level is PROPORTIONAL to the
       modulator level, so a line input arriving at -40 dBFS needs about +28 dB before the
       band followers open at all — and 4x is only +12 dB, leaving the thing near-silent
       with no indication why. Exponential 0.05..20x spans -26..+26 dB instead. Patches
       store vocmod in real units, so widening the range does not move any saved value. */
    {id:"vocmod", lab:"Mod gain", min:.05, max:20, curve:"exp",
     fmt:v => (20*Math.log10(v) > 0 ? "+" : "") + (20*Math.log10(v)).toFixed(1) + "dB"},
    {id:"voccomp",lab:"Squeeze",  min:0,  max:1,  curve:"lin", fmt:F.off},
    {id:"vocq",   lab:"Band Q",   min:2,  max:12, curve:"lin", fmt:v => v.toFixed(1)},
    /* low is smooth and sung, high is articulate and consonant-y */
    {id:"vocresp",lab:"Response", min:5,  max:80, curve:"exp", fmt:v => Math.round(v)+"Hz"},
    {id:"vocsib", lab:"Sibilance",min:0,  max:1,  curve:"lin", fmt:F.off},
    {id:"carlvl", lab:"Carrier",  min:0,  max:1,  curve:"lin", fmt:F.lvl},
    {id:"vocmix", lab:"Level",    min:0,  max:1,  curve:"lin", fmt:F.lvl}
  ],
  kOut:[
    {id:"dtime",lab:"Dly time",min:20, max:2000, curve:"exp", fmt:v => Math.round(v)+"ms"},
    {id:"dfb",  lab:"Dly fb",  min:0,  max:.85,  curve:"lin", fmt:F.pct},
    {id:"dmix", lab:"Dly mix", min:0,  max:1,    curve:"lin", fmt:F.off},
    {id:"rmix", lab:"Reverb",  min:0,  max:1,    curve:"lin", fmt:F.off},
    {id:"vela", lab:"Vel → amp",min:0, max:1,    curve:"lin", fmt:F.pct},
    {id:"trim", lab:"Trim",    min:-18,max:12,   curve:"lin", bipolar:true, fmt:F.db}
  ]
};
/* The knob table is the single source of truth for what a parameter's legal range is, so
   the lock loader clamps against it rather than carrying a second copy that can drift. */
const PARAM_RANGE = {};
Object.keys(KNOBS).forEach(host => {
  const el = $("#"+host);
  /* A host that is not on this panel is a rack that moved to another instrument, not an
     error. The range table is still filled either way, so a patch carrying that parameter
     still clamps correctly on load. */
  KNOBS[host].forEach(d => {
    PARAM_RANGE[d.id] = [d.min, d.max];
    if (el) makeKnob(el, d);
  });
});

/* ---- push a knob move into what is already sounding ----
   Anything that changes the SHAPE of the graph (which waveform, whether a sub exists)
   takes effect on the next note, which is how a real DCO board behaves too. Everything
   that is just a number on a running node moves under the note. */
function eachVoice(fn){
  active.forEach(v => { try{ fn(v); }catch(e){} });
}
function eachStack(fn){
  eachVoice(v => (v.stacks || []).forEach(st => { try{ fn(st); }catch(e){} }));
}
function applyParam(id){
  if (!ctx) return;
  const t = ctx.currentTime;
  switch (id){
    case "fcut": case "fkey": case "velf":
      active.forEach(v => v.setCutoff(t, v.midi)); break;
    case "fres": {
      const L = ladder(clampf(P.fres/20, 0, 1));
      active.forEach(v => {
        v.biq1.Q.setTargetAtTime(L.Q1dB, t, .01);
        v.biq2.Q.setTargetAtTime(L.Q2dB, t, .01);
        v.setCutoff(t, v.midi);
      });
      break;
    }
    case "fenv":
      active.forEach(v => v.fltAmt.gain.setTargetAtTime(P.fenv*1200, t, .01)); break;
    case "trim": case "vela":
      active.forEach(v => v.peak.gain.setTargetAtTime(
        (1 - P.vela + P.vela*(v.vel/127)) * db2lin(P.trim + (CAT_TRIM[P.cat]||0)), t, .01));
      break;
    case "lfor": setLfoRate(P.lfor); break;
    case "lfop": if (lfoPitchG) lfoPitchG.gain.setTargetAtTime(P.lfop, t, .02); break;
    case "lfof": if (lfoFiltG)  lfoFiltG.gain.setTargetAtTime(P.lfof*1200, t, .02); break;
    case "lfoa": if (lfoAmpG)   lfoAmpG.gain.setTargetAtTime(P.lfoa, t, .02); break;
    case "pwmrate": if (pwmLfo) pwmLfo.frequency.setTargetAtTime(P.pwmrate, t, .02); break;
    case "pw": case "pwm":
      /* the delay line IS the pulse width, so this moves under a sounding note */
      active.forEach(v => v.stacks.forEach(st => st.setPitch(t, mtof(v.midi), 0)));
      break;
    /* ---- everything below used to wait for the next note ---- */
    case "o1lvl": case "o2lvl": case "sublvl": case "noiselvl":
      eachStack(st => st.setLevels(t)); break;
    case "o1oct": case "o2oct": case "o2semi": case "o2det":
      eachStack(st => st.setTuning(t)); break;
    case "ring": case "fm":
      eachStack(st => st.setCross(t)); break;
    case "unidet": case "unispread":
      /* the spread is a property of the STACK's position in the unison, so it has to be
         recomputed per member rather than pushed as one value */
      eachVoice(v => {
        const n = v.stacks.length;
        v.stacks.forEach((st, i) => {
          const k = n === 1 ? 0 : (i/(n-1))*2 - 1;
          st.setDrift(t, k * (P.unidet/2), n === 1 ? 0 : k * P.unispread);
        });
      });
      break;
    case "fdrive": {
      const g = Math.max(1, db2lin(P.fdrive));
      eachVoice(v => {
        if (!v.shaper) return;
        v.shaper.curve = driveCurve(2048, g);
        v.driveTrim.gain.setTargetAtTime(db2lin(-0.6*P.fdrive) * (P.fdrive > 0 ? g : 1), t, .02);
      });
      break;
    }
    case "fhpf":
      eachVoice(v => { if (v.hpf) v.hpf.frequency.setTargetAtTime(clampf(P.fhpf,20,600), t, .02); });
      break;
    case "as": case "fs": {
      /* Sustain is the decay's TARGET, so moving it under a held note means re-aiming the
         decay from wherever the envelope currently is. Only meaningful once the attack is
         over — during the attack the scheduled ramp still owns the parameter. */
      const isAmp = id === "as", want = clampf(isAmp ? P.as : P.fs, 0, 1);
      eachVoice(v => {
        const e = isAmp ? v.aEnv : v.fEnv, param = isAmp ? v.ampEG : v.fltEG;
        if (!e || !param || v.released) return;
        e.S = want;
        if (t <= e.t0 + e.A) return;                  // still attacking; the ramp owns it
        const cur = envValueAt(e, t);
        param.offset.cancelScheduledValues(t);
        param.offset.setValueAtTime(cur, t);
        param.offset.setTargetAtTime(want, t, .04);
        /* keep the analytic model honest: the note is at sustain from here */
        e.t0 = t - (e.A + e.D);
      });
      break;
    }
    case "dtime": case "dfb": case "dmix": applyDelay(); break;
    case "rmix": applySends(); break;
    /* the vocoder's and the bass's parameters left with their sections — VC·1 and BS·1 */
    case "carlvl":
      break;
    default: break;
  }
}

/* Delay times, LFO rates and depths are concrete so a rendered impulse can check them
   rather than the mode being an adjective. */
const CHORUS = {
  off:  null,
  i:    {rates:[0.513], depth:.0026, base:.0032, wet:.45},
  ii:   {rates:[0.863], depth:.0039, base:.0032, wet:.55},
  "i+ii":{rates:[9.8],  depth:.0004, base:.0032, wet:.55},
  ens:  {rates:[0.18,0.31,0.47], depth:.0045, base:.008, wet:.50}
};
function applyChorus(){
  if (!ctx || !chorusStage) return;
  const t = ctx.currentTime, c = CHORUS[P.chorus];
  chorusStage.lines.forEach((ln, i) => {
    if (!c || i >= c.rates.length){ ln.depth.gain.setTargetAtTime(0, t, .02); return; }
    ln.lfoN.frequency.setTargetAtTime(c.rates[i], t, .02);
    ln.depth.gain.setTargetAtTime(c.depth, t, .02);
    ln.dly.delayTime.setTargetAtTime(c.base, t, .02);
    /* phase-inverted L/R is what makes a BBD chorus wide rather than just wobbly */
    ln.pan.pan.setTargetAtTime(c.rates.length === 1 ? (i%2 ? .8 : -.8) : (i-1)*.85, t, .02);
  });
  const wet = c ? c.wet : 0, norm = 1/(1 + wet);
  chorusWet.gain.setTargetAtTime(wet * norm, t, .02);
  chorusDry.gain.setTargetAtTime(norm, t, .02);
}
const DIVS = {"1/2":2, "1/4":1, "1/4d":1.5, "1/8":.5, "1/8d":.75, "1/8t":1/3, "1/16":.25};
function applyDelay(){
  if (!ctx || !delayNode) return;
  const t = ctx.currentTime;
  let secs;
  if (P.ddiv === "off"){ delayWet.gain.setTargetAtTime(0, t, .02); delayFb.gain.setTargetAtTime(0, t, .02); return; }
  if (P.ddiv === "free") secs = P.dtime/1000;
  else secs = beatSeconds() * (DIVS[P.ddiv] || .5);
  delayNode.delayTime.setTargetAtTime(clampf(secs, .001, 2.4), t, .05);
  delayFb.gain.setTargetAtTime(clampf(P.dfb, 0, .85), t, .02);
  delayWet.gain.setTargetAtTime(P.dmix, t, .02);
}
function applySends(){
  if (!ctx || !verbWet) return;
  /* 3x, not 1x: a ConvolverNode normalises a long noise IR down hard, and CS·1's Space
     fader sat around -23 dB and was inaudible until this was measured */
  verbWet.gain.setTargetAtTime(P.rmix * 2.2, ctx.currentTime, .02);
}

