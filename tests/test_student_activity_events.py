"""Student lifecycle milestones reach the activity log.

The gap these close: the log recorded teacher and admin writes only, so
a homework's timeline jumped from "teacher published" straight to
"teacher graded" and the work itself — submitted, corrected, practised,
asked about — left no trace on the stream the dashboard reads.

Two of these tests guard failures that produce NO error and so would
rot silently:

- `school_id` on a student row. `users.school_id` is a teachers-only
  column, so the default lookup in `record_activity` returns NULL for a
  student. Every assertion here pins a REAL school onto the world's
  course first, because the shared fixture leaves `Course.school_id`
  null — without that, "assert school_id is not None" would be checking
  None against None and passing for the wrong reason.
- Preview exclusion. "Preview as student" mints a real student account,
  so its events are shaped exactly like a child's and would inflate
  every engagement number with nothing to distinguish them.

The metadata contract is asserted directly rather than by inspection:
this table is a compliance surface, and a future call site that starts
attaching an answer string is the failure worth catching automatically.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token
from api.database import get_session_factory
from tests.conftest import TINY_PNG

# Every id/count key the student call sites are allowed to write. A key
# outside this set is either student content or something nobody vetted
# against the "ids / counts / titles" contract on activity_log.
_SCHOOL_NAME = "Activity Test School"

_ALLOWED_META_KEYS = {
    "is_preview", "assignment_id", "section_id", "file_count", "is_late",
    "submission_id", "corrections_count", "bank_item_id", "mode",
    "consumption_id", "context", "flagged", "anchor_bank_item_id",
    "step_index", "turn_index",
}


@pytest.fixture(autouse=True)
def _mock_tutor_llm() -> Any:
    """Stub the tutor's Claude call for the chat endpoints.

    Without this the tutor test issues a REAL, billed Claude request:
    it passed locally only because a valid CLAUDE_API_KEY sits in .env,
    and failed in CI with a 401 → 500. Mirrors the fixture in
    tests/test_school_student_learn_chat.py.
    """
    with patch(
        "api.core.tutor.call_claude_json",
        new_callable=AsyncMock,
        return_value={"feedback": "Sure — let me explain."},
    ):
        yield


@pytest.fixture(autouse=True)
async def _clean_schools() -> Any:
    """Remove the schools this module creates, before and after each test.

    `_truncate_world_tables` does NOT include `schools` — nothing
    references it in the truncate set, so school rows survive every test
    and accumulate across runs. That is a pre-existing leak (77 rows had
    piled up locally), and past some threshold it starts 500ing
    /auth/register in UNRELATED files. Left uncleaned, this module's
    per-test school would keep feeding it.
    """
    await _drop_test_schools()
    yield
    await _drop_test_schools()


async def _drop_test_schools() -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text("DELETE FROM schools WHERE name = :n"), {"n": _SCHOOL_NAME},
        )
        await s.commit()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _admin_token() -> str:
    """Mint a platform admin. There's no shared fixture for one, and the
    admin endpoints under test are all behind require_admin."""
    from api.core.auth import hash_password
    from api.models.user import User

    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="A",
        )
        s.add(admin)
        await s.flush()
        admin_id = admin.id
        await s.commit()
    return create_access_token(str(admin_id), "admin")


async def _attach_school(world: dict[str, Any]) -> uuid.UUID:
    """Give the world's course a real school and return its id.

    The shared fixture builds a school-less course, which would make
    every school_id assertion in this file vacuous.
    """
    from api.models.school import SCHOOL_KIND_INDIVIDUAL, School

    async with get_session_factory()() as s:
        # Built through the ORM so the model's column defaults (is_active
        # and friends) apply — a raw INSERT has to restate them all.
        school = School(
            name=_SCHOOL_NAME, kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="T", contact_email="t@t.com",
        )
        s.add(school)
        await s.flush()
        school_id = school.id
        await s.execute(
            text(
                "UPDATE courses SET school_id = :sid WHERE id = "
                "(SELECT course_id FROM assignments WHERE id = :aid)"
            ),
            {"sid": school_id, "aid": world["assignment_id"]},
        )
        await s.commit()
    return school_id


async def _rows(action: str | None = None) -> list[dict[str, Any]]:
    """Activity rows written by a student, oldest first."""
    sql = (
        "SELECT action, actor_role, school_id, target_id, action_metadata "
        "FROM activity_log WHERE actor_role = 'student'"
    )
    params: dict[str, Any] = {}
    if action is not None:
        sql += " AND action = :action"
        params["action"] = action
    sql += " ORDER BY performed_at"
    async with get_session_factory()() as s:
        return [dict(r) for r in (await s.execute(text(sql), params)).mappings()]


async def _submit(client: AsyncClient, world: dict[str, Any]) -> str:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"files": [TINY_PNG]},
    )
    assert r.status_code == 200, r.text
    return str(r.json()["submission_id"])


async def _mark_extracted(submission_id: str) -> None:
    """Put a submission into the state confirm/flag require."""
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE submissions SET extraction = :e WHERE id = :id"),
            {"e": '{"steps": [], "final_answers": {}}', "id": submission_id},
        )
        await s.commit()


def _assert_meta_contract(meta: dict[str, Any] | None) -> None:
    """No student content, no unvetted keys, nothing long enough to be prose."""
    assert meta is not None
    unknown = set(meta) - _ALLOWED_META_KEYS
    assert not unknown, f"unvetted metadata keys (student content?): {sorted(unknown)}"
    for key, value in meta.items():
        if isinstance(value, str):
            # Every legitimate string here is a UUID or a short enum code.
            assert len(value) <= 64, f"{key} looks like prose, not an id: {value[:80]!r}"


@pytest.mark.asyncio
async def test_submission_create_is_logged_with_a_resolved_school(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The Problem-1 guard. A student's users.school_id is NULL, so this
    row's school must come from the course — if the override regresses,
    the event still writes but disappears from every school-scoped
    dashboard query with no error anywhere."""
    school_id = await _attach_school(world)
    submission_id = await _submit(client, world)

    rows = await _rows("submission.create")
    assert len(rows) == 1
    row = rows[0]
    assert row["actor_role"] == "student"
    assert row["school_id"] is not None, "student event lost its school"
    assert row["school_id"] == school_id
    assert str(row["target_id"]) == submission_id
    assert row["action_metadata"]["file_count"] == 1
    assert row["action_metadata"]["is_late"] is False
    _assert_meta_contract(row["action_metadata"])


