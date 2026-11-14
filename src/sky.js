// Full-screen ray-march: night sky (stars, airglow, limb haze) + volumetric thunderstorm deck
// lit by moonlight and by lightning flashing inside the cloud. World units are kilometres.
import * as THREE from 'three';

export const MAX_CELLS = 8, MAX_FLASH = 10;

export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec3 uCam, uRight, uUp, uFwd, uMoonDir;
uniform vec2 uRes, uJit;
uniform float uTanY, uTime, uSeed, uPix, uStepK;
uniform int uSteps;
uniform vec4 uCells[${MAX_CELLS}];      // x, z, radius, top altitude
uniform vec4 uFlashP[${MAX_FLASH}];     // x, altitude, z, intensity
uniform vec3 uFlashC[${MAX_FLASH}];
varying vec2 vUv;

const float RE = 6371.0, TOP = 18.5, BOT = 8.5, SIG = 2.6;
const vec3 MOON = vec3(0.034, 0.050, 0.088);
const vec3 AMB  = vec3(0.0016, 0.0026, 0.0052);
const vec3 HAZE = vec3(0.0050, 0.0085, 0.0150);

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

// macro shape: anvil deck + convective domes over each storm cell
float shape(vec3 p, float h){
  float cov  = textureLod(uNoise, vec3(p.x * 0.0031, 0.21, p.z * 0.0031), 0.0).r;
  float cov2 = textureLod(uNoise, vec3(p.x * 0.0110, 0.63, p.z * 0.0110), 0.0).r;
  float topH = 10.4 + 2.6 * cov + 1.0 * cov2;
  float inf = 0.0;
  for (int i = 0; i < ${MAX_CELLS}; i++){
    vec4 c = uCells[i];
    if (c.z <= 0.0) continue;
    float r = length(p.xz - c.xy) / c.z;
    float dome = c.w - (c.w - 11.5) * r * r;
    float anv  = 13.6 - 2.8 * smoothstep(1.2, 3.4, r);
    topH = max(topH, max(dome, anv));
    inf = max(inf, smoothstep(3.4, 1.4, r));
  }
  // convective turrets punching through the deck around active cells
  float tw = textureLod(uNoise, vec3(p.x * 0.021, 0.5, p.z * 0.021), 0.0).g;
  float tw2 = textureLod(uNoise, vec3(p.x * 0.052, 0.13, p.z * 0.052), 0.0).g;
  topH += (2.6 * smoothstep(0.42, 0.85, tw) + 1.1 * smoothstep(0.4, 0.8, tw2)) * (0.25 + 0.75 * inf);
  float covm = smoothstep(0.44, 0.58, cov + inf * 0.45);
  return smoothstep(0.0, 2.6, topH - h) * smoothstep(BOT, BOT + 1.5, h) * covm;
}

float density(vec3 p, float h, float lod, bool detail){
  if (h < BOT || h > TOP) return 0.0;
  float s = shape(p, h);
  if (s < 0.002) return 0.0;
  vec3 q = p * 0.085 + vec3(uTime * 0.0015, 0.0, 0.0);
  float n = textureLod(uNoise, q, lod).r;
  if (detail) n = n * 0.66 + 0.24 * textureLod(uNoise, q * 2.9 + 0.31, lod + 1.5).r + 0.10 * textureLod(uNoise, q * 8.3 + 0.67, lod + 3.0).r;
  float d = s - (1.0 - n) * 0.80;
  if (d <= 0.0) return 0.0;
  if (detail){
    float g = textureLod(uNoise, p * 0.27, lod + 1.0).g;
    d -= g * 0.30 * (1.0 - smoothstep(0.0, 0.6, d));
  }
  return smoothstep(0.0, 0.30, d) * SIG;
}

vec3 stars(vec3 rd){
  vec3 col = vec3(0.0);
  for (int L = 0; L < 3; L++){
    float sc = L == 0 ? 60.0 : (L == 1 ? 140.0 : 300.0);
    vec3 q = rd * sc, id = floor(q), f = fract(q);
    vec3 h = hash33(id + float(L) * 17.0);
    vec3 sp = 0.2 + 0.6 * hash33(id * 1.7 + 3.1);
    float d = length(f - sp);
    float rad = max(0.022, 0.9 * uPix * sc);
    float b = pow(h.x, 16.0) * (L == 0 ? 40.0 : (L == 1 ? 13.0 : 4.0));
    b *= (0.022 * 0.022) / (rad * rad);
    vec3 tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.68, 0.80, 1.0), h.y);
    col += tint * b * smoothstep(rad, 0.0, d);
  }
  return col;
}

