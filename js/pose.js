// ---------------------------------------------------------------------------
// MediaPipe Pose Landmarker setup (runs fully in the browser via WebAssembly).
// Requires internet access at runtime to fetch the WASM bundle + model file.
// ---------------------------------------------------------------------------

const CDN_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_URL = `${CDN_URL}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export async function createLandmarker(onStatus = () => {}) {
  // Lazy CDN import: if this fails (offline, blocked CDN) the app UI still
  // works and the error surfaces to the user, instead of killing the whole
  // module graph at page load.
  onStatus('Loading pose engine…');
  let FilesetResolver;
  let PoseLandmarker;
  try {
    ({ FilesetResolver, PoseLandmarker } = await import(CDN_URL));
  } catch (err) {
    throw new Error(
      'Could not load the pose engine from the CDN — check your internet connection. ' +
      `(${err.message})`,
    );
  }

  onStatus('Loading pose model…');
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);

  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  try {
    return await PoseLandmarker.createFromOptions(vision, options('GPU'));
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU:', err);
    onStatus('Loading pose model (CPU)…');
    return PoseLandmarker.createFromOptions(vision, options('CPU'));
  }
}

// In VIDEO running mode the landmarker requires strictly increasing timestamps
// across its entire lifetime — but we reuse one instance for every upload, and
// each clip's clock restarts at zero. Shift each clip's timestamps past
// everything the landmarker has already seen; the 1 s gap also tells its
// tracker not to carry state over from the previous clip.
let lastTs = -1000;
let tsBase = 0;

// Call once before the first detectFrame of each new clip.
export function beginClip() {
  tsBase = lastTs + 1000;
}

// Detect pose on the current video frame. Returns null if no person was
// found, else { lm, world }:
//   lm    — 33 landmarks in PIXEL coordinates {x, y, z, v}; z is depth (hip
//           midpoint = 0, negative = toward the camera) on roughly the x
//           scale, used by view detection to spot oblique camera angles.
//   world — the same 33 landmarks in real-world METERS (hip midpoint ≈
//           origin), used for the 3D metrics in diagonal views and for
//           converting pixel measurements to centimeters.
export function detectFrame(landmarker, video, tSeconds) {
  const ts = tsBase + Math.round(tSeconds * 1000);
  lastTs = Math.max(lastTs, ts);
  const result = landmarker.detectForVideo(video, ts);
  const lm = result.landmarks && result.landmarks[0];
  if (!lm) return null;
  const worldLm = result.worldLandmarks && result.worldLandmarks[0];
  return {
    lm: lm.map((p) => ({
      x: p.x * video.videoWidth,
      y: p.y * video.videoHeight,
      z: (p.z ?? 0) * video.videoWidth,
      v: p.visibility ?? 1,
    })),
    world: worldLm
      ? worldLm.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 }))
      : null,
  };
}
