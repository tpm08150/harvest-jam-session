
/* ---- SQ·1 on a control surface ----
   ⚠️ THE PADS ARE THE TRACK, NOT THE RACK OF TRACKS. Sixteen tracks and sixteen pads is the
   same tidy coincidence the launcher had and the same wrong picture: what you are doing at
   this panel is writing a pattern, and a grid that spent all sixteen pads on which track you
   are looking at would leave nothing to write it with.

   So the pads are the SELECTED track's steps — the shared paged grid on a synth track, and
   eight lanes over two pages on a drum one — and the track is chosen with the pair beside
   the encoders, which is what that pair does everywhere else. */

/* ⚠️ ONE BANK, AND THAT IS WHAT MAKES THE ARROWS THE TRACK SELECTOR. There were two — Track
   and Feel — and the pair beside the encoders pages banks BEFORE it asks a panel for its own
   bump, so walking to track 5 meant paging past a bank first and the arrows appeared to do
   nothing every other press. On a sixteen-track sequencer the track IS the navigation, and
   everything worth turning fits in eight knobs anyway. Two banks were never worth the cost.

   Key and Scale mean nothing on a drum track and are simply absent there; six controls and
   two dark encoders is more honest than eight with two that do nothing. */
function surfaceControls(){
  const t = cur();
  const T = t.style === "drum" ? t.drum.T : t.synth.seq.SEQ;
  const out = [
    Patchwork.surface.option(lenSel, "Steps", "Stp"),
    Patchwork.surface.option(rateSel, "Rate", "Rat")
  ];
  if (t.style === "synth"){
    out.push(Patchwork.surface.option(keySel, "Key", "Key"));
    out.push(Patchwork.surface.option(scaleSel, "Scale", "Scl"));
  }
  /* ⚠️ STYLE IS NOT ON A KNOB. Drum or synth is a decision about what a track IS — it changes
     which grid the pads are, which controls exist and what the screen says — and a thing that
     large arriving from a knob brushed in passing is the wrong shape for it. It is on ">",
     which is a press, and on the panel, which is where you were when you decided. Mute stays,
     because muting is a performance and you do it mid-bar. */
  out.push(Patchwork.surface.segment(muteSeg, "Mute", "Mut"));
  out.push({
    id: "swing", label: "Swing", short: "Swg",
    text: () => (T.swing <= .505 ? "straight" : Math.round((T.swing - .5) * 200) + "%"),
    get: () => (T.swing - .5) / .25,
    set: v => { T.swing = .5 + Math.max(0, Math.min(1, v)) * .25; }
  });
  /* Velocity is the drum track's, because a synth step carries its own accent and the
     shared sequencer already scales by it. */
  if (t.style === "drum") out.push({
    id: "vel", label: "Velocity", short: "Vel",
    text: () => String(t.drum.T.vel),
    get: () => t.drum.T.vel / 127,
    set: v => { t.drum.T.vel = Math.max(1, Math.round(v * 127)); }
  });

  /* ⚠️ THE LAST ENCODER IS ALWAYS WHAT A PRESS WRITES, on either face — the lane on a synth
     track and the write mode on a drum one. Both answer the same question, which is what a
     pad or a click is about to do to a step, and it is the one thing on this panel you
     change while the other hand is on the grid.

     ⚠️ PINNED TO EIGHT rather than appended, because the two faces have different numbers of
     controls before it. A knob whose meaning is "the last one" should not be the seventh on
     one track and the eighth on the next: the hand goes to the end of the row, and the end
     of the row is where it is. */
  const list = out.filter(Boolean);
  while (list.length < 7) list.push(null);
  list.length = 7;
  list.push(t.style === "drum"
    ? Patchwork.surface.segment(writeSeg, "Writes", "Wrt")
    : Patchwork.surface.segment(laneSeg, "Edits", "Edt"));
  return list;
}

/* ⚠️ THE PAIR BESIDE THE ENCODERS WALKS THE TRACKS, which is what it does on every other
   panel that has more than one of something — DR·1's lanes, PM·1's banks. Sixteen is too
   many to page with pads that are busy holding a pattern. */
function surfaceBump(dir){
  const to = Math.max(0, Math.min(TRACKS - 1, sel + (dir > 0 ? 1 : -1)));
  if (to === sel) return null;
  sel = to;
  showTrack();
  /* ⚠️ AND SAY SO. Sixteen tracks that look identical from the pads is exactly the case where
     a silent move leaves you editing something you did not mean to. The flash names the track
     and what kind it is; the resting display carries the number from then on. */
  const t = cur();
  const T = t.style === "drum" ? t.drum.T : t.synth.seq.SEQ;
  return {name: "Track", value: (sel + 1) + " " + t.style + " " + T.len + "×" + T.rate};
}
/* ">" flips the selected track between the two kinds, because that is the one decision this
   panel makes that is not a value on a knob. */
