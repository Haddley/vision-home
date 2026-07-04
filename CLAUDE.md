# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Vision Home** — a WebXR Brock-string home-training app: the patient companion to the native
Quest Pro "Vision" app (`~/code/Hello World`, separate repo). A patient opens the page in their
headset browser at home (Meta Quest browser, or Safari on Apple Vision Pro with visionOS 2+) and
runs a voice-guided daily vergence routine. Live at **https://haddley.github.io/vision-home/**.

This app deliberately contains only the *confirm-only, no-eye-tracking* subset of the clinical
design — WebXR exposes no gaze data on any platform. The native app is the full clinical product;
its `ACTIVITIES.md` documents the shared protocols, record schema, and interaction rules. Keep
the two apps' JSON record shapes compatible — the professional reads both.

## Architecture

Static site, **no build step, no framework, no dependencies to install**:

- `index.html` — landing page: patient name, string length, prism prescription fields, past-
  sessions table, JSON download. All settings persist in `localStorage` (`visionHomeSettings`).
- `main.js` — everything else: records, audio, the WebXR session, the Brock string, the activity
  routine. One file on purpose; split only if it genuinely outgrows this.
- `audio/*.m4a` — pre-generated speech clips (see the TTS trap below).
- `lib/three.module.js` — vendored three.js r160. No CDN at runtime; update by re-vendoring.

## Hard-won rules (violating these re-breaks fixed bugs)

- **Never use `speechSynthesis`.** Meta's Quest Browser doesn't implement it — utterances neither
  speak nor fire `onend`, which silently stalled an entire on-device session at its first prompt.
  Voice = pre-generated clips. Every clip's text lives in `audio/generate.sh` — the single
  source of truth and the build pipeline (`./audio/generate.sh [ids…]`, macOS `say` +
  `afconvert`). To add or change a prompt: edit the text there, run it, and register the id in
  `speechClips` in `main.js`; never generate a clip ad hoc without recording its text in that
  script. A prompt that names the confirm action needs `<id>_trigger` and `<id>_pinch`
  variants ("squeeze the trigger" / "pinch") — `speak()` picks by the session's live input
  sources (controller gamepad vs hands / Vision Pro), never by user agent; call sites use the
  base id. Clips must play through the shared `AudioContext` (Web Audio), never
  `HTMLAudioElement` — element `.play()` is gesture-gated per call and silently skipped clips
  mid-session in the immersive session (e.g. `jumps_intro` never played); the context is
  unlocked once inside the Start click. Playback must stay stall-proof (the `speak()` promise
  resolves on a duration cap even if the clip never plays), and every playback failure must be
  logged into the session record's events — silence is otherwise undebuggable on-device.
- **The patient's only control is the WebXR `select` event** (trigger / hand pinch / Vision Pro
  look-and-pinch). Never add other input; that one rule is what makes the app work unmodified on
  Vision Pro. Selects during speech are deliberately ignored (don't race the prompt).
- **Prism simulation** is a per-eye translation premultiplied onto each eye camera's projection
  matrix every frame (`applyPrism` in `main.js`): NDC shift = (diopters/100) × m00 (or m11),
  signs matching the native app's verified convention (right eye base-down/base-out = +y/−x).
  The matrices are refreshed by WebXR every frame, so the premultiply must happen every frame,
  after the XR view update (our animation-loop callback) and before `renderer.render`. A magenta
  indicator dot shows in-VR whenever prism is active — keep it; perception bugs are undebuggable
  without ground truth that the code path is live.
- **Timeouts are findings, never errors** — same clinical semantics as the native app: silence
  means "the patient could not comply", recorded and moved past.
- **Privacy invariant**: settings and session records live in `localStorage` only; the JSON
  download is the sole way data leaves the browser. Never add network calls carrying patient data.

## Workflow

- **Deploy = push**: GitHub Pages serves `main` of this repo; changes are live at the URL within
  ~a minute of `git push`.
- **Local on-headset testing**: `python3 -m http.server` here, then
  `adb reverse tcp:8000 tcp:8000`, open `http://localhost:8000` in the Quest browser (localhost
  is a secure context, so WebXR works). There is no remote console: debugging is by observable
  behavior + the session record, so prefer changes whose success is visible in-headset.
- `node --check main.js` for a quick syntax gate before pushing.
- Records: sessions append to `localStorage.visionHomeRecords`; shape mirrors the native app's
  `SessionRecord`/`ActivityResult` (see that repo's `ACTIVITIES.md`).

## Adding an activity (the common feature request)

1. Write an async function in `main.js` following the existing three (CNP, divergence jumps,
   sustained vergence): move/show beads via the helpers, `await say('clip_id')`, gather responses
   with `waitForSelect(timeoutMs)` / `moveBeadUntilSelect(...)`, push an
   `{ activityId, summary, measurements }` result and a `logEvent`.
2. Generate its intro clip into `audio/` and register the id in `speechClips`.
3. Add it to the routine sequence in `runSession`.
4. Only port activities that need no eye tracking — the native app's registry marks gaze-based
   ones with `usesEyeTracking: true`; those cannot work here.
