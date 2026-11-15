// The figure on the road: a hand-drawn-style (cel) character, not a 3D model. She is a flat drawing standing in
// the world, built from 2D distance fields: flat colour fills, one hard shadow tone, ink lines, and a rim light
// that follows the lightning. Hair and coat are animated by the inflow wind.
import * as THREE from 'three';
import { FS_VERT } from './world.js';

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec3 uRel, uRight, uUp, uFwd;        // figure position minus camera (km), camera basis
uniform vec2 uRes, uJit;
uniform float uTanY, uTime, uDebug, uWet;
uniform vec3 uAmb, uKeyC, uWarmC;            // light on the fills, lightning rim, warm rim from the town
uniform vec2 uKeyD, uDbgC;                          // direction to the lightning in the drawing's plane

float PW;                                    // size of a pixel in metres
float aa(float d){ return clamp(0.5 - d / PW, 0.0, 1.0); }
float seg(vec2 p, vec2 a, vec2 b, float ra, float rb){
  vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float ell(vec2 p, vec2 r){ float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-4); }
// distance to a quadratic Bezier, and the parameter of the closest point (after Inigo Quilez)
vec2 bez(vec2 pos, vec2 A, vec2 B, vec2 C){
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b), kx = kk * dot(a, b), ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0, kz = kk * dot(d, a);
  float p = ky - kx * kx, p3 = p * p * p, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz, h = q * q + 4.0 * p3, res, tt;
  if (h >= 0.0){
    h = sqrt(h); vec2 x = (vec2(h, -h) - q) / 2.0; vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    tt = clamp(uv.x + uv.y - kx, 0.0, 1.0); vec2 qq = d + (c + b * tt) * tt; res = dot(qq, qq);
  } else {
    float z = sqrt(-p), v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0, m = cos(v), n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    vec2 qx = d + (c + b * t.x) * t.x, qy = d + (c + b * t.y) * t.y; float dx = dot(qx, qx), dy = dot(qy, qy);
    if (dx < dy){ res = dx; tt = t.x; } else { res = dy; tt = t.y; }
  }
  return vec2(sqrt(res), tt);
}

// ---- hair: locks streaming downwind (+x) ---------------------------------------------------
const int NL = 11;
const vec4 LK[NL] = vec4[NL](              // root x, y, length, angle (deg, 0 = downwind)
  vec4(-0.070, 1.335, 0.40, -50.0), vec4(-0.030, 1.322, 0.56, -40.0), vec4(0.015, 1.326, 0.70, -31.0),
  vec4(0.050, 1.352, 0.86, -24.0), vec4(0.072, 1.398, 0.98, -17.0), vec4(0.082, 1.450, 0.90, -11.0),
  vec4(0.072, 1.505, 0.96, -6.0), vec4(0.040, 1.552, 0.74, -1.0), vec4(0.085, 1.478, 0.60, -9.0),
  vec4(0.060, 1.380, 0.54, -27.0), vec4(-0.010, 1.578, 0.46, 5.0));
