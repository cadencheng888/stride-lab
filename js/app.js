// ---------------------------------------------------------------------------
// App orchestration: upload → frame extraction → analysis → results UI.
// ---------------------------------------------------------------------------

import { createLandmarker, detectFrame, beginClip } from './pose.js';
import { analyze, LM } from './analysis.js';
import { FEEDBACK, METRIC_META, STATUS_META, ALL_GOOD_MESSAGE } from './config.js';

const SAMPLE_FPS = 20; // analysis sampling rate
const MAX_SECONDS = 30; // cap analysis length to keep processing quick

// Overlay annotation colors (drawn ON the video, not on the page surface).
const OVERLAY = {
  base: '#4dc3ff',
  flag: '#ff4b3e',
  midline: 'rgba(255,255,255,0.75)',
  under: 'rgba(0,0,0,0.55)',
};

// Skeleton segments as landmark index pairs.
const SEGMENTS = [
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
  [LM.L_ANKLE, LM.L_HEEL], [LM.L_HEEL, LM.L_FOOT], [LM.L_ANKLE, LM.L_FOOT],
  [LM.R_ANKLE, LM.R_HEEL], [LM.R_HEEL, LM.R_FOOT], [LM.R_ANKLE, LM.R_FOOT],
];

const $ = (id) => document.getElementById(id);
const els = {
  setup: $('setup'),
  progress: $('progress'),
  results: $('results'),
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  statusText: $('statusText'),
  progressBar: $('progressBar'),
  progressPct: $('progressPct'),
  warnings: $('warnings'),
  video: $('playVideo'),
  canvas: $('overlay'),
  showSkeleton: $('showSkeleton'),
  timeline: $('timeline'),
  metricCards: $('metricCards'),
  feedbackCards: $('feedbackCards'),
  resetBtn: $('resetBtn'),
  errorBox: $('errorBox'),
};

let landmarker = null;
let state = null; // { url, frames, results }
let rafId = null;

// --- upload wiring ----------------------------------------------------------

els.dropzone.addEventListener('click', (e) => {
  // The input lives inside the dropzone: its programmatic click bubbles back
  // here, so ignore it or we'd re-trigger ourselves.
  if (e.target === els.fileInput) return;
  els.fileInput.click();
});
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropzone.classList.add('dragover');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files[0];
  if (file) handleFile(file);
});
els.resetBtn.addEventListener('click', reset);

function show(section) {
  for (const s of [els.setup, els.progress, els.results]) s.hidden = s !== section;
}

function setStatus(msg) {
  els.statusText.textContent = msg;
}

function setProgress(frac) {
  const pct = Math.round(frac * 100);
  els.progressBar.style.width = `${pct}%`;
  els.progressPct.textContent = `${pct}%`;
}

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.hidden = false;
  show(els.setup);
}

function reset() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  els.video.pause();
  els.video.removeAttribute('src');
  els.video.load();
  if (state?.url) URL.revokeObjectURL(state.url);
  state = null;
  els.errorBox.hidden = true;
  els.fileInput.value = '';
  show(els.setup);
}

// --- processing ----------------------------------------------------------------

function seekTo(video, t) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2000); // never hang on a bad seek
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

async function handleFile(file) {
  if (!file.type.startsWith('video/')) {
    showError('That file is not a video. Upload an .mp4 or .mov clip.');
    return;
  }
  els.errorBox.hidden = true;
  show(els.progress);
  setProgress(0);

  try {
    if (!landmarker) landmarker = await createLandmarker(setStatus);

    setStatus('Reading video…');
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('Could not decode this video.')), { once: true });
    });

    const analyzeDur = Math.min(video.duration, MAX_SECONDS);
    if (video.duration > MAX_SECONDS) {
      console.info(`Video is ${video.duration.toFixed(1)}s; analyzing the first ${MAX_SECONDS}s.`);
    }

    setStatus('Analyzing frames…');
    beginClip();
    const frames = [];
    const dt = 1 / SAMPLE_FPS;
    const endT = Math.max(0, Math.min(analyzeDur - 0.05, analyzeDur));
    for (let t = 0; t <= endT; t += dt) {
      await seekTo(video, t);
      let lm = null;
      try {
        lm = detectFrame(landmarker, video, t);
      } catch (err) {
        console.warn('detect failed at', t, err);
      }
      frames.push({ t, lm });
      setProgress(t / endT);
    }
    setProgress(1);

    setStatus('Computing metrics…');
    const results = analyze(frames, {
      fps: SAMPLE_FPS,
      width: video.videoWidth,
      height: video.videoHeight,
    });
    if (results.error) {
      URL.revokeObjectURL(url);
      showError(results.error);
      return;
    }
    if (video.duration > MAX_SECONDS) {
      results.warnings.push(`Only the first ${MAX_SECONDS}s of the video were analyzed.`);
    }

    state = { url, frames, results };
    renderResults();
    show(els.results);
  } catch (err) {
    console.error(err);
    showError(`Something went wrong: ${err.message}. Check your internet connection (the pose model loads from a CDN) and try again.`);
  }
}

