/* CS·1 is built into whatever panel the page gives it, rather than into the document.
   Standalone that panel is the only thing on the page; in the studio build it is one of
   several. The code below cannot tell the difference, which is the point. */
Patchwork.instrument("cs1", root => {
"use strict";

/* Scoped to this instrument. Both apps used to query the document, which is why they
   share 28 element ids and never noticed. */
const $  = s => root.querySelector(s);
const $$ = s => root.querySelectorAll(s);
const onKey = (type, fn) => Patchwork.onKey(root, type, fn);

