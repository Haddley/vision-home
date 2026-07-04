// Vision Home - WebXR Brock string home-training companion to the Quest Pro "Vision" app.
// Shares that app's clinical design (confirm-only interaction, timeout-is-a-finding, session
// records as human-readable JSON) but none of its code: this is deliberately a tiny static
// three.js app a patient opens in their headset browser at home - no store, no sideloading.
//
// The patient's ONE control is the WebXR "select" action (controller trigger or bare-hand pinch),
// exactly mirroring the native app's A button. No eye tracking here: WebXR doesn't expose gaze,
// so this app carries only the A-press activities - measurement comes from when the patient says
// they see the percept, which is the primary signal for these activities in the native app too.

import * as THREE from './lib/three.module.js';

// ---------- records (localStorage; downloadable as the same JSON shape the clinic app uses) ----

const RECORDS_KEY = 'visionHomeRecords';

function loadRecords() {
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) ?? []; }
  catch { return []; }
}

function saveRecord(record) {
  const records = loadRecords();
  records.push(record);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  renderRecordsTable();
}

function renderRecordsTable() {
  const tbody = document.querySelector('#recordsTable tbody');
  tbody.innerHTML = '';
  for (const record of loadRecords().slice().reverse()) {
    const row = document.createElement('tr');
    const date = new Date(record.startedUtc);
    const summary = record.results.map(r => r.summary).join(' | ') || '(no activities)';
    row.innerHTML = `<td>${date.toLocaleDateString()} ${date.toLocaleTimeString([], { timeStyle: 'short' })}</td>` +
      `<td>${Math.round(record.durationSeconds / 60)} min</td><td>${summary}</td>`;
    tbody.appendChild(row);
  }
}

document.getElementById('downloadBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(loadRecords(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vision-home-records-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

renderRecordsTable();

// ---------- settings (persisted in localStorage, prefilled on the next visit; the prism values
// are the patient's prescription as entered on professional instruction - like everything else
// here they never leave the device) ----------

const SETTINGS_KEY = 'visionHomeSettings';
const settingsFields = ['patientName', 'stringLength', 'prismEnabled', 'prismVertical', 'prismHorizontal',
  'headTiltAlerts',
  'actCnp', 'actDivergenceRange', 'actDivergenceJumps', 'actPrismStress', 'actVerticalFusion',
  'actSustainedVergence', 'actBothEyes', 'actStereoAcuity', 'actContrastSensitivity'];

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { }
  for (const id of settingsFields) {
    const el = document.getElementById(id);
    if (!(id in saved)) continue;
    if (el.type === 'checkbox') el.checked = saved[id];
    else el.value = saved[id];
  }
}

