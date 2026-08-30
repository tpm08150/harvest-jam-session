
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

function fader(sel, get, set, fmt){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
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
function paintRead(){
  shapeEl.textContent = label();
  lenEl.textContent = TS.bars + (TS.bars === 1 ? " bar" : " bars");
  armBtn.classList.toggle("on", TS.armed);
  armBtn.textContent = TS.armed ? "Cancel" : "Arm";
  const left = untilLanding();
  if (!TS.armed){
    whenEl.textContent = "Idle — arm it and it lands on the next boundary";
    if (fillMeter) fillMeter.style.width = "0%";
    root.classList.remove("ts-armed");
    return;
  }
  root.classList.add("ts-armed");
  const beats = left / Patchwork.clock.beatSeconds();
  whenEl.textContent = left > .05
    ? "Lands in " + (beats >= 4 ? (beats / 4).toFixed(1) + " bars" : beats.toFixed(1) + " beats")
    : "Landing";
  if (fillMeter){
    const dur = Math.max(.001, TS.landAt - TS.startAt);
    const done = Math.max(0, Math.min(1, 1 - left / dur));
    fillMeter.style.width = (done * 100) + "%";
  }
}

armBtn.addEventListener("click", () => { if (TS.armed) cancel(); else schedule(); paintRead(); });
$("#fire").addEventListener("click", () => { if (TS.armed) cancel(); fireNow(); paintRead(); });
$("#panic").addEventListener("click", () => { cancel(); paintRead(); });

/* rAF rather than an interval: the countdown is a moving number and this is the only thing
   on the panel that animates. It stops paying for itself the moment nothing is armed. */
(function paintLoop(){
  if (TS.armed) paintRead();
  requestAnimationFrame(paintLoop);
})();
onChange(paintRead);
paintRead();
