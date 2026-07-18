// ---------------------------------------------------------------------------
// Thresholds & coaching content for front-view gait metrics.
//
// All thresholds are HEURISTICS drawn from running-biomechanics literature and
// coaching practice, adapted for the noise level of single-camera 2D pose
// estimation. They are deliberately conservative (a bit forgiving) — tune them
// here without touching any analysis code.
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  // Steps per minute, both feet. Good runners cluster ~165-185 at easy pace,
  // but cadence is speed-dependent, so the bands are wide.
  cadence: { goodMin: 165, goodMax: 190, warnMin: 155, warnMax: 200 },

  // Contralateral pelvic drop, degrees, measured during stance.
  // Typical healthy runners ~2-6°; >10° is a strong flag.
  hipDrop: { good: 6, warn: 10 },

  // Frontal-plane projection angle (FPPA) at the knee during stance, degrees.
  // Positive = knee deviating toward the midline (valgus).
  valgus: { good: 10, warn: 18 },

  // How far past the body midline the foot lands, as % of hip width.
  // 0 = lands on its own side.
  crossover: { good: 5, warn: 20 },

  // % of analyzed frames in which a wrist swings past the body midline.
  armCross: { good: 15, warn: 35 },

  // --- side-view metrics ---

  // Shin angle at footstrike, degrees. Positive = ankle ahead of the knee
  // (reaching/overstriding). A vertical shin at contact is the classic target.
  overstride: { good: 8, warn: 15 },

  // Forward trunk lean, degrees from vertical. Slight forward lean is good;
  // negative = leaning backward.
  trunkLean: { goodMin: 0, goodMax: 12, warnMin: -4, warnMax: 18 },

  // Knee flexion at initial contact, degrees. HIGHER is better — a locked-out
  // knee (< ~4°) has no shock absorption.
  kneeFlex: { good: 8, warn: 4 },

  // Vertical oscillation: hip bounce as % of leg length.
  vertOsc: { good: 9, warn: 12 },
};

export const STATUS_META = {
  good: { icon: '✓', label: 'Good' },
  warn: { icon: '⚠', label: 'Fair' },
  bad: { icon: '✕', label: 'Needs work' },
  na: { icon: '–', label: 'Not measured' },
};

// Card metadata for the metrics grid.
// digits: decimals shown · noun: per-side label · worst: which side is shown
// as the headline value ('max' = higher is worse, 'min' = lower is worse).
export const METRIC_META = {
  cadence: {
    label: 'Cadence',
    unit: 'spm',
    target: 'Target 165–190 spm',
    digits: 0,
  },
  hipDrop: {
    label: 'Hip drop',
    unit: '°',
    target: 'Target ≤ 6° pelvic drop in stance',
    digits: 1,
    noun: 'stance',
    worst: 'max',
  },
  valgus: {
    label: 'Knee valgus',
    unit: '°',
    target: 'Target ≤ 10° inward knee angle',
    digits: 1,
    noun: 'knee',
    worst: 'max',
  },
  crossover: {
    label: 'Crossover gait',
    unit: '% hip width',
    target: 'Target: foot lands on its own side of the midline',
    digits: 1,
    noun: 'foot',
    worst: 'max',
  },
  armCross: {
    label: 'Arm crossover',
    unit: '% of stride',
    target: 'Target ≤ 15% of frames past midline',
    digits: 0,
    noun: 'arm',
    worst: 'max',
  },
  overstride: {
    label: 'Overstride (shin angle)',
    unit: '°',
    target: 'Target ≤ 8° — shin near vertical at footstrike',
    digits: 1,
    noun: 'shin',
    worst: 'max',
  },
  trunkLean: {
    label: 'Trunk lean',
    unit: '°',
    target: 'Target 0–12° forward from vertical',
    digits: 1,
  },
  kneeFlex: {
    label: 'Knee bend at landing',
    unit: '°',
    target: 'Target ≥ 8° — a soft knee absorbs impact',
    digits: 1,
    noun: 'knee',
    worst: 'min',
  },
  vertOsc: {
    label: 'Vertical bounce',
    unit: '% leg length',
    target: 'Target ≤ 9% of leg length',
    digits: 1,
  },
};

