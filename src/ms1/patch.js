/* ============ the patch ============ */
/* One flat object IS the whole patch. Every key in FACTORY_DEFAULT appears in every
   preset — no inherited values, no optional keys. That is CS·1's P_DEFAULT lesson:
   a patch that omits a parameter must RESET it, not inherit whatever was dialled in
   before the load.

   Real units wherever the value is measurable (Hz, seconds, cents, semitones, dB), and
   normalised 0..1 only where it is genuinely a blend or a depth. Deliberate: an offline
   render can assert "cutoff peaks at 1543 Hz", it cannot assert "0.62 on the cutoff knob". */
const FACTORY_DEFAULT = {
  cat:"lead", tag:"", tn:69,
  o1w:"saw",  o1oct:0, o1semi:0, o1det:0,  o1lvl:1,
  o2w:"off",  o2oct:0, o2semi:0, o2det:0,  o2lvl:0,
  sync:0, o2env:0,
  subw:"sq1", sublvl:0, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:1200, fres:0, fenv:0, fkey:.5, fdrive:0, fhpf:20,
  fa:.004, fd:.4, fs:1, fr:.3,
  aa:.004, ad:.4, as:1, ar:.2,
  lfow:"tri", lfor:5, lfod:.5, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:0, gmode:"off",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"low", bend:2,
  vela:.3, velf:0,
  chorus:"off", ddiv:"off", dtime:250, dfb:.25, dmix:0, rmix:0,
  trim:0,
  /* --- vocoder section. Added in patch v2; older patches simply get these defaults,
     which is the same "a missing key RESETS it" rule everything else obeys. --- */
  voc:0,               // section on/off
  vocbands:16,         // 8 | 16 | 24 analysis/synthesis pairs
  vocq:4.5,            // band Q, both banks
  vocresp:22,          // follower smoothing, Hz — low is smooth, high is articulate
  vocsib:.35,          // unvoiced path: a pitched carrier cannot make "s" or "t"
  vocmix:.9,           // vocoder output level
  vocmod:1,            // modulator input gain
  voccomp:.75,         // modulator compression — what stops the vocoder needing a hot input
  carlvl:.8,           // carrier level into the bank
  /* --- bass section (patch v3). A pedal synth, not a third general-purpose voice: one
     oscillator plus a square sub, a ladder, and a contour. No LFO, no PWM, no effects
     sends — a Taurus has none of that either, and a bass wants to stay dry and centred. */
  bass:0,              // section on/off
  bwave:"saw",         // saw | square
  boct:-1,             // octaves below the played note
  blvl:.85,            // output level
  bsub:.6,             // square sub, one octave under the oscillator
  bcut:420,            // ladder cutoff, Hz
  bres:5,              // resonance, dB into the same mapping the main filter uses
  benv:2.4,            // filter contour depth, octaves
  bdec:.35,            // contour decay — the whole shape, filter and release together
  bglide:0             // seconds per octave
};

