/* ============ note layer ============ */
/* Held notes in press order. Priority decides which one actually sounds, which is the
   whole personality of a mono synth: LOW is the classic bass-line behaviour (a new high
   note does not interrupt the root), HIGH suits leads, LAST suits playing chords badly. */
const heldNotes = [];
let curVoice = null, latch = false, octave = 0, bendCents = 0;
/* The pitch currently mirrored to MIDI out for the synth section. A mono synth sounds ONE
   note however many keys are down, so the mirror follows the note priority picked below
   rather than every held key — otherwise the note stream going out is not the one you hear. */
let synOut = null;
/* Which keys are PHYSICALLY down — not the same as which notes are sounding, once Hold is
   on. Without it there is no way to tell a deliberate re-press of a latched note from the
   duplicate note-on some controllers send while a key is held. */
const downKeys = new Set();
/* The on-screen and computer keyboards carry no MIDI channel, so they need their own
   destination. This is what the keyboard split used to do, without pretending that half a
   keyboard is a routing scheme. Declared up here because the panel's segmented button
   paints its initial state as it is built, which is long before the MIDI section runs. */
/* Always the synth: MS·1 needed a choice because one keyboard served three sections, and
   PM·1 has one voice. Kept as a variable rather than inlined so the routing code below
   reads unchanged against MS·1, which is what makes this diff reviewable. */
let keysTo = "syn";
/* While the arpeggiator runs, held notes are INPUT to it, not notes in their own right:
   the arp is already mirroring what actually sounds, so sending the held keys as well
   would put a sustained note out under it that nothing ever releases. */
/* ---- the bass section ----
   A pedal synth: one oscillator, a square sub an octave under it, the same ladder as the
   main filter, and one contour knob that shapes filter and release together. Monophonic
   and lowest-note priority, because that is what a pedalboard is. It bypasses the chorus,
   delay and reverb entirely — a bass wants to stay dry and centred, and a Taurus has no
   sends either. */
/* Measured: 0.22 put the section at -23.8 dBFS, about 1.8 dB under the -22 the bass
   presets are trimmed to, so the pedal voice sat quietly under everything else. */
const BASS_UNITY = 0.27;
let bassOut = null, bassVoice = null;
const bassHeld = [];

