#!/usr/bin/env bash
# Assemble the Veradic cycle video — FULL-BLEED cinematic cut:
#   · a COLD OPEN on the integrity catch plays before the title,
#   · every recorded APP clip is shown EDGE-TO-EDGE (no float / no shrink) —
#     the #1 legibility fix,
#   · a gentle Ken-Burns push-in (ffmpeg zoompan, crisp via pre-upscale)
#     adds motion + pulls the eye onto the money shot,
#   · branded title cards get a subtle entrance push,
#   · all segments join with clean eased cross-dissolves (no black dips, no
#     resting on blank cream frames).
# Each segment is normalized first (short, cheap ops); the final dissolve
# chain is one pass over the cached segments — re-runnable if it drops.
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
CARD_SEC=1.8
XF=0.5                  # cross-dissolve duration
PUSH_SECS=5             # seconds for a push-in to reach its target, then hold

rm -rf "$WORK" "$FRAMES_DIR"; mkdir -p "$WORK" "$FRAMES_DIR"

# Order: COLD OPEN → title → the loop → CTA close. The cold open fades up
# from paper; every card→scene and scene→scene join is a cross-dissolve.
SEGMENTS=(
  "scene:0-cold:0:auto"
  "card:00-open:in"
  "card:01-section:none"   "scene:1-section:0:auto"
  "card:02-materials:none" "scene:2-materials:0:auto"
  "card:03-generate:none"  "scene:3-generate:0:auto" "scene:3-figure:0:auto" "scene:3-workshop:0:auto"
  "card:04-submit:none"    "scene:4-submit:0:auto" "scene:4-verdict:0:auto"
  "card:05-grade:none"     "scene:5-grade:0:auto" "scene:5-insights:0:auto"
  "card:06-reteach:none"   "scene:6-reteach:0:auto"
  "card:07-practice:none"  "scene:7-practice:0:auto" "scene:7-learn:0:auto"
  "card:08-close:out"
)

# Per-scene Ken-Burns target zoom. Key beats push harder (legibility +
# cinematic pull); everything else gets a subtle drift.
push_for () {
  case "$1" in
    0-cold)     echo 1.04 ;;   # cold-open is now the live chat — gentle push keeps every revealed row legible
    3-figure)   echo 1.14 ;;
    3-workshop) echo 1.13 ;;
    4-verdict)  echo 1.11 ;;
    5-grade)    echo 1.035 ;;
    5-insights) echo 1.09 ;;
    *)          echo 1.075 ;;
  esac
}

norm_card () {  # $1 card-id  $2 out  $3 fade(in|out|none)
  local fade=""
  [ "$3" = "in" ]  && fade=",fade=t=in:st=0:d=0.7:color=0xf7f5f0"
  [ "$3" = "out" ] && fade=",fade=t=out:st=$(echo "$CARD_SEC-0.8"|bc):d=0.8:color=0xf7f5f0"
  ffmpeg -y -loop 1 -t "$CARD_SEC" -i "$CARDS/card-$1.png" \
    -vf "scale=3840:2160:flags=lanczos,\
zoompan=z='min(zoom+0.00042,1.032)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=$FPS,\
format=yuv420p$fade" \
    -an -c:v libx264 -preset medium -crf 18 "$2" -loglevel error
}

