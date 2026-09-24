
/* ---- the Song view, and the song page on the controller ----
   Draws Patchwork.song (shell/song.js): sixteen sequence numbers for the whole rack and the chain
   that plays them. On this build it stands where the launcher stood — the Song tab, and Shift + Sends
   on the Launchkey — because a groovebox with no screen chooses numbers, not cells.

   Written only on change, like every repeating paint in the rack (see HANDOFF, "Making the rack
   cheaper to run"): the view is on a 400 ms timer while it is up, for the one fact nothing announces
   — whether the sequence you are on has anything in it yet. */
(() => {
"use strict";
const G = window.Patchwork && Patchwork.song;
if (!G) return;
const q = sel => document.querySelector(sel);
const view = q("#stSong");
const N = G.COUNT;
const write = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
const flag = (el, cls, on) => { if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); };

/* Which chain entry the on-screen list and the controller's Chain bank are pointed at. */
let cursor = 0;
const clampCursor = () => { cursor = Math.max(0, Math.min(Math.max(0, G.chain.length - 1), cursor)); return cursor; };

/* ---- the view ---- */
if (view){
  const seqs = q("#sgSeqs"), list = q("#sgChain"), hint = q("#sgHint"), chainHint = q("#sgChainHint");
  for (let i = 0; i < N; i++){
    const b = document.createElement("button");
    b.className = "st-song-seq"; b.dataset.i = String(i); b.textContent = String(i + 1);
    b.title = "Sequence " + (i + 1) + " on every instrument, on the next seam. Shift-click adds it to the chain.";
    seqs.appendChild(b);
  }
  seqs.addEventListener("click", e => {
    const b = e.target.closest(".st-song-seq"); if (!b) return;
    if (e.shiftKey) G.add(+b.dataset.i, 4); else G.go(+b.dataset.i);
  });
  q("#sgPlay").addEventListener("click", () => { if (Patchwork.transport) Patchwork.transport.toggleAll(); });
  q("#sgUp").addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.shown + 1));
  q("#sgDown").addEventListener("click", () => Patchwork.clock.setBpm(Patchwork.clock.shown - 1));
  q("#sgChainPlay").addEventListener("click", () => { if (G.chaining) G.stopChain(); else G.playChain(clampCursor()); });
  q("#sgChainAdd").addEventListener("click", () => { cursor = G.add(G.at, 4); });
  q("#sgChainLoop").addEventListener("click", () => { G.loop = !G.loop; });
  q("#sgChainClear").addEventListener("click", () => G.clear());
  /* An entry's row: its number, a sequence select, a bars select, and remove. Rebuilt when the chain
     changes shape; only the marks move otherwise. */
  let shape = "";
  function rebuild(){
    list.textContent = "";
    G.chain.forEach((e, i) => {
      const li = document.createElement("li");
      li.className = "st-song-entry"; li.dataset.i = String(i);
      const seq = document.createElement("select"); seq.className = "st-song-entry-seq";
      for (let k = 0; k < N; k++) seq.appendChild(Object.assign(document.createElement("option"), {value: k, textContent: "Seq " + (k + 1)}));
      seq.value = String(e.seq);
      seq.addEventListener("change", () => G.set(i, {seq: +seq.value}));
      const bars = document.createElement("select"); bars.className = "st-song-entry-bars";
      [1, 2, 4, 8, 16, 32].forEach(n => bars.appendChild(Object.assign(document.createElement("option"), {value: n, textContent: n + (n === 1 ? " bar" : " bars")})));
      if (![1, 2, 4, 8, 16, 32].includes(e.bars)) bars.appendChild(Object.assign(document.createElement("option"), {value: e.bars, textContent: e.bars + " bars"}));
      bars.value = String(e.bars);
      bars.addEventListener("change", () => G.set(i, {bars: +bars.value}));
      const del = document.createElement("button"); del.className = "st-xport st-song-entry-del"; del.textContent = "×";
      del.title = "Remove from the chain";
      del.addEventListener("click", () => G.remove(i));
      const at = document.createElement("span"); at.className = "st-song-entry-at";
      li.append(seq, bars, at, del);
      li.addEventListener("click", ev => { if (ev.target === li) cursor = i; });
      list.appendChild(li);
    });
  }
  function paint(){
    if (view.hidden) return;
    const chain = G.chain, prog = G.progress(), landing = G.landing;
    const key = chain.map(e => e.seq + ":" + e.bars).join(",");
    if (key !== shape){ shape = key; rebuild(); }
    seqs.querySelectorAll(".st-song-seq").forEach(b => {
      const i = +b.dataset.i;
      flag(b, "st-sel", i === G.at && !landing);
      flag(b, "st-song-coming", !!landing && landing.seq === i);
      flag(b, "st-song-has", G.filled(i).length > 0);
    });
    const anyPlaying = !!(Patchwork.transport && Patchwork.transport.anyPlaying);
    write(q("#sgPlay"), anyPlaying ? "■ Stop all" : "▶ Play all");
    write(q("#sgBpm"), String(Patchwork.clock.shown));
    write(q("#sgChainPlay"), G.chaining ? "■ Stop chain" : "▶ Play chain");
    const loopBtn = q("#sgChainLoop");
    if (loopBtn.getAttribute("aria-pressed") !== String(G.loop)) loopBtn.setAttribute("aria-pressed", String(G.loop));
    list.querySelectorAll(".st-song-entry").forEach(li => {
      const i = +li.dataset.i;
      flag(li, "st-sel", i === clampCursor());
      flag(li, "st-song-playing", !!prog && prog.entry === i);
      write(li.querySelector(".st-song-entry-at"), prog && prog.entry === i ? "bar " + (prog.bar + 1) + " / " + prog.of : "");
    });
    write(hint, landing ? "Sequence " + (landing.seq + 1) + " on the next seam…"
                        : "On sequence " + (G.at + 1) + ". Pick another: every instrument changes to it on the next seam.");
    write(chainHint, chain.length ? (G.chaining ? "Playing the chain" + (G.loop ? ", round and round." : " once through.")
                                                : chain.length + (chain.length === 1 ? " entry" : " entries") + ". Play chain starts from the marked one.")
                                  : "Empty. Add puts the sequence you are on here; shift-click a number above does too.");
  }
  G.onChange(paint);
  setInterval(paint, 400);
  paint();
}

