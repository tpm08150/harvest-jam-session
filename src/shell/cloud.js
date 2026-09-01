
/* ---- tapes that follow you ----
   Supabase Storage over its REST API, with magic-link sign-in.

   ⚠️ NO SDK. This project is a pure join of raw fragments with no bundler and no
   node_modules, so `@supabase/supabase-js` is not available and inlining it would add more
   code than the six calls below. Storage and auth are both plain REST; fetch is enough.

   ⚠️ THE KEY BELOW IS MEANT TO BE PUBLIC. Supabase's publishable/anon key ships in client
   code by design and is useless without a row-level-security policy letting it through —
   which is why the setup notes insist on the per-user-folder policies. The service_role key
   is the opposite of this and must never appear in a browser: it bypasses RLS entirely.

   ⚠️ UNCONFIGURED IS A SUPPORTED STATE. Until URL and KEY are filled in, everything here
   reports "off" and the library stays purely local. Nothing about the local shelf depends
   on any of this working. */
Patchwork.cloud = (() => {
"use strict";

/* ---------------------------------------------------------------------------
   SETUP — fill these in from the new Supabase project's Settings → API.

     1. Create the project (a SEPARATE one from inventory-app).
     2. Run docs/supabase-tapes.sql in the SQL editor. It makes the `tapes`
        bucket (private, with a size cap) and the four RLS policies. You do NOT
        need to enable RLS — storage.objects already has it on.
     3. Authentication → Providers → Email: enable it, and turn ON "Email OTP"
        / magic link. Under URL Configuration add this app's address to
        "Redirect URLs" (http://localhost:5179 for local, plus the Netlify URL).
     4. Paste the two values below — Settings → API → Project URL, and the
        publishable (anon) key.
     5. ⚠️ RUN `python3 tools/build.py`. The shipped index.html is a JOIN of the
        files under src/, so editing this one changes nothing on its own — the
        page keeps serving the old empty values and sync stays hidden, which
        looks exactly like the key being wrong.
   --------------------------------------------------------------------------- */
const URL_BASE = "https://wouwmauxrhfcjcpritut.supabase.co";                 // e.g. https://abcdefgh.supabase.co
const KEY = "sb_publishable_RYoGorNnROEJCFI1JY111Q_AUpX24zP";                      // the publishable / anon key — NOT service_role
const BUCKET = "tapes";

const SESSION_KEY = "patchwork-cloud-session";
const NAME_KEY = "patchwork-cloud-name";
const subs = [];
function notify(){ subs.forEach(fn => { try{ fn(); }catch(e){} }); }

const configured = () => !!(URL_BASE && KEY);
let session = null;                  // {access_token, refresh_token, expires_at, email, sub}

function loadSession(){
  try{
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s && s.access_token) session = s;
  }catch(e){}
}
function storeSession(s){
  session = s;
  try{
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }catch(e){}
  notify();
}
/* The JWT carries the user id and email; reading them here saves a round trip on every
   page load just to find out who is signed in. */
/* ⚠️ A CHOSEN NAME, NOT THE EMAIL ADDRESS. The JWT carries an email and it would be the
   easy thing to stamp on a shared shelf — but publishing everyone's address to everyone
   else, forever, because they uploaded a jam take is not a trade any of them agreed to.
   Defaults to the bit before the @, which is a name-ish thing they can change. */
function displayName(){
  try{ const n = localStorage.getItem(NAME_KEY); if (n) return n; }catch(e){}
  /* Google hands over a real name, so use it rather than making somebody type the name
     they already told Google. Falls back to the local part of the address. */
  if (session && session.name) return session.name;
  const em = session && session.email ? session.email : "";
  return em ? em.split("@")[0] : "someone";
}
function setDisplayName(n){
  n = (n || "").trim().slice(0, 40);
  try{ if (n) localStorage.setItem(NAME_KEY, n); else localStorage.removeItem(NAME_KEY); }catch(e){}
  notify();
}

/* Supabase nests the provider's profile under user_metadata; Google fills in full_name. */
function nameFrom(c){
  const m = c && c.user_metadata ? c.user_metadata : {};
  return (m.full_name || m.name || "").toString().slice(0, 40);
}
function claims(tok){
  try{
    const p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "===".slice((p.length + 3) % 4)));
  }catch(e){ return {}; }
}

/* ⚠️ Supabase returns the magic-link tokens in the URL FRAGMENT, not the query string, so
   they never reach a server — including ours. Read them, then scrub the address bar: a
   pasted URL with a live access token in it is a handed-over account. */
