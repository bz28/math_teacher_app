"""Engagement signal on the integrity chat.

The agent labels each student reply (`label_student_reply`); the server
stores the label, turns NUDGE_NOT_TRYING_STREAK not_trying replies in a row
into `nudge_own_words` on the student state, and DISENGAGED_NOT_TRYING_STREAK
in a row into `didnt_engage` on the teacher detail. Scripted agent — no AI.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.core.integrity_pipeline import (
    longest_not_trying_streak,
    trailing_not_trying_streak,
)
from api.database import get_session_factory
from api.models.integrity_check import (
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from tests.conftest import (
    auth_headers as _auth,
)
from tests.conftest import (
    get_agent_call_log,
    make_text,
    make_tool_use,
    set_agent_script,
)
from tests.test_integrity_check import _post_turn, _submit


def _reply(text: str, engagement: Any, use_id: str = "lbl") -> list[Any]:
    return [
        make_text(text),
        make_tool_use("label_student_reply", {"engagement": engagement}, use_id=use_id),
    ]


async def _engagements(submission_id: str) -> list[str | None]:
    async with get_session_factory()() as s:
        check = (await s.execute(
            select(IntegrityCheckSubmission)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        rows = (await s.execute(
            select(IntegrityConversationTurn.engagement)
            .where(
                IntegrityConversationTurn.integrity_check_submission_id == check.id,
                IntegrityConversationTurn.role == "student",
            )
            .order_by(IntegrityConversationTurn.ordinal)
        )).scalars().all()
    return list(rows)


async def _start(client: AsyncClient, world: dict[str, Any]) -> str:
    set_agent_script([[make_text("Opener")]])
    r = await _submit(client, world)
    return str(r.json()["submission_id"])


def test_streak_helpers() -> None:
    nt, a = "not_trying", "answering"
    assert trailing_not_trying_streak([]) == 0
    assert trailing_not_trying_streak([nt, a, nt, nt]) == 2
    # NULL (unlabelled) breaks the streak — a model miss never nags.
    assert trailing_not_trying_streak([nt, None, nt]) == 1
    assert longest_not_trying_streak([nt, nt, nt, a, nt]) == 3
    assert longest_not_trying_streak([nt, None, nt, "honest_confusion"]) == 1


async def test_label_is_stored_without_an_extra_agent_call(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Text + label in one response completes the turn: one model call,
    label stored on the student's row, student never sees the tool."""
    submission_id = await _start(client, world)
    calls_before = len(get_agent_call_log())

    set_agent_script([_reply("Nice — why subtract 3 first?", "answering")])
    r = await _post_turn(client, world, submission_id, {"message": "I subtracted 3 from both sides"})
    assert r.status_code == 200, r.text
    assert len(get_agent_call_log()) - calls_before == 1
    assert await _engagements(submission_id) == ["answering"]
    body = r.json()
    assert body["nudge_own_words"] is False
    assert [t["content"] for t in body["transcript"]][-1] == "Nice — why subtract 3 first?"


async def test_invalid_or_missing_label_stays_null(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _start(client, world)
    set_agent_script([_reply("Okay.", "lazy")])
    r = await _post_turn(client, world, submission_id, {"message": "whatever it's just math"})
    assert r.status_code == 200, r.text
    set_agent_script([[make_text("Tell me more.")]])  # no label at all
    r = await _post_turn(client, world, submission_id, {"message": "idk honestly"})
    assert r.status_code == 200, r.text
    assert await _engagements(submission_id) == [None, None]
    assert r.json()["nudge_own_words"] is False


async def test_label_without_text_keeps_looping_for_the_reply(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _start(client, world)
    set_agent_script([
        [make_tool_use("label_student_reply", {"engagement": "honest_confusion"})],
        [make_text("Good question — slope is how steep the line is.")],
    ])
    r = await _post_turn(client, world, submission_id, {"message": "what does slope mean here?"})
    assert r.status_code == 200, r.text
    assert r.json()["transcript"][-1]["content"].startswith("Good question")
    assert await _engagements(submission_id) == ["honest_confusion"]


async def test_two_not_trying_in_a_row_nudges_and_a_real_answer_clears_it(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _start(client, world)

    set_agent_script([_reply("No worries — what's the first step?", "not_trying")])
    r = await _post_turn(client, world, submission_id, {"message": "idk lol"})
    assert r.json()["nudge_own_words"] is False

    set_agent_script([_reply("Try just the first move.", "not_trying")])
    r = await _post_turn(client, world, submission_id, {"message": "dunno really"})
    assert r.json()["nudge_own_words"] is True
    # Resume shows the same state.
    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["nudge_own_words"] is True

    # Honest confusion is welcome and resets the streak.
    set_agent_script([_reply("Great question.", "honest_confusion")])
    r = await _post_turn(client, world, submission_id, {"message": "what does isolate mean?"})
    assert r.json()["nudge_own_words"] is False


async def test_three_not_trying_tells_the_teacher_without_flagging(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _start(client, world)
    for i, msg in enumerate(("idk", "idk lol", "whatever")):
        set_agent_script([_reply("Let's try one step.", "not_trying", use_id=f"l{i}")])
        r = await _post_turn(client, world, submission_id, {"message": msg + " man"})
        assert r.status_code == 200, r.text

    r = await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["didnt_engage"] is True
    # Scrutiny only: no disposition was set by the signal.
    assert body["disposition"] is None
    # The label tool never leaks into the student view.
    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )
    roles = {t["role"] for t in r.json()["transcript"]}
    assert roles <= {"agent", "student"}


async def test_only_the_first_label_per_reply_counts(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    submission_id = await _start(client, world)
    set_agent_script([
        [
            make_tool_use("label_student_reply", {"engagement": "answering"}, use_id="a"),
        ],
        _reply("Nice.", "not_trying", use_id="b"),
    ])
    r = await _post_turn(client, world, submission_id, {"message": "I divided by 2"})
    assert r.status_code == 200, r.text
    assert await _engagements(submission_id) == ["answering"]
