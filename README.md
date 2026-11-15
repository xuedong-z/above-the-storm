# Above the Storm

A film shot written entirely in code. No models, no textures, no audio files: every pixel and
every sound is computed by the source in this repository, on top of three.js.

One continuous 33-second shot at night, all of it real phenomena that are almost never seen:

1. a fast weave between the overshooting tops of a line of thunderstorms, 15 km up;
2. **transient luminous events** above a distant anvil: an **elve**, a cluster of **red sprites**
   (slowed down about 300×), and a **blue jet** leaving the top of a nearer cell;
3. a roll inverted and a dive straight down through the main updraft, lightning channels
   crossing the path;
4. breaking out under the cloud base over the plains, and a low run along a wet highway toward
   a **tornado** lit by lightning and by the **power flashes** of the lines it tears down, while
   the town behind it goes dark block by block.

## Run

```bash
node tools/server.mjs
```

Open <http://localhost:5179>. It plays in real time and loops; click for sound. Any static
file host works too (the repository root is the site).

| URL | What it does |
| --- | --- |
| `/` | live playback, 1280×720, half-resolution clouds |
| `/?start=18` | start playback at 18 s |
| `/?t=23.0` | hold one moment (look-dev) |
| `/?t=23.0&hq` | the same moment at export quality |
| `/?capture` | render all frames offline and encode `out/above-the-storm.mp4` |
| `/?capture&w=3840&h=2160&spp=4` | 4K export with more sub-frames |

Capture needs `ffmpeg` on the PATH. Frames are rendered from the frame number, not the clock,
so the export is deterministic and independent of machine speed.

## How it works

| File | Role |
| --- | --- |
| `src/timeline.js` | the film as functions of time: camera path, storm cells, lightning, lamps |
| `src/noise.js` | tiling Perlin-Worley 3D noise volume, generated at load |
| `src/world.js` | one ray-march for everything solid or cloudy: sky, anvil and updraft, cloud base, tornado, rain, procedural plains, sphere-traced poles and farmsteads |
| `src/lights.js` | lightning channels, street lamps and headlights, rain streaks (additive geometry) |
| `src/sprites.js` | sprites, halo, elve and jet as branching additive ribbons with per-vertex arrival times |
| `src/post.js` | HDR bloom pyramid, ACES tone map, grain |
| `src/audio.js` | synthesised soundtrack (`OfflineAudioContext`), shared by playback and export |
| `src/main.js` | live loop and frame-by-frame capture with sub-frame accumulation |
| `tools/server.mjs` | zero-dependency server; receives frames and runs ffmpeg |

World units are kilometres. `vendor/` holds three.js r180 (MIT).
