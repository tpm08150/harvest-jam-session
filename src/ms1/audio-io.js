/* ============ audio i/o ============ */
const audioOutSel = $("#audioOut"), audioNoteEl = $("#audioNote"), audioLed = $("#audioLed");

/* the numbers that decide whether the browser path is good enough for live playing,
   plus a peak reading so a hot patch is visible rather than guessed at */
function ioStats(peak){
  const el = $("#ioStats");
  if (!ctx){ el.innerHTML = ""; return; }
  const bits = ["audio <b" + (ctx.state === "running" ? ">" : " style=\"color:#e8b23a\">") + ctx.state + "</b>",
                "rate <b>" + (ctx.sampleRate/1000).toFixed(1) + " kHz</b>"];
  if (ctx.baseLatency != null)   bits.push("buffer <b>" + (ctx.baseLatency*1000).toFixed(1) + " ms</b>");
  if (ctx.outputLatency != null) bits.push("output <b>" + (ctx.outputLatency*1000).toFixed(1) + " ms</b>");
  if (peak != null && peak > 0){
    const dbv = 20*Math.log10(peak);
    bits.push("peak <b class=\"" + (dbv > -0.5 ? "hot" : "") + "\">" + dbv.toFixed(1) + " dBFS</b>");
  }
  el.innerHTML = bits.map(b => "<span>"+b+"</span>").join("");
}
function ioSay(msg, bad){
  audioNoteEl.innerHTML = msg;
  audioNoteEl.classList.toggle("bad", !!bad);
  audioLed.classList.toggle("err", !!bad);
}
function fillDev(sel, devs, noneLabel, keep, fallback){
  sel.innerHTML = "";
  sel.appendChild(Object.assign(document.createElement("option"), {value:"", textContent:noneLabel}));
  devs.forEach((d, i) => sel.appendChild(Object.assign(document.createElement("option"),
    {value:d.deviceId, textContent:d.label || (fallback + " " + (i+1))})));
  sel.value = devs.some(d => d.deviceId === keep) ? keep : "";
}
async function scanDevices(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices){
    /* Not a failure on iOS — WebKit exposes no picker because routing is a system concern
       there, and output already follows the system device. */
    ioSay(IS_IOS
      ? "iOS routes audio at the system level, so there's no in-page picker. Output follows "
      + "the system output — choose your interface in Control Centre and this follows it."
      : "This browser can't enumerate audio devices.", !IS_IOS);
    return;
  }
  try{
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    s.getTracks().forEach(t => t.stop());      // labels stay blank until permission is granted once
  }catch(e){}
  const devs = await navigator.mediaDevices.enumerateDevices();
  const outs = devs.filter(d => d.kind === "audiooutput");
  fillDev(audioOutSel, outs, "System default", audioOutSel.value, "Output");
  /* Scan grants microphone permission, which is what makes device LABELS readable — so it
     is also the moment the vocoder's input list stops saying "Input 1, Input 2" and starts
     naming the actual hardware. Refresh it here or the user has to pick their interface
     blind from the vocoder rack. */
  if (typeof listInputs === "function") listInputs();
  const sinkOk = !ctx || typeof ctx.setSinkId === "function";
  ioSay(outs.length + " output" + (outs.length === 1 ? "" : "s")
      + (sinkOk ? ". Pick your interface to send MS·1 to it."
                : ". Output routing needs Chrome 110+."), !sinkOk);
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
    ioStats();
    ioSay("Output → " + audioOutSel.selectedOptions[0].textContent);
  }catch(e){ ioSay("Couldn't switch output: " + ((e && e.name) || e), true); }
}
$("#scan").addEventListener("click", scanDevices);
audioOutSel.addEventListener("change", () => setSink(audioOutSel.value));
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener){
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (audioLed.classList.contains("ready")) scanDevices();
  });
}

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
  if (!document.hidden) window.__patchworkResume();
});
/* Safety net: any tap re-resumes an existing context. Deliberately does NOT create one —
   audio should still only start when the player actually asks for a sound. */
["pointerdown","touchend"].forEach(ev => document.addEventListener(ev, () => {
  if (ctx && ctx.state !== "running"){
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => {});
  }
}, {passive:true}));

window.addEventListener("pagehide", () => { allNotesOff(); midiPanic(); });

