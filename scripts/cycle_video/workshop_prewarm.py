"""Pre-warm the AI Workshop reshape so scene 3-figure has ZERO on-camera
wait. The live Claude call (~10s) happens here, off-camera: it posts a
plain-English reshape request on the right-triangle figure item, leaving a
pending proposal in the item's chat. When the recorder opens the Workshop
modal it renders that proposal instantly — the redrawn, re-verified figure
with before/after + Accept, no thinking spinner.

Run AFTER cycle_video_prep (which resets the item), BEFORE recording:

  TOKEN=<teacher access> PYTHONPATH=. .venv/bin/python -m scripts.cycle_video.workshop_prewarm
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

API = os.environ.get("API_BASE", "http://localhost:8000/v1")
TOKEN = os.environ["TOKEN"]
FIGURE_ITEM = "44e22fa0-bafb-4f01-bb4c-514e8a93228d"  # right triangle 8-15-17
REQUEST = "Change the legs to 9 and 12 instead."


def main() -> int:
    body = json.dumps({"message": REQUEST}).encode()
    r = urllib.request.Request(
        f"{API}/teacher/question-bank/{FIGURE_ITEM}/chat",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=120) as resp:
        d = json.loads(resp.read().decode())
    msgs = d.get("chat_messages") or []
    prop = (msgs[-1].get("proposal") if msgs else None) or {}
    ok = bool(prop.get("figure_svg")) and bool(prop.get("final_answer"))
    print(f"workshop pre-warmed: {len(msgs)} msgs, "
          f"figure={bool(prop.get('figure_svg'))}, answer={prop.get('final_answer')}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
