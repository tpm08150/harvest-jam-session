
/* ---- the tape library ----
   Saved takes, kept in IndexedDB.

   ⚠️ NOT localStorage, and this is the one place in the project that departs from it. Every
   other saved thing here — patches, scenes, MIDI maps — is a few hundred bytes of JSON and
   localStorage is exactly right for it. A five-minute stereo take is about 57 MB, against a
   quota of roughly five. It would not fail at the edge; it would fail on the first save.

   ⚠️ STORED AS WAV RATHER THAN RAW PCM. Forty-four bytes of header buys three things: the
   browser decodes it natively off-thread instead of us walking an Int16Array on the main
   one, the file is self-describing so a tape saved at 48 kHz still plays on a machine that
   opened at 44.1, and a tape can be downloaded straight from the shelf with no conversion
   step. The recorder already produces exactly this. */
Patchwork.library = (() => {
"use strict";

const DB = "patchwork-tapes", STORE = "tapes", VERSION = 1;
let db = null, opening = null;
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

function open(){
  if (db) return Promise.resolve(db);
  if (opening) return opening;
  opening = new Promise((ok, no) => {
    let rq;
    try{ rq = indexedDB.open(DB, VERSION); }
    catch(e){ no(e); return; }
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains(STORE)){
        const s = d.createObjectStore(STORE, {keyPath: "id"});
        s.createIndex("made", "made");
      }
    };
    rq.onsuccess = () => { db = rq.result; ok(db); };
    rq.onerror = () => no(rq.error);
    /* Private windows and blocked-storage settings reject rather than hang, but a second
       tab holding an old version blocks forever — so say so rather than spinning. */
    rq.onblocked = () => no(new Error("Another tab has the library open."));
  });
  return opening;
}

function tx(mode){
  return open().then(d => d.transaction(STORE, mode).objectStore(STORE));
}
function wrap(rq){
  return new Promise((ok, no) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error); });
}

/* The list carries everything EXCEPT the audio: a shelf of twenty tapes must not mean a
   gigabyte of blobs in memory to draw twenty labels. */
async function list(){
  const s = await tx("readonly");
  const all = await wrap(s.getAll());
  return all
    .map(t => ({id: t.id, name: t.name, made: t.made, seconds: t.seconds,
                rate: t.rate, bytes: t.wav ? t.wav.size : 0, colour: t.colour,
                synced: t.synced || 0, owner: t.owner || "", artist: t.artist || "",
                /* ⚠️ The blob itself, not a flag. Sleeve art has to be on screen for every
                   item at once, so a shelf of twenty would otherwise be twenty more reads
                   after the list; downscaled to ~40 kB it is cheaper to carry than to
                   fetch again. The audio stays out of the list for exactly the opposite
                   reason. */
                art: t.art || null}))
    .sort((a, b) => b.made - a.made);
}

async function get(id){
  const s = await tx("readonly");
  return wrap(s.get(id));
}

/* Cassette shells come in a few colours so a shelf of takes is scannable rather than a row
   of identical rectangles. Picked from the id, so a tape keeps its colour forever. */
const COLOURS = 6;

async function save(name, wav, meta){
  if (!wav || !wav.size) throw new Error("nothing to save");
  const id = (meta && meta.id) || ("t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const rec = {
    id,
    name: (name || "Untitled").slice(0, 60),
    made: Date.now(),
    seconds: +(meta && meta.seconds || 0),
    rate: +(meta && meta.rate || 48000),
    colour: (meta && meta.colour != null) ? meta.colour : Math.floor(Math.random() * COLOURS),
    /* ⚠️ The field is called `wav` for the local recorder that fills it, but a tape pulled
       back from the shelf in the cloud arrives as Ogg Opus. Nothing downstream cares —
       decodeAudioData sniffs the container — so this stays one field rather than two that
       could disagree about which one holds the audio. */
    wav,
    synced: 0,
  };
  if (meta && meta.id) rec.id = meta.id;                 // keep a cloud tape's own id
  if (meta && meta.made) rec.made = meta.made;
  if (meta && meta.synced) rec.synced = meta.synced;
  /* ⚠️ Who made it, carried on the LOCAL copy too. Without this a take fetched from
     somebody else's shelf looks exactly like one you recorded, and the next sync
     cheerfully uploads their music back into the bucket under your name. */
  if (meta && meta.owner) rec.owner = meta.owner;
  if (meta && meta.artist) rec.artist = meta.artist;
  if (meta && meta.art) rec.art = meta.art;
  const s = await tx("readwrite");
  try{
    await wrap(s.add(rec));
  }catch(e){
    /* Quota is the failure that actually happens here, and it happens at the moment someone
       has just played something worth keeping. Say which one it is. */
    if (e && (e.name === "QuotaExceededError" || e.name === "NotEnoughSpace"))
      throw new Error("No room left — delete a tape and try again.");
    throw e;
  }
  notify();
  return id;
}

/* ---- sleeve art ----
   ⚠️ RE-ENCODED, NEVER STORED AS DROPPED. A photo off a phone is three to eight megabytes,
   which is bigger than the Opus of the take it belongs to and would dwarf the library it
   decorates. 600px square at JPEG 0.82 lands around 40 kB and is more resolution than a
   132px sleeve can show. Cropped square from the centre, because sleeves are square and
   letterboxing someone's artwork looks like a mistake. */
const ART_MAX = 600;
function makeArt(file){
  return new Promise((ok, no) => {
    if (!file || !/^image\//.test(file.type)) { no(new Error("That is not an image.")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const n = Math.min(ART_MAX, side);
      const c = document.createElement("canvas");
      c.width = c.height = n;
      const g = c.getContext("2d");
      g.drawImage(img, sx, sy, side, side, 0, 0, n, n);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : no(new Error("Could not read that image.")), "image/jpeg", .82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error("Could not read that image.")); };
    img.src = url;
  });
}

/* Sync bookkeeping, kept off the audio path: patching a field must never rewrite the blob
   alongside it, which is why this reads the record and puts it back rather than taking a
   whole one from the caller. */
async function update(id, patch){
  const s = await tx("readwrite");
  const rec = await wrap(s.get(id));
  if (!rec) return false;
  Object.assign(rec, patch);
  await wrap(s.put(rec));
  notify();
  return true;
}

async function rename(id, name){
  const s = await tx("readwrite");
  const rec = await wrap(s.get(id));
  if (!rec) return false;
  rec.name = (name || "Untitled").slice(0, 60);
  rec.synced = 0;                    // the label changed, so the copy in the cloud is stale
  await wrap(s.put(rec));
  notify();
  return true;
}

async function remove(id){
  const s = await tx("readwrite");
  await wrap(s.delete(id));
  notify();
  return true;
}

/* How much room the shelf is taking. Worth showing: this is the only part of the app that
   can fill a disk. */
async function usage(){
  const all = await list();
  const bytes = all.reduce((n, t) => n + t.bytes, 0);
  let quota = 0;
  try{
    if (navigator.storage && navigator.storage.estimate){
      const e = await navigator.storage.estimate();
      quota = e.quota || 0;
    }
  }catch(e){}
  return {count: all.length, bytes, quota};
}

return {list, get, save, update, rename, remove, usage, makeArt,
        onChange: fn => subs.push(fn),
        get colours(){ return COLOURS; }};
})();
