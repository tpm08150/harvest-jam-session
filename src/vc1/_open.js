/* VC·1 — the vocoder, as its own instrument, with a simple carrier of its own and a
   sequencer it never had inside MS·1. */
Patchwork.instrument("vc1", root => {
"use strict";

const $  = s => root.querySelector(s);
const $$ = s => root.querySelectorAll(s);
const onKey = (type, fn) => Patchwork.onKey(root, type, fn);

