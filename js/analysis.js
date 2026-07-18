// ---------------------------------------------------------------------------
// Pure gait analysis for running video. The camera view is auto-detected and
// selects the metric set:
//
//   side           — sagittal plane: propulsion, braking, vertical efficiency
//   front          — anterior coronal: alignment, rotational leaks, tracking
//   back           — posterior coronal: lateral stability, symmetry
//   front-diagonal — anterior oblique: 3D tracking + rotation (world landmarks)
//   back-diagonal  — posterior oblique: 3D posterior-chain mechanics
//
// Input: an array of frames [{ t, lm, world }] where lm is either null (no
// person detected) or an array of 33 MediaPipe pose landmarks in PIXEL
// coordinates { x, y, z, v } (v = visibility 0..1, image y grows DOWNWARD,
// z = depth on roughly the x scale), and world is the matching array of 3D
// world landmarks in METERS (hip midpoint ≈ origin) or null.
//
// The side/front/back sets use 2D image geometry; the two diagonal sets are
// computed in the 3D world space, so they tolerate camera skew.
//
// No DOM access — this module is unit-testable under Node.
// ---------------------------------------------------------------------------

import { THRESHOLDS } from './config.js';

// MediaPipe Pose landmark indices.
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32,
};

const MIN_VIS = 0.5;
const DEG = 180 / Math.PI;

// View classification bands on median(shoulderWidth / torsoHeight):
// head-on runners measure ~0.55-0.75, true side profiles ~0.05-0.25.
const VIEW_FRONT = 0.45; // >= this: clean front view
const VIEW_MID = 0.36;   // between SIDE and FRONT: diagonal; frontal set wins
const VIEW_SIDE = 0.28;  // <= this: clean side view

// Back-vs-front: minimum |left/right ordering vote| to trust it over the
// nose-visibility fallback (the model often reports a "visible" face from
// behind, so visibility alone misclassifies back views as front).
const BACK_ORDER_MIN = 0.3;
// Frontal views whose shoulder line tilts more than this out of the image
// plane (via landmark depth) are treated as diagonal even when the
// width/height ratio still looks head-on.
const OBLIQUE_TILT_DEG = 25;

// --- signal utilities -------------------------------------------------------

export function seriesOf(frames, idx, axis) {
  return frames.map((f) => {
    const p = f.lm && f.lm[idx];
    return p && p.v >= MIN_VIS ? p[axis] : null;
  });
}

// Linearly interpolate short runs of nulls (tracking dropouts).
export function fillGaps(arr, maxGap = 5) {
  const out = arr.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) { i += 1; continue; }
    let j = i;
    while (j < out.length && out[j] === null) j += 1;
    const gap = j - i;
    const before = i > 0 ? out[i - 1] : null;
    const after = j < out.length ? out[j] : null;
    if (gap <= maxGap && before !== null && after !== null) {
      for (let k = i; k < j; k += 1) {
        out[k] = before + ((after - before) * (k - i + 1)) / (gap + 1);
      }
    }
    i = j;
  }
  return out;
}

// Moving average that ignores nulls.
export function smooth(arr, win = 5) {
  const half = Math.floor(win / 2);
  return arr.map((v, i) => {
    if (v === null) return null;
    let sum = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k += 1) {
      if (k >= 0 && k < arr.length && arr[k] !== null) { sum += arr[k]; n += 1; }
    }
    return n ? sum / n : null;
  });
}

