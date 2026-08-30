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

/* While the arpeggiator runs, held notes are INPUT to it, not notes in their own right:
   the arp is already mirroring what actually sounds, so sending the held keys as well
   would put a sustained note out under it that nothing ever releases. */
/* The bass section is BS·1 now. */

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

/* The vocoder carrier is VC·1 now. */

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

/* Is this note already sounding? One voice now, so there is one place to look. */
function isLatched(m){
  return heldNotes.some(n => n.midi === m) || polyVoices.has(m);
}
function noteOn(midi, vel, when, forceSec){
  ensureAudio();
  const t = when == null ? ctx.currentTime + .002 : when;
  const m = clampf(midi + octave*12, 0, 127);
  const wasDown = downKeys.has(m);
  downKeys.add(m);
  /* Hold is a toggle PER NOTE: pressing a note that is already latched releases just that
     one. Done by running the ordinary note-off path with latch momentarily off, so there
     is one release routine rather than a second copy of it here. */
  if (latch && !wasDown && isLatched(m)){
    latch = false;
    noteOff(midi, when, forceSec);
    latch = true;
    paintNow(); paintKeys();
    return;
  }
  /* A key that is already down cannot be pressed again — a second note-on for the same
     pitch is a duplicate message, not a new gesture, and some controllers do send them.
     `wasDown` is what distinguishes that from a deliberate re-press of a latched note. */
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
    if (st){
      /* ⚠️ THE WHOLE HELD CHORD, not just the note that arrived. This is the gesture the
         panel documents — click a step, then play it — and it ran once per note-on, each
         one overwriting the last, so a triad left the third note and nothing else. Reading
         the held set instead means holding a chord writes a chord and playing one note
         writes one note, with no mode to arm and nothing new to learn. */
      const ns = heldNotes.map(h => h.midi).sort((a, b) => a - b);
      if (ns.length) writeStep(st, ns[0], ns.slice(1).map(x => x - ns[0]));
      else writeStep(st, m);
      paintSteps();
    }
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
  allPolyOff(t);
  sendAllOff(t);
  synOut = null;
  if (curVoice) curVoice.release(t);
  curVoice = null;
  active.forEach(v => { try{ v.release(t); }catch(e){} });
  paintNow();
  paintKeys();
}

