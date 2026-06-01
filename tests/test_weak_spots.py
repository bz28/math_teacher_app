"""/weak-spots endpoint — powers the mobile Review tab.

Guards: own-data scoping (no IDOR), has_issues filtering, subject
filtering, dedupe-by-problem-text with issue_count, and the
invalid-subject + empty-state edges.
"""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.session import Session as SessionModel
from api.models.user import User
from api.models.work_submission import WorkSubmission

from .conftest import auth_headers

URL = "/v1/weak-spots"


async def _mk_user() -> uuid.UUID:
    async with get_session_factory()() as s:
        u = User(email=f"ws_{uuid.uuid4().hex[:8]}@t.com",
                 password_hash=hash_password("x"), grade_level=9,
                 role="student", name="WS")
        s.add(u)
        await s.flush()
        uid = u.id
        await s.commit()
    return uid


async def _mk_submission(user_id: uuid.UUID, *, subject: str, problem: str,
                         has_issues: bool, created: datetime) -> None:
    async with get_session_factory()() as s:
        sess = SessionModel(user_id=user_id, problem=problem,
                            problem_type="algebra", subject=subject)
        s.add(sess)
        await s.flush()
        s.add(WorkSubmission(
            user_id=user_id, session_id=sess.id, problem_index=0,
            problem_text=problem, diagnosis={}, summary=f"issue with {problem}",
            has_issues=has_issues, created_at=created,
        ))
        await s.commit()


@pytest.fixture(autouse=True)
async def _clean_ws() -> None:
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE work_submissions, sessions CASCADE"))
        await s.commit()


@pytest.mark.asyncio
async def test_invalid_subject_400(client: AsyncClient) -> None:
    uid = await _mk_user()
    token = create_access_token(str(uid), "student")
    r = await client.get(URL, params={"subject": "astrology"}, headers=auth_headers(token))
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_empty_state(client: AsyncClient) -> None:
    uid = await _mk_user()
    token = create_access_token(str(uid), "student")
    r = await client.get(URL, params={"subject": "math"}, headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["items"] == []


@pytest.mark.asyncio
async def test_scoping_and_filtering(client: AsyncClient) -> None:
    me = await _mk_user()
    other = await _mk_user()
    now = datetime.now(UTC)
    # My flagged math problem (two attempts -> dedupe, issue_count=2)
    await _mk_submission(me, subject="math", problem="solve x^2=9", has_issues=True, created=now - timedelta(minutes=2))
    await _mk_submission(me, subject="math", problem="solve x^2=9", has_issues=True, created=now)
    # My non-flagged problem (excluded)
    await _mk_submission(me, subject="math", problem="clean one", has_issues=False, created=now)
    # My other-subject flagged problem (excluded by subject filter)
    await _mk_submission(me, subject="chemistry", problem="balance eq", has_issues=True, created=now)
    # Another user's flagged math problem (excluded by scoping — IDOR guard)
    await _mk_submission(other, subject="math", problem="not mine", has_issues=True, created=now)

    token = create_access_token(str(me), "student")
    r = await client.get(URL, params={"subject": "math"}, headers=auth_headers(token))
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1, "only my flagged math problem, deduped"
    assert items[0]["problem_text"] == "solve x^2=9"
    assert items[0]["issue_count"] == 2
    assert all(it["problem_text"] != "not mine" for it in items)
