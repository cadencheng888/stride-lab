# Stride Lab — running form analyzer

Upload a video of yourself running — **front, back, or side view, auto-detected**
(ideally on a treadmill) — and get:

- a **skeleton overlay** on your video with the joints driving each issue flagged in red
- **five metrics per view**, each scored good / fair / needs-work
- **coaching feedback + strengthening exercises** for anything flagged

Angled/oblique clips also work: the app runs the nearer view's metric set and
warns that angle-based numbers are approximate.

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
running-biomechanics literature for the noise level of single-camera 2D pose:

**Any view:**

| Metric | How it's measured | Good | Fair | Needs work |
|---|---|---|---|---|
| Cadence | footstrikes (ankle-height peaks, both feet) per minute | 165–190 spm | 155–200 | outside |

**Front view** (a back view — detected from the left/right image ordering of
the shoulders and hips, with face visibility as a tiebreaker — uses the same
metric set; the app warns that left/right labels can occasionally swap when the
face is hidden):

| Metric | How it's measured | Good | Fair | Needs work |
|---|---|---|---|---|
| Hip drop | max contralateral pelvic-drop angle during stance | ≤ 6° | ≤ 10° | > 10° |
| Knee valgus | frontal-plane projection angle (hip–knee–ankle), medial = positive | ≤ 10° | ≤ 18° | > 18° |
| Crossover gait | foot distance past body midline at contact, % of hip width | ≤ 5% | ≤ 20% | > 20% |
| Arm crossover | % of frames a wrist swings past the midline (beyond 15% of shoulder width) | ≤ 15% | ≤ 35% | > 35% |

**Side view:**

| Metric | How it's measured | Good | Fair | Needs work |
|---|---|---|---|---|
| Overstride | shin angle at footstrike (ankle ahead of knee = positive) | ≤ 8° | ≤ 15° | > 15° |
| Trunk lean | mid-hip→mid-shoulder line vs vertical, forward = positive | 0–12° | −4–18° | outside |
| Knee bend at landing | knee flexion at initial contact (**higher is better**) | ≥ 8° | ≥ 4° | < 4° |
| Vertical bounce | hip vertical range as % of leg length | ≤ 9% | ≤ 12% | > 12% |

Sides are reported separately (hip drop is attributed to the **stance** leg —
the side whose glutes should be preventing the drop).

## Limitations (by design)

- **Each view sees only its own plane.** A front view can't see overstriding or
  trunk lean; a side view can't see hip drop, valgus, or crossover. Oblique
  camera angles distort angle measurements — the app warns and treats them as
  approximate rather than refusing.
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
