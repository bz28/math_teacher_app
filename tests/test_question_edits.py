"""Recording teacher edits to generated questions.

A generated question a teacher had to rewrite is the clearest signal
that the GENERATION PROMPT is wrong — one teacher fixing one question is
taste, four fixing the same shape is a defect we can fix at source.

Nothing recorded that before. `question_bank_items` carries only a
one-level undo, so a second edit erased the first and "edited four
times" was unanswerable.

These pin the two things that make the signal trustworthy: an edit is
recorded with both halves, and a change that says nothing about the
prompt (a title typo) is NOT recorded — noise would dilute exactly the
analysis this exists to support.
"""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.question_edit import (
    EDIT_MANUAL,
    FIELD_FINAL_ANSWER,
    FIELD_QUESTION,
    FIELD_SOLUTION,
    REJECT,
    QuestionEdit,
)
from tests.conftest import auth_headers as _auth

pytestmark = pytest.mark.asyncio


async def _own_course(world: dict[str, Any]) -> None:
    """Link the fixture teacher to the course.

    The shared `world` fixture doesn't create a CourseTeacher row, and
    every per-item bank endpoint authorizes through `get_bank_item` →
    `get_teacher_course`. Adding it here rather than in the fixture:
    a dozen other test modules depend on `world`, and widening its
    permissions to suit this file could quietly weaken an authorization
    assertion somewhere else.
    """
    from api.models.course import Course, CourseTeacher
    from api.models.question_bank import QuestionBankItem

    async with get_session_factory()() as s:
        course_id = (await s.execute(
            select(QuestionBankItem.course_id).where(
                QuestionBankItem.id == uuid.UUID(str(world["primary_id"])),
            )
        )).scalar_one()
        exists = (await s.execute(
            select(CourseTeacher).where(
                CourseTeacher.course_id == course_id,
                CourseTeacher.teacher_id == world["teacher_id"],
            )
        )).scalar_one_or_none()
        if exists is None:
            s.add(CourseTeacher(
                course_id=course_id, teacher_id=world["teacher_id"],
            ))
        course = (await s.execute(
            select(Course).where(Course.id == course_id)
        )).scalar_one()
        if getattr(course, "teacher_id", None) is None:
            course.teacher_id = world["teacher_id"]
        await s.commit()


async def _edits(item_id: uuid.UUID) -> list[QuestionEdit]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(QuestionEdit)
            .where(QuestionEdit.bank_item_id == item_id)
            # Explicit: the ordering assertions below were reading
            # physical row order, which Postgres never promises.
            .order_by(QuestionEdit.created_at.asc())
        )).scalars().all())


async def _patch(
    client: AsyncClient, token: str, item_id: Any, **body: Any,
) -> Any:
    return await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        headers=_auth(token), json=body,
    )