/* ---- on the controller ----
   Two banks on the pair beside the encoders:

     Sequences   pads are the sixteen; press one and the rack goes there on the seam. Knob 1 is the
                 sequence, knob 2 the tempo. `>` plays or stops the chain. Record adds the sequence
                 you are on to the chain. Func + a pad adds that one.
     Chain       pads are the entries; the marked one is white. Knob 1 is its sequence, knob 2 its
                 bars, knob 3 loop. ∧∨ beside the pads walk the mark. `>` plays from the mark.
                 Record adds the sequence the rack is on after the mark. Func + a pad removes it.

   Func tapped opens the punch page, as the launcher's page did, so the FX are one press from here. */
const S = window.Patchwork && Patchwork.surface;
if (S && S.mount){
  const cellOf = k => (k < 8 ? k + 8 : k - 8);
  const slotOf = c => (c < 8 ? c + 8 : c - 8);
  const banks = [{name: "Sequences"}, {name: "Chain"}];
  let bank = 0;
  const bankNow = () => Math.min(bank, banks.length - 1);
  let said = "", saidUntil = 0;
  const tell = w => { said = w; saidUntil = performance.now() + 2000; return w; };
  const stepped = (id, label, short, n, at, go, text) => ({
    id, label, short, stepped: true,
    text: () => text(at()),
    get: () => (n() > 1 ? at() / (n() - 1) : 0),
    set: v => go(Math.round(v * (n() - 1))),
    nudge: d => go(Math.max(0, Math.min(n() - 1, at() + (d > 0 ? 1 : -1))))
  });
  const tempo = {
    id: "bpm", label: "Tempo", short: "BPM",
    text: () => String(Patchwork.clock.shown) + " bpm",
    get: () => (Patchwork.clock.shown - 40) / 200,
    set: v => Patchwork.clock.setBpm(Math.round(40 + v * 200))
  };
  const seqControls = () => [
    stepped("song-seq", "Sequence", "Seq", () => N, () => G.at, i => G.go(i), i => String(i + 1)),
    tempo
  ];
  const BARS = [1, 2, 4, 8, 16, 32];
  const entry = () => G.chain[clampCursor()] || null;
  const chainControls = () => [
    stepped("chain-seq", "Entry sequence", "Seq", () => N, () => (entry() ? entry().seq : 0),
            i => G.set(clampCursor(), {seq: i}), i => (entry() ? String(i + 1) : "empty")),
    stepped("chain-bars", "Entry bars", "Bar", () => BARS.length,
            () => { const e = entry(); const k = e ? BARS.indexOf(e.bars) : -1; return k < 0 ? 2 : k; },
            k => G.set(clampCursor(), {bars: BARS[k]}), k => (entry() ? BARS[k] + " bars" : "empty")),
    stepped("chain-loop", "Loop", "Lop", () => 2, () => (G.loop ? 1 : 0), i => { G.loop = i > 0; }, i => (i ? "On" : "Once")),
    null, null, null, null, tempo
  ];
  const grid = {
    announce: true,
    label: () => {
      if (performance.now() < saidUntil) return said;
      const p = G.progress();
      if (bankNow() === 1){
        const e = entry();
        if (!e) return "Chain  empty";
        return "Chain " + (clampCursor() + 1) + ": seq " + (e.seq + 1) + " x" + e.bars;
      }
      if (G.landing) return "Seq " + (G.landing.seq + 1) + " coming";
      return p ? "Seq " + (p.seq + 1) + "  bar " + (p.bar + 1) + "/" + p.of : "Sequence " + (G.at + 1);
    },
    cells: () => {
      const out = new Array(16).fill(null);
      if (bankNow() === 1){
        const chain = G.chain, prog = G.progress();
        chain.slice(0, 16).forEach((e, i) => {
          const playing = !!prog && prog.entry === i;
          out[cellOf(i)] = i === clampCursor() ? {colour: "white", on: true, hot: playing}
                                                : {colour: playing ? "green" : "amber", on: playing};
        });
        return out;
      }
      for (let i = 0; i < N; i++){
        const here = i === G.at && !G.landing, coming = !!G.landing && G.landing.seq === i;
        out[cellOf(i)] = coming ? {colour: "green", on: true, hot: true}
                       : here   ? {colour: "green", on: true}
                       : {colour: G.filled(i).length ? "amber" : "cyan", on: false};
      }
      return out;
    },
    down: (cell, vel, mods) => {
      const k = slotOf(cell);
      if (bankNow() === 1){
        if (k >= G.chain.length) return;
        if (mods && mods.accent){ G.remove(k); tell("Removed " + (k + 1)); return; }
        cursor = k;
        return;
      }
      if (mods && mods.accent){ G.add(k, 4); tell("Chain + seq " + (k + 1)); return; }
      G.go(k);
    },
    /* the pair beside the pads walks the chain's mark; on Sequences there is nothing to walk */
    move: dir => {
      if (bankNow() !== 1 || !G.chain.length) return null;
      cursor = Math.max(0, Math.min(G.chain.length - 1, clampCursor() + (dir > 0 ? 1 : -1)));
      return "Entry " + (cursor + 1);
    }
  };
  const spec = {
    name: "Song",
    show: () => { if (S.rig && S.rig.goto) S.rig.goto("song"); },
    grid,
    face: () => (Patchwork.punchUI ? Patchwork.punchUI.open() : null),
    faceName: "Pads",
    controls: () => (bankNow() === 1 ? chainControls() : seqControls()),
    controlBanks: () => banks,
    controlBank: bankNow,
    setControlBank: i => { bank = Math.max(0, Math.min(banks.length - 1, i)); },
    actionName: "Chain",
    action: () => {
      if (G.chaining){ G.stopChain(); return "stopped"; }
      if (!G.chain.length) return "empty";
      return G.playChain(bankNow() === 1 ? clampCursor() : 0) ? "playing" : null;
    },
    record: () => {
      const i = bankNow() === 1 ? G.add(G.at, 4, clampCursor() + 1) : G.add(G.at, 4);
      if (i >= 0){ if (bankNow() === 1) cursor = i; tell("Chain + seq " + (G.at + 1)); }
      return true;
    },
    armed: false
  };
  S.mount("song", spec);
  S.panel("song", spec);
}
})();
