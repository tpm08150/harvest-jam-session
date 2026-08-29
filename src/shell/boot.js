
/* Runs last, once every instrument on the page has registered.

   Anything that has to see the whole set of instruments belongs here rather than in one
   of them — an instrument cannot know how many others share its page, and should not
   have to. */
(() => {
"use strict";
Patchwork.faces.mount();

/* The default derives from the page rather than from a per-build flag: a lone instrument
   is its whole self, and a page with several opens on faces, because three full panels is
   the wall the faces exist to avoid. A build added later gets the right default without
   anyone remembering to set it. */
if (Patchwork.roots.length > 1) Patchwork.faces.setAll(true);

/* One tempo for the page means ONE control for it. Every panel grew its own, and since
   the clock has been shared they all show the same number and all move together — five of
   the six were noise, and a row of disagreeing-looking readouts is worse than noise. Each
   panel marks its block with `data-tempo`; with more than one instrument on the page the
   studio's master takes over and the panels' come out.

   Derived from the page, exactly like the faces default above: a STANDALONE build keeps
   its own tempo control, because there is nothing else on that page to own it. */
if (Patchwork.roots.length > 1)
  Patchwork.roots.forEach(r => r.classList.add("tempo-shared"));
})();
