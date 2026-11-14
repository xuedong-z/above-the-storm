// The world in one full-screen ray-march. World units are kilometres.
//   sky      stars, airglow, limb haze
//   cloud    anvil deck with overshooting tops, the main updraft column with caverns,
//            a low base with a wall cloud, the tornado funnel and its debris cloud
//   air      haze and rain shafts under the base, lit by lightning
//   ground   procedural plains: fields, pivot circles, section roads, a wet highway
//   objects  sphere-traced utility poles, farmsteads, a grain elevator
import * as THREE from 'three';

export const MAX_CELLS = 8, MAX_FLASH = 10, MAX_LAMP = 10, MAX_FARM = 6;

export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec3 uCam, uRight, uUp, uFwd, uMoonDir;
uniform vec2 uRes, uJit;
uniform float uTanY, uTime, uSeed, uPix, uStepK, uMinStep, uGlow;
uniform int uSteps;
uniform vec4 uCells[${MAX_CELLS}];      // x, z, radius, top altitude
uniform vec4 uFlashP[${MAX_FLASH}];     // x, altitude, z, intensity
uniform vec4 uFlashC[${MAX_FLASH}];     // rgb, softening (km^2)
uniform vec4 uLampP[${MAX_LAMP}];       // x, height, z, gain
uniform vec3 uLampC[${MAX_LAMP}];
uniform vec4 uFarms[${MAX_FARM}];       // x, z, rotation, seed
uniform vec3 uMain;                     // main cell x, z, radius
uniform vec3 uTor;                      // tornado x, z, strength
uniform vec3 uRain;                     // rain shaft x, z, radius
uniform vec2 uElev;
varying vec2 vUv;

const float RE = 6371.0, TOP = 18.5, BOT = 8.5, SIG = 2.6;
const vec3 MOON = vec3(0.034, 0.050, 0.088);
const vec3 AMB  = vec3(0.0016, 0.0026, 0.0052);
const vec3 HAZE = vec3(0.0050, 0.0085, 0.0150);
const vec3 AMBLOW = vec3(0.0030, 0.0040, 0.0062);     // skylight under the storm

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// ---- cloud ----------------------------------------------------------------------------------
float baseH(vec2 xz){
  float n = textureLod(uNoise, vec3(xz * 0.045, 0.37), 0.0).r;
  float b = 1.02 + 0.36 * n;
  b -= 0.46 * smoothstep(1.7, 0.2, length(xz - uTor.xy)) * uTor.z;      // wall cloud
  return b;
}

float shape(vec3 p, float h){
  float cov  = textureLod(uNoise, vec3(p.x * 0.0031, 0.21, p.z * 0.0031), 0.0).r;
  float cov2 = textureLod(uNoise, vec3(p.x * 0.0110, 0.63, p.z * 0.0110), 0.0).r;
  float s = 0.0;
  float rm = length(p.xz - uMain.xy);
  if (h > BOT){
    // anvil deck + convective domes over each storm cell
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
    float tw = textureLod(uNoise, vec3(p.x * 0.021, 0.5, p.z * 0.021), 0.0).g;
    float tw2 = textureLod(uNoise, vec3(p.x * 0.052, 0.13, p.z * 0.052), 0.0).g;
    topH += (2.6 * smoothstep(0.42, 0.85, tw) + 1.1 * smoothstep(0.4, 0.8, tw2)) * (0.25 + 0.75 * inf);
    float covm = smoothstep(0.44, 0.58, cov + inf * 0.45);
    s = smoothstep(0.0, 2.6, topH - h) * smoothstep(BOT, BOT + 1.5, h) * covm;
  }
  if (h < 12.0 && rm < 40.0){
    // updraft column of the main cell, and the low base spreading around it
    float colm = smoothstep(11.5, 8.5, rm + 5.0 * (cov2 - 0.5));
    float low = smoothstep(32.0, 22.0, rm + 14.0 * (cov - 0.5)) * smoothstep(3.6, 2.2, h);
    float bh = baseH(p.xz);
    float sl = max(colm, low) * smoothstep(bh, bh + 0.25, h) * smoothstep(12.0, 10.0, h);
    s = max(s, sl);
    // caverns inside the updraft: this is where the camera dives
    float cav = smoothstep(10.0, 7.0, rm) * smoothstep(16.8, 15.2, h) * smoothstep(bh + 0.5, bh + 1.8, h);
    s *= 1.0 - 0.70 * cav;
  } else if (rm < 10.0 && h < 16.8){
    s *= 1.0 - 0.70 * smoothstep(10.0, 7.0, rm) * smoothstep(16.8, 15.2, h);
  }
  return s;
}