function absorbHash(){
  if (!location.hash || location.hash.indexOf("access_token") < 0) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  const at = h.get("access_token");
  if (!at) return false;
  const c = claims(at);
  storeSession({
    access_token: at,
    refresh_token: h.get("refresh_token") || "",
    expires_at: Date.now() + (+h.get("expires_in") || 3600) * 1000,
    email: c.email || "",
    sub: c.sub || "",
    name: nameFrom(c),
  });
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

async function refresh(){
  if (!session || !session.refresh_token) return false;
  const r = await fetch(URL_BASE + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: {apikey: KEY, "Content-Type": "application/json"},
    body: JSON.stringify({refresh_token: session.refresh_token}),
  });
  if (!r.ok){ storeSession(null); return false; }
  const d = await r.json();
  const c = claims(d.access_token);
  storeSession({
    access_token: d.access_token,
    refresh_token: d.refresh_token || session.refresh_token,
    expires_at: Date.now() + (d.expires_in || 3600) * 1000,
    email: c.email || session.email, sub: c.sub || session.sub,
    name: nameFrom(c) || session.name,
  });
  return true;
}
async function token(){
  if (!session) return null;
  /* a minute of slack, so an upload that takes thirty seconds does not expire mid-flight */
  if (session.expires_at - Date.now() < 60000){ if (!await refresh()) return null; }
  return session.access_token;
}

/* ---- Google ----
   ⚠️ A REDIRECT, not a fetch. The OAuth dance has to happen in the address bar so Google can
   show its own consent screen and set its own cookies; fetching this endpoint returns the
   redirect rather than following it and nothing happens. Supabase sends the browser back
   with the tokens in the fragment, which absorbHash() already handles — the return leg is
   identical to a magic link's.

   In practice this is one click and no typing: anyone arriving from the Hub already has a
   live Google session in that browser, so Google returns immediately without a prompt. */
function signInWithGoogle(){
  if (!configured()) throw new Error("Cloud sync is not configured yet.");
  const back = location.origin + location.pathname;
  location.href = URL_BASE + "/auth/v1/authorize?provider=google&redirect_to=" +
                  encodeURIComponent(back);
}

/* ⚠️ SIGNING IN IS NOT BEING ALLOWED IN. Any Google account on earth can complete the flow
   above; membership is decided in the database by jam_allowed(), and this asks it. The RLS
   policies are what actually enforce it — this call only exists so the app can say why the
   shelf is empty instead of looking broken. */
async function allowed(){
  if (!session) return false;
  try{
    const r = await req("/rest/v1/rpc/jam_allowed", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: "{}",
    });
    return (await r.json()) === true;
  }catch(e){
    /* ⚠️ NULL, NOT FALSE, when the question could not be asked. "The server said no" and
       "the wifi dropped" are different answers and only one of them should shut the door —
       this gets used in a venue on borrowed wifi, and locking someone out of their own
       instruments because a request timed out would be the app breaking, not protecting
       anything. The bucket refuses them regardless; that is where the real rule lives. */
    return null;
  }
}

async function signIn(email){
  if (!configured()) throw new Error("Cloud sync is not configured yet.");
  const r = await fetch(URL_BASE + "/auth/v1/otp", {
    method: "POST",
    headers: {apikey: KEY, "Content-Type": "application/json"},
    body: JSON.stringify({email, create_user: true,
                          options: {email_redirect_to: location.origin + location.pathname}}),
  });
  if (!r.ok){
    let msg = "Could not send the link.";
    try{ const d = await r.json(); msg = d.msg || d.error_description || d.message || msg; }catch(e){}
    throw new Error(msg);
  }
  return true;
}
async function signOut(){
  const t = session && session.access_token;
  storeSession(null);
  if (t) try{
    await fetch(URL_BASE + "/auth/v1/logout", {
      method: "POST", headers: {apikey: KEY, Authorization: "Bearer " + t},
    });
  }catch(e){}
}

/* ---- storage ----
   Everything lives under the signed-in user's own id, which is what the RLS policies key
   on. A path outside your own folder is refused by the database, not by this file. */
function folder(){ return session && session.sub ? session.sub : null; }

async function req(path, opts){
  const t = await token();
  if (!t) throw new Error("Not signed in.");
  const o = opts || {};
  o.headers = Object.assign({apikey: KEY, Authorization: "Bearer " + t}, o.headers || {});
  const r = await fetch(URL_BASE + path, o);
  if (!r.ok){
    let msg = r.status + " " + r.statusText;
    try{ const d = await r.json(); msg = d.message || d.error || msg; }catch(e){}
    throw new Error(msg);
  }
  return r;
}

/* ⚠️ METADATA RIDES ALONGSIDE AS JSON, not in a Postgres table. A table would mean a
   migration to run in a project that does not exist yet, and a schema to keep in step with
   the local one; a sidecar object needs nothing but the bucket that already has to exist.
   Renaming is then a re-PUT of a few hundred bytes rather than a file move. */