// Coaching feedback shown when a metric is flagged (warn or bad).
export const FEEDBACK = {
  cadence: {
    title: 'Cadence outside the typical range',
    why: 'A low cadence usually means long, loping strides with more time in the air — which raises impact per step and often pairs with overstriding. A very high cadence can mean short, choppy steps that waste energy. Note: cadence naturally rises with speed, so judge this against how fast you were running in the clip.',
    fix: 'If low, aim to raise cadence ~5% at a time (not all at once) by taking slightly quicker, shorter steps at the same speed. A metronome app or 170–180 bpm playlist makes this almost automatic.',
    exercises: [
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% of your current cadence, easy pace' },
      { name: 'Strides', dose: '4–6 × 20 s relaxed accelerations after easy runs, focusing on quick turnover' },
      { name: 'High-cadence treadmill intervals', dose: '6 × 1 min at target cadence, 1 min normal between' },
    ],
  },
  hipDrop: {
    title: 'Pelvic drop during stance (hip drop)',
    why: 'When one foot is on the ground, the opposite hip should stay roughly level. If it visibly drops, the stance-side hip abductors (especially glute medius) aren\'t controlling the pelvis. Hip drop is one of the most consistent findings in runners with IT-band syndrome and runner\'s knee.',
    fix: 'This is almost always a strength/control issue, not a "think about it while running" issue. Strengthen the hip abductors 2–3× per week and the gait usually cleans itself up over several weeks.',
    exercises: [
      { name: 'Side plank with top-leg raise', dose: '3 × 20–30 s per side' },
      { name: 'Hip hikes (pelvic drops off a step)', dose: '3 × 12–15 per side, slow and controlled' },
      { name: 'Single-leg glute bridge', dose: '3 × 10–12 per side' },
      { name: 'Lateral band walks', dose: '3 × 10–15 steps each direction, band above knees or at ankles' },
    ],
  },
  valgus: {
    title: 'Knee collapsing inward (valgus)',
    why: 'During stance the knee should track roughly over the foot. Caving inward loads the kneecap and IT band and usually traces back to hip control (glutes) or foot mechanics rather than the knee itself. It\'s strongly associated with patellofemoral ("runner\'s knee") pain.',
    fix: 'Build hip external-rotation and abduction strength, and groove the "knee over toe" pattern with slow single-leg work before expecting it to show up at running speed.',
    exercises: [
      { name: 'Banded squats with knees-out cue', dose: '3 × 10–12, band above knees' },
      { name: 'Lateral step-downs', dose: '3 × 8–10 per side, slow eccentric, watch the knee in a mirror' },
      { name: 'Clamshells', dose: '3 × 15–20 per side' },
      { name: 'Single-leg Romanian deadlift', dose: '3 × 8–10 per side' },
    ],
  },
  crossover: {
    title: 'Feet landing across the midline (crossover gait)',
    why: 'If your feet land across an imaginary center line — like running on a tightrope — each stride bows the leg inward, increasing stress on the IT band, shins, and hips. It commonly appears together with hip drop.',
    fix: 'The classic cue: imagine running on railroad tracks — one rail under each side, feet landing on their own rail. On a treadmill, the belt\'s center line gives you instant feedback.',
    exercises: [
      { name: 'Treadmill midline drill', dose: 'Easy runs straddling the belt\'s center line, checking foot placement every few minutes' },
      { name: 'Lateral band walks', dose: '3 × 10–15 steps each direction' },
      { name: 'Single-leg balance + reach', dose: '3 × 30 s per side, progress to eyes closed' },
      { name: 'Side-lying hip abduction', dose: '3 × 12–15 per side' },
    ],
  },
  armCross: {
    title: 'Arms swinging across the body',
    why: 'Arms should swing mostly forward–back. When the hands repeatedly cross the sternum, the upper body rotates to compensate, which wastes energy and often accompanies a narrow or crossover stride down below.',
    fix: 'Cue elbows bent ~90° and hands tracing "hip to nip" — brushing near the hip bone on the backswing and no higher/more central than the chest on the front swing. Relax the shoulders; tension makes arms wrap inward.',
    exercises: [
      { name: 'Standing arm-swing drill', dose: '3 × 30 s in front of a mirror, exaggerating straight front-back swing' },
      { name: 'Open books (thoracic rotation)', dose: '2 × 10 per side, slow' },
      { name: 'Band pull-aparts', dose: '3 × 15, keeps shoulders back and relaxed' },
    ],
  },

  overstride: {
    title: 'Overstriding — foot landing out in front',
    why: 'When the foot lands well ahead of the knee (shin angled forward at contact), every step acts as a brake: impact spikes travel up the shin and knee instead of being absorbed. Overstriding is the most common form fault in recreational runners and is linked to shin splints and knee pain.',
    fix: 'Don\'t try to "pull your foot back" — instead raise cadence ~5%. Quicker steps naturally shorten the stride so the foot lands under a bent knee. Think "land under your hips."',
    exercises: [
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% of your current cadence' },
      { name: 'Butt kicks / hamstring pulls', dose: '2 × 20 m before runs — grooves pulling the foot up, not reaching out' },
      { name: 'Barefoot strides on grass', dose: '4 × 15 s — barefoot landing makes overstriding instantly uncomfortable' },
      { name: 'Downhill-avoidance cue', dose: 'On downhills (where overstriding is worst), shorten steps and lean with the slope' },
    ],
  },
  trunkLean: {
    title: 'Trunk lean outside the ideal band',
    why: 'A slight forward lean (from the ankles, not the waist) puts gravity to work. Running fully upright or leaning back forces the legs to brake each step; excessive forward bend at the waist usually means weak hip extension or tired core and loads the low back.',
    fix: 'Cue "tall hips, lean from the ankles" — imagine a string pulling the top of your head up and slightly forward. If you collapse forward late in runs, it\'s usually a core-endurance issue, not a technique issue.',
    exercises: [
      { name: 'Front plank', dose: '3 × 30–45 s' },
      { name: 'Couch stretch (hip flexors)', dose: '2 × 1 min per side — tight hip flexors force an upright/back lean' },
      { name: 'Wall lean drill', dose: '3 × 10 s leaning from ankles against a wall, then run out of it' },
      { name: 'Single-leg RDL', dose: '3 × 8–10 per side — builds the hip hinge that keeps the trunk stable' },
    ],
  },
  kneeFlex: {
    title: 'Landing on a straight knee',
    why: 'The knee is your primary shock absorber, but only if it\'s bent when the foot touches down. Landing on a locked or nearly straight knee sends impact directly into the joint and hip — it usually appears together with overstriding.',
    fix: 'Same primary fix as overstriding: raise cadence slightly so the foot lands under you, where the knee is naturally bent. Think "soft knees, quiet feet" — if your footsteps are loud, the knee is arriving too straight.',
    exercises: [
      { name: 'Jump rope', dose: '3 × 45 s — trains soft, springy, bent-knee landings automatically' },
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% cadence' },
      { name: 'Eccentric step-downs', dose: '3 × 8–10 per side, 3-second lowering' },
      { name: 'A-skips', dose: '2 × 20 m before runs' },
    ],
  },
  vertOsc: {
    title: 'Bouncing too much vertically',
    why: 'Energy spent going up and down is energy not moving you forward. High vertical oscillation usually pairs with a low cadence and long airtime — a "loping" stride that also raises landing impact.',
    fix: 'Raise cadence slightly and think "run across the ground, not over it." Imagine a low ceiling an inch above your head.',
    exercises: [
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% cadence — the single best bounce-reducer' },
      { name: 'Jump rope (low hops)', dose: '3 × 45 s, minimal height, quick contacts — builds ankle stiffness' },
      { name: 'Strides with a "low ceiling" cue', dose: '4–6 × 20 s after easy runs' },
    ],
  },
};

export const ALL_GOOD_MESSAGE = {
  title: 'No red flags detected',
  body: 'Nothing in this clip exceeded the screening thresholds. Keep in mind this is a single-camera screening, not a lab gait analysis — and each camera angle only sees half the picture (a front view can\'t see overstriding; a side view can\'t see hip drop or crossover). For the full check, film the other angle too and run it through.',
};
