// End-to-end smoke tests for analyze(): synthetic running clips per camera
// view, checking that the right metric set is produced and values are sane.
// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, LM } from '../js/analysis.js';

const FPS = 20;
const W = 600;
const H = 800;
const STEP_HZ = 1.5; // per foot → 180 spm both feet

// Synthetic runner: torso fixed, ankles oscillating in antiphase (image y
// grows downward; ankle y max = ground contact).
function makeClip({ seconds = 10, view = 'front', world = false }) {
  const frames = [];
  const nFrames = Math.round(seconds * FPS);
  for (let i = 0; i < nFrames; i += 1) {
    const t = i / FPS;
    const phase = 2 * Math.PI * STEP_HZ * t;
    const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
    const set = (idx, x, y, z = 0, v = 0.9) => { lm[idx] = { x, y, z, v }; };

    // Frontal-view geometry by default (subject's left on image right).
    let sl = [360, 200]; let sr = [240, 200];
    let hl = [330, 400]; let hr = [270, 400];
    let slz = 0; let srz = 0;
    if (view === 'back') { sl = [240, 200]; sr = [360, 200]; hl = [270, 400]; hr = [330, 400]; }
    if (view === 'back-diagonal') {
      sl = [240, 200]; sr = [360, 200]; hl = [270, 400]; hr = [330, 400];
      slz = 80; srz = -80;
    }
    if (view === 'side') { sl = [315, 200]; sr = [285, 200]; hl = [312, 400]; hr = [288, 400]; }

    set(LM.NOSE, 300, 80, 0, view.startsWith('back') ? 0.4 : 0.95);
    set(LM.L_SHOULDER, sl[0], sl[1], slz);
    set(LM.R_SHOULDER, sr[0], sr[1], srz);
    set(LM.L_HIP, hl[0], hl[1]);
    set(LM.R_HIP, hr[0], hr[1]);
    set(LM.L_ELBOW, sl[0] + 5, 300);
    set(LM.R_ELBOW, sr[0] - 5, 300);
    set(LM.L_WRIST, sl[0], 360);
    set(LM.R_WRIST, sr[0], 360);

    const yL = 700 + 40 * Math.sin(phase);
    const yR = 700 - 40 * Math.sin(phase);
    set(LM.L_KNEE, hl[0] - 5, 550);
    set(LM.R_KNEE, hr[0] + 5, 550);
    set(LM.L_ANKLE, hl[0], yL);
    set(LM.R_ANKLE, hr[0], yR);
    set(LM.L_HEEL, hl[0] - 5, yL + 15);
    set(LM.R_HEEL, hr[0] - 5, yR + 15);
    set(LM.L_FOOT, hl[0] + 25, yL + 20);
    set(LM.R_FOOT, hr[0] + 25, yR + 20);

    const frame = { t, lm, world: null };
    if (world) {
      // Matching world landmarks in meters, hip midpoint at origin.
      const wl = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
      const wset = (idx, x, y, z, v = 0.9) => { wl[idx] = { x, y, z, v }; };
      const swing = 0.15 * Math.sin(phase); // thigh swing fore/aft
      wset(LM.NOSE, 0, -0.65, 0.05);
      wset(LM.L_SHOULDER, -0.18, -0.5, 0);
      wset(LM.R_SHOULDER, 0.18, -0.5, 0);
      wset(LM.L_HIP, -0.1, 0, 0);
      wset(LM.R_HIP, 0.1, 0, 0);
      wset(LM.L_ELBOW, -0.22, -0.3, 0.02);
      wset(LM.R_ELBOW, 0.22, -0.3, 0.02);
      wset(LM.L_KNEE, -0.1, 0.45, swing);
      wset(LM.R_KNEE, 0.1, 0.45, -swing);
      wset(LM.L_ANKLE, -0.1, 0.85, swing * 1.5);
      wset(LM.R_ANKLE, 0.1, 0.85, -swing * 1.5);
      wset(LM.L_HEEL, -0.1, 0.92, swing * 1.5 - 0.08);
      wset(LM.R_HEEL, 0.1, 0.92, -swing * 1.5 - 0.08);
      wset(LM.L_FOOT, -0.1, 0.95, swing * 1.5 + 0.12);
      wset(LM.R_FOOT, 0.1, 0.95, -swing * 1.5 + 0.12);
      frame.world = wl;
    }
    frames.push(frame);
  }
  return frames;
}

