"""`Submission.files` is the student's photos, base64 inline — several MB a
row. It is deferred with raiseload on the model, so only the queries that
send or read the photos load them. The teacher's review roster, polled
every few seconds while grading runs, read the whole class's photos to send
names and scores until this was in place (seconds per poll in prod).
"""

import base64
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import event, select, update
from sqlalchemy.exc import InvalidRequestError

from api.database import get_engine, get_session_factory
from api.models.assignment import Submission
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio

_FILES = [{"data": base64.b64encode(b"\xff\xd8\xff" + b"x" * 64).decode(), "media_type": "image/jpeg"}]


@contextmanager
def _statements() -> Iterator[list[str]]:
    """Every SQL statement the app sends while the block runs."""
    seen: list[str] = []

    def _record(conn: Any, cursor: Any, statement: str, *args: Any) -> None:
        seen.append(statement)

    sync_engine = get_engine().sync_engine
    event.listen(sync_engine, "before_cursor_execute", _record)
    try:
        yield seen
    finally:
        event.remove(sync_engine, "before_cursor_execute", _record)


async def _seed_with_files(n: int) -> dict[str, Any]:
    world = await _seed_hw(n_submissions=n)
    async with get_session_factory()() as s:
        await s.execute(
            update(Submission)
            .where(Submission.id.in_(world["submission_ids"]))
            .values(files=_FILES)
        )
        await s.commit()
    return world


async def test_files_not_loaded_unless_asked_for() -> None:
    world = await _seed_with_files(1)
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == world["submission_ids"][0])
        )).scalar_one()
        # Raises rather than a silent lazy load (MissingGreenlet under async).
        with pytest.raises(InvalidRequestError):
            _ = sub.files
        # A write without loading it first still lands.
        sub.files = _FILES + _FILES
        await s.commit()
    async with get_session_factory()() as s:
        files = (await s.execute(
            select(Submission.files).where(Submission.id == world["submission_ids"][0])
        )).scalar_one()
    assert files == _FILES + _FILES


async def test_review_roster_does_not_read_photos(client: AsyncClient) -> None:
    world = await _seed_with_files(3)
    with _statements() as seen:
        r = await client.get(
            f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
            headers=_auth(world["teacher_token"]),
        )
    assert r.status_code == 200, r.text
    assert len(r.json()["submissions"]) == 3
    assert seen, "listener saw no statements"
    assert not [q for q in seen if "submissions.files" in q]


async def test_submission_detail_still_returns_photos(client: AsyncClient) -> None:
    world = await _seed_with_files(1)
    r = await client.get(
        f"/v1/teacher/submissions/{world['submission_ids'][0]}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    # A row the backfill hasn't moved: served as a data: URL.
    assert [f["url"] for f in r.json()["files"]] == [f"data:image/jpeg;base64,{_FILES[0]['data']}"]
