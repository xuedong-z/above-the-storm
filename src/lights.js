// Everything that emits light and is drawn as additive geometry on top of the ray-marched world:
// lightning channels, street / yard / window lamps and headlights, and the streaks of rain and
// hail rushing past the lens.
import * as THREE from 'three';
import { rng } from './noise.js';
import { BOLTS, LAMPS, CARS, flashIntensity } from './timeline.js';

const f32 = (a, n) => new THREE.Float32BufferAttribute(a, n);
const ADD = { transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };

// ---- lightning channels ---------------------------------------------------------------------
function jagged(a, b, r, rough, depth) {
  let pts = [a, b];
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * rough;
      out.push([(p[0] + q[0]) / 2 + (r() - 0.5) * len, (p[1] + q[1]) / 2 + (r() - 0.5) * len * 0.6, (p[2] + q[2]) / 2 + (r() - 0.5) * len], q);
    }
    pts = out;
  }
  return pts;
}
function makeBolts() {
  const pos = [], tan = [], side = [], wid = [], gain = [], bolt = [], idx = [];
  let n = 0;
  const path = (pts, w, g, bi) => {
    const base = n;
    pts.forEach((q, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const u = i / (pts.length - 1);
      for (const s of [-1, 1]) { pos.push(...q); tan.push(b[0] - a[0], b[1] - a[1], b[2] - a[2]); side.push(s); wid.push(w); gain.push(g * (1 - 0.5 * u * (g < 1 ? 1 : 0))); bolt.push(bi); n++; }
      if (i > 0) { const v = base + i * 2; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
    });
  };
  BOLTS.forEach((B, bi) => {
    const r = rng(B.seed);
    const L = Math.hypot(B.b[0] - B.a[0], B.b[1] - B.a[1], B.b[2] - B.a[2]);
    const main = jagged(B.a, B.b, r, 0.34, 7);
    path(main, 0.0035, 1, bi);
    const fork = (pts, len, g, level) => {
      const nb = level === 0 ? 5 + ((r() * 4) | 0) : (r() * 3) | 0;
      for (let k = 0; k < nb; k++) {
        const i = 4 + ((r() * (pts.length - 8)) | 0), p = pts[i], q = pts[Math.min(pts.length - 1, i + 3)];
        const l = len * (0.25 + 0.5 * r());
        const d = [q[0] - p[0] + (r() - 0.5) * 2 * L * 0.03, q[1] - p[1] - r() * L * 0.008, q[2] - p[2] + (r() - 0.5) * 2 * L * 0.03];
        const dl = Math.hypot(...d) || 1;
        const e = [p[0] + d[0] / dl * l, Math.max(0.02, p[1] + d[1] / dl * l), p[2] + d[2] / dl * l];
        const br = jagged(p, e, r, 0.36, 5);
        path(br, 0.0018, g, bi);
        if (level < 1) fork(br, l * 0.6, g * 0.5, level + 1);
      }
    };
    fork(main, L * 0.55, 0.28, 0);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', f32(pos, 3)); g.setAttribute('aTan', f32(tan, 3)); g.setAttribute('aSide', f32(side, 1));
  g.setAttribute('aWidth', f32(wid, 1)); g.setAttribute('aGain', f32(gain, 1)); g.setAttribute('aBolt', f32(bolt, 1));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({ ...ADD,
    uniforms: { uI: { value: new Float32Array(BOLTS.length) }, uPix: { value: 0.001 }, uFog: { value: 0.03 } },
    vertexShader: /* glsl */`
      attribute vec3 aTan; attribute float aSide, aWidth, aGain, aBolt;
      uniform float uI[${BOLTS.length}]; uniform float uPix, uFog;
      varying float vSide, vI;
      void main(){
        vec4 vp = viewMatrix * vec4(position, 1.0);
        vec3 vt = normalize((viewMatrix * vec4(aTan, 0.0)).xyz);
        vec3 sd = normalize(cross(vt, vp.xyz));
        float dist = length(vp.xyz);
        float w = max(aWidth, uPix * dist * 1.5);
        vp.xyz += sd * aSide * w;
        gl_Position = projectionMatrix * vp;
        vI = uI[int(aBolt + 0.5)] * aGain * sqrt(aWidth / w) * exp(-uFog * dist);
        vSide = aSide;
      }`,
    fragmentShader: /* glsl */`
      varying float vSide, vI;
      void main(){ gl_FragColor = vec4(vec3(0.80, 0.86, 1.0) * vI * exp(-6.0 * vSide * vSide), 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
  return mesh;
}

// ---- lamps ----------------------------------------------------------------------------------
function makeLamps() {
  const pos = [], corner = [], par = [], col = [], mov = [], idx = [];
  let n = 0;
  const add = (l, vz = 0, t0 = 0) => {
    for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(l[0], l[1], l[2]); corner.push(...c); par.push(l[3], l[4], l[8], l[9]); col.push(l[5], l[6], l[7]); mov.push(vz, t0);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
  };
  LAMPS.forEach(l => add(l));
  for (const c of CARS) for (const dx of [-0.0007, 0.0007])
    add([0.0019 + dx, 0.0007, c.z0, 0.0016, 5.0, 0.85, 0.92, 1.0, 99, 0], 0.034, c.t0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', f32(pos, 3)); g.setAttribute('aCorner', f32(corner, 2)); g.setAttribute('aPar', f32(par, 4));
  g.setAttribute('aCol', f32(col, 3)); g.setAttribute('aMov', f32(mov, 2));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({ ...ADD,
    uniforms: { uTime: { value: 0 }, uPix: { value: 0.001 }, uFog: { value: 0.03 }, uGain: { value: 0 }, uCam: { value: new THREE.Vector3() }, uTor: { value: new THREE.Vector2() } },
    vertexShader: /* glsl */`
      attribute vec2 aCorner, aMov; attribute vec4 aPar; attribute vec3 aCol;
      uniform float uTime, uPix, uFog, uGain; uniform vec3 uCam; uniform vec2 uTor;
      varying vec2 vC; varying vec3 vCol;
      void main(){
        vec3 wp = position + vec3(0.0, 0.0, aMov.x * (uTime - aMov.y));
        vec4 vp = viewMatrix * vec4(wp, 1.0);
        float dist = length(vp.xyz);
        float sz = aPar.x * 0.3;
        float w = max(sz, uPix * dist * 1.6);
        vp.xy += aCorner * w * 3.0;
        gl_Position = projectionMatrix * vp;
        float on = uTime < aPar.z ? 1.0 : 0.0;
        // lines arcing just before the power goes
        float pre = aPar.z - uTime;
        if (pre > 0.0 && pre < 0.35) on *= 0.35 + 1.3 * fract(sin(floor(uTime * 40.0) * 12.9898 + position.x * 78.2) * 43758.5);
        if (aPar.w > 0.5) on *= smoothstep(0.55, 0.75, sin(uTime * 4.2 + position.x * 40.0) * 0.5 + 0.5);
        // hidden behind the funnel and its debris cloud?
        vec2 a = uCam.xz, d = wp.xz - a;
        float u = clamp(dot(uTor - a, d) / dot(d, d), 0.0, 1.0);
        float miss = length(a + d * u - uTor);
        float hh = mix(uCam.y, wp.y, u);
        float R = max(0.034 + 0.34 * pow(clamp(hh / 0.80, 0.0, 1.0), 2.3), hh < 0.2 ? 0.20 : 0.0);
        float vis = u >= 1.0 ? 1.0 : smoothstep(R * 0.7, R * 1.4, miss);
        float e = sz / w;
        vCol = aCol * aPar.y * on * vis * uGain * e * e * exp(-uFog * dist);
        vC = aCorner * 3.0;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vC; varying vec3 vCol;
      void main(){
        float r2 = dot(vC, vC);
        float I = exp(-r2 * 2.2) * 30.0 + 0.10 / (1.0 + r2 * 5.0) * smoothstep(9.0, 2.0, r2);   // core + glare
        gl_FragColor = vec4(vCol * I, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
  return mesh;
}

// ---- rain / hail streaks --------------------------------------------------------------------
function makeStreaks(N = 1400) {
  const seed = [], end = [], side = [], idx = [];
  const r = rng(4242);
  for (let i = 0; i < N; i++) {
    const s = [r(), r(), r()];
    for (const [e, sd] of [[0, -1], [0, 1], [1, 1], [1, -1]]) { seed.push(...s); end.push(e); side.push(sd); }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', f32(seed, 3)); g.setAttribute('aEnd', f32(end, 1)); g.setAttribute('aSide', f32(side, 1));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({ ...ADD,
    uniforms: { uCam: { value: new THREE.Vector3() }, uStreak: { value: new THREE.Vector3() }, uBox: { value: 0.5 }, uPix: { value: 0.001 },
      uLight: { value: new THREE.Vector3() }, uW: { value: 0.00004 } },
    vertexShader: /* glsl */`
      attribute float aEnd, aSide;
      uniform vec3 uCam, uStreak, uLight; uniform float uBox, uPix, uW;
      varying vec3 vCol; varying float vSide;
      void main(){
        vec3 c = (fract(position - uCam / uBox) - 0.5) * uBox;
        vec4 vp = viewMatrix * vec4(uCam + c - uStreak * aEnd, 1.0);
        vec3 vt = normalize((viewMatrix * vec4(uStreak, 0.0)).xyz + vec3(1e-5, 0.0, 0.0));
        vec3 sd = normalize(cross(vt, vp.xyz));
        float dist = length(vp.xyz);
        float w = max(uW, uPix * dist * 0.8);
        vp.xyz += sd * aSide * w;
        gl_Position = projectionMatrix * vp;
        float fade = smoothstep(0.5, 0.25, length(c) / uBox) * smoothstep(0.0, 0.004, dist);
        vCol = uLight * fade * (uW / w) * (0.2 + 1.4 * pow(fract(position.x * 91.7), 3.0));
        vSide = aSide;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vSide;
      void main(){ gl_FragColor = vec4(vCol * exp(-3.0 * vSide * vSide), 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
  return mesh;
}

export function makeLights() {
  const group = new THREE.Group();
  const bolts = makeBolts(), lamps = makeLamps(), streaks = makeStreaks();
  group.add(lamps, bolts, streaks);
  // t, camera state, look state, pixel size, tornado position, light arriving at the lens (rgb)
  group.userData.update = (t, c, lk, pix, tor, lensLight) => {
    const bu = bolts.material.uniforms;
    BOLTS.forEach((B, i) => { bu.uI.value[i] = 26 * flashIntensity(B.flash, t) / B.flash.I; });
    bu.uPix.value = pix; bu.uFog.value = 0.02 + 1.3 * lk.inCloud;
    const lu = lamps.material.uniforms;
    lamps.visible = lk.lamps > 0.001;
    lu.uTime.value = t; lu.uPix.value = pix; lu.uFog.value = 0.05; lu.uGain.value = lk.lamps;
    lu.uCam.value.set(...c.pos); lu.uTor.value.set(tor.x, tor.z);
    const su = streaks.material.uniforms;
    streaks.visible = lk.streakGain > 0.001;
    su.uCam.value.set(...c.pos); su.uBox.value = lk.streakBox; su.uPix.value = pix;
    const sh = 1 / 50;                                   // shutter, seconds
    su.uStreak.value.set(c.vel[0] * sh, (c.vel[1] + 0.009) * sh, c.vel[2] * sh);
    su.uW.value = lk.below > 0.5 ? 0.000025 : 0.00006;
    su.uLight.value.set(...lensLight).multiplyScalar(lk.streakGain);
  };
  return group;
}
