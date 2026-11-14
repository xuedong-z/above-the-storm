# Above the Storm

A film shot written entirely in code. No models, no textures, no audio files: every pixel and
every sound is computed by the source in this repository, on top of three.js.

The subject is real but almost never seen: **transient luminous events** above a night
thunderstorm, viewed from 21 km. A giant lightning stroke under a distant anvil launches an
expanding **elve** ring, then a cluster of **red sprites** (50–90 km altitude, slowed down
about 300×), and a **blue jet** leaves the top of a nearer cell.

This is a 10-second sample shot, not the full film.

## Run

```bash
node tools/server.mjs
```

Open <http://localhost:5179>. It plays in real time and loops; click for sound.

| URL | What it does |
| --- | --- |
| `/` | live playback, 1280×720, half-resolution clouds |
| `/?t=4.0` | hold one moment (look-dev) |
| `/?t=4.0&hq` | the same moment at export quality |
| `/?capture` | render all frames offline and encode `out/above-the-storm.mp4` |
| `/?capture&w=3840&h=2160&spp=4` | 4K export with more sub-frames |

Capture needs `ffmpeg` on the PATH. Frames are rendered from the frame number, not the clock,
so the export is deterministic and independent of machine speed.

## How it works

| File | Role |
| --- | --- |
| `src/timeline.js` | the shot as functions of time: camera, storm cells, lightning schedule |
| `src/noise.js` | tiling Perlin-Worley 3D noise volume, generated at load |
| `src/sky.js` | ray-marched volumetric cloud deck on a curved earth, stars, airglow, limb |
| `src/sprites.js` | sprites, halo, elve and jet as branching additive ribbons with per-vertex arrival times |
| `src/post.js` | HDR bloom pyramid, ACES tone map, grain |
| `src/audio.js` | synthesised soundtrack (`OfflineAudioContext`), shared by playback and export |
| `src/main.js` | live loop and frame-by-frame capture with sub-frame accumulation |
| `tools/server.mjs` | zero-dependency server; receives frames and runs ffmpeg |

World units are kilometres. `vendor/` holds three.js r180 (MIT).
