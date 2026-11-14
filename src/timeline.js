// The whole film as pure functions of time: camera path, storm layout, lightning, lamps.
// World units are kilometres, time is seconds. The camera starts above the anvil heading -Z,
// weaves between overshooting tops, looks up at the sprites, rolls over, dives through the
// main updraft, breaks out under the cloud base and runs along a highway toward a tornado.
import { rng } from './rng.js';

export const DUR = 30, FPS = 30;

// ---- storm cells: x, z, radius, overshooting-top altitude ----------------------------------
export const CELLS = [
  { x: -9, z: -8, r: 5, top: 17.3 },
  { x: 9, z: -17, r: 5.5, top: 17.8 },
  { x: -10, z: -29, r: 6, top: 17.5 },
  { x: 8.5, z: -40, r: 5, top: 17.0 },
  { x: 14, z: -62, r: 6, top: 17.4 },        // blue-jet cell
  { x: 0, z: -75, r: 14, top: 17.8 },        // main supercell: the dive goes through this one
  { x: 20, z: -235, r: 30, top: 17.0 },      // distant sprite-producing storm
  { x: -60, z: -150, r: 18, top: 16.8 },
];
export const JET_CELL = CELLS[4], MAIN_CELL = CELLS[5], SPRITE_CELL = CELLS[6];

export const T_PARENT = 6.4, T_ELVE = 6.48, T_HALO = 6.62, T_SPRITE = 6.74, T_JET = 8.5;
export const T_ENTER = 12.4, T_EXIT = 18.3, T_END = 29.72;

// ---- ground layout -------------------------------------------------------------------------
export const TOWN = { x: 1.75, z: -85.3, r: 0.95 };
export const RAIN = { x: -2.5, z: -91, r: 6.5 };
export const ELEVATOR = { x: -0.075, z: -83.75 };
export const FARMS = [                       // x, z, rotation, seed
  [0.085, -80.95, 0.2, 1], [-0.11, -81.7, 1.9, 2], [0.075, -82.45, 3.4, 3], [-0.09, -83.1, 0.9, 4],
  [0.42, -81.3, 2.2, 5], [-0.55, -82.6, 0.5, 6],
];
export const tornado = t => ({ x: 0.78 - 0.072 * (t - 21), z: -84.3 + 0.01 * (t - 21) });

// ---- interpolation -------------------------------------------------------------------------
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// non-uniform Catmull-Rom through keys [[t, v0, v1, ...], ...]
function spline(keys) {
  const n = keys.length, dim = keys[0].length - 1;
  const tan = keys.map((k, i) => {
    const a = keys[Math.max(0, i - 1)], b = keys[Math.min(n - 1, i + 1)];
    return k.slice(1).map((_, d) => (b[d + 1] - a[d + 1]) / (b[0] - a[0]));
  });
  return t => {
    t = Math.min(keys[n - 1][0], Math.max(keys[0][0], t));
    let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], h = b[0] - a[0], u = (t - a[0]) / h;
    const u2 = u * u, u3 = u2 * u;
    const out = new Array(dim);
    for (let d = 0; d < dim; d++)
      out[d] = (2 * u3 - 3 * u2 + 1) * a[d + 1] + (u3 - 2 * u2 + u) * h * tan[i][d]
             + (-2 * u3 + 3 * u2) * b[d + 1] + (u3 - u2) * h * tan[i + 1][d];
    return out;
  };
}
const keyed = ks => { const f = spline(ks); return t => f(t)[0]; };
// piecewise-linear, for values that must not overshoot
const lin = ks => t => {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) { const a = ks[i - 1], b = ks[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
  return ks[ks.length - 1][1];
};

// ---- camera --------------------------------------------------------------------------------
const POS = spline([
  [0, -2, 15.4, 0], [2, 3.5, 15.2, -12], [4, -3, 15.6, -24], [6, 0, 15.9, -36], [8, 1.5, 16.6, -48],
  [10, 1.0, 17.6, -59], [11.5, 0.4, 18.6, -67], [12.5, 0, 17.5, -71.5], [14, 0, 13.0, -74.5],
  [16, 0.05, 6.5, -76.5], [17.5, 0.1, 2.3, -77.8], [18.5, 0.1, 1.0, -78.7], [20, 0.06, 0.28, -79.8],
  [21.5, 0.02, 0.07, -80.5], [24, 0.012, 0.036, -81.25], [27, 0.0, 0.030, -82.15], [30, -0.012, 0.062, -83.05],
]);
// yaw (0 = heading -Z, + toward +X), pitch, roll in degrees
const ROT = spline([
  [0, 15, -7, -22], [2, -18, -6, 30], [4, 12, -4, -26], [6, 0, 5, 0], [7.5, 0, 17, 0], [9.5, 9, 22, 6],
  [10.8, 4, 28, 45], [11.6, 0, 4, 125], [12.5, 0, -62, 180], [13.5, 0, -82, 225], [16, 0, -76, 330],
  [17.5, 0, -58, 360], [18.5, 2, -37, 360], [20, 5, -13, 352], [21.5, 2, -2, 358], [24, 2, 2.5, 362],
  [27, 3, 4, 359], [30, 5, 15, 360],
]);
const FOVK = lin([[0, 50], [6, 50], [8, 46], [10.5, 50], [12.5, 66], [18, 70], [21, 64], [30, 60]]);
const SHAKE = lin([[0, 0.12], [11, 0.15], [12.6, 1.6], [17.6, 1.9], [18.6, 0.7], [21, 0.35], [27, 0.45], [30, 1.1]]);

const wob = (t, f, ph) => Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 2.31 + ph * 1.7) * 0.3 + Math.sin(t * f * 5.13 + ph * 0.3) * 0.1;
export function camera(t) {
  const pos = POS(t);
  let [yaw, pitch, roll] = ROT(t);
  const s = SHAKE(t);
  yaw += s * wob(t, 13.1, 0.3); pitch += s * wob(t, 16.7, 2.1); roll += 1.6 * s * wob(t, 9.3, 4.2);
  const d = Math.PI / 180;
  const p2 = POS(t + 0.01);
  return { pos, yaw: yaw * d, pitch: pitch * d, roll: roll * d, fov: FOVK(t),
    vel: [(p2[0] - pos[0]) * 100, (p2[1] - pos[1]) * 100, (p2[2] - pos[2]) * 100] };
}

