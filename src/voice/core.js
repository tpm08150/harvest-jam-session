
/* The synth core every instrument shares.

   Pure functions and constants — no state, no graph. MS·1 grew all of this inside one
   IIFE when it was the only synthesiser in the repo; splitting it into PM·1, VC·1 and
   BS·1 meant three copies of a ladder filter whose comments are load-bearing, so it moved
   here instead. Every number below was measured, and the measurements are recorded where
   they were taken. */
Patchwork.voice = (() => {
"use strict";

const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

/* ---- the ladder ----
   Two BiquadFilterNodes placed on the pole pairs of the analog 1/((1+s)^4+k) prototype,
   rather than two lowpasses stacked by eye. Reproduces the prototype exactly, resonance
   is even across the knob's travel, and the low end thins as resonance rises the way a
   real ladder does. The closed-form inverse means no bisection at note-on. */
function ladder(res){
  const Q1dB = -6.0206 + 46 * res;
  const Q1   = Math.pow(10, Q1dB / 20);
  const u    = Q1 <= 0.5 ? 1 : (Math.sqrt(4*Q1*Q1 - 1) - 1) / (4*Q1*Q1 - 2);
  const a    = 1 - u;
  const k    = 4 * a*a*a*a;
  const rho1 = Math.hypot(a - 1, a), rho2 = Math.hypot(1 + a, a);
  const Q2dB = 20 * Math.log10(rho2 / (2 * (1 + a)));
  return {Q1dB, Q2dB, rho1, rho2, k};
}
/* Web Audio's biquad normalises DC gain to unity; a real ladder does not. So the cascade
   hands you the bass-COMPENSATED filter for free and you have to attenuate to get the
   authentic thinning. 0 = true ladder (-13.8 dB of low end at full resonance), 1 = flat
   DC (and +38.9 dB of peak, which clips). 0.30 measured back to within 0.5 dB of the
   filter-open level at full resonance. */
const RCOMP = 0.30;

/* ---- envelopes ----
   Attack is linear so it TERMINATES at t+A — an RC attack never arrives and leaves the
   voice mid-ramp. Decay and release are setTargetAtTime, a capacitor discharging;
   tau = time/6.9 is 99.9% complete at `time`, so the terminator step is under -60 dB.
   Never exponentialRampToValueAtTime(0, ...) — that is illegal and throws. */
function envValueAt(e, t){
  if (!e || t <= e.t0) return 0;
  if (e.tOff == null || t < e.tOff){
    const u = t - e.t0;
    return u < e.A ? (e.A <= 0 ? 1 : u / e.A)
                   : e.S + (1 - e.S) * Math.exp(-(u - e.A) / (e.D / 6.9));
  }
  return e.vOff * Math.exp(-(t - e.tOff) / (e.R / 6.9));
}
function schedEnv(param, e, t, v0){
  param.cancelScheduledValues(t);
  param.setValueAtTime(v0, t);
  param.linearRampToValueAtTime(1, t + e.A);
  param.setTargetAtTime(e.S, t + e.A, e.D / 6.9);
  param.setValueAtTime(e.S, t + e.A + e.D);
}
/* Capture where the envelope actually is, THEN mark it released. */
function beginRelease(e, t){
  e.vOff = envValueAt(e, t);
  e.tOff = t;
  return e.vOff;
}
function schedRelease(param, e, t){
  param.cancelScheduledValues(t);
  param.setValueAtTime(e.vOff, t);
  param.setTargetAtTime(0, t, e.R / 6.9);
  param.setValueAtTime(0, t + 2 * e.R);
}
/* Amp release floor. Below this a note-off is an abrupt amplitude step, which splatters
   broadband energy even though no individual sample jumps far — the click is the
   ENVELOPE's abruptness, not a discontinuity, which is why a max-sample-step metric shows
   nothing. Measured on a 110 Hz sine with the filter open: energy falls about 6 dB per
   doubling of release, and 0.5 ms -> 10 ms is a 23.7 dB reduction. Attack has no floor —
   a fast attack from silence is a legitimate transient. */
const AMP_REL_MIN = .01;

/* White noise, two seconds of it. Long enough that a loop is never audible, and every
   voice starts at its own offset anyway. */
function noiseBuffer(ctx, seconds){
  const len = Math.floor(ctx.sampleRate * (seconds || 2));
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

return {clampf, mtof, ladder, RCOMP, envValueAt, schedEnv, schedRelease,
        beginRelease, AMP_REL_MIN, noiseBuffer};
})();
