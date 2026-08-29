/* BS·1 — the bass, as its own instrument. Was a section inside MS·1; see the handoff for
   why the three sections were split. */
Patchwork.instrument("bs1", root => {
"use strict";

const $  = s => root.querySelector(s);
const $$ = s => root.querySelectorAll(s);
const onKey = (type, fn) => Patchwork.onKey(root, type, fn);

