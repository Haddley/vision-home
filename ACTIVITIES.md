# Vision Home — Activities Reference

The clinical/feature reference for Vision Home, the WebXR home-training companion to the native
Quest Pro "Vision" app (`~/code/Hello World`). That repo's `ACTIVITIES.md` is the master
document for the shared protocols; this file documents what this app carries and how it
differs. Rule of thumb: **this app is the confirm-only, no-eye-tracking subset** — WebXR
exposes no gaze data on any platform.

## Session flow

1. **Landing page** (`index.html`) — the patient (not a professional; this runs at home)
   confirms their name, string length, prism prescription, and ticks today's exercises. All of
   it persists in `localStorage` and is prefilled next visit.
2. **Start** — one button starts the immersive session. The welcome prompt reminds the patient
   of their single control.
3. **Playlist** — the ticked activities auto-run in registry order, each introduced by a
   pre-generated voice clip ("squeeze the trigger" or "pinch" chosen by the session's live
   input sources). At least one activity must be ticked; there is no free-run mode (free-run
   coaching is gaze-driven and native-only).
4. **End** — the session record is appended to `localStorage.visionHomeRecords`, summarized in
   the past-sessions table, and downloadable as JSON to bring to the next appointment.

Throughout, the native app's rules hold: **a timeout is a finding, never an error** ("the
patient could not comply", recorded and moved past), and **the patient only ever confirms** —
every prompt is "the moment you see X", via the WebXR `select` action only.

## The catalog (9 of the native app's 21)

Everything portable is ported. An activity is portable when its primary measurement comes from
patient confirmation, not gaze. Order below = run order.

| Activity | `activityId` | Patient does | Measures |
|---|---|---|---|
| Convergence near point | `cnp` | Red bead glides toward the nose; confirm at doubling, again at re-fusion on the way back | Break & recovery distances (cm), 3 cycles, averages |
| Divergence range | `divergence_range` | Same, outward from 30 cm: confirm when it doubles going away, when it re-fuses coming back | Far break & recovery (cm), 3 cycles, to 140 cm or string end |
| Divergence jumps | `divergence_jumps` | Bead jumps near↔far; confirm each re-fusion | Refusion time per jump, refused/attempted, 60 s |
| Prism stress test | `prism_stress` | Fixate the yellow bead while simulated prism ramps (0.5 Δ/s, ±15 Δ cap); confirm at doubling and at recovery | Base-out & base-in break/recovery (Δ) |
| Vertical fusion challenge | `vertical_fusion` | Fixate yellow; a sudden 2.5 Δ opposite-base vertical flip; confirm when single again | Refusion time × 3 reps (flip direction alternates) |
| Sustained vergence | `sustained_vergence` | Hold the near bead single for 60 s; confirm each break | Break count + timestamps |
| Both-eyes check | `both_eyes` | Red bead shown to the left eye only, green to the right (render layers); confirm when both are visible at once | Seen/not per 3 trials, time-to-confirm; repeated misses suggest suppression |
| Stereo acuity | `stereo_acuity` | Runtime random-dot stereograms; confirm on seeing the floating square | Smallest disparity perceived (400/200/100 arcsec descending ladder) |
| Contrast sensitivity | `contrast_sensitivity` | Unlit gray panel; confirm the moment a faint bead appears (luminance ramps at 2% Weber/s) | Weber contrast at detection, 3 trials, 60% cap |

Differences from the native versions, all consequences of having no eye tracking:

- **No fusion gating or personalization.** Native skips the prism stress test / vertical fusion
  challenge when the yellow bead wasn't fused in today's eye check, and personalizes start
  distances from `fusionHistory`. Here fusion is never assessed, so activities always run,
  exactly as prescribed, at the catalog's default parameters.
- **No gaze side-notes** in the measurements.
- **Stereo acuity honesty caveat** (same as native): the 100-arcsec step lands at a ~1px
  texture shift — coarse screening, not a clinical stereo test.

## Deliberately not ported

- **All `*` (gaze-primary) activities** — smooth pursuit vergence, vergence tracking, saccadic
  accuracy, anti-saccade, pursuit gain, pursuit with prism, head-turn fixation (VOR), fixation
  stability, monocular tracking, visual search, sequence recall. No gaze data in WebXR.
- **Touch the Target** — needs tracked controller position. This app's one interaction rule
  (select only) is what makes it work unmodified on Apple Vision Pro, which exposes no tracked
  controllers; reaching also can't be assessed with a transient pinch.
- **Accommodation family, Find the Difference, Cognitive-Visual Integration** — not implemented
  natively either (see the native `ACTIVITIES.md` for the reasoning).

## Continuous feedback

**Head-tilt biofeedback** — ported from the native `HeadTiltMonitor` with the same spec: a
sustained (2.5 s) head roll past 10° toward either shoulder triggers "Your head is tilting
toward your left/right shoulder. Gently bring it level.", with a 15 s cooldown per direction
(a habitual left tilt doesn't silence a right-tilt warning); it never talks over a prompt.
Every alert is logged to the session record's events with angle and direction — compensatory
tilt frequency is clinical signal that the prism correction is wrong or missing (prism
tapering). Toggle on the landing page, default ON.

(The native app's other continuous system, free-run gaze coaching, is gaze-driven and cannot
exist here.)

## The activity checklist (landing page)

Mirrors the native "activities checklist" step: one checkbox per activity, run in registry
order, selection persisted in `visionHomeSettings` and prefilled next session. Defaults (first
ever visit): the original three-exercise routine — CNP, divergence jumps, sustained vergence.
Zero ticked = the start button refuses (native's zero-ticked free-run has no meaning here).

## Records

Same shapes as the native app (`SessionRecord` / `ActivityResult`; see the native
`ACTIVITIES.md`): per session `startedUtc`, `durationSeconds`, `prescription`, `results`
(`{ activityId, summary, measurements[] }` per activity) and a timestamped `events` log — every
confirmation context, timeout, playlist, audio/input-mode diagnostics. `localStorage` only; the
JSON download is the sole way data leaves the browser.

## Adding an activity

See `CLAUDE.md` ("Adding an activity"). Short version: write the async function in `main.js`
using the helpers (`say`, `waitForSelect`, `moveBeadUntilSelect`, `rampUntilSelect`), add its
intro text to `audio/generate.sh` (both `_trigger` and `_pinch` variants) and run it, register
the clip ids in `speechClips`, add a row to `activityRegistry`, a checkbox in `index.html`, and
the checkbox id to `settingsFields`. Then update the catalog table here.
