
/* ---- the scene launcher ----
   Studio only. The model lives in shell/scenes.js and works headless; this is the row of
   buttons over it.

   Deliberately small. The panels below already carry every control an instrument has —
   what is missing when you are playing is a way to change WHAT is played without going
   back to a grid and editing it, and that is all this does. */
/* ---- what a launcher cell IS ----
   The studio's small launcher and the live page are two views of ONE grid, so every rule
   about a cell — which instruments get a column, what the cell shows, what a click does —
   has to be the same in both or they disagree about the same object.

   They had already drifted. The live page grew LP·1's column and the slot routing that
   goes with it; the launcher kept listing scene members only, so on the faces page the
   looper simply was not there. Putting the rules in one place is what stops that
   happening again the next time one view learns something.

   It lives in the studio rather than the shell because it is about the launcher's DOM,
   which the shell does not own — and here specifically because this file is built before
   live.js, which uses it. */
Patchwork.launch = (() => {
"use strict";

/* Every instrument that is either a scene member or can record. LP·1 has no scene row of
   its own — a scene changes what an instrument PLAYS and a looper's content is a
   recording — but it very much has one take per row, so it has a column. */
/* ⚠️ SAID OUT LOUD, not inherited from registration order. The columns used to come out in
   whatever sequence parts.txt happened to build the instruments in, with the record-only
   tracks tacked on the end — so LP·1 sat after TS·1 for no reason anybody chose, and moving
   a line in a manifest would silently rearrange the launcher.

   The order is a reading order: the kit, then the parts that play over it, then the looper
   that captures them, and TS·1 last because a transition is what ends a section. Anything
   not listed keeps its registration order at the end, so an instrument added later appears
   rather than disappearing. */
const COLUMN_ORDER = ["dr1", "bs1", "cs1", "pm1", "vc1", "lp1", "ts1"];

function columns(){
  const seen = new Map();
  Patchwork.scenes.instruments.forEach(i => seen.set(i.id, i.name));
  Patchwork.record.tracks.forEach(t => { if (!seen.has(t.id)) seen.set(t.id, t.name); });
  const rank = id => { const i = COLUMN_ORDER.indexOf(id);
                       return i < 0 ? COLUMN_ORDER.length : i; };
  return [...seen].map(([id, name]) => ({id, name}))
                  .sort((a, b) => rank(a.id) - rank(b.id));
}

/* A track with slots keeps a real audio take per row rather than a pattern. */
function slotted(id){
  const t = Patchwork.record && Patchwork.record.track(id);
  return (t && t.slots) ? t : null;
}

/* What kind of cell this is, decided once when it is built. */
function mark(b, id){
  if (slotted(id)) b.dataset.slots = "1";
  else if (!Patchwork.scenes.instruments.some(i => i.id === id)) b.disabled = true;
}

function paintCell(b, ri, id, queued, onRow){
  const t = slotted(id);
  b.classList.toggle("full", t ? !!(t.hasSlot && t.hasSlot(ri))
                               : Patchwork.scenes.has(ri, id));
  /* a slot track keeps its own transport, so what it is playing comes from the track
     rather than from the scene model, which has never heard of it */
  b.classList.toggle("live", t ? !!(t.liveSlot && t.liveSlot() === ri)
                               : (onRow.get(id) === ri && Patchwork.scenes.playing(id)));
  b.classList.toggle("armed", queued.get(id) === ri);
}

/* One gesture table, so the two views cannot answer the same click differently.

   A CELL WRITES. The row button plays. That split is the whole of it: click a cell to put
   what an instrument is holding into that block, shift-click to empty it, and press ▶ on
   the row to hear the row. Plain click used to FIRE a cell and shift-click used to capture
   into it, which meant the two halves of the grid answered to different verbs.

   ⚠️ Deleting is one modifier now, at the owner's request. It was two — cmd AND shift — on
   the grounds that a block is a take you may have spent a while getting and one slip on a
   launcher you are playing should not throw it away. That reasoning has not stopped being
   true; it is just no longer the call being made. LP·1's takes are the ones with the most
   to lose, since a cleared audio take is not recoverable. */
function click(e, ri, id){
  const t = slotted(id);
  if (e.shiftKey){
    if (t && t.clearSlot) t.clearSlot(ri);
    else Patchwork.scenes.clear(ri, id);
    return;
  }
  /* add or edit: a slot track records a real take, everything else copies its pattern in */
  if (t){ if (t.recordSlot) t.recordSlot(ri); return; }
  Patchwork.scenes.store(ri, id);
}

/* ⚠️ Firing a ROW had never reached the looper. `Patchwork.scenes.fire(row)` walks scene
   members, and LP·1 is deliberately not one — a scene changes what an instrument PLAYS and
   a looper's content is a recording. So the row button moved five instruments and left the
   sixth sitting there, while the ● record path worked, because captureRow() walks the
   record kit and happens to catch slot tracks on its way past.

   The row is the gesture, so the row has to move everything the row can see. */
function fireRow(ri){
  Patchwork.scenes.fire(ri);
  Patchwork.record.tracks.forEach(t => {
    const k = slotted(t.id);
    if (k && k.playSlot) k.playSlot(ri);
  });
}

/* Where in the pattern you are. The launcher says when a change LANDS — "pattern" is
   CS·1's progression coming round — and until now gave you no way to see that moment
   approaching, so firing on the one you wanted was guesswork with an eight-second wait
   attached.

   Computed from the grid origin and the shared clock, the same way every instrument works
   out its own seam, rather than counted by a timer that would drift away from the audio. */
function mountMeasure(el){
  let lit = -1, bars = 0;
  function build(){
    bars = Math.max(1, Patchwork.scenes.patternBars);
    el.textContent = "";
    for (let i = 0; i < bars; i++){
      const p = document.createElement("i");
      p.className = "st-bar";
      p.title = "Bar " + (i + 1) + " of " + bars;
      el.appendChild(p);
    }
    lit = -1;
  }
  function at(){
    const ctx = Patchwork.audio && Patchwork.audio.ctx;
    const origin = Patchwork.clock.origin;
    if (!ctx || origin == null || !Patchwork.clock.running) return -1;
    const bar = 4 * Patchwork.clock.beatSeconds();
    if (!(bar > 0)) return -1;
    const k = Math.floor((ctx.currentTime - origin) / bar);
    return ((k % bars) + bars) % bars;
  }
  function tick(){
    const i = at();
    if (i !== lit){
      lit = i;
      [...el.children].forEach((c, k) => c.classList.toggle("st-now", k === i));
      el.classList.toggle("st-idle", i < 0);
    }
    requestAnimationFrame(tick);
  }
  build();
  /* The pips are rebuilt on the SETTING's notification, not in the animation loop: the
     loop is rAF, which stops dead in a hidden tab, and a control that only answers while
     you can see it is not a control. Only the lit pip needs a frame. */
  Patchwork.scenes.onChange(() => {
    if (bars !== Math.max(1, Patchwork.scenes.patternBars)) build();
  });
  requestAnimationFrame(tick);
}

/* Stop everything the launcher can reach. Scene members are stopped by PRESSING their own
   Play, the way the live page's master already does it — whatever a panel does when it
   stops then happens here too, rather than being reimplemented and drifting. A slot track
   has no Play in the rack sense, so it offers stop() instead. */
function stopAll(){
  Patchwork.roots.forEach(r => {
    const id = r.dataset.instrument;
    if (!Patchwork.scenes.playing(id)) return;
    const btn = r.querySelector("#play");
    if (btn) btn.click();
  });
  Patchwork.record.tracks.forEach(t => {
    const k = slotted(t.id);
    if (k && k.stop) k.stop();
  });
  /* Pressing a panel's Play does not reach the scene model, so say so — otherwise the
     cells stay ringed after everything has stopped. */
  Patchwork.scenes.changed();
}

/* Firing a row is the one gesture that is not implied by the state — the rows themselves
   are already shared, but "play row 3 now" has to be said. It still lands on the seam at
   the other end, computed locally, so the message only has to beat the boundary. */
function fireRowShared(ri){
  fireRow(ri);
  if (Patchwork.session && Patchwork.session.active) Patchwork.session.fired(ri);
}

/* Is anything sounding at all? The stop button reads inert when there is nothing to stop,
   because a live control that does nothing is worse than no control. */
function anyPlaying(){
  if (Patchwork.scenes.instruments.some(i => Patchwork.scenes.playing(i.id))) return true;
  return Patchwork.record.tracks.some(t => {
    const k = slotted(t.id);
    return !!(k && k.liveSlot && k.liveSlot() !== null);
  });
}

return {columns, slotted, mark, paintCell, click, fireRow, fireRowShared,
        mountMeasure, stopAll, anyPlaying};
})();