@pytest.mark.asyncio
async def test_confirm_extraction_logs_only_the_correction_count(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Student corrections are free text — the count is loggable, the
    text is not."""
    school_id = await _attach_school(world)
    submission_id = await _submit(client, world)
    await _mark_extracted(submission_id)

    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/confirm-extraction",
        headers=_auth(world["student_token"]),
        json={},
    )
    assert r.status_code == 200, r.text

    rows = await _rows("submission.confirm_extraction")
    assert len(rows) == 1
    assert rows[0]["school_id"] == school_id
    assert rows[0]["action_metadata"]["corrections_count"] == 0
    _assert_meta_contract(rows[0]["action_metadata"])


@pytest.mark.asyncio
async def test_flag_extraction_is_logged(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    school_id = await _attach_school(world)
    submission_id = await _submit(client, world)
    await _mark_extracted(submission_id)

    r = await client.post(
        f"/v1/school/student/submissions/{submission_id}/flag-extraction",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text

    rows = await _rows("submission.flag_extraction")
    assert len(rows) == 1
    assert rows[0]["school_id"] == school_id
    _assert_meta_contract(rows[0]["action_metadata"])


@pytest.mark.asyncio
async def test_next_variation_and_consumption_events_are_logged(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Serve → complete → flag, the practice loop's three milestones."""
    school_id = await _attach_school(world)

    served = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}"
        f"/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert served.status_code == 200, served.text
    consumption_id = served.json()["consumption_id"]

    done = await client.post(
        f"/v1/school/student/bank-consumption/{consumption_id}/complete",
        headers=_auth(world["student_token"]),
    )
    assert done.status_code == 204, done.text

    flagged = await client.post(
        f"/v1/school/student/bank-consumption/{consumption_id}/flag",
        headers=_auth(world["student_token"]),
        json={"flagged": True},
    )
    assert flagged.status_code == 204, flagged.text

    for action in ("practice.next_variation", "consumption.complete", "consumption.flag"):
        rows = await _rows(action)
        assert len(rows) == 1, f"{action} wrote {len(rows)} rows"
        assert rows[0]["school_id"] == school_id, f"{action} lost its school"
        _assert_meta_contract(rows[0]["action_metadata"])

    assert (await _rows("consumption.flag"))[0]["action_metadata"]["flagged"] is True


