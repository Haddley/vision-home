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

// ---------- speech (browser TTS - fully offline on Quest browser) --------------------------

function speak(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
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
  if (!state.speaking) {
    state.selected = true;
  }
}

async function runSession() {
  const patientName = document.getElementById('patientName').value.trim() || 'patient';
  const stringLength = parseFloat(document.getElementById('stringLength').value);

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

  function showOnlyBead(index) {
    beads.forEach((bead, i) => { bead.visible = index === null || i === index; });
  }
  function setBeadZ(index, z) { beads[index].position.z = -z; }
  function beadZ(index) { return -beads[index].position.z; }

  // --- render loop: advances any scripted bead motion.
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const m = state.motion;
    if (m) {
      const z = THREE.MathUtils.clamp(beadZ(m.bead) + m.velocity * dt, m.minZ, m.maxZ);
      setBeadZ(m.bead, z);
    }
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

  async function say(text) {
    state.speaking = true;
    await speak(text);
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
        await say('Convergence exercise. Watch the red bead as it slowly moves toward your nose. Squeeze the trigger the very moment you see it become two.');
      }
      const inward = await moveBeadUntilSelect(0, -0.015, 0.04, 0.20);
      if (inward.confirmed) {
        breaks.push(inward.z);
        result.measurements.push(`cycle ${cycle}: break at ${(inward.z * 100).toFixed(1)}cm`);
      } else {
        result.measurements.push(`cycle ${cycle}: reached 4cm without reported doubling`);
      }
      await say('Now squeeze the trigger the moment it becomes one single bead again.');
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
    await say('Jump exercise. The bead will jump between near and far. After each jump, squeeze the trigger as soon as you see one single bead.');
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
    await say('Endurance exercise. Keep the red bead single for one minute. Squeeze the trigger any time it splits into two.');
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
    await say(`Welcome ${patientName}. Hold your head comfortably still, and keep both eyes on the beads. Remember: squeeze the trigger, or pinch, the moment you see what I describe.`);
    await convergenceNearPoint();
    await say('Well done. Next exercise.');
    await divergenceJumps();
    await say('Well done. Last exercise.');
    await sustainedVergence();
    showOnlyBead(null);
    await say('All done for today. Great work. Your session has been saved.');
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