function buildBass(midi, vel, t){
  const v = {t0:t, midi, released:false};
  const f0 = mtof(midi) * Math.pow(2, P.boct);
  const mix = ctx.createGain(); mix.gain.value = 1;

  const o = ctx.createOscillator();
  o.type = P.bwave === "square" ? "square" : "sawtooth";
  o.frequency.value = f0;
  const og = ctx.createGain(); og.gain.value = BASS_UNITY;
  o.connect(og); og.connect(mix); o.start(t);

  const sub = ctx.createOscillator();
  sub.type = "square"; sub.frequency.value = f0/2;
  const sg = ctx.createGain(); sg.gain.value = BASS_UNITY * P.bsub;
  sub.connect(sg); sg.connect(mix); sub.start(t);

  const L = ladder(clampf(P.bres/20, 0, 1));
  const b1 = ctx.createBiquadFilter(); b1.type = "lowpass"; b1.Q.value = L.Q1dB;
  const b2 = ctx.createBiquadFilter(); b2.type = "lowpass"; b2.Q.value = L.Q2dB;
  const rg = ctx.createGain(); rg.gain.value = Math.pow(1 + L.k, RCOMP - 1);
  const vca = ctx.createGain(); vca.gain.value = 0;
  mix.connect(b1); b1.connect(b2); b2.connect(rg); rg.connect(vca); vca.connect(bassOut);

  v.setCutoff = function(t2){
    const base = clampf(P.bcut, 20, ctx.sampleRate * 0.45 / L.rho2);
    b1.frequency.setTargetAtTime(base * L.rho1, t2, .01);
    b2.frequency.setTargetAtTime(base * L.rho2, t2, .01);
  };
  v.setCutoff(t);

  /* contour -> cutoff, in cents, exactly as the main filter does it */
  const fEG = ctx.createConstantSource(); fEG.offset.value = 0; fEG.start(t);
  const fAmt = ctx.createGain(); fAmt.gain.value = P.benv * 1200;
  fEG.connect(fAmt); fAmt.connect(b1.detune); fAmt.connect(b2.detune);

  const aEG = ctx.createConstantSource(); aEG.offset.value = 0; aEG.start(t);
  const pk = ctx.createGain();
  pk.gain.value = P.blvl * (0.7 + 0.3 * (vel/127));
  aEG.connect(pk); pk.connect(vca.gain);

  /* One Decay knob drives both: the filter plucks down to a low sustain, the amp holds
     while the pedal is down and releases in proportion. That is the whole contour. */
  const fEnv = {A:.004, D:Math.max(.01, P.bdec), S:.12,
                R:Math.max(.03, P.bdec*.6), t0:t, tOff:null, vOff:0};
  const aEnv = {A:.004, D:Math.max(.05, P.bdec*2), S:1,
                R:Math.max(AMP_REL_MIN, P.bdec*.6), t0:t, tOff:null, vOff:0};
  schedEnv(fEG.offset, fEnv, t, 0);
  schedEnv(aEG.offset, aEnv, t, 0);

  v.nodes = [mix, og, sg, b1, b2, rg, vca, pk, fAmt];
  v.o = o; v.sub = sub; v.og = og; v.sg = sg; v.b1 = b1; v.b2 = b2; v.rg = rg;
  v.pk = pk; v.fAmt = fAmt; v.fEG = fEG; v.aEG = aEG; v.fEnv = fEnv; v.aEnv = aEnv;

  v.setPitch = function(t2, m, glideT){
    v.midi = m;
    const f = mtof(m) * Math.pow(2, P.boct);
    if (glideT > 0){
      [[o, f], [sub, f/2]].forEach(([node, target]) => {
        node.frequency.cancelScheduledValues(t2);
        node.frequency.setValueAtTime(Math.max(1e-4, node.frequency.value), t2);
        node.frequency.exponentialRampToValueAtTime(Math.max(1e-4, target), t2 + glideT);
      });
    } else { o.frequency.setValueAtTime(f, t2); sub.frequency.setValueAtTime(f/2, t2); }
  };
  v.retrigger = function(t2, m, vel2, glideT){
    v.setPitch(t2, m, glideT);
    pk.gain.setTargetAtTime(P.blvl * (0.7 + 0.3*(vel2/127)), t2, .005);
    const a0 = envValueAt(aEnv, t2), f0v = envValueAt(fEnv, t2);
    aEnv.t0 = t2; aEnv.tOff = null; fEnv.t0 = t2; fEnv.tOff = null;
    schedEnv(aEG.offset, aEnv, t2, a0);
    schedEnv(fEG.offset, fEnv, t2, f0v);
  };
  v.release = function(t2){
    if (v.released) return;
    v.released = true;
    aEnv.R = Math.max(AMP_REL_MIN, P.bdec*.6);      // read at release, like everything else
    fEnv.R = Math.max(.03, P.bdec*.6);
    beginRelease(aEnv, t2); beginRelease(fEnv, t2);
    schedRelease(aEG.offset, aEnv, t2);
    schedRelease(fEG.offset, fEnv, t2);
    const end = t2 + 2*aEnv.R + .05;
    try{ o.stop(end); sub.stop(end); fEG.stop(end); aEG.stop(end); }catch(e){}
    setTimeout(() => v.nodes.forEach(n => { try{ n.disconnect(); }catch(e){} }),
      Math.max(60, (end - ctx.currentTime)*1000 + 120));
  };
  return v;
}

const bassPick = () => bassHeld.length ? bassHeld.slice().sort((a,b)=>a.midi-b.midi)[0] : null;

