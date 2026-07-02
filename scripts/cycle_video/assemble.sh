#!/usr/bin/env bash
# Assemble the Veradic cycle video: for each scene, a branded title card
# (still -> short clip with fades) followed by the recorded scene clip,
# all normalized to 1920x1080 / 30fps / H.264 and concatenated with
# clean cross-dissolves. Also exports review still frames.
#
#   scripts/cycle_video/assemble.sh
set -euo pipefail

CARDS="${CARDS_OUT:-/tmp/cycle-cards}"
SCENES="${SCENES_OUT:-/tmp/cycle-scenes}"
WORK="${WORK_DIR:-/tmp/cycle-build}"
OUT_MP4="${OUT_MP4:-/tmp/veradic-cycle.mp4}"
FRAMES_DIR="${FRAMES_DIR:-/tmp/cycle-frames}"
FPS=30
CARD_SEC=2.6
XF=0.5   # cross-dissolve duration

rm -rf "$WORK" "$FRAMES_DIR"; mkdir -p "$WORK" "$FRAMES_DIR"

# segment -> title-card id, or scene clip with "start:dur" trim. A dur of
# "auto" trims to the clip's real length minus a small tail (so the
# fade-out always lands on the clean end frame). Order = the seven-beat
# story; each scene preceded by its card, the showcase (generate) and a
# few beats split into steady-framed sub-clips that cross-dissolve.
SEGMENTS=(
  "card:00-open"
  "card:01-section"   "scene:1-section:0:auto"
  "card:02-materials" "scene:2-materials:0:auto"
  "card:03-generate"  "scene:3-generate:0:auto" "scene:3-solution:0:auto" "scene:3-figure:0:auto"
  "card:04-submit"    "scene:4-submit:0:auto" "scene:4-chat:0:auto" "scene:4-verdict:0:auto"
  "card:05-grade"     "scene:5-grade:0:auto" "scene:5-insights:0:auto"
  "card:06-reteach"   "scene:6-reteach:0:auto"
  "card:07-practice"  "scene:7-practice:0:auto" "scene:7-learn:0:auto"
  "card:08-close"
)

norm_card () {  # $1 card-id  $2 out
  ffmpeg -y -loop 1 -t "$CARD_SEC" -i "$CARDS/card-$1.png" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf7f5f0,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=$(echo "$CARD_SEC-0.4"|bc):d=0.4" \
    -an -c:v libx264 -preset medium -crf 18 "$2" -loglevel error
}

norm_scene () {  # $1 webm  $2 start  $3 dur(or "auto")  $4 out
  local dur="$3"
  if [ "$dur" = "auto" ]; then
    local raw; raw=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
    dur=$(echo "$raw - $2 - 0.18" | bc)
  fi
  ffmpeg -y -ss "$2" -t "$dur" -i "$1" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf7f5f0,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=$(echo "$dur-0.35"|bc):d=0.35" \
    -an -c:v libx264 -preset medium -crf 19 "$4" -loglevel error
}

parts=()
i=0
for seg in "${SEGMENTS[@]}"; do
  IFS=':' read -r kind a b c <<< "$seg"
  out="$WORK/part_$(printf '%02d' $i).mp4"
  if [ "$kind" = "card" ]; then
    echo "card $a"; norm_card "$a" "$out"
  else
    echo "scene $a (trim $b:$c)"; norm_scene "$SCENES/scene-$a.webm" "$b" "$c" "$out"
  fi
  parts+=("$out"); i=$((i+1))
done

# Concatenate with cross-dissolves via successive xfade.
acc="${parts[0]}"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$acc")
for ((k=1; k<${#parts[@]}; k++)); do
  nxt="${parts[$k]}"
  off=$(echo "$dur - $XF" | bc)
  tmp="$WORK/acc_$k.mp4"
  ffmpeg -y -i "$acc" -i "$nxt" \
    -filter_complex "[0:v][1:v]xfade=transition=fade:duration=$XF:offset=$off,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -preset medium -crf 18 "$tmp" -loglevel error
  ndur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$nxt")
  dur=$(echo "$dur + $ndur - $XF" | bc)
  acc="$tmp"
done

cp "$acc" "$OUT_MP4"
echo "wrote $OUT_MP4  (~${dur}s)"

# Review still frames: every card + key content frames per clip. Each
# pick uses a timestamp near the end of a caption hold (relative to the
# raw clip) so the frame lands on settled content.
pick () { ffmpeg -y -ss "$2" -i "$1" -frames:v 1 "$3" -loglevel error 2>/dev/null || true; }
mid () { local d; d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"); echo "$d * $2 / 1" | bc -l; }
n=1
for c in 00-open 01-section 02-materials 03-generate 04-submit 05-grade 06-reteach 07-practice 08-close; do
  cp "$CARDS/card-$c.png" "$FRAMES_DIR/$(printf '%02d' $n)-card-$c.png"; n=$((n+1))
done
pk () {  # $1 clip  $2 fraction  $3 label
  local w="$SCENES/scene-$1.webm"; [ -f "$w" ] || return 0
  pick "$w" "$(mid "$w" "$2")" "$FRAMES_DIR/$(printf '%02d' $n)-$3.png"; n=$((n+1)); }
pk 1-section   0.55 section
pk 2-materials 0.70 materials
pk 3-generate  0.94 soccer-problems
pk 3-solution  0.75 worked-solution
pk 3-figure    0.80 figure-reshape
pk 4-submit    0.70 photo
pk 4-chat      0.50 understanding-chat
pk 4-chat      0.92 understanding-terminal
pk 4-verdict   0.75 integrity-flag
pk 5-grade     0.55 receipt
pk 5-grade     0.88 integrity-verdict
pk 5-insights  0.45 struggle-list
pk 5-insights  0.85 student-roster
pk 6-reteach   0.80 reteach
pk 7-practice  0.70 practice
pk 7-learn     0.70 learn
echo "frames -> $FRAMES_DIR"
