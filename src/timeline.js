// The shot as pure functions of time: camera, storm cells, lightning schedule, event times.
import { rng } from './noise.js';

export const DUR = 10, FPS = 30, FOV = 38;

// storm cells: x, z (km), radius, overshooting-top altitude
export const CELLS = [
  { x: -8, z: -24, r: 7, top: 16.4 },
  { x: 15, z: -44, r: 9, top: 17.1 },
  { x: -30, z: -66, r: 8, top: 16.0 },
  { x: -31, z: -122, r: 11, top: 17.6 },     // blue-jet cell
  { x: 38, z: -135, r: 12, top: 16.8 },
  { x: 30, z: -218, r: 28, top: 17.0 },      // sprite-producing storm
  { x: -95, z: -250, r: 20, top: 16.5 },
  { x: 95, z: -185, r: 15, top: 16.6 },
];
export const JET_CELL = CELLS[3], SPRITE_CELL = CELLS[5];

export const T_PARENT = 3.0;   // giant positive stroke under the distant storm
export const T_ELVE = 3.08;
export const T_HALO = 3.22;
export const T_SPRITE = 3.34;
export const T_JET = 6.0;

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function camera(t) {
  const pos = [0.6 * Math.sin(t * 0.21), 20.9 + 0.11 * t, -3.0 * t];
  const pitch = (1.0 + 4.6 * sm(0.5, 7.0, t)) * Math.PI / 180;
  const yaw = (1.5 + 1.2 * sm(0, 10, t)) * Math.PI / 180;     // drifting slightly right
  const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  return { pos, dir };
}

// ---- lightning schedule (deterministic) ----------------------------------------------------
export const FLASHES = [];
{
  const r = rng(77);
  CELLS.forEach((c, ci) => {
    const rate = 0.22 + c.r * 0.035;
    let t = -1.5 + r() * 2.5;
    while (t < DUR + 1) {
      const strokes = [];
      const n = 1 + ((r() * 4) | 0);
      let ts = 0;
      for (let k = 0; k < n; k++) { strokes.push({ dt: ts, a: 0.4 + 0.6 * r() }); ts += 0.05 + 0.11 * r(); }
      const ang = r() * 6.283, rr = Math.sqrt(r()) * c.r * 0.85;
      FLASHES.push({
        t, cell: ci, x: c.x + Math.cos(ang) * rr, y: 9.0 + 2.6 * r(), z: c.z + Math.sin(ang) * rr,
        I: (35 + 110 * r() * r()) * (0.7 + c.r / 14), tau: 0.07 + 0.05 * r(), strokes,
        col: [0.70 + 0.15 * r(), 0.80 + 0.08 * r(), 1.0],
      });
      t += -Math.log(1 - r()) / rate;
    }
  });
  // the parent stroke: the whole distant anvil lights up, with a long continuing current
  const c = SPRITE_CELL;
  for (let k = 0; k < 7; k++) {
    const ang = k * 0.9, rr = k === 0 ? 0 : c.r * (0.35 + 0.4 * r());
    FLASHES.push({
      t: T_PARENT + 0.015 * k, cell: 5, x: c.x + Math.cos(ang) * rr, y: 10.0 + 2 * r(), z: c.z + Math.sin(ang) * rr,
      I: 520, tau: 0.30, strokes: [{ dt: 0, a: 1 }, { dt: 0.12, a: 0.35 }, { dt: 0.4, a: 0.2 }], col: [0.86, 0.9, 1.0],
    });
  }
  // charge build-up and discharge under the jet
  const j = JET_CELL;
  FLASHES.push({ t: T_JET - 0.12, cell: 3, x: j.x, y: 11.0, z: j.z, I: 210, tau: 0.5,
    strokes: [{ dt: 0, a: 1 }, { dt: 0.2, a: 0.7 }, { dt: 0.55, a: 0.6 }, { dt: 1.1, a: 0.4 }], col: [0.62, 0.74, 1.0] });
}

export function flashIntensity(f, t) {
  let s = 0;
  for (const k of f.strokes) { const dt = t - f.t - k.dt; if (dt >= 0) s += k.a * Math.exp(-dt / f.tau); }
  return s * f.I;
}

// brightest `n` flashes at time t -> [{x,y,z,I,col}]
export function activeFlashes(t, n) {
  const out = [];
  for (const f of FLASHES) {
    if (t < f.t || t > f.t + 2.5) continue;
    const I = flashIntensity(f, t);
    if (I > 0.5) out.push({ f, I });
  }
  out.sort((a, b) => b.I - a.I);
  return out.slice(0, n);
}
