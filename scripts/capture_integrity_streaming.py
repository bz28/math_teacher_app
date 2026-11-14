"""Measure + screenshot the streamed integrity chat against a running stack.

Standalone (not a durable test) — LIVE model calls (~$0.02 per check, a
few cents of Sonnet per turn), so it asks for nothing but a local DB:

    DATABASE_URL=... .venv/bin/python -m scripts.capture_integrity_streaming

    API_BASE  (default http://localhost:8000/v1) — the API under test
    WEB_BASE  (default http://localhost:3000)    — the web app pointed at it
    RUNS      (default 3) — checks per endpoint for the timing comparison

1. Timing: RUNS fresh checks answered through /turn (the old client: the
   first word shows when the whole reply lands) and RUNS through
   /turn/stream (first word = first `delta`), same opener and same
   student reply. Prints time-to-first-text for both.
2. Browser: one more check driven through the real student chat —
   screenshots mid-stream and final, logs console errors and the
   measured click→first-word time — then the teacher's review of it.

Writes docs/design/integrity-streaming-*.png.
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.engine import make_url

from api.config import settings
from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.core.integrity_pipeline import start_integrity_check
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

API_BASE = os.environ.get("API_BASE", "http://localhost:8000/v1").rstrip("/")
WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3000").rstrip("/")
RUNS = int(os.environ.get("RUNS", "3"))
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"

QUESTION = "Solve x^2 - 5x + 6 = 0."
EXTRACTION = {
    "steps": [
        {"step_num": 1, "latex": "x^2 - 5x + 6 = 0", "plain_english": "",
         "problem_position": 1},
        {"step_num": 2, "latex": "(x - 2)(x - 3) = 0", "plain_english": "factor",
         "problem_position": 1},
        {"step_num": 3, "latex": "x = 2 \\text{ or } x = 3", "plain_english": "",
         "problem_position": 1},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "x = 2 or x = 3", "answer_plain": ""},
    ],
    "confidence": 0.9,
}
REPLY = (
    "I looked for two numbers that multiply to 6 and add to -5, which are "
    "-2 and -3, so it factors to (x-2)(x-3). Then each factor can be zero, "
    "so x is 2 or 3."
)


def _assert_local() -> None:
    host = (make_url(settings.database_url).host or "").lower()
    if host not in {"localhost", "127.0.0.1", "::1", ""}:
        raise SystemExit(f"Refusing to run against non-local DB host {host!r}.")


async def _seed_world() -> dict[str, Any]:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"stream_{tag}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"stream_teacher_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id,
        )
        student = User(
            email=f"stream_student_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Alex Kim", school_id=school.id,
        )
        s.add_all([teacher, student])
        await s.flush()
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        section = Section(course_id=course.id, name="Period 3")
        s.add_all([unit, section])
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))
        world = {
            "teacher_id": teacher.id, "student_id": student.id,
            "course_id": course.id, "unit_id": unit.id, "section_id": section.id,
            "student_token": create_access_token(str(student.id), "student"),
            "student_refresh": await create_refresh_token(s, student.id),
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
            "teacher_refresh": await create_refresh_token(s, teacher.id),
        }
        await s.commit()
    return world


async def _seed_check(w: dict[str, Any], label: str) -> dict[str, str]:
    """A fresh HW with one problem, submitted, with its opener generated
    by the real pipeline (one live call)."""
    async with get_session_factory()() as s:
        hw = Assignment(
            course_id=w["course_id"], unit_ids=[w["unit_id"]],
            teacher_id=w["teacher_id"], title=f"Quadratics — {label}",
            type="homework", status="published", content={"problems": []},
            integrity_check_enabled=True, ai_grading_enabled=False,
        )
        s.add(hw)
        await s.flush()
        item = QuestionBankItem(
            course_id=w["course_id"], unit_id=w["unit_id"],
            originating_assignment_id=hw.id, title="Factor", question=QUESTION,
            solution_steps=[], final_answer="x = 2 or x = 3",
            distractors=["a", "b", "c"], difficulty="medium",
            status="approved", source="generated",
        )
        s.add(item)
        await s.flush()
        hw.content = {"problems": [{"bank_item_id": str(item.id), "position": 1}]}
        s.add(AssignmentSection(assignment_id=hw.id, section_id=w["section_id"]))
        sub = Submission(
            assignment_id=hw.id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted", files=[],
            extraction=EXTRACTION, is_late=False,
        )
        s.add(sub)
        await s.flush()
        await start_integrity_check(sub.id, s, extraction=EXTRACTION)
        await s.commit()
        return {"hw": str(hw.id), "submission": str(sub.id)}


async def _time_json(client: httpx.AsyncClient, w: dict[str, Any], sub: str) -> float:
    t0 = time.monotonic()
    r = await client.post(
        f"{API_BASE}/school/student/integrity/submissions/{sub}/turn",
        headers={"Authorization": f"Bearer {w['student_token']}"},
        json={"message": REPLY}, timeout=120,
    )
    r.raise_for_status()
    return time.monotonic() - t0


async def _time_stream(
    client: httpx.AsyncClient, w: dict[str, Any], sub: str,
) -> tuple[float | None, float]:
    t0 = time.monotonic()
    first: float | None = None
    buf = ""
    async with client.stream(
        "POST", f"{API_BASE}/school/student/integrity/submissions/{sub}/turn/stream",
        headers={"Authorization": f"Bearer {w['student_token']}"},
        json={"message": REPLY}, timeout=120,
    ) as r:
        r.raise_for_status()
        async for chunk in r.aiter_text():
            buf += chunk
            if first is None and "event: delta" in buf:
                first = time.monotonic() - t0
    assert "event: done" in buf, buf[-500:]
    return first, time.monotonic() - t0


async def _timing(w: dict[str, Any]) -> None:
    json_s: list[float] = []
    first_s: list[float] = []
    total_s: list[float] = []
    async with httpx.AsyncClient() as client:
        for i in range(RUNS):
            sub = (await _seed_check(w, f"json-{i}"))["submission"]
            json_s.append(await _time_json(client, w, sub))
            sub = (await _seed_check(w, f"stream-{i}"))["submission"]
            first, total = await _time_stream(client, w, sub)
            total_s.append(total)
            if first is not None:
                first_s.append(first)

    def fmt(xs: list[float]) -> str:
        return ", ".join(f"{x:.2f}s" for x in xs) + (
            f"  (median {statistics.median(xs):.2f}s)" if xs else ""
        )

    print("time to first agent text")  # noqa: T201
    print(f"  /turn (before):        {fmt(json_s)}")  # noqa: T201
    print(f"  /turn/stream (after):  {fmt(first_s)}")  # noqa: T201
    print(f"  /turn/stream total:    {fmt(total_s)}")  # noqa: T201


async def _browser(w: dict[str, Any]) -> None:
    ids = await _seed_check(w, "browser")
    url = f"{WEB_BASE}/school/student/courses/{w['course_id']}/homework/{ids['hw']}"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["student_token"], w["student_refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(url, wait_until="networkidle", timeout=60000)
            box = page.locator("textarea")
            await box.wait_for(timeout=30000)
            await box.fill(REPLY)
            # Bubbles before the send: intro, opener. A streamed bubble is
            # one that appears while "AI is thinking…" is still showing.
            agent_bubbles = page.locator("div.justify-start > div.border")
            before = await agent_bubbles.count()
            t0 = time.monotonic()
            await page.get_by_role("button", name="Send").click()
            first = None
            shot_mid = False
            while True:
                thinking = await page.get_by_text("AI is thinking…").count()
                n = await agent_bubbles.count()
                if first is None and thinking and n > before + 1:
                    first = time.monotonic() - t0
                if first is not None and not shot_mid and thinking:
                    await page.wait_for_timeout(700)
                    await page.screenshot(
                        path=str(OUT_DIR / "integrity-streaming-mid.png"),
                    )
                    shot_mid = True
                if not thinking and time.monotonic() - t0 > 0.5:
                    break
                if time.monotonic() - t0 > 90:
                    raise SystemExit("turn never finished")
                await page.wait_for_timeout(40)
            total = time.monotonic() - t0
            await page.wait_for_timeout(600)
            await page.screenshot(path=str(OUT_DIR / "integrity-streaming-final.png"))
            print(  # noqa: T201
                f"browser: first words {first and f'{first:.2f}s'}, "
                f"turn done {total:.2f}s, mid-stream shot={shot_mid}, "
                f"console errors={json.dumps(errors)}",
            )

        review = (
            f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/"
            f"{ids['hw']}/sections/{w['section_id']}/review?student={w['student_id']}"
        )
        async with browser.authed_page(w["teacher_token"], w["teacher_refresh"]) as page:
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            await page.goto(review, wait_until="networkidle", timeout=60000)
            await page.get_by_role("button", name="View conversation").click()
            await page.wait_for_timeout(1500)
            await page.screenshot(
                path=str(OUT_DIR / "integrity-streaming-teacher.png"), full_page=True,
            )
            print(f"teacher review: console errors={json.dumps(errors)}")  # noqa: T201
            print(f"  {review}")  # noqa: T201


async def main() -> int:
    _assert_local()
    w = await _seed_world()
    if RUNS:
        await _timing(w)
    await _browser(w)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
