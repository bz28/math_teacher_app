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

# scene id -> title-card id + trim (start:dur seconds of the raw clip).
# Order = the seven-beat story, each scene preceded by its card; the
# open and close cards bookend the film.
SEGMENTS=(
  "card:00-open"
  "card:01-section"   "scene:1-section:0:14"
  "card:02-materials" "scene:2-materials:0:9.2"
  "card:03-generate"  "scene:3-generate:0:32.5"
  "card:04-submit"    "scene:4-submit:0:19.2"
  "card:05-grade"     "scene:5-grade:0:18.2"
  "card:06-reteach"   "scene:6-reteach:0:15.2"
  "card:07-practice"  "scene:7-practice:0:23"
  "card:08-close"
)

norm_card () {  # $1 card-id  $2 out
  ffmpeg -y -loop 1 -t "$CARD_SEC" -i "$CARDS/card-$1.png" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf7f5f0,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=$(echo "$CARD_SEC-0.4"|bc):d=0.4" \
    -an -c:v libx264 -preset medium -crf 18 "$2" -loglevel error
}

norm_scene () {  # $1 webm  $2 start  $3 dur  $4 out
  ffmpeg -y -ss "$2" -t "$3" -i "$1" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf7f5f0,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=$(echo "$3-0.35"|bc):d=0.35" \
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

# Review still frames: every card + a key frame per scene.
pick () { ffmpeg -y -ss "$2" -i "$1" -frames:v 1 "$3" -loglevel error; }
n=1
for c in 00-open 01-section 02-materials 03-generate 04-submit 05-grade 06-reteach 07-practice 08-close; do
  cp "$CARDS/card-$c.png" "$FRAMES_DIR/$(printf '%02d' $n)-card-$c.png"; n=$((n+1))
done
pick "$SCENES/scene-1-section.webm" 11 "$FRAMES_DIR/$(printf '%02d' $n)-section.png"; n=$((n+1))
pick "$SCENES/scene-2-materials.webm" 9 "$FRAMES_DIR/$(printf '%02d' $n)-materials.png"; n=$((n+1))
pick "$SCENES/scene-3-generate.webm" 30 "$FRAMES_DIR/$(printf '%02d' $n)-figure.png"; n=$((n+1))
pick "$SCENES/scene-4-submit.webm" 8  "$FRAMES_DIR/$(printf '%02d' $n)-photo.png"; n=$((n+1))
pick "$SCENES/scene-4-submit.webm" 16 "$FRAMES_DIR/$(printf '%02d' $n)-understanding-chat.png"; n=$((n+1))
pick "$SCENES/scene-5-grade.webm" 6  "$FRAMES_DIR/$(printf '%02d' $n)-receipt.png"; n=$((n+1))
pick "$SCENES/scene-5-grade.webm" 18 "$FRAMES_DIR/$(printf '%02d' $n)-struggle-list.png"; n=$((n+1))
pick "$SCENES/scene-6-reteach.webm" 14 "$FRAMES_DIR/$(printf '%02d' $n)-reteach.png"; n=$((n+1))
pick "$SCENES/scene-7-practice.webm" 14 "$FRAMES_DIR/$(printf '%02d' $n)-practice.png"; n=$((n+1))
pick "$SCENES/scene-7-practice.webm" 20 "$FRAMES_DIR/$(printf '%02d' $n)-learn.png"; n=$((n+1))
echo "frames -> $FRAMES_DIR"