function bassOn(m, vel, t){
  ensureAudio();
  if (bassHeld.some(n => n.midi === m)) return;
  bassHeld.push({midi:m, vel:vel});
  const target = bassPick();
  if (!bassVoice || bassVoice.released) bassVoice = buildBass(target.midi, target.vel, t);
  else bassVoice.retrigger(t, target.midi, target.vel,
         P.bglide > 0 ? P.bglide * Math.abs(target.midi - bassVoice.midi)/12 : 0);
  if (mirrorSyn()) sendNoteOn(m, t, vel);
}
function bassOff(m, t){
  const i = bassHeld.findIndex(n => n.midi === m);
  if (i >= 0) bassHeld.splice(i, 1);
  sendNoteOff(m, t);
  const target = bassPick();
  if (!target){ if (bassVoice) bassVoice.release(t); bassVoice = null; }
  else if (bassVoice && !bassVoice.released)
    bassVoice.setPitch(t, target.midi,
      P.bglide > 0 ? P.bglide * Math.abs(target.midi - bassVoice.midi)/12 : 0);
}
function allBassOff(t){
  bassHeld.length = 0;
  if (bassVoice) bassVoice.release(t);
  bassVoice = null;
}

/* ---- polyphony ----
   The mono path keeps ONE voice and re-pitches it; poly keeps one per held note. They are
   deliberately separate paths rather than "mono is poly with a limit of 1": glide, legato
   and note priority are all statements about a single voice moving, and they mean nothing
   with six of them. In poly, buildVoice() already collapses unison to 1 on its own, because
   six voices times five unison members is 30 oscillator stacks and no better a sound. */
const MAX_POLY = 6;
const polyVoices = new Map();          // midi -> voice, in press order

function polyOn(m, vel, t){
  const old = polyVoices.get(m);
  if (old){ old.release(t); polyVoices.delete(m); }
  if (polyVoices.size >= MAX_POLY){
    const oldest = polyVoices.keys().next().value;   // Map keeps insertion order
    const v = polyVoices.get(oldest);
    if (v) v.release(t);
    polyVoices.delete(oldest);
    sendNoteOff(oldest, t);                          // the stolen note has to be released out
  }
  polyVoices.set(m, buildVoice(m, vel, t));
  retriggerLfo();
  if (lfoFade){
    lfoFade.gain.cancelScheduledValues(t);
    if (P.lfod > 0){
      lfoFade.gain.setValueAtTime(0, t);
      lfoFade.gain.linearRampToValueAtTime(1, t + P.lfod);
    } else lfoFade.gain.setValueAtTime(1, t);
  }
  if (mirrorSyn()) sendNoteOn(m, t, vel);
}
function polyOff(m, t){
  const v = polyVoices.get(m);
  if (!v) return;
  v.release(t);
  polyVoices.delete(m);
  sendNoteOff(m, t);
}
function allPolyOff(t){
  polyVoices.forEach((v, m) => { try{ v.release(t); sendNoteOff(m, t); }catch(e){} });
  polyVoices.clear();
}

/* True when a running pattern owns the synth voice, so the keyboard must not also play it.
   Never in program mode: there you are entering notes and must hear each one, even with
   the sequence running underneath. */
const seqOwnsVoice = () => SEQ.playing && SEQ.mode === "play"
                        && (SEQ.motion === "arp" || SEQ.motion === "seq");

/* Run fn() with a step's parameter locks temporarily in force. Voices read P at build time,
   so swapping P around the build is all it takes — and because scheduling is synchronous
   the UI never observes the swapped values. Restored in a finally, or a throw mid-step
   would leave the whole patch stuck on one step's settings. */
function withLocks(st, fn){
  const L = st && st.locks;
  if (!L) return fn();
  const saved = {};
  for (const k in L){ saved[k] = P[k]; P[k] = L[k]; }
  try { return fn(); } finally { for (const k in saved) P[k] = saved[k]; }
}
const mirrorSyn = () => MIDI.noteOut && !seqOwnsVoice();

const pick = () => {
  if (!heldNotes.length) return null;
  if (P.prio === "last") return heldNotes[heldNotes.length - 1];
  const sorted = heldNotes.slice().sort((a,b) => a.midi - b.midi);
  return P.prio === "high" ? sorted[sorted.length - 1] : sorted[0];
};
/* Constant RATE, not constant time: a two-octave leap takes twice as long as a one-octave
   leap, which is what a real portamento circuit does and what players expect. */
const glideTime = (from, to) =>
  (P.gmode === "off" || !P.glide) ? 0 : P.glide * Math.abs(to - from)/12;

