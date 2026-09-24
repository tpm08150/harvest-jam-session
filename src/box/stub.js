
/* ---- what this build leaves out, answered so nothing has to ask ----
   The groovebox has no jam (shell/session.js) and no talkback (shell/talk.js): a Raspberry Pi with
   no network, and no screen to pick a room on. Seven instruments register their sound with the
   session as they boot and the looper offers a take to it, none of them guarded, and guarding every
   call is a change to every instrument for a build most of them will never see. So the two
   registries exist here as the empty answer — a session nobody is in, a talkback that is off —
   which is what each caller already does nothing with. ⚠️ Before the instruments, where session.js
   sits in the studio's manifest, and never on a page that carries the real one. */
Patchwork.session = {
  active: false, peers: [], problem: "not on this build", room: "",
  registerPatch(){}, registerVoice(){}, mountOwners(){}, onChange(){},
  played(){}, fired(){}, join(){ return false; }, leave(){}, browse(cb){ if (cb) cb([]); },
  pushTake: () => Promise.resolve({ok: false, why: "no jam on this build"})
};
Patchwork.talk = {STRIP: "talk", on: false, onChange(){}, heard(){}, forget(){}, stop(){}};