(() => {
"use strict";
const grid = document.querySelector("#stGrid");
if (!grid || !window.Patchwork || !Patchwork.scenes) return;

function build(){
  const cols = Patchwork.launch.columns();
  grid.style.setProperty("--cols", cols.length);
  grid.textContent = "";

  const head = document.createElement("div");
  head.className = "st-row st-row-head";
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  cols.forEach(c => head.appendChild(Object.assign(document.createElement("span"),
    {className: "st-inst", textContent: c.name})));
  head.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  grid.appendChild(head);

  Patchwork.scenes.rows.forEach((row, ri) => {
    const el = document.createElement("div");
    el.className = "st-row";
    el.appendChild(Object.assign(document.createElement("span"),
      {className: "st-num", textContent: row.name}));
    cols.forEach(c => {
      const b = document.createElement("button");
      b.className = "st-cell";
      b.dataset.row = ri; b.dataset.inst = c.id;
      Patchwork.launch.mark(b, c.id);
      b.setAttribute("aria-label", c.name + " scene " + row.name);
      el.appendChild(b);
    });
    const fire = document.createElement("button");
    fire.className = "st-fire";
    fire.dataset.row = ri;
    fire.setAttribute("aria-label", "Fire scene " + row.name);
    el.appendChild(fire);
    grid.appendChild(el);
  });

  /* ---- the mix ----
     One fader per column, under the grid it belongs to, so the thing you balance and the
     thing you fire are the same list of instruments in the same order.

     ⚠️ YOURS ALONE, AND DELIBERATELY. Everybody in a jam renders the same patterns through
     their own speakers in their own room, so a balance that works in one does not work in
     another — and unlike a pattern or a patch, nobody else needs to agree with it. It is
     never sent, and shell/bus.js says what keeps it that way. */
  const mix = document.createElement("div");
  mix.className = "st-row st-row-mix";
  const lab = Object.assign(document.createElement("span"),
    {className: "st-num st-mixlab", textContent: "MIX"});
  lab.title = "Your own listening balance. It is never shared with a jam — "
            + "everyone hears the same parts through their own mix.";
  mix.appendChild(lab);
  cols.forEach(c => {
    const cell = document.createElement("div");
    cell.className = "st-fadercell";
    const f = document.createElement("input");
    f.type = "range"; f.className = "st-fader";
    f.min = "0"; f.max = "100"; f.step = "1";
    /* read back from the bus rather than from a default, so a rebuild — which happens
       whenever a row is added or the pattern length changes — does not reset the mix */
    f.value = String(Math.round(Patchwork.audio.level(c.id) * 100));
    f.dataset.inst = c.id;
    f.setAttribute("aria-label", c.name + " level");
    f.title = c.name + " level";
    /* the readout an instrument's fader carries, for the same reason: a fader you can only
       set by ear is one you cannot set back */
    const val = Object.assign(document.createElement("span"),
      {className: "st-faderval", textContent: f.value});
    /* M and S under each fader, in that order because that is the order they are on every
       mixer anyone has touched. Single letters: the column is 43px wide and the words do
       not fit, but nobody has ever had to be told what M and S are. */
    const keys = document.createElement("div");
    keys.className = "st-mskeys";
    [["m", "Mute"], ["s", "Solo"]].forEach(([k, word]) => {
      const b = document.createElement("button");
      b.className = "st-msk st-msk-" + k;
      b.type = "button";
      b.dataset.inst = c.id; b.dataset.k = k;
      b.textContent = k.toUpperCase();
      b.setAttribute("aria-label", word + " " + c.name);
      b.setAttribute("aria-pressed", "false");
      keys.appendChild(b);
    });
    cell.appendChild(f); cell.appendChild(val); cell.appendChild(keys);
    mix.appendChild(cell);
  });
  mix.appendChild(Object.assign(document.createElement("span"), {className: "st-num"}));
  grid.appendChild(mix);

  paintMix();
  paint();
}

/* Kept across reloads, because a mix you have to rebuild every time is one you stop
   bothering with. ⚠️ It is the fader POSITION that explains a quiet instrument on the next
   visit — which is the argument for the mixer being on screen rather than in a menu. */
const MIX_KEY = "patchwork-mix";
function loadMix(){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(MIX_KEY)); }catch(e){}
  if (!saved || typeof saved !== "object") return;
  const lv = saved.levels || saved;          // the first shape of this was levels alone
  Object.keys(lv).forEach(id => { if (typeof lv[id] === "number") Patchwork.audio.setLevel(id, lv[id]); });
  (saved.mute || []).forEach(id => Patchwork.audio.setMute(id, true));
  (saved.solo || []).forEach(id => Patchwork.audio.setSolo(id, true));
}
function saveMix(){
  const lv = {}, mute = [], solo = [];
  grid.querySelectorAll(".st-fader").forEach(f => {
    const id = f.dataset.inst;
    lv[id] = +f.value / 100;
    if (Patchwork.audio.muted(id)) mute.push(id);
    if (Patchwork.audio.soloed(id)) solo.push(id);
  });
  try{ localStorage.setItem(MIX_KEY, JSON.stringify({levels: lv, mute, solo})); }catch(e){}
}