// ---- time-keyed look parameters ------------------------------------------------------------
const EXPO = lin([[0, 0.0], [0.7, 1.0], [12, 1.0], [13, 1.5], [17.8, 1.7], [18.6, 2.6], [21, 3.0], [29.6, 3.0]]);
export function look(t) {
  const below = sm(T_EXIT - 0.9, T_EXIT + 0.3, t), inCloud = sm(T_ENTER - 0.1, T_ENTER + 0.4, t) * (1 - sm(T_EXIT - 0.3, T_EXIT + 0.5, t));
  return {
    exposure: t > T_END ? 0 : EXPO(t),
    minStep: 0.10 - 0.088 * sm(16.5, 18.5, t),
    tle: 1 - sm(12.2, 12.7, t),
    lamps: sm(T_EXIT - 0.25, T_EXIT + 0.35, t),
    fogExt: 0.035 + 3.2 * inCloud,                      // extinction applied to additive geometry
    streakBox: 0.6 - 0.48 * below, streakGain: Math.max(inCloud, below * 0.8),
    below, inCloud,
  };
}

// ---- lightning -----------------------------------------------------------------------------
// every flash is a light: { t, x, y, z, I, tau, strokes, col, soft }.  Bolts add visible channels.
export const FLASHES = [], BOLTS = [], POWER = [];
{
  const r = rng(77);
  const strokeSet = (n, gap = 0.11) => { const s = []; let ts = 0; for (let k = 0; k < n; k++) { s.push({ dt: ts, a: k ? 0.35 + 0.6 * r() : 1 }); ts += 0.04 + gap * r(); } return s; };
  // intracloud flicker in every cell for the whole film
  CELLS.forEach((c, ci) => {
    const rate = (ci === 5 ? 1.5 : 0.25) + c.r * 0.035;
    let t = -1.5 + r() * 2.5;
    while (t < DUR + 1) {
      const ang = r() * 6.283, rr = Math.sqrt(r()) * c.r * 0.85;
      FLASHES.push({
        t, x: c.x + Math.cos(ang) * rr, y: (ci === 5 ? 3.5 + 7 * r() : 9.0 + 2.6 * r()), z: c.z + Math.sin(ang) * rr,
        I: (35 + 110 * r() * r()) * (0.7 + Math.min(c.r, 12) / 14), tau: 0.07 + 0.05 * r(), strokes: strokeSet(1 + ((r() * 4) | 0)),
        col: [0.70 + 0.15 * r(), 0.80 + 0.08 * r(), 1.0], soft: 9,
      });
      t += -Math.log(1 - r()) / rate;
    }
  });
  // parent stroke of the sprites: the whole distant anvil lights up
  const c = SPRITE_CELL;
  for (let k = 0; k < 6; k++) {
    const ang = k * 0.9, rr = k === 0 ? 0 : c.r * (0.35 + 0.4 * r());
    FLASHES.push({ t: T_PARENT + 0.015 * k, x: c.x + Math.cos(ang) * rr, y: 10 + 2 * r(), z: c.z + Math.sin(ang) * rr,
      I: 520, tau: 0.30, strokes: [{ dt: 0, a: 1 }, { dt: 0.12, a: 0.35 }, { dt: 0.4, a: 0.2 }], col: [0.86, 0.9, 1.0], soft: 9 });
  }
  const j = JET_CELL;
  FLASHES.push({ t: T_JET - 0.12, x: j.x, y: 12.5, z: j.z, I: 260, tau: 0.5,
    strokes: [{ dt: 0, a: 1 }, { dt: 0.2, a: 0.7 }, { dt: 0.55, a: 0.6 }, { dt: 1.1, a: 0.4 }], col: [0.62, 0.74, 1.0], soft: 9 });

  // visible channels
  const bolt = (t, a, b, I, n, soft = 0.25) => {
    const strokes = strokeSet(n, 0.09);
    const f = { t, x: (a[0] + b[0]) / 2, y: Math.max(0.35, (a[1] + b[1]) / 2), z: (a[2] + b[2]) / 2, I: I * (soft > 1 ? 0.14 : 0.35), tau: 0.045, strokes, col: [0.82, 0.86, 1.0], soft };
    FLASHES.push(f);
    BOLTS.push({ a, b, flash: f, seed: (r() * 1e6) | 0 });
  };
  // inside the updraft: channels crossing close to the camera
  bolt(13.25, [-1.6, 15.6, -73.2], [1.3, 14.2, -74.9], 26, 3, 2.5);
  bolt(14.45, [1.2, 12.4, -74.0], [-0.9, 10.6, -75.6], 30, 2, 2.5);
  bolt(15.35, [-1.1, 9.3, -75.2], [0.9, 7.6, -76.6], 26, 4, 2.5);
  bolt(16.5, [0.8, 6.0, -76.0], [-0.5, 4.2, -77.4], 34, 3, 2.5);
  bolt(17.45, [-0.7, 3.3, -77.2], [0.5, 2.0, -78.6], 22, 2, 2.5);
  // cloud-to-ground strokes under the base
  bolt(18.75, [-2.6, 1.15, -83.5], [-3.1, 0, -84.4], 9, 3);
  bolt(19.7, [1.2, 1.1, -88.6], [0.7, 0, -88.9], 26, 4);
  bolt(21.2, [3.6, 1.15, -86.5], [4.0, 0, -87.2], 10, 2);
  bolt(22.55, [-0.9, 1.05, -82.6], [-0.75, 0, -82.9], 5, 3);
  bolt(24.3, [0.2, 1.1, -87.9], [0.6, 0, -88.1], 22, 5);
  bolt(25.85, [2.4, 1.1, -84.9], [2.2, 0, -85.6], 7, 2);
  bolt(27.2, [-0.5, 1.0, -83.2], [-0.42, 0, -83.45], 4.5, 4);
  bolt(28.5, [1.1, 1.1, -86.8], [0.4, 0, -87.3], 20, 3);
  bolt(29.38, [0.25, 1.0, -85.2], [0.05, 0, -85.35], 30, 6);

  // power flashes: the tornado tears through distribution lines (arc light at ground level)
  for (const [t, dx, dz] of [[23.4, 0.05, 0.03], [25.1, -0.04, -0.05], [26.6, 0.03, 0.06], [27.9, -0.05, 0.02], [28.9, 0.0, -0.04]]) {
    const tp = tornado(t);
    const f = { t, x: tp.x + dx, y: 0.03, z: tp.z + dz, I: 0.6, tau: 0.10, strokes: strokeSet(5, 0.12), col: [0.35, 1.0, 0.92], soft: 0.012, power: true };
    FLASHES.push(f); POWER.push(f);
  }
}

