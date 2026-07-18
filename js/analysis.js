// ---------------------------------------------------------------------------
// Pure gait analysis for running video — FRONT or SIDE view (auto-detected).
//
// Input: an array of frames [{ t, lm }] where lm is either null (no person
// detected) or an array of 33 MediaPipe pose landmarks in PIXEL coordinates:
// { x, y, v } with v = visibility 0..1. Image y increases DOWNWARD.
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
const VIEW_MID = 0.36;   // between SIDE and FRONT: angled; nearer set wins
const VIEW_SIDE = 0.28;  // <= this: clean side view

// Back-vs-front: minimum |left/right ordering vote| to trust it over the
// nose-visibility fallback (the model often reports a "visible" face from
// behind, so visibility alone misclassifies back views as front).
const BACK_ORDER_MIN = 0.3;
// Frontal views whose shoulder line tilts more than this out of the image
// plane (via landmark depth) are treated as angled even when the
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

// --- geometry ----------------------------------------------------------------

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

// --- status helpers ----------------------------------------------------------

// Lower is better (hip drop, valgus, overstride, …).
export function bandStatus(value, { good, warn }) {
  if (value === null || value === undefined) return 'na';
  if (value <= good) return 'good';
  if (value <= warn) return 'warn';
  return 'bad';
}

// Higher is better (knee flexion at landing).
export function bandStatusMin(value, { good, warn }) {
  if (value === null || value === undefined) return 'na';
  if (value >= good) return 'good';
  if (value >= warn) return 'warn';
  return 'bad';
}

// In-range is best (cadence, trunk lean).
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

// Classify the camera view from body geometry, and (for side views) which
// direction the runner faces — toes always point forward.
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

  if (r === null) return { mode: 'front', angled: false, facing, back: false, ratio: null, unknown: true };
  if (r >= VIEW_FRONT) return { mode: 'front', angled: oblique, facing, back, ratio: r };
  if (r >= VIEW_MID) return { mode: 'front', angled: true, facing, back, ratio: r };
  if (r > VIEW_SIDE) return { mode: 'side', angled: true, facing, back: false, ratio: r };
  return { mode: 'side', angled: false, facing, back: false, ratio: r };
}

// --- main entry ----------------------------------------------------------------

