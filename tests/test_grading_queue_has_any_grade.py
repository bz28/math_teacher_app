"""`has_any_grade` (Python) and `has_any_grade_clause` (SQL) must agree.

The retake's guarded write uses the SQL form to re-check "no grade data of
any kind" in the same statement as the write. If the two drift, a retake
could land on a submission the Python check calls graded, or be refused
on one it calls ungraded.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import JSON, delete, select, text

from api.core.grading_queue import has_any_grade, has_any_grade_clause
from api.database import get_session_factory
from api.models.assignment import SubmissionGrade
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import PAGE_PNG

NOW = datetime.now(UTC)
# SQLAlchemy writes Python None to a JSON column as SQL NULL; `JSON.NULL`
# stores the JSON literal `null`, which is a different value in Postgres.
# Both must read as "no grade" in SQL, as `bool(None)` does in Python.
JSON_NULL = JSON.NULL

# One row per field, each set alone, plus the values that must NOT count.
CASES: list[tuple[str, dict[str, Any]]] = [
    ("nothing", {}),
    ("JSON null breakdown", {"breakdown": JSON_NULL}),
    ("JSON null ai_breakdown", {"ai_breakdown": JSON_NULL}),
    ("JSON null published_breakdown", {"published_breakdown": JSON_NULL}),
    ("notes only", {"teacher_notes": "looking"}),
    ("empty breakdown", {"breakdown": []}),
    ("empty ai_breakdown", {"ai_breakdown": {}}),
    ("empty published_breakdown", {"published_breakdown": []}),
    ("final_score", {"final_score": 80}),
    ("ai_score", {"ai_score": 70}),
    ("ai_breakdown", {"ai_breakdown": {"p1": {"percent": 100}}}),
    ("teacher_score", {"teacher_score": 90}),
    ("breakdown", {"breakdown": [{"problem_id": "x", "percent": 100}]}),
    ("graded_at", {"graded_at": NOW}),
    ("reviewed_at", {"reviewed_at": NOW}),
    ("published_final_score", {"published_final_score": 85}),
    ("published_breakdown", {"published_breakdown": [{"problem_id": "x"}]}),
]


@pytest.mark.parametrize(("label", "fields"), CASES, ids=[c[0] for c in CASES])
async def test_the_sql_condition_matches_the_python_check(
    client: AsyncClient, world: dict[str, Any], label: str, fields: dict[str, Any],
) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers={"Authorization": f"Bearer {world['student_token']}"},
        json={"files": [PAGE_PNG]},
    )
    assert r.status_code == 200, r.text
    await drain_integrity_background_tasks()
    sid = uuid.UUID(r.json()["submission_id"])

    async with get_session_factory()() as s:
        await s.execute(delete(SubmissionGrade).where(SubmissionGrade.submission_id == sid))
        grade = SubmissionGrade(submission_id=sid, **fields)
        s.add(grade)
        await s.commit()
        if JSON_NULL in fields.values():
            [col] = [k for k, v in fields.items() if v is JSON_NULL]
            stored = (await s.execute(text(
                f"SELECT {col} IS NULL, CAST({col} AS text) FROM submission_grades "
                "WHERE submission_id = :id"
            ), {"id": sid})).one()
            assert stored == (False, "null"), stored
        sql_says = (await s.execute(
            select(SubmissionGrade.id)
            .where(SubmissionGrade.submission_id == sid, has_any_grade_clause())
        )).scalar_one_or_none() is not None
    # Read the row back in a fresh session, as the app does. The session
    # that wrote it would hand back the same object, still holding the
    # `JSON.NULL` sentinel (which is truthy), not the loaded value.
    async with get_session_factory()() as s:
        row = (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sid)
        )).scalar_one()

    assert sql_says == has_any_grade(row), label