const float LW0[NL] = float[NL](0.058, 0.070, 0.080, 0.088, 0.090, 0.088, 0.080, 0.062, 0.040, 0.042, 0.034);
float lockD(vec2 p, int i, out float tt){
  vec4 k = LK[i]; float fi = float(i);
  float ph = uTime * 6.2 + fi * 1.9, an = radians(k.w) + 0.10 * sin(ph * 0.63 + 1.0) + 0.05 * sin(uTime * 2.1 + fi);
  vec2 A = k.xy, dir = vec2(cos(an), sin(an)), nrm = vec2(-dir.y, dir.x);
  vec2 C = A + dir * k.z + nrm * (0.075 * sin(ph) + 0.035 * sin(ph * 1.83 + fi));
  vec2 B = A + dir * k.z * 0.45 + nrm * (0.075 * sin(ph - 1.5) + 0.085 + 0.006 * fi);
  vec2 r = bez(p, A, B, C); tt = r.y;
  float w = LW0[i] * pow(1.0 - r.y, 0.62) * (1.0 + 0.25 * sin(r.y * 9.0 + fi * 2.0 - uTime * 7.0) * r.y) + 0.001;
  return r.x - w;
}
float sheetD(vec2 p){
  float ph = uTime * 6.2;
  vec2 A = vec2(0.02, 1.43), C = vec2(0.66, 1.24 + 0.05 * sin(ph + 0.7)), B = vec2(0.34, 1.44 + 0.05 * sin(ph - 0.9));
  vec2 r = bez(p, A, B, C);
  return r.x - (0.135 - 0.05 * r.y) * smoothstep(1.0, 0.80, r.y) - 0.012 * sin(r.y * 14.0 - uTime * 8.0) * r.y;
}
const vec2 HC = vec2(0.0, 1.452);
const vec2 HR = vec2(0.124, 0.134);
float headD(vec2 p){ return ell(p - HC, HR); }
float hairD(vec2 p){
  float d = min(headD(p), sheetD(p)), tt;
  for (int i = 0; i < NL; i++) d = min(d, lockD(p, i, tt));
  return d;
}

// ---- raincoat, limbs -----------------------------------------------------------------------
float coatS(float y){ return clamp((1.31 - y) / 0.69, 0.0, 1.0); }
float coatCx(float y){ float s = coatS(y); return 0.10 * s * s + 0.014 * s * sin(uTime * 6.5 - y * 9.0); }
float hemY(vec2 p){
  float x = p.x - 0.10;
  return 0.615 + 0.030 * sin(x * 13.0 - uTime * 8.0) + 0.016 * sin(x * 29.0 - uTime * 13.0 + 1.0) + 0.16 * max(x, 0.0) + 0.05 * max(x - 0.2, 0.0);
}
float coatD(vec2 p){
  float s = coatS(p.y), x = p.x - coatCx(p.y);
  float hwR = mix(0.176, 0.34, pow(s, 1.25)) + 0.016 * s * s * sin(p.y * 24.0 + uTime * 10.0);
  float hwL = mix(0.176, 0.235, s);
  float dx = x > 0.0 ? x - hwR : -x - hwL;
  float top = p.y - 1.322 + 1.9 * p.x * p.x;
  return max(dx * 0.93, max(top, (hemY(p) - p.y) * 0.9));
}
float hoodD(vec2 p){ vec2 q = p - vec2(0.012, 1.305); q.y += 0.6 * q.x * q.x; return ell(q, vec2(0.150, 0.068)); }
float legD(vec2 p, float sx){ return seg(p, vec2(sx * 0.078, 0.72), vec2(sx * 0.092 - 0.004, 0.30), 0.066, 0.046); }
float bootD(vec2 p, float sx){
  vec2 c = vec2(sx * 0.093 - 0.004, 0.0);
  float d = seg(p, c + vec2(0.0, 0.33), c + vec2(0.0, 0.06), 0.062, 0.055);
  d = min(d, ell(p - c - vec2(sx * 0.006, 0.048), vec2(0.070, 0.052)));
  return max(max(d, -p.y), p.y - 0.345 - 0.10 * sx * (p.x - c.x));
}
float armRD(vec2 p){ float sw = 0.012 * sin(uTime * 5.0); return seg(p, vec2(0.180, 1.255), vec2(0.268 + sw, 0.880), 0.062, 0.066); }
float handRD(vec2 p){ float sw = 0.012 * sin(uTime * 5.0); return ell(p - vec2(0.280 + sw, 0.800), vec2(0.032, 0.050)); }
float armLD(vec2 p){
  return min(seg(p, vec2(-0.170, 1.255), vec2(-0.330, 1.120), 0.064, 0.062), seg(p, vec2(-0.330, 1.120), vec2(-0.205, 1.400), 0.062, 0.058));
}
float handLD(vec2 p){ vec2 q = p - vec2(-0.150, 1.462); q = vec2(q.x * 0.9 + q.y * 0.45, q.y * 0.9 - q.x * 0.45); return ell(q, vec2(0.050, 0.034)); }

