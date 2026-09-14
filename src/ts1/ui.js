
/* ============ panel ============ */
/* Segments and two faders. There is no keyboard, no grid and no patch browser, and that is
   the design rather than an unfinished version of one: every control here changes the same
   single gesture, and a transition you had to program would be one you reached for after
   the moment had passed. */
function seg(sel, attr, get, set){
  const g = $(sel);
  if (!g) return function(){};
  const paint = () => g.querySelectorAll("button").forEach(b =>
    b.classList.toggle("on", b.dataset[attr] === String(get())));
  g.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    set(b.dataset[attr]); paint(); paintRead();
  });
  paint();
  return paint;
}

const paintBars   = seg("#tsBars", "b", () => TS.bars, v => { TS.bars = +v; });
const paintShape  = seg("#tsShapeSeg", "s", () => TS.shape, v => { TS.shape = v; });
const paintChar   = seg("#tsChar", "c", () => TS.character, v => { TS.character = v; });
const paintFill   = seg("#tsFill", "f", () => TS.fill,
                        v => { TS.fill = v; TS.fillVariant = 0; fillVariants(); });
const paintCarry  = seg("#tsCarry", "k", () => TS.carry, v => { TS.carry = +v; });

/* ---- which of the ten ----
   Rebuilt when the family changes, because the names are the family's. Disabled rather than
   hidden with the fill off: a control that vanishes moves everything beside it, and this row
   is one somebody is reaching for in a hurry. */
const variantSel = $("#tsVariant");
function fillVariants(){
  const list = fillList(TS.fill);
  variantSel.textContent = "";
  list.forEach((f, i) => variantSel.appendChild(Object.assign(
    document.createElement("option"), {value: String(i), textContent: (i + 1) + ". " + f.name})));
  variantSel.disabled = !list.length;
  if (!list.length) variantSel.appendChild(Object.assign(
    document.createElement("option"), {textContent: "—"}));
  variantSel.value = String(Math.min(TS.fillVariant, Math.max(0, list.length - 1)));
  TS.fillVariant = list.length ? +variantSel.value : 0;
}
variantSel.addEventListener("change", () => {
  TS.fillVariant = +variantSel.value || 0;
  paintRead();
});
fillVariants();
const paintImpact = seg("#tsImpact", "i", () => TS.impact ? "on" : "off",
                        v => { TS.impact = v === "on"; });

/* A control surface reads and writes these the same way a pointer does — see the same
   registry in bs1/ui.js. All four are already 0-1. */
