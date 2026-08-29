/* ============ theory ============ */
const SHARPS = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const FLATS  = ["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
const FLAT_KEYS = new Set([1,3,5,6,8,10]);

const QUAL = {
  maj:{iv:[0,4,7],      s:"",        min:false},
  min:{iv:[0,3,7],      s:"m",       min:true},
  dim:{iv:[0,3,6],      s:"dim",     min:true},
  sus2:{iv:[0,2,7],     s:"sus2",    min:false},
  sus4:{iv:[0,5,7],     s:"sus4",    min:false},
  maj7:{iv:[0,4,7,11],  s:"maj7",    min:false},
  min7:{iv:[0,3,7,10],  s:"m7",      min:true},
  dom7:{iv:[0,4,7,10],  s:"7",       min:false},
  m7b5:{iv:[0,3,6,10],  s:"m7♭5",    min:true},
  maj9:{iv:[0,4,7,11,14],s:"maj9",   min:false},
  min9:{iv:[0,3,7,10,14],s:"m9",     min:true},
  dom9:{iv:[0,4,7,10,14],s:"9",      min:false},
  add9:{iv:[0,4,7,14],  s:"add9",    min:false},
  madd9:{iv:[0,3,7,14], s:"m(add9)", min:true},
  six:{iv:[0,4,7,9],    s:"6",       min:false},
  m6:{iv:[0,3,7,9],     s:"m6",      min:true}
};

const RN = ["I","♭II","II","♭III","III","IV","♯IV","V","♭VI","VI","♭VII","VII"];

// [semitones above tonic, quality]
const POOLS = {
  bright:[
    [[0,"maj"],[7,"maj"],[9,"min"],[5,"maj"]],
    [[9,"min"],[5,"maj"],[0,"maj"],[7,"maj"]],
    [[0,"maj"],[9,"min"],[5,"maj"],[7,"maj"]],
    [[5,"maj"],[0,"maj"],[7,"maj"],[9,"min"]],
    [[0,"maj"],[7,"maj"],[9,"min"],[4,"min"],[5,"maj"],[0,"maj"],[5,"maj"],[7,"maj"]],
    [[0,"add9"],[5,"maj7"],[7,"sus4"],[7,"maj"]]
  ],
  dusk:[
    [[0,"min"],[8,"maj"],[3,"maj"],[10,"maj"]],
    [[0,"min"],[10,"maj"],[8,"maj"],[10,"maj"]],
    [[0,"min"],[5,"min"],[8,"maj"],[7,"maj"]],
    [[0,"min"],[8,"maj"],[5,"min"],[7,"maj"]],
    [[0,"min"],[3,"maj"],[10,"maj"],[5,"min"]],
    [[0,"min"],[5,"min"],[10,"maj"],[3,"maj"],[8,"maj"],[7,"maj"]]
  ],
  velvet:[
    [[2,"min7"],[7,"dom7"],[0,"maj7"],[9,"min7"]],
    [[0,"maj7"],[9,"min7"],[2,"min7"],[7,"dom7"]],
    [[4,"min7"],[9,"dom7"],[2,"min7"],[7,"dom9"]],
    [[0,"maj7"],[5,"maj7"],[4,"min7"],[9,"dom7"],[2,"min7"],[7,"dom7"]],
    [[2,"m7b5"],[7,"dom7"],[0,"min9"],[8,"maj7"]],
    [[0,"six"],[9,"min7"],[2,"min7"],[7,"dom9"]]
  ],
  haze:[
    [[0,"maj9"],[4,"min7"],[9,"min9"],[5,"maj7"]],
    [[5,"maj7"],[4,"min7"],[9,"min7"],[0,"maj9"]],
    [[9,"min9"],[0,"maj7"],[2,"min9"],[7,"dom7"]],
    [[0,"min9"],[8,"maj7"],[3,"maj7"],[10,"dom7"]],
    [[5,"maj7"],[7,"dom9"],[4,"min7"],[9,"min7"]],
    [[0,"maj7"],[2,"min7"],[4,"min7"],[5,"maj9"]]
  ],
  cinema:[
    [[9,"min"],[5,"add9"],[0,"maj"],[7,"sus4"]],
    [[0,"min"],[10,"maj"],[3,"maj"],[8,"maj"]],
    [[0,"maj"],[4,"min"],[5,"maj"],[5,"min"]],
    [[0,"maj"],[10,"maj"],[5,"maj"],[0,"maj"]],
    [[0,"min"],[8,"maj"],[10,"maj"],[0,"min"]],
    [[9,"min"],[7,"maj"],[5,"maj"],[10,"maj"],[0,"maj"],[7,"sus4"]]
  ],
  drift:[
    [[0,"sus2"],[5,"maj7"],[9,"min7"],[7,"sus4"]],
    [[5,"maj7"],[0,"maj7"],[9,"min7"],[4,"min7"]],
    [[2,"min7"],[5,"maj7"],[0,"maj9"],[7,"add9"]],
    [[0,"madd9"],[8,"maj7"],[5,"min7"],[10,"sus2"]],
    [[0,"maj9"],[7,"sus2"],[9,"min9"],[5,"maj7"]],
    [[0,"sus2"],[10,"maj"],[5,"maj7"],[0,"add9"]]
  ],
  /* lydian — the II major is the whole character, standing in for the raised 4th */
  tide:[
    [[0,"maj7"],[2,"maj"],[0,"maj7"],[7,"maj"]],
    [[0,"maj9"],[2,"maj"],[9,"min7"],[4,"min7"]],
    [[0,"maj7"],[2,"dom7"],[7,"maj"],[0,"maj7"]],
    [[5,"maj7"],[7,"maj"],[0,"maj9"],[2,"maj"]],
    [[0,"add9"],[2,"maj"],[4,"min7"],[5,"maj7"]],
    [[0,"maj7"],[7,"sus2"],[2,"maj"],[9,"min9"]]
  ],
  /* dorian — minor tonic against a MAJOR IV, which is what keeps it out of dusk's territory */
  iron:[
    [[0,"min"],[5,"maj"],[10,"maj"],[0,"min"]],
    [[0,"min"],[10,"maj"],[5,"maj"],[10,"maj"]],
    [[0,"min7"],[5,"maj"],[0,"min7"],[10,"maj"]],
    [[0,"min"],[5,"maj"],[3,"maj"],[10,"maj"]],
    [[0,"min"],[7,"min"],[5,"maj"],[10,"maj"]],
    [[0,"min7"],[10,"maj"],[3,"maj"],[5,"maj"],[0,"min"],[7,"min"]]
  ],
  /* gospel/soul — plagal weight, IV and ♭VII rather than velvet's ii–V spine */
  ember:[
    [[0,"maj7"],[5,"maj7"],[0,"maj7"],[10,"maj"]],
    [[0,"six"],[5,"maj7"],[7,"sus4"],[7,"maj"]],
    [[5,"maj7"],[0,"six"],[5,"maj7"],[7,"dom7"]],
    [[0,"maj9"],[4,"min7"],[5,"maj7"],[7,"dom9"]],
    [[0,"maj7"],[9,"min7"],[5,"maj9"],[7,"sus4"]],
    [[5,"maj7"],[7,"maj"],[9,"min7"],[0,"maj7"],[5,"maj7"],[0,"six"]]
  ],
  /* no thirds anywhere — quartal and open, so it reads as neither major nor minor */
  hollow:[
    [[0,"sus2"],[5,"sus2"],[7,"sus4"],[0,"sus2"]],
    [[0,"sus2"],[10,"sus2"],[5,"sus2"],[7,"sus4"]],
    [[0,"sus4"],[5,"sus2"],[0,"sus2"],[10,"sus2"]],
    [[5,"sus2"],[7,"sus4"],[0,"sus2"],[2,"sus2"]],
    [[0,"sus2"],[7,"sus2"],[5,"sus2"],[10,"sus4"]],
    [[0,"sus2"],[3,"sus2"],[5,"sus4"],[10,"sus2"],[0,"sus2"],[7,"sus4"]]
  ],
  /* minor jazz — half-diminished ii, m6 tonic, dominants resolving into the minor */
  noir:[
    [[0,"min9"],[5,"min7"],[2,"m7b5"],[7,"dom7"]],
    [[0,"m6"],[2,"m7b5"],[7,"dom7"],[0,"min7"]],
    [[0,"min7"],[8,"dom7"],[3,"maj7"],[7,"dom7"]],
    [[2,"m7b5"],[7,"dom9"],[0,"m6"],[10,"dom7"]],
    [[0,"min9"],[10,"dom7"],[8,"maj7"],[7,"dom7"]],
    [[0,"m6"],[9,"m7b5"],[2,"m7b5"],[7,"dom7"],[0,"min9"],[8,"maj7"]]
  ]
};
const MOODS = Object.keys(POOLS);

const COLOR_UP = {maj:["add9","six","maj7"],min:["min7","madd9"],maj7:["maj9"],min7:["min9"],dom7:["dom9"]};

/* What a pad may be swapped to: the seven degrees of the key as triad + seventh.
   Minor also carries the major V / V7 — harmonic-minor dominants are idiomatic and the
   mood pools already lean on them, so leaving them out would forbid a normal cadence. */
const DIATONIC = {
  major:[
    [0,"maj"],[0,"maj7"],   [2,"min"],[2,"min7"],   [4,"min"],[4,"min7"],
    [5,"maj"],[5,"maj7"],   [7,"maj"],[7,"dom7"],   [9,"min"],[9,"min7"],
    [11,"dim"],[11,"m7b5"]
  ],
  minor:[
    [0,"min"],[0,"min7"],   [2,"dim"],[2,"m7b5"],   [3,"maj"],[3,"maj7"],
    [5,"min"],[5,"min7"],   [7,"min"],[7,"min7"],[7,"maj"],[7,"dom7"],
    [8,"maj"],[8,"maj7"],   [10,"maj"],[10,"dom7"]
  ]
};

function pick(a){return a[Math.floor(Math.random()*a.length)];}

/* Mode comes from the chord built on the tonic, not the first chord — plenty of major
   templates open on vi. The few templates with no tonic chord (ii–V turnarounds) fall
   back to looking for flat-side degrees, and otherwise read as major. */
function isMinorMode(chords){
  const tonic = chords.find(c => c.r === 0);
  if (tonic) return QUAL[tonic.q].min;
  return chords.some(c => (c.r === 3 || c.r === 8 || c.r === 10) && !QUAL[c.q].min);
}

const expand = t => t.map(c => ({r:c[0], q:c[1], bars:1}));

const moodHas = (mood, wantMinor) => POOLS[mood].some(t => isMinorMode(expand(t)) === wantMinor);

function makeProgression(moodSel, want, mode){
  const wantMinor = mode === "minor" ? true : mode === "major" ? false : null;

  let mood;
  if (moodSel === "any"){
    /* with a mode forced, only roll moods that can actually satisfy it — no point
       picking Dusk for a major request and then reporting a fallback */
    const ok = wantMinor === null ? MOODS : MOODS.filter(m => moodHas(m, wantMinor));
    mood = pick(ok.length ? ok : MOODS);
  } else {
    mood = moodSel;
  }

  const pool = POOLS[mood];
  let candidates = pool, fallback = false;
  if (wantMinor !== null){
    const match = pool.filter(t => isMinorMode(expand(t)) === wantMinor);
    if (match.length) candidates = match;
    else fallback = true;      // this mood has nothing in that mode; say so rather than fake it
  }
  const seedTpl = pick(candidates);
  /* mode is fixed by the seed template — truncating can remove the tonic chord, so
     don't re-derive it from the trimmed result or the spelling flips mid-edit */
  const minor = isMinorMode(expand(seedTpl));
  let chords = expand(seedTpl);

  if (want && want !== chords.length){
    /* only splice in templates of the same mode; a mood's pool mixes major and minor
       templates, and joining across them wanders out of the key */
    const same = pool.filter(t => isMinorMode(expand(t)) === minor);
    const from = same.length ? same : pool;
    let prev = seedTpl, guard = 0;
    while (chords.length < want && guard++ < 32){
      let tpl = pick(from);
      /* don't draw the same template twice running — otherwise a 12 is often one
         4-bar loop three times. Thin pools (some moods have a single minor template)
         fall through after a few tries and repeat, which is the right fallback. */
      for (let t = 0; from.length > 1 && tpl === prev && t < 6; t++) tpl = pick(from);
      prev = tpl;
      const next = expand(tpl);
      const last = chords[chords.length - 1];
      if (next.length > 1 && last && next[0].r === last.r && next[0].q === last.q) next.shift();
      chords = chords.concat(next);
    }
    chords = chords.slice(0, want);
  }

  const colorChance = (mood === "bright" || mood === "cinema") ? 0.18 : 0.3;
  for (const ch of chords){
    if (Math.random() < colorChance && COLOR_UP[ch.q]) ch.q = pick(COLOR_UP[ch.q]);
  }
  return {mood, chords, minor, fallback};
}

/* A minor key borrows the signature of its relative major, three semitones up — so the
   sharp/flat choice keys off that, not off the tonic. C minor spells ♭VI as A♭, not G♯. */
function spellPc(keyPc, minor){ return (((keyPc + (minor ? 3 : 0)) % 12) + 12) % 12; }

function noteName(pc, keyPc, minor){
  return (FLAT_KEYS.has(spellPc(keyPc, minor)) ? FLATS : SHARPS)[((pc%12)+12)%12];
}
const LETTERS   = ["C","D","E","F","G","A","B"];
const LETTER_PC = [0,2,4,5,7,9,11];
/* how many letter-steps above the tonic each interval sits — mirrors the RN table above,
   so ♭VII is always the seventh letter flattened, never the sixth letter sharpened */
const RN_STEP   = [0,1,1,2,2,3,3,4,5,5,6,6];

/* Spell a root from its scale degree rather than a fixed chromatic table. A table keyed
   only on the key signature can't spell borrowed chords: ♭VII in C major is B♭, but C
   major is a sharp-side key, so any lookup table hands back A♯. */
function rootName(r, keyPc, minor){
  const tonic = noteName(keyPc, keyPc, minor);
  const idx   = (LETTERS.indexOf(tonic[0]) + RN_STEP[(((r % 12) + 12) % 12)]) % 7;
  const target = (((keyPc + r) % 12) + 12) % 12;
  let acc = (((target - LETTER_PC[idx]) % 12) + 12) % 12;
  if (acc > 6) acc -= 12;
  /* nothing in the pools needs a double accidental; if that changes, stay readable */
  if (acc < -1 || acc > 1) return noteName(keyPc + r, keyPc, minor);
  return LETTERS[idx] + (acc === -1 ? "♭" : acc === 1 ? "♯" : "");
}

function chordName(ch, keyPc, minor){
  return rootName(ch.r, keyPc, minor) + QUAL[ch.q].s;
}
function romanName(ch){
  const r = RN[((ch.r%12)+12)%12];
  return QUAL[ch.q].min ? r.toLowerCase() : r;
}

/* voice leading: pick the inversion/octave whose center sits closest to the last one */
function voiceChord(ch, keyPc, prevCenter){
  let base = 48 + ((keyPc + ch.r) % 12);
  while (base < 52) base += 12;
  while (base > 63) base -= 12;
  const tones = QUAL[ch.q].iv.map(i => base + i);
  const target = prevCenter == null ? 64 : prevCenter;
  let best = null;
  for (let inv = 0; inv < tones.length; inv++){
    const cand = tones.slice();
    for (let k = 0; k < inv; k++) cand[k] += 12;
    cand.sort((a,b) => a-b);
    for (const oct of [-12,0,12]){
      const c = cand.map(n => n+oct);
      if (c[0] < 50 || c[c.length-1] > 84) continue;
      const center = c.reduce((a,b)=>a+b,0)/c.length;
      const score = Math.abs(center - target) + (c[0] < 54 ? 3 : 0);
      if (!best || score < best.score) best = {score, notes:c, center};
    }
  }
  return best || {notes:tones, center:tones[0]};
}
function bassNote(ch, keyPc){
  let n = 36 + ((keyPc + ch.r) % 12);
  if (n < 38) n += 12;
  return n;
}

