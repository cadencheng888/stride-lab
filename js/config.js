// ---------------------------------------------------------------------------
// Thresholds & coaching content for all gait metrics, across every camera
// view (side, front, back, front-diagonal, back-diagonal).
//
// All thresholds are HEURISTICS drawn from running-biomechanics literature and
// coaching practice, adapted for the noise level of single-camera pose
// estimation. They are deliberately conservative (a bit forgiving) — tune them
// here without touching any analysis code. Metrics marked "3D" are computed
// from MediaPipe's world landmarks and are the most experimental.
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  // --- any view -------------------------------------------------------------

  // Steps per minute, both feet. Good runners cluster ~165-185 at easy pace,
  // but cadence is speed-dependent, so the bands are wide.
  cadence: { goodMin: 165, goodMax: 190, warnMin: 155, warnMax: 200 },

  // --- side view (sagittal plane) --------------------------------------------

  // Ground contact time per step, ms. Longer contact = more braking. Note the
  // 20 fps sampling gives ~±50 ms resolution; medians over many steps help.
  gct: { good: 280, warn: 330 },

  // Both feet airborne, ms. Very low = shuffling (fine but inefficient at
  // speed); very high = loping/bouncy stride.
  flight: { goodMin: 40, goodMax: 160, warnMin: 15, warnMax: 220 },

  // Vertical oscillation of the mid-hip, cm (5th→95th percentile range).
  vertOsc: { good: 9, warn: 12 },

  // Horizontal distance foot-ahead-of-hips at contact, cm. Some reach is
  // normal; large values = braking with every step.
  overstrideDist: { good: 25, warn: 35 },

  // Shin angle at footstrike, degrees. Positive = ankle ahead of the knee
  // (reaching/overstriding). A vertical shin at contact is the classic target.
  overstride: { good: 8, warn: 15 },

  // Knee flexion at initial contact, degrees. HIGHER is better — a locked-out
  // knee (< ~4°) has no shock absorption.
  kneeFlex: { good: 8, warn: 4 },

  // Peak knee flexion during swing (heel-to-glute recovery), degrees.
  // HIGHER is better — a low heel recovery means a long, slow pendulum.
  kneeSwing: { good: 85, warn: 70 },

  // Forward trunk lean, degrees from vertical. Slight forward lean is good;
  // negative = leaning backward.
  trunkLean: { goodMin: 0, goodMax: 12, warnMin: -4, warnMax: 18 },

  // --- back view (posterior coronal plane) -----------------------------------

  // Contralateral pelvic drop, degrees, measured during stance.
  // Typical healthy runners ~2-6°; >10° is a strong flag.
  hipDrop: { good: 6, warn: 10 },

  // Rearfoot eversion at mid-stance: heel line vs calf line, degrees.
  // A rough pronation proxy — MediaPipe's heel landmark is noisy.
  rearfoot: { good: 10, warn: 18 },

  // Lateral distance between left and right foot strikes, cm. Very narrow
  // trends toward crossover; very wide wastes energy.
  stepWidth: { goodMin: 3, goodMax: 13, warnMin: 0.5, warnMax: 18 },

  // How far past the body midline the foot lands, as % of hip width.
  // 0 = lands on its own side.
  crossover: { good: 5, warn: 20 },

  // Sideways heel deviation in early swing (medial/lateral heel whip), degrees.
  heelWhip: { good: 10, warn: 20 },

  // Shoulder line vs horizontal during stance, degrees.
  shoulderTilt: { good: 5, warn: 10 },

  // --- front view (anterior coronal plane) -----------------------------------

  // Frontal-plane projection angle (FPPA) at the knee during stance, degrees.
  // Positive = knee deviating toward the midline (valgus).
  valgus: { good: 10, warn: 18 },

  // How far the hands cross the torso midline, % of shoulder width.
  armCross: { good: 3, warn: 12 },

  // Side-to-side trunk lean, degrees from vertical.
  latTrunk: { good: 6, warn: 10 },

  // % of strides keeping a visible gap between the knees at mid-stance.
  // HIGHER is better.
  kneeWindow: { good: 80, warn: 50 },

  // --- front-diagonal view (anterior oblique, 3D) ----------------------------

  // Peak inward deviation of the knee's 3D path off the hip→ankle line during
  // stance, degrees.
  kneeTrack3d: { good: 8, warn: 15 },

  // Peak transverse-plane rotation of the shoulder line vs the hip line, deg.
  trunkRot: { good: 12, warn: 20 },

  // Peak lateral elbow drift away from the ribs during arm drive, degrees.
  elbowFlare: { good: 20, warn: 30 },

  // Peak thigh-vs-torso flexion during swing, degrees. HIGHER is better.
  hipFlex3d: { good: 30, warn: 20 },

  // --- back-diagonal view (posterior oblique, 3D) ----------------------------

  // Thigh angle behind the torso axis at toe-off, degrees. HIGHER is better —
  // low values mean the stride finishes early and the glutes never extend.
  hipExt3d: { good: 10, warn: 5 },

  // Peak ankle roll-in rate just after contact, degrees/second.
  // 20 fps sampling makes this a coarse estimate.
  eversionVel: { good: 300, warn: 500 },

  // Foot external rotation ("duck foot") / wobble during push-off, degrees
  // from the direction of travel.
  pushoffStab: { good: 18, warn: 28 },

  // Angle of the ankle's path from vertical during the first ~150 ms after
  // toe-off. LOWER = a crisper upward heel drive (hamstrings doing their job).
  driveAngle: { good: 50, warn: 65 },
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
  gct: {
    label: 'Ground contact time',
    unit: 'ms',
    target: 'Target ≤ 280 ms on the ground',
    digits: 0,
    noun: 'foot',
    worst: 'max',
  },
  flight: {
    label: 'Flight time',
    unit: 'ms',
    target: 'Typical 40–160 ms fully airborne',
    digits: 0,
  },
  vertOsc: {
    label: 'Vertical oscillation',
    unit: 'cm',
    target: 'Target ≤ 9 cm of bounce',
    digits: 1,
  },
  overstrideDist: {
    label: 'Overstride distance',
    unit: 'cm',
    target: 'Target ≤ 25 cm ahead of the hips at contact',
    digits: 1,
    noun: 'foot',
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
  kneeFlex: {
    label: 'Knee bend at landing',
    unit: '°',
    target: 'Target ≥ 8° — a soft knee absorbs impact',
    digits: 1,
    noun: 'knee',
    worst: 'min',
  },
  kneeSwing: {
    label: 'Heel recovery (swing)',
    unit: '°',
    target: 'Target ≥ 85° peak knee bend in swing',
    digits: 0,
    noun: 'knee',
    worst: 'min',
  },
  trunkLean: {
    label: 'Trunk lean',
    unit: '°',
    target: 'Target 0–12° forward from vertical',
    digits: 1,
  },
  hipDrop: {
    label: 'Pelvic drop',
    unit: '°',
    target: 'Target ≤ 6° pelvic drop in stance',
    digits: 1,
    noun: 'stance',
    worst: 'max',
  },
  rearfoot: {
    label: 'Rearfoot angle',
    unit: '°',
    target: 'Target ≤ 10° heel eversion at mid-stance',
    digits: 1,
    noun: 'heel',
    worst: 'max',
  },
  stepWidth: {
    label: 'Step width',
    unit: 'cm',
    target: 'Typical 3–13 cm between foot strikes',
    digits: 1,
  },
  crossover: {
    label: 'Crossover stride',
    unit: '% hip width',
    target: 'Target: foot lands on its own side of the midline',
    digits: 1,
    noun: 'foot',
    worst: 'max',
  },
  heelWhip: {
    label: 'Heel whip',
    unit: '°',
    target: 'Target ≤ 10° sideways heel deviation after toe-off',
    digits: 1,
    noun: 'heel',
    worst: 'max',
  },
  shoulderTilt: {
    label: 'Shoulder tilt',
    unit: '°',
    target: 'Target ≤ 5° off horizontal',
    digits: 1,
  },
  valgus: {
    label: 'Knee valgus',
    unit: '°',
    target: 'Target ≤ 10° inward knee angle',
    digits: 1,
    noun: 'knee',
    worst: 'max',
  },
  armCross: {
    label: 'Arm crossover',
    unit: '% shoulder width',
    target: 'Target: hands stay on their own side of the sternum',
    digits: 0,
    noun: 'hand',
    worst: 'max',
  },
  latTrunk: {
    label: 'Lateral trunk lean',
    unit: '°',
    target: 'Target ≤ 6° side-to-side',
    digits: 1,
  },
  kneeWindow: {
    label: 'Knee window',
    unit: '% of strides',
    target: 'Target: daylight between the knees on ≥ 80% of strides',
    digits: 0,
  },
  kneeTrack3d: {
    label: '3D knee tracking',
    unit: '°',
    target: 'Target ≤ 8° inward drift off the hip–ankle line',
    digits: 1,
    noun: 'knee',
    worst: 'max',
  },
  trunkRot: {
    label: 'Trunk-on-pelvis rotation',
    unit: '°',
    target: 'Target ≤ 12° shoulders vs hips',
    digits: 1,
  },
  elbowFlare: {
    label: 'Elbow flare',
    unit: '°',
    target: 'Target ≤ 20° away from the ribs',
    digits: 1,
    noun: 'elbow',
    worst: 'max',
  },
  hipFlex3d: {
    label: 'Hip flexion (swing)',
    unit: '°',
    target: 'Target ≥ 30° thigh drive',
    digits: 0,
    noun: 'hip',
    worst: 'min',
  },
  hipExt3d: {
    label: 'Hip extension at toe-off',
    unit: '°',
    target: 'Target ≥ 10° behind the torso line',
    digits: 1,
    noun: 'hip',
    worst: 'min',
  },
  eversionVel: {
    label: 'Ankle eversion velocity',
    unit: '°/s',
    target: 'Target ≤ 300°/s roll-in after contact',
    digits: 0,
    noun: 'ankle',
    worst: 'max',
  },
  pushoffStab: {
    label: 'Push-off ankle stability',
    unit: '°',
    target: 'Target ≤ 18° rotation/wobble at push-off',
    digits: 1,
    noun: 'foot',
    worst: 'max',
  },
  driveAngle: {
    label: 'Rear-leg drive path',
    unit: '°',
    target: 'Target ≤ 50° from vertical — heel lifts up, not out',
    digits: 0,
    noun: 'leg',
    worst: 'max',
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
  gct: {
    title: 'Long ground contact time',
    why: 'The longer each foot stays planted, the more of each stride is spent braking and re-accelerating instead of gliding. Long contacts usually pair with overstriding and a low cadence, and they rise sharply with fatigue.',
    fix: 'Think "hot pavement" — feet snap off the ground. Raising cadence ~5% shortens contacts automatically; ankle-stiffness work (jump rope, hops) makes the snap effortless.',
    exercises: [
      { name: 'Jump rope', dose: '3 × 45 s, quick low hops' },
      { name: 'Pogo hops', dose: '3 × 20, stiff ankles, minimal knee bend' },
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% cadence' },
    ],
  },
  flight: {
    title: 'Flight time outside the typical band',
    why: 'Very long airtime means a bouncy, loping stride — energy going up instead of forward, and bigger impacts on landing. Near-zero airtime is a shuffle: safe, but it caps your speed because the stride never opens up.',
    fix: 'If airtime is high, raise cadence and think "run across the ground, not over it." If it\'s near zero and you want more speed, add strides and hill sprints to build the elastic push-off a longer flight needs.',
    exercises: [
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% cadence (if flight is long)' },
      { name: 'Hill sprints', dose: '6 × 8 s steep hill, full recovery (if flight is short)' },
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
  overstrideDist: {
    title: 'Foot landing far ahead of the hips',
    why: 'The farther in front of your center of mass the foot touches down, the bigger the braking force each step sends up the shin and knee. Some reach is normal — but a landing point well ahead of the hips means every stride fights your momentum.',
    fix: 'Don\'t consciously shorten your reach — raise cadence ~5% instead, and the landing point moves back under you on its own. Think "land under your hips."',
    exercises: [
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% cadence' },
      { name: 'Barefoot strides on grass', dose: '4 × 15 s — overstriding barefoot is instantly uncomfortable' },
      { name: 'Butt kicks / hamstring pulls', dose: '2 × 20 m before runs' },
    ],
  },
  overstride: {
    title: 'Overstriding — shin angled forward at contact',
    why: 'When the foot lands well ahead of the knee (shin angled forward at contact), every step acts as a brake: impact spikes travel up the shin and knee instead of being absorbed. Overstriding is the most common form fault in recreational runners and is linked to shin splints and knee pain.',
    fix: 'Don\'t try to "pull your foot back" — instead raise cadence ~5%. Quicker steps naturally shorten the stride so the foot lands under a bent knee. Think "land under your hips."',
    exercises: [
      { name: 'Metronome runs', dose: '3–4 × 3 min at +5% of your current cadence' },
      { name: 'Butt kicks / hamstring pulls', dose: '2 × 20 m before runs — grooves pulling the foot up, not reaching out' },
      { name: 'Barefoot strides on grass', dose: '4 × 15 s — barefoot landing makes overstriding instantly uncomfortable' },
      { name: 'Downhill-avoidance cue', dose: 'On downhills (where overstriding is worst), shorten steps and lean with the slope' },
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
  kneeSwing: {
    title: 'Low heel recovery in swing',
    why: 'After push-off the heel should fold up toward the glutes, shortening the leg\'s pendulum so it swings through fast and cheap. A low, trailing heel makes every swing slower and heavier, dragging cadence down with it.',
    fix: 'Cue "heel to pocket" — feel the heel travel up the back of the standing leg. It follows naturally from a good hip extension and relaxed quads; forcing it with a deliberate butt-kick motion is not the goal.',
    exercises: [
      { name: 'Butt kicks / hamstring pulls', dose: '2 × 20 m before runs' },
      { name: 'Fast leg drill', dose: '3 × 10 per side — one quick full cycle of one leg while walking' },
      { name: 'Hamstring curls (band or slider)', dose: '3 × 10–12' },
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
  rearfoot: {
    title: 'Heavy rearfoot eversion (pronation)',
    why: 'Some inward roll after contact is normal and useful — it\'s how the foot absorbs shock. But a heel that collapses far inward at mid-stance strains the posterior tibialis and Achilles and often feeds knee valgus higher up. (Single-camera heel tracking is coarse — treat this as a prompt to look closer, not a diagnosis.)',
    fix: 'Build foot and calf strength before reaching for motion-control shoes. If you have pain along the inner shin or arch, have a professional watch you run.',
    exercises: [
      { name: 'Short-foot drill', dose: '3 × 10 × 5 s holds per side' },
      { name: 'Single-leg calf raises (slow)', dose: '3 × 12–15 per side, full range' },
      { name: 'Towel scrunches / toe yoga', dose: '2 × 2 min' },
    ],
  },
  stepWidth: {
    title: 'Step width outside the typical band',
    why: 'Feet landing nearly on one line (very narrow) bows the leg inward each step — the same stress pattern as crossover gait. A very wide stance is rarer and usually a balance compensation that wastes energy side-to-side.',
    fix: 'If narrow: the railroad-track cue — each foot lands on its own rail. If wide: work single-leg balance so the body stops outsourcing stability to a wide base.',
    exercises: [
      { name: 'Treadmill midline drill', dose: 'Easy runs straddling the belt\'s center line' },
      { name: 'Single-leg balance + reach', dose: '3 × 30 s per side' },
      { name: 'Lateral band walks', dose: '3 × 10–15 steps each direction' },
    ],
  },
  crossover: {
    title: 'Feet landing across the midline (crossover stride)',
    why: 'If your feet land across an imaginary center line — like running on a tightrope — each stride bows the leg inward, increasing stress on the IT band, shins, and hips. It commonly appears together with hip drop.',
    fix: 'The classic cue: imagine running on railroad tracks — one rail under each side, feet landing on their own rail. On a treadmill, the belt\'s center line gives you instant feedback.',
    exercises: [
      { name: 'Treadmill midline drill', dose: 'Easy runs straddling the belt\'s center line, checking foot placement every few minutes' },
      { name: 'Lateral band walks', dose: '3 × 10–15 steps each direction' },
      { name: 'Single-leg balance + reach', dose: '3 × 30 s per side, progress to eyes closed' },
      { name: 'Side-lying hip abduction', dose: '3 × 12–15 per side' },
    ],
  },
  heelWhip: {
    title: 'Heel whipping sideways after toe-off',
    why: 'As the foot leaves the ground it should travel straight up and through. A heel that flicks inward or outward signals a rotation somewhere in the chain — often limited hip internal rotation or an ankle pushing off crooked — and it torques the shin with every stride.',
    fix: 'Heel whip rarely responds to "thinking about the foot." Free up hip rotation and strengthen the glutes so the leg drives straight; film again after a few weeks.',
    exercises: [
      { name: '90/90 hip switches', dose: '2 × 8 per side, slow' },
      { name: 'Clamshells', dose: '3 × 15–20 per side' },
      { name: 'Single-leg RDL', dose: '3 × 8–10 per side' },
    ],
  },
  shoulderTilt: {
    title: 'Shoulders tilting side to side',
    why: 'A shoulder line that dips with each step usually mirrors what the pelvis is doing underneath — the trunk is compensating for hip instability, or one side\'s obliques are working overtime. It shows up as a rocking, side-to-side style from behind.',
    fix: 'Treat the trunk and hips as one system: level the pelvis (hip abductor strength) and stiffen the sides (side planks), and the shoulders usually level out on their own.',
    exercises: [
      { name: 'Side plank', dose: '3 × 20–30 s per side' },
      { name: 'Suitcase carries', dose: '3 × 30 m per side, heavy enough to challenge staying level' },
      { name: 'Hip hikes', dose: '3 × 12–15 per side' },
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
  armCross: {
    title: 'Hands crossing the body midline',
    why: 'Arms should swing mostly forward–back. When the hands travel across the sternum, the upper body rotates to compensate, which wastes energy and often accompanies a narrow or crossover stride down below.',
    fix: 'Cue elbows bent ~90° and hands tracing "hip to nip" — brushing near the hip bone on the backswing and no more central than the sternum on the front swing. Relax the shoulders; tension makes arms wrap inward.',
    exercises: [
      { name: 'Standing arm-swing drill', dose: '3 × 30 s in front of a mirror, exaggerating straight front-back swing' },
      { name: 'Open books (thoracic rotation)', dose: '2 × 10 per side, slow' },
      { name: 'Band pull-aparts', dose: '3 × 15, keeps shoulders back and relaxed' },
    ],
  },
  latTrunk: {
    title: 'Trunk swaying side to side',
    why: 'Bending sideways over each stance leg shifts your center of mass off the line of travel — energy leaks laterally, and the spine and hip take asymmetric load. It\'s commonly a compensation for weak hip abductors or poor trunk endurance.',
    fix: 'Cue "run tall between two panes of glass." Then fix the underlying capacity: lateral core and hip strength, especially if the sway grows late in runs.',
    exercises: [
      { name: 'Side plank', dose: '3 × 20–30 s per side' },
      { name: 'Suitcase carries', dose: '3 × 30 m per side' },
      { name: 'Copenhagen plank (short lever)', dose: '3 × 15–20 s per side' },
    ],
  },
  kneeWindow: {
    title: 'No daylight between the knees',
    why: 'Viewed from the front, a small gap — a "knee window" — should stay visible as the swing leg passes the stance leg. When the knees brush or overlap, the legs are tracking toward the midline: the same inward-collapse family as valgus and crossover, seen from another angle.',
    fix: 'Same medicine as crossover and valgus: hip abductor strength plus the railroad-tracks cue. The window opens as the feet stop landing on one line.',
    exercises: [
      { name: 'Lateral band walks', dose: '3 × 10–15 steps each direction' },
      { name: 'Banded squats with knees-out cue', dose: '3 × 10–12' },
      { name: 'Treadmill midline drill', dose: 'Easy runs straddling the belt\'s center line' },
    ],
  },
  kneeTrack3d: {
    title: 'Knee drifting off its track (3D)',
    why: 'In 3D, the knee\'s path during stance should stay close to the line from hip to ankle — tracking over the toes. A path that bows inward (or wobbles across the line) concentrates load on the kneecap and MCL and points to hip-control or foot-stability gaps.',
    fix: 'Groove the pattern slowly first: single-leg work in front of a mirror with a "knee over second toe" cue, then progress to hops and running speed.',
    exercises: [
      { name: 'Lateral step-downs', dose: '3 × 8–10 per side, slow, knee over second toe' },
      { name: 'Single-leg hops (stick the landing)', dose: '3 × 6 per side' },
      { name: 'Banded squats', dose: '3 × 10–12, band above knees' },
    ],
  },
  trunkRot: {
    title: 'Excess trunk-on-pelvis rotation',
    why: 'Some counter-rotation between shoulders and hips is natural and stores elastic energy. Too much — shoulders visibly swiveling over the pelvis — usually means the arms are swinging across the body or the core isn\'t bracing, and that rotational energy never returns as forward motion.',
    fix: 'Fix the arms first (straight forward-back swing) — excess trunk rotation is usually the body balancing crossing arms. Then add anti-rotation core work.',
    exercises: [
      { name: 'Pallof press', dose: '3 × 10 per side, slow' },
      { name: 'Standing arm-swing drill', dose: '3 × 30 s, straight lines' },
      { name: 'Dead bugs', dose: '3 × 8 per side' },
    ],
  },
  elbowFlare: {
    title: 'Elbows flaring away from the body',
    why: 'When the elbows wing outward, the arm swing turns rotational — the hands arc around the body instead of driving forward-back, feeding trunk rotation and wasting the upper body\'s contribution to rhythm.',
    fix: 'Cue "elbows brush the ribs." Keep ~90° at the elbow and let the hands travel hip-to-chest in a straight line. Shake out the shoulders when you feel them creep up — tension makes elbows wing.',
    exercises: [
      { name: 'Standing arm-swing drill (mirror)', dose: '3 × 30 s, elbows grazing the ribs' },
      { name: 'Band pull-aparts', dose: '3 × 15' },
      { name: 'Wall angels', dose: '2 × 10, slow' },
    ],
  },
  hipFlex3d: {
    title: 'Low thigh drive in swing',
    why: 'The swing thigh should drive forward and up — that knee lift is what sets up a landing under the body and gives the stride its length without reaching. A flat, low knee drive usually means tight or weak hip flexors and shows up as a shuffling stride.',
    fix: 'Strengthen the hip flexors through their full range (most people only ever stretch them) and rehearse the drive pattern with skips before expecting it in the run.',
    exercises: [
      { name: 'A-skips', dose: '3 × 20 m' },
      { name: 'Banded march / psoas march', dose: '3 × 10 per side' },
      { name: 'High-knee wall drill', dose: '3 × 10 s quick knee drives against a wall' },
    ],
  },
  hipExt3d: {
    title: 'Stride finishing early (limited hip extension)',
    why: 'Push-off power comes from the thigh traveling behind the body — glutes and hamstrings finishing the stride. If the thigh barely passes vertical at toe-off, the stride is all in front of you: more braking, less propulsion, and the hip flexors carry load they shouldn\'t. Usually the culprit is desk-tightened hip flexors.',
    fix: 'Open the front of the hip (couch stretch) and teach the glutes to finish (hip thrusts, hill work). Cue "push the ground behind you" rather than reaching ahead.',
    exercises: [
      { name: 'Couch stretch', dose: '2 × 1 min per side, daily' },
      { name: 'Hip thrusts', dose: '3 × 8–12, pause at the top' },
      { name: 'Hill sprints', dose: '6 × 8 s — hills force full hip extension' },
    ],
  },
  eversionVel: {
    title: 'Fast ankle roll-in after contact',
    why: 'It\'s not how far the ankle rolls inward that correlates best with overuse injury — it\'s how fast. A rapid collapse right after contact means the foot\'s intrinsic stabilizers and the posterior tibialis aren\'t decelerating the roll, sending the load into the shin. (At 20 fps this is a coarse estimate — treat it as a screening prompt.)',
    fix: 'Strengthen the structures that slow pronation down; consider a gait check with a professional if you have inner-shin pain.',
    exercises: [
      { name: 'Short-foot drill', dose: '3 × 10 × 5 s holds per side' },
      { name: 'Eccentric calf raises (slow lowering)', dose: '3 × 12 per side' },
      { name: 'Resisted ankle inversion (band)', dose: '3 × 15 per side' },
    ],
  },
  pushoffStab: {
    title: 'Foot rotating or wobbling at push-off',
    why: 'The push-off should drive straight back through the big toe. A foot that swivels outward ("duck foot") or wobbles as it leaves the ground leaks force sideways and twists the shin — a common precursor to Achilles and calf irritation.',
    fix: 'Build single-leg push-off stability from the ground up: balance work, controlled calf raises tracking over the big toe, and check that limited big-toe or ankle mobility isn\'t forcing the rotation.',
    exercises: [
      { name: 'Single-leg calf raises over the big toe', dose: '3 × 12 per side, slow' },
      { name: 'Single-leg balance on an unstable surface', dose: '3 × 30 s per side' },
      { name: 'Big-toe mobility drill', dose: '2 × 10 extensions per side' },
    ],
  },
  driveAngle: {
    title: 'Rear leg swinging out instead of up',
    why: 'Right after toe-off the ankle should travel mostly upward as the hamstring folds the leg. A path that drifts sideways or drags low and backward means the posterior chain isn\'t snapping the leg through — the recovery gets slow, wide, and expensive.',
    fix: 'Cue a quick "pull the heel up" the instant the foot leaves the ground. Hamstring-focused drills groove it faster than thinking about it mid-run.',
    exercises: [
      { name: 'Butt kicks / hamstring pulls', dose: '2 × 20 m before runs' },
      { name: 'Fast leg drill', dose: '3 × 10 per side' },
      { name: 'Slider or band hamstring curls', dose: '3 × 10–12' },
    ],
  },
};

export const ALL_GOOD_MESSAGE = {
  title: 'No red flags detected',
  body: 'Nothing in this clip exceeded the screening thresholds. Keep in mind this is a single-camera screening, not a lab gait analysis — and each camera angle only sees part of the picture (a front view can\'t see overstriding; a side view can\'t see hip drop or crossover). For the full check, film another angle too and run it through.',
};
