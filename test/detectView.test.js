// Unit tests for camera-view detection (front / back / side / diagonals).
// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectView, LM } from '../js/analysis.js';

// Build a frame from shoulder/hip positions. Coordinates are pixels in a
// nominal 600x800 image; y grows downward. Torso height is 200 px.
function frame({ slx, srx, hlx, hrx, slz = 0, srz = 0, noseV = 0.95 }) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
  lm[LM.NOSE] = { x: 300, y: 80, z: 0, v: noseV };
  lm[LM.L_SHOULDER] = { x: slx, y: 200, z: slz, v: 0.9 };
  lm[LM.R_SHOULDER] = { x: srx, y: 200, z: srz, v: 0.9 };
  lm[LM.L_HIP] = { x: hlx, y: 400, z: 0, v: 0.9 };
  lm[LM.R_HIP] = { x: hrx, y: 400, z: 0, v: 0.9 };
  // Feet pointing image-right, for side-view facing detection.
  lm[LM.L_HEEL] = { x: 290, y: 700, z: 0, v: 0.9 };
  lm[LM.L_FOOT] = { x: 320, y: 710, z: 0, v: 0.9 };
  lm[LM.R_HEEL] = { x: 290, y: 705, z: 0, v: 0.9 };
  lm[LM.R_FOOT] = { x: 320, y: 715, z: 0, v: 0.9 };
  return { t: 0, lm };
}

const many = (spec) => Array.from({ length: 40 }, () => frame(spec));

test('head-on front view', () => {
  // Facing the camera: subject's left shoulder/hip on the image's right.
  const v = detectView(many({ slx: 360, srx: 240, hlx: 330, hrx: 270 }));
  assert.equal(v.kind, 'front');
  assert.equal(v.back, false);
  assert.equal(v.angled, false);
});

test('back view with a "visible" nose is still classified as back', () => {
  // The regression: filming from behind, but the model reports high nose
  // visibility. Left/right image ordering must win over nose visibility.
  const v = detectView(many({ slx: 240, srx: 360, hlx: 270, hrx: 330, noseV: 0.85 }));
  assert.equal(v.kind, 'back');
});

test('diagonal back view → back-diagonal, even with a front-like width ratio', () => {
  // Shoulders 120 px apart in-image (ratio 0.6 = front band) but with a large
  // depth split — the camera is oblique.
  const v = detectView(many({ slx: 240, srx: 360, hlx: 270, hrx: 330, slz: 80, srz: -80 }));
  assert.equal(v.kind, 'back-diagonal');
  assert.equal(v.angled, true);
});

test('diagonal front view → front-diagonal', () => {
  const v = detectView(many({ slx: 360, srx: 240, hlx: 330, hrx: 270, slz: -80, srz: 80 }));
  assert.equal(v.kind, 'front-diagonal');
});

test('mid-band width ratio (between front and side) → diagonal', () => {
  // Shoulder width 80 px / torso 200 px = 0.4, inside the mid band.
  const v = detectView(many({ slx: 340, srx: 260, hlx: 325, hrx: 275 }));
  assert.equal(v.kind, 'front-diagonal');
});

test('ambiguous ordering falls back to nose visibility', () => {
  // Half the frames vote front, half vote back (label flicker) — the nose
  // being hidden should break the tie toward back.
  const a = many({ slx: 360, srx: 240, hlx: 330, hrx: 270, noseV: 0.3 }).slice(0, 20);
  const b = many({ slx: 240, srx: 360, hlx: 270, hrx: 330, noseV: 0.3 }).slice(0, 20);
  const v = detectView([...a, ...b]);
  assert.equal(v.back, true);
});

test('side view stays side, facing from toe direction', () => {
  const v = detectView(many({ slx: 315, srx: 285, hlx: 312, hrx: 288 }));
  assert.equal(v.kind, 'side');
  assert.equal(v.facing, 1);
});

test('frames without z still classify (no oblique signal)', () => {
  const frames = many({ slx: 360, srx: 240, hlx: 330, hrx: 270 });
  for (const f of frames) for (const p of f.lm) delete p.z;
  const v = detectView(frames);
  assert.equal(v.kind, 'front');
});