float sil(vec2 p){
  float d = min(coatD(p), hoodD(p));
  d = min(d, min(bootD(p, -1.0), bootD(p, 1.0)));
  d = min(d, min(legD(p, -1.0), legD(p, 1.0)));
  d = min(d, min(min(armRD(p), handRD(p)), armLD(p)));
  return min(d, hairD(p));
}

// colours of the drawing (albedo); the second tone of each is its shadow colour
const vec3 COAT = vec3(1.00, 0.72, 0.09), COAT_S = vec3(0.70, 0.40, 0.13);
const vec3 SKIN = vec3(1.00, 0.76, 0.64), SKIN_S = vec3(0.62, 0.38, 0.40);
const vec3 HAIR = vec3(0.105, 0.085, 0.13), HAIR_S = vec3(0.045, 0.040, 0.075), HAIR_H = vec3(0.36, 0.40, 0.62);
const vec3 BOOT = vec3(0.10, 0.14, 0.34), BOOT_S = vec3(0.045, 0.06, 0.17);
const float LW = 0.0032;

vec3 C; float A, LA;
void layer(float d, vec3 col, vec3 line){
  float f = aa(d); C = mix(C, col, f); A = max(A, f);
  float l = aa(abs(d) - LW) * LA; C = mix(C, line, l); A = max(A, l);
}
void stroke(float d, vec3 line, float w){ C = mix(C, line, aa(d - w) * LA * step(0.5, A)); }

