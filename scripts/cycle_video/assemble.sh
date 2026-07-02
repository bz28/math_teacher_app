#!/usr/bin/env bash
# Assemble the Veradic cycle video, cinematic cut:
#   · every recorded APP clip is FLOATED on a warm-gradient mat with
#     rounded corners + a soft drop shadow (plate.png / mask.png),
#   · branded title cards get a subtle Ken-Burns entrance push,
#   · all segments join with clean eased cross-dissolves (no black dips);
#     the open fades up and the close fades out.
# Each segment is normalized first (short, cheap ops); the final dissolve
# chain is a single pass over the cached segments — re-runnable if it drops.
#
#   scripts/cycle_video/assemble.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CARDS="${CARDS_OUT:-/tmp/cycle-cards}"
SCENES="${SCENES_OUT:-/tmp/cycle-scenes}"
WORK="${WORK_DIR:-/tmp/cycle-build}"
OUT_MP4="${OUT_MP4:-/tmp/veradic-cycle.mp4}"
FRAMES_DIR="${FRAMES_DIR:-/tmp/cycle-frames}"
FPS=30
CARD_SEC=2.4
XF=0.5                  # cross-dissolve duration

# Float geometry (subtle: a thin warm mat + shadow, so dense app text
# stays legible — only a ~5% inset). Kept in one place; float_plates.mjs
# renders to match.
FW=1824; FH=1026; FX=48; FY=27; RADIUS=20

rm -rf "$WORK" "$FRAMES_DIR"; mkdir -p "$WORK" "$FRAMES_DIR"

echo "[plates] rendering float mat + rounded mask"
FLOAT_W=$FW FLOAT_H=$FH FLOAT_X=$FX FLOAT_Y=$FY RADIUS=$RADIUS OUT="$WORK" \
  node "$HERE/float_plates.mjs"
PLATE="$WORK/plate.png"; MASK="$WORK/mask.png"

SEGMENTS=(
  "card:00-open:in"
  "card:01-section:none"   "scene:1-section:0:auto"
  "card:02-materials:none" "scene:2-materials:0:auto"
  "card:03-generate:none"  "scene:3-generate:0:auto" "scene:3-solution:0:auto" "scene:3-figure:0:auto"
  "card:04-submit:none"    "scene:4-submit:0:auto" "scene:4-chat:0:auto" "scene:4-verdict:0:auto"
  "card:05-grade:none"     "scene:5-grade:0:auto" "scene:5-insights:0:auto"
  "card:06-reteach:none"   "scene:6-reteach:0:auto"
  "card:07-practice:none"  "scene:7-practice:0:auto" "scene:7-learn:0:auto"
  "card:08-close:out"
)

norm_card () {  # $1 card-id  $2 out  $3 fade(in|out|none)
  local fade=""
  [ "$3" = "in" ]  && fade=",fade=t=in:st=0:d=0.7:color=0xf7f5f0"
  [ "$3" = "out" ] && fade=",fade=t=out:st=$(echo "$CARD_SEC-0.8"|bc):d=0.8:color=0xf7f5f0"
  # Pre-upscale then zoompan for a smooth, jitter-free entrance push.
  ffmpeg -y -loop 1 -t "$CARD_SEC" -i "$CARDS/card-$1.png" \
    -vf "scale=3840:2160:flags=lanczos,\
zoompan=z='min(zoom+0.00042,1.032)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=$FPS,\
format=yuv420p$fade" \
    -an -c:v libx264 -preset medium -crf 18 "$2" -loglevel error
}

norm_scene () {  # $1 webm  $2 start  $3 dur(or "auto")  $4 out
  local dur="$3"
  if [ "$dur" = "auto" ]; then
    local raw; raw=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
    dur=$(echo "$raw - $2 - 0.18" | bc)
  fi
  # Float the clip: fit to frame → shrink to the card rect → round corners
  # (alphamerge with mask) → composite over the warm mat (plate).
  ffmpeg -y -ss "$2" -t "$dur" -i "$1" -i "$MASK" -i "$PLATE" \
    -filter_complex "\
[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf7f5f0,fps=$FPS,\
scale=$FW:$FH:flags=lanczos,format=rgba[app];\
[1:v]format=gray[mk];\
[app][mk]alphamerge[appm];\
[2:v]format=rgba[bg];\
[bg][appm]overlay=$FX:$FY:format=auto,format=yuv420p[v]" \
    -map "[v]" -an -c:v libx264 -preset medium -crf 19 "$4" -loglevel error
}

parts=()
i=0
for seg in "${SEGMENTS[@]}"; do
  IFS=':' read -r kind a b c <<< "$seg"
  out="$WORK/part_$(printf '%02d' $i).mp4"
  if [ "$kind" = "card" ]; then
    echo "[seg $i] card $a ($b)"; norm_card "$a" "$out" "$b"
  else
    echo "[seg $i] scene $a (float, trim $b:$c)"; norm_scene "$SCENES/scene-$a.webm" "$b" "$c" "$out"
  fi
  parts+=("$out"); i=$((i+1))
done

# ── Single-pass eased cross-dissolve chain over the cached segments ──
echo "[concat] building dissolve chain over ${#parts[@]} segments"
durs=(); for p in "${parts[@]}"; do durs+=("$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$p")"); done
inputs=(); for p in "${parts[@]}"; do inputs+=(-i "$p"); done
# Normalize every input to one timebase/fps/sar first (zoompan vs scene
# clips otherwise carry mismatched timebases that xfade rejects).
graph=""
for ((k=0; k<${#parts[@]}; k++)); do
  graph+="[$k:v]fps=$FPS,settb=AVTB,setsar=1,format=yuv420p[s$k];"
done
prev="[s0]"; acc="${durs[0]}"
for ((k=1; k<${#parts[@]}; k++)); do
  off=$(echo "$acc - $XF" | bc)
  if [ "$k" -eq $(( ${#parts[@]} - 1 )) ]; then lbl="[vout]"; else lbl="[x$k]"; fi
  graph+="${prev}[s$k]xfade=transition=fade:duration=$XF:offset=$off$lbl;"
  prev="[x$k]"
  acc=$(echo "$acc + ${durs[$k]} - $XF" | bc)
done
graph="${graph%;}"

ffmpeg -y "${inputs[@]}" -filter_complex "$graph" \
  -map "[vout]" -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "$OUT_MP4" -loglevel error
echo "[done] wrote $OUT_MP4  (~${acc}s)"

# ── Review frames ──────────────────────────────────────────────────
# (a) content picks from the raw clips (verify facts/legibility of source)
# (b) a dense sampling of the FINAL floated cut (verify the float + timing)
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
echo "content frames -> $FRAMES_DIR"

# Dense final-cut sampling every 2.5s (floated deliverable → legibility).
fdur=$(printf '%.0f' "$acc")
t=1
while [ "$t" -lt "$fdur" ]; do
  pick "$OUT_MP4" "$t" "$FRAMES_DIR/final-$(printf '%03d' $t)s.png"
  t=$((t+3))
done
echo "final-cut frames -> $FRAMES_DIR"
