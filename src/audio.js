// The soundtrack is synthesised too: stratospheric wind, thunder felt through the cloud deck,
// a glassy shimmer for the sprites and a rising hiss for the jet. Rendered offline so the same
// buffer is used for live playback and for the exported video.
import { DUR, FLASHES, T_PARENT, T_SPRITE, T_JET } from './timeline.js';
import { rng } from './noise.js';

export async function renderAudio() {
  const SR = 48000, tail = 0;
  const ctx = new OfflineAudioContext(2, SR * (DUR + tail), SR);
  const r = rng(99);
  const nb = ctx.createBuffer(2, SR * 4, SR);
  for (let ch = 0; ch < 2; ch++) { const d = nb.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
  const noise = (off = 0) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(0, off); return s; };
  const master = ctx.createGain(); master.gain.value = 0.9;
  master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.9, 0.6);
  master.gain.setValueAtTime(0.9, DUR - 0.8); master.gain.linearRampToValueAtTime(0, DUR);
  master.connect(ctx.destination);
  const env = (g, t0, peak, att, dec) => {
    g.gain.value = 0.0001; g.gain.setValueAtTime(0.0001, 0);
    g.gain.setValueAtTime(0.0001, Math.max(0.001, t0));
    g.gain.exponentialRampToValueAtTime(peak, Math.max(0.001, t0) + att);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(0.001, t0) + att + dec);
  };
  const bq = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  // wind bed
  { const n = noise(), f = bq('bandpass', 260, 0.4), g = ctx.createGain(); g.gain.value = 0.10;
    f.frequency.setValueAtTime(220, 0); f.frequency.linearRampToValueAtTime(340, DUR);
    n.connect(f).connect(g).connect(master); }
  { const n = noise(1.3), f = bq('highpass', 5200), g = ctx.createGain(); g.gain.value = 0.006; n.connect(f).connect(g).connect(master); }
  // drone
  for (const [fr, a] of [[49, 0.10], [73.5, 0.05], [98.3, 0.025]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = fr; g.gain.value = a;
    o.connect(g).connect(master); o.start();
  }
  // thunder: low rumble per flash, delayed and softened with distance
  for (const f of FLASHES) {
    if (f.t < -0.5 || f.t > DUR) continue;
    const dist = Math.hypot(f.x, f.z + 15);
    const t0 = f.t + 0.15 + dist * 0.004, peak = Math.min(0.5, f.I / 420) * (60 / (60 + dist));
    if (peak < 0.004) continue;
    const n = noise(r() * 3), lp = bq('lowpass', 70 + 4000 / (20 + dist)), g = ctx.createGain(), pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, f.x / 80));
    env(g, t0, peak, 0.06, 1.4 + r());
    n.connect(lp).connect(g).connect(pan).connect(master);
  }
  // parent stroke: sub boom
  { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(58, T_PARENT); o.frequency.exponentialRampToValueAtTime(30, T_PARENT + 2.5);
    env(g, T_PARENT, 0.5, 0.03, 2.8); o.connect(g).connect(master); o.start(); }
  // sprites: glassy partials
  [1318, 1568, 1976, 2349, 2637, 3136, 3951].forEach((fr, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner(), trem = ctx.createOscillator(), tg = ctx.createGain();
    o.frequency.value = fr * (1 + (r() - 0.5) * 0.004); pan.pan.value = (i / 6 - 0.5) * 1.2 + 0.2;
    trem.frequency.value = 3 + r() * 6; tg.gain.value = 0.5; trem.connect(tg).connect(g.gain);
    const g2 = ctx.createGain(); env(g2, T_SPRITE + i * 0.12, 0.022 / (1 + i * 0.25), 0.25, 2.6);
    g.gain.value = 0.6; o.connect(g).connect(g2).connect(pan).connect(master); o.start(); trem.start();
  });
  { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle';
    o.frequency.setValueAtTime(196, T_SPRITE); o.frequency.exponentialRampToValueAtTime(110, T_SPRITE + 3);
    env(g, T_SPRITE, 0.10, 0.5, 3.0); o.connect(g).connect(master); o.start(); }
  // blue jet: rising hiss + tone
  { const n = noise(2.1), f = bq('bandpass', 300, 2.5), g = ctx.createGain(), pan = ctx.createStereoPanner(); pan.pan.value = -0.55;
    f.frequency.setValueAtTime(240, T_JET); f.frequency.exponentialRampToValueAtTime(2600, T_JET + 2.2);
    env(g, T_JET, 0.16, 0.7, 2.4); n.connect(f).connect(g).connect(pan).connect(master);
    const o = ctx.createOscillator(), g2 = ctx.createGain(); o.frequency.setValueAtTime(147, T_JET); o.frequency.exponentialRampToValueAtTime(440, T_JET + 2.2);
    env(g2, T_JET, 0.05, 0.8, 2.2); o.connect(g2).connect(pan); o.start(); }
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
