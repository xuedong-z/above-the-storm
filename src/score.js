// The score: D minor, computed sample by sample and cut to the camera.
// Plain arithmetic into two Float32Arrays - a few hundred voices cost a fraction of a second,
// where the same thing as Web Audio nodes took many seconds to render.
import { DUR, FLASHES, BOLTS, POWER, T_PARENT, T_SPRITE, T_JET, T_ENTER, T_EXIT, T_END, camera } from './timeline.js';
import { rng } from './rng.js';

export function renderScore(SR, r = rng(4242)) {
  const N = Math.ceil(SR * DUR), L = new Float32Array(N), R = new Float32Array(N);
  const hz = m => 440 * 2 ** ((m - 69) / 12), TAU = Math.PI * 2;
  const mix = (t0, dur, pan, fn) => {
    const i0 = Math.max(0, Math.round(t0 * SR)), i1 = Math.min(N, Math.round((t0 + dur) * SR));
    const gl = Math.cos((pan + 1) * Math.PI / 4) * 1.414, gr = Math.sin((pan + 1) * Math.PI / 4) * 1.414;
    for (let i = i0; i < i1; i++) { const s = fn((i - i0) / SR); L[i] += s * gl; R[i] += s * gr; }
  };
  const lp2 = () => { let a = 0, b = 0; return (x, fc) => { const k = Math.min(1, TAU * fc / SR); a += k * (x - a); b += k * (a - b); return b; }; };
  const decay = (t, att, dec) => (t < att ? t / att : Math.exp(-9.2 * (t - att) / dec));

  // sustained strings / brass: detuned saws through a low-pass that opens with the swell
  const pad = (notes, t0, t1, gain, cut = 900, att = 1.2, rel = 1.4) => notes.forEach((m, i) => [-7, 6].forEach(det => {
    const f = hz(m) * 2 ** ((det + (r() - 0.5) * 4) / 1200) / SR, flt = lp2(), hold = t1 - t0;
    let ph = r();
    mix(t0, hold + rel, (i / Math.max(1, notes.length - 1) - 0.5) * 0.9 * Math.sign(det), t => {
      ph += f; if (ph >= 1) ph -= 1;
      const e = t < att ? t / att : t < hold ? 1 : Math.max(0, 1 - (t - hold) / rel);
      return flt(2 * ph - 1, cut * (0.4 + 0.6 * e)) * gain * e;
    });
  }));
  const pluck = (m, t0, gain, cut = 2200, dec = 0.16, pan = 0) => {
    const f = hz(m) / SR, flt = lp2(); let ph = 0, ph2 = 0;
    mix(t0, dec + 0.05, pan, t => {
      ph += f; if (ph >= 1) ph -= 1; ph2 += f * 0.5; if (ph2 >= 1) ph2 -= 1;
      return flt(2 * ph - 1 + (ph2 < 0.5 ? 1 : -1), cut * (180 / cut) ** Math.min(1, t / dec)) * gain * 1.6 * decay(t, 0.004, dec);
    });
  };
  const bell = (m, t0, gain, dec = 2.2, pan = 0) => [1, 2.01, 3.02].forEach((k, i) => {
    const w = TAU * hz(m) * k, d = dec / (1 + i), g = gain / (1 + i * 2.5);
    mix(t0, d + 0.05, pan, t => Math.sin(w * t) * g * decay(t, 0.006, d));
  });
  const hit = (t0, gain, big = false) => {
    const f0 = big ? 95 : 120, f1 = big ? 30 : 46, ts = big ? 0.5 : 0.14, dec = big ? 1.8 : 0.28, nd = big ? 0.7 : 0.12, fc = big ? 900 : 500;
    const flt = lp2(); let ph = 0;
    mix(t0, dec + 0.05, 0, t => {
      ph += f0 * (f1 / f0) ** Math.min(1, t / ts) / SR;
      const n = t < nd + 0.05 ? flt(r() * 2 - 1, fc) * 0.5 * decay(t, 0.003, nd) : 0;
      return (Math.sin(TAU * ph) * decay(t, 0.003, dec) + n) * gain;
    });
  };
  const riser = (t0, t1, gain) => {
    const d = t1 - t0, flt = lp2(); let low = 0, band = 0, ph = 0;
    mix(t0, d, 0, t => {
      const u = t / d, k = 2 * Math.sin(Math.PI * 250 * (5200 / 250) ** u / SR);
      low += k * band; const high = (r() * 2 - 1) - low - 0.83 * band; band += k * high;
      ph += hz(50) * (hz(74) / hz(50)) ** u / SR; if (ph >= 1) ph -= 1;
      return (band + flt(2 * ph - 1, 1200) * 0.5) * gain * u;
    });
  };
  const sub = (m, t0, t1, gain) => { const w = TAU * hz(m), hold = t1 - t0;
    mix(t0, hold + 0.4, 0, t => Math.sin(w * t) * gain * (t < 0.3 ? t / 0.3 : t < hold ? 1 : Math.max(0, 1 - (t - hold) / 0.4))); };

  // I  above the anvil: a held D minor, a few bell notes in the dark
  pad([38, 45, 50, 53, 57], 0.2, T_PARENT - 0.6, 0.050, 700, 2.0, 1.0);
  pad([69, 74], 1.5, T_PARENT - 0.4, 0.012, 2400, 2.5, 0.8);
  [[1.2, 69], [2.2, 65], [3.2, 74], [4.2, 72], [5.0, 69], [5.6, 77]].forEach(([t, m], i) => bell(m, t, 0.05, 2.4, i % 2 ? 0.4 : -0.4));
  // II  the sprites: the chord opens to B flat major, then G minor and a held dominant
  hit(T_PARENT, 0.5, true);
  pad([34, 46, 53, 58, 62, 65], T_PARENT, T_JET - 0.3, 0.075, 1500, 0.5, 1.2);
  pad([70, 77, 82], T_SPRITE, T_JET - 0.3, 0.016, 3200, 0.8, 1.2);
  [0, 0.25, 0.5, 0.9, 1.4].forEach((d, i) => bell([82, 77, 86, 74, 89][i], T_SPRITE + d, 0.04, 2.6, (i - 2) * 0.3));
  pad([31, 43, 50, 55, 58], T_JET - 0.2, 10.6, 0.065, 1300, 0.8, 0.8);
  pad([33, 45, 52, 57, 61], 10.6, T_ENTER - 0.05, 0.08, 2000, 1.2, 0.05);
  riser(10.2, T_ENTER, 0.16);
  for (let k = 0; k < 9; k++) hit(T_ENTER - 1.8 * (1 - k / 9) ** 1.6, 0.10 + 0.035 * k);
  // III  the dive: 16th-note ostinato over a pounding pulse
  hit(T_ENTER, 0.75, true);
  {
    const beat = (T_EXIT - T_ENTER) / 16, st = beat / 4;
    const P1 = [50, 50, 62, 50, 57, 50, 60, 50, 50, 50, 62, 50, 65, 50, 64, 60], P2 = [46, 46, 58, 46, 53, 46, 58, 46, 46, 46, 58, 46, 62, 46, 60, 57];
    for (let i = 0; i < 64; i++) {
      const m = (i < 32 ? P1 : P2)[i % 16], t = T_ENTER + i * st;
      pluck(m, t, i % 4 === 0 ? 0.11 : 0.07, 1500 + 2200 * (i / 64), 0.15, i % 2 ? 0.35 : -0.35);
      if (i >= 32 && i % 2 === 0) pluck(m + 12, t, 0.035, 4000, 0.12, i % 4 ? -0.6 : 0.6);
    }
    for (let b = 0; b < 16; b++) { if (b) hit(T_ENTER + b * beat, b % 4 === 0 ? 0.42 : 0.26); if (b % 2) hit(T_ENTER + (b + 0.5) * beat, 0.14); }
    sub(26, T_ENTER, T_ENTER + 8 * beat - 0.2, 0.20); sub(22, T_ENTER + 8 * beat, T_EXIT - 0.3, 0.20);
    pad([38, 50, 57, 62, 65], T_ENTER, T_ENTER + 8 * beat, 0.05, 1800, 0.3, 0.4);
    pad([34, 46, 58, 62, 65, 70], T_ENTER + 8 * beat, T_EXIT - 0.1, 0.06, 2400, 0.3, 0.1);
    riser(T_EXIT - 1.5, T_EXIT, 0.10);
  }
  // IV  under the base: everything falls away, one high note over the plains
  hit(T_EXIT, 0.8, true);
  pad([81], T_EXIT + 0.1, 22.0, 0.014, 3000, 1.5, 1.5);
  pad([26, 38], T_EXIT + 0.3, 22.0, 0.05, 400, 1.5, 1.0);
  [[19.3, 69], [20.2, 65], [21.1, 62]].forEach(([t, m]) => bell(m, t, 0.05, 2.6));
  // V  the run at the tornado: Dm - Bb - Gm - A, drums and brass growing until the cut
  {
    const t0 = 22.0, beat = (T_END - t0) / 16;
    const CH = [[26, 38, 50, 57, 62, 65], [22, 34, 46, 53, 58, 62], [19, 31, 43, 50, 55, 58], [21, 33, 45, 52, 57, 61, 64]];
    CH.forEach((c, i) => {
      const a = t0 + i * 4 * beat, b = a + 4 * beat;
      pad(c.slice(1), a, b - 0.25, 0.045 + 0.022 * i, 900 + 700 * i, 0.5, 0.35);
      sub(c[0], a, b - 0.3, 0.14 + 0.03 * i);
      for (let k = 0; k < 4; k++) {
        const g = 0.16 + 0.03 * (i * 4 + k);
        hit(a + k * beat, k === 0 ? g * 1.4 : g); if (i >= 2) hit(a + (k + 0.5) * beat, g * 0.5); if (i === 3) hit(a + (k + 0.75) * beat, g * 0.4);
      }
      if (i >= 1) for (let k = 0; k < 16; k++) pluck(c[2] + [0, 12, 7, 12][k % 4] + (k % 8 === 6 ? 3 : 0), a + k * beat / 4, 0.03 + 0.016 * i, 1200 + 900 * i, 0.14, k % 2 ? 0.4 : -0.4);
    });
    [[0, 74], [4, 77], [8, 79], [10, 82], [12, 81], [14, 85]].forEach(([b, m]) => pad([m, m - 12], t0 + b * beat, t0 + (b + 1.7) * beat, 0.022 + 0.002 * b, 2600, 0.25, 0.3));
    riser(T_END - 3.0, T_END, 0.22);
  }
  // a hall: four feedback combs and two all-passes per channel, mixed back under the dry signal
  for (const [buf, off] of [[L, 0], [R, 23]]) {
    const wet = new Float32Array(N);
    for (const d0 of [1557, 1617, 1491, 1422]) {
      const d = Math.round((d0 + off) * SR / 44100), line = new Float32Array(d); let p = 0, lpf = 0;
      for (let i = 0; i < N; i++) { const y = line[p]; lpf += 0.35 * (y - lpf); line[p] = buf[i] + lpf * 0.86; if (++p === d) p = 0; wet[i] += y; }
    }
    for (const d0 of [225, 556]) {
      const d = Math.round((d0 + off) * SR / 44100), line = new Float32Array(d); let p = 0;
      for (let i = 0; i < N; i++) { const z = line[p], x = wet[i]; line[p] = x + z * 0.5; wet[i] = z - x * 0.5; if (++p === d) p = 0; }
    }
    for (let i = 0; i < N; i++) buf[i] += wet[i] * 0.07;
  }
  for (let i = 0; i < N; i++) { L[i] *= 0.55; R[i] *= 0.55; }

  // ---- thunder: a rumble per flash, softened and delayed with distance; a crack for close channels ----
  const visible = new Set(BOLTS.map(b => b.flash)), power = new Set(POWER);
  const NZ = new Float32Array(SR * 4); for (let i = 0; i < NZ.length; i++) NZ[i] = r() * 2 - 1;
  for (const f of FLASHES) {
    if (f.t < -0.5 || f.t > DUR || power.has(f)) continue;
    const c = camera(Math.max(0, f.t)).pos;
    const dist = Math.hypot(f.x - c[0], f.y - c[1], f.z - c[2]);
    const near = visible.has(f);
    const t0 = Math.max(0, f.t + Math.min(1.2, dist * 0.05));
    const peak = near ? Math.min(0.9, 2.2 / (1 + dist * 0.35)) : Math.min(0.4, f.I / 420) * (25 / (25 + dist));
    if (peak < 0.006) continue;
    const pan = Math.max(-1, Math.min(1, (f.x - c[0]) / (4 + dist * 0.5)));
    const dec = 1.2 + r() + (near ? 1.0 : 0), fc = 60 + 5000 / (8 + dist * 3), flt = lp2();
    let k = (r() * NZ.length) | 0;
    mix(t0, dec + 0.2, pan, t => { if (++k >= NZ.length) k = 0; return flt(NZ[k], fc) * peak * decay(t, 0.04, dec); });
    if (near) {
      let k2 = (r() * NZ.length) | 0, lo = 0, ph = 0;
      const kc = Math.min(1, TAU * 900 / SR);
      mix(t0, 0.4, pan, t => { if (++k2 >= NZ.length) k2 = 0; lo += kc * (NZ[k2] - lo); return (NZ[k2] - lo) * peak * 0.8 * decay(t, 0.004, 0.22); });
      mix(t0, 1.8, 0, t => { ph += 70 * (28 / 70) ** Math.min(1, t / 1.2) / SR; return Math.sin(TAU * ph) * peak * 0.9 * decay(t, 0.01, 1.6); });
    }
  }
  return [L, R];
}