const run = (frames) => analyze(frames, { fps: FPS, width: W, height: H });

test('front view produces the anterior metric set', () => {
  const r = run(makeClip({ view: 'front' }));
  assert.equal(r.error, undefined);
  assert.equal(r.view.kind, 'front');
  assert.deepEqual(r.metricOrder, ['cadence', 'valgus', 'armCross', 'latTrunk', 'kneeWindow']);
  assert.ok(Math.abs(r.metrics.cadence.value - 180) < 12, `cadence ${r.metrics.cadence.value}`);
});

test('back view produces the posterior metric set', () => {
  const r = run(makeClip({ view: 'back' }));
  assert.equal(r.error, undefined);
  assert.equal(r.view.kind, 'back');
  assert.deepEqual(r.metricOrder, ['cadence', 'hipDrop', 'rearfoot', 'stepWidth', 'crossover', 'heelWhip', 'shoulderTilt']);
});

test('side view produces the sagittal metric set with GCT and flight', () => {
  const r = run(makeClip({ view: 'side' }));
  assert.equal(r.error, undefined);
  assert.equal(r.view.kind, 'side');
  assert.deepEqual(r.metricOrder,
    ['cadence', 'gct', 'flight', 'vertOsc', 'overstrideDist', 'overstride', 'kneeFlex', 'kneeSwing', 'trunkLean']);
  const gct = r.metrics.gct;
  assert.ok(gct.left !== null || gct.right !== null, 'expected some GCT measurement');
});

test('back-diagonal view produces the 3D posterior metric set', () => {
  const r = run(makeClip({ view: 'back-diagonal', world: true }));
  assert.equal(r.error, undefined);
  assert.equal(r.view.kind, 'back-diagonal');
  assert.deepEqual(r.metricOrder, ['cadence', 'hipExt3d', 'eversionVel', 'pushoffStab', 'driveAngle']);
  // With world landmarks present, hip extension should actually be measured.
  const ext = r.metrics.hipExt3d;
  assert.ok(ext.left !== null || ext.right !== null, 'expected 3D hip extension values');
});

test('back view: foot crossing the midline during stance is flagged as crossover', () => {
  // Reproduces the reported miss: the right foot lands at/past the body
  // midline (x = 300) and the shoe (heel/toe) crosses even further than the
  // ankle joint. Must not read as "good".
  const frames = makeClip({ view: 'back' });
  for (const f of frames) {
    f.lm[LM.R_ANKLE].x = 292;
    f.lm[LM.R_HEEL].x = 285;
    f.lm[LM.R_FOOT].x = 287;
  }
  const r = run(frames);
  assert.equal(r.error, undefined);
  assert.equal(r.view.kind, 'back');
  const cross = r.metrics.crossover;
  // Hip width is 60 px; heel 15 px past midline → 25% of hip width.
  assert.ok(cross.right > 20, `expected right crossover > 20%, got ${cross.right}`);
  assert.ok(cross.status === 'bad' || cross.status === 'warn', `status was ${cross.status}`);
  // The left foot stays on its own side.
  assert.ok(cross.left !== null && cross.left <= 10, `left was ${cross.left}`);
});

test('diagonal view without world landmarks degrades gracefully', () => {
  const r = run(makeClip({ view: 'back-diagonal', world: false }));
  assert.equal(r.error, undefined);
  assert.equal(r.view.kind, 'back-diagonal');
  assert.equal(r.metrics.hipExt3d.status, 'na');
  assert.ok(r.warnings.some((w) => w.includes('3D world landmarks')));
});

test('cm scale: side-view vertical oscillation is reported in cm when world data exists', () => {
  const r = run(makeClip({ view: 'side', world: true }));
  assert.equal(r.error, undefined);
  // Ankle amplitude is synthetic, but the value must be a finite number in a
  // plausible range (not px): leg ≈ 0.85 m over ~300 px → scale ≈ 0.28 cm/px.
  const osc = r.metrics.vertOsc.value;
  assert.ok(osc === null || (osc >= 0 && osc < 30), `vertOsc ${osc}`);
});
