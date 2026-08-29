
/* ============ ui ============ */

const playBtn = $("#play"), tempoOut = $("#tempoOut"), lanesEl = $("#lanes");
const clampf = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---- the lane grid ---- */
function buildLanes(){
  lanesEl.textContent = "";
  ORDER.forEach(id => {
    const row = document.createElement("div");
    row.className = "lane";
    const nm = document.createElement("button");
    nm.className = "lane-name" + (id === SEQ.lane ? " sel" : "");
    nm.textContent = VOICES[id].name;
    nm.dataset.v = id;
    nm.title = VOICES[id].full + " — click to edit, shift-click to audition";
    row.appendChild(nm);
    const pads = document.createElement("div");
    pads.className = "pads";
    for (let i = 0; i < MAX_STEPS; i++){
      const b = document.createElement("button");
      b.className = "pad";
      b.dataset.v = id; b.dataset.i = i;
      b.setAttribute("aria-label", VOICES[id].name + " step " + (i + 1));
      pads.appendChild(b);
    }
    row.appendChild(pads);
    lanesEl.appendChild(row);
  });
  paintPads();
}

function paintPads(){
  /* the grid's column count follows the pattern length, so 8 steps fill the row rather
     than leaving half of it empty */
  /* Sixteen columns is the widest a lane stays hittable at a panel's width, so anything
     longer wraps into rows of 16 inside the same grid rather than shrinking the pads to
     slivers. 64 steps is four rows per lane, which is what 64 steps looks like. */
  const cols = Math.min(16, SEQ.len);
  $$(".pads").forEach(p => p.style.setProperty("--steps", cols));
  $$(".pad").forEach(b => {
    const id = b.dataset.v, i = +b.dataset.i;
    b.hidden = i >= SEQ.len;
    const v = steps[id][i];
    b.classList.toggle("on", v > 0);
    b.classList.toggle("acc", v === 2);
    b.classList.toggle("beat", i % 4 === 0);
  });
}

/* A click cycles off → on → accent → off. Three states on one control, because a
   separate accent mode means holding a modifier to program the thing you most want to
   program — the downbeat of a kick is accented nearly every time. */
lanesEl.addEventListener("click", e => {
  const nm = e.target.closest(".lane-name");
  if (nm){
    if (e.shiftKey){ ensureAudio(); Patchwork.record.note("dr1", nm.dataset.v, 110);
                     fire(nm.dataset.v, ctx.currentTime + .005, 1); flashLane(nm.dataset.v); }
    else { SEQ.lane = nm.dataset.v; $$(".lane-name").forEach(x => x.classList.toggle("sel", x.dataset.v === SEQ.lane)); syncVoice(); }
    return;
  }
  const pad = e.target.closest(".pad");
  if (!pad) return;
  const id = pad.dataset.v, i = +pad.dataset.i;
  steps[id][i] = (steps[id][i] + 1) % 3;
  SEQ.lane = id;
  $$(".lane-name").forEach(x => x.classList.toggle("sel", x.dataset.v === id));
  syncVoice();
  paintPads();
});

function flashLane(id){
  const el = lanesEl.querySelector('.lane-name[data-v="' + id + '"]');
  if (!el) return;
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 90);
}

/* ---- playhead ----
   Painted from the marks the scheduler left, looked up against the audio clock — the
   same approach CS·1 and MS·1 use. Reading stepIndex directly would show the lookahead's
   position, which is up to 200 ms ahead of what you can hear. */
function paint(){
  if (!SEQ.playing){ clearMarks(); return; }
  const now = ctx.currentTime;
  let cur = -1;
  for (let k = marks.length - 1; k >= 0; k--)
    if (marks[k].t <= now && now < marks[k].end){ cur = marks[k].i; break; }
  $$(".pad").forEach(b => b.classList.toggle("now", +b.dataset.i === cur));
  if (cur >= 0 && cur !== lastPainted){
    ORDER.forEach(id => { if (steps[id][cur]) flashLane(id); });
    lastPainted = cur;
  }
  requestAnimationFrame(paint);
}
let lastPainted = -1;
function clearMarks(){ $$(".pad").forEach(b => b.classList.remove("now")); lastPainted = -1; }

/* ---- horizontal faders ----
   Registered the way CS·1's are, so MIDI learn and patch save would get them for free. */