export function percentile(arr, p) {
  const valid = arr.filter((v) => v !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const idx = Math.min(valid.length - 1, Math.max(0, Math.round((p / 100) * (valid.length - 1))));
  return valid[idx];
}

export function median(arr) {
  return percentile(arr, 50);
}

// Local-maxima peak finder with prominence + min-distance filtering.
export function findPeaks(arr, { minDistance = 1, minProminence = 0 } = {}) {
  const candidates = [];
  for (let i = 1; i < arr.length - 1; i += 1) {
    const v = arr[i];
    if (v === null || arr[i - 1] === null || arr[i + 1] === null) continue;
    if (v > arr[i - 1] && v >= arr[i + 1]) {
      // Prominence: walk outward on each side until a higher point (or the
      // end), tracking the minimum along the way.
      let leftMin = v;
      for (let k = i - 1; k >= 0; k -= 1) {
        const a = arr[k];
        if (a === null) continue;
        if (a > v) break;
        if (a < leftMin) leftMin = a;
      }
      let rightMin = v;
      for (let k = i + 1; k < arr.length; k += 1) {
        const a = arr[k];
        if (a === null) continue;
        if (a > v) break;
        if (a < rightMin) rightMin = a;
      }
      const prom = v - Math.max(leftMin, rightMin);
      if (prom >= minProminence) candidates.push({ i, v });
    }
  }
  // Enforce min distance, keeping the taller peak on conflicts.
  candidates.sort((a, b) => b.v - a.v);
  const accepted = [];
  for (const c of candidates) {
    if (accepted.every((a) => Math.abs(a.i - c.i) >= minDistance)) accepted.push(c);
  }
  return accepted.map((c) => c.i).sort((a, b) => a - b);
}

// --- 2D geometry -------------------------------------------------------------

function vis(f, idx) {
  const p = f.lm && f.lm[idx];
  return p && p.v >= MIN_VIS ? p : null;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Angle at vertex b (degrees) formed by points a-b-c.
export function angleAt(a, b, c) {
  const v1x = a.x - b.x; const v1y = a.y - b.y;
  const v2x = c.x - b.x; const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y); const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 180;
  return Math.acos(Math.min(1, Math.max(-1, dot / (m1 * m2)))) * DEG;
}

// Signed frontal-plane projection angle at the knee.
// Positive = knee deviates TOWARD the body midline (valgus).
export function signedFPPA(hip, knee, ankle, midX) {
  const fppa = 180 - angleAt(hip, knee, ankle);
  const dy = ankle.y - hip.y;
  if (Math.abs(dy) < 1e-6) return 0;
  const t = (knee.y - hip.y) / dy;
  const lineX = hip.x + (ankle.x - hip.x) * t; // hip→ankle line at knee height
  const towardMid = Math.sign(midX - lineX) || 1;
  const medial = Math.sign(knee.x - lineX) === towardMid;
  return medial ? fppa : -fppa;
}

// --- 3D geometry (world landmarks, meters) -----------------------------------

function wpt(f, idx) {
  const p = f.world && f.world[idx];
  return p && (p.v ?? 1) >= MIN_VIS ? p : null;
}

const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale3 = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const mag3 = (a) => Math.hypot(a.x, a.y, a.z);
const neg3 = (a) => scale3(a, -1);
const cross3 = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (a) => {
  const m = mag3(a);
  return m > 1e-9 ? scale3(a, 1 / m) : null;
};
// Component of a perpendicular to unit axis u.
const perp3 = (a, u) => sub3(a, scale3(u, dot3(a, u)));
// Unsigned angle between two 3D vectors, degrees.
const angle3 = (a, b) => Math.atan2(mag3(cross3(a, b)), dot3(a, b)) * DEG;

const mid3 = (a, b) => scale3(add3(a, b), 0.5);

// Body reference axes derived from the runner, not the camera — this is what
// makes the diagonal-view metrics tolerant of camera skew. On a treadmill the
// runner's orientation is stable, so one set of axes per clip suffices.
//   down:  torso axis, shoulders → hips
//   right: subject's left → right (from labeled shoulders/hips)
//   fwd:   direction of travel (toes point forward)
function bodyAxes(frames) {
  const downSum = { x: 0, y: 0, z: 0 };
  const rightSum = { x: 0, y: 0, z: 0 };
  const fwdSum = { x: 0, y: 0, z: 0 };
  let n = 0;
  for (const f of frames) {
    const sl = wpt(f, LM.L_SHOULDER); const sr = wpt(f, LM.R_SHOULDER);
    const hl = wpt(f, LM.L_HIP); const hr = wpt(f, LM.R_HIP);
    if (!sl || !sr || !hl || !hr) continue;
    n += 1;
    const d = sub3(mid3(hl, hr), mid3(sl, sr));
    downSum.x += d.x; downSum.y += d.y; downSum.z += d.z;
    const r1 = sub3(sr, sl); const r2 = sub3(hr, hl);
    rightSum.x += r1.x + r2.x; rightSum.y += r1.y + r2.y; rightSum.z += r1.z + r2.z;
    for (const [heelI, toeI] of [[LM.L_HEEL, LM.L_FOOT], [LM.R_HEEL, LM.R_FOOT]]) {
      const heel = wpt(f, heelI); const toe = wpt(f, toeI);
      if (heel && toe) {
        const fv = sub3(toe, heel);
        fwdSum.x += fv.x; fwdSum.y += fv.y; fwdSum.z += fv.z;
      }
    }
  }
  if (n < 5) return null;
  const down = norm3(downSum);
  if (!down) return null;
  const right = norm3(perp3(rightSum, down));
  const fwd = norm3(perp3(fwdSum, down));
  if (!right || !fwd) return null;
  return { down, right, fwd };
}

// --- status helpers ----------------------------------------------------------

// Lower is better (hip drop, valgus, overstride, …).
export function bandStatus(value, { good, warn }) {
  if (value === null || value === undefined) return 'na';
  if (value <= good) return 'good';
  if (value <= warn) return 'warn';
  return 'bad';
}

// Higher is better (knee flexion at landing, hip extension, …).
export function bandStatusMin(value, { good, warn }) {
  if (value === null || value === undefined) return 'na';
  if (value >= good) return 'good';
  if (value >= warn) return 'warn';
  return 'bad';
}

// In-range is best (cadence, trunk lean, step width, flight).
export function rangeStatus(value, { goodMin, goodMax, warnMin, warnMax }) {
  if (value === null || value === undefined) return 'na';
  if (value >= goodMin && value <= goodMax) return 'good';
  if (value >= warnMin && value <= warnMax) return 'warn';
  return 'bad';
}

const RANK = { na: 0, good: 1, warn: 2, bad: 3 };
export function worst(...statuses) {
  return statuses.reduce((acc, s) => (RANK[s] > RANK[acc] ? s : acc), 'na');
}

// --- view detection ------------------------------------------------------------

// Classify the camera view from body geometry. Returns { kind, mode, angled,
// facing, back, ratio } where kind ∈ side | front | back | front-diagonal |
// back-diagonal selects the metric set (mode is the coarse frontal/side split
// kept for overlay logic).
export function detectView(frames) {
  const ratios = [];
  const noseVis = [];
  const tilts = []; // shoulder-line rotation out of the image plane, degrees
  let facingSum = 0;
  let orderSum = 0; // + = subject's left on the image's right = facing camera
  let orderFrames = 0;
  for (const f of frames) {
    const sl = vis(f, LM.L_SHOULDER); const sr = vis(f, LM.R_SHOULDER);
    const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
    if (sl && sr && hl && hr) {
      const shW = Math.abs(sl.x - sr.x);
      const torso = Math.abs((hl.y + hr.y) / 2 - (sl.y + sr.y) / 2);
      if (torso > 1) ratios.push(shW / torso);
      orderSum += Math.sign(sl.x - sr.x) + Math.sign(hl.x - hr.x);
      orderFrames += 1;
      if (typeof sl.z === 'number' && typeof sr.z === 'number') {
        tilts.push(Math.atan2(Math.abs(sl.z - sr.z), Math.abs(sl.x - sr.x)) * DEG);
      }
    }
    if (f.lm && f.lm[LM.NOSE]) noseVis.push(f.lm[LM.NOSE].v);
    for (const [heelI, toeI] of [[LM.L_HEEL, LM.L_FOOT], [LM.R_HEEL, LM.R_FOOT]]) {
      const heel = vis(f, heelI); const toe = vis(f, toeI);
      if (heel && toe) facingSum += Math.sign(toe.x - heel.x);
    }
  }

  const r = median(ratios);
  const facing = facingSum >= 0 ? 1 : -1; // +1 = runner faces image-right

  // Front vs back: facing the camera puts the subject's LEFT shoulder/hip on
  // the image's RIGHT (x grows rightward), so the anatomical labels carry the
  // answer. Nose visibility is only a fallback for ambiguous ordering — the
  // model often reports a confidently "visible" face from behind.
  const orderScore = orderFrames ? orderSum / (2 * orderFrames) : 0;
  const medNose = median(noseVis);
  const noseHidden = medNose !== null && medNose < 0.7;
  const back = Math.abs(orderScore) >= BACK_ORDER_MIN ? orderScore < 0 : noseHidden;

  // Diagonal camera: the depth tilt of the shoulder line catches oblique views
  // whose width ratio still looks head-on (common when filming from behind at
  // an angle).
  const tilt = median(tilts);
  const oblique = tilt !== null && tilt > OBLIQUE_TILT_DEG;

  const frontalKind = (diag) => {
    if (back) return diag ? 'back-diagonal' : 'back';
    return diag ? 'front-diagonal' : 'front';
  };

  if (r === null) {
    return { mode: 'front', kind: 'front', angled: false, facing, back: false, ratio: null, unknown: true };
  }
  if (r >= VIEW_FRONT) {
    return { mode: 'front', kind: frontalKind(oblique), angled: oblique, facing, back, ratio: r };
  }
  if (r >= VIEW_MID) {
    // Between front and side: treat as a diagonal frontal view.
    return { mode: 'front', kind: frontalKind(true), angled: true, facing, back, ratio: r };
  }
  if (r > VIEW_SIDE) return { mode: 'side', kind: 'side', angled: true, facing, back: false, ratio: r };
  return { mode: 'side', kind: 'side', angled: false, facing, back: false, ratio: r };
}

// --- main entry ----------------------------------------------------------------

export function analyze(frames, { fps, width, height }) {
  const n = frames.length;
  const duration = n / fps;
  const dt = 1 / fps;
  const warnings = [];

  const validFrames = frames.filter((f) => f.lm).length;
  const detectionRate = n ? validFrames / n : 0;
  if (detectionRate < 0.4) {
    return {
      error:
        'Could not track a runner reliably in this video (pose detected in ' +
        `${Math.round(detectionRate * 100)}% of frames). Make sure the full body is visible ` +
        'and well lit.',
    };
  }
  if (detectionRate < 0.75) {
    warnings.push(
      `Pose was only detected in ${Math.round(detectionRate * 100)}% of frames — results may be noisy. ` +
      'Better lighting and a full-body framing will improve tracking.',
    );
  }

  // --- which way is the camera pointing? ------------------------------------
  const view = detectView(frames);
  if (view.unknown) {
    warnings.push('Could not determine the camera angle — assuming a front view.');
  } else if (view.kind === 'back') {
    warnings.push(
      'This looks like a back view. All posterior metrics work from behind, but the pose model ' +
      'can occasionally swap left/right labels when the face is hidden — trust the magnitudes, and ' +
      'double-check which side is which in the overlay before targeting one-sided exercises.',
    );
  }
  if (view.kind === 'front-diagonal' || view.kind === 'back-diagonal') {
    warnings.push(
      'Diagonal camera angle detected — using the 3D metric set computed from world landmarks. ' +
      'These are experimental: treat the numbers as rough screening, and film straight-on or ' +
      'side-on when you want the classic 2D metrics.',
    );
  } else if (view.kind === 'side' && view.angled) {
    warnings.push(
      'The camera looks angled rather than a true side view — overstride and trunk lean are ' +
      'approximate. Film perpendicular to the runner for reliable numbers.',
    );
  }

  // --- footstrike detection: peaks in ankle y (image y grows downward) ------
  const ank = {};
  for (const side of ['L', 'R']) {
    const series = smooth(fillGaps(seriesOf(frames, side === 'L' ? LM.L_ANKLE : LM.R_ANKLE, 'y')), 5);
    const lo = percentile(series, 5);
    const hi = percentile(series, 95);
    ank[side] = { series, lo, hi, range: lo !== null && hi !== null ? hi - lo : null };
  }

  const contactsFor = (a) => {
    if (a.range === null || a.range < height * 0.005) return []; // ankle barely moves → not running
    return findPeaks(a.series, {
      minDistance: Math.max(2, Math.round(0.35 * fps)),
      minProminence: a.range * 0.25,
    });
  };

  const events = [
    ...contactsFor(ank.L).map((i) => ({ side: 'L', frame: i, t: frames[i].t })),
    ...contactsFor(ank.R).map((i) => ({ side: 'R', frame: i, t: frames[i].t })),
  ].sort((a, b) => a.frame - b.frame);

  if (events.length < 4) {
    return {
      error:
        'Could not detect enough footstrikes to analyze. Use a clip with at least ' +
        '5–10 seconds of continuous running with the whole body in frame.',
    };
  }

  // A foot counts as "on the ground" while its ankle sits within 12% of its
  // lowest (contact) level. This yields stance windows → ground contact time,
  // toe-off frames, and flight time.
  const inContact = (side, i) => {
    const a = ank[side];
    const v = a.series[i];
    return v !== null && a.range !== null && v >= a.hi - a.range * 0.12;
  };
  for (const ev of events) {
    let s0 = ev.frame;
    let s1 = ev.frame;
    while (s0 - 1 >= 0 && inContact(ev.side, s0 - 1)) s0 -= 1;
    while (s1 + 1 < n && inContact(ev.side, s1 + 1)) s1 += 1;
    ev.stance = [s0, s1];
    ev.toeOff = s1;
    const gct = (s1 - s0 + 1) * dt * 1000;
    ev.gctMs = gct <= 500 ? gct : null; // longer = band bleed, not a real stance
  }

  // --- real-world scale (cm per pixel) from the 3D world landmarks ----------
  const pxLegSamples = [];
  const mLegSamples = [];
  for (const f of frames) {
    for (const side of ['L', 'R']) {
      const idx = side === 'L'
        ? [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE]
        : [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE];
      const [hip, knee, ankle] = idx.map((i) => vis(f, i));
      if (hip && knee && ankle) pxLegSamples.push(dist(hip, knee) + dist(knee, ankle));
      const [hipW, kneeW, ankleW] = idx.map((i) => wpt(f, i));
      if (hipW && kneeW && ankleW) {
        mLegSamples.push(mag3(sub3(hipW, kneeW)) + mag3(sub3(kneeW, ankleW)));
      }
    }
  }
  const pxLeg = median(pxLegSamples);
  const mLeg = median(mLegSamples);
  const cmPerPx = pxLeg && mLeg ? (mLeg * 100) / pxLeg : null;

  // --- shared bits -----------------------------------------------------------
  const span = events[events.length - 1].t - events[0].t;
  const cadence = span > 0 ? ((events.length - 1) / span) * 60 : null;

  const stanceHalf = Math.max(1, Math.round(0.1 * fps)); // ±100 ms window
  const frameFlags = frames.map(() => ({
    hip: false, valgusL: false, valgusR: false,
    crossL: false, crossR: false, armL: false, armR: false,
    lean: false, overL: false, overR: false, kneeL: false, kneeR: false,
  }));

  const legOf = (side) => ({
    hip: side === 'L' ? LM.L_HIP : LM.R_HIP,
    knee: side === 'L' ? LM.L_KNEE : LM.R_KNEE,
    ankle: side === 'L' ? LM.L_ANKLE : LM.R_ANKLE,
    heel: side === 'L' ? LM.L_HEEL : LM.R_HEEL,
    foot: side === 'L' ? LM.L_FOOT : LM.R_FOOT,
  });

  const evL = events.filter((e) => e.side === 'L');
  const evR = events.filter((e) => e.side === 'R');
  const agg = (evs, key) => median(evs.map((e) => (e[key] === null || e[key] === undefined ? null : e[key])));
  const sideMetric = (key, thresholds, statusFn = bandStatus) => {
    const left = agg(evL, key);
    const right = agg(evR, key);
    return { left, right, status: worst(statusFn(left, thresholds), statusFn(right, thresholds)) };
  };

  const metrics = {
    cadence: {
      value: cadence,
      status: rangeStatus(cadence, THRESHOLDS.cadence),
      detail: `${events.length} footstrikes detected`,
    },
  };
  let metricOrder;

  if (view.kind === 'side') {
    // =========================================================================
    // SIDE VIEW (sagittal): GCT, flight, vertical oscillation, overstride
    // distance + angle, knee flexion at contact, heel recovery, trunk lean
    // =========================================================================
    const facing = view.facing; // +1 = runner faces image-right

    for (const ev of events) {
      const leg = legOf(ev.side);
      const from = Math.max(0, ev.frame - stanceHalf);
      const to = Math.min(n - 1, ev.frame + stanceHalf);
      const f = frames[ev.frame];

      // Overstride angle: shin vs vertical at contact. Positive = ankle lands
      // ahead of the knee (reaching out in front → braking forces).
      let shinDeg = null;
      {
        const knee = vis(f, leg.knee); const ankle = vis(f, leg.ankle);
        if (knee && ankle && ankle.y > knee.y) {
          shinDeg = Math.atan2((ankle.x - knee.x) * facing, ankle.y - knee.y) * DEG;
          if (shinDeg > THRESHOLDS.overstride.good) {
            const key = ev.side === 'L' ? 'overL' : 'overR';
            for (let i = from; i <= to; i += 1) frameFlags[i][key] = true;
          }
        }
      }

      // Overstride distance: foot ahead of the hips at contact, cm.
      let overDistCm = null;
      {
        const ankle = vis(f, leg.ankle);
        const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
        const hipMid = hl && hr ? (hl.x + hr.x) / 2 : (hl ? hl.x : (hr ? hr.x : null));
        if (ankle && hipMid !== null && cmPerPx !== null) {
          overDistCm = Math.max(0, (ankle.x - hipMid) * facing) * cmPerPx;
        }
      }

      // Knee flexion at contact: a locked-out knee has no shock absorption.
      let kneeFlexDeg = null;
      {
        const hip = vis(f, leg.hip); const knee = vis(f, leg.knee); const ankle = vis(f, leg.ankle);
        if (hip && knee && ankle) {
          kneeFlexDeg = 180 - angleAt(hip, knee, ankle);
          if (kneeFlexDeg < THRESHOLDS.kneeFlex.good) {
            const key = ev.side === 'L' ? 'kneeL' : 'kneeR';
            for (let i = from; i <= to; i += 1) frameFlags[i][key] = true;
          }
        }
      }

      ev.shinDeg = shinDeg;
      ev.overDistCm = overDistCm;
      ev.kneeFlexDeg = kneeFlexDeg;
      ev.flagged =
        (shinDeg !== null && shinDeg > THRESHOLDS.overstride.good) ||
        (overDistCm !== null && overDistCm > THRESHOLDS.overstrideDist.good) ||
        (kneeFlexDeg !== null && kneeFlexDeg < THRESHOLDS.kneeFlex.good);
    }

    // Flight time: frames where neither foot is in its contact band, measured
    // between consecutive footstrikes (skip pairs too far apart = missed step).
    const flightSamples = [];
    for (let e = 0; e < events.length - 1; e += 1) {
      const a = events[e]; const b = events[e + 1];
      if (b.t - a.t > 0.6) continue;
      let count = 0;
      for (let i = a.frame; i <= b.frame; i += 1) {
        if (!inContact('L', i) && !inContact('R', i)) count += 1;
      }
      flightSamples.push(count * dt * 1000);
    }
    const flight = median(flightSamples);

    // Heel recovery: peak knee flexion while the foot is off the ground.
    const kneeSwingOf = (side) => {
      const leg = legOf(side);
      const samples = [];
      for (let i = 0; i < n; i += 1) {
        if (inContact(side, i)) continue;
        const f = frames[i];
        const hip = vis(f, leg.hip); const knee = vis(f, leg.knee); const ankle = vis(f, leg.ankle);
        if (hip && knee && ankle) samples.push(180 - angleAt(hip, knee, ankle));
      }
      return percentile(samples, 90);
    };
    const kneeSwingL = kneeSwingOf('L');
    const kneeSwingR = kneeSwingOf('R');

    // Trunk lean: mid-hip → mid-shoulder line vs vertical, signed forward.
    const leanSamples = [];
    for (let i = 0; i < n; i += 1) {
      const f = frames[i];
      const sl = vis(f, LM.L_SHOULDER); const sr = vis(f, LM.R_SHOULDER);
      const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
      if (!sl || !sr || !hl || !hr) continue;
      const shX = (sl.x + sr.x) / 2; const shY = (sl.y + sr.y) / 2;
      const hipX = (hl.x + hr.x) / 2; const hipY = (hl.y + hr.y) / 2;
      if (hipY - shY < 1) continue;
      const lean = Math.atan2((shX - hipX) * facing, hipY - shY) * DEG;
      leanSamples.push(lean);
      const t = THRESHOLDS.trunkLean;
      if (lean < t.goodMin || lean > t.goodMax) frameFlags[i].lean = true;
    }
    const trunkLean = median(leanSamples);

    // Vertical oscillation: bounce of the mid-hip, in cm.
    let vertOsc = null;
    if (cmPerPx !== null) {
      const hipY = smooth(fillGaps(frames.map((f) => {
        const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
        return hl && hr ? (hl.y + hr.y) / 2 : (hl ? hl.y : (hr ? hr.y : null));
      })), 3);
      const lo = percentile(hipY, 5); const hi = percentile(hipY, 95);
      if (lo !== null && hi !== null) vertOsc = (hi - lo) * cmPerPx;
    }

    metrics.gct = sideMetric('gctMs', THRESHOLDS.gct);
    metrics.flight = {
      value: flight,
      status: rangeStatus(flight, THRESHOLDS.flight),
      detail: flightSamples.length ? `${flightSamples.length} step gaps measured` : '',
    };
    metrics.vertOsc = { value: vertOsc, status: bandStatus(vertOsc, THRESHOLDS.vertOsc), detail: '' };
    metrics.overstrideDist = sideMetric('overDistCm', THRESHOLDS.overstrideDist);
    metrics.overstride = sideMetric('shinDeg', THRESHOLDS.overstride);
    metrics.kneeFlex = sideMetric('kneeFlexDeg', THRESHOLDS.kneeFlex, bandStatusMin);
    metrics.kneeSwing = {
      left: kneeSwingL,
      right: kneeSwingR,
      status: worst(
        bandStatusMin(kneeSwingL, THRESHOLDS.kneeSwing),
        bandStatusMin(kneeSwingR, THRESHOLDS.kneeSwing),
      ),
    };
    metrics.trunkLean = {
      value: trunkLean,
      status: rangeStatus(trunkLean, THRESHOLDS.trunkLean),
      detail: trunkLean === null ? '' : (trunkLean >= 0 ? 'leaning forward' : 'leaning backward'),
    };
    metricOrder = ['cadence', 'gct', 'flight', 'vertOsc', 'overstrideDist', 'overstride', 'kneeFlex', 'kneeSwing', 'trunkLean'];

    // In a true side view the far leg is often occluded.
    const missingSide = !evL.length ? 'left' : (!evR.length ? 'right' : null);
    if (missingSide) {
      warnings.push(
        `The ${missingSide} leg was rarely visible (it is normal for the far leg to be occluded in a side view) — per-side numbers are incomplete.`,
      );
    }
  } else if (view.kind === 'front') {
    // =========================================================================
    // FRONT VIEW (anterior coronal): knee valgus, arm crossover distance,
    // lateral trunk flexion, knee window
    // =========================================================================
    for (const ev of events) {
      const leg = legOf(ev.side);
      const from = Math.max(0, ev.frame - stanceHalf);
      const to = Math.min(n - 1, ev.frame + stanceHalf);

      let maxValgus = null;
      for (let i = from; i <= to; i += 1) {
        const f = frames[i];
        const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
        const hip = vis(f, leg.hip); const knee = vis(f, leg.knee); const ankle = vis(f, leg.ankle);
        if (hip && knee && ankle && hl && hr) {
          const midX = (hl.x + hr.x) / 2;
          const fppa = signedFPPA(hip, knee, ankle, midX);
          if (maxValgus === null || fppa > maxValgus) maxValgus = fppa;
          if (fppa > THRESHOLDS.valgus.good) {
            frameFlags[i][ev.side === 'L' ? 'valgusL' : 'valgusR'] = true;
          }
        }
      }

      // Knee window: is there still daylight between the knees as the swing
      // leg passes the stance leg (mid-stance)?
      let windowOpen = null;
      {
        const mid = Math.round((ev.stance[0] + ev.stance[1]) / 2);
        let bestGap = null;
        for (let i = Math.max(0, mid - 1); i <= Math.min(n - 1, mid + 1); i += 1) {
          const f = frames[i];
          const kl = vis(f, LM.L_KNEE); const kr = vis(f, LM.R_KNEE);
          const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
          if (!kl || !kr || !hl || !hr) continue;
          const hipW = Math.abs(hl.x - hr.x);
          if (hipW < width * 0.02) continue;
          const gap = (Math.abs(kl.x - kr.x) / hipW) * 100;
          if (bestGap === null || gap > bestGap) bestGap = gap;
        }
        if (bestGap !== null) windowOpen = bestGap >= 8;
      }

      ev.valgusDeg = maxValgus;
      ev.kneeWindowOpen = windowOpen;
      ev.flagged = maxValgus !== null && maxValgus > THRESHOLDS.valgus.good;
    }

    // Arm crossover distance: how far the hands travel past the torso midline,
    // as % of shoulder width (95th percentile of crossing depth).
    const penetration = { L: [], R: [] };
    for (let i = 0; i < n; i += 1) {
      const f = frames[i];
      const sl = vis(f, LM.L_SHOULDER); const sr = vis(f, LM.R_SHOULDER);
      if (!sl || !sr) continue;
      const midX = (sl.x + sr.x) / 2;
      const shW = Math.abs(sl.x - sr.x);
      if (shW < width * 0.02) continue;
      for (const [side, wristIdx, shoulder] of [['L', LM.L_WRIST, sl], ['R', LM.R_WRIST, sr]]) {
        const w = vis(f, wristIdx);
        if (!w) continue;
        const dir = Math.sign(shoulder.x - midX) || 1;
        const depth = Math.max(0, (-(w.x - midX) * dir) / shW) * 100; // 0 = own side
        penetration[side].push(depth);
        if (depth > THRESHOLDS.armCross.warn) frameFlags[i][side === 'L' ? 'armL' : 'armR'] = true;
      }
    }
    const armL = penetration.L.length ? percentile(penetration.L, 95) : null;
    const armR = penetration.R.length ? percentile(penetration.R, 95) : null;

    // Lateral trunk flexion: side-to-side lean of the trunk line, degrees.
    const latSamples = [];
    for (let i = 0; i < n; i += 1) {
      const f = frames[i];
      const sl = vis(f, LM.L_SHOULDER); const sr = vis(f, LM.R_SHOULDER);
      const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
      if (!sl || !sr || !hl || !hr) continue;
      const shX = (sl.x + sr.x) / 2; const shY = (sl.y + sr.y) / 2;
      const hipX = (hl.x + hr.x) / 2; const hipY = (hl.y + hr.y) / 2;
      if (hipY - shY < 1) continue;
      const lat = Math.abs(Math.atan2(shX - hipX, hipY - shY)) * DEG;
      latSamples.push(lat);
      if (lat > THRESHOLDS.latTrunk.good) frameFlags[i].lean = true;
    }
    const latTrunk = percentile(latSamples, 90);

    const windowEvents = events.filter((e) => e.kneeWindowOpen !== null);
    const kneeWindow = windowEvents.length
      ? (windowEvents.filter((e) => e.kneeWindowOpen).length / windowEvents.length) * 100
      : null;

    metrics.valgus = sideMetric('valgusDeg', THRESHOLDS.valgus);
    metrics.armCross = {
      left: armL,
      right: armR,
      status: worst(bandStatus(armL, THRESHOLDS.armCross), bandStatus(armR, THRESHOLDS.armCross)),
    };
    metrics.latTrunk = { value: latTrunk, status: bandStatus(latTrunk, THRESHOLDS.latTrunk), detail: '' };
    metrics.kneeWindow = {
      value: kneeWindow,
      status: bandStatusMin(kneeWindow, THRESHOLDS.kneeWindow),
      detail: windowEvents.length ? `${windowEvents.length} stance passes checked` : '',
    };
    metricOrder = ['cadence', 'valgus', 'armCross', 'latTrunk', 'kneeWindow'];
  } else if (view.kind === 'back') {
    // =========================================================================
    // BACK VIEW (posterior coronal): pelvic drop, rearfoot eversion, step
    // width, crossover stride, heel whip, shoulder tilt
    // =========================================================================
    for (const ev of events) {
      const leg = legOf(ev.side);
      const stanceHipIdx = leg.hip;
      const swingHipIdx = ev.side === 'L' ? LM.R_HIP : LM.L_HIP;
      const from = Math.max(0, ev.frame - stanceHalf);
      const to = Math.min(n - 1, ev.frame + stanceHalf);

      // Pelvic drop: swing-side hip sinking below stance-side hip.
      let maxDrop = null;
      for (let i = from; i <= to; i += 1) {
        const f = frames[i];
        const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
        if (hl && hr) {
          const sep = Math.abs(hl.x - hr.x);
          if (sep > width * 0.02) {
            const stanceHip = stanceHipIdx === LM.L_HIP ? hl : hr;
            const swingHip = swingHipIdx === LM.L_HIP ? hl : hr;
            const drop = Math.atan2(swingHip.y - stanceHip.y, sep) * DEG;
            if (maxDrop === null || drop > maxDrop) maxDrop = drop;
            if (drop > THRESHOLDS.hipDrop.good) frameFlags[i].hip = true;
          }
        }
      }

      // Crossover: at contact, how far past the midline did the foot land?
      let crossPct = null;
      {
        const f = frames[ev.frame];
        const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
        const ankle = vis(f, leg.ankle);
        if (hl && hr && ankle) {
          const midX = (hl.x + hr.x) / 2;
          const hipW = Math.abs(hl.x - hr.x);
          const stanceHipX = stanceHipIdx === LM.L_HIP ? hl.x : hr.x;
          const sideDir = Math.sign(stanceHipX - midX);
          if (hipW > width * 0.02 && sideDir !== 0) {
            const offset = ((ankle.x - midX) * sideDir) / hipW; // + = own side
            crossPct = Math.max(0, -offset) * 100;
            if (crossPct > THRESHOLDS.crossover.good) {
              const key = ev.side === 'L' ? 'crossL' : 'crossR';
              for (let i = from; i <= to; i += 1) frameFlags[i][key] = true;
            }
          }
        }
      }

      // Rearfoot eversion at mid-stance: heel line vs calf line.
      let rearfootDeg = null;
      {
        const mid = Math.round((ev.stance[0] + ev.stance[1]) / 2);
        const f = frames[mid];
        const knee = vis(f, leg.knee); const ankle = vis(f, leg.ankle); const heel = vis(f, leg.heel);
        if (knee && ankle && heel) rearfootDeg = 180 - angleAt(knee, ankle, heel);
      }

      // Heel whip: sideways heel deviation (relative to the knee) in the
      // first ~150 ms after toe-off, expressed as an angle over shin length.
      let whipDeg = null;
      {
        const f0 = frames[ev.toeOff];
        const knee0 = vis(f0, leg.knee); const heel0 = vis(f0, leg.heel); const ankle0 = vis(f0, leg.ankle);
        if (knee0 && heel0 && ankle0) {
          const base = heel0.x - knee0.x;
          const shin = dist(knee0, ankle0);
          let maxDx = null;
          for (let k = 1; k <= 3 && ev.toeOff + k < n; k += 1) {
            const f = frames[ev.toeOff + k];
            const knee = vis(f, leg.knee); const heel = vis(f, leg.heel);
            if (!knee || !heel) continue;
            const dx = Math.abs((heel.x - knee.x) - base);
            if (maxDx === null || dx > maxDx) maxDx = dx;
          }
          if (maxDx !== null && shin > 1) whipDeg = Math.atan2(maxDx, shin) * DEG;
        }
      }

      ev.hipDropDeg = maxDrop;
      ev.crossPct = crossPct;
      ev.rearfootDeg = rearfootDeg;
      ev.whipDeg = whipDeg;
      ev.flagged =
        (maxDrop !== null && maxDrop > THRESHOLDS.hipDrop.good) ||
        (crossPct !== null && crossPct > THRESHOLDS.crossover.good);
    }

    // Step width: lateral distance between consecutive left/right foot strikes.
    const widthSamples = [];
    for (let e = 0; e < events.length - 1; e += 1) {
      const a = events[e]; const b = events[e + 1];
      if (a.side === b.side || b.t - a.t > 0.6 || cmPerPx === null) continue;
      const ankA = vis(frames[a.frame], legOf(a.side).ankle);
      const ankB = vis(frames[b.frame], legOf(b.side).ankle);
      if (ankA && ankB) widthSamples.push(Math.abs(ankA.x - ankB.x) * cmPerPx);
    }
    const stepWidth = median(widthSamples);

    // Shoulder tilt vs horizontal (90th percentile over the clip).
    const tiltSamples = [];
    for (const f of frames) {
      const sl = vis(f, LM.L_SHOULDER); const sr = vis(f, LM.R_SHOULDER);
      if (!sl || !sr || Math.abs(sl.x - sr.x) < width * 0.02) continue;
      tiltSamples.push(Math.abs(Math.atan2(sl.y - sr.y, Math.abs(sl.x - sr.x))) * DEG);
    }
    const shoulderTilt = percentile(tiltSamples, 90);

    metrics.hipDrop = sideMetric('hipDropDeg', THRESHOLDS.hipDrop);
    metrics.rearfoot = sideMetric('rearfootDeg', THRESHOLDS.rearfoot);
    metrics.stepWidth = {
      value: stepWidth,
      status: rangeStatus(stepWidth, THRESHOLDS.stepWidth),
      detail: widthSamples.length ? `${widthSamples.length} step pairs measured` : '',
    };
    metrics.crossover = sideMetric('crossPct', THRESHOLDS.crossover);
    metrics.heelWhip = sideMetric('whipDeg', THRESHOLDS.heelWhip);
    metrics.shoulderTilt = { value: shoulderTilt, status: bandStatus(shoulderTilt, THRESHOLDS.shoulderTilt), detail: '' };
    metricOrder = ['cadence', 'hipDrop', 'rearfoot', 'stepWidth', 'crossover', 'heelWhip', 'shoulderTilt'];
  } else {
    // =========================================================================
    // DIAGONAL VIEWS: 3D metrics in the runner's own reference frame
    // (down/right/forward axes derived from the body, not the camera).
    // =========================================================================
    const axes = bodyAxes(frames);
    if (!axes) {
      warnings.push('3D world landmarks were not available in this clip — diagonal-view metrics could not be computed.');
    }

    // Thigh angle in the sagittal (forward/down) plane: + = knee ahead of the
    // torso axis (flexion), − = behind it (extension).
    const hipAngleFwd = (f, side) => {
      if (!axes) return null;
      const leg = legOf(side);
      const hip = wpt(f, leg.hip); const knee = wpt(f, leg.knee);
      if (!hip || !knee) return null;
      const thigh = sub3(knee, hip);
      return Math.atan2(dot3(thigh, axes.fwd), dot3(thigh, axes.down)) * DEG;
    };

    // Rearfoot eversion in the 3D frontal plane (project shank + heel ⊥ fwd).
    const eversion3d = (f, side) => {
      if (!axes) return null;
      const leg = legOf(side);
      const knee = wpt(f, leg.knee); const ankle = wpt(f, leg.ankle); const heel = wpt(f, leg.heel);
      if (!knee || !ankle || !heel) return null;
      const shank = perp3(sub3(knee, ankle), axes.fwd);
      const heelUp = perp3(sub3(ankle, heel), axes.fwd);
      if (mag3(shank) < 1e-6 || mag3(heelUp) < 1e-6) return null;
      return angle3(shank, heelUp);
    };

    if (view.kind === 'front-diagonal') {
      // 3D knee tracking: peak inward (medial) deviation of the knee off the
      // hip→ankle line during stance.
      for (const ev of events) {
        const leg = legOf(ev.side);
        const medial = ev.side === 'L' ? axes?.right : (axes ? neg3(axes.right) : null);
        let maxDev = null;
        if (medial) {
          for (let i = ev.stance[0]; i <= ev.stance[1]; i += 1) {
            const f = frames[i];
            const hip = wpt(f, leg.hip); const knee = wpt(f, leg.knee); const ankle = wpt(f, leg.ankle);
            if (!hip || !knee || !ankle) continue;
            const line = sub3(ankle, hip);
            const u = norm3(line);
            if (!u) continue;
            const dev = perp3(sub3(knee, hip), u);
            const m = dot3(dev, medial);
            const devDeg = Math.atan2(Math.max(0, m), mag3(line)) * DEG;
            if (maxDev === null || devDeg > maxDev) maxDev = devDeg;
            if (devDeg > THRESHOLDS.kneeTrack3d.good) {
              frameFlags[i][ev.side === 'L' ? 'valgusL' : 'valgusR'] = true;
            }
          }
        }
        ev.kneeTrackDeg = maxDev;
        ev.flagged = maxDev !== null && maxDev > THRESHOLDS.kneeTrack3d.good;
      }

      // Trunk-on-pelvis rotation: shoulder line vs hip line in the transverse
      // plane (both projected ⊥ down).
      const rotSamples = [];
      if (axes) {
        for (const f of frames) {
          const sl = wpt(f, LM.L_SHOULDER); const sr = wpt(f, LM.R_SHOULDER);
          const hl = wpt(f, LM.L_HIP); const hr = wpt(f, LM.R_HIP);
          if (!sl || !sr || !hl || !hr) continue;
          const sh = perp3(sub3(sr, sl), axes.down);
          const hp = perp3(sub3(hr, hl), axes.down);
          if (mag3(sh) < 1e-6 || mag3(hp) < 1e-6) continue;
          rotSamples.push(angle3(sh, hp));
        }
      }
      const trunkRot = percentile(rotSamples, 90);

      // Elbow flare: lateral drift of the elbow away from the ribs.
      const flareOf = (side) => {
        if (!axes) return null;
        const shoulderIdx = side === 'L' ? LM.L_SHOULDER : LM.R_SHOULDER;
        const elbowIdx = side === 'L' ? LM.L_ELBOW : LM.R_ELBOW;
        const outward = side === 'L' ? neg3(axes.right) : axes.right;
        const samples = [];
        for (const f of frames) {
          const sh = wpt(f, shoulderIdx); const el = wpt(f, elbowIdx);
          if (!sh || !el) continue;
          const v = sub3(el, sh);
          const down = Math.max(1e-6, dot3(v, axes.down));
          samples.push(Math.atan2(Math.max(0, dot3(v, outward)), down) * DEG);
        }
        return percentile(samples, 90);
      };
      const flareL = flareOf('L');
      const flareR = flareOf('R');

      // Anterior hip flexion: peak thigh drive during swing.
      const hipFlexOf = (side) => {
        const samples = [];
        for (const f of frames) {
          const a = hipAngleFwd(f, side);
          if (a !== null) samples.push(a);
        }
        return percentile(samples, 95);
      };
      const hipFlexL = hipFlexOf('L');
      const hipFlexR = hipFlexOf('R');

      metrics.kneeTrack3d = sideMetric('kneeTrackDeg', THRESHOLDS.kneeTrack3d);
      metrics.trunkRot = { value: trunkRot, status: bandStatus(trunkRot, THRESHOLDS.trunkRot), detail: '' };
      metrics.elbowFlare = {
        left: flareL,
        right: flareR,
        status: worst(bandStatus(flareL, THRESHOLDS.elbowFlare), bandStatus(flareR, THRESHOLDS.elbowFlare)),
      };
      metrics.hipFlex3d = {
        left: hipFlexL,
        right: hipFlexR,
        status: worst(
          bandStatusMin(hipFlexL, THRESHOLDS.hipFlex3d),
          bandStatusMin(hipFlexR, THRESHOLDS.hipFlex3d),
        ),
      };
      metricOrder = ['cadence', 'kneeTrack3d', 'trunkRot', 'elbowFlare', 'hipFlex3d'];
    } else {
      // back-diagonal
      for (const ev of events) {
        const leg = legOf(ev.side);

        // Hip extension at toe-off: thigh behind the torso axis, degrees.
        const ext = (() => {
          const a = hipAngleFwd(frames[ev.toeOff], ev.side);
          return a === null ? null : -a;
        })();

        // Ankle eversion velocity: fastest change of the 3D rearfoot angle in
        // the first ~150 ms after contact.
        let everVel = null;
        {
          let prev = null;
          for (let k = 0; k <= 3 && ev.stance[0] + k < n; k += 1) {
            const a = eversion3d(frames[ev.stance[0] + k], ev.side);
            if (a !== null && prev !== null) {
              const v = Math.abs(a - prev) / dt;
              if (everVel === null || v > everVel) everVel = v;
            }
            if (a !== null) prev = a;
          }
        }

        // Push-off stability: foot rotation away from the direction of travel
        // during the second half of stance (external rotation / wobble).
        let pushoff = null;
        if (axes) {
          const mid = Math.round((ev.stance[0] + ev.stance[1]) / 2);
          for (let i = mid; i <= ev.stance[1]; i += 1) {
            const f = frames[i];
            const heel = wpt(f, leg.heel); const toe = wpt(f, leg.foot);
            if (!heel || !toe) continue;
            const fp = perp3(sub3(toe, heel), axes.down);
            if (mag3(fp) < 1e-6) continue;
            const ang = angle3(fp, axes.fwd);
            if (pushoff === null || ang > pushoff) pushoff = ang;
          }
        }

        // Drive path: the ankle should travel mostly upward right after
        // toe-off (hamstring folding the leg), not out to the side.
        let drive = null;
        if (axes && ev.toeOff + 3 < n) {
          const a0 = wpt(frames[ev.toeOff], leg.ankle);
          const a1 = wpt(frames[ev.toeOff + 3], leg.ankle);
          if (a0 && a1) {
            const d = sub3(a1, a0);
            const up = dot3(d, neg3(axes.down));
            const horiz = mag3(perp3(d, axes.down));
            drive = up > 1e-6 ? Math.atan2(horiz, up) * DEG : 90;
          }
        }

        ev.hipExtDeg = ext;
        ev.everVel = everVel;
        ev.pushoffDeg = pushoff;
        ev.driveDeg = drive;
        ev.flagged = ext !== null && ext < THRESHOLDS.hipExt3d.good;
      }

      metrics.hipExt3d = sideMetric('hipExtDeg', THRESHOLDS.hipExt3d, bandStatusMin);
      metrics.eversionVel = sideMetric('everVel', THRESHOLDS.eversionVel);
      metrics.pushoffStab = sideMetric('pushoffDeg', THRESHOLDS.pushoffStab);
      metrics.driveAngle = sideMetric('driveDeg', THRESHOLDS.driveAngle);
      metricOrder = ['cadence', 'hipExt3d', 'eversionVel', 'pushoffStab', 'driveAngle'];
    }
  }

  if (view.mode === 'front') {
    if (!evL.length || !evR.length) {
      warnings.push(
        `Footstrikes were only detected on the ${evL.length ? 'left' : 'right'} foot — ` +
        'side-specific results are incomplete. A longer, steadier clip usually fixes this.',
      );
    }
  }

  return { duration, detectionRate, view, events, frameFlags, metrics, metricOrder, warnings };
}
