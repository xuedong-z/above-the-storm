// Tiling 3D noise volume, generated on the CPU at load.
//   R = Perlin-Worley (billowy base shape)   G = Worley fbm (erosion detail)
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise3D(N = 96) {
  const r = rng(1234);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const rand = new Float32Array(256);
  for (let i = 0; i < 256; i++) rand[i] = r();

  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const g = h & 15, u = g < 8 ? x : y, v = g < 4 ? y : (g === 12 || g === 14 ? x : z);
    return ((g & 1) ? -u : u) + ((g & 2) ? -v : v);
  };
  const perlin = (x, y, z, P) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X0 = ((xi % P) + P) % P, Y0 = ((yi % P) + P) % P, Z0 = ((zi % P) + P) % P;
    const X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P, Z1 = (Z0 + 1) % P;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const h = (X, Y, Z) => perm[perm[perm[X] + Y] + Z];
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(grad(h(X0, Y0, Z0), xf, yf, zf), grad(h(X1, Y0, Z0), xf - 1, yf, zf), u),
        l(grad(h(X0, Y1, Z0), xf, yf - 1, zf), grad(h(X1, Y1, Z0), xf - 1, yf - 1, zf), u), v),
      l(l(grad(h(X0, Y0, Z1), xf, yf, zf - 1), grad(h(X1, Y0, Z1), xf - 1, yf, zf - 1), u),
        l(grad(h(X0, Y1, Z1), xf, yf - 1, zf - 1), grad(h(X1, Y1, Z1), xf - 1, yf - 1, zf - 1), u), v), w);
  };
  const worley = (x, y, z, P) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      const h = perm[perm[perm[((cx % P) + P) % P] + ((cy % P) + P) % P] + ((cz % P) + P) % P];
      const fx = cx + rand[h], fy = cy + rand[(h + 85) & 255], fz = cz + rand[(h + 170) & 255];
      const d = (fx - x) * (fx - x) + (fy - y) * (fy - y) + (fz - z) * (fz - z);
      if (d < best) best = d;
    }
    return 1 - Math.min(Math.sqrt(best), 1);
  };

  const data = new Uint8Array(N * N * N * 2);
  let o = 0;
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / N, y = j / N, z = k / N;
    const pf = perlin(x * 4, y * 4, z * 4, 4) + 0.5 * perlin(x * 8, y * 8, z * 8, 8) + 0.25 * perlin(x * 16, y * 16, z * 16, 16);
    const pn = Math.min(1, Math.max(0, pf * 0.62 + 0.5));
    const w4 = worley(x * 4, y * 4, z * 4, 4), w8 = worley(x * 8, y * 8, z * 8, 8);
    const w16 = worley(x * 16, y * 16, z * 16, 16), w32 = worley(x * 32, y * 32, z * 32, 32);
    const wLow = w4 * 0.625 + w8 * 0.25 + w16 * 0.125;
    const pw = wLow * 0.55 + pn * (1 - wLow * 0.55);          // perlin remapped by worley
    const wHi = w8 * 0.5 + w16 * 0.3 + w32 * 0.2;
    data[o++] = Math.max(0, Math.min(255, pw * 255));
    data[o++] = Math.max(0, Math.min(255, wHi * 255));
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
