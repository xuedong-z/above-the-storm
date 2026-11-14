// Boot, frame rendering, live playback, and deterministic frame-by-frame capture.
//   ?capture        render every frame offline and POST it to tools/server.mjs (-> mp4)
//   ?t=3.6          hold a single moment (for look-dev)
//   ?w=1920&h=1080  output size      ?spp=3  sub-frames per captured frame
import * as THREE from 'three';
import { makeNoise3D } from './noise.js';
import { makeWorldMaterial, MAX_FLASH, MAX_LAMP } from './world.js';
import { makeTLE } from './sprites.js';
import { makeLights } from './lights.js';
import { Post } from './post.js';
import { DUR, FPS, CELLS, MAIN_CELL, RAIN, ELEVATOR, FARMS, TOWN, LAMPS, CARS, carPos, camera, look, tornado, activeFlashes } from './timeline.js';
import { renderAudio, wavBlob } from './audio.js';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const HOLD = Q.has('t') ? parseFloat(Q.get('t')) : null;
const W = +(Q.get('w') || (CAPTURE || Q.has('hq') ? 1920 : 1280)), H = +(Q.get('h') || (CAPTURE || Q.has('hq') ? 1080 : 720));
const HQ = CAPTURE || Q.has('hq');
const SPP = +(Q.get('spp') || (HQ ? 3 : 1));
let CLOUD_SCALE = +(Q.get('cs') || (HQ ? 1 : 0.5));
const msg = document.getElementById('msg');
const EV = +(Q.get('ev') || 1.0);
let STEP_SCALE = HQ ? 1 : 1.6;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.autoClear = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const post = new Post(renderer, W, H);
const cloudRT = post.rt(W * CLOUD_SCALE, H * CLOUD_SCALE);
const hdrRT = post.rt(W, H);
const accumRT = SPP > 1 ? post.rt(W, H) : null;
// live playback has one sample per frame: average the cloud layer over the last few frames instead
const TEMPORAL = SPP === 1 && !Q.has('raw');
let hist = TEMPORAL ? [post.rt(W * CLOUD_SCALE, H * CLOUD_SCALE), post.rt(W * CLOUD_SCALE, H * CLOUD_SCALE)] : null, histOK = false;

const sky = makeWorldMaterial(makeNoise3D(96));
const su = sky.uniforms;
CELLS.forEach((c, i) => su.uCells.value[i].set(c.x, c.z, c.r, c.top));
su.uSteps.value = HQ ? 420 : 190;
FARMS.forEach((f, i) => su.uFarms.value[i].set(...f));
su.uMain.value.set(MAIN_CELL.x, MAIN_CELL.z, MAIN_CELL.r);
su.uRain.value.set(RAIN.x, RAIN.z, RAIN.r);
su.uElev.value.set(ELEVATOR.x, ELEVATOR.z);
su.uStepK.value = HQ ? 0.014 : 0.028;

const cam = new THREE.PerspectiveCamera(50, W / H, 0.0005, 4000);
const tleScene = new THREE.Scene();
const tle = makeTLE();
tleScene.add(tle);
const lights = makeLights();
tleScene.add(lights);

