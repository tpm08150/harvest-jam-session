
/* Kiosk — the page with nobody in front of it.

   ⚠️ THIS EXISTS BECAUSE EVERY DEFAULT IN THE SHELL ASSUMES A PERSON. The surface waits to
   be chosen from a list, SysEx waits for a deliberate click because it is a scarier-sounding
   permission than it deserves, and the audio context waits for a gesture because browsers
   make it. Every one of those is the right default on a laptop and wrong on a box that boots
   into this with a Launchkey plugged in and no screen, no keyboard and no mouse.

   So this is not a relaxation of those rules, it is a statement that the operator has already
   answered them — by building the machine. It is off unless asked for:

     ?kiosk        on the URL, which is what the Pi's systemd unit passes
     localStorage patchwork-kiosk = "1"

   ⚠️ AND IT GRANTS NOTHING BY ITSELF. SysEx and MIDI are still the browser's to give; all
   this does is ASK without waiting to be told to. On the Pi the answer is given before the page
   loads, by pi/jam-browser over Chromium's DevTools protocol. There is no policy for it: the two
   this comment used to point at do not exist, and a Pi relying on them would have waited forever
   on a dialogue nobody can click. On a laptop with kiosk on you get the ordinary prompts, which
   is the honest behaviour and makes this testable without a Pi. */
Patchwork.kiosk = (() => {
"use strict";

const KEY = "patchwork-kiosk";
function wanted(){
  /* A page nobody can see has nobody to click it either: screenless (shell/host.js) is kiosk too. */
  if (Patchwork.screenless) return true;
  try{
    if (/[?&]kiosk\b/.test(location.search)) return true;
    return localStorage.getItem(KEY) === "1";
  }catch(e){ return /[?&]kiosk\b/.test(location.search); }
}
const on = wanted();

/* Remembered when it arrives on the URL, so a reload that loses the query string — a crash,
   a Chromium restart, anything the operator did not type — comes back up in kiosk. */
if (on){ try{ localStorage.setItem(KEY, "1"); }catch(e){} }

const log = [];
function note(what){
  log.push({t: Date.now(), what});
  if (log.length > 40) log.shift();
}

/* ---- audio ----
   ⚠️ A GESTURE IS STILL REQUIRED and Chromium is still the one that decides. The flag the Pi
   passes (--autoplay-policy=no-user-gesture-required) is what actually permits this; the
   retry is for everything else, because a context built before the audio device is ready
   comes up suspended and stays that way with nobody to click. */
function wake(){
  if (!Patchwork.audio) return "no bus";
  const state = Patchwork.audio.resume();
  note("audio " + state);
  return state;
}

/* ---- the controller ----
   ⚠️ ONLY WHEN THERE IS EXACTLY ONE, which is the whole safety of doing this unasked. The
   surface's own restore() takes a REMEMBERED choice and there is nothing remembered on a
   machine that has just been flashed — so this picks the one detected profile, and refuses
   to guess between two. A rack with two known controllers on it is a decision, and a
   decision belongs to a person even when the person is not in the room. */
/* ⚠️ ONE CONNECT AT A TIME, AND ITS RESULT WRITTEN DOWN. connect() is asynchronous — it may ask for
   SysEx first — and this used to fire it and note "surface" at once, so the two-second loop and every
   port change could start another while the first was still on its way. A headless run against the
   surface harness logged "surface launchkey-mk4" five times in fourteen seconds: a controller being
   started again and again, not once. Now the loop waits for the one in flight, and the log says
   whether it held.

   ⚠️ AND WHAT IT SAW WHEN IT FOUND NOTHING. On the first Pi the Launchkey was not recognised, and the
   log could not tell a controller the page never saw from one it saw and did not know by name. The
   input names are noted whenever they change. */
let connecting = false, seen = null;
function claim(){
  const S = Patchwork.surface;
  if (!S || S.connected || connecting) return false;
  const found = S.available;
  if (found.length !== 1){
    if (found.length) note("waiting: " + found.length + " surfaces detected");
    else {
      const names = Patchwork.midi ? Patchwork.midi.ports("inputs").map(p => p.name).join(", ") : "";
      if (names !== seen){ seen = names; note("no controller among inputs: " + (names || "none")); }
    }
    return false;
  }
  const id = found[0].id;
  connecting = true;
  note("connecting " + id);
  Promise.resolve(S.connect(id))
    .then(ok => note(ok ? "surface " + id : "surface " + id + " did not connect"),
          e => note("surface " + id + " failed: " + ((e && e.message) || e)))
    .then(() => { connecting = false; });
  return true;
}

function start(){
  if (!on) return;
  /* SysEx is what lights the controller's screen, and asking for it is free where the answer
     is already a policy. Ordinary MIDI comes with it. */
  if (Patchwork.midi && !Patchwork.midi.sysex){
    try{ Patchwork.midi.upgrade(); note("sysex requested"); }catch(e){ note("sysex refused"); }
  }
  wake();
  claim();
  /* ⚠️ A LOOP, NOT A ONE-SHOT. The controller may be plugged in after boot, the audio device
     may take longer than the page, and a Pi cold-starts all three of these at once with no
     agreed order. Cheap enough to run forever: two property reads and, at most, a connect. */
  setInterval(() => {
    if (!Patchwork.audio || !Patchwork.audio.ctx || Patchwork.audio.ctx.state !== "running") wake();
    claim();
  }, 2000);
  /* And the moment a cable appears, rather than up to two seconds later. */
  if (Patchwork.midi && Patchwork.midi.onChange) Patchwork.midi.onChange(claim);
}

if (on && document.readyState !== "loading") setTimeout(start, 0);
else if (on) addEventListener("DOMContentLoaded", () => setTimeout(start, 0));

return {get on(){ return on; }, get log(){ return log.slice(); },
        wake, claim, start,
        /* Turning it off has to be possible from a browser console on the Pi over SSH, which
           is the only way in once there is no mouse. */
        off(){ try{ localStorage.removeItem(KEY); }catch(e){} }};
})();
