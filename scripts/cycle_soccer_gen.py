"""One-time helper: generate a REAL soccer-themed homework for the cycle demo.

Scene 3a shows the teacher setting a focus of "soccer" and the AI writing
visibly soccer-themed problems. To keep that proof honest (real generation,
not hand-authored), this drives the actual generation pipeline over HTTP:

  1. Create (idempotent) a "Soccer word problems" homework on Algebra I /
     Linear Equations.
  2. POST the real /question-bank/generate with the source worksheet +
     a soccer focus constraint, then poll the job to completion.
  3. Approve the generated items and pin them to the homework so the
     recording lands on a clean, published, soccer-themed set.

Requires the API + a minted teacher token. Run once; it persists.

  API_BASE=http://localhost:8000/v1 TOKEN=<teacher access> \
  PYTHONPATH=. .venv/bin/python -m scripts.cycle_soccer_gen
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.request
import uuid

from sqlalchemy import text

from api.database import get_session_factory

API = os.environ.get("API_BASE", "http://localhost:8000/v1")
TOKEN = os.environ["TOKEN"]

ALG_COURSE = "c99b654b-7ef8-4b05-a1df-a57c47d98f6e"
LINEAR_UNIT = "5547f6d5-0487-4174-bae0-a25908900c68"
WORKSHEET_DOC = "77463806-bf77-48b0-95bb-15e55dfa1c64"
SOCCER_HW = "5e0c7a11-50cc-4bb0-9e11-50cc0a11500c"  # stable id for reruns
TEACHER_EMAIL = "td_teacher_d592cc@t.com"

FOCUS = (
    "Theme every single problem around soccer — players, goals, matches, "
    "shots on target, pass completion, tournament standings, ticket sales. "
    "Keep them as Linear Equations word problems (solve for one variable). "
    "Make the soccer context unmistakable in each question."
)


def _req(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        API + path, data=data, method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=180) as resp:
        return json.loads(resp.read().decode())


async def main() -> None:
    async with get_session_factory()() as s:
        tid = (await s.execute(
            text("select id from users where email=:e"), {"e": TEACHER_EMAIL})).scalar_one()
        # 1 · idempotent homework row
        await s.execute(text(
            "insert into assignments (id, course_id, unit_ids, teacher_id, title, type, "
            "status, late_policy, content, document_ids, integrity_check_enabled, ai_grading_enabled) "
            "values (:id, :c, :u, :t, :title, 'homework', 'draft', 'none', :content, :docs, true, true) "
            "on conflict (id) do update set title=excluded.title, content=excluded.content"),
            {"id": SOCCER_HW, "c": ALG_COURSE, "u": [uuid.UUID(LINEAR_UNIT)], "t": tid,
             "title": "Soccer word problems", "content": json.dumps({"problem_ids": []}),
             "docs": json.dumps([WORKSHEET_DOC])})
        await s.commit()
    print("ensured soccer homework row")

    # 2 · real generation
    job = _req("POST", f"/teacher/courses/{ALG_COURSE}/question-bank/generate", {
        "count": 3, "assignment_id": SOCCER_HW, "unit_id": LINEAR_UNIT,
        "document_ids": [WORKSHEET_DOC], "constraint": FOCUS,
    })
    job_id = job["id"] if "id" in job else job.get("job_id")
    print("generation job:", job_id)
    for _ in range(90):
        time.sleep(3)
        st = _req("GET", f"/teacher/courses/{ALG_COURSE}/question-bank/generation-jobs/{job_id}")
        status_ = st.get("status")
        print("  job status:", status_)
        if status_ in ("done", "failed"):
            if status_ == "failed":
                raise SystemExit(f"generation failed: {st.get('error')}")
            break

    # 3 · approve + pin the generated items
    async with get_session_factory()() as s:
        rows = (await s.execute(text(
            "select id, left(question,90) from question_bank_items "
            "where originating_assignment_id=:a order by created_at"),
            {"a": SOCCER_HW})).all()
        ids = [str(r[0]) for r in rows]
        for r in rows:
            print("  generated:", r[1])
        await s.execute(text(
            "update question_bank_items set status='approved' where originating_assignment_id=:a"),
            {"a": SOCCER_HW})
        # Leave the homework as a DRAFT — the natural just-generated state
        # the teacher reviews in. Draft problems stay clickable, so the
        # recording can open a problem's Workshop to reveal its worked
        # solution + verified answer (scene 3b) and reshape a figure (3d).
        await s.execute(text(
            "update assignments set content=:c, status='draft' where id=:a"),
            {"c": json.dumps({"problem_ids": ids}), "a": SOCCER_HW})
        await s.commit()
    print(f"approved + pinned {len(ids)} soccer problems")


if __name__ == "__main__":
    asyncio.run(main())
