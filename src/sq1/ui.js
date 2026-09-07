
/* ============ panel ============ */
/* One track on screen at a time. Sixteen tracks of sixty-four steps is a thousand cells, and
   a page that drew them all would be a page nobody could point at — so the selector is the
   navigation and the grid below it is whichever track it names. */

let sel = 0;                       // which track is on screen
const cur = () => track(sel);

const RATE_LIST = Object.keys(RATES);
const LEN_LIST = [4, 8, 12, 16, 24, 32, 48, 64];
const NOTES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const noteName = n => NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

const trackBox = $("#sqTracks"), styleSeg = $("#sqStyle"), muteSeg = $("#sqMute");
const lenSel = $("#sqLen"), rateSel = $("#sqRate"), clearBtn = $("#sqClear");
const synthFace = $("#sqSynth"), drumFace = $("#sqDrum"), lanesEl = $("#sqLanes");
const playBtn = $("#sqPlay"), nowEl = $("#sqNow"), noteEl = $("#sqNote");

/* ---- the sixteen ---- */
for (let i = 0; i < TRACKS; i++){
  const b = document.createElement("button");
  b.className = "trk"; b.dataset.i = i; b.type = "button";
  b.textContent = String(i + 1);
  b.setAttribute("aria-label", "Track " + (i + 1) + ", MIDI channel " + (i + 1));
  trackBox.appendChild(b);
}
trackBox.addEventListener("click", e => {
  const b = e.target.closest(".trk"); if (!b) return;
  sel = +b.dataset.i;
  showTrack();
});

LEN_LIST.forEach(n => lenSel.appendChild(Object.assign(document.createElement("option"),
  {value: String(n), textContent: n + " steps"})));
RATE_LIST.forEach(r => rateSel.appendChild(Object.assign(document.createElement("option"),
  {value: r, textContent: r})));

lenSel.addEventListener("change", () => {
  const t = cur();
  const n = parseInt(lenSel.value, 10);
  if (t.style === "drum") t.drum.T.len = n; else t.synth.seq.setLen(n);
  showTrack();
});
rateSel.addEventListener("change", () => {
  const t = cur();
  if (t.style === "drum") t.drum.T.rate = rateSel.value;
  else t.synth.seq.SEQ.rate = rateSel.value;
  paintHead();
});
styleSeg.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  setStyle(sel, b.dataset.s);
  showTrack();
});
muteSeg.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  setMute(sel, b.dataset.m === "off");
  paintHead();
});
clearBtn.addEventListener("click", () => {});   // replaced by mountClearSeq below

/* ---- the synth face ----
   ⚠️ THE SAME GRID BS·1 AND VC·1 DRAW, mounted on this track's sequencer. Rebuilt when the
   selected track changes, because the grid holds a reference to one `seq` and there are
   sixteen of them — which is the one thing mountSeqGrid was never asked to do before. */
let grid = null, clearSeqBtn = null;
const keySel = $("#sqKey"), scaleSel = $("#sqScale"), laneSeg = $("#sqLane"), hintEl = $("#sqHint");
for (let n = 0; n < 12; n++) keySel.appendChild(Object.assign(document.createElement("option"),
  {value: String(36 + n), textContent: NOTES[n]}));

function buildSynthFace(){
  const seq = cur().synth.seq;
  $("#sqWrap").textContent = "";
  if (!scaleSel.options.length)
    Object.keys(seq.SCALES).forEach(k => scaleSel.appendChild(Object.assign(
      document.createElement("option"), {value: k, textContent: k})));
  grid = Patchwork.mountSeqGrid($("#sqWrap"), seq, {
    onSelect: () => paintHead(),
    after: () => { if (clearSeqBtn) clearSeqBtn.paint(); }
  });
  keySel.value = String(seq.SEQ.root);
  scaleSel.value = seq.SEQ.scale;
  $$("#sqLane button").forEach(b => b.classList.toggle("on", b.dataset.l === seq.SEQ.lane));
}
keySel.addEventListener("change", () => { cur().synth.seq.SEQ.root = +keySel.value; grid && grid.paint(); });
scaleSel.addEventListener("change", () => { cur().synth.seq.SEQ.scale = scaleSel.value; grid && grid.paint(); });
laneSeg.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  cur().synth.seq.SEQ.lane = b.dataset.l;
  $$("#sqLane button").forEach(x => x.classList.toggle("on", x === b));
  grid && grid.paint();
});

/* ---- the drum face ----
   ⚠️ THE NOTE IS THE POINT. DR·1's lanes are voices and cannot be anything else; these are
   note numbers on a wire, and outboard gear agrees about almost none of them — so each lane
   carries a number input, and the readout beside it says which note that is in words,
   because 46 and A♯2 are the same fact and only one of them is a sound you can hum. */