export function analyze(frames, { fps, width, height }) {
  const n = frames.length;
  const duration = n / fps;
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
  } else if (view.back) {
    warnings.push(
      'This looks like a back view. All frontal-plane metrics work from behind, but the pose model ' +
      'can occasionally swap left/right labels when the face is hidden — trust the magnitudes, and ' +
      'double-check which side is which in the overlay before targeting one-sided exercises.',
    );
  }
  if (view.angled) {
    warnings.push(
      view.mode === 'front'
        ? 'The camera looks angled rather than head-on — midline metrics (crossover, arm swing) and knee valgus are approximate. Film straight-on for reliable numbers.'
        : 'The camera looks angled rather than a true side view — overstride and trunk lean are approximate. Film perpendicular to the runner for reliable numbers.',
    );
  }

  // --- footstrike detection: peaks in ankle y (image y grows downward) ------
  const yAnkleL = smooth(fillGaps(seriesOf(frames, LM.L_ANKLE, 'y')), 5);
  const yAnkleR = smooth(fillGaps(seriesOf(frames, LM.R_ANKLE, 'y')), 5);

  const contactsFor = (series) => {
    const lo = percentile(series, 5);
    const hi = percentile(series, 95);
    if (lo === null || hi === null) return [];
    const range = hi - lo;
    if (range < height * 0.005) return []; // ankle barely moves → not running
    return findPeaks(series, {
      minDistance: Math.max(2, Math.round(0.35 * fps)),
      minProminence: range * 0.25,
    });
  };

  const events = [
    ...contactsFor(yAnkleL).map((i) => ({ side: 'L', frame: i, t: frames[i].t })),
    ...contactsFor(yAnkleR).map((i) => ({ side: 'R', frame: i, t: frames[i].t })),
  ].sort((a, b) => a.frame - b.frame);

  if (events.length < 4) {
    return {
      error:
        'Could not detect enough footstrikes to analyze. Use a clip with at least ' +
        '5–10 seconds of continuous running with the whole body in frame.',
    };
  }

  // --- cadence (both feet, steps/min over the span of detected events) ------
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
  });

  const metrics = {
    cadence: {
      value: cadence,
      status: rangeStatus(cadence, THRESHOLDS.cadence),
      detail: `${events.length} footstrikes detected`,
    },
  };
  let metricOrder;

  if (view.mode === 'front') {
    // =========================================================================
    // FRONT VIEW: hip drop, knee valgus, crossover gait, arm crossover
    // =========================================================================
    for (const ev of events) {
      const leg = legOf(ev.side);
      const stanceHipIdx = leg.hip;
      const swingHipIdx = ev.side === 'L' ? LM.R_HIP : LM.L_HIP;

      let maxDrop = null;
      let maxValgus = null;

      const from = Math.max(0, ev.frame - stanceHalf);
      const to = Math.min(n - 1, ev.frame + stanceHalf);
      for (let i = from; i <= to; i += 1) {
        const f = frames[i];
        const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);

        // Pelvic drop: swing-side hip sinking below stance-side hip.
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

        // Knee valgus on the stance leg.
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

      ev.hipDropDeg = maxDrop;
      ev.valgusDeg = maxValgus;
      ev.crossPct = crossPct;
      ev.flagged =
        (maxDrop !== null && maxDrop > THRESHOLDS.hipDrop.good) ||
        (maxValgus !== null && maxValgus > THRESHOLDS.valgus.good) ||
        (crossPct !== null && crossPct > THRESHOLDS.crossover.good);
    }

    // Arm crossover (whole clip, per wrist).
    let armFramesConsidered = 0;
    let armCrossCountL = 0;
    let armCrossCountR = 0;
    for (let i = 0; i < n; i += 1) {
      const f = frames[i];
      const sl = vis(f, LM.L_SHOULDER); const sr = vis(f, LM.R_SHOULDER);
      if (!sl || !sr) continue;
      const midX = (sl.x + sr.x) / 2;
      const shW = Math.abs(sl.x - sr.x);
      if (shW < width * 0.02) continue;
      armFramesConsidered += 1;

      const wl = vis(f, LM.L_WRIST);
      if (wl) {
        const dir = Math.sign(sl.x - midX) || 1;
        if (((wl.x - midX) * dir) / shW < -0.15) {
          armCrossCountL += 1;
          frameFlags[i].armL = true;
        }
      }
      const wr = vis(f, LM.R_WRIST);
      if (wr) {
        const dir = Math.sign(sr.x - midX) || 1;
        if (((wr.x - midX) * dir) / shW < -0.15) {
          armCrossCountR += 1;
          frameFlags[i].armR = true;
        }
      }
    }
    const armCrossL = armFramesConsidered ? (armCrossCountL / armFramesConsidered) * 100 : null;
    const armCrossR = armFramesConsidered ? (armCrossCountR / armFramesConsidered) * 100 : null;

    const evL = events.filter((e) => e.side === 'L');
    const evR = events.filter((e) => e.side === 'R');
    const agg = (evs, key) => median(evs.map((e) => (e[key] === null || e[key] === undefined ? null : e[key])));

    const hipDropL = agg(evL, 'hipDropDeg');
    const hipDropR = agg(evR, 'hipDropDeg');
    const valgusL = agg(evL, 'valgusDeg');
    const valgusR = agg(evR, 'valgusDeg');
    const crossL = agg(evL, 'crossPct');
    const crossR = agg(evR, 'crossPct');

    metrics.hipDrop = {
      left: hipDropL,
      right: hipDropR,
      status: worst(bandStatus(hipDropL, THRESHOLDS.hipDrop), bandStatus(hipDropR, THRESHOLDS.hipDrop)),
    };
    metrics.valgus = {
      left: valgusL,
      right: valgusR,
      status: worst(bandStatus(valgusL, THRESHOLDS.valgus), bandStatus(valgusR, THRESHOLDS.valgus)),
    };
    metrics.crossover = {
      left: crossL,
      right: crossR,
      status: worst(bandStatus(crossL, THRESHOLDS.crossover), bandStatus(crossR, THRESHOLDS.crossover)),
    };
    metrics.armCross = {
      left: armCrossL,
      right: armCrossR,
      status: worst(bandStatus(armCrossL, THRESHOLDS.armCross), bandStatus(armCrossR, THRESHOLDS.armCross)),
    };
    metricOrder = ['cadence', 'hipDrop', 'valgus', 'crossover', 'armCross'];
  } else {
    // =========================================================================
    // SIDE VIEW: overstride (shin angle), trunk lean, knee flexion at landing,
    // vertical oscillation
    // =========================================================================
    const facing = view.facing; // +1 = runner faces image-right

    // Leg length (hip→knee + knee→ankle), for normalizing vertical oscillation.
    const legLenSamples = [];
    for (const f of frames) {
      for (const side of ['L', 'R']) {
        const leg = legOf(side);
        const hip = vis(f, leg.hip); const knee = vis(f, leg.knee); const ankle = vis(f, leg.ankle);
        if (hip && knee && ankle) legLenSamples.push(dist(hip, knee) + dist(knee, ankle));
      }
    }
    const legLen = median(legLenSamples);

    for (const ev of events) {
      const leg = legOf(ev.side);
      const from = Math.max(0, ev.frame - stanceHalf);
      const to = Math.min(n - 1, ev.frame + stanceHalf);
      const f = frames[ev.frame];

      // Overstride: shin angle at contact. Positive = ankle lands ahead of the
      // knee (reaching out in front → braking forces).
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
      ev.kneeFlexDeg = kneeFlexDeg;
      ev.flagged =
        (shinDeg !== null && shinDeg > THRESHOLDS.overstride.good) ||
        (kneeFlexDeg !== null && kneeFlexDeg < THRESHOLDS.kneeFlex.good);
    }

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

    // Vertical oscillation: bounce of the mid-hip, as % of leg length.
    let vertOsc = null;
    if (legLen) {
      const hipY = smooth(fillGaps(frames.map((f) => {
        const hl = vis(f, LM.L_HIP); const hr = vis(f, LM.R_HIP);
        return hl && hr ? (hl.y + hr.y) / 2 : (hl ? hl.y : (hr ? hr.y : null));
      })), 3);
      const lo = percentile(hipY, 5); const hi = percentile(hipY, 95);
      if (lo !== null && hi !== null) vertOsc = ((hi - lo) / legLen) * 100;
    }

    const evL = events.filter((e) => e.side === 'L');
    const evR = events.filter((e) => e.side === 'R');
    const agg = (evs, key) => median(evs.map((e) => (e[key] === null || e[key] === undefined ? null : e[key])));

    const overL = agg(evL, 'shinDeg');
    const overR = agg(evR, 'shinDeg');
    const flexL = agg(evL, 'kneeFlexDeg');
    const flexR = agg(evR, 'kneeFlexDeg');

    metrics.overstride = {
      left: overL,
      right: overR,
      status: worst(bandStatus(overL, THRESHOLDS.overstride), bandStatus(overR, THRESHOLDS.overstride)),
    };
    metrics.trunkLean = {
      value: trunkLean,
      status: rangeStatus(trunkLean, THRESHOLDS.trunkLean),
      detail: trunkLean === null ? '' : (trunkLean >= 0 ? 'leaning forward' : 'leaning backward'),
    };
    metrics.kneeFlex = {
      left: flexL,
      right: flexR,
      status: worst(bandStatusMin(flexL, THRESHOLDS.kneeFlex), bandStatusMin(flexR, THRESHOLDS.kneeFlex)),
    };
    metrics.vertOsc = {
      value: vertOsc,
      status: bandStatus(vertOsc, THRESHOLDS.vertOsc),
      detail: '',
    };
    metricOrder = ['cadence', 'overstride', 'trunkLean', 'kneeFlex', 'vertOsc'];

    // In a true side view the far leg is often occluded.
    const missingSide = !evL.length ? 'left' : (!evR.length ? 'right' : null);
    if (missingSide) {
      warnings.push(
        `The ${missingSide} leg was rarely visible (it is normal for the far leg to be occluded in a side view) — per-side numbers are incomplete.`,
      );
    }
  }

  if (view.mode === 'front') {
    const evL = events.filter((e) => e.side === 'L');
    const evR = events.filter((e) => e.side === 'R');
    if (!evL.length || !evR.length) {
      warnings.push(
        `Footstrikes were only detected on the ${evL.length ? 'left' : 'right'} foot — ` +
        'side-specific results are incomplete. A longer, steadier clip usually fixes this.',
      );
    }
  }

  return { duration, detectionRate, view, events, frameFlags, metrics, metricOrder, warnings };
}
