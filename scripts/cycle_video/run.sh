#!/usr/bin/env bash
# End-to-end build of the Veradic cycle demo. Two DB states are needed:
#   · PUBLISHED  — student submit + the live understanding-check chat + every
#                  review/insights/practice scene,
#   · DRAFT      — the generation reveal + the AI Workshop (the "edit a
#                  problem" affordance only opens when unpublished).
# So we record in passes, flipping Unit 5 Review's status between them.
#
#   scripts/cycle_video/run.sh            # full build
#   scripts/cycle_video/run.sh assemble   # re-assemble only (cached scenes)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$REPO"
export ASSETS_OUT=/tmp/cycle-assets SCENES_OUT=/tmp/cycle-scenes CARDS_OUT=/tmp/cycle-cards
PY=".venv/bin/python"
UNIT5="c072c9b6-fd0c-4565-9bab-afea06a3dcd4"

flip () {  # $1 = draft|published
  PYTHONPATH=. $PY -c "
import asyncio
from sqlalchemy import text
from api.database import get_session_factory
async def m():
    async with get_session_factory()() as s:
        await s.execute(text(\"update assignments set status=:st where id=:i\"), {'st':'$1','i':'$UNIT5'})
        await s.commit()
asyncio.run(m())
print('Unit 5 Review -> $1')"
}

if [ "${1:-}" = "assemble" ]; then
  "$HERE/assemble.sh"; exit 0
fi

echo "==[1/7] props + title cards=="
node "$HERE/make_assets.mjs"
node "$HERE/title_cards.mjs"

echo "==[2/7] seed published world + mint tokens=="
WORKSHEET_ASSET=$ASSETS_OUT/worksheet.png PYTHONPATH=. $PY -m scripts.cycle_video_prep
export TOKENS=$(PYTHONPATH=. $PY -m scripts.cycle_video.mint_tokens)

echo "==[3/7] record the COLD OPEN — Jordan's live understanding-check chat (in_progress)=="
PYTHONPATH=. $PY -m scripts.cycle_video.set_jordan_inprogress
node "$HERE/record_scenes.mjs" 0-cold
echo "  · restore Jordan's resolved flag"
WORKSHEET_ASSET=$ASSETS_OUT/worksheet.png PYTHONPATH=. $PY -m scripts.cycle_video_prep

echo "==[4/7] record published-state scenes (teacher review flag + Maya exoneration, etc.)=="
node "$HERE/record_scenes.mjs" 1-section 2-materials 4-submit 4-verdict 5-grade 5-insights 6-reteach 7-practice 7-learn

echo "==[5/7] draft state → record generation family (workshop proposal pre-seeded)=="
flip draft
node "$HERE/record_scenes.mjs" 3-generate 3-figure 3-workshop

echo "==[6/7] restore published state=="
flip published

echo "==[7/7] assemble=="
"$HERE/assemble.sh"
echo "DONE"