const faderReg = {};
function fader(sel, get, set, fmt){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  faderReg[sel] = {get, set: v => { set(Math.max(0, Math.min(1, v))); paintF(); },
                   text: () => fmt(get())};
  function paintF(){
    cap.style.left = (Math.max(0, Math.min(1, get())) * 100) + "%";
    val.textContent = fmt(get());
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      set(Math.max(0, Math.min(1, (cx - r.left) / r.width)));
      paintF();
    };
    move(e); el.classList.add("dragging");
    const up = () => { el.classList.remove("dragging");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  paintF();
  return paintF;
}
const paintDepth = fader("#depthF", () => TS.depth, v => { TS.depth = v; },
                         v => Math.round(v * 100) + "%");
const paintSpace = fader("#spaceF", () => TS.space, v => { TS.space = v; },
                         v => Math.round(v * 100) + "%");
const paintFx = fader("#fxF", () => TS.fxLevel, v => { TS.fxLevel = v; },
                      v => Math.round(v * 100) + "%");
const paintFillLvl = fader("#fillLvlF", () => TS.fillLevel, v => { TS.fillLevel = v; },
                           v => Math.round(v * 100) + "%");

/* ---- the readout ----
   Between arming and landing there is nothing to hear for up to eight bars, so the panel
   has to carry the whole answer: what is coming, and how long until it arrives. Without
   the countdown, arming a long transition is indistinguishable from a dead button. */
const armBtn = $("#arm");
const shapeEl = $("#tsShape"), lenEl = $("#tsLen"), whenEl = $("#tsWhen");
const fillMeter = $(".ts-fill");

function label(){
  const c = TS.character === "air" ? "Air" : TS.character === "siren" ? "Siren" : "Roll";
  const f = currentFill();
  return (TS.shape === "rise" ? "Rise" : "Fall") + " · " + c
       + (f ? " · " + f.name : "")
       + (TS.carry ? " · carry " + TS.carry : "");
}
/* ⚠️ WRITTEN ONLY WHEN IT CHANGED: while armed this runs every frame, and four texts and a width set to
   what they already were are still four changes to the page and a layout. */
function setText(el, s){ if (el.textContent !== s) el.textContent = s; }
function setWidth(el, w){ if (el && el.style.width !== w) el.style.width = w; }
function paintRead(){
  setText(shapeEl, label());
  setText(lenEl, TS.bars + (TS.bars === 1 ? " bar" : " bars"));
  armBtn.classList.toggle("on", TS.armed);
  setText(armBtn, TS.armed ? "Cancel" : "Arm");
  const left = untilLanding();
  if (!TS.armed){
    setText(whenEl, "Idle — arm it and it lands on the next boundary");
    setWidth(fillMeter, "0%");
    root.classList.remove("ts-armed");
    return;
  }
  root.classList.add("ts-armed");
  const beats = left / Patchwork.clock.beatSeconds();
  setText(whenEl, left > .05
    ? "Lands in " + (beats >= 4 ? (beats / 4).toFixed(1) + " bars" : beats.toFixed(1) + " beats")
    : "Landing");
  if (fillMeter){
    const dur = Math.max(.001, TS.landAt - TS.startAt);
    const done = Math.max(0, Math.min(1, 1 - left / dur));
    /* in the form the browser reads back — "0.0%" returns as "0%", and a compare that never matched
       would write every frame */
    setWidth(fillMeter, Math.round(done * 1000) / 10 + "%");
  }
}

armBtn.addEventListener("click", () => { if (TS.armed) cancel(); else schedule(); paintRead(); });
$("#fire").addEventListener("click", () => { if (TS.armed) cancel(); fireNow(); paintRead(); });
$("#panic").addEventListener("click", () => { cancel(); paintRead(); });

/* Frames rather than an interval while armed: the countdown is a moving number and this is the only
   thing on the panel that animates. ⚠️ AND NO FRAMES AT ALL OTHERWISE. This asked for one sixty times a
   second forever to check a flag; a change wakes it now, and a quarter-second timer catches an arm
   nothing announced. See Patchwork.animate in shell/host.js. */
const countdown = Patchwork.animate(() => { if (TS.armed) paintRead(); }, () => TS.armed, 250);
onChange(paintRead);
onChange(() => countdown.wake());
paintRead();

/* ---- TS·1 on a control surface ----
   ⚠️ THIS PANEL IS MOSTLY LISTS. Fill, length, shape, character, carry and impact are all
   rows of buttons, and the four faders are the only continuous things on it — which is why
   the ordinary eight are the faders and the second eight are the rows. It is the same split
   every other panel has, arriving at a different place because the panel is a different
   shape: what you turn while it runs, then what you set before you arm it.

   And ">" is Arm, because there is exactly one thing this instrument does and that is it. */
const TS_CTL = [["#depthF", "Depth", "Dep"], ["#spaceF", "Space", "Spc"],
                ["#fxF", "FX", "FX"], ["#fillLvlF", "Fill level", "Fil"]];
const TS_ALT = [["tsFill", "Fill", "Fil"], ["tsBars", "Bars", "Bar"],
                ["tsShapeSeg", "Shape", "Shp"], ["tsChar", "Character", "Chr"],
                ["tsCarry", "Carry", "Cry"], ["tsImpact", "Impact", "Imp"]];
function surfaceControls(){
  return TS_CTL.filter(c => faderReg[c[0]]).map(c => ({
    id: c[0].slice(1), label: c[1], short: c[2],
    text: faderReg[c[0]].text,
    get: () => faderReg[c[0]].get(),
    set: v => faderReg[c[0]].set(v)
  }));
}
function surfaceShiftControls(){
  const out = TS_ALT.map(a => Patchwork.surface.segment($("#" + a[0]), a[1], a[2]));
  out.push(Patchwork.surface.option($("#tsVariant"), "Variant", "Var"));
  return out.filter(Boolean);
}
function surfaceAction(){
  const b = $("#arm");
  if (!b || b.disabled) return null;
  b.click();
  return b.textContent.trim();
}
