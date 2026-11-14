"""Deleting submissions deletes their photos.

The rows cascade (from a user, course, section or assignment) but the
bucket objects don't, so every path that deletes submissions collects
their pages first and removes them only after the delete commits
(`photo_store.pages_of_submissions` / `pages_of_user` + `delete_pages`).
A student's deletion request has to remove their photos, not only their
rows. Run on `LocalBackend`, where a page is a file under `root`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import photo_store
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import CourseTeacher
from api.models.user import User
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import PAGE_PNG


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def local(tmp_path: Path) -> Iterator[Path]:
    photo_store.set_backend(photo_store.LocalBackend(root=tmp_path, base_url="http://test", secret="s"))
    try:
        yield tmp_path
    finally:
        photo_store.set_backend(None)


def _pages_on_disk(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}


async def _turn_in_with_a_retake(client: AsyncClient, world: dict[str, Any]) -> set[str]:
    """A turn-in whose first photos a retake replaced: pages in both
    `submissions.files` and `submission_attempts.files`. Returns their keys."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]), json={"files": [PAGE_PNG]},
    )
    assert r.status_code == 200, r.text
    await drain_integrity_background_tasks()
    sid = r.json()["submission_id"]
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/flag-extraction",
        headers=_auth(world["student_token"]), json={},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/retake",
        headers=_auth(world["student_token"]), json={"files": [PAGE_PNG, PAGE_PNG]},
    )
    assert r.status_code == 200, r.text
    await drain_integrity_background_tasks()
    async with get_session_factory()() as s:
        rows = (await s.execute(text(
            "SELECT files FROM submissions WHERE id = :id "
            "UNION ALL SELECT files FROM submission_attempts WHERE submission_id = :id"
        ), {"id": sid})).scalars().all()
    keys = {f["key"] for files in rows for f in files}
    assert len(keys) == 3
    return keys


async def _unrelated_page() -> str:
    """A page of some other submission, which no delete here may touch."""
    [entry] = await photo_store.store_pages(uuid.uuid4(), [{"data": PAGE_PNG, "media_type": "image/png"}])
    return str(entry["key"])


async def _course_and_section(world: dict[str, Any]) -> tuple[uuid.UUID, uuid.UUID]:
    """The world's course (with its teacher put on it, which the teacher
    course routes require) and section."""
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            select(Assignment.course_id).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        section_id = (await s.execute(
            select(AssignmentSection.section_id).where(AssignmentSection.assignment_id == world["assignment_id"])
        )).scalar_one()
        s.add(CourseTeacher(course_id=course_id, teacher_id=world["teacher_id"]))
        await s.commit()
    return course_id, section_id


async def _submissions_left(world: dict[str, Any]) -> int:
    async with get_session_factory()() as s:
        return len((await s.execute(
            select(Submission.id).where(Submission.assignment_id == world["assignment_id"])
        )).all())


async def test_deleting_a_student_account_deletes_their_photos(
    client: AsyncClient, world: dict[str, Any], local: Path,
) -> None:
    keys = await _turn_in_with_a_retake(client, world)
    other = await _unrelated_page()
    assert _pages_on_disk(local) == keys | {other}

    r = await client.request(
        "DELETE", "/v1/auth/account", headers=_auth(world["student_token"]), json={"password": "x"},
    )
    assert r.status_code == 204, r.text
    assert await _submissions_left(world) == 0
    assert _pages_on_disk(local) == {other}