/* ---- the vocoder carrier ----
   Paraphonic, not polyphonic: every note gets its own oscillators and amp envelope, but
   they all sum into ONE bank. That is how the hardware ones work, and it is why six-note
   vocoder chords cost the same as one note — the expensive part is the bank, and it is
   shared. There is no ladder here on purpose; the bank is the filter. */
const MAX_CARRIERS = 6;
const carriers = new Map();          // midi -> carrier record, in press order

function buildCarrier(midi, vel, t){
  const v = {t0:t, midi, released:false, voc:true};
  const st = mkStack(v, 0, 0, mtof(midi));
  const env = ctx.createGain(); env.gain.value = 0;
  st.pan.connect(env);
  const lvl = ctx.createGain(); lvl.gain.value = P.carlvl;
  env.connect(lvl); lvl.connect(vocBus);

  const eg = ctx.createConstantSource(); eg.offset.value = 0; eg.start(t);
  const pk = ctx.createGain();
  pk.gain.value = 1 - P.vela + P.vela*(vel/127);
  eg.connect(pk); pk.connect(env.gain);

  const e = {A:Math.max(.0005, P.aa), D:Math.max(.005, P.ad), S:clampf(P.as,0,1),
             R:Math.max(AMP_REL_MIN, P.ar), t0:t, tOff:null, vOff:0};
  schedEnv(eg.offset, e, t, 0);

  v.stack = st; v.stacks = [st]; v.eg = eg; v.ampEG = eg; v.e = e; v.lvl = lvl; v.aEnv = e;
  v.release = function(t2){
    if (v.released) return;
    v.released = true;
    e.R = Math.max(AMP_REL_MIN, P.ar);          // read at release, not at note-on
    beginRelease(e, t2);
    schedRelease(eg.offset, e, t2);
    const end = t2 + 2*e.R + .05;
    st.stop(end);
    try{ eg.stop(end); }catch(err){}
    setTimeout(() => {
      try{ st.pan.disconnect(); }catch(err){}
      st.parts.forEach(pt => {
        try{ if (pt.pwmDepth) pwmBus.disconnect(pt.pwmDepth); }catch(err){}
        try{ if (pt.o) (pt.pbus||pitchVoc).disconnect(pt.o.detune); }catch(err){}
      });
      [env, lvl, pk].forEach(n => { try{ n.disconnect(); }catch(err){} });
    }, Math.max(60, (end - ctx.currentTime)*1000 + 120));
  };
  return v;
}

function carrierOn(midi, vel, t){
  ensureAudio();
  const old = carriers.get(midi);
  if (old) old.release(t);
  if (carriers.size >= MAX_CARRIERS){
    const oldest = carriers.keys().next().value;   // Map keeps insertion order
    const c = carriers.get(oldest);
    if (c) c.release(t);
    carriers.delete(oldest);
    sendNoteOff(oldest, t);                        // stolen voices have to be released out too
  }
  carriers.set(midi, buildCarrier(midi, vel, t));
  /* The carrier chord goes out as well — it is played, it is sounding, and doubling a
     vocoder chord on external gear is worth having. Everything leaves on the one Out ch. */
  sendNoteOn(midi, t, vel);
}
function carrierOff(midi, t){
  const c = carriers.get(midi);
  if (!c) return;
  c.release(t);
  carriers.delete(midi);
  sendNoteOff(midi, t);
}
function allCarriersOff(t){
  carriers.forEach((c, n) => { try{ c.release(t); sendNoteOff(n, t); }catch(e){} });
  carriers.clear();
}

/* Hold ACCUMULATES only where more than one note can actually be heard: poly, the vocoder's
   paraphonic carrier, and the arp — whose entire purpose is to read a held chord. With a
   single mono voice, or a sequencer that takes exactly one transposition, latching a second
   note only adds an entry that fights the first over one voice, and the older one becomes
   unreachable. There it REPLACES instead. */
const latchReplaces = () => P.mode !== "poly" && SEQ.motion !== "arp";

/* Drop notes that are latched — sounding but no longer physically held. Keys still under a
   finger are left alone: those are the player's, and note priority already governs them. */
