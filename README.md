# Vision Home

WebXR Brock-string home-training companion to the native Quest Pro **Vision** app — daily vergence
exercises a patient runs in their headset's browser between office visits. No installation: open
the page in any WebXR-capable browser (Meta Quest browser, Safari on Apple Vision Pro with
visionOS 2+).

**Live:** https://haddley.github.io/vision-home/

## How it works

- The patient's only control is the WebXR **select** action — controller trigger, hand pinch
  (Quest), or look-and-pinch (Vision Pro) — mirroring the native app's confirm-only A-button
  design: the voice describes a percept ("the moment you see it become two"), the patient selects
  when they see it.
- Daily routine: Convergence Near Point (3 cycles, break/recovery distances) → Divergence Jumps
  (60 s, refusion times) → Sustained Vergence (60 s hold, reported breaks). Voice guidance uses
  the browser's built-in speech synthesis. A timeout is a finding, never an error.
- The virtual Brock string matches the native app's clinical geometry: head-anchored (held to the
  nose), inclined 7.5° downward, red/yellow/green beads, adjustable string length.
- **Session records stay on the device** (browser localStorage), in the same JSON shape as the
  native app's patient files. The landing page lists past sessions and offers a JSON download to
  bring to the next appointment. Nothing is ever uploaded.

## Development

Static site, no build step: `index.html` + `main.js` + a vendored `lib/three.module.js`.
Serve locally with `python3 -m http.server` — for on-headset testing over USB, `adb reverse
tcp:8000 tcp:8000` makes it reachable as `http://localhost:8000` in the Quest browser (localhost
counts as a secure context, which WebXR requires).

The clinical design (protocols, record schema, interaction rules) is documented in the native
app's repository (`ACTIVITIES.md` there); this app deliberately implements only the subset that
needs no eye tracking, since WebXR exposes none.
