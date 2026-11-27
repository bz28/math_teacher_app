"""GET /v1/teacher/courses/{id}/submissions-inbox — `to_publish`: of the
grades waiting to go out, the ones already approved, so only Publish is
left. The homework page's review band splits "to approve" from "to
publish" with it, the same split the home queue makes."""

from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient

from api.database import get_session_factory
from api.models.assignment import SubmissionGrade
from tests.conftest import auth_headers as _auth
from tests.test_teacher_needs_attention import _add_submission, _publish_hw, _seed


async def test_to_publish_counts_only_approved_unreleased_grades(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=None)
    now = datetime.now(UTC)
    # One enrolled student, so each grade state gets its own homework.
    states = {
        "ai_unapproved": dict(final_score=80.0),
        "approved": dict(final_score=90.0, reviewed_at=now),
        "approved_published_clean": dict(
            final_score=70.0, reviewed_at=now, grade_published_at=now, published_final_score=70.0,
        ),
        "approved_published_edited": dict(
            final_score=75.0, reviewed_at=now, grade_published_at=now, published_final_score=70.0,
        ),
    }
    expected = {
        "ai_unapproved": 0,
        "approved": 1,
        "approved_published_clean": 0,
        "approved_published_edited": 1,
    }
    hws = {"ai_unapproved": hw}
    for name in list(states)[1:]:
        hws[name] = await _publish_hw(w, due_at=None, title=name)
    async with get_session_factory()() as s:
        for name, fields in states.items():
            sub_id = await _add_submission(w, hws[name])
            s.add(SubmissionGrade(submission_id=sub_id, **fields))
        await s.commit()

    r = await client.get(
        f"/v1/teacher/courses/{w['course_id']}/submissions-inbox",
        headers=_auth(w["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    by_hw = {row["assignment_id"]: row for row in r.json()["rows"]}
    got = {name: by_hw[str(hws[name])]["to_publish"] for name in states}
    assert got == expected