function releaseLatched(t, keep){
  heldNotes.slice().forEach(n => {
    if (n.midi === keep || downKeys.has(n.midi)) return;
    const i = heldNotes.findIndex(x => x.midi === n.midi);
    if (i >= 0) heldNotes.splice(i, 1);
    if (P.mode === "poly") polyOff(n.midi, t);
  });
}

/* Is this note already sounding in the section the key would reach? */
function isLatched(m, sec){
  const inSyn = heldNotes.some(n => n.midi === m) || polyVoices.has(m);
  const inVoc = carriers.has(m);
  if (sec === "bass") return bassHeld.some(n => n.midi === m);
  if (sec === "voc") return inVoc;
  if (sec === "both") return inVoc || inSyn;
  return inSyn;
}
function noteOn(midi, vel, when, forceSec){
  ensureAudio();
  const t = when == null ? ctx.currentTime + .002 : when;
  const m = clampf(midi + octave*12, 0, 127);
  /* forceSec is what MIDI decided from the channel; without one this is a local key. */
  const sec = forceSec || keysTo;
  const wasDown = downKeys.has(m);
  downKeys.add(m);
  /* Hold is a toggle PER NOTE: pressing a note that is already latched releases just that
     one. Done by running the ordinary note-off path with latch momentarily off, so there
     is one release routine rather than a second copy of it here. */
  if (latch && !wasDown && isLatched(m, sec)){
    latch = false;
    noteOff(midi, when, forceSec);
    latch = true;
    paintNow(); paintKeys();
    return;
  }
  /* A key that is already down cannot be pressed again — a second note-on for the same
     pitch is a duplicate message, not a new gesture, and some controllers do send them.
     `wasDown` is what distinguishes that from a deliberate re-press of a latched note. */
  if (sec === "bass"){
    if (P.bass) bassOn(m, vel, t);
    paintNow(); paintKeys(); return;
  }
  if (sec === "voc" || sec === "both"){
    if (!carriers.has(m)) carrierOn(m, vel, t);
    if (sec === "voc"){ paintKeys(); return; }
    /* "both" falls through: the same note also sounds the synth section */
  }
  if (heldNotes.some(n => n.midi === m)) return;
  if (latch && latchReplaces()) releaseLatched(t, m);
  heldNotes.push({midi:m, vel:vel});
  /* While the arp or sequencer is running, held notes are INPUT to it — the arp reads them
     to build its run, the sequencer reads them to transpose. Sounding them directly as well
     stacked a second voice on top of the pattern, which is what made adding a note while
     others were held jump out so loudly. The pattern is the voice; the keys only steer it. */
  /* Auto-start: the FIRST held note starts the pattern, later ones do not restart it —
     adding a note to a running arp should thicken it, not knock it back to step 1.
     `autoStart` remembers that a key started it, so releasing the last key stops it again;
     a transport the player started with the button stays running until they stop it. */
  if (SEQ.mode === "program"){
    /* In program mode a played note WRITES to the selected step rather than starting
       anything. You still hear it, because you are choosing a pitch by ear. */
    const st = SEQ.steps[SEQ.sel];
    if (st){ writeStep(st, m); paintSteps(); }
  } else if (SEQ.motion !== "off" && !SEQ.playing && heldNotes.length === 1){
    SEQ.autoStart = true;
    startPlay();
  }
  if (seqOwnsVoice()){ paintNow(); paintKeys(); return; }
  if (P.mode === "poly"){ polyOn(m, vel, t); paintNow(); paintKeys(); return; }
  const target = pick();
  if (!target) return;

  let attacked = true;
  if (!curVoice || curVoice.released){
    curVoice = buildVoice(target.midi, target.vel, t);
    retriggerLfo();
    if (P.lfod > 0 && lfoFade){
      lfoFade.gain.cancelScheduledValues(t);
      lfoFade.gain.setValueAtTime(0, t);
      lfoFade.gain.linearRampToValueAtTime(1, t + P.lfod);
    } else if (lfoFade) lfoFade.gain.setValueAtTime(1, t);
  } else {
    const g = glideTime(curVoice.midi, target.midi);
    /* legato means fingered portamento: glide and DO NOT retrigger while a note is
       already down. `always` glides and retriggers; `off` neither. */
    const legato = P.gmode === "legato" && heldNotes.length > 1;
    if (legato){ curVoice.setPitch(t, target.midi, g); attacked = false; }
    else curVoice.retrigger(t, target.midi, target.vel, P.gmode === "always" ? g : 0);
  }
  if (mirrorSyn()){
    if (synOut != null && synOut !== target.midi) sendNoteOff(synOut, t);
    /* a legato move to the SAME pitch is not an event; anything else is */
    if (attacked || synOut !== target.midi) sendNoteOn(target.midi, t, target.vel);
    synOut = target.midi;
  }
  paintNow();
}