const faderCtl = {};
/* min and max are functions, not numbers, because Tune's range depends on which voice is
   selected — a kick tuned to a hat's 40 Hz fundamental is inaudible, and a hat at a
   kick's 48 Hz is a buzz. One fader serving eight voices needs the range to move with
   the selection rather than being remapped after the fact. */
function makeFader(sel, get, set, fmt, min, max){
  const el = $(sel), slot = el.querySelector(".hslot"), cap = el.querySelector(".hcap"),
        val = el.querySelector(".hval");
  const lo = () => (typeof min === "function" ? min() : min);
  const hi = () => (typeof max === "function" ? max() : max);
  function paintF(){
    const a = lo(), b = hi();
    cap.style.left = (clampf((get() - a) / (b - a), 0, 1) * 100) + "%";
    val.textContent = fmt(get());
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      const x = clampf((cx - r.left) / r.width, 0, 1);
      const a = lo(), b = hi();
      set(a + x * (b - a));
      paintF();
    };
    move(e);
    el.classList.add("dragging");
    el.setPointerCapture && e.pointerId != null && el.setPointerCapture(e.pointerId);
    const up = () => {
      el.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  faderCtl[sel] = paintF;
  paintF();
  return paintF;
}

/* ---- per-voice controls ----
   One set of faders serving whichever lane is selected, rather than four controls per
   voice times eight voices. Thirty-two knobs on a panel this size is a wall, and a drum
   machine is played on the grid — the voice faders are for setting up, not performing. */
const TUNE_RANGE = {bd:[28,90], sd:[120,320], cp:[500,2200], lt:[55,180],
                    ht:[100,320], ch:[24,70], oh:[24,70], rs:[900,2600]};
const cur = () => P[SEQ.lane];

function syncVoice(){
  const v = VOICES[SEQ.lane];
  $("#voiceTag").textContent = v.name;
  $("#voiceMeta").textContent = v.full;
  ["#tuneF", "#toneF", "#decayF", "#levelF"].forEach(k => faderCtl[k] && faderCtl[k]());
}

makeFader("#tuneF",  () => cur().tune,  v => { cur().tune = v; },
          v => (v < 100 ? v.toFixed(1) : Math.round(v)) + " Hz",
          () => TUNE_RANGE[SEQ.lane][0], () => TUNE_RANGE[SEQ.lane][1]);
makeFader("#toneF",  () => cur().tone,  v => { cur().tone = v; },
          v => Math.round(v * 100) + "%", 0, 1);
makeFader("#decayF", () => cur().decay, v => { cur().decay = v; },
          v => (v * 1000).toFixed(0) + " ms", .02, 1.2);
makeFader("#levelF", () => cur().level, v => { cur().level = v; },
          v => Math.round(v * 100) + "%", 0, 1);
makeFader("#swingF",  () => SEQ.swing,     v => { SEQ.swing = v; },
          v => Math.round(v * 100) + "%", .5, .75);
makeFader("#accentF", () => SEQ.accentAmt, v => { SEQ.accentAmt = v; },
          v => Math.round(v * 100) + "%", 0, .8);

/* ---- transport and pattern controls ---- */
playBtn.addEventListener("click", () => SEQ.playing ? stopPlay() : startPlay());
$("#clearPat").addEventListener("click", () => { ORDER.forEach(k => steps[k].fill(0)); paintPads(); });
$("#defaultPat").addEventListener("click", () => { loadDefaultPattern(); paintPads(); });
$("#panic").addEventListener("click", () => { stopPlay(); midiPanic(); });

function setBpm(v, fromShell){
  const b = Math.round(clampf(v, 40, 240));
  tempoOut.textContent = b;
  if (!fromShell) Patchwork.clock.setBpm(b, "dr1");
}
Patchwork.clock.onTempo("dr1", v => setBpm(v, true), 120);
setBpm(Patchwork.clock.bpm, true);
$("#bpmUp").addEventListener("click", () => setBpm(Patchwork.clock.bpm + 1));
$("#bpmDown").addEventListener("click", () => setBpm(Patchwork.clock.bpm - 1));

$("#rate").addEventListener("change", e => { SEQ.rate = e.target.value; });
$("#len").addEventListener("change", e => { SEQ.len = +e.target.value; paintPads(); });

/* Space plays, and only when this panel owns the keyboard — see shell/host.js. */
onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ SEQ.playing ? stopPlay() : startPlay(); e.preventDefault(); }
});

buildLanes();
syncVoice();
