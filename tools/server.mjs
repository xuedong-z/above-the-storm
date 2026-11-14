// Zero-dependency dev server. Serves the repo, and in capture mode receives PNG frames + WAV
// from the page and muxes them into out/above-the-storm.mp4 with ffmpeg.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out'), FRAMES = path.join(OUT, 'frames');
const PORT = +(process.env.PORT || 5179);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4', '.wav': 'audio/wav' };

const body = req => new Promise(res => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname.startsWith('/capture/')) {
      fs.mkdirSync(FRAMES, { recursive: true });
      const buf = await body(req);
      if (url.pathname === '/capture/audio') { fs.writeFileSync(path.join(OUT, 'audio.wav'), buf); return res.end('ok'); }
      const m = url.pathname.match(/^\/capture\/frame\/(\d+)$/);
      if (m) { fs.writeFileSync(path.join(FRAMES, `f_${m[1].padStart(5, '0')}.png`), buf); return res.end('ok'); }
      if (url.pathname === '/capture/finish') {
        const fps = url.searchParams.get('fps') || '30';
        const out = path.join(OUT, 'above-the-storm.mp4');
        const ff = spawn('ffmpeg', ['-y', '-framerate', fps, '-i', path.join(FRAMES, 'f_%05d.png'), '-i', path.join(OUT, 'audio.wav'),
          '-c:v', 'libx264', '-crf', '15', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest',
          '-movflags', '+faststart', out]);
        let err = ''; ff.stderr.on('data', d => { err += d; });
        ff.on('close', code => res.end(code === 0 ? 'done: out/above-the-storm.mp4' : 'ffmpeg failed: ' + err.slice(-400)));
        ff.on('error', e => res.end('ffmpeg not found: ' + e.message));
        return;
      }
      res.statusCode = 404; return res.end('?');
    }
    let p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(p).pipe(res);
  } catch (e) { res.statusCode = 500; res.end(String(e)); }
}).listen(PORT, () => console.log(`Above the Storm  ->  http://localhost:${PORT}   (add ?capture to export)`));