HEAD=1.0                # trim the opening veil-paper (the dissolve bridges it)
norm_scene () {  # $1 webm  $2 start  $3 dur(or "auto")  $4 out  $5 scene-id  $6 fadein(0|1)
  local start; start=$(echo "$2 + $HEAD" | bc | awk '{printf "%.3f", $0}')
  local dur="$3"
  if [ "$dur" = "auto" ]; then
    local raw; raw=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
    # Trim the post-caption hold at the tail (kills dead air, tightens pace).
    dur=$(echo "$raw - $start - 1.3" | bc)
  fi
  local target; target=$(push_for "$5")
  # Pre-upscale to the push target so text stays crisp at full zoom, then
  # zoompan drives a slow center push that reaches the target in PUSH_SECS
  # and holds (a settled, legible end frame).
  local uw uh inc
  uw=$(echo "1920 * $target" | bc | awk '{printf "%d", $0}')
  uh=$(echo "1080 * $target" | bc | awk '{printf "%d", $0}')
  inc=$(echo "($target - 1) / ($FPS * $PUSH_SECS)" | bc -l | awk '{printf "%.6f", $0}')
  local fade=""
  [ "$6" = "1" ] && fade=",fade=t=in:st=0:d=0.55:color=0xf7f5f0"
  ffmpeg -y -ss "$start" -t "$dur" -i "$1" \
    -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=$FPS,\
scale=$uw:$uh:flags=lanczos,\
zoompan=z='min(zoom+$inc,$target)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=$FPS,\
format=yuv420p$fade" \
    -an -c:v libx264 -preset medium -crf 19 "$4" -loglevel error
}

parts=()
i=0
for seg in "${SEGMENTS[@]}"; do
  IFS=':' read -r kind a b c <<< "$seg"
  out="$WORK/part_$(printf '%02d' $i).mp4"
  if [ "$kind" = "card" ]; then
    echo "[seg $i] card $a ($b)"; norm_card "$a" "$out" "$b"
  else
    fin=0; [ "$i" -eq 0 ] && fin=1        # the cold open fades up from paper
    echo "[seg $i] scene $a (full-bleed, push $(push_for "$a"), trim $b:$c)"
    norm_scene "$SCENES/scene-$a.webm" "$b" "$c" "$out" "$a" "$fin"
  fi
  parts+=("$out"); i=$((i+1))
done

# ── Single-pass eased cross-dissolve chain over the cached segments ──
echo "[concat] building dissolve chain over ${#parts[@]} segments"
durs=(); for p in "${parts[@]}"; do durs+=("$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$p")"); done
inputs=(); for p in "${parts[@]}"; do inputs+=(-i "$p"); done
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
pick () { ffmpeg -y -ss "$2" -i "$1" -frames:v 1 "$3" -loglevel error 2>/dev/null || true; }
mid () { local d; d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"); echo "$d * $2 / 1" | bc -l; }
n=1
for c in 00-open 01-section 02-materials 03-generate 04-submit 05-grade 06-reteach 07-practice 08-close; do
  cp "$CARDS/card-$c.png" "$FRAMES_DIR/$(printf '%02d' $n)-card-$c.png"; n=$((n+1))
done
pk () {  # $1 clip  $2 fraction  $3 label
  local w="$SCENES/scene-$1.webm"; [ -f "$w" ] || return 0
  pick "$w" "$(mid "$w" "$2")" "$FRAMES_DIR/$(printf '%02d' $n)-$3.png"; n=$((n+1)); }
pk 0-cold      0.55 coldopen-chat-mid
pk 0-cold      0.80 coldopen-chat-catch
pk 1-section   0.55 section
pk 2-materials 0.70 materials
pk 3-generate  0.92 three-problems
pk 3-figure    0.55 zipline-figure
pk 3-figure    0.85 zipline-solution
pk 3-workshop  0.70 matrix-undefined
pk 4-submit    0.70 photo
pk 4-verdict   0.28 integrity-flag
pk 4-verdict   0.50 activity-digest
pk 4-verdict   0.90 maya-exoneration
pk 5-grade     0.40 matrix-receipt
pk 5-grade     0.90 linear-fullmarks
pk 5-insights  0.45 struggle-list
pk 5-insights  0.85 student-roster
pk 6-reteach   0.80 reteach
pk 7-practice  0.75 practice
pk 7-learn     0.70 learn
echo "content frames -> $FRAMES_DIR"

# Dense final-cut sampling every ~3s (full-bleed deliverable → legibility).
fdur=$(printf '%.0f' "$acc")
t=1
while [ "$t" -lt "$fdur" ]; do
  pick "$OUT_MP4" "$t" "$FRAMES_DIR/final-$(printf '%03d' $t)s.png"
  t=$((t+3))
done
echo "final-cut frames -> $FRAMES_DIR"