function buildDrumFace(){
  const t = cur().drum;
  lanesEl.textContent = "";
  t.lanes.forEach((lane, li) => {
    const row = document.createElement("div");
    row.className = "lane"; row.dataset.lane = li;
    const head = document.createElement("div");
    head.className = "lane-head";
    head.appendChild(Object.assign(document.createElement("span"),
      {className: "lane-name", textContent: lane.name}));
    const num = document.createElement("input");
    num.type = "number"; num.min = "0"; num.max = "127"; num.value = String(lane.note);
    num.className = "lane-note";
    num.setAttribute("aria-label", lane.name + " note number");
    num.addEventListener("change", () => {
      lane.note = Math.max(0, Math.min(127, parseInt(num.value, 10) || 0));
      num.value = String(lane.note);
      head.querySelector(".lane-nn").textContent = noteName(lane.note);
    });
    head.appendChild(num);
    head.appendChild(Object.assign(document.createElement("span"),
      {className: "lane-nn silk", textContent: noteName(lane.note)}));
    row.appendChild(head);
    const cells = document.createElement("div");
    cells.className = "lane-steps";
    row.appendChild(cells);
    lanesEl.appendChild(row);
  });
  paintDrum();
}
lanesEl.addEventListener("click", e => {
  const b = e.target.closest(".dstep"); if (!b) return;
  cur().drum.press(+b.closest(".lane").dataset.lane, +b.dataset.i);
  paintDrum();
  if (clearSeqBtn) clearSeqBtn.paint();
});

function paintDrum(){
  const t = cur().drum;
  lanesEl.querySelectorAll(".lane").forEach(row => {
    const l = t.lanes[+row.dataset.lane];
    const cells = row.querySelector(".lane-steps");
    /* rebuilt only when the LENGTH changed — a click repaints classes, not the DOM */
    if (cells.children.length !== t.T.len){
      cells.textContent = "";
      cells.style.setProperty("--steps", Math.min(16, t.T.len));
      for (let i = 0; i < t.T.len; i++){
        const b = document.createElement("button");
        b.className = "dstep"; b.type = "button"; b.dataset.i = i;
        if (i % 4 === 0) b.classList.add("beat");
        b.setAttribute("aria-label", l.name + " step " + (i + 1));
        cells.appendChild(b);
      }
    }
    const head = t.playingStep();
    [].forEach.call(cells.children, (b, i) => {
      b.classList.toggle("on", l.steps[i] === 1);
      b.classList.toggle("acc", l.steps[i] === 2);
      b.classList.toggle("now", i === head);
    });
  });
}

/* ---- the head ---- */
function paintHead(){
  const t = cur();
  trackBox.querySelectorAll(".trk").forEach(b => {
    const k = +b.dataset.i, tk = track(k);
    b.classList.toggle("sel", k === sel);
    b.classList.toggle("has", (tk.style === "drum" ? tk.drum.count() : tk.synth.count()) > 0);
    b.classList.toggle("run", tk.playing);
    b.classList.toggle("muted", tk.mute);
  });
  styleSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.s === t.style));
  muteSeg.querySelectorAll("button").forEach(b =>
    b.classList.toggle("on", (b.dataset.m === "off") === t.mute));
  const T = t.style === "drum" ? t.drum.T : t.synth.seq.SEQ;
  lenSel.value = String(T.len);
  rateSel.value = T.rate;
  playBtn.classList.toggle("on", anyPlaying());
  playBtn.innerHTML = anyPlaying() ? "&#9632; Stop" : "&#9654; Play";
  nowEl.textContent = "ch " + (sel + 1) + " · " + t.style
                    + (t.mute ? " · muted" : "") + " · " + T.len + " × " + T.rate;
}

function showTrack(){
  const t = cur();
  const drum = t.style === "drum";
  synthFace.hidden = drum;
  drumFace.hidden = !drum;
  if (drum) buildDrumFace(); else buildSynthFace();
  mountClear();
  paintHead();
}

/* ⚠️ REMOUNTED PER TRACK, because Clear is about the pattern in front of you and there are
   sixteen of them. The shared control takes four functions and this hands it the selected
   track's — see mountClearSeq in seq/step-seq.js. */
function mountClear(){
  clearSeqBtn = Patchwork.mountClearSeq(clearBtn, {
    count: () => (cur().style === "drum" ? cur().drum.count() : cur().synth.count()),
    grab: () => cur().live.capture(),
    put: p => { cur().live.apply(p); showTrack(); },
    clear: () => cur().live.clear(),
    repaint: () => { if (cur().style === "drum") paintDrum(); else grid && grid.paint();
                     paintHead(); }
  });
}

playBtn.addEventListener("click", () => { playAll(!anyPlaying()); paintHead(); });
$("#sqPanic").addEventListener("click", () => { panic(); paintHead(); });

/* rAF for the playheads. ⚠️ Sixteen tracks at their own rates means sixteen playheads that
   agree with nothing but the audio clock, so there is nothing to derive them from — they are
   read, every frame, from the marks each track kept. Cheap: one array scan per track, and
   only the visible one is drawn. */
(function paintLoop(){
  if (anyPlaying()){
    if (cur().style === "drum") paintDrum(); else if (grid) grid.paint();
    paintHead();
  }
  requestAnimationFrame(paintLoop);
})();

showTrack();