async def test_rewriting_a_question_is_recorded_with_both_halves(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(
        client, world["teacher_token"], item_id,
        question="Solve 3x + 7 = 22 and show every step.",
    )
    assert r.status_code == 200, r.text

    edits = await _edits(uuid.UUID(str(item_id)))
    assert len(edits) == 1
    e = edits[0]
    assert e.kind == EDIT_MANUAL
    # Both halves — the diff is the payload that tells you the prompt is
    # wrong. A count alone would be pretty and useless.
    assert e.after == "Solve 3x + 7 = 22 and show every step."
    assert e.before is not None
    assert e.before != e.after
    # Attribution is what makes the admin filters (by teacher, by
    # school) work at all.
    assert e.edited_by_id is not None


async def test_every_rewrite_is_recorded_not_just_the_last(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """The whole reason this table exists. `previous_question` is a
    ONE-LEVEL undo, so before this the second edit erased the first and
    "edited three times" could not be answered."""
    await _own_course(world)
    item_id = world["primary_id"]
    for text in ("First rewrite.", "Second rewrite.", "Third rewrite."):
        r = await _patch(client, world["teacher_token"], item_id, question=text)
        assert r.status_code == 200, r.text

    edits = await _edits(uuid.UUID(str(item_id)))
    assert len(edits) == 3
    assert [e.after for e in edits] == [
        "First rewrite.", "Second rewrite.", "Third rewrite.",
    ]
    # Each row's `before` is the previous row's `after` — a real chain,
    # not three snapshots of the same undo slot.
    assert edits[1].before == "First rewrite."
    assert edits[2].before == "Second rewrite."


async def test_a_title_only_edit_is_not_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A teacher fixing a typo in the title says nothing about the
    generation prompt. Counting it would dilute the signal."""
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(
        client, world["teacher_token"], item_id, title="Tidier label",
    )
    assert r.status_code == 200, r.text
    assert await _edits(uuid.UUID(str(item_id))) == []


async def test_resaving_identical_question_text_is_not_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A no-op save is not an edit. Without this, any client that PATCHes
    the whole form on every keystroke-blur would manufacture a stream of
    phantom 'edits' and make a fine question look broken."""
    await _own_course(world)
    item_id = world["primary_id"]
    async with get_session_factory()() as s:
        from api.models.question_bank import QuestionBankItem
        current = (await s.execute(
            select(QuestionBankItem.question).where(
                QuestionBankItem.id == uuid.UUID(str(item_id)),
            )
        )).scalar_one()

    r = await _patch(client, world["teacher_token"], item_id, question=current)
    assert r.status_code == 200, r.text
    assert await _edits(uuid.UUID(str(item_id))) == []


# ── Field attribution ────────────────────────────────────────────────
#
# A bank item is the output of TWO LLM calls: `generate_questions` writes
# the prose, `generate_solutions` (via `decompose`) works the answer. The
# original recorder compared only `previous_question` to `question` and
# returned early when they matched, so a teacher fixing ONLY the solution
# recorded nothing at all — even though `snapshot_history` had saved the
# before-value one line earlier. The evidence was collected, then dropped.
#
# These pin that a row now names the call it indicts.


async def test_a_solution_only_edit_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """The defect this whole change exists for. Fixing the worked answer
    says the SOLVE prompt is wrong, and it used to leave no trace at all
    because the question text was untouched."""
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(
        client, world["teacher_token"], item_id,
        solution_steps=[
            {"title": "Isolate x", "description": "Subtract 7 from both sides."},
        ],
    )
    assert r.status_code == 200, r.text

    edits = await _edits(uuid.UUID(str(item_id)))
    assert len(edits) == 1
    assert edits[0].field == FIELD_SOLUTION
    assert edits[0].kind == EDIT_MANUAL
    # The diff is the payload — a count tells you WHICH solution to look
    # at, only the before/after tells you what the prompt got wrong.
    assert "Subtract 7 from both sides." in (edits[0].after or "")


async def test_a_final_answer_only_edit_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(
        client, world["teacher_token"], item_id, final_answer="x = 5",
    )
    assert r.status_code == 200, r.text

    edits = await _edits(uuid.UUID(str(item_id)))
    assert len(edits) == 1
    assert edits[0].field == FIELD_FINAL_ANSWER
    assert edits[0].after == "x = 5"


async def test_one_patch_touching_both_records_a_row_each(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """Two prompts are implicated, so two rows. Collapsing them would
    make a solve defect indistinguishable from a question defect — the
    exact confusion the `field` column exists to prevent."""
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(
        client, world["teacher_token"], item_id,
        question="Solve 2x = 10.",
        final_answer="x = 5",
    )
    assert r.status_code == 200, r.text

    edits = await _edits(uuid.UUID(str(item_id)))
    assert {e.field for e in edits} == {FIELD_QUESTION, FIELD_FINAL_ANSWER}


async def test_a_whitespace_only_final_answer_resave_is_not_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """`final_answer` is stripped on write like `question`. Unstripped, a
    re-save differing only in trailing whitespace would count as a repair
    and inflate the quality signal."""
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(client, world["teacher_token"], item_id, final_answer="x = 9")
    assert r.status_code == 200, r.text
    assert len(await _edits(uuid.UUID(str(item_id)))) == 1

    r = await _patch(
        client, world["teacher_token"], item_id, final_answer="  x = 9  ",
    )
    assert r.status_code == 200, r.text
    # Still one — the whitespace re-save added nothing.
    assert len(await _edits(uuid.UUID(str(item_id)))) == 1


async def test_rejecting_twice_records_one_rejection(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """Reject is idempotent, so its signal must be too — a double-click
    should not make one binned question look like two."""
    await _own_course(world)
    item_id = world["primary_id"]
    for _ in range(2):
        r = await client.post(
            f"/v1/teacher/question-bank/{item_id}/reject",
            headers=_auth(world["teacher_token"]),
        )
        assert r.status_code == 200, r.text

    edits = await _edits(uuid.UUID(str(item_id)))
    assert [e.kind for e in edits] == [REJECT]


async def test_rejecting_a_question_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A teacher binning the output outright is the STRONGEST evidence
    the prompt is wrong — nothing about it was worth keeping. It used to
    write only an activity-log line, which the quality report cannot
    read, so the purest signal in the product was invisible."""
    await _own_course(world)
    item_id = world["primary_id"]
    r = await client.post(
        f"/v1/teacher/question-bank/{item_id}/reject",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    edits = await _edits(uuid.UUID(str(item_id)))
    assert len(edits) == 1
    assert edits[0].kind == REJECT
    assert edits[0].field == FIELD_QUESTION
    # What was thrown out is kept; nothing replaced it.
    assert edits[0].before is not None
    assert edits[0].after is None
