
/* ---- the door ----
   Nothing is usable until somebody on the list has signed in. Deliberately the same shape
   and the same words as the Hub's own gate — arriving from the Arcade should not feel like
   arriving somewhere else. */
(() => {
"use strict";
const gate = document.querySelector("#jamGate");
const C = window.Patchwork && Patchwork.cloud;
if (!gate) return;

/* ⚠️ NO CLOUD, NO GATE. An unconfigured build — a checkout without keys, or a local copy
   someone is hacking on — must not be locked out of its own instruments by a door that has
   nothing behind it. */
if (!C || !C.configured) return;

const msg = document.getElementById("jgMsg");
const note = document.getElementById("jgNote");
const bIn = document.getElementById("jgIn");
const bOut = document.getElementById("jgOut");

function show(state, email){
  gate.hidden = false;
  document.body.classList.add("gated");
  if (state === "checking"){
    msg.textContent = "Checking…";
    bIn.hidden = true; bOut.hidden = true; note.textContent = "";
  } else if (state === "out"){
    msg.textContent = "Sign in with the Google account you use for work.";
    bIn.hidden = false; bOut.hidden = true;
    note.textContent = "";
  } else if (state === "denied"){
    msg.textContent = email + " doesn't have access yet. Ask Tyler to add you, then sign in again.";
    bIn.hidden = true; bOut.hidden = false;
    note.textContent = "";
  }
}
function open(warn){
  gate.hidden = true;
  document.body.classList.remove("gated");
  if (warn && Patchwork.libraryUI) { /* the library says its own piece about sync */ }
}

bIn.addEventListener("click", () => {
  msg.textContent = "Taking you to Google…";
  bIn.hidden = true;
  try{ C.signInWithGoogle(); }
  catch(e){ show("out"); note.textContent = e.message || "Could not start sign-in."; }
});
bOut.addEventListener("click", async () => {
  await C.signOut();
  show("out");
});

(async () => {
  if (!C.signedIn){ show("out"); return; }
  show("checking");
  const ok = await C.allowed();

  /* ⚠️ RE-CHECK THAT THERE IS STILL A SESSION. Asking the question can END one: an expired
     token makes the refresh fail, which clears the session and makes the request throw —
     and the throw looks exactly like "offline" to the branch below. A dead token opened the
     door on the way past. Signed out is signed out, whatever the check said. */
  if (!C.signedIn){ show("out"); return; }

  /* null means the check could not be MADE — offline, or Supabase unreachable — as opposed
     to the server saying no. Let them in rather than stranding somebody mid-session on
     venue wifi; the bucket still refuses anything they are not entitled to, so the worst
     case is a library that will not sync. */
  if (ok === false){ show("denied", C.email); return; }
  open(ok === null);
})();
})();