function noteOff(midi, when, forceSec){
  /* A note-off can legitimately arrive before anything has ever sounded — a controller
     clearing a stuck key, or the page loading with a key already held — and there is no
     audio context yet to time it against. */
  if (!ctx) { heldNotes.length = 0; downKeys.clear(); return; }
  const t = when == null ? ctx.currentTime + .002 : when;
  const m = clampf(midi + octave*12, 0, 127);
  downKeys.delete(m);          // cleared even when Hold swallows the release
  /* The same pitch can be sounding in BOTH sections at once, so an explicit section has to
     win over "is there a carrier on this note" — otherwise the synth's note-off gets eaten
     by the vocoder's copy of the same pitch. */
  const sec = forceSec || keysTo;
  if (sec === "bass"){
    if (!latch) bassOff(m, t);
    paintNow(); paintKeys(); return;
  }
  if (sec === "voc" || sec === "both"){
    if (!latch) carrierOff(m, t);
    if (sec === "voc"){ paintKeys(); return; }
  } else if (!forceSec && carriers.has(m)){
    /* a carrier left over from a previous Keys-play setting still has to be releasable */
    if (!latch) carrierOff(m, t);
    paintKeys(); return;
  }
  /* Hold keeps the note in the HELD set, not merely sounding: an arp latches by continuing
     to read heldNotes, so removing it here would silently empty the arp's input. */
  if (latch){ paintKeys(); return; }
  const i = heldNotes.findIndex(n => n.midi === m);
  if (i >= 0) heldNotes.splice(i, 1);
  /* releasing the last key stops a pattern that a key started */
  if (SEQ.autoStart && SEQ.playing && !heldNotes.length){
    stopPlay();
    SEQ.autoStart = false;
    paintKeys();
    return;
  }
  if (seqOwnsVoice()){ paintNow(); paintKeys(); return; }
  if (P.mode === "poly"){ polyOff(m, t); paintNow(); paintKeys(); return; }
  const target = pick();
  if (!target){
    if (curVoice) curVoice.release(t);
    curVoice = null;
    /* NOT gated on mirrorSyn: a note already sent has to be released whatever the switch
       says now, or it hangs on the external synth forever */
    if (synOut != null){ sendNoteOff(synOut, t); synOut = null; }
  } else if (curVoice && !curVoice.released){
    /* falling back to a note still held is always legato — releasing a finger should
       never re-attack the note underneath it */
    curVoice.setPitch(t, target.midi, glideTime(curVoice.midi, target.midi));
    if (synOut !== target.midi){
      if (synOut != null) sendNoteOff(synOut, t);
      if (mirrorSyn()) sendNoteOn(target.midi, t, target.vel);
      synOut = mirrorSyn() ? target.midi : null;
    }
  }
  paintNow();
}

function allNotesOff(){
  heldNotes.length = 0;
  downKeys.clear();
  /* This is the one path that empties heldNotes without going through noteOff(), so the
     auto-stop has to be repeated here — otherwise switching Hold off, or a panic, leaves a
     key-started pattern running with nothing feeding it. */
  if (SEQ.autoStart && SEQ.playing){ stopPlay(); SEQ.autoStart = false; }
  latch = false;
  const t = ctx ? ctx.currentTime : 0;
  allCarriersOff(t);
  allPolyOff(t);
  allBassOff(t);
  sendAllOff(t);
  synOut = null;
  if (curVoice) curVoice.release(t);
  curVoice = null;
  active.forEach(v => { try{ v.release(t); }catch(e){} });
  paintNow();
  paintKeys();
}