// lamps bright enough to throw a pool of light on the ground (the rest are sprites only)
const POOL = LAMPS.filter(l => l[4] >= 0.9 && l[9] === 0 && Math.abs(l[0]) < 1.0);
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Matrix4();
let pix = 0.001;
function renderHDR(t, seed, jx, jy) {
  const c = camera(t), lk = look(t);
  // orientation from yaw / pitch / roll
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  _f.set(Math.sin(c.yaw) * cp, sp, -Math.cos(c.yaw) * cp);
  const r0 = new THREE.Vector3(Math.cos(c.yaw), 0, Math.sin(c.yaw));
  const u0 = new THREE.Vector3().crossVectors(r0, _f);
  const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
  _r.copy(r0).multiplyScalar(cr).addScaledVector(u0, sr);
  _u.copy(u0).multiplyScalar(cr).addScaledVector(r0, -sr);
  cam.position.set(...c.pos);
  cam.quaternion.setFromRotationMatrix(_m.makeBasis(_r, _u, _f.clone().negate()));
  cam.fov = c.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  const tanY = Math.tan(c.fov * Math.PI / 360);
  pix = 2 * tanY / H;
  su.uCam.value.copy(cam.position); su.uRight.value.copy(_r); su.uUp.value.copy(_u); su.uFwd.value.copy(_f);
  su.uRes.value.set(cloudRT.width, cloudRT.height);
  su.uJit.value.set(jx * 2, jy * 2);
  su.uTanY.value = tanY; su.uPix.value = pix / CLOUD_SCALE; su.uTime.value = t; su.uSeed.value = seed;
  su.uMinStep.value = Math.min(lk.minStep, 0.10 - 0.05 * lk.inCloud) * STEP_SCALE;
  su.uGlow.value = lk.inCloud;
  const tp = tornado(t);
  su.uTor.value.set(tp.x, tp.z, 1);
  // lightning; the last slot is the glow of the town on the cloud base
  const fl = activeFlashes(t, MAX_FLASH - 1, c.pos);
  for (let i = 0; i < MAX_FLASH - 1; i++) {
    const a = fl[i];
    if (a) { su.uFlashP.value[i].set(a.f.x, a.f.y, a.f.z, a.I); su.uFlashC.value[i].set(...a.f.col, a.f.soft); }
    else su.uFlashP.value[i].set(0, 0, 0, 0);
  }
  let on = 0, tot = 0;
  for (const l of LAMPS) if (l[8] < 90) { tot++; if (t < l[8]) on++; }
  su.uFlashP.value[MAX_FLASH - 1].set(TOWN.x, 0.06, TOWN.z, 0.55 * lk.lamps * on / tot + 1e-6);
  su.uFlashC.value[MAX_FLASH - 1].set(1.0, 0.56, 0.22, 0.25);
  // nearest lamps as real lights
  if (c.pos[1] < 1.5) {
    const cars = CARS.map(k => { const [x, z] = carPos(k, t); return [x, 0.004, z + 0.022, 0, 1.6, 0.85, 0.92, 1.0, 99, 0]; });
    const near = POOL.concat(cars).filter(l => t < l[8]).map(l => [l, (l[0] - c.pos[0]) ** 2 + (l[2] - c.pos[2] + 0.15) ** 2]).sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < MAX_LAMP; i++) {
      const l = near[i] && near[i][0];
      if (l) { su.uLampP.value[i].set(l[0], l[1], l[2], l[4] * lk.lamps); su.uLampC.value[i].set(l[5], l[6], l[7]); }
      else su.uLampP.value[i].set(0, 0, 0, 0);
    }
  } else for (let i = 0; i < MAX_LAMP; i++) su.uLampP.value[i].set(0, 0, 0, 0);
  post.final.uniforms.uExposure.value = EV * lk.exposure;
  post.pass(sky, cloudRT);
  let clouds = cloudRT;
  if (TEMPORAL) {
    const k = histOK ? 0.45 : 1;
    post.blit(cloudRT.texture, hist[1], k);
    if (histOK) post.blit(hist[0].texture, hist[1], 1 - k, true);
    hist.reverse(); histOK = true; clouds = hist[0];
  }
  post.blit(clouds.texture, hdrRT);
  cam.setViewOffset(W, H, -jx, jy, W, H);          // same sub-pixel jitter for the geometry
  tle.visible = lk.tle > 0.01;
  if (tle.visible) tle.userData.update(t, cam.position, pix);
  // lightning as seen on the droplets right in front of the lens
  const ll = [0.004, 0.005, 0.007];
  for (const a of fl) {
    const d2 = (a.f.x - c.pos[0]) ** 2 + (a.f.y - c.pos[1]) ** 2 + (a.f.z - c.pos[2]) ** 2;
    const inC = a.f.y > 2, k = a.I * 0.32 * Math.exp(-Math.sqrt(d2) * (inC ? 0.22 : 0.05)) * (inC && c.pos[1] < 1.2 ? 0.1 : 1) / (d2 + a.f.soft);
    for (let i = 0; i < 3; i++) ll[i] += a.f.col[i] * k;
  }
  lights.userData.update(t, c, lk, pix, tp, ll.map(v => v * 0.8));
  renderer.setRenderTarget(hdrRT);
  renderer.render(tleScene, cam);
  cam.clearViewOffset();
}