/* ⚠️ A soloed track dims every OTHER fader, not itself — that is what makes it obvious at a
   glance which way round a solo is, and it is the thing that stops "why is the bass silent"
   being a two-minute mystery three songs later. */
function paintMix(){
  const A = Patchwork.audio;
  grid.querySelectorAll(".st-msk").forEach(b => {
    const on = b.dataset.k === "m" ? A.muted(b.dataset.inst) : A.soloed(b.dataset.inst);
    /* st-on, not on: the studio sheet is not scoped to a panel, so a bare `on` here would
       reach inside every instrument that uses it — which build.py refuses, correctly. */
    b.classList.toggle("st-on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  grid.querySelectorAll(".st-fadercell").forEach(cell => {
    const f = cell.querySelector(".st-fader");
    if (f) cell.classList.toggle("st-silenced", A.audible(f.dataset.inst) === 0);
  });
}

grid.addEventListener("click", e => {
  const b = e.target.closest && e.target.closest(".st-msk");
  if (!b) return;
  const id = b.dataset.inst;
  if (b.dataset.k === "m") Patchwork.audio.setMute(id, !Patchwork.audio.muted(id));
  else Patchwork.audio.setSolo(id, !Patchwork.audio.soloed(id));
  paintMix();
  saveMix();
});

/* `input`, not `change`: a fader that only moved the sound when you let go of it would be
   unusable for the one thing a fader is for. */
grid.addEventListener("input", e => {
  const f = e.target.closest && e.target.closest(".st-fader");
  if (!f) return;
  const g = Patchwork.audio.setLevel(f.dataset.inst, +f.value / 100);
  const val = f.parentNode && f.parentNode.querySelector(".st-faderval");
  if (val) val.textContent = String(Math.round(g * 100));
  paintMix();
  saveMix();
});

function paint(){
  const q = Patchwork.scenes.queued, on = Patchwork.scenes.onRow;
  grid.querySelectorAll(".st-cell").forEach(b =>
    Patchwork.launch.paintCell(b, +b.dataset.row, b.dataset.inst, q, on));
  /* The row buttons follow the same rule as the live page: with something armed they are
     record, otherwise they are fire. Arming is done on the live page, but a track stays
     armed across views, so the studio has to show the same truth. */
  const arming = Patchwork.record && Patchwork.record.armedCount > 0;
  grid.querySelectorAll(".st-fire").forEach(b => {
    b.classList.toggle("st-rec-row", !!arming);
    b.textContent = arming ? "●" : "▶";
    b.title = arming
      ? "Record the armed tracks into this scene, and play the rest of the row"
      : "Fire this scene (shift-click to capture every instrument into it)";
  });
}

/* Shift is capture, plain is fire. One modifier rather than a mode, because a launcher
   with a record-arm state is a launcher you can be in the wrong half of while playing. */
grid.addEventListener("click", e => {
  const cell = e.target.closest(".st-cell");
  if (cell){
    if (!cell.disabled) Patchwork.launch.click(e, +cell.dataset.row, cell.dataset.inst);
    return;
  }
  const fire = e.target.closest(".st-fire");
  if (!fire) return;
  const ri = +fire.dataset.row;
  if (Patchwork.record && Patchwork.record.armedCount) Patchwork.record.captureRow(ri);
  else if (e.shiftKey) Patchwork.scenes.storeAll(ri);
  else Patchwork.launch.fireRowShared(ri);
});

loadMix();
Patchwork.scenes.onChange(paint);
if (window.Patchwork.record) Patchwork.record.onChange(paint);
build();
/* ⚠️ An instrument's OWN Play button changes what is playing without telling the scene
   model, so a cell could stay ringed after its instrument had stopped. The live page has
   carried the same repaint for the same reason; the launcher needed one too. */
setInterval(paint, 400);
})();