vec4 paint(vec2 p){
  C = vec3(0.0); A = 0.0; LA = clamp(2.0 * LW / PW, 0.0, 1.0);
  // raised left arm (behind everything)
  { float d = armLD(p); float sh = aa(-(p.x + 0.30) + 0.05 * (p.y - 1.2));
    layer(d, mix(COAT, COAT_S, max(sh, aa(1.18 - p.y + 0.2 * (p.x + 0.3)))), COAT_S * 0.30); }
  // legs and boots
  for (int k = 0; k < 2; k++){
    float sx = k == 0 ? -1.0 : 1.0, cx = sx * 0.088;
    float sh = max(aa(hemY(p) - 0.085 - p.y + 0.02 * sin(p.x * 40.0)), aa(p.x - cx + 0.012));
    layer(legD(p, sx), mix(SKIN, SKIN_S, sh), SKIN_S * 0.35);
    float bd = bootD(p, sx);
    layer(bd, mix(BOOT, BOOT_S, aa(p.x - cx + 0.010)), BOOT_S * 0.3);
    C = mix(C, HAIR_H * 0.9, aa(abs(p.x - cx - 0.034) - 0.005) * aa(bd + 0.012) * aa(abs(p.y - 0.20) - 0.085));   // gloss on rubber
  }
  // raincoat
  {
    float d = coatD(p), s = coatS(p.y), x = p.x - coatCx(p.y), hy = hemY(p);
    float side = aa(x + 0.085 + 0.018 * sin(p.y * 17.0 + 1.0) + 0.03 * s);                       // the side away from the light
    float fold = sin(x * 34.0 + s * 2.5 + 0.7 * sin(uTime * 5.0 + x * 8.0));
    float topF = hy + 0.10 + 0.20 * (0.5 + 0.5 * sin(x * 19.0 + 2.0)) + 0.10 * max(x, 0.0);
    float folds = aa(max((0.45 - fold) * 0.014, (p.y - topF) * (0.6 + 0.4 * fold)));
    float under = aa(hoodD(p + vec2(-0.010, 0.040)));                                           // cast by the hood
    float hairSh = aa(hairD(p + vec2(-0.010, 0.035)));                                          // cast by the hair
    float sh = max(max(side, folds), max(under, hairSh));
    layer(d, mix(COAT, COAT_S, sh), COAT_S * 0.30);
    stroke(abs(x + 0.004) + max(p.y - 1.22, 0.0) + max(hy + 0.02 - p.y, 0.0), COAT_S * 0.38, 0.0018);   // back seam
    stroke(abs(p.y - hy - 0.030) + max(-d - 0.2, 0.0), COAT_S * 0.45, 0.0014);                          // hem stitch
  }
  // hanging right arm
  { layer(handRD(p), mix(SKIN, SKIN_S, aa(p.x - 0.268)), SKIN_S * 0.35);
    float d = armRD(p), ax = p.x - mix(0.180, 0.268, clamp((1.255 - p.y) / 0.375, 0.0, 1.0));
    layer(d, mix(COAT, COAT_S, max(aa(ax + 0.006), aa(hairD(p + vec2(-0.015, 0.060))))), COAT_S * 0.30);
    stroke(abs(p.y - 0.850 - 0.2 * ax) + max(d, 0.0) * 4.0, COAT_S * 0.4, 0.0016); }
  // hood lying on the shoulders
  { float d = hoodD(p); vec2 q = p - vec2(0.012, 1.305);
    layer(d, mix(COAT, COAT_S, max(aa(q.x + 0.045 + 0.3 * q.y), aa(hairD(p + vec2(-0.010, 0.035))))), COAT_S * 0.30);
    stroke(abs(ell(q - vec2(0.0, 0.012), vec2(0.105, 0.040))) + max(q.y - 0.01, 0.0) * 3.0, COAT_S * 0.42, 0.0015); }
  // hair
  {
    vec2 q = (p - HC) / HR; float rr = length(q), ang = atan(q.x, q.y);
    float band = aa((abs(rr - 0.60 - 0.035 * sin(ang * 23.0) - 0.02 * sin(ang * 57.0)) - 0.075) * 0.11) * aa((abs(ang - 0.55) - 1.05) * 0.1);
    float shade = aa(q.x * 0.124 + 0.034 + 0.012 * sin(p.y * 60.0));
    layer(sheetD(p), HAIR_S, HAIR_S * 0.25);
    layer(headD(p), mix(mix(HAIR, HAIR_S, shade), HAIR_H, band * (1.0 - shade)), HAIR_S * 0.25);
    for (int i = 0; i < NL; i++){
      float tt, d = lockD(p, i, tt);
      float hl = aa(abs(d + LW0[i] * 0.62 * (1.0 - tt)) - 0.006 * (1.0 - tt)) * step(0.06, tt) * step(tt, 0.8) * (i > 1 && i < 8 ? 1.0 : 0.0);
      vec3 c = mix(mix(HAIR, HAIR_S, step(0.5, fract(float(i) * 0.5)) * 0.7), HAIR_H, hl * 0.55);
      layer(d, c, HAIR_S * 0.25);
    }
    // strands drawn on the head, converging on the crown
    float st = abs(sin(ang * 9.0 + 0.6 * sin(rr * 5.0))) * rr * 0.11;
    C = mix(C, HAIR_S * 0.3, aa(st - 0.0012) * aa(headD(p) + 0.012) * smoothstep(0.25, 0.6, rr) * LA * 0.7 * aa(q.x * 0.124 - 0.01));
  }
  // left hand holding the hair down
  layer(handLD(p), mix(SKIN, SKIN_S, aa(p.x + 0.165)), SKIN_S * 0.35);
  stroke(abs(p.y - 1.455 - 0.5 * (p.x + 0.15)) + max(handLD(p) + 0.006, 0.0) * 5.0 + max(-(p.x + 0.15), 0.0), SKIN_S * 0.4, 0.0012);
  stroke(abs(p.y - 1.474 - 0.5 * (p.x + 0.15)) + max(handLD(p) + 0.006, 0.0) * 5.0 + max(-(p.x + 0.15), 0.0), SKIN_S * 0.4, 0.0012);
  return vec4(C, A);
}