const FACTORY = {

/* ---------------- BASSES (8) — play E0..E2, MIDI 28..52 ---------------- */

/* Juno-106 "Synth Bass": one osc doing pulse+saw at once, sub square carrying the
   fundamental, chorus I. New Order / early-house territory. */
rubber:{cat:"bass", tag:"Round Juno bass — pulse over a square sub, chorus on", tn:36,
  o1w:"pulse", o1oct:0, o1semi:0, o1det:0,   o1lvl:.85,
  o2w:"saw",   o2oct:0, o2semi:0, o2det:+6,  o2lvl:.30,
  sync:0, o2env:0, subw:"sq1", sublvl:.70, noisew:"white", noiselvl:0,
  pw:.42, pwm:.06, pwmrate:.35, ring:0, fm:0,
  fcut:180, fres:6, fenv:3.1, fkey:.35, fdrive:4, fhpf:20,
  fa:.002, fd:.28, fs:.10, fr:.20,
  aa:.002, ad:.60, as:.62, ar:.09,
  lfow:"tri", lfor:5.2, lfod:.60, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:0, gmode:"off",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"low", bend:2,
  vela:.35, velf:1.2,
  chorus:"i", ddiv:"off", dtime:250, dfb:.20, dmix:0, rmix:.03,
  trim:-2},

/* SH-101 sub weight. Almost no harmonics above the 3rd — this is the patch that goes
   under a CS·1 pad without arguing with it. Chorus deliberately OFF: modulating a
   near-sine at 40Hz just smears the fundamental. */
tar:{cat:"bass", tag:"Deep sine-sub weight — dub and slow low end, no chorus", tn:31,
  o1w:"tri",  o1oct:0, o1semi:0, o1det:0,   o1lvl:.60,
  o2w:"sine", o2oct:0, o2semi:0, o2det:-4,  o2lvl:.25,
  sync:0, o2env:0, subw:"sin1", sublvl:.95, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:120, fres:1, fenv:1.2, fkey:.20, fdrive:0, fhpf:20,
  fa:.010, fd:.50, fs:.35, fr:.35,
  aa:.012, ad:.80, as:.85, ar:.28,
  lfow:"tri", lfor:4.0, lfod:.80, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:.060, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"low", bend:2,
  vela:.25, velf:.6,
  chorus:"off", ddiv:"off", dtime:250, dfb:.20, dmix:0, rmix:0,
  trim:-6},

/* Pro-One / Blue Monday sequencer bass. Filter decay 130ms with sustain at 4% — the
   note is over tonally long before the amp lets go. That gap is the whole sound. */
flint:{cat:"bass", tag:"Hard plucked saw bass — sixteenth sequences, dies fast", tn:33,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0,   o1lvl:.90,
  o2w:"saw", o2oct:0, o2semi:0, o2det:-9,  o2lvl:.55,
  sync:0, o2env:0, subw:"sq1", sublvl:.35, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:90, fres:9, fenv:3.6, fkey:.30, fdrive:6, fhpf:30,
  fa:.001, fd:.13, fs:.04, fr:.10,
  aa:.001, ad:.30, as:.45, ar:.06,
  lfow:"tri", lfor:5.0, lfod:.50, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:0, gmode:"off",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"low", bend:2,
  vela:.45, velf:1.6,
  chorus:"off", ddiv:"1/16", dtime:125, dfb:.18, dmix:.06, rmix:0,
  trim:0.2},

/* TB-303 / SH-101 acid. Velocity is the accent: velf 2.0 means a vel-127 note opens
   two octaves further than a vel-1 one. gmode legato is the 303 slide. */
gum:{cat:"bass", tag:"Squelchy acid bass — accents on velocity, slides on legato", tn:33,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0, o1lvl:1.00,
  o2w:"off", o2oct:0, o2semi:0, o2det:0, o2lvl:0,
  sync:0, o2env:0, subw:"sq1", sublvl:.15, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:130, fres:16, fenv:4.4, fkey:.55, fdrive:10, fhpf:40,
  fa:.002, fd:.22, fs:.12, fr:.12,
  aa:.003, ad:.40, as:.80, ar:.05,
  lfow:"tri", lfor:5.0, lfod:.50, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:.055, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"low", bend:2,
  vela:.25, velf:2.0,
  chorus:"off", ddiv:"1/16", dtime:125, dfb:.22, dmix:.08, rmix:.02,
  trim:-8.6},

/* Prophet-5 two-osc bass with the drive up. 12 cents of detune, not 20 — past about
   15 cents a bass fundamental beats audibly instead of thickening. */
iron:{cat:"bass", tag:"Driven twin-saw bass — rock and industrial, mid-forward", tn:36,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0,    o1lvl:.90,
  o2w:"saw", o2oct:0, o2semi:0, o2det:-12,  o2lvl:.90,
  sync:0, o2env:0, subw:"sq1", sublvl:.45, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:220, fres:5, fenv:2.4, fkey:.25, fdrive:12, fhpf:25,
  fa:.001, fd:.45, fs:.35, fr:.18,
  aa:.002, ad:.50, as:.88, ar:.10,
  lfow:"tri", lfor:5.0, lfod:.50, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:0, gmode:"off",
  mode:"uni", uni:2, unidet:11, unispread:.25, prio:"low", bend:2,
  vela:.30, velf:1.0,
  chorus:"off", ddiv:"off", dtime:250, dfb:.20, dmix:0, rmix:.02,
  trim:-15.5},

/* Jupiter-8 unison bass. Four voices at 14 cents plus an octave-down osc — the widest
   bass in the bank, and the one most likely to swamp a mix, hence -7dB. */
slab:{cat:"bass", tag:"Wide unison octave bass — chorus sections, big and slow", tn:36,
  o1w:"saw", o1oct:0,  o1semi:0, o1det:0,   o1lvl:.80,
  o2w:"saw", o2oct:-1, o2semi:0, o2det:+7,  o2lvl:.80,
  sync:0, o2env:0, subw:"sq1", sublvl:.50, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:260, fres:3, fenv:2.0, fkey:.30, fdrive:3, fhpf:20,
  fa:.004, fd:.70, fs:.50, fr:.30,
  aa:.006, ad:.60, as:.90, ar:.16,
  lfow:"tri", lfor:4.4, lfod:.70, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:0, gmode:"off",
  mode:"uni", uni:4, unidet:14, unispread:.55, prio:"low", bend:2,
  vela:.30, velf:.8,
  chorus:"ii", ddiv:"off", dtime:250, dfb:.20, dmix:0, rmix:.05,
  trim:-12.7},

/* Fretless-ish. The only bass using FM: a 12% index off osc2 puts a soft inharmonic
   growl on the attack that a filter cannot produce. Juno "E.Bass" with the edge off. */
wax:{cat:"bass", tag:"Soft round bass with a touch of FM growl — sits under pads", tn:38,
  o1w:"tri",  o1oct:0, o1semi:0, o1det:0,   o1lvl:.75,
  o2w:"sine", o2oct:0, o2semi:0, o2det:-5,  o2lvl:.35,
  sync:0, o2env:0, subw:"sin1", sublvl:.50, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:.12,
  fcut:340, fres:2, fenv:1.4, fkey:.40, fdrive:0, fhpf:20,
  fa:.008, fd:.55, fs:.30, fr:.25,
  aa:.010, ad:.50, as:.78, ar:.22,
  lfow:"tri", lfor:4.6, lfod:.90, lfop:6, lfof:0, lfoa:0, lfokey:0,
  glide:.040, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"low", bend:2,
  vela:.50, velf:1.0,
  chorus:"i", ddiv:"off", dtime:250, dfb:.20, dmix:0, rmix:.06,
  trim:-4.3},

/* Moroder "I Feel Love" — narrow pulse, brutal short envelopes, and the sixteenth
   delay at 30% feedback doing half the rhythmic work. HPF at 60Hz leaves the kick room. */
quartz:{cat:"bass", tag:"Ticky sixteenth sequencer bass — delay is part of the patch", tn:36,
  o1w:"pulse", o1oct:0, o1semi:0, o1det:0,   o1lvl:.90,
  o2w:"pulse", o2oct:0, o2semi:0, o2det:+4,  o2lvl:.30,
  sync:0, o2env:0, subw:"sq1", sublvl:.40, noisew:"white", noiselvl:0,
  pw:.30, pwm:.04, pwmrate:.80, ring:0, fm:0,
  fcut:300, fres:8, fenv:3.2, fkey:.50, fdrive:4, fhpf:60,
  fa:.001, fd:.10, fs:.06, fr:.08,
  aa:.001, ad:.18, as:.55, ar:.04,
  lfow:"tri", lfor:5.0, lfod:.50, lfop:0, lfof:0, lfoa:0, lfokey:0,
  glide:0, gmode:"off",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"last", bend:2,
  vela:.40, velf:1.4,
  chorus:"off", ddiv:"1/16", dtime:125, dfb:.30, dmix:.16, rmix:.02,
  trim:4.5},

/* ---------------- LEADS (8) — play A3..A5, MIDI 57..81 ---------------- */

/* a-ha "Take On Me": a pulse with slow PWM, an octave-up saw riding it, delayed
   vibrato, dotted-eighth delay. Glide is OFF — the riff is staccato and a portamento
   smears every leap in it. */
cobalt:{cat:"lead", tag:"Bright octave-stacked PWM lead — staccato hooks", tn:76,
  o1w:"pulse", o1oct:0,  o1semi:0, o1det:0,   o1lvl:.80,
  o2w:"saw",   o2oct:+1, o2semi:0, o2det:+8,  o2lvl:.45,
  sync:0, o2env:0, subw:"sq1", sublvl:.18, noisew:"white", noiselvl:0,
  pw:.35, pwm:.10, pwmrate:.50, ring:0, fm:0,
  fcut:1400, fres:4, fenv:1.8, fkey:.60, fdrive:2, fhpf:90,
  fa:.004, fd:.35, fs:.60, fr:.25,
  aa:.004, ad:.30, as:.90, ar:.12,
  lfow:"tri", lfor:5.4, lfod:.45, lfop:16, lfof:0, lfoa:0, lfokey:1,
  glide:0, gmode:"off",
  mode:"uni", uni:2, unidet:9, unispread:.35, prio:"last", bend:2,
  vela:.30, velf:1.0,
  chorus:"i", ddiv:"1/8d", dtime:375, dfb:.28, dmix:.22, rmix:.14,
  trim:1.4},

/* Minimoog solo lead. Osc2 an octave down and 12 cents sharp, sub filling in — the
   classic three-tier stack. Glide 85ms/oct with legato so scale runs stay clean and
   only deliberate leaps smear. */
ember:{cat:"lead", tag:"Fat Moog solo lead — glide on legato, filter does the vowel", tn:69,
  o1w:"saw", o1oct:0,  o1semi:0, o1det:0,    o1lvl:.80,
  o2w:"saw", o2oct:-1, o2semi:0, o2det:+12,  o2lvl:.70,
  sync:0, o2env:0, subw:"sq1", sublvl:.35, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:620, fres:7, fenv:2.6, fkey:.55, fdrive:8, fhpf:40,
  fa:.012, fd:.55, fs:.55, fr:.30,
  aa:.008, ad:.40, as:.88, ar:.16,
  lfow:"tri", lfor:5.0, lfod:.55, lfop:22, lfof:.25, lfoa:0, lfokey:1,
  glide:.085, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"low", bend:2,
  vela:.35, velf:1.2,
  chorus:"off", ddiv:"1/8", dtime:250, dfb:.25, dmix:.14, rmix:.18,
  trim:-4.4},

/* The quiet one. Triangle plus a sine an octave up, filter nearly open so the envelope
   barely colours it, 45ms amp attack so it breathes in over a CS·1 chord change.
   Positive trim: this is the level a single triangle actually produces. */
plume:{cat:"lead", tag:"Soft whistle lead — melodies that float over CS·1 chords", tn:74,
  o1w:"tri",  o1oct:0,  o1semi:0, o1det:0,   o1lvl:.70,
  o2w:"sine", o2oct:+1, o2semi:0, o2det:-6,  o2lvl:.30,
  sync:0, o2env:0, subw:"sq1", sublvl:0, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:2600, fres:1.5, fenv:1.0, fkey:.70, fdrive:0, fhpf:120,
  fa:.050, fd:.60, fs:.70, fr:.40,
  aa:.045, ad:.50, as:.90, ar:.35,
  lfow:"sine", lfor:5.6, lfod:.70, lfop:20, lfof:0, lfoa:.06, lfokey:1,
  glide:.060, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"last", bend:2,
  vela:.55, velf:.8,
  chorus:"i", ddiv:"1/4", dtime:500, dfb:.34, dmix:.24, rmix:.26,
  trim:-2.3},

/* Jupiter-8 solo. Five unison voices at 16 cents over two saws — the loudest raw patch
   in the bank and the one that most needs its trim measured rather than guessed. */
mercury:{cat:"lead", tag:"Wide unison saw lead — the big detuned solo sound", tn:72,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0,    o1lvl:.85,
  o2w:"saw", o2oct:0, o2semi:0, o2det:+11,  o2lvl:.85,
  sync:0, o2env:0, subw:"sq1", sublvl:.20, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:1700, fres:5, fenv:1.6, fkey:.65, fdrive:4, fhpf:110,
  fa:.012, fd:.50, fs:.65, fr:.30,
  aa:.010, ad:.35, as:.92, ar:.22,
  lfow:"tri", lfor:5.2, lfod:.60, lfop:14, lfof:0, lfoa:0, lfokey:1,
  glide:.030, gmode:"legato",
  mode:"uni", uni:5, unidet:16, unispread:.70, prio:"last", bend:2,
  vela:.30, velf:1.0,
  chorus:"ii", ddiv:"1/8d", dtime:375, dfb:.32, dmix:.24, rmix:.22,
  trim:-2.8},

/* Prophet-5 rock lead: 16dB of drive into an 11dB resonant peak. bend:12 because this
   is the patch people will whole-tone bend on a pitch wheel. */
grit:{cat:"lead", tag:"Driven resonant lead — rock hooks, full-octave bend range", tn:71,
  o1w:"saw",   o1oct:0, o1semi:0, o1det:0,   o1lvl:.95,
  o2w:"pulse", o2oct:0, o2semi:0, o2det:-7,  o2lvl:.55,
  sync:0, o2env:0, subw:"sq1", sublvl:.25, noisew:"white", noiselvl:0,
  pw:.22, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:900, fres:11, fenv:2.2, fkey:.60, fdrive:16, fhpf:130,
  fa:.006, fd:.40, fs:.50, fr:.22,
  aa:.004, ad:.30, as:.90, ar:.12,
  lfow:"tri", lfor:6.0, lfod:.35, lfop:26, lfof:.30, lfoa:0, lfokey:1,
  glide:.045, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"last", bend:12,
  vela:.40, velf:1.4,
  chorus:"off", ddiv:"1/8", dtime:250, dfb:.22, dmix:.12, rmix:.16,
  trim:-13.3},

/* "Axel F" territory: a true 50% square, pwm at zero, one octave-down square for body,
   nothing else. The hollowness is the point — any detune at all ruins it. */
ivory:{cat:"lead", tag:"Clean hollow square lead — exact 50% duty, no detune", tn:73,
  o1w:"pulse", o1oct:0,  o1semi:0, o1det:0, o1lvl:.90,
  o2w:"pulse", o2oct:-1, o2semi:0, o2det:0, o2lvl:.35,
  sync:0, o2env:0, subw:"sq1", sublvl:.25, noisew:"white", noiselvl:0,
  pw:.50, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:1900, fres:3, fenv:1.4, fkey:.75, fdrive:0, fhpf:100,
  fa:.003, fd:.25, fs:.70, fr:.18,
  aa:.002, ad:.20, as:.95, ar:.07,
  lfow:"tri", lfor:5.8, lfod:.80, lfop:10, lfof:0, lfoa:0, lfokey:1,
  glide:0, gmode:"off",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"last", bend:2,
  vela:.35, velf:.8,
  chorus:"i", ddiv:"1/8", dtime:250, dfb:.26, dmix:.18, rmix:.12,
  trim:-0.3},

/* CS-80 "Blade Runner" mood. 350ms filter attack and 120ms amp attack — the note
   arrives, then opens. Pink noise at 10% is the breath; white would hiss. */
ash:{cat:"lead", tag:"Dark breathy lead — slow filter swell, pink-noise breath", tn:64,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0,    o1lvl:.55,
  o2w:"tri", o2oct:0, o2semi:0, o2det:-10,  o2lvl:.40,
  sync:0, o2env:0, subw:"sin1", sublvl:.30, noisew:"pink", noiselvl:.10,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:520, fres:6, fenv:1.1, fkey:.50, fdrive:2, fhpf:60,
  fa:.350, fd:1.20, fs:.55, fr:.80,
  aa:.120, ad:.70, as:.85, ar:.70,
  lfow:"sine", lfor:4.4, lfod:1.10, lfop:24, lfof:.35, lfoa:.05, lfokey:0,
  glide:.100, gmode:"legato",
  mode:"uni", uni:2, unidet:8, unispread:.40, prio:"low", bend:2,
  vela:.45, velf:1.0,
  chorus:"ii", ddiv:"1/4", dtime:500, dfb:.38, dmix:.26, rmix:.40,
  trim:2.4},

/* Jan Hammer / Miami Vice. HPF at 260Hz and a 13dB resonant peak sweeping
   2.4k->9.5k make it thin and hot enough to cut over anything. 34 cents of vibrato is
   more than is polite, which is exactly the sound. bend:12. */
filament:{cat:"lead", tag:"Thin hot bendy lead — heavy vibrato, long dotted delay", tn:79,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0,   o1lvl:.85,
  o2w:"saw", o2oct:0, o2semi:0, o2det:+5,  o2lvl:.35,
  sync:0, o2env:0, subw:"sq1", sublvl:0, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:1500, fres:13, fenv:1.0, fkey:.55, fdrive:6, fhpf:260,
  fa:.006, fd:.30, fs:.65, fr:.25,
  aa:.006, ad:.25, as:.92, ar:.18,
  lfow:"tri", lfor:6.4, lfod:.30, lfop:34, lfof:0, lfoa:0, lfokey:1,
  glide:.090, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"last", bend:12,
  vela:.40, velf:.8,
  chorus:"off", ddiv:"1/8d", dtime:375, dfb:.42, dmix:.30, rmix:.24,
  trim:-1.5},

/* ---------------- OTHERS (4) ---------------- */

/* Juno "E.Piano": a narrow 18% pulse for the tine bite, a triangle an octave up, and
   BOTH envelopes decaying — filter to 12% in 400ms, amp to 28% over 1.1s. Velocity is
   worth 70% of the amp and 1.6 octaves of cutoff, so it plays like a keyboard. */
pearl:{cat:"key", tag:"Plucked electric-piano key — velocity-led, for counterlines", tn:64,
  o1w:"pulse", o1oct:0,  o1semi:0, o1det:0,   o1lvl:.95,
  o2w:"tri",   o2oct:+1, o2semi:0, o2det:+4,  o2lvl:.55,
  sync:0, o2env:0, subw:"sq1", sublvl:.38, noisew:"white", noiselvl:0,
  pw:.18, pwm:.05, pwmrate:.35, ring:0, fm:0,
  fcut:550, fres:4, fenv:2.6, fkey:.65, fdrive:0, fhpf:60,
  fa:.001, fd:.40, fs:.12, fr:.35,
  aa:.002, ad:1.10, as:.28, ar:.30,
  lfow:"tri", lfor:4.8, lfod:1.20, lfop:6, lfof:0, lfoa:0, lfokey:0,
  glide:0, gmode:"off",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"last", bend:2,
  vela:.70, velf:1.6,
  chorus:"i", ddiv:"1/8", dtime:250, dfb:.20, dmix:.12, rmix:.20,
  trim:6.9},

/* OB-Xa "Jump" / Jupiter "Final Countdown". The 45ms FILTER attack is the whole trick —
   instant is a saw stab, 45ms reads as a brass player finding the note. Amp attack
   stays fast (12ms) so the front of the stab is still hard. */
bronze:{cat:"stab", tag:"Brass stab — 45ms filter blip is what makes it read as brass", tn:60,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0,    o1lvl:.90,
  o2w:"saw", o2oct:0, o2semi:0, o2det:-13,  o2lvl:.90,
  sync:0, o2env:0, subw:"sq1", sublvl:.30, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:380, fres:8, fenv:3.0, fkey:.45, fdrive:6, fhpf:45,
  fa:.045, fd:.30, fs:.35, fr:.22,
  aa:.012, ad:.25, as:.85, ar:.13,
  lfow:"tri", lfor:5.0, lfod:.90, lfop:8, lfof:0, lfoa:0, lfokey:1,
  glide:0, gmode:"off",
  mode:"uni", uni:3, unidet:12, unispread:.45, prio:"last", bend:2,
  vela:.45, velf:1.3,
  chorus:"i", ddiv:"1/8", dtime:250, dfb:.18, dmix:.10, rmix:.18,
  trim:-5.1},

/* The Cars "Let's Go" / Van Halen sync lead. o2 is the audible oscillator, hard-synced
   to o1, and the FILTER envelope drives its pitch +19 semitones — so fd:.85 is a
   850ms downward tear, not a filter sweep. fenv stays low (1.0) so the sweep you hear
   is the sync, not the cutoff. */
shard:{cat:"fx", tag:"Sync scream — filter env sweeps the slave pitch, not the cutoff", tn:69,
  o1w:"saw", o1oct:0, o1semi:0, o1det:0, o1lvl:.35,
  o2w:"saw", o2oct:0, o2semi:0, o2det:0, o2lvl:.95,
  sync:1, o2env:19, subw:"sq1", sublvl:0, noisew:"white", noiselvl:0,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:1500, fres:6, fenv:1.0, fkey:.50, fdrive:10, fhpf:150,
  fa:.003, fd:.85, fs:.18, fr:.35,
  aa:.003, ad:.40, as:.90, ar:.12,
  lfow:"tri", lfor:5.6, lfod:.40, lfop:20, lfof:0, lfoa:0, lfokey:1,
  glide:.020, gmode:"legato",
  mode:"mono", uni:1, unidet:0, unispread:0, prio:"last", bend:12,
  vela:.40, velf:1.0,
  chorus:"off", ddiv:"1/8", dtime:250, dfb:.30, dmix:.16, rmix:.20,
  trim:-9.5},

/* The one patch designed to lose. A unison drone at 20 cents and 85% stereo spread, so
   it occupies the sides while CS·1's chords hold the centre; HPF at 90Hz keeps it off
   MS·1's own bass. The -6dB duck is CAT_TRIM's job, not this patch's trim.
   0.28Hz filter LFO gives it slow movement without any note activity. */
moss:{cat:"pad", tag:"Soft wide drone bed — deliberately quiet, lives at the sides", tn:55,
  o1w:"tri", o1oct:0, o1semi:0, o1det:0,    o1lvl:.55,
  o2w:"tri", o2oct:0, o2semi:0, o2det:-17,  o2lvl:.55,
  sync:0, o2env:0, subw:"sin1", sublvl:.35, noisew:"pink", noiselvl:.05,
  pw:.5, pwm:0, pwmrate:.4, ring:0, fm:0,
  fcut:900, fres:1, fenv:.80, fkey:.55, fdrive:0, fhpf:90,
  fa:.900, fd:2.20, fs:.70, fr:1.60,
  aa:.700, ad:1.50, as:.88, ar:1.50,
  lfow:"sine", lfor:.28, lfod:0, lfop:5, lfof:.45, lfoa:.04, lfokey:0,
  glide:.120, gmode:"legato",
  mode:"uni", uni:4, unidet:20, unispread:.85, prio:"low", bend:2,
  vela:.25, velf:.5,
  chorus:"i+ii", ddiv:"1/2", dtime:1000, dfb:.30, dmix:.14, rmix:.45,
  trim:5.1}

};

