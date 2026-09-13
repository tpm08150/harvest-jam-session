/* Saved sounds, for any instrument that wants them.

   CS·1 and PM·1 each grew their own patch browser, and the two are the same list, the same
   name box, the same four buttons and the same localStorage dance written twice. DR·1, BS·1
   and VC·1 need one too, and a third and fourth copy is the point at which duplication
   stops being a shortcut — so this is the implementation those three share.

   ⚠️ IT DOES NOT DEFINE WHAT A SOUND IS. Every instrument already answers that for a jam,
   through session.registerPatch(), and the answer must not be given twice: a patch that
   saved a slightly different set of parameters from the one a jam shares would be a bug
   nobody could see until two people compared what they were hearing. So an instrument hands
   the SAME object to both, and the two cannot drift.

     const SOUND = {capture: () => ..., apply: p => ...};
     Patchwork.session.registerPatch("bs1", SOUND);
     Patchwork.patches.mount(root, "bs1", SOUND);

   CS·1 keeps its own. Its patches carry a progression, a MIDI program number and a trigger
   note, and folding all of that in here to save a list box would make this the thing it is
   replacing. */
Patchwork.patches = (() => {
"use strict";

function mount(root, id, spec){
  if (!root || !spec || !spec.capture || !spec.apply) return null;
  const $ = s => root.querySelector(s);
  const sel = $("#patchSel"), nameEl = $("#patchName"), note = $("#patchNote"),
        file = $("#patchFile");
  if (!sel || !nameEl) return null;                 // this panel has no patch row

  const KEY = "patchwork-" + id + "-patches";
  const APP = "patchwork-" + id;

  function say(msg, bad){
    if (!note) return;
    note.style.display = msg ? "" : "none";
    note.innerHTML = msg || "";
    note.classList.toggle("bad", !!bad);
  }
  function load(){
    try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){ return {}; }
  }
  function store(o){
    try{ localStorage.setItem(KEY, JSON.stringify(o)); return true; }
    catch(e){ say("Couldn't save — browser storage is full or blocked.", true); return false; }
  }
  function refresh(selected){
    const s = load(), names = Object.keys(s).sort((a, b) => a.localeCompare(b));
    sel.textContent = "";
    sel.appendChild(Object.assign(document.createElement("option"),
      {value: "", textContent: names.length ? "— select —" : "— none saved —"}));
    names.forEach(n => sel.appendChild(Object.assign(document.createElement("option"),
      {value: n, textContent: n})));
    sel.value = selected && s[selected] ? selected : "";
    return names;
  }

  /* ---- the sequences, saved with the sound ----
     ⚠️ BESIDE THE SOUND, NOT INSIDE IT. `sound` is the object a jam polls and sends and a project
     saves as "sounds" (see the note at the top), and sixteen patterns riding along inside it
     would go to everybody in a jam on every knob move. A patch carries both; the registry that
     defines a sound still defines only a sound. An older patch has no `seqs`, and recalling it
     leaves the sequences alone. See shell/sequences.js. */
  const Q = () => (Patchwork.sequences && Patchwork.sequences.has(id) ? Patchwork.sequences : null);
  function withSeqs(o){
    const q = Q();
    if (q) o.seqs = q.capture(id);
    return o;
  }
  function recall(p){
    const q = Q();
    if (!q || !p || !p.seqs || !q.load(id, p.seqs)) return "";
    const n = q.count(p.seqs);
    return " with " + (n || "no") + (n === 1 ? " sequence" : " sequences");
  }

  sel.addEventListener("change", () => {
    const name = sel.value;
    if (!name) return;
    const p = load()[name];
    if (!p){ say("That patch is gone.", true); refresh(); return; }
    try{ spec.apply(p.sound); }catch(e){ say("Couldn't load that patch.", true); return; }
    nameEl.value = name;
    say("Loaded <b>" + name + "</b>" + recall(p) + ".");
  });

  /* Save takes the NAME BOX, not the selection: typing a new name over a loaded patch and
     pressing Save is how you make a variant, and it is what everybody tries first. */
  const saveBtn = $("#patchSave");
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const name = (nameEl.value || "").trim() || (sel.value || "").trim();
    if (!name){ say("Give it a name first.", true); nameEl.focus(); return; }
    const s = load();
    const existed = !!s[name];
    s[name] = withSeqs({app: APP, v: 1, name, sound: spec.capture()});
    if (!store(s)) return;
    refresh(name);
    nameEl.value = name;
    say((existed ? "Replaced <b>" : "Saved <b>") + name + "</b>.");
  });

  const delBtn = $("#patchDelete");
  if (delBtn) delBtn.addEventListener("click", () => {
    const name = sel.value;
    if (!name){ say("Pick a saved patch to delete.", true); return; }
    const s = load();
    delete s[name];
    if (!store(s)) return;
    refresh();
    say("Deleted <b>" + name + "</b>.");
  });

  const expBtn = $("#patchExport");
  if (expBtn) expBtn.addEventListener("click", () => {
    const name = (nameEl.value || sel.value || id + "-patch").trim();
    const data = withSeqs({app: APP, v: 1, name, sound: spec.capture()});
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.replace(/[^\w\-. ]+/g, "_") + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    /* revoked late: revoking immediately races the download in some browsers */
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say("Exported <b>" + a.download + "</b>.");
  });

  const impBtn = $("#patchImport");
  if (impBtn && file){
    impBtn.addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      file.value = "";                    // so re-picking the same file fires again
      if (!f) return;
      const rd = new FileReader();
      rd.onerror = () => say("Couldn't read that file.", true);
      rd.onload = () => {
        let data;
        try{ data = JSON.parse(rd.result); }
        catch(e){ say("That file isn't valid JSON.", true); return; }
        /* ⚠️ Checked, because a PM·1 patch loaded into BS·1 would apply a handful of keys
           that happened to match and silently leave the rest — a sound that is neither
           patch and no message saying so. */
        if (!data || data.app !== APP){
          say("That is a patch for <b>" + ((data && data.app) || "something else")
            + "</b>, not " + APP + ".", true);
          return;
        }
        try{ spec.apply(data.sound); }
        catch(err){ say("Couldn't apply that patch.", true); return; }
        if (data.name) nameEl.value = data.name;
        say("Imported <b>" + (data.name || f.name) + "</b>" + recall(data)
          + ". Press Save to keep it in this browser.");
      };
      rd.readAsText(f);
    });
  }

  refresh();
  return {refresh};
}

return {mount};
})();
