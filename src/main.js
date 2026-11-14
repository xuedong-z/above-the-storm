// Boot, frame rendering, live playback, and deterministic frame-by-frame capture.
//   ?capture        render every frame offline and POST it to tools/server.mjs (-> mp4)
//   ?t=3.6          hold a single moment (for look-dev)
//   ?w=1920&h=1080  output size      ?spp=3  sub-frames per captured frame
import * as THREE from 'three';
import { makeNoise3D } from './noise.js';
import { makeSkyMaterial, MAX_FLASH } from './sky.js';
import { makeTLE } from './sprites.js';
import { Post } from './post.js';
import { DUR, FPS, FOV, CELLS, camera, activeFlashes } from './timeline.js';
import { renderAudio, wavBlob } from './audio.js';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const HOLD = Q.has('t') ? parseFloat(Q.get('t')) : null;
const W = +(Q.get('w') || (CAPTURE || Q.has('hq') ? 1920 : 1280)), H = +(Q.get('h') || (CAPTURE || Q.has('hq') ? 1080 : 720));
const HQ = CAPTURE || Q.has('hq');
const SPP = +(Q.get('spp') || (HQ ? 3 : 1));
let CLOUD_SCALE = +(Q.get('cs') || (HQ ? 1 : 0.5));
const msg = document.getElementById('msg');

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

const sky = makeSkyMaterial(makeNoise3D(96));
const su = sky.uniforms;
CELLS.forEach((c, i) => su.uCells.value[i].set(c.x, c.z, c.r, c.top));
su.uSteps.value = HQ ? 340 : 170;
su.uStepK.value = HQ ? 0.014 : 0.028;

const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.5, 4000);
const tanY = Math.tan(FOV * Math.PI / 360);
const pix = 2 * tanY / H;
const tleScene = new THREE.Scene();
const tle = makeTLE();
tleScene.add(tle);

const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
function renderHDR(t, seed, jx, jy) {
  const c = camera(t);
  cam.position.set(...c.pos);
  cam.lookAt(c.pos[0] + c.dir[0], c.pos[1] + c.dir[1], c.pos[2] + c.dir[2]);
  cam.updateMatrixWorld();
  cam.matrixWorld.extractBasis(_r, _u, _f);
  su.uCam.value.copy(cam.position); su.uRight.value.copy(_r); su.uUp.value.copy(_u); su.uFwd.value.copy(_f).negate();
  su.uRes.value.set(cloudRT.width, cloudRT.height);
  su.uJit.value.set(jx * 2, jy * 2);
  su.uTanY.value = tanY; su.uPix.value = pix / CLOUD_SCALE; su.uTime.value = t; su.uSeed.value = seed;
  const fl = activeFlashes(t, MAX_FLASH);
  for (let i = 0; i < MAX_FLASH; i++) {
    const a = fl[i];
    if (a) { su.uFlashP.value[i].set(a.f.x, a.f.y, a.f.z, a.I); su.uFlashC.value[i].set(...a.f.col); }
    else su.uFlashP.value[i].set(0, 0, 0, 0);
  }
  post.pass(sky, cloudRT);
  post.blit(cloudRT.texture, hdrRT);
  cam.setViewOffset(W, H, -jx, jy, W, H);          // same sub-pixel jitter for the geometry
  tle.userData.update(t, cam.position, pix);
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
post.final.uniforms.uExposure.value = +(Q.get('ev') || 1.0);
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
  let t0 = performance.now(), audioCtx = null, buf = null, src = null;
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
  const LEVELS = [[0.5, 170, 0.028], [0.42, 120, 0.038], [0.34, 84, 0.052], [0.25, 60, 0.07]];
  let level = 0, acc = 0, cnt = 0, prev = performance.now();
  const adapt = () => {
    const now = performance.now(); acc += now - prev; prev = now;
    if (++cnt < 40) return;
    const ms = acc / cnt; acc = 0; cnt = 0;
    if (ms > 40 && level < LEVELS.length - 1 && !Q.has('cs')) {
      const [cs, steps, k] = LEVELS[++level];
      CLOUD_SCALE = cs; cloudRT.setSize(Math.round(W * cs), Math.round(H * cs));
      su.uSteps.value = steps; su.uStepK.value = k;
    }
  };
  let last = -1;
  const tick = () => {
    if (HOLD === null) adapt();
    let t = HOLD !== null ? HOLD : (performance.now() - t0) / 1000;
    if (t >= DUR) { t0 = performance.now(); t = 0; restartAudio(); }
    if (HOLD === null || last !== HOLD) renderFrame(t);
    last = t;
    requestAnimationFrame(tick);
  };
  tick();
}

if (CAPTURE) capture(); else live();
