/* ---- Songs, on the controller ----
   Shift + Transport was a view with no page: the Library came up and the pads and knobs went on
   pointing at whatever panel had the focus. It is also the one mode pad left, and the things a rack
   with no screen could not do at all (2026-09-19) are the things you keep: open a song, save one,
   start a blank one, recall and save a sound, join a jam. So this page is where keeping lives.

   ⚠️ NOTHING HERE HAS A KEYBOARD, SO NOTHING HERE ASKS FOR A NAME. A new song is "Song 3", a new
   patch is "Patch 7" — the lowest number not taken — and a jam is called what it was called last
   time. Rename them where there is a screen; a name nobody can type is not a reason to lose a take.

   ⚠️ AND EVERYTHING DESTRUCTIVE TAKES TWO PRESSES. Opening a song replaces the desk, and the page's
   own confirm is a dialogue nobody can see. So a pad pressed once is pointed at — the screen says its
   name — and pressed again, or `>`, it opens. The same for New.

   Banks, on the pair beside the encoders:

     Songs      knob 1 points at a song; pads are the songs; `>` opens; Record saves
                (over the open song, or as a new one when none is open);
                the last two pads are Save as new and New song
     an instrument, for each one with a patch row
                knob 1 is its patch; pads are its patches; Record saves over the loaded
                one; `>` saves a new one
     Jam        knob 1 points at a room; pads are the rooms; `>` joins, or leaves;
                Record starts a jam of your own

   Patches go through the panel's own #patchSel, #patchName and #patchSave, exactly as Settings goes
   through the tab's selects: this is a map of controls that already exist, not a second copy.

   ⚠️ NAMES, WITHOUT A KEYBOARD (2026-09-20). Func + `>` on a song or a patch starts spelling its name:
   knob 1 turns the letter under the cursor, knob 2 and the Track pair move the cursor, ∧ beside the
   pads puts a space in, ∨ takes the letter out, `>` or Record keeps it, Func + `>` again gives up. The
   screen shows the name with the letter in brackets. Func + a pad deletes a song or a patch, pressed
   twice like everything else here that cannot be undone. */