/* ---- the master transport ----
   One tempo for the page, in the one place on it that is about the page rather than about
   an instrument, and the quantum beside it because "how fast" and "when does a change
   land" are the same question asked twice.

   The quantum segment also exists on the live page. Both paint from Patchwork.scenes on
   its change notification rather than from each other, so neither is the source of truth
   and switching views cannot show two different answers. */
(() => {
"use strict";
const up = document.querySelector("#stUp"), down = document.querySelector("#stDown"),
      out = document.querySelector("#stBpm"), quant = document.querySelector("#stQuant"),
      stop = document.querySelector("#stStop"), barCount = document.querySelector("#stBarCount"),
      click = document.querySelector("#stClick"), clickLvl = document.querySelector("#stClickLvl");
if (!up || !window.Patchwork || !Patchwork.clock) return;

stop.addEventListener("click", () => { Patchwork.launch.stopAll(); setTimeout(paint, 60); });

up.addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.bpm + 1));
down.addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.bpm - 1));
quant.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.scenes.setQuantum(b.dataset.q);
});

/* How long a "pattern" is. This used to be whatever CS·1's progression happened to be,
   which made the boundary circular for CS·1 itself — bringing it in meant waiting for a
   seam defined by the thing that was not playing yet. It is a number now, and the bar
   counter beside it draws the same number. */