/* Paths now take an owner, because a shared shelf means reaching into other people's
   folders to LISTEN. Writing still only ever targets folder() — the RLS insert/update/
   delete rules would refuse anything else anyway, which is the point. */
const audioPath = (owner, id) => owner + "/" + id + ".opus";
const metaPath  = (owner, id) => owner + "/" + id + ".json";
const artPath   = (owner, id) => owner + "/" + id + ".jpg";

async function putAudio(id, blob){
  await req("/storage/v1/object/" + BUCKET + "/" + audioPath(folder(), id) + "?upsert=true", {
    method: "POST",
    headers: {"Content-Type": "audio/ogg", "x-upsert": "true"},
    body: blob,
  });
  return audioPath(folder(), id);
}
async function putMeta(id, meta){
  const body = Object.assign({}, meta, {artist: displayName(), owner: folder()});
  await req("/storage/v1/object/" + BUCKET + "/" + metaPath(folder(), id) + "?upsert=true", {
    method: "POST",
    headers: {"Content-Type": "application/json", "x-upsert": "true"},
    body: JSON.stringify(body),
  });
}
async function putArt(id, blob){
  await req("/storage/v1/object/" + BUCKET + "/" + artPath(folder(), id) + "?upsert=true", {
    method: "POST",
    headers: {"Content-Type": "image/jpeg", "x-upsert": "true"},
    body: blob,
  });
}
async function getArt(owner, id){
  const r = await req("/storage/v1/object/" + BUCKET + "/" + artPath(owner, id));
  return r.blob();
}

async function listPrefix(prefix){
  const r = await req("/storage/v1/object/list/" + BUCKET, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({prefix, limit: 500, offset: 0,
                          sortBy: {column: "name", order: "asc"}}),
  });
  return r.json();
}

/* ⚠️ Storage's list is NOT recursive. Asking for the root returns one row per FOLDER (with
   a null id) rather than every object underneath, so a shared shelf has to walk two levels:
   the uid folders, then each one's contents. That is a handful of requests for a handful of
   people, run in parallel — but it is why this is not the one call it looks like it should
   be, and why it would need paging if the group ever got large. */
async function list(){
  if (!folder()) return [];
  const roots = await listPrefix("");
  const folders = roots.filter(o => !o.id).map(o => o.name);
  if (!folders.length) return [];
  const per = await Promise.all(folders.map(async owner => {
    let rows = [];
    try{ rows = await listPrefix(owner + "/"); }catch(e){ return []; }
    const audio = new Map(), metas = [], art = new Set();
    rows.forEach(o => {
      if (/\.opus$/.test(o.name)) audio.set(o.name.replace(/\.opus$/, ""), o);
      else if (/\.json$/.test(o.name)) metas.push(o.name.replace(/\.json$/, ""));
      else if (/\.jpg$/.test(o.name)) art.add(o.name.replace(/\.jpg$/, ""));
    });
    return Promise.all(metas.filter(id => audio.has(id)).map(async id => {
      try{
        const m = await req("/storage/v1/object/" + BUCKET + "/" + metaPath(owner, id));
        const d = await m.json();
        return {id, owner, name: d.name, artist: d.artist || "someone",
                made: d.made, seconds: d.seconds, colour: d.colour,
                /* ⚠️ From the LISTING, not from the sidecar. A sidecar written before the
                   cover was added would say there is none; the object either exists in the
                   bucket or it does not, and that cannot go stale. */
                hasArt: art.has(id),
                mine: owner === folder(),
                bytes: (audio.get(id).metadata || {}).size || 0};
      }catch(e){ return null; }
    }));
  }));
  return per.flat().filter(Boolean);
}

async function getAudio(owner, id){
  const r = await req("/storage/v1/object/" + BUCKET + "/" + audioPath(owner, id));
  return r.blob();
}
/* Only ever your own — the RLS delete rule refuses anything else, so this failing loudly on
   someone else's tape is the database doing its job rather than a bug to work around. */
async function remove(id){
  await req("/storage/v1/object/" + BUCKET, {
    method: "DELETE",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({prefixes: [audioPath(folder(), id), metaPath(folder(), id),
                                    artPath(folder(), id)]}),
  });
}

loadSession();
const arrived = absorbHash();

return {signIn, signInWithGoogle, allowed,
        signOut, list, putAudio, putMeta, getAudio, remove, putArt, getArt,
        setDisplayName,
        get displayName(){ return displayName(); },
        onChange: fn => subs.push(fn),
        get configured(){ return configured(); },
        get signedIn(){ return !!(session && session.access_token); },
        get email(){ return session ? session.email : ""; },
        get uid(){ return folder(); },
        get justArrived(){ return arrived; },
        get bucket(){ return BUCKET; }};
})();