// --- results rendering ----------------------------------------------------------

function fmt(v, digits = 1) {
  return v === null || v === undefined ? '—' : v.toFixed(digits);
}

function chip(status) {
  const meta = STATUS_META[status] || STATUS_META.na;
  return `<span class="chip chip-${status}"><span class="chip-icon" aria-hidden="true">${meta.icon}</span>${meta.label}</span>`;
}

function viewLabel(view) {
  let base;
  if (view.mode === 'front') {
    base = view.back ? 'Back view' : 'Front view';
  } else {
    base = `Side view (running ${view.facing === 1 ? 'toward the right' : 'toward the left'})`;
  }
  return view.angled ? `${base}, camera at an angle` : base;
}

function renderResults() {
  const { results, url } = state;

  // Detected view
  $('viewInfo').innerHTML =
    `<span class="chip"><span class="chip-icon" aria-hidden="true">📐</span>Detected: ${viewLabel(results.view)}</span>`;

  // Warnings
  els.warnings.innerHTML = results.warnings
    .map((w) => `<div class="warning-note"><span class="chip-icon" aria-hidden="true">⚠</span> ${w}</div>`)
    .join('');

  // Video + overlay
  els.video.src = url;
  els.video.addEventListener('loadedmetadata', () => {
    els.canvas.width = els.video.videoWidth;
    els.canvas.height = els.video.videoHeight;
  }, { once: true });
  if (rafId) cancelAnimationFrame(rafId);
  drawLoop();

  // Timeline of footstrikes
  const dur = results.duration;
  els.timeline.innerHTML = results.events
    .map((ev, i) => {
      const cls = ev.flagged ? 'tick-flag' : 'tick-good';
      const label = `${ev.side === 'L' ? 'Left' : 'Right'} foot · ${ev.t.toFixed(1)}s${ev.flagged ? ' · flagged' : ''}`;
      return `<button class="tick ${cls}" style="left:${(ev.t / dur) * 100}%" data-t="${ev.t}" title="${label}" aria-label="${label}"></button>`;
    })
    .join('');
  els.timeline.querySelectorAll('.tick').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.video.currentTime = parseFloat(btn.dataset.t);
      els.video.pause();
    });
  });

  // Metric cards, in the order the analysis engine chose for this view.
  const m = results.metrics;
  els.metricCards.innerHTML = results.metricOrder
    .map((key) => {
      const metric = m[key];
      const meta = METRIC_META[key];
      const isSides = 'left' in metric;
      const value = isSides ? worstVal(metric, meta.worst) : metric.value;
      const detail = metric.detail ?? (isSides ? sides(metric, meta) : '');
      return card(key, metric.status, fmt(value, meta.digits), detail);
    })
    .join('');

  // Feedback
  const flagged = results.metricOrder
    .map((key) => [key, m[key]])
    .filter(([, v]) => v.status === 'warn' || v.status === 'bad');
  if (!flagged.length) {
    els.feedbackCards.innerHTML = `
      <div class="feedback-card">
        <div class="feedback-head">${chip('good')}<h3>${ALL_GOOD_MESSAGE.title}</h3></div>
        <p>${ALL_GOOD_MESSAGE.body}</p>
      </div>`;
  } else {
    els.feedbackCards.innerHTML = flagged
      .map(([key, v]) => {
        const fb = FEEDBACK[key];
        if (!fb) return '';
        return `
          <div class="feedback-card">
            <div class="feedback-head">${chip(v.status)}<h3>${fb.title}</h3></div>
            <p><strong>Why it matters:</strong> ${fb.why}</p>
            <p><strong>How to fix it:</strong> ${fb.fix}</p>
            <div class="exercises">
              <h4>Recommended exercises</h4>
              <ul>
                ${fb.exercises.map((ex) => `<li><strong>${ex.name}</strong> — ${ex.dose}</li>`).join('')}
              </ul>
            </div>
          </div>`;
      })
      .join('');
  }
}

function worstVal(metric, worst = 'max') {
  const vals = [metric.left, metric.right].filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return worst === 'min' ? Math.min(...vals) : Math.max(...vals);
}

function sides(metric, meta) {
  const noun = meta.noun ?? '';
  const u = meta.unit.startsWith('%') ? '%' : meta.unit;
  return `L ${noun} ${fmt(metric.left, meta.digits)}${u} · R ${noun} ${fmt(metric.right, meta.digits)}${u}`;
}

