#!/bin/zsh
# Source of truth for every speech clip's text, and the pipeline that builds them.
# Run from the repo root:  ./audio/generate.sh          (rebuilds all clips)
#                          ./audio/generate.sh welcome_pinch ...   (just the named ids)
#
# Pipeline matches the native app: macOS `say` -> AAC m4a. After adding a clip here,
# register its id in `speechClips` in main.js. Prompts that name the confirm action need
# both a _trigger and a _pinch variant (speak() picks by the session's live input sources);
# neutral prompts get a single clip.

set -e
cd "$(dirname "$0")"

typeset -A CLIPS
CLIPS=(
  welcome_trigger        "Welcome. Hold your head comfortably still, and keep both eyes on the beads. Remember: squeeze the trigger the moment you see what I describe."
  welcome_pinch          "Welcome. Hold your head comfortably still, and keep both eyes on the beads. Remember: pinch your fingers together the moment you see what I describe."
  cnp_intro_trigger      "Convergence exercise. Watch the red bead as it slowly moves toward your nose. Squeeze the trigger the very moment you see it become two."
  cnp_intro_pinch        "Convergence exercise. Watch the red bead as it slowly moves toward your nose. Pinch the very moment you see it become two."
  press_when_one_trigger "Now squeeze the trigger the moment it becomes one single bead again."
  press_when_one_pinch   "Now pinch the moment it becomes one single bead again."
  jumps_intro_trigger    "Jump exercise. The bead will jump between near and far. After each jump, squeeze the trigger as soon as you see one single bead."
  jumps_intro_pinch      "Jump exercise. The bead will jump between near and far. After each jump, pinch as soon as you see one single bead."
  sustained_intro_trigger "Endurance exercise. Keep the red bead single for one minute. Squeeze the trigger any time it splits into two."
  sustained_intro_pinch  "Endurance exercise. Keep the red bead single for one minute. Pinch any time it splits into two."
  divergence_range_intro_trigger "Divergence exercise. Watch the red bead as it slowly moves away from you. Squeeze the trigger the very moment you see it become two."
  divergence_range_intro_pinch "Divergence exercise. Watch the red bead as it slowly moves away from you. Pinch the very moment you see it become two."
  prism_stress_intro_trigger "Prism exercise. Keep both eyes on the yellow bead. Your view will slowly change. Squeeze the trigger the moment the bead becomes two, and again the moment it becomes one."
  prism_stress_intro_pinch "Prism exercise. Keep both eyes on the yellow bead. Your view will slowly change. Pinch the moment the bead becomes two, and again the moment it becomes one."
  vertical_fusion_intro_trigger "Alignment exercise. Keep both eyes on the yellow bead. Your view will shift suddenly. Squeeze the trigger the moment the bead looks single again."
  vertical_fusion_intro_pinch "Alignment exercise. Keep both eyes on the yellow bead. Your view will shift suddenly. Pinch the moment the bead looks single again."
  both_eyes_intro_trigger "Two bead check. A red bead and a green bead will appear together. Squeeze the trigger the moment you can see both beads at the same time."
  both_eyes_intro_pinch  "Two bead check. A red bead and a green bead will appear together. Pinch the moment you can see both beads at the same time."
  stereo_intro_trigger   "Depth exercise. Watch the pattern of dots. Squeeze the trigger the moment you see a square floating in front of the pattern."
  stereo_intro_pinch     "Depth exercise. Watch the pattern of dots. Pinch the moment you see a square floating in front of the pattern."
  contrast_intro_trigger "Faint bead exercise. Look straight ahead at the grey panel. Squeeze the trigger the very moment a faint bead appears."
  contrast_intro_pinch   "Faint bead exercise. Look straight ahead at the grey panel. Pinch the very moment a faint bead appears."
  other_direction        "Now the other direction."
  next_exercise          "Well done. Next exercise."
  last_exercise          "Well done. Last exercise."
  all_done               "All done for today. Great work. Your session has been saved."
)

ids=("$@")
if [[ ${#ids} -eq 0 ]]; then ids=(${(k)CLIPS}); fi

for id in $ids; do
  text=${CLIPS[$id]}
  if [[ -z "$text" ]]; then echo "unknown clip id: $id" >&2; exit 1; fi
  tmp=$(mktemp -t "$id").aiff
  say -o "$tmp" "$text"
  afconvert -f m4af -d aac -b 64000 "$tmp" "$id.m4a"
  rm -f "$tmp"
  echo "generated $id.m4a"
done