export function flashIntensity(f, t) {
  let s = 0;
  for (const k of f.strokes) { const dt = t - f.t - k.dt; if (dt >= 0) s += k.a * Math.exp(-dt / f.tau); }
  return s * f.I;
}
// the `n` flashes that matter most to the camera at time t
export function activeFlashes(t, n, cam) {
  const out = [];
  for (const f of FLASHES) {
    if (t < f.t || t > f.t + 2.5) continue;
    const I = flashIntensity(f, t);
    if (I < 0.01 * f.I + 1e-4) continue;
    const d2 = (f.x - cam[0]) ** 2 + (f.y - cam[1]) ** 2 + (f.z - cam[2]) ** 2;
    out.push({ f, I, score: I / (d2 + f.soft + 0.5) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, n);
}

// ---- lamps ---------------------------------------------------------------------------------
// [x, y, z, size(km), gain, r, g, b, offTime, blink]
export const LAMPS = [];
{
  const r = rng(555);
  const SOD = [1.0, 0.52, 0.16], LED = [0.80, 0.90, 1.0], WARM = [1.0, 0.72, 0.38], MV = [0.70, 1.0, 0.86];
  const offAt = x => { const k = Math.floor((x - (TOWN.x - TOWN.r)) / (2 * TOWN.r) * 5); return [23.45, 25.15, 26.65, 27.95, 28.95][Math.max(0, Math.min(4, k))] + 0.05 * r(); };
  const S = 0.105;
  for (let i = -10; i <= 10; i++) for (let k = -10; k <= 10; k++) {
    const x = TOWN.x + i * S, z = TOWN.z + k * S;
    const dd = Math.hypot(x - TOWN.x, z - TOWN.z) / TOWN.r;
    if (dd > 1 + 0.25 * (r() - 0.5)) continue;
    LAMPS.push([x, 0.009, z, 0.0045, 1.0, ...(r() < 0.72 ? SOD : LED), offAt(x), 0]);                      // intersection
    if (r() < 0.7) LAMPS.push([x + S / 2, 0.009, z, 0.0045, 0.9, ...(r() < 0.72 ? SOD : LED), offAt(x), 0]);
    const nw = (r() * 5) | 0;                                                                             // lit windows, porches
    for (let w = 0; w < nw; w++) LAMPS.push([x + (r() - 0.5) * S, 0.003, z + (r() - 0.5) * S, 0.0025, 0.22 + 0.3 * r(), ...WARM, offAt(x), 0]);
  }
  for (let k = 0; k < 14; k++) LAMPS.push([TOWN.x - 0.5 + 0.08 * k, 0.012, TOWN.z + 0.02, 0.006, 1.6, ...LED, offAt(TOWN.x - 0.5 + 0.08 * k), 0]);   // main street
  for (const [x, z] of FARMS) { LAMPS.push([x + 0.012, 0.008, z + 0.006, 0.005, 1.3, ...MV, 99, 0]); LAMPS.push([x - 0.004, 0.003, z - 0.002, 0.0025, 0.4, ...WARM, 99, 0]); }
  LAMPS.push([ELEVATOR.x, 0.047, ELEVATOR.z, 0.004, 1.2, 1, 0.08, 0.05, 99, 1]);                             // red obstruction lights
  LAMPS.push([TOWN.x + 0.3, 0.12, TOWN.z - 0.5, 0.004, 1.5, 1, 0.08, 0.05, 99, 1]);
  LAMPS.push([ELEVATOR.x + 0.02, 0.01, ELEVATOR.z + 0.02, 0.005, 1.2, ...SOD, 28.9, 0]);
  for (let i = 0; i < 6; i++) for (let k = 0; k < 7; k++)                                                  // wind farm: synchronised red beacons
    LAMPS.push([-5.5 - 0.9 * i + 0.3 * r(), 0.09, -84 - 1.1 * k + 0.4 * r(), 0.004, 1.5, 1, 0.08, 0.05, 99, 1]);
  for (let k = 0; k < 170; k++) {                                                                          // scattered farmsteads to the horizon
    const x = (r() - 0.5) * 36, z = -84 + (r() - 0.5) * 36;
    if (Math.hypot(x, z + 82) < 1.2) continue;
    LAMPS.push([x, 0.008, z, 0.005, 1.2, ...(r() < 0.5 ? MV : SOD), 99, 0]);
  }
}
// cars fleeing along the highway toward the camera: [x, z] at time t
export const CARS = [{ t0: 24.6, z0: -82.05 }, { t0: 27.3, z0: -82.75 }, { t0: 22.4, z0: -81.2 }];
export const carPos = (c, t) => [0.0019, c.z0 + 0.034 * (t - c.t0)];