barCount.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.scenes.setPatternBars(+b.dataset.b);
});

click.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  Patchwork.click.set(b.dataset.c === "on");
});
clickLvl.addEventListener("input", () => Patchwork.click.setLevel(clickLvl.value / 100));
Patchwork.click.onChange(paint);

function paint(){
  out.textContent = Patchwork.clock.bpm;
  const live = Patchwork.launch.anyPlaying();
  stop.classList.toggle("st-live", live);
  stop.disabled = !live;
  quant.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", b.dataset.q === Patchwork.scenes.quantum));
  barCount.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", +b.dataset.b === Patchwork.scenes.patternBars));
  click.querySelectorAll("button").forEach(b =>
    b.classList.toggle("st-sel", (b.dataset.c === "on") === Patchwork.click.on));
  quant.querySelector('[data-q="pattern"]').title =
    "Every " + Patchwork.scenes.patternBars + " bars — the pattern length in the Scenes head";
}
/* no initial: the instruments decide the page's starting tempo between them, and this
   only ever reports it */
Patchwork.clock.onTempo("studio", paint, null);
Patchwork.scenes.onChange(paint);
Patchwork.record.onChange(paint);
paint();
Patchwork.launch.mountMeasure(document.querySelector("#stBars"));
})();

/* ---- the jam ----
   Join a room by name and you are playing the same grid as everyone else on it. The prompt
   is deliberately the whole interface for now: a room is a string, and inventing a lobby
   before the model is proven would be building the second thing first. */
