
/* ============ ui ============ */

const stateEl = $("#loopState"), cutEl = $("#loopCut"), noteEl = $("#loopNote"),
      fillEl = $("#loopFill"), headEl = $("#loopHead"), meterEl = $("#inMeter"),
      recBtn = $("#rec"), dubBtn = $("#dub"), playBtn = $("#playStop"),
      takesEl = $("#loopTakes");
const clampf = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function say(msg, bad){
  noteEl.innerHTML = msg;
  noteEl.classList.toggle("err", !!bad);
}

const LABEL = {idle:"Empty", armed:"Armed", rec:"Recording", play:"Playing", dub:"Overdub"};

/* ---- the take strip ----
   One take per scene row, the same rows the live grid fires. Without this the panel had no
   way to say WHICH loop Record was about to fill, so it behaved like a one-loop pedal with
   a bank hidden behind it.

   Drawn in rows of eight, which is how MS·1, DR·1 and the shared step grid all settled on
   drawing sixteen: sixteen across is unhittable at a face's width, and eight is the widest
   run that stays countable without labels. */
const TAKES = Patchwork.scenes.rows.length;   // the launcher's rows, and the worklet's filled()
function buildTakes(){
  takesEl.textContent = "";
  for (let i = 0; i < TAKES; i++){
    const b = document.createElement("button");
    b.className = "take"; b.type = "button"; b.dataset.i = i;
    b.textContent = String(i + 1);
    takesEl.appendChild(b);
  }
}
buildTakes();

/* One state word per take, so the strip carries the whole picture: which hold a take,
   which one the transport is pointed at, and what that one is doing. The colours are the
   studio's — mint plays, yellow waits for a seam, red records — so a take reads the same
   here as its cell does in the launcher. */
function paintTakes(){
  const m = LP.mode;
  takesEl.querySelectorAll(".take").forEach(b => {
    const i = +b.dataset.i, sel = i === LP.slot;
    b.classList.toggle("has", hasSlot(i));
    b.classList.toggle("sel", sel);
    b.classList.toggle("on-play", sel && m === "play");
    b.classList.toggle("on-dub",  sel && m === "dub");
    b.classList.toggle("on-rec",  sel && m === "rec");
    b.classList.toggle("on-arm",  sel && m === "armed");
    b.title = "Take " + (i + 1) + " — scene row " + (i + 1)
            + (hasSlot(i) ? ", recorded" : ", empty");
  });
}

/* Selecting a take IS switching the looper to it: the worklet has one active buffer, so
   there is no such thing as pointing at slot 5 while slot 1 keeps playing. That makes the
   click the launcher's gesture — play what is there, fall silent where there is not —
   rather than a separate idea the panel would have to explain. fireSlot() sets the
   selection before it checks for a worklet, so this works on a panel that has recorded
   nothing yet, which is when you most need to say where the first take goes. */
takesEl.addEventListener("click", e => {
  const b = e.target.closest(".take"); if (!b) return;
  const i = +b.dataset.i;
  if (LP.mode === "rec" || LP.mode === "dub"){
    say("Finish or stop the take first — a pass in progress does not move rooms.", true);
    return;
  }
  /* armed and not yet started: re-aim it, which is the useful reading of the click */
  if (LP.mode === "armed"){ arm("rec", i); return; }
  fireSlot(i);
});

function paintState(){
  const m = LP.mode;
  stateEl.textContent = (m === "idle" && hasTake()) ? "Stopped" : (LABEL[m] || m);
  root.classList.toggle("recording", m === "rec" || m === "dub");
  root.classList.toggle("armed", m === "armed");
  root.classList.toggle("playing", m === "play" || m === "dub");
  playBtn.textContent = (m === "play" || m === "dub") ? "■ Stop" : "▶ Play";
  /* the switch and what it is doing are two facts: `on` is the latch, `dubbing` is a pass
     actually being layered right now, and before the first wrap you are in the first
     without being in the second */
  dubBtn.classList.toggle("on", LP.dubOn);
  dubBtn.classList.toggle("dubbing", m === "dub");
  $$("#click button").forEach(b => b.classList.toggle("on", (b.dataset.c === "on") === Patchwork.click.on));
  cutEl.textContent = LP.bpmAtRecord ? (LP.bars + " bars · cut at " + LP.bpmAtRecord + " bpm") : "—";
  /* A loop cut at another tempo no longer fits the bar, and silently drifting is worse
     than being told. */
  const now = Patchwork.clock.bpm;
  cutEl.classList.toggle("bad", !!LP.bpmAtRecord && now !== LP.bpmAtRecord);
  paintTakes();
  /* the take strip and the launcher's LP·1 column are the same eight-and-eight facts, so
     whatever moved this has to reach the launcher too */
  if (Patchwork.record && Patchwork.record.changed) Patchwork.record.changed();
}