float density(vec3 p, float h, float lod, bool detail){
  if (h > TOP || h < 0.4) return 0.0;
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
    if (h < 4.0) d -= textureLod(uNoise, p * 1.3 + 0.2, lod).r * 0.16 * (1.0 - smoothstep(0.0, 0.4, d));
  }
  return smoothstep(0.0, 0.30, d) * SIG;
}

// tornado: x = extinction, y = debris fraction.  ph = (x, altitude, z)
vec2 tornado(vec3 ph){
  vec2 ax = uTor.xy + vec2(0.13, -0.05) * ph.y * ph.y + 0.010 * vec2(sin(ph.y * 9.0 + uTime * 1.3), cos(ph.y * 7.0 + uTime * 1.1));
  vec2 l = ph.xz - ax; float rr = length(l);
  if (rr > 0.9 || ph.y > 1.3) return vec2(0.0);
  float R = 0.034 + 0.34 * pow(clamp(ph.y / 0.80, 0.0, 1.0), 2.3);
  l = rot(uTime * 1.1) * l;
  vec3 q = vec3(l.x, ph.y - uTime * 0.12, l.y);
  float n = textureLod(uNoise, q * 3.7, 0.0).r, n2 = textureLod(uNoise, q * 12.0 + 0.4, 0.0).g;
  float f = smoothstep(R, R * 0.6, rr + (n - 0.5) * R * 0.8 + (n2 - 0.5) * 0.016);
  float deb = smoothstep(0.30, 0.03, rr + (n - 0.5) * 0.16) * smoothstep(0.26, 0.0, ph.y + (n2 - 0.5) * 0.10) * n;
  return vec2(f * 60.0 + deb * 20.0, deb * 20.0 / (f * 60.0 + deb * 20.0 + 1e-4)) * vec2(uTor.z, 1.0);
}

// haze and rain below the cloud base
float air(vec3 ph){
  if (ph.y > 2.6) return 0.0;
  float d = 0.022 * smoothstep(2.6, 0.8, ph.y);
  float rr = length(ph.xz - uRain.xy) / uRain.z;
  if (rr < 1.2){
    float st = textureLod(uNoise, vec3(ph.xz * 0.21, 0.5), 0.0).r;
    float st2 = textureLod(uNoise, vec3(ph.xz * 0.9, 0.2), 0.0).g;
    d += 0.42 * smoothstep(1.15, 0.5, rr) * smoothstep(0.30, 0.75, st * 0.7 + st2 * 0.5) * smoothstep(1.6, 1.0, ph.y);
  }
  return d;
}

// ---- lighting -------------------------------------------------------------------------------
vec3 flashScatter(vec3 ph){
  vec3 s = vec3(0.0);
  float under = mix(0.10, 1.0, smoothstep(1.0, 2.0, ph.y));     // in-cloud flashes are muffled below the base
  for (int f = 0; f < ${MAX_FLASH}; f++){
    vec4 fp = uFlashP[f];
    if (fp.w <= 0.0) continue;
    vec3 v = fp.xyz - ph; float d2 = dot(v, v);
    bool inCloud = fp.y > 2.0;
    s += uFlashC[f].rgb * fp.w * exp(-sqrt(d2) * (inCloud ? 0.22 : 0.05)) * (inCloud ? under : 1.0) / (d2 + uFlashC[f].a);
  }
  return s * vec3(0.80, 0.86, 1.0) * 0.32;
}
// irradiance on a surface at P (y = altitude) with normal N
vec3 lightAt(vec3 P, vec3 N){
  vec3 E = AMBLOW * 3.0 * (0.55 + 0.45 * N.y);
  for (int f = 0; f < ${MAX_FLASH}; f++){
    vec4 fp = uFlashP[f];
    if (fp.w <= 0.0) continue;
    vec3 v = fp.xyz - P; float d2 = dot(v, v);
    float nl = max(dot(N, v) * inversesqrt(d2 + 1e-9), 0.0) * 0.85 + 0.15;
    E += uFlashC[f].rgb * fp.w * 0.32 * nl * exp(-sqrt(d2) * 0.05) * (fp.y > 2.0 ? 0.10 : 1.0) / (d2 + uFlashC[f].a);
  }
  for (int i = 0; i < ${MAX_LAMP}; i++){
    vec4 lp = uLampP[i];
    if (lp.w <= 0.0) continue;
    vec3 v = lp.xyz - P; float d2 = dot(v, v) + 1e-8;
    float nl = max(dot(N, v) * inversesqrt(d2), 0.0);
    E += uLampC[i] * lp.w * 0.7 * lp.y * lp.y * nl / d2;
  }
  return E;
}