(() => {
"use strict";
const btn = document.querySelector("#stJamBtn"), who = document.querySelector("#stJamWho");
if (!btn || !window.Patchwork || !Patchwork.session) return;

const joinBtn = document.querySelector("#stJamJoin");
const list = document.querySelector("#stJamList");

function askName(){
  /* asked once and remembered, because being asked your own name every time you join is
     the kind of friction that stops people trying the feature twice */
  let n = "";
  try{ n = localStorage.getItem("patchwork-jam-name") || ""; }catch(e){}
  n = window.prompt("What should they call you?", n) || "";
  try{ localStorage.setItem("patchwork-jam-name", n); }catch(e){}
  return n;
}

btn.addEventListener("click", () => {
  list.hidden = true;
  if (Patchwork.session.active){ Patchwork.session.leave(); return; }
  const room = window.prompt("Name your jam — anyone who joins it plays with you", "jam");
  if (room == null) return;
  if (!Patchwork.session.join(room, askName()))
    who.innerHTML = "<em>" + (Patchwork.session.problem
      || "this browser cannot open a session") + "</em>";
});

/* ⚠️ Typing the same string on two machines is the single most likely way to end up in two
   empty rooms wondering why the other person cannot see you. Picking from a list removes
   that, and the list itself is the diagnostic: if it comes back empty over a relay, the
   two machines are not talking to the same one. */
joinBtn.addEventListener("click", () => {
  if (Patchwork.session.active){ list.hidden = true; return; }
  list.textContent = "";
  list.appendChild(Object.assign(document.createElement("div"),
    {className: "st-jam-empty", textContent: "looking…"}));
  list.hidden = false;
  Patchwork.session.browse((rooms, err) => {
    list.textContent = "";
    if (err || !rooms){
      list.appendChild(Object.assign(document.createElement("div"),
        {className: "st-jam-empty", textContent: err || "could not look"}));
      return;
    }
    if (!rooms.length){
      list.appendChild(Object.assign(document.createElement("div"), {className: "st-jam-empty",
        textContent: "No jams running. Start one — whoever joins it next will see it here."}));
      return;
    }
    rooms.forEach(r => {
      const b = document.createElement("button");
      b.className = "st-jam-row";
      b.appendChild(Object.assign(document.createElement("b"), {textContent: r.name}));
      b.appendChild(Object.assign(document.createElement("span"),
        {textContent: r.peers + (r.peers === 1 ? " player" : " players")}));
      b.addEventListener("click", () => {
        list.hidden = true;
        Patchwork.session.join(r.name, askName());
      });
      list.appendChild(b);
    });
  });
});

document.addEventListener("click", e => {
  if (!list.hidden && !e.target.closest("#stJam")) list.hidden = true;
});

/* ---- talkback ----
   Open, not push-to-talk: you are playing with both hands, and a button you have to hold
   is a button you cannot use while playing. Off by default, because a microphone that
   opens itself is nobody's idea of a good time. */
const talkBtn = document.querySelector("#stTalk");
talkBtn.addEventListener("click", async () => {
  talkBtn.disabled = true;
  const r = await Patchwork.talk.toggle();
  talkBtn.disabled = false;
  if (!r.ok) who.innerHTML = who.innerHTML + " &middot; <em>" + r.why + "</em>";
});
function paintTalk(){
  const inJam = Patchwork.session.active;
  talkBtn.hidden = !inJam || !Patchwork.talk.supported;
  talkBtn.classList.toggle("st-live", Patchwork.talk.on);
  talkBtn.textContent = Patchwork.talk.on ? "\u{1F534} Live" : "\u{1F3A4} Talk";
  talkBtn.title = Patchwork.talk.on
    ? "Your microphone is open to the jam — click to close it"
    : "Open your microphone to the jam";
}
Patchwork.talk.onChange(paintTalk);
Patchwork.session.onChange(paintTalk);
paintTalk();

function paint(){
  const on = Patchwork.session.active;
  btn.textContent = on ? "Leave jam" : "Start a jam";
  btn.classList.toggle("st-on", on);
  joinBtn.hidden = on;
  if (!on){
    /* keep an explanation on screen; clearing it would hide the only thing that says why */
    if (!Patchwork.session.problem) who.textContent = "";
    return;
  }
  const peers = Patchwork.session.peers, S = Patchwork.session;
  /* WHERE the jam is, not just that there is one. A two-laptop test that is quietly two
     tabs on one machine looks identical otherwise, and so does a relay that never
     connected — both would read "waiting for someone to join" forever. */
  const clk = S.clock;
  /* ⚠️ "connecting…" and "reconnecting…" are different diagnoses and used to read the same.
     The first means the relay has never answered — a wrong address, or a relay that is not
     running. The second means it answered and the link went away, which is the network and
     will very likely come back on its own. Telling somebody to check the address when they
     should just wait ten seconds is the cost of collapsing them. */
  const link = S.link === "retrying" ? " <em>(reconnecting…)</em>"
             : S.link === "connecting" ? " <em>(connecting…)</em>"
             : clk.synced ? "" : " <em>(syncing clock…)</em>";
  who.innerHTML = "<b>" + S.room + "</b> · via " + S.via + link
    + " · " + (peers.length
        ? "you and " + peers.length + " other" + (peers.length > 1 ? "s" : "")
        : "waiting for someone to join")
    + (clk.rttMs == null ? "" : " · " + clk.rttMs + " ms");
}
/* the peer count and the clock estimate both move without anything else changing */
setInterval(paint, 1000);
Patchwork.session.onChange(paint);
paint();
})();

