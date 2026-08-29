/* LP·1 is built into whatever panel the page gives it, exactly as the others are. */
Patchwork.instrument("lp1", root => {
"use strict";

const $  = s => root.querySelector(s);
const $$ = s => root.querySelectorAll(s);
const onKey = (type, fn) => Patchwork.onKey(root, type, fn);

