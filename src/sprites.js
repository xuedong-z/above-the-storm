// Transient luminous events as additive geometry: red sprites (branching streamers + diffuse
// glow), the sprite halo, an expanding elve ring, and a blue jet. Everything is a function of
// time through per-vertex "arrival time" attributes, so any frame can be rendered directly.
import * as THREE from 'three';
import { rng } from './noise.js';
import { SPRITE_CELL, JET_CELL, T_ELVE, T_HALO, T_SPRITE, T_JET } from './timeline.js';

class Ribbons {
  constructor() { this.pos = []; this.tan = []; this.side = []; this.w = []; this.t = []; this.gain = []; this.life = []; this.col = []; this.idx = []; this.n = 0; }
  addPath(pts) {
    if (pts.length < 2) return;
    const base = this.n;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(pts.length - 1, i + 1)].p;
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      const q = pts[i];
      for (const s of [-1, 1]) {
        this.pos.push(q.p[0], q.p[1], q.p[2]); this.tan.push(tx, ty, tz); this.side.push(s);
        this.w.push(q.w); this.t.push(q.t); this.gain.push(q.gain); this.life.push(q.life); this.col.push(q.col[0], q.col[1], q.col[2]);
        this.n++;
      }
      if (i > 0) { const v = base + i * 2; this.idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    const f = (a, n) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', f(this.pos, 3)); g.setAttribute('aTan', f(this.tan, 3));
    g.setAttribute('aSide', f(this.side, 1)); g.setAttribute('aWidth', f(this.w, 1));
    g.setAttribute('aT', f(this.t, 1)); g.setAttribute('aGain', f(this.gain, 1));
    g.setAttribute('aLife', f(this.life, 1)); g.setAttribute('aCol', f(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

class Glows {
  constructor() { this.pos = []; this.corner = []; this.size = []; this.env = []; this.col = []; this.kind = []; this.idx = []; this.n = 0; }
  // kind 0: camera-facing gaussian, 1: horizontal gaussian disk, 2: horizontal expanding ring
  add(p, sx, sy, t0, rise, decay, gain, col, kind = 0) {
    const b = this.n;
    for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.pos.push(p[0], p[1], p[2]); this.corner.push(c[0], c[1]); this.size.push(sx, sy);
      this.env.push(t0, rise, decay, gain); this.col.push(col[0], col[1], col[2]); this.kind.push(kind); this.n++;
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    const f = (a, n) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', f(this.pos, 3)); g.setAttribute('aCorner', f(this.corner, 2));
    g.setAttribute('aSize', f(this.size, 2)); g.setAttribute('aEnv', f(this.env, 4));
    g.setAttribute('aCol', f(this.col, 3)); g.setAttribute('aKind', f(this.kind, 1));
    g.setIndex(this.idx);
    return g;
  }
}

const CURVE = /* glsl */`
vec3 curved(vec3 wp){ vec2 d = wp.xz - uCam.xz; wp.y -= dot(d, d) / (2.0 * 6371.0); return wp; }`;

const ribbonMat = () => new THREE.ShaderMaterial({
  uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uPix: { value: 0.001 } },
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    attribute vec3 aTan, aCol; attribute float aSide, aWidth, aT, aGain, aLife;
    uniform vec3 uCam; uniform float uTime, uPix;
    varying float vSide, vI; varying vec3 vCol;
    ${CURVE}
    void main(){
      vec4 vp = viewMatrix * vec4(curved(position), 1.0);
      vec3 vt = normalize((viewMatrix * vec4(aTan, 0.0)).xyz);
      vec3 sd = normalize(cross(vt, vp.xyz));
      float w = max(aWidth, uPix * length(vp.xyz) * 1.4);
      vp.xyz += sd * aSide * w;
      gl_Position = projectionMatrix * vp;
      float dt = uTime - aT;
      float head = exp(-dt / 0.07) * 5.0;
      float body = exp(-dt / aLife) * (1.0 - exp(-dt / 0.04));
      vI = dt < 0.0 ? 0.0 : aGain * (head + body) * (aWidth / w);
      vSide = aSide; vCol = aCol;
    }`,
  fragmentShader: /* glsl */`
    varying float vSide, vI; varying vec3 vCol;
    void main(){ gl_FragColor = vec4(vCol * vI * exp(-5.0 * vSide * vSide), 1.0); }`,
});

const glowMat = () => new THREE.ShaderMaterial({
  uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 } },
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    attribute vec2 aCorner, aSize; attribute vec4 aEnv; attribute vec3 aCol; attribute float aKind;
    uniform vec3 uCam; uniform float uTime;
    varying vec2 vC; varying vec3 vCol; varying float vDt, vKind; varying vec3 vEnv;
    ${CURVE}
    void main(){
      vec4 vp;
      if (aKind < 0.5){ vp = viewMatrix * vec4(curved(position), 1.0); vp.xy += aCorner * aSize; }
      else { vp = viewMatrix * vec4(curved(position + vec3(aCorner.x * aSize.x, 0.0, aCorner.y * aSize.y)), 1.0); }
      gl_Position = projectionMatrix * vp;
      vC = aCorner; vCol = aCol * aEnv.w; vDt = uTime - aEnv.x; vEnv = aEnv.yzw; vKind = aKind;
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vC; varying vec3 vCol; varying float vDt, vKind; varying vec3 vEnv;
    void main(){
      if (vDt < 0.0) discard;
      float r = length(vC), I;
      if (vKind > 1.5){
        float u = clamp(vDt / vEnv.x, 0.0, 1.0), rho = 0.08 + 0.84 * u;
        float ring = exp(-pow((r - rho) / 0.055, 2.0));
        I = ring * (1.0 - u) * (1.0 - u) / (0.25 + rho) * smoothstep(0.0, 0.06, u);
      } else {
        I = max(exp(-4.5 * r * r) - 0.011, 0.0) * (1.0 - exp(-vDt / vEnv.x)) * exp(-vDt / vEnv.y);
      }
      gl_FragColor = vec4(vCol * I, 1.0);
    }`,
});

const RED = [1.0, 0.085, 0.045], MAG = [0.95, 0.12, 0.42], BLU = [0.30, 0.26, 1.0];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spriteCol = alt => alt > 64 ? mix3(MAG, RED, ss(64, 72, alt)) : mix3(BLU, MAG, ss(50, 64, alt));

// random-walk streamer with recursive branching
function streamer(rb, r, start, base, o, depth, t0, gainMul) {
  let p = start.slice(), d = base.slice(), t = t0;
  const pts = [];
  const len = o.len(depth);
  const steps = Math.ceil(len / o.step);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const bead = r() < 0.07 ? 2.4 : 1;
    pts.push({
      p: p.slice(), w: o.w * (depth ? 0.65 : 1) * (1 - 0.7 * u), t,
      gain: o.gain * gainMul * (1 - 0.55 * u) * bead * (0.88 + 0.24 * r()),
      life: o.life * (bead > 1 ? 2.0 : 1) * (0.9 + 0.2 * r()), col: o.col(p[1]),
    });
    d[0] += (r() - 0.5) * o.jit; d[1] += (r() - 0.5) * o.jit * 0.35; d[2] += (r() - 0.5) * o.jit;
    d = d.map((v, k) => v * 0.86 + base[k] * 0.14);
    const l = Math.hypot(d[0], d[1], d[2]); d = d.map(v => v / l);
    p = [p[0] + d[0] * o.step, p[1] + d[1] * o.step, p[2] + d[2] * o.step];
    t += o.step / o.speed;
    if (depth < o.maxDepth && i > 1 && i < steps - 2 && r() < o.branch) {
      const a = r() * 6.283, sp = o.spread * (0.5 + r());
      let bd = [d[0] + Math.cos(a) * sp, d[1], d[2] + Math.sin(a) * sp];
      const bl = Math.hypot(bd[0], bd[1], bd[2]); bd = bd.map(v => v / bl);
      streamer(rb, r, p, bd, o, depth + 1, t, gainMul * 0.7);
    }
  }
  rb.addPath(pts);
}

function spriteElement(rb, gl, r, cx, cz, s, t0) {
  const down = {
    step: 0.7, speed: 42, jit: 0.26, branch: 0.10, spread: 0.20, maxDepth: 3, w: 0.26 * s, gain: 1.7, life: 1.25,
    len: dpt => (dpt ? 6 + 9 * r() : 17 + 11 * r()) * s, col: spriteCol,
  };
  const up = {
    step: 0.7, speed: 22, jit: 0.50, branch: 0.22, spread: 0.55, maxDepth: 3, w: 0.36 * s, gain: 0.9, life: 0.85,
    len: dpt => (dpt ? 3 + 5 * r() : 8 + 6 * r()) * s, col: spriteCol,
  };
  const nD = 13 + ((r() * 8) | 0), nU = 11 + ((r() * 7) | 0);
  for (let i = 0; i < nD; i++) {
    const a = r() * 6.283, rr = Math.sqrt(r()) * 3.4 * s;
    const st = [cx + Math.cos(a) * rr, 72 + 5 * r(), cz + Math.sin(a) * rr];
    const out = 0.01 + 0.07 * r();
    streamer(rb, r, st, [Math.cos(a) * out, -1, Math.sin(a) * out], down, 0, t0 + 0.10 * r(), 1);
  }
  for (let i = 0; i < nU; i++) {
    const a = r() * 6.283, rr = Math.sqrt(r()) * 2.2 * s;
    const st = [cx + Math.cos(a) * rr, 74 + 3 * r(), cz + Math.sin(a) * rr];
    const out = 0.25 + 0.45 * r();
    streamer(rb, r, st, [Math.cos(a) * out, 1, Math.sin(a) * out], up, 0, t0 + 0.22 + 0.15 * r(), 1);
  }
  // diffuse glow: bright core where streamers start, soft hair above, dim blue skirt below
  gl.add([cx, 75, cz], 5.5 * s, 5.0 * s, t0 + 0.05, 0.12, 1.1, 0.55, RED);
  gl.add([cx, 82, cz], 11 * s, 8.5 * s, t0 + 0.25, 0.35, 0.9, 0.16, RED);
  gl.add([cx, 60, cz], 7 * s, 11 * s, t0 + 0.3, 0.3, 0.8, 0.05, MAG);
  gl.add([cx, 50, cz], 6 * s, 6 * s, t0 + 0.5, 0.3, 0.7, 0.03, BLU);
}

function blueJet(rb, gl, r, c, t0) {
  const baseAlt = c.top - 0.9;
  const jetCol = alt => mix3([0.55, 0.72, 1.0], [0.10, 0.20, 1.0], ss(baseAlt, 36, alt));
  const o = {
    step: 0.55, speed: 14, jit: 0.13, branch: 0.07, spread: 0.20, maxDepth: 2, w: 0.14, gain: 1.5, life: 1.5,
    len: dpt => (dpt ? 4 + 5 * r() : 21 + 9 * r()), col: jetCol,
  };
  for (let i = 0; i < 10; i++) {
    const a = r() * 6.283, rr = Math.sqrt(r()) * 0.45, out = 0.02 + 0.09 * r();
    streamer(rb, r, [c.x + Math.cos(a) * rr, baseAlt, c.z + Math.sin(a) * rr], [Math.cos(a) * out, 1, Math.sin(a) * out], o, 0, t0 + 0.08 * r(), 1);
  }
  for (let k = 0; k < 6; k++) {              // glow following the leader upward
    const alt = baseAlt + 2 + k * 4.4, w = 0.9 + k * 0.6;
    gl.add([c.x, alt, c.z], w, 3.8, t0 + (alt - baseAlt) / 14, 0.25, 1.5, 0.16 * (1 - k * 0.12), jetCol(alt));
  }
  gl.add([c.x, baseAlt + 0.5, c.z], 1.6, 1.2, t0 - 0.05, 0.1, 1.6, 0.35, [0.6, 0.75, 1.0]);
}

export function makeTLE() {
  const r = rng(4242);
  const rb = new Ribbons(), gl = new Glows();
  const c = SPRITE_CELL;
  const cx = c.x + 6, cz = c.z + 4;

  gl.add([cx, 92, cz], 210, 210, T_ELVE, 0.42, 0, 0.020, [1.0, 0.22, 0.16], 2);        // elve
  gl.add([cx, 79, cz], 42, 42, T_HALO, 0.06, 0.26, 0.16, [1.0, 0.16, 0.10], 1);         // sprite halo

  const els = [[0, 0, 1.25, 0], [-19, 6, 0.85, 0.16], [17, -8, 1.0, 0.27], [-36, -5, 0.6, 0.46],
               [33, 10, 0.75, 0.58], [-9, -16, 0.5, 0.75], [48, -4, 0.5, 0.95]];
  for (const [dx, dz, s, dt] of els) spriteElement(rb, gl, r, cx + dx, cz + dz, s, T_SPRITE + dt);

  blueJet(rb, gl, r, JET_CELL, T_JET);

  const group = new THREE.Group();
  const m1 = new THREE.Mesh(gl.build(), glowMat()), m2 = new THREE.Mesh(rb.build(), ribbonMat());
  m1.frustumCulled = m2.frustumCulled = false;
  group.add(m1, m2);
  group.userData.update = (t, camPos, pix) => {
    for (const m of [m1, m2]) { m.material.uniforms.uTime.value = t; m.material.uniforms.uCam.value.copy(camPos); }
    m2.material.uniforms.uPix.value = pix;
  };
  return group;
}