function card(key, status, value, detail) {
  const meta = METRIC_META[key];
  return `
    <div class="card">
      <div class="card-top">
        <span class="card-label">${meta.label}</span>
        ${chip(status)}
      </div>
      <div class="card-value">${value}<span class="card-unit">${meta.unit}</span></div>
      <div class="card-detail">${detail}</div>
      <div class="card-target">${meta.target}</div>
    </div>`;
}

// --- overlay drawing ----------------------------------------------------------

function segFlagged(a, b, flags) {
  if (flags.hip && a === LM.L_HIP && b === LM.R_HIP) return true;
  if ((flags.valgusL || flags.kneeL) && ((a === LM.L_HIP && b === LM.L_KNEE) || (a === LM.L_KNEE && b === LM.L_ANKLE))) return true;
  if ((flags.valgusR || flags.kneeR) && ((a === LM.R_HIP && b === LM.R_KNEE) || (a === LM.R_KNEE && b === LM.R_ANKLE))) return true;
  if (flags.overL && a === LM.L_KNEE && b === LM.L_ANKLE) return true;
  if (flags.overR && a === LM.R_KNEE && b === LM.R_ANKLE) return true;
  if ((flags.crossL || flags.overL) && [LM.L_ANKLE, LM.L_HEEL, LM.L_FOOT].includes(a) && [LM.L_ANKLE, LM.L_HEEL, LM.L_FOOT].includes(b)) return true;
  if ((flags.crossR || flags.overR) && [LM.R_ANKLE, LM.R_HEEL, LM.R_FOOT].includes(a) && [LM.R_ANKLE, LM.R_HEEL, LM.R_FOOT].includes(b)) return true;
  if (flags.armL && a === LM.L_ELBOW && b === LM.L_WRIST) return true;
  if (flags.armR && a === LM.R_ELBOW && b === LM.R_WRIST) return true;
  if (flags.lean && ((a === LM.L_SHOULDER && b === LM.L_HIP) || (a === LM.R_SHOULDER && b === LM.R_HIP))) return true;
  return false;
}

function drawLoop() {
  const ctx = els.canvas.getContext('2d');

  const draw = () => {
    rafId = requestAnimationFrame(draw);
    if (!state) return;
    const { frames, results } = state;
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    if (!els.showSkeleton.checked) return;

    const i = Math.min(frames.length - 1, Math.max(0, Math.round(els.video.currentTime * SAMPLE_FPS)));
    const f = frames[i];
    if (!f || !f.lm) return;
    const flags = results.frameFlags[i];
    const lm = f.lm;
    const pt = (idx) => (lm[idx] && lm[idx].v >= 0.5 ? lm[idx] : null);

    // Body midline (dashed vertical through mid-hips) — front view only;
    // it has no meaning in a side profile.
    const hl = pt(LM.L_HIP); const hr = pt(LM.R_HIP);
    if (results.view.mode === 'front' && hl && hr) {
      const midX = (hl.x + hr.x) / 2;
      ctx.save();
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = OVERLAY.midline;
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, els.canvas.height);
      ctx.stroke();
      ctx.restore();
    }

    // Segments (dark underlay + color for legibility on any video).
    for (const [a, b] of SEGMENTS) {
      const pa = pt(a); const pb = pt(b);
      if (!pa || !pb) continue;
      const color = segFlagged(a, b, flags) ? OVERLAY.flag : OVERLAY.base;
      ctx.lineCap = 'round';
      ctx.lineWidth = 6;
      ctx.strokeStyle = OVERLAY.under;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }

    // Joint dots (ring in dark, fill in status color).
    const jointFlag = {
      [LM.L_HIP]: flags.hip || flags.lean, [LM.R_HIP]: flags.hip || flags.lean,
      [LM.L_KNEE]: flags.valgusL || flags.kneeL, [LM.R_KNEE]: flags.valgusR || flags.kneeR,
      [LM.L_ANKLE]: flags.crossL || flags.overL, [LM.R_ANKLE]: flags.crossR || flags.overR,
      [LM.L_WRIST]: flags.armL, [LM.R_WRIST]: flags.armR,
      [LM.L_SHOULDER]: flags.lean, [LM.R_SHOULDER]: flags.lean,
      [LM.L_ELBOW]: false, [LM.R_ELBOW]: false,
    };
    for (const [idxStr, flagged] of Object.entries(jointFlag)) {
      const p = pt(Number(idxStr));
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, flagged ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = flagged ? OVERLAY.flag : OVERLAY.base;
      ctx.strokeStyle = OVERLAY.under;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  };

  draw();
}