/* The playhead comes from the worklet's own position, not from a timer — a timer would
   show where the main thread thinks the loop is, which is not where it is.

   ARMED is the exception, because there is no position yet: the bar runs a COUNT-IN
   instead, filling towards the frame the take starts on, with the beats left written where
   the state word goes. The wait is the loop line, not the bar line — up to eight beats at
   four bars — and a still bar reading "Armed" was the single most confusing thing here. */
function paintLoop(){
  if (LP.mode === "armed" && LP.armedAt != null && ctx){
    const beat = 60 / (Patchwork.clock.bpm || 120);
    const left = Math.max(0, LP.armedAt - ctx.currentTime);
    const span = Math.max(beat, LP.bars * 4 * beat);
    const p = clampf(1 - left / span, 0, 1) * 100;
    fillEl.style.width = p + "%";
    headEl.style.left = p + "%";
    /* the state word is paintState's everywhere else; while counting in it is this loop's,
       because it changes every frame and paintState only runs on a mode change */
    stateEl.textContent = "In " + Math.max(1, Math.ceil(left / beat));
  } else if (LP.len > 0 && LP.mode !== "idle"){
    const p = (LP.pos / LP.len) * 100;
    fillEl.style.width = p + "%";
    headEl.style.left = p + "%";
  } else if (LP.mode === "idle"){
    fillEl.style.width = "0%"; headEl.style.left = "0%";
  }
  meterEl.style.width = Math.min(100, LP.peak * 140) + "%";
  requestAnimationFrame(paintLoop);
}
requestAnimationFrame(paintLoop);

recBtn.addEventListener("click", () => {
  if (LP.mode === "rec" || LP.mode === "armed") stopLoop();
  else arm("rec");
});
const takeName = () => "Take " + (LP.slot + 1);
/* A switch, with nothing to check. There is no "record something first" any more, because
   switching it on before a take is now the useful thing to do — it is the difference
   between pressing Overdub at the exact wrap and deciding in advance that this one layers. */
dubBtn.addEventListener("click", () => {
  setDub(!LP.dubOn);
  say(LP.dubOn
    ? "Overdub on — this take will keep layering at every pass. Flip it off to stop."
    : "Overdub off.");
});
playBtn.addEventListener("click", () => {
  if (LP.mode === "play" || LP.mode === "dub") stopLoop();
  else if (hasTake()) play();
  else say(takeName() + " is empty. Pick a take that is lit, or record this one.", true);
});
/* ---- pushing a take to the jam ----
   Visible only in a session, because outside one there is nobody to push to. */
const pushBtn = $("#push");
pushBtn.addEventListener("click", async () => {
  const n = LP.slot;
  if (!hasTake()){ say(takeName() + " is empty — record it before pushing it.", true); return; }
  pushBtn.disabled = true;
  say("Pushing " + takeName() + "…");
  const r = await Patchwork.session.pushTake(n);
  pushBtn.disabled = false;
  say(r.ok
    ? takeName() + " pushed — " + Math.round(r.bytes / 1024) + " KB as " + r.kind
      + ". Everyone in the jam has it now."
    : "Could not push: " + r.why, !r.ok);
});
Patchwork.session.onChange(() => { pushBtn.hidden = !Patchwork.session.active; });

$("#undo").addEventListener("click", undo);
$("#clear").addEventListener("click", () => { const n = takeName(); clearLoop(); say(n + " cleared."); });
$("#clearAll").addEventListener("click", () => {
  if (!node){ say("Nothing recorded yet."); return; }
  allocate();                    // alloc is what empties the bank — see the worklet
  LP.filled = [];
  say("Every take cleared. The loop can be given a different length now.");
  paintState();
});

/* ⚠️ Re-lengthing empties the bank — a loop IS its sample count, so the worklet drops
   every slot on alloc. That used to happen silently on a stray change of this select,
   taking the takes with it. It is refused while anything is recorded, and Clear all is
   the way through. */
$("#bars").addEventListener("change", e => {
  const want = parseInt(e.target.value, 10);
  if (LP.filled.length){
    e.target.value = String(LP.bars);
    say("Changing the length would empty all " + LP.filled.length
      + " take" + (LP.filled.length > 1 ? "s" : "")
      + " — the loop is a fixed number of samples. <b>Clear all</b> first.", true);
    return;
  }
  LP.bars = want;
  if (node) allocate();
  paintState();
});