function surfaceAction(){
  const t = cur();
  setStyle(sel, t.style === "drum" ? "synth" : "drum");
  showTrack();
  return cur().style;
}
/* ⚠️ AND FUNC + ">" WALKS PLAY AND STEP PROGRAMMING, which is the other switch on this panel
   that is a mode rather than a value. It is a synth track's only — a drum track has no lit
   step to land things on — so it says so rather than silently doing nothing. */
function surfaceAltAction(){
  const t = cur();
  if (t.style !== "synth") return "synth only";
  const seq = t.synth.seq;
  const to = seq.SEQ.mode === "play" ? "step" : "play";
  /* Through the panel's own button, so whatever a click does happens here too. */
  const b = modeSeg.querySelector('button[data-p="' + to + '"]');
  if (b) b.click();
  return to === "play" ? "Play" : "Step prog";
}

/* ---- the steps, on the pads ----
   A synth track hands the shared factory the five properties it asks for, exactly as PM·1
   does — one bank of sixteen, paged, with the hold-and-press tie and the erase memory all
   coming along. A drum track cannot use it (eight lanes, not one line), so it draws its own:
   the top row is the selected lane's steps and the bottom row picks which lane. */
let synthSurface = null, synthFor = -1;
function synthPads(){
  if (synthFor !== sel){
    synthSurface = Patchwork.makeSeqSurface(cur().synth.seq, {
      /* ⚠️ THE TRACK NUMBER BELONGS ON THE SCREEN. Every other panel has one sequencer, so
         its grid never had to say which — and here there are sixteen, and "1-16" alone tells
         you the step range of a track you cannot see the name of. Static rather than a
         function because the surface is rebuilt whenever the selection moves. */
      label: "T" + (sel + 1),
      repaint: () => { if (grid) grid.paint(); }
    });
    synthFor = sel;
  }
  return synthSurface;
}

const DRUM_PAGE = 8;
/* One definition of "which eight", because it was written out four times and one of the four
   was wrong. */
const drumPages = t => Math.max(1, Math.ceil(t.T.len / DRUM_PAGE));
const drumBase = t => Math.min(t.T.bank || 0, drumPages(t) - 1) * DRUM_PAGE;
const drumSurface = {
  /* ⚠️ THE PAGE IS T.bank, and this read a bankBase() that does not exist — so the guard
     handed back 0 and the screen said "1-8" from whichever page you were actually on. A
     readout that is wrong is worse than none: it is the one thing on the controller telling
     you where you are, and it was lying with total confidence. */
  label: () => {
    const t = cur().drum, l = t.lanes[t.T.lane] || t.lanes[0];
    const base = drumBase(t);
    return "T" + (sel + 1) + " " + (l ? l.name : "") + "  " + (base + 1) + "-"
         + Math.min(t.T.len, base + DRUM_PAGE);
  },
  pages: () => drumPages(cur().drum),
  page: () => drumBase(cur().drum) / DRUM_PAGE,
  setPage: p => {
    const t = cur().drum;
    t.T.bank = Math.max(0, Math.min(drumPages(t) - 1, p));
    /* ⚠️ THE SCREEN FOLLOWS THE PADS. Paging is the one gesture here that changes what the
       on-screen grid is showing you the edit range of, and nothing else would repaint it. */
    paintDrum();
  },
  cells: () => {
    const out = new Array(16).fill(null);
    const t = cur().drum, base = drumBase(t);
    const lane = t.lanes[t.T.lane] || t.lanes[0];
    const head = t.playingStep();
    /* ⚠️ TOP ROW IS THE PATTERN, BOTTOM ROW IS THE KIT. Eight lanes and eight steps a page
       rather than sixteen steps and no way to change lane: the lane you are on is a thing
       you change constantly while writing drums, and reaching for a menu to do it is the
       difference between writing a part and configuring one. */
    for (let k = 0; k < DRUM_PAGE; k++){
      const i = base + k;
      if (i >= t.T.len) continue;
      const v = lane ? lane.steps[i] : 0;
      out[k + 8] = i === head ? {colour: "white", on: true}
                 : {colour: v === 2 ? "red" : "amber", on: !!v};
    }
    t.lanes.forEach((l, li) => {
      const has = l.steps.some(v => v);
      out[li] = li === t.T.lane ? {colour: "white", on: true}
                                : {colour: "cyan", on: has};
    });
    return out;
  },
  down: (cell, vel, mods) => {
    const t = cur().drum;
    if (cell < 8){ t.T.lane = cell; paintDrum(); return; }
    const i = drumBase(t) + (cell - 8);
    if (i >= t.T.len) return;
    /* ⚠️ FUNC IS THE ACCENT, whatever the panel's write mode says. On the hardware there is
       no second control to reach for mid-take and a modifier under the same thumb is free —
       which is the opposite of the argument on screen, where a mode you set once beats
       holding a key to draw the thing you draw most. Two answers because they are two
       different hands. */
    t.press(t.T.lane, i, mods && mods.accent ? true : undefined);
    paintDrum();
  }
};
function surfaceGrid(){ return cur().style === "drum" ? drumSurface : synthPads(); }
