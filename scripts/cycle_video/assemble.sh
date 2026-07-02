#!/usr/bin/env bash
# Assemble the Veradic cycle video. Each scene is a branded title card
# (still -> gentle push-in with fades) followed by the recorded scene clip
# FLOATED as a rounded, soft-shadowed card on warm paper (matching the
# cards), normalized to 1920x1080 / 30fps / H.264 and concatenated with
# clean cross-dissolves. Also exports floated review still frames.
#
#   node scripts/cycle_video/frame_plate.mjs   # once, renders the plates
#   scripts/cycle_video/assemble.sh
set -euo pipefail

CARDS="${CARDS_OUT:-/tmp/cycle-cards}"
SCENES="${SCENES_OUT:-/tmp/cycle-scenes}"
PLATES="${PLATES_OUT:-/tmp/cycle-plates}"
WORK="${WORK_DIR:-/tmp/cycle-build}"
OUT_MP4="${OUT_MP4:-/tmp/veradic-cycle.mp4}"
FRAMES_DIR="${FRAMES_DIR:-/tmp/cycle-frames}"
FPS=30
CARD_SEC=2.8
XF=0.55   # cross-dissolve duration

# Float geometry — MUST match frame_plate.mjs (CARD_W/H, centered).
CW=1766; CH=994
CX=$(( (1920 - CW) / 2 ))   # 77
CY=$(( (1080 - CH) / 2 ))   # 43
MASK="$PLATES/plate-mask.png"
BG="$PLATES/plate-bg.png"

rm -rf "$WORK" "$FRAMES_DIR"; mkdir -p "$WORK" "$FRAMES_DIR"

# segment -> title-card id, or scene clip with "start:dur" trim ("auto" =
# real length minus a small tail so the fade-out lands on a clean frame).
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

# The float filter graph, shared by scenes + review frames. Input 0 = the
# clip/frame, 1 = rounded alpha mask, 2 = warm bg+shadow plate.
FLOAT_FC="[0:v]scale=${CW}:${CH}:force_original_aspect_ratio=decrease,pad=${CW}:${CH}:(ow-iw)/2:(oh-ih)/2:color=0xf7f5f0,setsar=1,format=rgba[v];[1:v]format=gray,scale=${CW}:${CH}[m];[v][m]alphamerge[card];[2:v][card]overlay=${CX}:${CY}:shortest=1"

norm_card () {  # $1 card-id  $2 out
  local frames; frames=$(echo "$CARD_SEC*$FPS/1" | bc)
  ffmpeg -y -loop 1 -t "$CARD_SEC" -i "$CARDS/card-$1.png" \
    -vf "scale=1920:1080,fps=$FPS,zoompan=z='min(1+0.045*on/${frames},1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=$(echo "$CARD_SEC-0.5"|bc):d=0.5" \
    -an -c:v libx264 -preset medium -crf 18 "$2" -loglevel error
}

norm_scene () {  # $1 webm  $2 start  $3 dur(or "auto")  $4 out
  local dur="$3"
  if [ "$dur" = "auto" ]; then
    local raw; raw=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
    dur=$(echo "$raw - $2 - 0.18" | bc)
  fi
  ffmpeg -y -ss "$2" -t "$dur" -i "$1" -loop 1 -i "$MASK" -loop 1 -i "$BG" \
    -filter_complex "${FLOAT_FC},fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=$(echo "$dur-0.35"|bc):d=0.35[out]" \
    -map "[out]" -an -c:v libx264 -preset medium -crf 19 "$4" -loglevel error
}

parts=()
i=0
for seg in "${SEGMENTS[@]}"; do
  IFS=':' read -r kind a b c <<< "$seg"
  out="$WORK/part_$(printf '%02d' $i).mp4"
  if [ "$kind" = "card" ]; then
    echo ">> card $a"; norm_card "$a" "$out"
  else
    echo ">> scene $a (trim $b:$c)"; norm_scene "$SCENES/scene-$a.webm" "$b" "$c" "$out"
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
  echo ">> xfade part $k @ ${off}s"
  ffmpeg -y -i "$acc" -i "$nxt" \
    -filter_complex "[0:v][1:v]xfade=transition=fade:duration=$XF:offset=$off,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -preset medium -crf 18 "$tmp" -loglevel error
  ndur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$nxt")
  dur=$(echo "$dur + $ndur - $XF" | bc)
  acc="$tmp"
done

cp "$acc" "$OUT_MP4"
echo "wrote $OUT_MP4  (~${dur}s)"

# ── Review still frames: every card + key floated content frames. ──
n=1
for c in 00-open 01-section 02-materials 03-generate 04-submit 05-grade 06-reteach 07-practice 08-close; do
  cp "$CARDS/card-$c.png" "$FRAMES_DIR/$(printf '%02d' $n)-card-$c.png"; n=$((n+1))
done
# Composite a single floated review frame from a raw webm at a fraction,
# so the still reflects the SHIPPED float (rounded, shadowed, on paper).
float_frame () {  # $1 clip  $2 fraction  $3 label
  local w="$SCENES/scene-$1.webm"; [ -f "$w" ] || return 0
  local d t; d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$w")
  t=$(echo "$d * $2 / 1" | bc -l)
  local raw="$WORK/_rf_raw.png"
  # Output-seek decode (robust on webm keyframes; slower, but few frames).
  ffmpeg -y -i "$w" -ss "$t" -frames:v 1 "$raw" -loglevel error 2>/dev/null || return 0
  ffmpeg -y -i "$raw" -i "$MASK" -i "$BG" \
    -filter_complex "${FLOAT_FC},format=yuv420p[out]" -map "[out]" \
    -frames:v 1 "$FRAMES_DIR/$(printf '%02d' $n)-$3.png" -loglevel error 2>/dev/null || true
  n=$((n+1))
}
float_frame 1-section   0.55 section
float_frame 2-materials 0.70 materials
float_frame 3-generate  0.94 soccer-problems
float_frame 3-solution  0.75 worked-solution
float_frame 3-figure    0.80 figure-reshape
float_frame 4-submit    0.70 photo
float_frame 4-chat      0.50 understanding-chat
float_frame 4-chat      0.92 understanding-terminal
float_frame 4-verdict   0.75 integrity-flag
float_frame 5-grade     0.55 receipt
float_frame 5-grade     0.88 integrity-verdict
float_frame 5-insights  0.45 struggle-list
float_frame 5-insights  0.85 student-roster
float_frame 6-reteach   0.80 reteach
float_frame 7-practice  0.70 practice
float_frame 7-learn     0.70 learn
echo "frames -> $FRAMES_DIR"
