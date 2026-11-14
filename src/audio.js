// The soundtrack is synthesised too: slipstream, thunder, the roar inside the updraft, rain,
// the tornado's rumble, arcing power lines. Rendered offline into one buffer.
import { DUR, FLASHES, BOLTS, POWER, T_PARENT, T_SPRITE, T_JET, T_ENTER, T_EXIT, T_END, camera } from './timeline.js';
import { rng } from './noise.js';

export async function renderAudio() {
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, SR * DUR, SR);
  const r = rng(99);
  const nb = ctx.createBuffer(2, SR * 4, SR);
  for (let ch = 0; ch < 2; ch++) { const d = nb.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
  const noise = (off = 0) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(0, off); return s; };
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.9, 0.5);
  master.gain.setValueAtTime(0.9, T_END - 0.02); master.gain.linearRampToValueAtTime(0, T_END + 0.03);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);
  const env = (g, t0, peak, att, dec) => {
    g.gain.value = 0.0001; g.gain.setValueAtTime(0.0001, 0);
    g.gain.setValueAtTime(0.0001, Math.max(0.001, t0));
    g.gain.exponentialRampToValueAtTime(peak, Math.max(0.001, t0) + att);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(0.001, t0) + att + dec);
  };
  const keys = (param, ks) => { param.setValueAtTime(ks[0][1], 0); for (const [t, v] of ks) param.linearRampToValueAtTime(v, Math.max(0.001, t)); };
  const bq = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const layer = (off, type, f, q, gk, fk) => {
    const n = noise(off), fl = bq(type, f, q), g = ctx.createGain();
    keys(g.gain, gk); if (fk) keys(fl.frequency, fk);
    n.connect(fl).connect(g).connect(master); return g;
  };

  // slipstream: follows the speed of the camera
  layer(0, 'bandpass', 300, 0.5, [[0, 0.16], [6, 0.14], [8, 0.08], [10.5, 0.12], [T_ENTER, 0.30], [T_EXIT, 0.30], [20.5, 0.12], [T_END, 0.16]],
    [[0, 420], [6, 380], [8, 260], [11, 420], [T_ENTER, 700], [T_EXIT, 620], [21, 340], [T_END, 420]]);
  layer(1.3, 'highpass', 4200, 0.7, [[0, 0.012], [T_ENTER - 0.5, 0.012], [T_ENTER, 0.05], [T_EXIT, 0.05], [T_EXIT + 1, 0.02], [T_END, 0.02]]);
  // inside the updraft: a deep roar with buffeting
  { const g = layer(2.2, 'lowpass', 140, 0.9, [[0, 0], [T_ENTER - 0.3, 0], [T_ENTER + 0.3, 0.55], [T_EXIT - 0.2, 0.55], [T_EXIT + 0.6, 0], [T_END, 0]]);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 7.3; lg.gain.value = 0.18;
    keys(lg.gain, [[0, 0], [T_ENTER, 0.18], [T_EXIT, 0.18], [T_EXIT + 0.5, 0], [T_END, 0]]); lfo.connect(lg).connect(g.gain); lfo.start(); }
  // rain under the base
  layer(0.7, 'highpass', 2600, 0.5, [[0, 0], [T_EXIT - 0.2, 0], [T_EXIT + 0.8, 0.035], [T_END, 0.05]]);
  // the tornado: a low rumble growing as the camera closes in
  layer(3.1, 'lowpass', 90, 1.2, [[0, 0], [T_EXIT, 0], [21, 0.10], [27, 0.42], [T_END, 0.75]], [[0, 70], [21, 70], [T_END, 130]]);
  for (const [fr, a] of [[37, 0.22], [55.5, 0.10]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = fr;
    keys(g.gain, [[0, 0], [T_EXIT, 0], [22, a * 0.25], [T_END, a]]); o.connect(g).connect(master); o.start();
  }
  // drone above the clouds
  for (const [fr, a] of [[49, 0.09], [73.5, 0.045], [98.3, 0.02]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = fr;
    keys(g.gain, [[0, a], [T_ENTER - 1, a], [T_ENTER, 0], [T_END, 0]]); o.connect(g).connect(master); o.start();
  }
  // thunder: rumble per flash, softened and (slightly) delayed with distance from the camera
  const visible = new Set(BOLTS.map(b => b.flash)), power = new Set(POWER);
  for (const f of FLASHES) {
    if (f.t < -0.5 || f.t > DUR || power.has(f)) continue;
    const c = camera(Math.max(0, f.t)).pos;
    const dist = Math.hypot(f.x - c[0], f.y - c[1], f.z - c[2]);
    const near = visible.has(f);
    const t0 = f.t + Math.min(1.2, dist * 0.05);
    const peak = near ? Math.min(0.9, 2.2 / (1 + dist * 0.35)) : Math.min(0.4, f.I / 420) * (25 / (25 + dist));
    if (peak < 0.004) continue;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, (f.x - c[0]) / (4 + dist * 0.5)));
    pan.connect(master);
    { const n = noise(r() * 3), lp = bq('lowpass', 60 + 5000 / (8 + dist * 3)), g = ctx.createGain();
      env(g, t0, peak, 0.04, 1.2 + r() + (near ? 1.0 : 0)); n.connect(lp).connect(g).connect(pan); }
    if (near) {                                           // the crack of a close channel
      const n = noise(r() * 3), hp = bq('highpass', 900), g = ctx.createGain();
      env(g, t0, peak * 0.8, 0.004, 0.22); n.connect(hp).connect(g).connect(pan);
      const o = ctx.createOscillator(), g2 = ctx.createGain(); o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(28, t0 + 1.2);
      env(g2, t0, peak * 0.9, 0.01, 1.6); o.connect(g2).connect(master); o.start();
    }
  }
  // power flashes: arcing buzz
  for (const f of POWER) {
    const o = ctx.createOscillator(), bp = bq('bandpass', 1400, 1.2), g = ctx.createGain(), pan = ctx.createStereoPanner(); pan.pan.value = 0.35;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(118, f.t); o.frequency.linearRampToValueAtTime(92, f.t + 0.5);
    env(g, f.t + 0.05, 0.16, 0.01, 0.5); o.connect(bp).connect(g).connect(pan).connect(master); o.start();
  }
  // parent stroke of the sprites: sub boom
  { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(58, T_PARENT); o.frequency.exponentialRampToValueAtTime(30, T_PARENT + 2.5);
    env(g, T_PARENT, 0.45, 0.03, 2.8); o.connect(g).connect(master); o.start(); }
  // sprites: glassy partials
  [1318, 1568, 1976, 2349, 2637, 3136, 3951].forEach((fr, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner(), trem = ctx.createOscillator(), tg = ctx.createGain();
    o.frequency.value = fr * (1 + (r() - 0.5) * 0.004); pan.pan.value = (i / 6 - 0.5) * 1.2 + 0.2;
    trem.frequency.value = 3 + r() * 6; tg.gain.value = 0.5; trem.connect(tg).connect(g.gain);
    const g2 = ctx.createGain(); env(g2, T_SPRITE + i * 0.12, 0.022 / (1 + i * 0.25), 0.25, 2.6);
    g.gain.value = 0.6; o.connect(g).connect(g2).connect(pan).connect(master); o.start(); trem.start();
  });
  // blue jet: rising hiss
  { const n = noise(2.1), f = bq('bandpass', 300, 2.5), g = ctx.createGain(), pan = ctx.createStereoPanner(); pan.pan.value = 0.5;
    f.frequency.setValueAtTime(240, T_JET); f.frequency.exponentialRampToValueAtTime(2600, T_JET + 2.2);
    env(g, T_JET, 0.16, 0.7, 2.4); n.connect(f).connect(g).connect(pan).connect(master); }
  // the roll into the dive: a falling whoosh
  { const n = noise(0.4), f = bq('bandpass', 2400, 1.5), g = ctx.createGain();
    f.frequency.setValueAtTime(2600, 10.6); f.frequency.exponentialRampToValueAtTime(260, T_ENTER + 0.3);
    env(g, 10.6, 0.22, 1.5, 0.9); n.connect(f).connect(g).connect(master); }
  const buf = await ctx.startRendering();
  let pk = 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }
  if (pk > 0.9) for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk; }
  buf.peak = pk;
  return buf;
}

export function wavBlob(buf) {
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true);
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { dv.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 32767, true); o += 2; }
  return new Blob([dv.buffer], { type: 'audio/wav' });
}
