/* ============ audio i/o ============ */
/* USB audio interfaces (EP-133 et al) are class-compliant devices, so CoreAudio already
   exposes them — this just points the graph at one for output and taps one for input. */
const audioOutSel = $("#audioOut"),
      audioNoteEl = $("#audioNote"), audioLed = $("#audioLed");


/* reset synchronously — a hidden tab fires no frames, so cleanup can't wait for one */


/* the numbers that decide whether the browser path is good enough for live playing */
function ioStats(){
  const el = $("#ioStats");
  if (!ctx){ el.innerHTML = ""; return; }
  /* first thing to read when there's no sound — on iOS this sits at "suspended" until a
     gesture, and drops to "interrupted" after a call or an app switch */
  const bits = ["audio <b" + (ctx.state === "running" ? ">" : " style=\"color:#e8b23a\">") + ctx.state + "</b>",
                "rate <b>" + (ctx.sampleRate / 1000).toFixed(1) + " kHz</b>"];
  if (ctx.baseLatency != null)   bits.push("buffer <b>" + (ctx.baseLatency * 1000).toFixed(1) + " ms</b>");
  if (ctx.outputLatency != null) bits.push("output <b>" + (ctx.outputLatency * 1000).toFixed(1) + " ms</b>");
  el.innerHTML = bits.map(b => "<span>" + b + "</span>").join("");
}

function ioSay(msg, bad){
  audioNoteEl.innerHTML = msg;
  audioNoteEl.classList.toggle("bad", !!bad);
  audioLed.classList.toggle("err", !!bad);
}

function fillDev(sel, devs, noneLabel, keep, fallback){
  sel.innerHTML = "";
  const n = document.createElement("option");
  n.value = ""; n.textContent = noneLabel;
  sel.appendChild(n);
  devs.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || (fallback + " " + (i + 1));
    sel.appendChild(o);
  });
  sel.value = devs.some(d => d.deviceId === keep) ? keep : "";
}

async function scanDevices(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices){
    /* Not a failure on iOS — WebKit exposes no device picker because routing is a system
       concern there. Output already follows the system device, so saying "can't
       enumerate" reads as broken when it's working exactly as the platform intends. */
    ioSay(IS_IOS
      ? "iOS routes audio at the system level, so there's no in-page picker. Output follows "
        + "the system output — choose the EP-133 in Control Centre and this follows it."
      : "This browser can't enumerate audio devices.", !IS_IOS);
    return;
  }
  /* device labels stay blank until mic permission is granted once */
  try{
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    s.getTracks().forEach(t => t.stop());
  }catch(e){}
  const devs = await navigator.mediaDevices.enumerateDevices();
  const outs = devs.filter(d => d.kind === "audiooutput");
  const ins  = devs.filter(d => d.kind === "audioinput");
  fillDev(audioOutSel, outs, "System default", audioOutSel.value, "Output");
  const sinkOk = !ctx || typeof ctx.setSinkId === "function";
  ioSay(outs.length + " output" + (outs.length === 1 ? "" : "s") + " · "
      + ins.length + " input" + (ins.length === 1 ? "" : "s")
      + (sinkOk ? ". Pick your interface for either direction."
                : ". Output routing needs Chrome 110+; input still works."), !sinkOk);
  audioLed.classList.add("ready");
  ioStats();
}

async function setSink(id){
  initAudio();
  if (typeof ctx.setSinkId !== "function"){
    ioSay("Output routing needs <code>AudioContext.setSinkId</code> — Chrome 110+.", true);
    return;
  }
  try{
    await ctx.setSinkId(id || "");
    ioStats();   // outputLatency changes with the device
    ioSay("Output → " + audioOutSel.selectedOptions[0].textContent);
  }catch(e){
    ioSay("Couldn't switch output: " + ((e && e.name) || e), true);
  }
}


/* rAF is paused while the tab is hidden; pick the meter back up when it returns */
/* Also called from the iOS host when the app returns to the foreground, since a WKWebView
   doesn't reliably get a visibilitychange for that. */
window.__patchworkResume = function(){
  if (!ctx) return;
  if (ctx.state !== "running"){
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  }
  ioStats();
};

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  /* was gated on state.playing, which meant returning to a stopped app left the context
     interrupted and the pads silent until something else happened to resume it */
  window.__patchworkResume();
});

/* Safety net: any tap re-resumes an existing context. Deliberately does not create one —
   audio should still only start when the player actually asks for a sound. */
["pointerdown","touchend"].forEach(ev => document.addEventListener(ev, () => {
  if (ctx && ctx.state !== "running"){
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  }
}, {passive:true}));



$("#scan").addEventListener("click", scanDevices);
audioOutSel.addEventListener("change", () => setSink(audioOutSel.value));
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener){
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (audioLed.classList.contains("ready")) scanDevices();
  });
}