async def test_deleting_a_course_deletes_its_photos(
    client: AsyncClient, world: dict[str, Any], local: Path,
) -> None:
    await _turn_in_with_a_retake(client, world)
    other = await _unrelated_page()
    course_id, _ = await _course_and_section(world)

    r = await client.delete(f"/v1/teacher/courses/{course_id}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    assert await _submissions_left(world) == 0
    assert _pages_on_disk(local) == {other}


async def test_deleting_a_section_deletes_its_photos(
    client: AsyncClient, world: dict[str, Any], local: Path,
) -> None:
    await _turn_in_with_a_retake(client, world)
    other = await _unrelated_page()
    course_id, section_id = await _course_and_section(world)

    r = await client.delete(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}", headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    assert await _submissions_left(world) == 0
    assert _pages_on_disk(local) == {other}


async def test_deleting_an_assignment_deletes_its_photos(
    client: AsyncClient, world: dict[str, Any], local: Path,
) -> None:
    await _turn_in_with_a_retake(client, world)
    other = await _unrelated_page()
    # Only an unpublished assignment can be deleted.
    async with get_session_factory()() as s:
        await s.execute(update(Assignment).where(Assignment.id == world["assignment_id"]).values(status="draft"))
        await s.commit()

    r = await client.delete(f"/v1/teacher/assignments/{world['assignment_id']}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    assert await _submissions_left(world) == 0
    assert _pages_on_disk(local) == {other}


async def test_a_delete_that_rolls_back_keeps_the_photos(
    client: AsyncClient, world: dict[str, Any], local: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    keys = await _turn_in_with_a_retake(client, world)
    course_id, _ = await _course_and_section(world)

    async def failing_commit(self: AsyncSession) -> None:
        raise RuntimeError("database went away mid-commit")

    monkeypatch.setattr(AsyncSession, "commit", failing_commit)
    r = await client.delete(f"/v1/teacher/courses/{course_id}", headers=_auth(world["teacher_token"]))
    monkeypatch.undo()
    assert r.status_code == 500

    assert await _submissions_left(world) == 1
    assert _pages_on_disk(local) == keys


async def test_a_teachers_pages_include_their_homework_and_their_preview_students(
    client: AsyncClient, world: dict[str, Any], local: Path,
) -> None:
    """Deleting a teacher cascades to the turn-ins on homework they own
    (assignments.teacher_id) and to their preview student's
    (users.preview_owner_id), so `pages_of_user` collects all of them."""
    keys = await _turn_in_with_a_retake(client, world)
    async with get_session_factory()() as s:
        mine = {p["key"] for p in await photo_store.pages_of_user(s, world["teacher_id"])}
        assert mine == keys
        # Re-home the turn-in onto a preview student of a different
        # teacher: now only that teacher's deletion reaches it.
        other_teacher = User(email=f"t_{uuid.uuid4().hex[:8]}@t.com", password_hash="x", role="teacher", grade_level=12)
        s.add(other_teacher)
        await s.flush()
        preview = User(
            email=f"p_{uuid.uuid4().hex[:8]}@t.com", password_hash="x", role="student", grade_level=8,
            is_preview=True, preview_owner_id=other_teacher.id,
        )
        s.add(preview)
        await s.flush()
        await s.execute(
            update(Submission).where(Submission.assignment_id == world["assignment_id"]).values(student_id=preview.id)
        )
        theirs = {p["key"] for p in await photo_store.pages_of_user(s, other_teacher.id)}
        await s.rollback()
    assert theirs == keys


async def test_replacing_a_preview_rehearsal_deletes_its_photos(client: AsyncClient, local: Path) -> None:
    from tests.test_teacher_preview import _preview_headers, _teacher_with_homework, _wipe

    await _wipe()
    world = await _teacher_with_homework(client, sections="both", status="published")
    headers = await _preview_headers(client, world)
    url = f"/v1/school/student/homework/{world['assignment_id']}/submit"

    first = await client.post(url, headers=headers, json={"files": [PAGE_PNG]})
    assert first.status_code == 200, first.text
    [old] = _pages_on_disk(local)
    second = await client.post(url, headers=headers, json={"files": [PAGE_PNG]})
    assert second.status_code == 200, second.text
    await drain_integrity_background_tasks()

    [new] = _pages_on_disk(local)
    assert new != old and new.startswith(f"submissions/{second.json()['submission_id']}/")


async def test_inline_pages_need_no_delete(local: Path) -> None:
    await photo_store.delete_pages([{"data": PAGE_PNG, "media_type": "image/png"}])  # nothing to remove, no error


async def test_a_page_that_wont_delete_is_logged_not_raised(
    local: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    store = photo_store.backend()

    def broken_delete(key: str) -> None:
        raise ConnectionError("bucket unreachable")

    monkeypatch.setattr(store, "delete", broken_delete)
    await photo_store.delete_pages([{"key": "submissions/x/a.png"}, {"key": "submissions/x/b.png"}])
    assert sum("couldn't delete photo object" in r.message for r in caplog.records) == 2