/* The all-at-once faces/panels switch used to live here. It is gone: every panel already
   carries its own Panel button, so nothing was lost except a control in the header that
   made the Studio page's chrome sit differently from every other tab's. */

/* ---- the rack's MIDI, in one place ----
   Every instrument answers on a channel and every panel grew a pair of selects to set it,
   so the same question had six answers scattered across six panels — and the one you
   needed was always inside the panel you had not opened. The input port was the page's
   from the start (see shell/midi.js); this brings the channels up to join it.

   ⚠️ It does not OWN any of it. Each instrument still keeps its own channel and still
   filters its own input; this reads and writes them through the adapter each one registers.
   A second copy of the routing here would be a second thing to disagree with the first, and
   the panels' own selects — which standalone builds still need — would be the ones to go
   stale. */
(() => {
"use strict";
const box = document.querySelector("#stMidi");
if (!box || !window.Patchwork || !Patchwork.midi) return;
const inSel = box.querySelector("#stMidiIn"),
      rows = box.querySelector("#stMidiRows"),
      follow = box.querySelector("#stMidiFollow"),
      note = box.querySelector("#stMidiNote");

const chOptions = sel => {
  sel.appendChild(Object.assign(document.createElement("option"),
    {value: "-1", textContent: "Omni"}));
  for (let c = 0; c < 16; c++)
    sel.appendChild(Object.assign(document.createElement("option"),
      {value: String(c), textContent: String(c + 1)}));
};

function fillPorts(){
  const keep = Patchwork.midi.port ? Patchwork.midi.port.id : "";
  inSel.textContent = "";
  inSel.appendChild(Object.assign(document.createElement("option"),
    {value: "", textContent: "— none —"}));
  Patchwork.midi.ports("inputs").forEach(p => inSel.appendChild(Object.assign(
    document.createElement("option"), {value: p.id, textContent: p.name || p.id})));
  inSel.value = keep;
}
inSel.addEventListener("change", () => Patchwork.midi.select(inSel.value));

/* Built once per registered instrument. The selects are not rebuilt on every repaint — a
   <select> being rebuilt under an open menu closes it, and this repaints whenever anything
   in the rack's MIDI changes. */
const built = new Map();          // id -> {inCh, outCh}
function build(){
  Patchwork.midi.list().forEach(it => {
    if (built.has(it.id)) return;
    const row = document.createElement("div");
    row.className = "st-midi-row";
    row.dataset.inst = it.id;
    row.appendChild(Object.assign(document.createElement("span"),
      {className: "st-midi-name", textContent: it.name}));
    const made = {};
    [["inCh", "in"], ["outCh", "out"]].forEach(([key, lab]) => {
      const cell = document.createElement("span");
      cell.className = "st-midi-cell";
      if (!it.spec[key]){ cell.classList.add("st-midi-none"); rows && row.appendChild(cell); return; }
      const sel = document.createElement("select");
      sel.className = "st-midi-ch";
      chOptions(sel);
      sel.value = String(it.spec[key].get());
      sel.setAttribute("aria-label", it.name + " " + lab + " channel");
      sel.addEventListener("change", () => {
        it.spec[key].set(parseInt(sel.value, 10));
        paint();
      });
      cell.appendChild(Object.assign(document.createElement("span"),
        {className: "st-midi-lab", textContent: lab}));
      cell.appendChild(sel);
      made[key] = sel;
      row.appendChild(cell);
    });
    rows.appendChild(row);
    built.set(it.id, made);
  });
}

function paint(){
  build();
  const on = Patchwork.midi.follow;
  follow.checked = on;
  rows.classList.toggle("st-midi-ignored", on);
  Patchwork.midi.list().forEach(it => {
    const made = built.get(it.id);
    if (!made) return;
    ["inCh", "outCh"].forEach(k => {
      if (!made[k] || !it.spec[k]) return;
      const v = String(it.spec[k].get());
      if (made[k].value !== v) made[k].value = v;   // the panel's own select may have moved it
    });
  });
  const n = Patchwork.midi.ports("inputs").length;
  note.innerHTML = !n
    ? "No MIDI inputs found. Connect one and it will appear here."
    : on
      ? "Notes play <b>whichever panel has the keyboard</b> — click a panel to aim them. "
        + "Input channels are ignored while this is on; <b>out</b> still sends on its own channel."
      : n + " input" + (n === 1 ? "" : "s") + ". Each instrument listens on its own channel — "
        + "<b>Omni</b> answers to all of them.";
}

/* ⚠️ Held notes are dropped on the way through — see setFollow in shell/midi.js. Switching
   the rule a note-off will be routed by, while a note is held, is the one way to strand it. */
follow.addEventListener("change", () => { Patchwork.midi.setFollow(follow.checked); paint(); });

Patchwork.midi.onChange(() => { fillPorts(); paint(); });
fillPorts(); paint();
/* The instruments register during their own boot, which may be after this file runs. */
setTimeout(() => { fillPorts(); paint(); }, 0);
})();
