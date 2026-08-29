/* DR·1 is built into whatever panel the page gives it, exactly as CS·1 and MS·1 are.
   Standalone that panel is the only thing on the page; in the studio build it is one of
   three. The code below cannot tell the difference, which is the point. */
Patchwork.instrument("dr1", root => {
"use strict";

/* Scoped to this instrument — every panel carries an element called #play. */
const $  = s => root.querySelector(s);
const $$ = s => root.querySelectorAll(s);
const onKey = (type, fn) => Patchwork.onKey(root, type, fn);