// ---- sky ------------------------------------------------------------------------------------
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
  float dip = sqrt(2.0 * max(uCam.y, 0.0) / RE);        // horizon dip, radians
  float el = asin(clamp(rd.y, -1.0, 1.0)) + dip;
  float e = max(el, 0.0);
  float sz = cos(e);
  float k = RE / (RE + 90.0);
  float vr = 1.0 / sqrt(max(1.0 - k * k * sz * sz, 0.012));
  vec3 glow = vec3(0.10, 0.62, 0.26) * 0.0024 * vr + vec3(0.55, 0.10, 0.06) * 0.0004 * vr * vr * 0.25;
  vec3 limb = vec3(0.016, 0.032, 0.070) * exp(-e * 22.0) + vec3(0.004, 0.008, 0.018) * exp(-e * 5.0);
  float mw = textureLod(uNoise, rd * 1.3 + 0.37, 1.0).r;
  float band = exp(-pow(dot(rd, normalize(vec3(0.35, 0.55, -0.76))) * 3.2, 2.0));
  vec3 milky = vec3(0.010, 0.011, 0.016) * band * smoothstep(0.35, 0.8, mw);
  float ext = 1.0 - exp(-e * 14.0);
  return glow + limb + (stars(rd) + milky) * ext;
}

// ---- ground ---------------------------------------------------------------------------------
// albedo of the plains at x (km); fw = pixel footprint (km); wet = specular weight
vec3 groundAlb(vec2 x, float fw, out float wet){
  vec2 g = x / 0.805, id = floor(g), f = fract(g);
  float h1 = hash12(id), h2 = hash12(id + 7.7);
  vec3 alb = mix(vec3(0.040, 0.033, 0.024), vec3(0.115, 0.095, 0.052), h1);          // soil .. stubble
  if (h1 > 0.5) alb = mix(vec3(0.022, 0.050, 0.020), vec3(0.045, 0.075, 0.028), fract(h1 * 7.3));   // crops
  float fn = fw / 0.805;
  if (h2 > 0.55){                                                                    // centre-pivot circle
    float r = length(f - 0.5);
    alb = mix(alb * 0.55 + vec3(0.0, 0.018, 0.0), alb * 1.15, smoothstep(0.46 - fn, 0.46 + fn, r));
    float spoke = abs(fract(atan(f.y - 0.5, f.x - 0.5) * 0.9549 + h1 * 3.0) - 0.5);
    alb *= 1.0 - 0.25 * smoothstep(0.02 + fn * 2.0, 0.0, spoke) * step(r, 0.46);
  }
  // crop rows, visible only up close
  vec2 dir = h2 > 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  float rows = sin(dot(x, dir) * 6283.0 / 0.9);
  alb *= 1.0 + 0.22 * rows * smoothstep(0.0006, 0.00012, fw);
  // patchiness
  float m = textureLod(uNoise, vec3(x * 0.37, 0.1), 0.0).r, m2 = textureLod(uNoise, vec3(x * 6.1, 0.6), 0.0).g;
  alb *= 0.62 + 0.55 * m + 0.35 * (m2 - 0.5) * smoothstep(0.02, 0.002, fw);
  wet = 0.10;
  // section roads (gravel)
  vec2 gr = abs(fract(x / 1.61 + 0.5) - 0.5) * 1.61;
  float dr = min(gr.x, gr.y);
  alb = mix(vec3(0.135, 0.115, 0.085), alb, smoothstep(0.0035, 0.0035 + fw, dr));
  // the highway along x = 0
  float dx = abs(x.x);
  float verge = smoothstep(0.020 + fw, 0.008, dx);
  alb = mix(alb, vec3(0.034, 0.050, 0.022) * (0.7 + 0.6 * m2), verge);
  float road = smoothstep(0.0058 + fw, 0.0058, dx);
  alb = mix(alb, vec3(0.085, 0.075, 0.062), smoothstep(0.0078 + fw, 0.0078, dx));     // shoulder
  vec3 asph = vec3(0.030, 0.031, 0.034) * (0.8 + 0.5 * m2);
  float lw = 0.00011 + fw * 0.6, la = 0.00011 / lw;                                   // painted lines
  float dash = step(fract(x.y / 0.012), 0.30);
  asph = mix(asph, vec3(0.42, 0.33, 0.07), smoothstep(lw, 0.0, dx) * dash * la);
  asph = mix(asph, vec3(0.40, 0.40, 0.38), smoothstep(lw, 0.0, abs(dx - 0.0037)) * la);
  alb = mix(alb, asph, road);
  wet = mix(wet, 1.0, road);
  return alb;
}