@pytest.mark.asyncio
async def test_complete_is_logged_once_despite_idempotent_recall(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The endpoint is idempotent; a repeated call must not log a second
    completion or every engagement count inflates on a double-tap."""
    await _attach_school(world)
    served = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}"
        f"/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    consumption_id = served.json()["consumption_id"]

    for _ in range(3):
        r = await client.post(
            f"/v1/school/student/bank-consumption/{consumption_id}/complete",
            headers=_auth(world["student_token"]),
        )
        assert r.status_code == 204

    assert len(await _rows("consumption.complete")) == 1


@pytest.mark.asyncio
async def test_tutor_chat_logs_depth_without_any_content(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The whole point of the tutor rows: chat is stateless and stored
    nowhere else, so this is the only structured record that a student
    asked for help. It must capture HOW MUCH they asked and none of
    what they said."""
    school_id = await _attach_school(world)
    # Owning a consumption row authorizes chat on that bank item.
    served = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}"
        f"/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    bank_item_id = served.json()["variation"]["bank_item_id"]

    secret = "my working is 3x + 7 and I got 12 which feels wrong"
    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/problem-chat",
        headers=_auth(world["student_token"]),
        json={
            "question": secret,
            "prior_messages": [
                {"role": "user", "content": secret},
                {"role": "assistant", "content": "reply"},
            ],
        },
    )
    assert r.status_code == 200, r.text

    rows = await _rows("tutor.problem_chat")
    assert len(rows) == 1
    meta = rows[0]["action_metadata"]
    assert rows[0]["school_id"] == school_id
    assert meta["turn_index"] == 2, "depth of questioning is the signal"
    _assert_meta_contract(meta)
    assert secret not in str(meta), "student's words must never reach this table"


@pytest.mark.asyncio
async def test_preview_student_events_are_flagged_and_excluded_by_default(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A teacher rehearsing their own homework must not read as student
    engagement — but the row is kept, because the rehearsal is itself
    signal."""
    school_id = await _attach_school(world)
    admin_token = await _admin_token()
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE users SET is_preview = true WHERE id = :id"),
            {"id": world["student_id"]},
        )
        await s.commit()

    await _submit(client, world)

    rows = await _rows("submission.create")
    assert len(rows) == 1
    assert rows[0]["action_metadata"]["is_preview"] is True

    default = await client.get(
        f"/v1/admin/activity?school_id={school_id}", headers=_auth(admin_token)
    )
    assert default.status_code == 200, default.text
    assert not [
        e for e in default.json()["entries"] if e["action"] == "submission.create"
    ], "preview event leaked into the default view"

    opted_in = await client.get(
        f"/v1/admin/activity?school_id={school_id}&include_preview=true",
        headers=_auth(admin_token),
    )
    assert opted_in.status_code == 200
    assert [
        e for e in opted_in.json()["entries"] if e["action"] == "submission.create"
    ], "include_preview must return the row it excludes by default"


@pytest.mark.asyncio
async def test_school_filter_returns_real_student_events(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """End-to-end on the filter that Problem 1 would have broken: a
    non-preview student event must survive a school-scoped query."""
    school_id = await _attach_school(world)
    admin_token = await _admin_token()
    await _submit(client, world)

    r = await client.get(
        f"/v1/admin/activity?school_id={school_id}", headers=_auth(admin_token)
    )
    assert r.status_code == 200, r.text
    actions = [e["action"] for e in r.json()["entries"]]
    assert "submission.create" in actions

    role_scoped = await client.get(
        f"/v1/admin/activity?school_id={school_id}&actor_role=student",
        headers=_auth(admin_token),
    )
    assert role_scoped.status_code == 200
    assert [e["action"] for e in role_scoped.json()["entries"]] == ["submission.create"]


@pytest.mark.asyncio
async def test_a_logging_failure_never_breaks_the_submission(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The contract the whole helper rests on: best-effort. A student
    turning in homework must not 500 because an audit row failed."""
    await _attach_school(world)
    with patch(
        "api.core.audit_log.ActivityLog", side_effect=RuntimeError("boom"),
    ):
        r = await client.post(
            f"/v1/school/student/homework/{world['assignment_id']}/submit",
            headers=_auth(world["student_token"]),
            json={"files": [TINY_PNG]},
        )
    assert r.status_code == 200, "logging failure took the submission down"
    assert await _rows("submission.create") == []

    async with get_session_factory()() as s:
        count = (await s.execute(
            text("SELECT count(*) FROM submissions WHERE assignment_id = :a"),
            {"a": world["assignment_id"]},
        )).scalar_one()
    assert count == 1, "the submission itself must still be durable"


@pytest.mark.asyncio
async def test_learn_start_is_logged(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    school_id = await _attach_school(world)
    served = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}"
        f"/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    bank_item_id = served.json()["variation"]["bank_item_id"]

    r = await client.post(
        "/v1/school/student/bank-consumption/learn-this",
        headers=_auth(world["student_token"]),
        json={
            "bank_item_id": bank_item_id,
            "assignment_id": str(world["assignment_id"]),
        },
    )
    assert r.status_code == 200, r.text

    rows = await _rows("practice.learn_start")
    assert len(rows) == 1
    assert rows[0]["school_id"] == school_id
    _assert_meta_contract(rows[0]["action_metadata"])

