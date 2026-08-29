
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
})();
