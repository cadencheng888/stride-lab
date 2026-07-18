# Stride Lab — running form analyzer

Upload a video of yourself running — **front, back, side, or diagonal view,
auto-detected** (ideally on a treadmill) — and get:

- a **skeleton overlay** on your video with the joints driving each issue flagged in red
- **a metric set specific to the detected camera angle**, each metric scored good / fair / needs-work
- **coaching feedback + strengthening exercises** for anything flagged

Each camera angle sees different mechanics, so each gets its own metric set:
side (sagittal), front (anterior), back (posterior), and two **diagonal views
that use MediaPipe's 3D world landmarks**, which tolerate camera skew.

Everything runs **in your browser** (MediaPipe Pose via WebAssembly). Your video
never leaves your device — there is no backend and no upload.

## Run it

From this folder:

```bash
npm start   # python3 serve.py — http.server with caching disabled
# then open http://localhost:8000
```

Any static file server works, but plain `python3 -m http.server` sends no
`Cache-Control` header, so the browser can keep running stale JS after code
changes — `serve.py` disables caching.

> Internet access is required at runtime the first time: the pose model (~9 MB)
> and its WASM runtime load from Google's/jsDelivr's CDNs.

## How to film

1. **Treadmill**, phone propped at ~hip height, 10–15 ft away — **head-on for frontal metrics, perpendicular (side-on) for sagittal metrics**. The view is auto-detected from body geometry: shoulder width vs torso height for front/side, left/right landmark ordering for front-vs-back, and landmark depth for oblique camera angles. Side views also auto-detect which way you're facing (toes point forward).
2. **Whole body in frame** the entire clip, decent lighting, fitted clothing.
3. **10–20 s of steady running** at your normal pace. Only the first 30 s are analyzed.

For the full picture, run one clip of each view — the planes see different issues.

## How it works (pipeline)

```
video file
  → seek through frames at 20 fps
  → MediaPipe Pose Landmarker (33 keypoints per frame, in-browser)
  → signal processing (gap-fill, smoothing, peak detection on ankle height → footstrikes)
  → frontal-plane metrics per footstrike
  → threshold scoring → overlay flags + stat tiles + exercise feedback
```

| File | Role |
|---|---|
| `js/pose.js` | MediaPipe setup + per-frame detection (GPU with CPU fallback) |
| `js/analysis.js` | Pure math: signal utils, footstrike detection, all metrics. No DOM — unit-testable under Node. |
| `js/config.js` | Thresholds + all coaching/exercise content. Tune here. |
| `js/app.js` | UI orchestration, processing loop, canvas overlay, results rendering |
| `serve.py` | Dev static server (`npm start`) with HTTP caching disabled |
| `test/` | Node unit tests for the analysis module |

## Tests

The analysis module is DOM-free, so it runs under plain Node:

```bash
npm test   # node --test
```

## Metrics & thresholds

All thresholds are **screening heuristics** (see `js/config.js`), adapted from
running-biomechanics literature for the noise level of single-camera pose.
The camera view is auto-detected (shoulder-width/torso ratio for front vs side,
left/right landmark ordering for front vs back, landmark depth tilt for
diagonal) and selects the metric set. Real-world units (cm) come from scaling
pixel measurements by the runner's leg length in MediaPipe's world landmarks.

**Any view:** cadence (footstrikes per minute, both feet) — good 165–190 spm.

**Side view (sagittal)** — propulsion, braking, vertical efficiency:
ground contact time (ms per stance, from the ankle's contact band), flight time
(ms with both feet airborne), vertical oscillation (cm of mid-hip bounce),
overstride distance (cm the foot lands ahead of the hips), overstride shin
angle at contact, knee flexion at contact (higher is better), heel recovery
(peak swing knee flexion, higher is better), trunk forward lean.

**Back view (posterior coronal)** — lateral stability, symmetry:
pelvic drop (Trendelenburg angle in stance), rearfoot eversion at mid-stance
(heel line vs calf line — a coarse pronation proxy), step width (cm between
consecutive foot strikes), crossover stride (% past the midline), heel whip
(sideways heel deviation after toe-off), shoulder tilt vs horizontal.

**Front view (anterior coronal)** — alignment and tracking:
knee valgus (frontal-plane projection angle), arm crossover distance (% of
shoulder width the hands travel past the midline), lateral trunk flexion,
knee window (% of strides keeping daylight between the knees at mid-stance).

**Front-diagonal view (anterior oblique, 3D)** — computed from world landmarks
in the runner's own axes (down/right/forward derived from the body, so camera
skew doesn't distort angles): 3D knee tracking over toes (inward drift off the
hip–ankle line), trunk-on-pelvis rotation (transverse plane), elbow flare,
anterior hip flexion (peak thigh drive in swing).

**Back-diagonal view (posterior oblique, 3D)** — posterior-chain mechanics:
3D hip extension at toe-off (thigh behind the torso axis, higher is better),
ankle eversion velocity after contact, push-off ankle stability (foot rotation
/ wobble vs direction of travel), rear-leg drive path (heel should travel up,
not out).

Sides are reported separately (pelvic drop is attributed to the **stance** leg —
the side whose glutes should be preventing the drop). Exact bands for every
metric live in `js/config.js`; the 3D-view thresholds are the most provisional
and are marked as experimental in the UI.

## Limitations (by design)

- **Each view sees only its own plane.** A front view can't see overstriding or
  trunk lean; a side view can't see hip drop, valgus, or crossover. Diagonal
  views switch to 3D world-landmark metrics, which tolerate camera skew but are
  the noisiest of the sets — the app labels them experimental.
- Ground contact time, flight time, and eversion velocity are limited by the
  20 fps sampling (±50 ms per boundary); medians over many steps recover some
  precision, but treat them as coarse.
- In a true side view the far leg is often occluded; per-side numbers may be
  incomplete (the app says so when it happens).
- 2D pose from one camera ≈ screening tool, **not** a clinical gait analysis.
- Cadence is speed-dependent; judge it against the pace in the clip.
- Baggy clothing, poor light, or a partial body in frame degrade tracking — the
  app warns when detection confidence is low.

## Ideas for v2

- Live camera mode (`getUserMedia`) — prop the phone, tap start, no file upload
- Combined report from a front clip + side clip of the same runner
- Per-step detail table + trends across multiple uploads
- LLM-written coaching summary (feed `results.metrics` to the Claude API and ask
  for a personalized paragraph combining the flagged issues)
- Export annotated video

---

*Not medical advice. If you have pain while running, see a physio or
sports-medicine professional.*