// ---- near objects (sphere-traced) ------------------------------------------------------------
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdCyl(vec3 p, float r, float h){ vec2 d = vec2(length(p.xz) - r, abs(p.y - h * 0.5) - h * 0.5); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float gable(vec3 p, vec3 b, float rise){          // box with a pitched roof, ridge along z
  float body = sdBox(p - vec3(0.0, b.y, 0.0), b);
  float roof = max(max(abs(p.x) * rise / b.x + (p.y - 2.0 * b.y) - rise, abs(p.z) - b.z), -(p.y - 2.0 * b.y)) * 0.8;
  return min(body, roof);
}
// returns distance; mat: 1 pole, 2 house, 3 barn, 4 tree, 5 concrete/steel
float map(vec3 p, out float mat){
  mat = 1.0;
  // utility poles along the east side of the highway, 60 m apart
  vec3 q = vec3(p.x - 0.0125, p.y, mod(p.z + 0.03, 0.06) - 0.03);
  float d = max(length(q.xz) - 0.00017, p.y - 0.0108);
  d = min(d, sdBox(q - vec3(0.0, 0.0099, 0.0), vec3(0.0013, 0.00008, 0.00008)));
  // wires: three conductors sagging between crossarms (kept at a minimum thickness)
  float zz = q.z / 0.03, sag = 0.0099 - 0.0011 * (1.0 - zz * zz);
  vec2 wq = vec2(abs(abs(p.x - 0.0125) - 0.0006) - 0.0006, p.y - sag);
  d = min(d, length(wq) - 0.00003);
  // mile markers / reflector posts on the west side
  vec3 q2 = vec3(p.x + 0.0072, p.y, mod(p.z + 0.01, 0.02) - 0.01);
  d = min(d, sdBox(q2 - vec3(0.0, 0.0005, 0.0), vec3(0.00004, 0.0005, 0.00004)));
  for (int i = 0; i < ${MAX_FARM}; i++){
    vec4 F = uFarms[i];
    vec3 l = p - vec3(F.x, 0.0, F.y);
    float bd = length(l.xz) - 0.045;
    if (bd > 0.01){ d = min(d, bd); continue; }
    l.xz = rot(F.z) * l.xz;
    float e = gable(l, vec3(0.0045, 0.0026, 0.0060), 0.0022);                          // house
    if (e < d){ d = e; mat = 2.0; }
    e = gable(l - vec3(0.018, 0.0, 0.006), vec3(0.0060, 0.0036, 0.0100), 0.0036);      // barn
    if (e < d){ d = e; mat = 3.0; }
    e = sdCyl(l - vec3(0.029, 0.0, -0.006), 0.0027, 0.015);                            // silo
    e = min(e, length(l - vec3(0.029, 0.015, -0.006)) - 0.0027);
    if (e < d){ d = e; mat = 5.0; }
    for (int k = 0; k < 5; k++){                                                       // shelterbelt
      float fk = float(k), hk = fract(sin(fk * 12.9 + F.w * 7.1) * 43758.5);
      vec3 c = vec3(-0.022 + 0.0085 * fk, 0.0045 + 0.002 * hk, -0.017 + 0.004 * sin(fk * 2.1 + F.w));
      vec3 tq = (l - c) / vec3(0.0050, 0.0052 + 0.002 * hk, 0.0050);
      float n = textureLod(uNoise, p * 260.0, 0.0).r;
      e = (length(tq) - 1.0 + (n - 0.5) * 0.75) * 0.0032;
      if (e < d){ d = e; mat = 4.0; }
    }
  }
  // grain elevator
  vec3 l = p - vec3(uElev.x, 0.0, uElev.y);
  float bd = length(l.xz) - 0.06;
  if (bd > 0.01) d = min(d, bd);
  else {
    float e = sdBox(l - vec3(0.0, 0.021, 0.0), vec3(0.0045, 0.021, 0.0045));
    e = min(e, gable(l - vec3(0.0, 0.042, 0.0), vec3(0.0030, 0.0018, 0.0045), 0.0015));
    for (int k = 0; k < 4; k++) e = min(e, sdCyl(l - vec3(0.0, 0.0, 0.0105 + 0.0092 * float(k)), 0.0046, 0.030));
    e = min(e, sdBox(l - vec3(0.0, 0.0315, 0.024), vec3(0.0016, 0.0015, 0.020)));     // gallery over the silos
    if (e < d){ d = e; mat = 5.0; }
  }
  return d;
}

void main(){
  vec2 ndc = (vUv * 2.0 - 1.0) + uJit / uRes;
  vec3 rd = normalize(uFwd + ndc.x * uTanY * (uRes.x / uRes.y) * uRight + ndc.y * uTanY * uUp);

  // altitude along the ray on a curved earth: h(t) = cam.y + t*rd.y + a*t^2
  float a = max((1.0 - rd.y * rd.y) / (2.0 * RE), 1e-9), b = rd.y;
  vec3 bg = sky(rd);
  float t0 = 0.0, tEnd = 650.0;
  bool march = true;
  float cT = uCam.y - TOP;
  if (cT > 0.0){
    float disc = b * b - 4.0 * a * cT;
    if (b < 0.0 && disc > 0.0){ float sq = sqrt(disc); t0 = 2.0 * cT / (-b + sq); tEnd = min((-b + sq) / (2.0 * a), tEnd); }
    else march = false;
  } else tEnd = min(tEnd, 2.0 * (-cT) / (b + sqrt(b * b - 4.0 * a * cT)));

  // ground
  float discG = b * b - 4.0 * a * uCam.y;
  float tG = -1.0;
  if (b < 0.0 && discG > 0.0) tG = 2.0 * uCam.y / (-b + sqrt(discG));

  // near objects
  float tO = -1.0, mat = 0.0;
  if (uCam.y < 1.6){
    float t = 0.0005, tmax = tG > 0.0 ? min(tG, 3.0) : 3.0, m;
    for (int i = 0; i < 72; i++){
      float d = map(uCam + rd * t, m);
      if (d < 0.35 * uPix * t){ tO = t; mat = m; break; }
      t += d * 0.9;
      if (t > tmax) break;
    }
  }

  if (tO > 0.0){
    vec3 P = uCam + rd * tO; float m;
    vec2 e = vec2(max(0.00003, 0.6 * uPix * tO), 0.0);
    vec3 N = normalize(vec3(map(P + e.xyy, m) - map(P - e.xyy, m), map(P + e.yxy, m) - map(P - e.yxy, m), map(P + e.yyx, m) - map(P - e.yyx, m)));
    vec3 alb = mat < 1.5 ? vec3(0.055, 0.045, 0.035) : mat < 2.5 ? vec3(0.42, 0.40, 0.36) : mat < 3.5 ? vec3(0.17, 0.045, 0.035)
             : mat < 4.5 ? vec3(0.020, 0.036, 0.016) : vec3(0.30, 0.30, 0.29);
    if (mat > 3.5 && mat < 4.5) N = normalize(N + 0.6 * (textureLod(uNoise, P * 700.0, 0.0).rgr - 0.5));
    bg = alb * lightAt(P, N);
    tEnd = min(tEnd, tO);
  } else if (tG > 0.0){
    vec3 P = uCam + rd * tG;
    float fw = tG * uPix / max(-b, 0.02), wet;
    vec3 alb = groundAlb(P.xz, fw, wet);
    vec3 G = vec3(P.x, 0.0, P.z);
    vec3 E = lightAt(G, vec3(0.0, 1.0, 0.0));
    // moonlight outside the storm's shadow
    E += MOON * 0.24 * smoothstep(26.0, 40.0, length(P.xz - uMain.xy));
    bg = alb * E;
    // wet reflections of the lightning
    vec3 nn = normalize(vec3(0.0, 1.0, 0.0) + 0.05 * (textureLod(uNoise, vec3(P.xz * 40.0, 0.3), 0.0).rgr - 0.5) * vec3(1.0, 0.0, 1.0));
    vec3 R = reflect(rd, nn);
    float fres = 0.03 + 0.97 * pow(1.0 - max(-rd.y, 0.0), 5.0);
    vec3 sp = AMBLOW * 4.0;
    for (int f = 0; f < ${MAX_FLASH}; f++){
      vec4 fp = uFlashP[f];
      if (fp.w <= 0.0) continue;
      vec3 v = fp.xyz - G; float d2 = dot(v, v);
      sp += uFlashC[f].rgb * fp.w * pow(max(dot(R, v) * inversesqrt(d2), 0.0), 40.0) * 3.0 / (d2 + uFlashC[f].a);
    }
    bg += sp * fres * wet;
    tEnd = min(tEnd, tG);
  }

  float T = 1.0; vec3 L = vec3(0.0);
  if (march){
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uSeed * 0.61803399);
    float t = t0 + max(uMinStep, t0 * uStepK) * j;
    for (int i = 0; i < uSteps; i++){
      if (t > tEnd || T < 0.012) break;
      float dt = min(max(uMinStep, t * uStepK), max(tEnd - t, 0.002));
      vec3 p = uCam + rd * t;
      float h = uCam.y + t * b + a * t * t;
      vec3 ph = vec3(p.x, h, p.z);
      float lod = clamp(log2(t * uPix * 9.0), 0.0, 5.0);
      float d = density(p, h, lod, true);
      float da = 0.0, alb = 1.0;
      if (h < 2.6){
        da = air(ph);
        vec2 tor = tornado(ph);
        if (tor.x > 0.0){ alb = mix(1.0, mix(0.50, 0.22, tor.y), tor.x / (tor.x + d + 1e-4)); d += tor.x; }
      }
      float dTot = d + da;
      if (dTot > 0.0){
        vec3 S = vec3(0.0);
        if (h > 5.0 && d > 0.0){
          // moonlight: short shadow march
          float od = 0.0, ls = 0.35; vec3 lp = p; float lh = h;
          for (int k = 0; k < 4; k++){
            lp += uMoonDir * ls; lh += uMoonDir.y * ls;
            od += density(lp, lh, lod + 1.0, false) * ls; ls *= 1.9;
          }
          S = MOON * (exp(-od * 0.9) + 0.25 * exp(-od * 0.18)) + AMB * smoothstep(BOT, TOP, h);
        } else S = AMBLOW * (0.35 + 0.65 * smoothstep(2.0, 0.0, h));
        S += flashScatter(ph) + vec3(0.008, 0.011, 0.018) * uGlow;     // eyes adapted to the dark inside the cloud
        S *= (d * alb + da * 0.3) / dTot;
        float st = exp(-dTot * dt);
        L += T * (1.0 - st) * mix(HAZE, S, exp(-t * 0.0045));
        T *= st;
      }
      t += dt;
    }
  }
  gl_FragColor = vec4(L + T * bg, 1.0);
}`;

export function makeWorldMaterial(noiseTex) {
  const v3 = () => new THREE.Vector3(), v4 = () => new THREE.Vector4();
  const arr = (n, f) => Array.from({ length: n }, f);
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      uNoise: { value: noiseTex },
      uCam: { value: v3() }, uRight: { value: v3() }, uUp: { value: v3() }, uFwd: { value: v3() },
      uMoonDir: { value: new THREE.Vector3(-0.80, 0.24, -0.50).normalize() },
      uRes: { value: new THREE.Vector2(1, 1) }, uJit: { value: new THREE.Vector2() },
      uTanY: { value: 0.3 }, uTime: { value: 0 }, uSeed: { value: 0 }, uPix: { value: 0.001 },
      uStepK: { value: 0.03 }, uMinStep: { value: 0.1 }, uGlow: { value: 0 }, uSteps: { value: 160 },
      uCells: { value: arr(MAX_CELLS, v4) },
      uFlashP: { value: arr(MAX_FLASH, v4) }, uFlashC: { value: arr(MAX_FLASH, v4) },
      uLampP: { value: arr(MAX_LAMP, v4) }, uLampC: { value: arr(MAX_LAMP, v3) },
      uFarms: { value: arr(MAX_FARM, v4) },
      uMain: { value: v3() }, uTor: { value: v3() }, uRain: { value: v3() }, uElev: { value: new THREE.Vector2() },
    },
  });
}