$("#click").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.click.set(b.dataset.c === "on");
  say(Patchwork.click.on
    ? "Click on. It is on its own strip, so it is never recorded into a take."
    : "Click off.");
});
Patchwork.click.onChange(paintState);

$("#mon").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  LP.monitorOn = b.dataset.m === "on";
  $$("#mon button").forEach(x => x.classList.toggle("on", x === b));
  if (monitor) monitor.gain.setTargetAtTime(LP.monitorOn ? 1 : 0, ctx.currentTime, .01);
});

const inSel = $("#inSel");
inSel.addEventListener("change", () => { LP.input = inSel.value; if (stream) openInput(LP.input); });

let devices = [];

/* The instruments this page actually has, as the input list should name them.

   ⚠️ LP·1 is filtered out, and it is the one entry that would break the feature rather
   than merely be useless: pointing the looper at its own strip is the feedback path the
   bus tap already names an exclusion to avoid, and it would build until it clips.

   Taken from what has REGISTERED rather than from a list written here, so an instrument
   added to a build appears without this file being told about it. */
function pageInstruments(){
  const S = window.Patchwork && Patchwork.scenes;
  if (!S || !S.instruments) return [];
  return S.instruments.filter(i => i.id !== "lp1" && i.name);
}
function instName(id){
  const it = pageInstruments().find(i => i.id === id);
  return it ? it.name : id;
}
function inputLabel(id){
  if (id === BUS) return "the studio output";
  const one = instOf(id);
  if (one) return instName(one);
  const d = devices.find(x => x.deviceId === id);
  return d && d.label ? d.label : (id ? "the selected input" : "the default input");
}

const option = (value, text) => Object.assign(document.createElement("option"),
  {value, textContent: text});

function buildInputs(){
  /* ⚠️ Restored from LP.input, not from inSel.value. The old line only put back DEVICE
     ids, so a rebuild — a headset appearing, say — silently dropped the selection back to
     the first option. That was invisible while "the first option" and "the only internal
     source" were the same thing, and stops being invisible the moment there are six. */
  const keep = LP.input;
  inSel.textContent = "";

  const here = document.createElement("optgroup");
  here.label = "From this page";
  here.appendChild(option(BUS, "Studio output"));
  pageInstruments().forEach(i => here.appendChild(option(INST + i.id, i.name + " only")));
  inSel.appendChild(here);

  /* Offered only when the browser has any, rather than listed and then apologised for on
     the one path that cannot work. */
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    const mics = document.createElement("optgroup");
    mics.label = "Microphone";
    mics.appendChild(option("", "Default microphone"));
    devices.forEach((d, i) => mics.appendChild(
      option(d.deviceId, d.label || ("Input " + (i + 1)))));
    inSel.appendChild(mics);
  }

  if ([].some.call(inSel.options, o => o.value === keep)) inSel.value = keep;
}

async function listInputs(){
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){
    try{
      const devs = await navigator.mediaDevices.enumerateDevices();
      devices = devs.filter(d => d.kind === "audioinput");
    }catch(e){}
  }
  buildInputs();
}
listInputs();
/* ⚠️ Again once the page has finished assembling. The instrument options come from what
   has registered, and this file happens to be built after every other instrument today —
   but that is parts.txt's business, not this file's, and an instrument listed below LP·1
   would otherwise be missing from the menu with nothing to explain why. A timeout of 0
   runs after every synchronous script on the page, whatever the order turns out to be. */
setTimeout(listInputs, 0);
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener("devicechange", listInputs);

/* The loop's level and the click's are the same control twice, so it is written once. */
function mountFader(sel, get, set){
  const el = $(sel), slot = el.querySelector(".hslot"),
        cap = el.querySelector(".hcap"), val = el.querySelector(".hval");
  function paintF(){
    cap.style.left = (get() * 100) + "%";
    val.textContent = Math.round(get() * 100) + "%";
  }
  el.addEventListener("pointerdown", e => {
    const r = slot.getBoundingClientRect();
    const move = ev => {
      const cx = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0].clientX);
      set(clampf((cx - r.left) / r.width, 0, 1));
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
mountFader("#levelF", () => LP.level, v => {
  LP.level = v;
  if (node && node.__level) node.__level.gain.setTargetAtTime(v, ctx.currentTime, .01);
});
/* The click is loud on purpose — it has to cut through what you are playing to — so it
   gets its own level rather than riding the loop's. */
mountFader("#clickF", () => Patchwork.click.level, v => Patchwork.click.setLevel(v));

/* Space records, and only when this panel owns the keyboard. */
onKey("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === " " && !e.repeat){ recBtn.click(); e.preventDefault(); }
});

paintState();