function saveSettings() {
  const out = {};
  for (const id of settingsFields) {
    const el = document.getElementById(id);
    out[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
}

for (const id of settingsFields) {
  document.getElementById(id).addEventListener('change', saveSettings);
}
loadSettings();

// ---------- speech: pre-generated audio clips, NOT speechSynthesis ---------------------------
// Meta's Quest Browser doesn't implement speech synthesis (utterances neither speak nor fire
// onend), which on-device made the first session silently stall at its first prompt. Clips are
// generated offline with macOS `say` (same pipeline as the native app) and shipped with the app.
//
// Clips play through one shared AudioContext (Web Audio), never HTMLAudioElement: element
// .play() is gesture-gated per call by autoplay policy and silently skipped clips mid-session
// inside the immersive XR session, whereas a context unlocked once by the Start click can
// schedule buffers for the whole session. Playback stays stall-proof - whatever goes wrong,
// the speak() promise resolves after the clip's duration plus a small grace (or 12s if the
// clip never decoded) - and every failure is reported via onIssue so it lands in the session
// record instead of vanishing.

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Quest Browser suspends the page's AudioContext when the immersive session engages (observed
// on-device as the welcome clip freezing mid-sentence and its tail unfreezing much later).
// Re-resume immediately on every suspension; resume() is allowed without a fresh gesture once
// the page has sticky activation from the Start click.
audioContext.addEventListener('statechange', () => {
  if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
});

let currentSpeechSource = null;
function stopCurrentSpeech() {
  if (currentSpeechSource) {
    try { currentSpeechSource.stop(); } catch { /* already ended */ }
    currentSpeechSource = null;
  }
}

// Prompts that name the confirm action exist in _trigger/_pinch variants; speak() picks by
// the session's live input mode. Neutral prompts have a single clip.
const speechClips = {}; // id -> Promise<AudioBuffer|null>; null = load/decode failed (kept in the error message)
const speechClipErrors = {};
for (const id of ['welcome_trigger', 'welcome_pinch', 'cnp_intro_trigger', 'cnp_intro_pinch',
                  'press_when_one_trigger', 'press_when_one_pinch', 'jumps_intro_trigger',
                  'jumps_intro_pinch', 'sustained_intro_trigger', 'sustained_intro_pinch',
                  'divergence_range_intro_trigger', 'divergence_range_intro_pinch',
                  'prism_stress_intro_trigger', 'prism_stress_intro_pinch',
                  'vertical_fusion_intro_trigger', 'vertical_fusion_intro_pinch',
                  'both_eyes_intro_trigger', 'both_eyes_intro_pinch',
                  'stereo_intro_trigger', 'stereo_intro_pinch',
                  'contrast_intro_trigger', 'contrast_intro_pinch',
                  'other_direction', 'head_tilt_left', 'head_tilt_right',
                  'next_exercise', 'last_exercise', 'all_done']) {
  speechClips[id] = fetch(`./audio/${id}.m4a`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(data => audioContext.decodeAudioData(data))
    .catch(e => { speechClipErrors[id] = e.message || String(e); return null; });
}

// 'trigger' when a controller is present, 'pinch' otherwise. Bare hands on Quest expose a
// `hand` on their input source; Vision Pro's transient-pointer inputs only exist mid-pinch,
// so an empty input list also means pinch. Updated live on inputsourceschange, so a Quest
// user who sets the controllers down mid-session gets the right word too.
let inputMode = 'pinch';
function updateInputMode(session) {
  const hasController = Array.from(session.inputSources).some(s => s.gamepad && !s.hand);
  inputMode = hasController ? 'trigger' : 'pinch';
}

function speak(clipId, onIssue = () => {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    setTimeout(finish, 15000); // absolute backstop; no clip is anywhere near this long
    const variantId = speechClips[`${clipId}_${inputMode}`] ? `${clipId}_${inputMode}` : clipId;
    const clipPromise = speechClips[variantId];
    if (!clipPromise) { onIssue('unknown clip id'); finish(); return; }
    // Don't start a clip into a suspended context - it would sit frozen and unfreeze at some
    // arbitrary later moment. Wait (bounded) for the context to actually be running.
    const ensureRunning = audioContext.state === 'running'
      ? Promise.resolve()
      : (onIssue(`audio context was ${audioContext.state}, resuming`),
         Promise.race([audioContext.resume(), new Promise(r => setTimeout(r, 3000))]));
    Promise.all([clipPromise, ensureRunning]).then(([buffer]) => {
      if (done) return;
      if (!buffer) { onIssue(`clip ${variantId} failed to load: ${speechClipErrors[variantId]}`); finish(); return; }
      if (audioContext.state !== 'running') onIssue(`audio context still ${audioContext.state}; clip likely silent`);
      setTimeout(finish, (buffer.duration + 1.5) * 1000);
      stopCurrentSpeech(); // a lingering earlier clip must never overlap this one
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => { if (currentSpeechSource === source) currentSpeechSource = null; finish(); };
      currentSpeechSource = source;
      source.start();
    }).catch(e => { onIssue(e.message || String(e)); finish(); });
  });
}

// ---------- XR session & scene ---------------------------------------------------------------

const startBtn = document.getElementById('startBtn');

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then(supported => {
    if (!supported) {
      document.getElementById('unsupported').style.display = 'block';
      startBtn.disabled = true;
    }
  });
} else {
  document.getElementById('unsupported').style.display = 'block';
  startBtn.disabled = true;
}

startBtn.addEventListener('click', runSession);

// State shared between the routine (async) and the render loop / select handler.
const state = {
  selected: false,          // set by the select handler, consumed by waitForSelect
  speaking: false,          // selects during speech are ignored (don't race the prompt)
  motion: null,             // { bead, velocity, minZ, maxZ } - advanced by the render loop
};

function onSelect() {
  // A select is a user gesture - use each one to keep the audio context unlocked.
  if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
  if (!state.speaking) {
    state.selected = true;
  }
}

// ---------- Brock-string visuals -------------------------------------------------------------

// A real bead is a sphere with a cylindrical hole drilled through it. Lathe a profile that
// runs down the hole wall and back over the sphere surface, then rotate the geometry so the
// hole axis lies along Z - the string's axis - and the cord visibly threads every bead.
function makeBeadGeometry(radius, holeRadius) {
  const rimAngle = Math.asin(holeRadius / radius); // polar angle where the hole meets the sphere
  const rimY = Math.cos(rimAngle) * radius;
  const points = [new THREE.Vector2(holeRadius, rimY), new THREE.Vector2(holeRadius, -rimY)];
  const arcSteps = 24;
  for (let i = 0; i <= arcSteps; i++) {
    const phi = (Math.PI - rimAngle) - (i / arcSteps) * (Math.PI - 2 * rimAngle);
    points.push(new THREE.Vector2(Math.sin(phi) * radius, Math.cos(phi) * radius));
  }
  const geometry = new THREE.LatheGeometry(points, 32);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

// One strand of a twisted rope: a thin tube swept along a helix running down -Z (the string
// axis). The twist is geometry, not texture - a striped texture on a thin cylinder mip-blends
// to muddy grey at the grazing angle a Brock string is viewed from and reads as a straw;
// real strands keep their silhouette and shading at any angle.
function makeStrandGeometry(length, strandRadius, twistRadius, pitch, strandIndex, strandCount) {
  const turns = length / pitch;
  const phase = (strandIndex / strandCount) * 2 * Math.PI;
  const helix = new THREE.Curve();
  helix.getPoint = (t, target = new THREE.Vector3()) => {
    const angle = 2 * Math.PI * turns * t + phase;
    return target.set(Math.cos(angle) * twistRadius, Math.sin(angle) * twistRadius, -length * t);
  };
  return new THREE.TubeGeometry(helix, Math.ceil(turns * 16), strandRadius, 8, false);
}

async function runSession() {
  // Unlock audio while still inside the click gesture (before any await) - autoplay policy
  // ties AudioContext.resume() to user activation on Quest Browser and Vision Pro Safari.
  audioContext.resume().catch(() => {});

  const patientName = document.getElementById('patientName').value.trim() || 'patient';
  const stringLength = parseFloat(document.getElementById('stringLength').value);
  const prism = {
    enabled: document.getElementById('prismEnabled').checked,
    verticalDiopters: parseFloat(document.getElementById('prismVertical').value) || 0,
    horizontalDiopters: parseFloat(document.getElementById('prismHorizontal').value) || 0,
  };

  // The exercises ticked on the landing page (mirrors the native app's activities checklist).
  const selectedActivities = settingsFields.filter(id =>
    id.startsWith('act') && document.getElementById(id).checked);
  if (selectedActivities.length === 0) {
    alert('Tick at least one exercise before starting.');
    return;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
  // Directional key light so the cord's twist and the beads' hole rims actually shade -
  // hemisphere light alone renders them flat.
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(0.5, 1, 0.6);
  scene.add(keyLight);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  scene.add(camera);

  // A dim floor grid so the patient has a stable world reference (comfort), nothing more.
  const grid = new THREE.GridHelper(10, 20, 0x223044, 0x18202e);
  grid.position.y = -1.4;
  scene.add(grid);

  // --- Brock string: parented to the camera like a real string held to the nose, inclined
  // gently downward per standard clinical setup (same geometry as the native app). Camera space
  // looks down -Z, so the string extends along -Z and a negative X-rotation drops the far end.
  const stringGroup = new THREE.Group();
  stringGroup.rotation.x = THREE.MathUtils.degToRad(-7.5);
  camera.add(stringGroup);

  const beadDefs = [
    { name: 'red', color: 0xd93025, z: 0.20 },
    { name: 'yellow', color: 0xf5c518, z: 0.45 },
    { name: 'green', color: 0x2fa84f, z: stringLength - 0.05 },
  ];
  const beadGeometry = makeBeadGeometry(0.011, 0.003); // 22mm bead, 6mm hole (snug fit on the 5mm cord)
  const beads = beadDefs.map(def => {
    const bead = new THREE.Mesh(
      beadGeometry,
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.35, side: THREE.DoubleSide }));
    bead.position.z = -def.z;
    stringGroup.add(bead);
    return bead;
  });

  // The cord: a solid 3.8mm core with two strands riding on it as surface relief - 5mm overall,
  // threading the beads' 6mm bore snugly. The core prevents any true see-through; the 7mm pitch
  // makes successive strand wraps (every 3.5mm) wider than their spacing, so they touch and no
  // bare core shows between them - exposed shaded core was what read as gaps in earlier tries.
  const cordMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.55 });
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0019, 0.0019, stringLength, 12, 1, true), cordMaterial);
  core.geometry.rotateX(Math.PI / 2); // height axis Y -> Z, along the string
  core.position.z = -stringLength / 2;
  stringGroup.add(core);
  for (let strand = 0; strand < 2; strand++) {
    stringGroup.add(new THREE.Mesh(
      makeStrandGeometry(stringLength, 0.0015, 0.001, 0.007, strand, 2), cordMaterial));
  }

  // Small magenta dot above the string whenever any prism shift is active (prescription or an
  // activity's ramp) - unmissable ground truth that the shift code path is running, learned
  // from debugging a session where a stalled audio prompt made it impossible to tell whether
  // prism was even on.
  const prismIndicator = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff40ff }));
  prismIndicator.position.set(0, 0.12, -0.8);
  prismIndicator.visible = false;
  camera.add(prismIndicator);

  function showOnlyBead(index) {
    beads.forEach((bead, i) => { bead.visible = index === null || i === index; });
  }
  function setBeadZ(index, z) { beads[index].position.z = -z; }
  function beadZ(index) { return -beads[index].position.z; }

  // --- prism simulation: the same optics as the native app's screen-space shift, expressed as
  // a per-eye translation of the projection matrix. 1 prism diopter = a 1% tangent deviation;
  // NDC x for a direction with tangent t is t * m00, so the image shift in NDC is
  // (diopters/100) * m00 (and m11 vertically) - no FOV assumptions, read from the projection the
  // XR system provided this frame. Sign conventions match the native PrismController exactly:
  // right eye base-down + base-out => image shifts up (+y) and toward the nose (-x); left eye
  // mirrored. Reapplied every frame because WebXR refreshes the matrices every frame.
  // Activities (prism stress, vertical fusion) drive their own shift on top of - or instead of -
  // the prescription; the routine zeroes this between activities so a ramp never leaks onward.
  const activityPrism = { horizontal: 0, vertical: 0 };
  const shiftMatrix = new THREE.Matrix4();
  function applyPrism() {
    const h = (prism.enabled ? prism.horizontalDiopters : 0) + activityPrism.horizontal;
    const v = (prism.enabled ? prism.verticalDiopters : 0) + activityPrism.vertical;
    prismIndicator.visible = h !== 0 || v !== 0;
    if (!prismIndicator.visible) return;
    const xrCamera = renderer.xr.getCamera();
    if (!xrCamera.isArrayCamera || xrCamera.cameras.length !== 2) return;
    xrCamera.cameras.forEach((eyeCamera, i) => {
      const isRight = i === 1;
      const m00 = eyeCamera.projectionMatrix.elements[0];
      const m11 = eyeCamera.projectionMatrix.elements[5];
      const x = (h / 100) * m00 * (isRight ? -1 : 1);
      const y = (v / 100) * m11 * (isRight ? 1 : -1);
      shiftMatrix.makeTranslation(x, y, 0);
      eyeCamera.projectionMatrix.premultiply(shiftMatrix);
      eyeCamera.projectionMatrixInverse.copy(eyeCamera.projectionMatrix).invert();
    });
  }

  // --- head-tilt biofeedback (ported from the native HeadTiltMonitor): a sustained head roll
  // toward a shoulder is compensatory posture - a clinical sign the prism correction is wrong,
  // or that one is needed. Same spec as native: >10° held 2.5s speaks a gentle nudge, 15s
  // cooldown per direction (a habitual left tilt doesn't silence a right-tilt warning), never
  // talks over a prompt, and every alert is logged with angle and direction so the professional
  // can read tilt frequency from the record.
  const headTilt = {
    enabled: document.getElementById('headTiltAlerts').checked,
    direction: null,
    since: null,
    cooldownUntil: { left: 0, right: 0 },
  };
  const headRight = new THREE.Vector3();
  function monitorHeadTilt() {
    if (!headTilt.enabled || !renderer.xr.isPresenting) return;
    // Roll = how far the head's right axis dips out of the horizontal plane. Right ear down
    // (rightward tilt) sends it below the horizon; left tilt lifts it above.
    headRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const tiltDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(headRight.y, -1, 1)));
    if (Math.abs(tiltDeg) < 10) { headTilt.since = null; return; }
    const direction = tiltDeg > 0 ? 'left' : 'right';
    const now = performance.now();
    if (headTilt.direction !== direction || headTilt.since === null) {
      headTilt.direction = direction;
      headTilt.since = now;
      return;
    }
    if (now - headTilt.since < 2500) return;
    if (now < headTilt.cooldownUntil[direction]) return;
    if (state.speaking) return; // a posture nudge never talks over a prompt
    headTilt.cooldownUntil[direction] = now + 15000;
    headTilt.since = now; // the next alert needs a fresh sustained tilt
    logEvent(`head tilt alert: ${Math.abs(tiltDeg).toFixed(0)} degrees toward ${direction} shoulder`);
    speak(`head_tilt_${direction}`, issue => logEvent(`speech head_tilt_${direction}: ${issue}`));
  }

  // --- render loop: advances any scripted bead motion, applies the prism shift.
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const m = state.motion;
    if (m) {
      const z = THREE.MathUtils.clamp(beadZ(m.bead) + m.velocity * dt, m.minZ, m.maxZ);
      setBeadZ(m.bead, z);
    }
    monitorHeadTilt();
    applyPrism();
    renderer.render(scene, camera);
  });

  // --- session start.
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['hand-tracking', 'local-floor'] });
  } catch (e) {
    alert('Could not start the VR session: ' + e.message);
    return;
  }
  await renderer.xr.setSession(session);
  session.addEventListener('select', onSelect);
  updateInputMode(session);
  session.addEventListener('inputsourceschange', () => updateInputMode(session));

  const record = {
    app: 'vision-home',
    patientName,
    stringLengthMeters: stringLength,
    prescription: prism,
    startedUtc: new Date().toISOString(),
    durationSeconds: 0,
    results: [],
    events: [],
  };
  const startedAt = performance.now();
  const logEvent = message => record.events.push(`${new Date().toISOString()} ${message}`);

  // --- confirm/timeout helpers (same semantics as the clinic app: a timeout is the patient
  // telling us something, never an error).
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function say(clipId) {
    state.speaking = true;
    await speak(clipId, issue => logEvent(`speech ${clipId}: ${issue}`));
    state.speaking = false;
    state.selected = false; // presses made during speech don't count
  }

  function waitForSelect(timeoutMs) {
    state.selected = false;
    const started = performance.now();
    return new Promise(resolve => {
      const poll = () => {
        if (state.selected) { state.selected = false; resolve({ confirmed: true, ms: performance.now() - started }); }
        else if (performance.now() - started > timeoutMs) { resolve({ confirmed: false, ms: timeoutMs }); }
        else { setTimeout(poll, 16); }
      };
      poll();
    });
  }

  // Ramp a value toward a bound until the patient confirms or the bound is reached (reaching
  // the bound unconfirmed is a finding, exactly like a bead reaching the end of its travel).
  function rampUntilSelect(from, to, unitsPerSecond, apply) {
    state.selected = false;
    const dir = Math.sign(to - from) || 1;
    let value = from;
    let last = performance.now();
    return new Promise(resolve => {
      const poll = () => {
        const now = performance.now();
        value += dir * unitsPerSecond * (now - last) / 1000;
        last = now;
        if ((dir > 0 && value >= to) || (dir < 0 && value <= to)) value = to;
        apply(value);
        if (state.selected) { state.selected = false; resolve({ confirmed: true, value }); }
        else if (value === to) { resolve({ confirmed: false, value }); }
        else { setTimeout(poll, 16); }
      };
      poll();
    });
  }

  // Move a bead until the patient confirms the percept change or it reaches its bound.
  async function moveBeadUntilSelect(bead, velocity, minZ, maxZ) {
    state.motion = { bead, velocity, minZ, maxZ };
    state.selected = false;
    return new Promise(resolve => {
      const poll = () => {
        const z = beadZ(bead);
        if (state.selected) { state.selected = false; state.motion = null; resolve({ confirmed: true, z }); }
        else if ((velocity < 0 && z <= minZ) || (velocity > 0 && z >= maxZ)) { state.motion = null; resolve({ confirmed: false, z }); }
        else { setTimeout(poll, 16); }
      };
      poll();
    });
  }

  // ---------- the daily routine (mirrors the clinic app's A-press vergence activities) --------

  async function convergenceNearPoint() {
    const result = { activityId: 'cnp', summary: '', measurements: [] };
    showOnlyBead(0);
    const breaks = [];
    const recoveries = [];
    for (let cycle = 1; cycle <= 3; cycle++) {
      setBeadZ(0, 0.20);
      await sleep(1500);
      if (cycle === 1) {
        await say('cnp_intro');
      }
      const inward = await moveBeadUntilSelect(0, -0.015, 0.04, 0.20);
      if (inward.confirmed) {
        breaks.push(inward.z);
        result.measurements.push(`cycle ${cycle}: break at ${(inward.z * 100).toFixed(1)}cm`);
      } else {
        result.measurements.push(`cycle ${cycle}: reached 4cm without reported doubling`);
      }
      await say('press_when_one');
      const outward = await moveBeadUntilSelect(0, 0.015, 0.04, 0.25);
      if (outward.confirmed) {
        recoveries.push(outward.z);
        result.measurements.push(`cycle ${cycle}: recovery at ${(outward.z * 100).toFixed(1)}cm`);
      } else {
        result.measurements.push(`cycle ${cycle}: no reported recovery by 25cm`);
      }
    }
    const avg = list => list.reduce((a, b) => a + b, 0) / list.length;
    result.summary = breaks.length > 0
      ? `convergence near point: break ${(avg(breaks) * 100).toFixed(1)}cm, recovery ${recoveries.length ? (avg(recoveries) * 100).toFixed(1) + 'cm' : 'n/a'} (of ${breaks.length} cycles)`
      : 'convergence near point: no break reported down to 4cm';
    record.results.push(result);
    logEvent(`cnp: ${result.summary}`);
  }

  async function divergenceJumps() {
    const result = { activityId: 'divergence_jumps', summary: '', measurements: [] };
    showOnlyBead(0);
    await say('jumps_intro');
    const nearZ = 0.25;
    const farZ = Math.min(1.2, stringLength - 0.1);
    const endAt = performance.now() + 60000;
    let jumps = 0, refused = 0;
    const times = [];
    let atNear = true;
    while (performance.now() < endAt) {
      atNear = !atNear;
      setBeadZ(0, atNear ? nearZ : farZ);
      jumps++;
      const response = await waitForSelect(15000);
      if (response.confirmed) { refused++; times.push(response.ms); }
      else { result.measurements.push(`jump ${jumps}: no refusion reported within 15s`); }
      await sleep(750);
    }
    const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    result.summary = `divergence jumps: ${refused}/${jumps} refused` + (times.length ? `, avg refusion ${(avgMs / 1000).toFixed(1)}s` : '');
    record.results.push(result);
    logEvent(`divergence_jumps: ${result.summary}`);
  }

  async function sustainedVergence() {
    const result = { activityId: 'sustained_vergence', summary: '', measurements: [] };
    showOnlyBead(0);
    setBeadZ(0, 0.14);
    await say('sustained_intro');
    const endAt = performance.now() + 60000;
    let breaks = 0;
    while (performance.now() < endAt) {
      const remaining = endAt - performance.now();
      const response = await waitForSelect(remaining);
      if (response.confirmed) {
        breaks++;
        result.measurements.push(`fusion break reported at ${(60 - remaining / 1000 + response.ms / 1000).toFixed(1)}s`);
      }
    }
    result.summary = `sustained vergence at 14cm for 60s: ${breaks} reported break(s)`;
    record.results.push(result);
    logEvent(`sustained_vergence: ${result.summary}`);
  }

  async function divergenceRange() {
    const result = { activityId: 'divergence_range', summary: '', measurements: [] };
    showOnlyBead(0);
    const farZ = Math.min(1.40, stringLength - 0.05);
    const breaks = [];
    const recoveries = [];
    for (let cycle = 1; cycle <= 3; cycle++) {
      setBeadZ(0, 0.30);
      await sleep(1500);
      if (cycle === 1) {
        await say('divergence_range_intro');
      }
      const outward = await moveBeadUntilSelect(0, 0.015, 0.30, farZ);
      if (!outward.confirmed) {
        // Fusion held all the way out - the finding native calls "no break to 140cm";
        // nothing doubled, so there is no recovery leg this cycle.
        result.measurements.push(`cycle ${cycle}: no break out to ${(farZ * 100).toFixed(0)}cm`);
        continue;
      }
      breaks.push(outward.z);
      result.measurements.push(`cycle ${cycle}: break at ${(outward.z * 100).toFixed(0)}cm`);
      await say('press_when_one');
      const inward = await moveBeadUntilSelect(0, -0.015, 0.20, farZ);
      if (inward.confirmed) {
        recoveries.push(inward.z);
        result.measurements.push(`cycle ${cycle}: recovery at ${(inward.z * 100).toFixed(0)}cm`);
      } else {
        result.measurements.push(`cycle ${cycle}: no reported recovery by 20cm`);
      }
    }
    const avg = list => list.reduce((a, b) => a + b, 0) / list.length;
    result.summary = breaks.length > 0
      ? `divergence range: break ${(avg(breaks) * 100).toFixed(0)}cm, recovery ${recoveries.length ? (avg(recoveries) * 100).toFixed(0) + 'cm' : 'n/a'} (of ${breaks.length} cycles)`
      : `divergence range: no break out to ${(farZ * 100).toFixed(0)}cm`;
    record.results.push(result);
    logEvent(`divergence_range: ${result.summary}`);
  }

  async function prismStressTest() {
    const result = { activityId: 'prism_stress', summary: '', measurements: [] };
    showOnlyBead(1);
    await say('prism_stress_intro');
    const setH = value => { activityPrism.horizontal = value; };
    const parts = [];
    for (const dir of [{ name: 'base-out', sign: 1 }, { name: 'base-in', sign: -1 }]) {
      if (dir.sign < 0) await say('other_direction');
      const brk = await rampUntilSelect(0, dir.sign * 15, 0.5, setH); // 0.5 diopters/s, 15 cap
      if (brk.confirmed) {
        result.measurements.push(`${dir.name}: break at ${Math.abs(brk.value).toFixed(1)} diopters`);
        const rec = await rampUntilSelect(brk.value, 0, 0.5, setH);
        result.measurements.push(rec.confirmed
          ? `${dir.name}: recovery at ${Math.abs(rec.value).toFixed(1)} diopters`
          : `${dir.name}: no reported recovery down to 0 diopters`);
        parts.push(`${dir.name} break ${Math.abs(brk.value).toFixed(1)}`);
      } else {
        result.measurements.push(`${dir.name}: no break up to 15 diopters`);
        parts.push(`${dir.name} no break to 15`);
      }
      setH(0);
      await sleep(2000);
    }
    result.summary = `prism stress: ${parts.join(', ')} (diopters)`;
    record.results.push(result);
    logEvent(`prism_stress: ${result.summary}`);
  }

  async function verticalFusionChallenge() {
    const result = { activityId: 'vertical_fusion', summary: '', measurements: [] };
    showOnlyBead(1);
    await say('vertical_fusion_intro');
    await sleep(1500);
    const times = [];
    for (let rep = 1; rep <= 3; rep++) {
      activityPrism.vertical = 2.5 * (rep % 2 === 1 ? 1 : -1); // sudden opposite-base flip, alternating
      const response = await waitForSelect(30000);
      activityPrism.vertical = 0;
      if (response.confirmed) {
        times.push(response.ms);
        result.measurements.push(`rep ${rep}: refused in ${(response.ms / 1000).toFixed(1)}s`);
      } else {
        result.measurements.push(`rep ${rep}: no refusion reported within 30s`);
      }
      await sleep(2000);
    }
    result.summary = times.length
      ? `vertical fusion: ${times.length}/3 refused, avg ${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1)}s`
      : 'vertical fusion: no refusion reported in 3 reps';
    record.results.push(result);
    logEvent(`vertical_fusion: ${result.summary}`);
  }

  async function bothEyesCheck() {
    const result = { activityId: 'both_eyes', summary: '', measurements: [] };
    showOnlyBead(-1);
    // One bead per eye at the same spot on the string: three.js renders layer 1 to the left
    // eye only and layer 2 to the right eye only. Suppression makes one of them vanish.
    const eyePair = new THREE.Group();
    for (const def of [{ color: 0xd93025, layer: 1 }, { color: 0x2fa84f, layer: 2 }]) {
      const bead = new THREE.Mesh(
        beadGeometry,
        new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.35, side: THREE.DoubleSide }));
      bead.layers.set(def.layer);
      eyePair.add(bead);
    }
    eyePair.position.z = -0.45;
    eyePair.visible = false;
    stringGroup.add(eyePair);
    await say('both_eyes_intro');
    let seen = 0;
    for (let trial = 1; trial <= 3; trial++) {
      eyePair.visible = true;
      const response = await waitForSelect(15000);
      eyePair.visible = false;
      if (response.confirmed) {
        seen++;
        result.measurements.push(`trial ${trial}: both seen in ${(response.ms / 1000).toFixed(1)}s`);
      } else {
        result.measurements.push(`trial ${trial}: not reported within 15s`);
      }
      await sleep(1500);
    }
    stringGroup.remove(eyePair);
    result.summary = `both-eyes check: ${seen}/3 trials` +
      (seen < 3 ? ' (repeated misses may suggest suppression)' : '');
    record.results.push(result);
    logEvent(`both_eyes: ${result.summary}`);
  }

  async function stereoAcuity() {
    const result = { activityId: 'stereo_acuity', summary: '', measurements: [] };
    showOnlyBead(-1);
    // Runtime random-dot stereograms: identical dot fields per eye except a central square
    // drawn with crossed disparity (left-eye copy shifted right, right-eye left), so the square
    // floats in front for anyone with stereopsis and is invisible without it. Same honesty
    // caveat as the native app: sub-pixel shifts make the 100-arcsec step coarse, not clinical.
    const planeSize = 0.35, texSize = 1024, viewDistance = 0.8;
    const metersPerPixel = planeSize / texSize;
    function dotCanvas(dots, shiftPx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = texSize;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(0, 0, texSize, texSize);
      ctx.fillStyle = '#cccccc';
      for (const dot of dots) {
        const inSquare = dot.x > texSize * 0.3 && dot.x < texSize * 0.7 &&
                         dot.y > texSize * 0.3 && dot.y < texSize * 0.7;
        ctx.beginPath();
        ctx.arc(dot.x + (inSquare ? shiftPx : 0), dot.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      return canvas;
    }
    await say('stereo_intro');
    let finest = null;
    for (const arcsec of [400, 200, 100]) {
      const dots = Array.from({ length: 1600 }, () => ({ x: Math.random() * texSize, y: Math.random() * texSize }));
      const shiftPx = (viewDistance * arcsec * 4.848e-6) / metersPerPixel; // arcsec -> rad -> m on the plane -> px
      const planes = [{ layer: 1, s: +shiftPx / 2 }, { layer: 2, s: -shiftPx / 2 }].map(({ layer, s }) => {
        const texture = new THREE.CanvasTexture(dotCanvas(dots, s));
        texture.colorSpace = THREE.SRGBColorSpace;
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(planeSize, planeSize),
          new THREE.MeshBasicMaterial({ map: texture }));
        plane.position.z = -viewDistance;
        plane.layers.set(layer);
        camera.add(plane);
        return plane;
      });
      const response = await waitForSelect(15000);
      planes.forEach(p => {
        camera.remove(p);
        p.material.map.dispose();
        p.material.dispose();
        p.geometry.dispose();
      });
      if (response.confirmed) {
        finest = arcsec;
        result.measurements.push(`${arcsec} arcsec: square seen in ${(response.ms / 1000).toFixed(1)}s`);
      } else {
        result.measurements.push(`${arcsec} arcsec: not reported within 15s`);
        break; // the ladder only descends while the square is being seen
      }
      await sleep(1200);
    }
    result.summary = finest
      ? `stereo acuity: finest disparity seen ${finest} arcsec`
      : 'stereo acuity: square not reported at 400 arcsec';
    record.results.push(result);
    logEvent(`stereo_acuity: ${result.summary}`);
  }

  async function contrastSensitivity() {
    const result = { activityId: 'contrast_sensitivity', summary: '', measurements: [] };
    showOnlyBead(-1);
    // Unlit gray-on-gray (MeshBasicMaterial ignores lights) for controlled luminance; the bead
    // starts identical to the panel and its luminance ramps until the patient reports it.
    const backLuminance = 0.25;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(backLuminance, backLuminance, backLuminance) }));
    panel.position.z = -1.0;
    camera.add(panel);
    const target = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(backLuminance, backLuminance, backLuminance) }));
    target.visible = false;
    camera.add(target);
    await say('contrast_intro');
    const readings = [];
    for (let trial = 1; trial <= 3; trial++) {
      await sleep(1500 + Math.random() * 2000); // unpredictable onset
      target.position.set((Math.random() - 0.5) * 0.24, (Math.random() - 0.5) * 0.14, -0.6);
      target.material.color.setRGB(backLuminance, backLuminance, backLuminance);
      target.visible = true;
      const response = await rampUntilSelect(0, 0.6, 0.02, contrast => { // Weber contrast, 2%/s
        const lum = backLuminance * (1 + contrast);
        target.material.color.setRGB(lum, lum, lum);
      });
      target.visible = false;
      if (response.confirmed) {
        readings.push(response.value);
        result.measurements.push(`trial ${trial}: detected at ${(response.value * 100).toFixed(0)}% contrast`);
      } else {
        result.measurements.push(`trial ${trial}: not detected up to 60% contrast`);
      }
    }
    camera.remove(panel);
    camera.remove(target);
    panel.material.dispose(); panel.geometry.dispose();
    target.material.dispose(); target.geometry.dispose();
    result.summary = readings.length
      ? `contrast sensitivity: detection at ${(Math.min(...readings) * 100).toFixed(0)}% Weber contrast (best of ${readings.length}/3)`
      : 'contrast sensitivity: no detection up to 60% contrast';
    record.results.push(result);
    logEvent(`contrast_sensitivity: ${result.summary}`);
  }

  // --- the playlist: ticked activities auto-run in registry order, same as the native app.
  const activityRegistry = [
    { id: 'cnp', checkbox: 'actCnp', run: convergenceNearPoint },
    { id: 'divergence_range', checkbox: 'actDivergenceRange', run: divergenceRange },
    { id: 'divergence_jumps', checkbox: 'actDivergenceJumps', run: divergenceJumps },
    { id: 'prism_stress', checkbox: 'actPrismStress', run: prismStressTest },
    { id: 'vertical_fusion', checkbox: 'actVerticalFusion', run: verticalFusionChallenge },
    { id: 'sustained_vergence', checkbox: 'actSustainedVergence', run: sustainedVergence },
    { id: 'both_eyes', checkbox: 'actBothEyes', run: bothEyesCheck },
    { id: 'stereo_acuity', checkbox: 'actStereoAcuity', run: stereoAcuity },
    { id: 'contrast_sensitivity', checkbox: 'actContrastSensitivity', run: contrastSensitivity },
  ];
  const playlist = activityRegistry.filter(a => selectedActivities.includes(a.checkbox));

  // --- run the routine, save, end.
  try {
    // Entering the immersive session can suspend the audio context and briefly steal audio
    // routing; give it a moment to settle (and get the context back) before the first prompt.
    audioContext.resume().catch(() => {});
    await sleep(1500);
    logEvent(`audio context at routine start: ${audioContext.state}, input mode: ${inputMode}`);
    logEvent(`playlist: ${playlist.map(a => a.id).join(', ')}`);
    await say('welcome');
    for (let i = 0; i < playlist.length; i++) {
      if (i > 0) await say(i === playlist.length - 1 ? 'last_exercise' : 'next_exercise');
      await playlist[i].run();
      activityPrism.horizontal = 0; // an interrupted ramp must never leak into the next activity
      activityPrism.vertical = 0;
    }
    showOnlyBead(null);
    await say('all_done');
  } catch (e) {
    logEvent(`session ended early: ${e.message}`);
  } finally {
    record.durationSeconds = (performance.now() - startedAt) / 1000;
    saveRecord(record);
    session.removeEventListener('select', onSelect);
    try { await session.end(); } catch { /* already ended */ }
    renderer.setAnimationLoop(null);
    renderer.dispose();
  }
}
