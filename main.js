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
const settingsFields = ['patientName', 'stringLength', 'prismEnabled', 'prismVertical', 'prismHorizontal'];

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

const speechClips = {}; // id -> Promise<AudioBuffer|null>; null = load/decode failed (kept in the error message)
const speechClipErrors = {};
for (const id of ['welcome', 'cnp_intro', 'press_when_one', 'next_exercise', 'jumps_intro',
                  'last_exercise', 'sustained_intro', 'all_done']) {
  speechClips[id] = fetch(`./audio/${id}.m4a`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(data => audioContext.decodeAudioData(data))
    .catch(e => { speechClipErrors[id] = e.message || String(e); return null; });
}

function speak(clipId, onIssue = () => {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    setTimeout(finish, 15000); // absolute backstop; no clip is anywhere near this long
    const clipPromise = speechClips[clipId];
    if (!clipPromise) { onIssue('unknown clip id'); finish(); return; }
    // Don't start a clip into a suspended context - it would sit frozen and unfreeze at some
    // arbitrary later moment. Wait (bounded) for the context to actually be running.
    const ensureRunning = audioContext.state === 'running'
      ? Promise.resolve()
      : (onIssue(`audio context was ${audioContext.state}, resuming`),
         Promise.race([audioContext.resume(), new Promise(r => setTimeout(r, 3000))]));
    Promise.all([clipPromise, ensureRunning]).then(([buffer]) => {
      if (done) return;
      if (!buffer) { onIssue(`clip failed to load: ${speechClipErrors[clipId]}`); finish(); return; }
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

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));

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
  const beads = beadDefs.map(def => {
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 24, 16),
      new THREE.MeshStandardMaterial({ color: def.color }));
    bead.position.z = -def.z;
    stringGroup.add(bead);
    return bead;
  });
  const cord = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -stringLength)]),
    new THREE.LineBasicMaterial({ color: 0xffffff }));
  stringGroup.add(cord);

  // Small magenta dot above the string while prism simulation is active - unmissable ground
  // truth that the shift code path is running, learned from debugging a session where a stalled
  // audio prompt made it impossible to tell whether prism was even on.
  if (prism.enabled) {
    const indicator = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff40ff }));
    indicator.position.set(0, 0.12, -0.8);
    camera.add(indicator);
  }

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
  const shiftMatrix = new THREE.Matrix4();
  function applyPrism() {
    if (!prism.enabled) return;
    const xrCamera = renderer.xr.getCamera();
    if (!xrCamera.isArrayCamera || xrCamera.cameras.length !== 2) return;
    xrCamera.cameras.forEach((eyeCamera, i) => {
      const isRight = i === 1;
      const m00 = eyeCamera.projectionMatrix.elements[0];
      const m11 = eyeCamera.projectionMatrix.elements[5];
      const x = (prism.horizontalDiopters / 100) * m00 * (isRight ? -1 : 1);
      const y = (prism.verticalDiopters / 100) * m11 * (isRight ? 1 : -1);
      shiftMatrix.makeTranslation(x, y, 0);
      eyeCamera.projectionMatrix.premultiply(shiftMatrix);
      eyeCamera.projectionMatrixInverse.copy(eyeCamera.projectionMatrix).invert();
    });
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

  // --- run the routine, save, end.
  try {
    // Entering the immersive session can suspend the audio context and briefly steal audio
    // routing; give it a moment to settle (and get the context back) before the first prompt.
    audioContext.resume().catch(() => {});
    await sleep(1500);
    logEvent(`audio context at routine start: ${audioContext.state}`);
    await say('welcome');
    await convergenceNearPoint();
    await say('next_exercise');
    await divergenceJumps();
    await say('last_exercise');
    await sustainedVergence();
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