let frameNo = 0;
function renderFrame(t) {
  frameNo++;
  if (SPP > 1) {
    renderer.setRenderTarget(accumRT); renderer.clear();
    for (let k = 0; k < SPP; k++) {
      // halton sub-pixel jitter + shutter spread over half a frame (motion blur)
      const jx = ((k * 0.5 + 0.25) % 1) - 0.5, jy = ((k * 0.3333 + 0.4) % 1) - 0.5;
      renderHDR(t + (k / SPP) * 0.5 / FPS, frameNo * 7 + k, jx, jy);
      post.blit(hdrRT.texture, accumRT, 1 / SPP, true);
    }
    post.finish(accumRT, frameNo);
  } else {
    renderHDR(t, frameNo, 0, 0);
    post.finish(hdrRT, frameNo);
  }
}
post.final.uniforms.uGrain.value = HQ ? 0.014 : 0.005;
post.final.uniforms.uBloom.value = +(Q.get('bloom') || 0.55);
window.__seek = t => { renderFrame(t); return t; };

async function capture() {
  document.getElementById('hud').style.display = 'none';
  const post1 = (url, body) => fetch(url, { method: 'POST', body });
  const from = +(Q.get('from') || 0), to = +(Q.get('to') || DUR * FPS);
  if (from === 0) {
    msg.textContent = 'rendering audio';
    await post1('/capture/audio', wavBlob(await renderAudio()));
  }
  const gl = renderer.getContext();
  for (let f = from; f < to; f++) {
    renderFrame(f / FPS);
    gl.finish();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    await post1('/capture/frame/' + f, blob);
    msg.textContent = `frame ${f + 1}/${DUR * FPS}`;
    window.__progress = f + 1;
  }
  if (to >= DUR * FPS) {
    msg.textContent = 'encoding';
    const res = await (await post1(`/capture/finish?fps=${FPS}`, '')).text();
    msg.textContent = res; window.__done = res;
  } else window.__done = 'partial';
}

function live() {
  const START = +(Q.get('start') || 0);
  let t0 = performance.now() - START * 1000, audioCtx = null, buf = null, src = null;
  const restartAudio = () => {
    if (!audioCtx || !buf) return;
    if (src) src.stop();
    src = audioCtx.createBufferSource(); src.buffer = buf; src.connect(audioCtx.destination); src.start();
  };
  msg.textContent = HOLD === null ? 'click for sound' : `t = ${HOLD}`;
  addEventListener('click', async () => {
    if (audioCtx) return;
    audioCtx = new AudioContext({ sampleRate: 48000 });
    buf = await renderAudio(); t0 = performance.now(); restartAudio(); msg.textContent = '';
  });
  // adaptive quality: if the machine can't hold ~30 fps, march fewer steps at lower resolution
  const LEVELS = [[0.5, 190, 0.028], [0.42, 140, 0.038], [0.34, 100, 0.052], [0.25, 72, 0.07]];
  let level = 0, win = 0, acc = 0, cnt = 0, prev = performance.now();
  const adapt = () => {
    const now = performance.now(); acc += now - prev; prev = now;
    if (++cnt < 40) return;
    const ms = acc / cnt; acc = 0; cnt = 0;
    window.__ms = ms; window.__level = level;
    if (++win < 3) return;                             // ignore shader-compile hitches at start
    if (ms > 40 && level < LEVELS.length - 1 && !Q.has('cs')) {
      const [cs, steps, k] = LEVELS[++level];
      CLOUD_SCALE = cs; cloudRT.setSize(Math.round(W * cs), Math.round(H * cs));
      if (hist) { hist.forEach(h => h.setSize(cloudRT.width, cloudRT.height)); histOK = false; }
      su.uSteps.value = steps; su.uStepK.value = k; STEP_SCALE = 1.6 * k / 0.028;
    }
  };
  let last = -1, settle = 0;
  const tick = () => {
    if (HOLD === null) adapt();
    let t = HOLD !== null ? HOLD : (performance.now() - t0) / 1000;
    if (t >= DUR) { t0 = performance.now(); t = 0; restartAudio(); }
    if (HOLD === null || last !== HOLD || settle++ < 24) renderFrame(t);
    last = t;
    requestAnimationFrame(tick);
  };
  tick();
}

if (CAPTURE) capture(); else live();