/* Bank order = program change 0..19, and the order the pad grid fills. */
const FACTORY_ORDER = ["rubber","tar","flint","gum","iron","slab","wax","quartz",
                       "cobalt","ember","plume","mercury","grit","ivory","ash","filament",
                       "pearl","bronze","shard","moss"];

/* Live patch. Everything the panel edits writes straight into here, and a preset load is
   nothing more than replacing its contents key by key. */
const P = Object.assign({}, FACTORY_DEFAULT);

/* Declared up here rather than down in the MIDI section: the panel is built before that
   section runs, and a segmented button paints its initial state on creation — which reads
   MIDI.noteOut, and a `const` in the temporal dead zone throws rather than reading undefined. */
/* `ch` is the OUTPUT channel. The three input channels are all -1 = Omni by default, so
   out of the box everything arrives and — with the vocoder off — plays the synth.
   There is deliberately no "route by split OR by channel" mode: a mode switch on top of
   three channel selects was one control too many. See routeFor(). */
const MIDI = {access:null, in:null, out:null, ch:0, noteOut:false,
              synCh:-1, vocCh:-1, ccCh:-1, bassCh:-1};
const LEARN = {on:false, target:null};
const ccMap = new Map();                 // learned: cc number -> control id
const MAP_KEY = "patchwork-ms1-midimap";
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.platform)
            || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