vec3 sky(vec3 rd){
  float dip = 0.081;                                   // horizon dip from ~21 km, radians
  float el = asin(clamp(rd.y, -1.0, 1.0)) + dip;       // elevation above the true horizon
  float e = max(el, 0.0);
  // airglow shell at ~90 km, brightening toward the horizon (van Rhijn)
  float sz = cos(e);
  float k = RE / (RE + 90.0);
  float vr = 1.0 / sqrt(max(1.0 - k * k * sz * sz, 0.012));
  vec3 glow = vec3(0.10, 0.62, 0.26) * 0.0024 * vr + vec3(0.55, 0.10, 0.06) * 0.0004 * vr * vr * 0.25;
  // thin moonlit lower atmosphere hugging the limb
  vec3 limb = vec3(0.016, 0.032, 0.070) * exp(-e * 22.0) + vec3(0.004, 0.008, 0.018) * exp(-e * 5.0);
  // faint milky way band
  float mw = textureLod(uNoise, rd * 1.3 + 0.37, 1.0).r;
  float band = exp(-pow(dot(rd, normalize(vec3(0.35, 0.55, -0.76))) * 3.2, 2.0));
  vec3 milky = vec3(0.010, 0.011, 0.016) * band * smoothstep(0.35, 0.8, mw);
  float ext = 1.0 - exp(-e * 14.0);
  return glow + limb + (stars(rd) + milky) * ext;
}

void main(){
  vec2 ndc = (vUv * 2.0 - 1.0) + uJit / uRes;
  vec3 rd = normalize(uFwd + ndc.x * uTanY * (uRes.x / uRes.y) * uRight + ndc.y * uTanY * uUp);

  // altitude along the ray on a curved earth: h(t) = cam.y + t*rd.y + a*t^2
  float a = (1.0 - rd.y * rd.y) / (2.0 * RE), b = rd.y;
  vec3 bg = sky(rd);
  float discG = b * b - 4.0 * a * uCam.y;
  if (b < 0.0 && discG > 0.0) bg = vec3(0.0012, 0.0020, 0.0038);       // unlit ground through gaps

  float T = 1.0; vec3 L = vec3(0.0);
  float cT = uCam.y - TOP;
  float disc = b * b - 4.0 * a * cT;
  if (b < 0.0 && disc > 0.0){
    float sq = sqrt(disc);
    float t = 2.0 * cT / (-b + sq);
    float tEnd = min((-b + sq) / (2.0 * a), 650.0);
    float cB = uCam.y - BOT, discB = b * b - 4.0 * a * cB;
    if (discB > 0.0) tEnd = min(tEnd, 2.0 * cB / (-b + sqrt(discB)));
    float j = hash12(gl_FragCoord.xy + uSeed * 17.13);
    t += max(0.10, t * uStepK) * j;
    for (int i = 0; i < uSteps; i++){
      if (t > tEnd || T < 0.012) break;
      float dt = max(0.10, t * uStepK);
      vec3 p = uCam + rd * t;
      float h = uCam.y + t * b + a * t * t;
      float lod = clamp(log2(t * uPix * 9.0), 0.0, 5.0);
      float d = density(p, h, lod, true);
      if (d > 0.0){
        // moonlight: short shadow march
        float od = 0.0, ls = 0.35; vec3 lp = p; float lh = h;
        for (int k = 0; k < 4; k++){
          lp += uMoonDir * ls; lh += uMoonDir.y * ls;
          od += density(lp, lh, lod + 1.0, false) * ls; ls *= 1.9;
        }
        vec3 S = MOON * (exp(-od * 0.9) + 0.25 * exp(-od * 0.18)) + AMB * smoothstep(BOT, TOP, h);
        // lightning glowing through the cloud body
        vec3 ph = vec3(p.x, h, p.z);
        for (int f = 0; f < ${MAX_FLASH}; f++){
          vec4 fp = uFlashP[f];
          if (fp.w <= 0.0) continue;
          vec3 v = fp.xyz - ph; float d2 = dot(v, v);
          S += uFlashC[f] * vec3(0.80, 0.86, 1.0) * fp.w * 0.32 * exp(-sqrt(d2) * 0.22) / (d2 + 9.0);
        }
        float st = exp(-d * dt);
        L += T * (1.0 - st) * mix(HAZE, S, exp(-t * 0.0045));
        T *= st;
      }
      t += dt;
    }
  }
  gl_FragColor = vec4(L + T * bg, 1.0);
}`;

export function makeSkyMaterial(noiseTex) {
  const v3 = () => new THREE.Vector3();
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      uNoise: { value: noiseTex },
      uCam: { value: v3() }, uRight: { value: v3() }, uUp: { value: v3() }, uFwd: { value: v3() },
      uMoonDir: { value: new THREE.Vector3(-0.80, 0.24, -0.50).normalize() },
      uRes: { value: new THREE.Vector2(1, 1) }, uJit: { value: new THREE.Vector2() },
      uTanY: { value: 0.3 }, uTime: { value: 0 }, uSeed: { value: 0 }, uPix: { value: 0.001 },
      uStepK: { value: 0.03 }, uSteps: { value: 160 },
      uCells: { value: Array.from({ length: MAX_CELLS }, () => new THREE.Vector4()) },
      uFlashP: { value: Array.from({ length: MAX_FLASH }, () => new THREE.Vector4()) },
      uFlashC: { value: Array.from({ length: MAX_FLASH }, () => v3()) },
    },
  });
}