// fills under the scene's light, plus rim light on the edges that face each light
vec4 shade(vec2 p){
  vec4 c = paint(p);
  if (c.a <= 0.0) return vec4(0.0);
  float d0 = sil(p);
  vec3 lit = c.rgb * uAmb;
  vec3 tint = mix(vec3(1.0), c.rgb, 0.45) ;
  float w1 = 0.010, w2 = 0.008;
  float r1 = clamp((sil(p + uKeyD * w1) - d0) / w1, 0.0, 1.0) * aa(-sil(p + uKeyD * w1));
  float r2 = clamp((sil(p + vec2(0.92, 0.38) * w2) - d0) / w2, 0.0, 1.0) * aa(-sil(p + vec2(0.92, 0.38) * w2));
  lit += tint * (uKeyC * step(0.35, r1) + uWarmC * step(0.35, r2));
  return vec4(lit, c.a);
}

void main(){
  vec2 ndc = (vUv * 2.0 - 1.0) + uJit / uRes;
  if (uDebug > 0.0){                                   // look-dev: the drawing alone, flat on
    vec2 p = ndc * vec2(uRes.x / uRes.y, 1.0) * uDebug + uDbgC;
    PW = 2.0 * uDebug / uRes.y;
    vec4 c = shade(p);
    gl_FragColor = vec4(mix(vec3(0.010, 0.014, 0.024), c.rgb, c.a), 1.0);
    return;
  }
  vec3 rd = normalize(uFwd + ndc.x * uTanY * (uRes.x / uRes.y) * uRight + ndc.y * uTanY * uUp);
  if (rd.z > -1e-4) discard;
  float t = uRel.z / rd.z;                             // the drawing stands in the plane z = const
  vec3 q = (rd * t - uRel) * 1000.0;                   // metres from her feet
  PW = t * 1000.0 * 2.0 * uTanY / uRes.y;
  vec3 col = vec3(0.0); float al = 0.0;
  if (q.y >= 0.0){
    if (q.x > -0.6 && q.x < 1.25 && q.y < 1.75){ vec4 c = shade(q.xy); col = c.rgb * c.a; al = c.a; }
  } else {
    // wet asphalt: contact shadow, and her reflection broken up by the rough surface
    float tg = -uRel.y / min(rd.y, -1e-5);
    vec3 g = (rd * tg - uRel) * 1000.0;
    float sh = 0.55 * exp(-(g.x * g.x / 0.09 + g.z * g.z / 0.5));
    vec2 m = vec2(q.x + 0.012 * sin(g.z * 9.0 + g.x * 3.0) + 0.006 * sin(g.z * 31.0), -q.y);
    if (m.x > -0.6 && m.x < 1.25 && m.y < 1.75){
      float pw0 = PW; PW = pw0 + 0.02 * m.y;
      vec4 c = shade(m);
      float k = uWet * c.a * exp(-m.y * 0.9);
      col = c.rgb * k; al = k;
    }
    al = al + sh * (1.0 - al);
  }
  if (al <= 0.001) discard;
  gl_FragColor = vec4(col, al);
}`;

export function makeGirlMaterial() {
  const v3 = () => new THREE.Vector3();
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uRel: { value: v3() }, uRight: { value: v3() }, uUp: { value: v3() }, uFwd: { value: v3() },
      uRes: { value: new THREE.Vector2(1, 1) }, uJit: { value: new THREE.Vector2() },
      uTanY: { value: 0.3 }, uTime: { value: 0 }, uDebug: { value: 0 }, uWet: { value: 0.3 },
      uAmb: { value: v3() }, uKeyC: { value: v3() }, uWarmC: { value: v3() }, uKeyD: { value: new THREE.Vector2(0.7, 0.7) }, uDbgC: { value: new THREE.Vector2(0.3, 0.86) },
    },
  });
}
