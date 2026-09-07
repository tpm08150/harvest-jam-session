
/* ---- SQ·1 on a control surface ----
   ⚠️ THE PADS ARE THE TRACK, NOT THE RACK OF TRACKS. Sixteen tracks and sixteen pads is the
   same tidy coincidence the launcher had and the same wrong picture: what you are doing at
   this panel is writing a pattern, and a grid that spent all sixteen pads on which track you
   are looking at would leave nothing to write it with.

   So the pads are the SELECTED track's steps — the shared paged grid on a synth track, and
   eight lanes over two pages on a drum one — and the track is chosen with the pair beside
   the encoders, which is what that pair does everywhere else. */

let surfBank = 0;
function surfaceBanks(){
  return [{name: "Track"}, {name: "Feel"}];
}
const surfaceBankNow = () => Math.min(surfBank, surfaceBanks().length - 1);
function setSurfaceBank(i){ surfBank = Math.max(0, Math.min(surfaceBanks().length - 1, i)); }

function surfaceControls(){
  const t = cur();
  const T = t.style === "drum" ? t.drum.T : t.synth.seq.SEQ;
  if (surfaceBankNow() === 0){
    return [
      Patchwork.surface.option(lenSel, "Steps", "Stp"),
      Patchwork.surface.option(rateSel, "Rate", "Rat"),
      Patchwork.surface.segment(styleSeg, "Style", "Sty"),
      Patchwork.surface.segment(muteSeg, "Mute", "Mut")
    ].filter(Boolean);
  }
  /* Swing and velocity are the two things you turn while it runs; key and scale only mean
     anything on a synth track, so they are simply absent on a drum one. */
  const out = [{
    id: "swing", label: "Swing", short: "Swg",
    text: () => (T.swing <= .505 ? "straight" : Math.round((T.swing - .5) * 200) + "%"),
    get: () => (T.swing - .5) / .25,
    set: v => { T.swing = .5 + Math.max(0, Math.min(1, v)) * .25; }
  }, {
    id: "vel", label: "Velocity", short: "Vel",
    text: () => String(t.style === "drum" ? t.drum.T.vel : Math.round(t.synth.seq.SEQ.vel || 100)),
    get: () => (t.style === "drum" ? t.drum.T.vel : 100) / 127,
    set: v => { if (t.style === "drum") t.drum.T.vel = Math.max(1, Math.round(v * 127)); }
  }];
  if (t.style === "synth"){
    out.push(Patchwork.surface.option(keySel, "Key", "Key"));
    out.push(Patchwork.surface.option(scaleSel, "Scale", "Scl"));
  }
  return out.filter(Boolean);
}

/* ⚠️ THE PAIR BESIDE THE ENCODERS WALKS THE TRACKS, which is what it does on every other
   panel that has more than one of something — DR·1's lanes, PM·1's banks. Sixteen is too
   many to page with pads that are busy holding a pattern. */
function surfaceBump(dir){
  const to = Math.max(0, Math.min(TRACKS - 1, sel + (dir > 0 ? 1 : -1)));
  if (to === sel) return null;
  sel = to;
  showTrack();
  return {name: "Track", value: String(sel + 1) + " · " + cur().style};
}
/* ">" flips the selected track between the two kinds, because that is the one decision this
   panel makes that is not a value on a knob. */
function surfaceAction(){
  const t = cur();
  setStyle(sel, t.style === "drum" ? "synth" : "drum");
  showTrack();
  return cur().style;
}

/* ---- the steps, on the pads ----
   A synth track hands the shared factory the five properties it asks for, exactly as PM·1
   does — one bank of sixteen, paged, with the hold-and-press tie and the erase memory all
   coming along. A drum track cannot use it (eight lanes, not one line), so it draws its own:
   the top row is the selected lane's steps and the bottom row picks which lane. */
let synthSurface = null, synthFor = -1;
function synthPads(){
  if (synthFor !== sel){ synthSurface = Patchwork.makeSeqSurface(cur().synth.seq,
    {repaint: () => { if (grid) grid.paint(); }}); synthFor = sel; }
  return synthSurface;
}

const DRUM_PAGE = 8;
const drumSurface = {
  label: () => {
    const t = cur().drum, l = t.lanes[t.T.lane] || t.lanes[0];
    const base = (t.bankBase ? t.bankBase() : 0);
    return "T" + (sel + 1) + " " + (l ? l.name : "") + "  " + (base + 1) + "-"
         + Math.min(t.T.len, base + DRUM_PAGE);
  },
  pages: () => Math.max(1, Math.ceil(cur().drum.T.len / DRUM_PAGE)),
  page: () => Math.min(cur().drum.T.bank || 0, Math.max(0, Math.ceil(cur().drum.T.len / DRUM_PAGE) - 1)),
  setPage: p => { cur().drum.T.bank = Math.max(0, Math.min(Math.ceil(cur().drum.T.len / DRUM_PAGE) - 1, p)); },
  cells: () => {
    const out = new Array(16).fill(null);
    const t = cur().drum, base = (t.T.bank || 0) * DRUM_PAGE;
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
    const i = (t.T.bank || 0) * DRUM_PAGE + (cell - 8);
    if (i >= t.T.len) return;
    /* Func writes an accent outright rather than walking to it, the same shortcut DR·1's
       pads make: three presses to accent a step is two too many mid-take. */
    const l = t.lanes[t.T.lane];
    if (!l) return;
    if (mods && mods.accent) l.steps[i] = l.steps[i] === 2 ? 0 : 2;
    else t.press(t.T.lane, i);
    paintDrum();
  }
};
function surfaceGrid(){ return cur().style === "drum" ? drumSurface : synthPads(); }