(() => {
"use strict";
const S = window.Patchwork && Patchwork.surface;
const P = window.Patchwork && Patchwork.project;
if (!S || !S.mount || !P) return;

/* top row first, as every grid here reads; cell 0 is bottom-left */
const cellOf = k => (k < 8 ? k + 8 : k - 8);
const slotOf = cell => (cell < 8 ? cell + 8 : cell - 8);
const clamp = (i, n) => Math.max(0, Math.min(n - 1, i));
/* The lowest "<word> N" not in `taken`. */
function fresh(word, taken){
  for (let n = 1; ; n++){ if (taken.indexOf(word + " " + n) < 0) return word + " " + n; }
}
/* What just happened, held on the grid's label for a moment — the label is the one line of the
   screen a page owns, and a pad has no other way to answer. */
let note = "", noteUntil = 0;
function tell(what){ note = what; noteUntil = performance.now() + 2500; return what; }
const told = () => (performance.now() < noteUntil ? note : "");
/* A press that needs a second one: the same thing pressed again inside three seconds. */
let pending = "", pendingUntil = 0;
function twice(what){
  const now = performance.now();
  if (pending === what && now < pendingUntil){ pending = ""; return true; }
  pending = what; pendingUntil = now + 3000;
  return false;
}
const waiting = what => pending === what && performance.now() < pendingUntil;

/* A list under knob 1: `names()` is read fresh, `at` is where it points. */
function cursor(id, label, short, names, at, go, none){
  return {
    id, label, short, stepped: true,
    text: () => { const n = names(); return n.length ? n[clamp(at(), n.length)] : none; },
    get: () => { const n = names(); return n.length > 1 ? clamp(at(), n.length) / (n.length - 1) : 0; },
    set: v => { const n = names(); if (n.length) go(Math.round(v * (n.length - 1))); },
    nudge: d => { const n = names(); if (n.length) go(clamp(at() + (d > 0 ? 1 : -1), n.length)); }
  };
}

/* ---- songs ---- */
const SONG_PADS = 14, SAVE_AS = 14, NEW = 15;         // slots, top-left first
let songAt = -1, songPage = 0;
function songIndex(){
  const n = P.names();
  if (songAt < 0) songAt = Math.max(0, n.indexOf(P.current));
  return clamp(songAt, Math.max(1, n.length));
}
function pointSong(i){
  const n = P.names();
  if (!n.length) return;
  songAt = clamp(i, n.length);
  songPage = Math.floor(songAt / SONG_PADS);
  pending = "";
  noteUntil = 0;                      // the label goes back to saying which song is pointed at
}
function openSong(){
  const n = P.names(), name = n[songIndex()];
  if (!name) return tell("No songs saved");
  /* ⚠️ STOPPED FIRST. Applying a project under running sequencers plays one pass of the old
     patterns through the new sounds; the page's own loader is used with the rack stopped too. */
  if (Patchwork.transport && Patchwork.transport.anyPlaying) Patchwork.transport.toggleAll();
  return tell(P.open(name) ? "Opened " + name : "Could not open");
}
function saveSong(asNew){
  const name = (!asNew && P.current) || fresh("Song", P.names());
  if (!P.save(name)) return tell("Storage is full");
  songAt = P.names().indexOf(name);
  songPage = Math.floor(Math.max(0, songAt) / SONG_PADS);
  return tell("Saved " + name);
}
/* ⚠️ A BLANK DESK IS A RELOAD WITH NO SONG OPEN — the same thing "— unsaved —" and a reload do by
   hand, since nothing else puts every instrument back to its first state. In kiosk the page comes
   back by itself, controller and all; what was unsaved is gone, which is what the second press is for. */
function newSong(){
  P.forget();
  tell("New song");
  setTimeout(() => location.reload(), 150);
}
const songGrid = {
  cells(){
    const out = new Array(16).fill(null), n = P.names(), base = songPage * SONG_PADS;
    for (let k = 0; k < SONG_PADS && base + k < n.length; k++){
      const i = base + k, open = n[i] === P.current, aimed = i === songIndex();
      out[cellOf(k)] = aimed ? {colour: "white", on: true, hot: waiting("song:" + i)}
                             : {colour: open ? "green" : "cyan", on: open};
    }
    out[cellOf(SAVE_AS)] = {colour: "amber", on: false};
    out[cellOf(NEW)] = {colour: "red", on: waiting("new"), hot: waiting("new")};
    return out;
  },
  down(cell, vel, mods){
    const k = slotOf(cell);
    if (mods && mods.accent){
      const i = songPage * SONG_PADS + k;
      if (k < SONG_PADS && i < P.names().length) deleteSong(i);
      return;
    }
    if (k === SAVE_AS){ saveSong(true); return; }
    if (k === NEW){ if (twice("new")) newSong(); else tell("New? press again"); return; }
    const i = songPage * SONG_PADS + k;
    if (i >= P.names().length) return;
    if (i === songIndex() && twice("song:" + i)){ openSong(); return; }
    pointSong(i);
    twice("song:" + i);                                // pointed at: the next press opens it
  },
  pages: () => Math.max(1, Math.ceil(P.names().length / SONG_PADS)),
  page: () => songPage,
  setPage: p => { songPage = p; }
};

/* ---- patches, an instrument at a time ---- */
function soundPanels(){
  return (Patchwork.roots || []).filter(r => r.querySelector("#patchSel") && r.querySelector("#patchSave"))
    .map(r => {
      const id = r.dataset.instrument;
      const m = Patchwork.midi && Patchwork.midi.list ? Patchwork.midi.list().find(x => x.id === id) : null;
      return {id, root: r, name: (m && m.name) || id.toUpperCase()};
    });
}
/* The list's real entries: every option with a value, which leaves out "— select —". */
function patchOptions(p){
  return Array.prototype.filter.call(p.root.querySelector("#patchSel").options, o => o.value !== "");
}
function pickPatch(p, o){
  const sel = p.root.querySelector("#patchSel");
  sel.value = o.value;
  sel.dispatchEvent(new Event("change", {bubbles: true}));
  tell("Loaded " + o.textContent.trim());
}
function savePatch(p, asNew){
  const nameEl = p.root.querySelector("#patchName"), btn = p.root.querySelector("#patchSave");
  if (!nameEl || !btn) return null;
  if (asNew || !nameEl.value.trim())
    nameEl.value = fresh("Patch", patchOptions(p).map(o => o.textContent.trim()));
  const name = nameEl.value.trim();
  btn.click();
  return tell("Saved " + name);
}
let patchPage = 0;
function patchGrid(p){
  return {
    cells(){
      const out = new Array(16).fill(null), list = patchOptions(p), base = patchPage * 16;
      const sel = p.root.querySelector("#patchSel");
      for (let k = 0; k < 16 && base + k < list.length; k++){
        const on = list[base + k].value === sel.value;
        out[cellOf(k)] = {colour: on ? "white" : "cyan", on};
      }
      return out;
    },
    down(cell, vel, mods){
      const o = patchOptions(p)[patchPage * 16 + slotOf(cell)];
      if (!o) return;
      if (mods && mods.accent) deletePatch(p, o); else pickPatch(p, o);
    },
    pages: () => Math.max(1, Math.ceil(patchOptions(p).length / 16)),
    page: () => patchPage,
    setPage: n => { patchPage = n; }
  };
}

/* ---- a jam ----
   ⚠️ THE STUDIO ASKS WITH window.prompt(), which a page nobody can see never answers. Here a room is
   picked from the relay's list, and a jam of your own takes the name it had last time. */
const J = () => Patchwork.session;
const JAM_NAME = "patchwork-jam-name", JAM_ROOM = "patchwork-jam-room";
const stored = (k, d) => { try{ return localStorage.getItem(k) || d; }catch(e){ return d; } };
let rooms = [], roomAt = 0, looking = false;
function lookForRooms(){
  if (!J() || !J().browse || looking) return;
  looking = true;
  try{
    J().browse((found, err) => {
      looking = false;
      rooms = (found || []).map(r => (typeof r === "string" ? r : (r && (r.room || r.name || r.id)) || ""))
                           .filter(Boolean);
      roomAt = clamp(roomAt, Math.max(1, rooms.length));
      if (err) tell(String(err).slice(0, 16));
    });
  }catch(e){ looking = false; }
}
function joinRoom(room){
  if (!J()) return tell("No jam here");
  if (J().active){ J().leave(); return tell("Left the jam"); }
  if (!room) return tell("No rooms found");
  try{ localStorage.setItem(JAM_ROOM, room); }catch(e){}
  return tell(J().join(room, stored(JAM_NAME, "Pi")) ? "Joined " + room
                                                      : String(J().problem || "Cannot join").slice(0, 16));
}
const jamGrid = {
  cells(){
    const out = new Array(16).fill(null), live = !!(J() && J().active);
    rooms.slice(0, 16).forEach((r, k) => {
      out[cellOf(k)] = k === roomAt ? {colour: live ? "green" : "white", on: true}
                                    : {colour: "cyan", on: false};
    });
    return out;
  },
  down(cell){
    const k = slotOf(cell);
    if (k >= rooms.length) return;
    if (k === roomAt && twice("room:" + k)){ joinRoom(rooms[k]); return; }
    roomAt = k; noteUntil = 0; twice("room:" + k);
  }
};

/* ---- spelling a name ----
   The alphabet under knob 1, in the order a hand wants: capitals, then small, then digits, then the
   few marks a name needs. A new letter starts as the one under the cursor, so "Song 1" becomes
   "Song 2" in one detent. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -'.&!?";
let naming = null;                          // {kind: "song"|"patch", from, panel, text, cursor}
function startNaming(kind, from, panel){
  naming = {kind, from, panel, text: from, cursor: Math.max(0, from.length - 1)};
  pending = ""; noteUntil = 0;
}
function nameShown(){
  const n = naming;
  if (!n) return "";
  const t = n.text, c = n.cursor;
  const s = t.slice(0, c) + "[" + (t[c] || "_") + "]" + t.slice(c + 1);
  /* sixteen on the glass: a window around the cursor when the name is longer */
  if (s.length <= 16) return s;
  const start = Math.max(0, Math.min(s.length - 16, c - 6));
  return s.slice(start, start + 16);
}
function setChar(i){
  const n = naming;
  if (!n) return;
  const ch = ALPHABET[Math.max(0, Math.min(ALPHABET.length - 1, i))];
  n.text = n.text.slice(0, n.cursor) + ch + n.text.slice(n.cursor + 1);
}
const charAt = () => { const n = naming; const k = n ? ALPHABET.indexOf(n.text[n.cursor] || "") : -1; return k < 0 ? 0 : k; };
function moveCursor(d){
  const n = naming;
  if (!n) return null;
  /* one past the end is allowed: that is where a letter is added */
  n.cursor = Math.max(0, Math.min(n.text.length, n.cursor + d));
  if (n.cursor === n.text.length && n.text.length < 24) n.text += n.text[n.text.length - 1] === " " ? "a" : " ";
  return nameShown();
}
function insertSpace(){
  const n = naming;
  if (!n || n.text.length >= 24) return null;
  n.text = n.text.slice(0, n.cursor) + " " + n.text.slice(n.cursor);
  return nameShown();
}
function deleteChar(){
  const n = naming;
  if (!n || !n.text.length) return null;
  n.text = n.text.slice(0, n.cursor) + n.text.slice(n.cursor + 1);
  n.cursor = Math.max(0, Math.min(n.cursor, n.text.length - 1));
  return nameShown();
}
const namingControls = () => [
  {id: "name-char", label: "Letter", short: "Ltr", stepped: true,
   text: () => nameShown(), get: () => charAt() / (ALPHABET.length - 1),
   set: v => setChar(Math.round(v * (ALPHABET.length - 1))),
   nudge: d => setChar(charAt() + (d > 0 ? 1 : -1))},
  {id: "name-cursor", label: "Cursor", short: "Cur", stepped: true,
   text: () => nameShown(), get: () => (naming ? naming.cursor / Math.max(1, naming.text.length) : 0),
   set: v => { if (naming) naming.cursor = Math.round(v * naming.text.length); },
   nudge: d => moveCursor(d > 0 ? 1 : -1)}
];
/* Keep the name: a song is saved under it and the old one removed; a patch is saved under it through
   the panel's own buttons and the old one deleted, so what the panel does happens here too. */
function finishNaming(){
  const n = naming;
  naming = null;
  if (!n) return null;
  const name = n.text.trim();
  if (!name || name === n.from) return tell("Unchanged");
  if (n.kind === "song"){
    if (!P.rename(n.from, name)) return tell(P.names().indexOf(name) >= 0 ? "Name taken" : "Could not");
    songAt = P.names().indexOf(name);
    return tell("Renamed " + name);
  }
  const p = n.panel, sel = p.root.querySelector("#patchSel"), nameEl = p.root.querySelector("#patchName");
  const old = patchOptions(p).find(o => o.textContent.trim() === n.from);
  if (patchOptions(p).some(o => o.textContent.trim() === name)) return tell("Name taken");
  nameEl.value = name;
  p.root.querySelector("#patchSave").click();
  const del = p.root.querySelector("#patchDelete");
  if (old && del){
    sel.value = old.value; del.click();
    const now = patchOptions(p).find(o => o.textContent.trim() === name);
    if (now){ sel.value = now.value; }
  }
  return tell("Renamed " + name);
}

/* ---- deleting, twice ---- */
function deleteSong(i){
  const name = P.names()[i];
  if (!name) return null;
  if (!twice("del:" + name)) return tell("Delete? again");
  P.remove(name);
  songAt = -1;
  return tell("Deleted " + name);
}
function deletePatch(p, o){
  if (!twice("delp:" + o.value)) return tell("Delete? again");
  const sel = p.root.querySelector("#patchSel"), del = p.root.querySelector("#patchDelete");
  if (!del) return tell("Cannot here");
  sel.value = o.value; del.click();
  return tell("Deleted " + o.textContent.trim().slice(0, 8));
}

/* ---- the banks ---- */
let bank = 0;
function banks(){
  const out = [{kind: "songs", name: "Songs"}];
  soundPanels().forEach(p => out.push({kind: "sound", name: p.name, panel: p}));
  if (J()) out.push({kind: "jam", name: "Jam"});
  return out;
}
const bankNow = () => { const b = banks(); return b[clamp(bank, b.length)]; };

function controls(){
  if (naming) return namingControls();
  const b = bankNow();
  if (b.kind === "songs")
    return [cursor("song", "Song", "Sng", P.names, songIndex, pointSong, "none saved")];
  if (b.kind === "sound") return [S.patch(b.panel.id)].filter(Boolean);
  return [cursor("room", "Room", "Rm", () => rooms, () => roomAt, i => { roomAt = i; pending = ""; },
                 looking ? "looking" : "no rooms")];
}
const gridNow = () => {
  const b = bankNow();
  return b.kind === "songs" ? songGrid : b.kind === "sound" ? patchGrid(b.panel) : jamGrid;
};
function label(){
  const b = bankNow(), said = told();
  if (said) return said;
  if (naming) return nameShown();
  if (b.kind === "songs"){
    const n = P.names(), name = n[songIndex()];
    if (!name) return "Songs  none saved";
    return (name === P.current ? "Open: " : waiting("song:" + songIndex()) ? "Open? " : "Song: ") + name;
  }
  if (b.kind === "sound") return b.name + " patches";
  if (J() && J().active) return "In a jam";
  return rooms.length ? "Jam: " + rooms[roomAt] : (looking ? "Jam  looking" : "Jam  no rooms");
}

S.mount("songs", {
  name: "Songs",
  show: () => { if (S.rig && S.rig.goto) S.rig.goto("lib"); songAt = -1; },
  controls,
  controlBanks: () => banks().map(b => ({name: b.name})),
  controlBank: () => clamp(bank, banks().length),
  setControlBank: i => {
    bank = clamp(i, banks().length);
    pending = ""; patchPage = 0;
    if (bankNow().kind === "jam") lookForRooms();
  },
  /* One object, asked afresh each time, so a press and its release see the grid of the bank that is
     up — see grid() in shell/surface.js, which allows a function for exactly this. */
  grid: () => {
    const g = gridNow();
    return {label, announce: true, cells: g.cells, down: g.down, pages: g.pages, page: g.page, setPage: g.setPage,
            /* ∧ puts a space in, ∨ takes the letter out, while a name is being spelt; otherwise the
               arrows page as they always did */
            move: dir => (naming ? (dir < 0 ? insertSpace() : deleteChar()) : null)};
  },
  /* Func + `>`: spell the name of what is pointed at; while spelling, give up. */
  altActionName: "Name",
  altAction: () => {
    if (naming){ naming = null; return "Kept as it was"; }
    const b = bankNow();
    if (b.kind === "songs"){
      const name = P.names()[songIndex()];
      if (!name) return "No song";
      startNaming("song", name, null);
    } else if (b.kind === "sound"){
      const sel = b.panel.root.querySelector("#patchSel");
      const o = patchOptions(b.panel).find(x => x.value === sel.value);
      if (!o) return "Load one first";
      if (/^f:/.test(o.value)) return "Factory: no";
      startNaming("patch", o.textContent.trim(), b.panel);
    } else return null;
    return nameShown();
  },
  track: dir => (naming ? moveCursor(dir) : false),
  /* `>`: the thing the bank is a list of — or the name, while one is being spelt. */
  actionName: "Songs",
  action: () => {
    if (naming) return finishNaming();
    const b = bankNow();
    if (b.kind === "songs") return openSong();
    if (b.kind === "sound") return savePatch(b.panel, true);
    return joinRoom(rooms[roomAt]);
  },
  /* Record keeps: over what is open, or as something new when nothing is. It is a press, not an
     arm, so the light stays off. */
  record: () => {
    if (naming){ finishNaming(); return; }
    const b = bankNow();
    if (b.kind === "songs") saveSong(false);
    else if (b.kind === "sound") savePatch(b.panel, false);
    else if (J() && !J().active){
      const room = stored(JAM_ROOM, "jam");
      tell(J().join(room, stored(JAM_NAME, "Pi")) ? "Started " + room
                                                   : String(J().problem || "Cannot start").slice(0, 16));
    }
  },
  armed: false
});
})();
