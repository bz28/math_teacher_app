"""Admin: which generated questions teachers had to fix.

The page answers "is our generation prompt wrong?", and the evidence is
teachers rewriting what it produced. These pin the two things that make
it trustworthy rather than merely pretty:

1. **Ranking.** Most-repaired first. Newest-first would make the reader
   do the analysis; the whole point is that the page does it.
2. **Honesty about what isn't known.** `question_edits` only records
   forward — the intermediate states of every pre-existing edit are
   gone. An empty result must be reported alongside when tracking began,
   or a zero reads as "never edited" and asserts the opposite of the
   truth on the one surface built to make quality legible.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import (
    EDIT_MANUAL,
    EDIT_WORKSHOP,
    FIELD_FINAL_ANSWER,
    FIELD_QUESTION,
    FIELD_SOLUTION,
    REGEN_FRESH,
    REJECT,
    TRACKING_SINCE,
    QuestionEdit,
)
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth

pytestmark = pytest.mark.asyncio


async def _seed(edit_plan: list[tuple[str, int]]) -> dict[str, Any]:
    """Seed an admin plus one question per (title, edit_count) pair."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_edits, question_bank_items, units, "
            "courses, schools, sessions, users RESTART IDENTITY CASCADE"
        ))
        admin = User(
            email=f"a_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=99, role="admin", name="A",
        )
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Admin", contact_email="admin@lincoln.edu",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms Rivera",
            school_id=school.id,
        )
        course = Course(name="Algebra", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="U", position=0)
        s.add(unit)
        await s.flush()
        # `originating_assignment_id` is NOT NULL — every bank item
        # belongs to the HW its generation was kicked off from.
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        item_ids: dict[str, uuid.UUID] = {}
        base = datetime.now(UTC) - timedelta(days=1)
        for title, n in edit_plan:
            item = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                title=title, question=f"{title} v0",
                solution_steps=[], final_answer="x",
                status="approved", source="generated",
                generation_prompt="Make 5 quadratics for a mixed-ability class.",
            )
            s.add(item)
            await s.flush()
            item_ids[title] = item.id
            for i in range(n):
                s.add(QuestionEdit(
                    bank_item_id=item.id, edited_by_id=teacher.id,
                    school_id=school.id,
                    kind=EDIT_MANUAL if i % 2 == 0 else EDIT_WORKSHOP,
                    field=FIELD_QUESTION,
                    before=f"{title} v{i}", after=f"{title} v{i + 1}",
                    created_at=base + timedelta(minutes=i),
                ))
        await s.commit()
        return {
            "token": create_access_token(str(admin.id), "admin"),
            "teacher_id": str(teacher.id),
            "school_id": str(school.id),
            "items": {k: str(v) for k, v in item_ids.items()},
        }


async def test_questions_rank_by_how_much_repair_they_needed(
    client: AsyncClient,
) -> None:
    w = await _seed([("Lightly touched", 1), ("Heavily fought", 4), ("Middling", 2)])
    r = await client.get(
        "/v1/admin/generation-quality/questions", headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Most-repaired first. Chronological would make the reader do the
    # analysis; the page is supposed to do it.
    assert [q["title"] for q in body["questions"]] == [
        "Heavily fought", "Middling", "Lightly touched",
    ]
    assert [q["edit_count"] for q in body["questions"]] == [4, 2, 1]
    assert body["total"] == 3


async def test_min_edits_filters_out_the_noise(client: AsyncClient) -> None:
    w = await _seed([("Once", 1), ("Thrice", 3)])
    r = await client.get(
        "/v1/admin/generation-quality/questions?min_edits=2",
        headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    assert [q["title"] for q in r.json()["questions"]] == ["Thrice"]


async def test_an_empty_result_still_says_when_tracking_began(
    client: AsyncClient,
) -> None:
    """The honesty guard. Without `tracking_since`, an empty page reads
    as "no teacher has ever edited a question" — the opposite of the
    truth, on the surface built to make quality legible."""
    w = await _seed([])
    r = await client.get(
        "/v1/admin/generation-quality/questions", headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["questions"] == []
    assert body["total"] == 0
    assert body["tracking_since"], "must report when counting started"


async def test_history_returns_the_diffs_oldest_first(
    client: AsyncClient,
) -> None:
    """A count tells you WHICH question to look at; only the before/after
    tells you what the prompt got wrong."""
    w = await _seed([("Fought", 3)])
    r = await client.get(
        f"/v1/admin/generation-quality/questions/{w['items']['Fought']}",
        headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["edits"]) == 3
    assert [e["after"] for e in body["edits"]] == [
        "Fought v1", "Fought v2", "Fought v3",
    ]
    # The prompt that produced it — the thing you actually change.
    assert "quadratics" in body["generation_prompt"]
    assert body["edits"][0]["editor"] == "Ms Rivera"
    assert body["edits"][0]["school"] == "Lincoln High"


async def test_filters_scope_to_a_school_and_a_kind(client: AsyncClient) -> None:
    w = await _seed([("A", 2)])
    ok = await client.get(
        f"/v1/admin/generation-quality/questions?school_id={w['school_id']}",
        headers=_auth(w["token"]),
    )
    assert ok.status_code == 200
    assert len(ok.json()["questions"]) == 1

    other = await client.get(
        f"/v1/admin/generation-quality/questions?school_id={uuid.uuid4()}",
        headers=_auth(w["token"]),
    )
    assert other.status_code == 200
    assert other.json()["questions"] == []

    chat_only = await client.get(
        f"/v1/admin/generation-quality/questions?kind={EDIT_WORKSHOP}",
        headers=_auth(w["token"]),
    )
    assert chat_only.status_code == 200
    # 2 edits: one manual, one chat — so it survives a chat-only filter
    # but with a lower count.
    assert chat_only.json()["questions"][0]["edit_count"] == 1


async def test_only_question_edits_count_toward_the_repair_ranking(
    client: AsyncClient,
) -> None:
    """The recorder now writes solution repairs, regenerates and rejects
    into the same table. This report must keep counting ONLY question
    edits, or `edit_count` silently changes meaning: one PATCH can emit a
    row per field and a regenerate rewrites all three at once, so a
    single click would outrank four genuine hand-edits against thresholds
    calibrated on one-row-per-edit.

    Widening what this page counts is a deliberate redesign — not a
    side-effect of widening what gets recorded.
    """
    w = await _seed([("A", 1)])
    item_id = uuid.UUID(w["items"]["A"])

    async with get_session_factory()() as s:
        # Same item, same teacher: one solution repair, one regenerate,
        # one rejection. None of them is a question edit.
        for kind, field in (
            (EDIT_MANUAL, FIELD_SOLUTION),
            (EDIT_MANUAL, FIELD_FINAL_ANSWER),
            (REGEN_FRESH, FIELD_QUESTION),
            (REJECT, FIELD_QUESTION),
        ):
            s.add(QuestionEdit(
                bank_item_id=item_id,
                kind=kind, field=field,
                before="before", after="after",
            ))
        await s.commit()

    r = await client.get(
        "/v1/admin/generation-quality/questions",
        headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    q = r.json()["questions"][0]
    # Still 1 — the four extra rows are not question edits by a teacher.
    assert q["edit_count"] == 1

    summary = await client.get(
        "/v1/admin/generation-quality/summary",
        headers=_auth(w["token"]),
    )
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["total_edits"] == 1
    assert body["questions_touched"] == 1
    # The stat tiles read by_kind with the NEW vocabulary. Reading the old
    # keys here would show 0 forever while the data sits one key away.
    assert body["by_kind"] == {EDIT_MANUAL: 1}


async def test_a_teacher_cannot_read_the_admin_console(
    client: AsyncClient,
) -> None:
    w = await _seed([("A", 1)])
    teacher_token = create_access_token(w["teacher_id"], "teacher")
    r = await client.get(
        "/v1/admin/generation-quality/questions", headers=_auth(teacher_token),
    )
    assert r.status_code == 403


# ── The board ────────────────────────────────────────────────────────
#
# The old page could only show bad news: a question appeared ONLY once
# someone edited it, so a perfect question was invisible and "0 repairs"
# had nothing to divide by. These pin the denominator and the rules that
# decide what counts toward it.

BOARD = "/v1/admin/generation-quality/board"


async def _board_world() -> dict[str, Any]:
    """One question per outcome, plus the rows that must NOT count."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_edits, question_bank_items, units, "
            "courses, schools, sessions, users RESTART IDENTITY CASCADE"
        ))
        admin = User(
            email=f"a_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=99, role="admin", name="A",
        )
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Admin", contact_email="admin@lincoln.edu",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms Rivera",
            school_id=school.id,
        )
        course = Course(name="Algebra", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="U", position=0)
        s.add(unit)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        after_tracking = TRACKING_SINCE + timedelta(days=1)

        def _item(**kw: Any) -> QuestionBankItem:
            base: dict[str, Any] = dict(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                question="q", solution_steps=[], final_answer="x",
                source="generated", created_at=after_tracking,
            )
            base.update(kw)
            return QuestionBankItem(**base)

        items = {
            "clean": _item(title="Clean", status="approved"),
            "repaired": _item(title="Repaired", status="approved"),
            "redone": _item(title="Redone", status="approved"),
            "rejected": _item(title="Rejected", status="rejected"),
            # Excluded from the rate — nobody has ruled on it.
            "pending": _item(title="Pending", status="pending"),
            # A teacher's own question says nothing about the prompt.
            "manual": _item(title="Hand written", status="approved",
                            source="manual"),
            # Generated BEFORE edits were recorded: including it would
            # divide a complete denominator by a partial numerator and
            # publish a confident "clean" that means "we weren't watching".
            "ancient": _item(title="Pre-tracking", status="approved",
                             created_at=TRACKING_SINCE - timedelta(days=1)),
        }
        s.add_all(list(items.values()))
        await s.flush()

        def _edit(item: QuestionBankItem, kind: str, field: str) -> QuestionEdit:
            return QuestionEdit(
                bank_item_id=item.id, edited_by_id=teacher.id,
                school_id=school.id, kind=kind, field=field,
                before="b", after="a",
            )

        s.add_all([
            _edit(items["repaired"], EDIT_MANUAL, FIELD_QUESTION),
            _edit(items["redone"], REGEN_FRESH, FIELD_QUESTION),
            _edit(items["rejected"], REJECT, FIELD_QUESTION),
            # A SOLUTION repair on the clean question. It indicts the
            # solve prompt, not the generation prompt, so this board must
            # still call the question clean.
            _edit(items["clean"], EDIT_MANUAL, FIELD_SOLUTION),
        ])
        await s.commit()
        return {
            "token": create_access_token(str(admin.id), "admin"),
            "items": {k: str(v.id) for k, v in items.items()},
        }


async def test_the_board_reports_every_settled_question_not_just_the_edited(
    client: AsyncClient,
) -> None:
    """The defect this replaces: a clean question used to be invisible,
    so the page could only ever show bad news and had no denominator."""
    w = await _board_world()
    r = await client.get(BOARD, headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]

    # clean + repaired + redone + rejected. NOT the pending one, NOT the
    # hand-written one, NOT the pre-tracking one.
    assert summary["settled"] == 4
    assert summary["clean"] == 1
    assert summary["repaired"] == 1
    assert summary["redone"] == 1
    assert summary["rejected"] == 1
    assert summary["awaiting"] == 1
    assert summary["clean_rate"] == 25.0


async def test_a_solution_repair_does_not_make_the_question_dirty(
    client: AsyncClient,
) -> None:
    """The whole reason `field` exists. A teacher fixing the worked
    answer indicts the SOLVE prompt; blaming the generation prompt for it
    would send you to change the wrong thing."""
    w = await _board_world()
    r = await client.get(
        BOARD, params={"outcome": "clean"}, headers=_auth(w["token"]),
    )
    assert r.status_code == 200, r.text
    titles = [q["title"] for q in r.json()["questions"]]
    assert titles == ["Clean"]


async def test_the_denominator_stops_at_tracking_since(
    client: AsyncClient,
) -> None:
    """Status reaches back forever; edits only reach back to
    TRACKING_SINCE. Mixing them publishes a confident 100% that actually
    means 'we were not watching' — the exact misreading the constant
    exists to prevent."""
    w = await _board_world()
    r = await client.get(BOARD, headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    titles = {q["title"] for q in r.json()["questions"]}
    assert "Pre-tracking" not in titles
    assert r.json()["tracking_since"]


async def test_hand_written_questions_are_not_generation_evidence(
    client: AsyncClient,
) -> None:
    w = await _board_world()
    r = await client.get(BOARD, headers=_auth(w["token"]))
    titles = {q["title"] for q in r.json()["questions"]}
    assert "Hand written" not in titles


async def test_worst_outcome_wins_and_the_list_leads_with_it(
    client: AsyncClient,
) -> None:
    """Buckets stay disjoint so they sum to the denominator, and the
    rows worth reading are on top."""
    w = await _board_world()
    r = await client.get(BOARD, headers=_auth(w["token"]))
    outcomes = [q["outcome"] for q in r.json()["questions"]]
    assert outcomes == ["rejected", "redone", "repaired", "clean"]


async def test_an_unknown_outcome_is_rejected_not_ignored(
    client: AsyncClient,
) -> None:
    """Ignoring it returns the UNFILTERED list, which reads as 'no such
    questions exist' — the opposite of the truth."""
    w = await _board_world()
    r = await client.get(
        BOARD, params={"outcome": "nonsense"}, headers=_auth(w["token"]),
    )
    assert r.status_code == 400, r.text


async def test_a_thin_board_says_so(client: AsyncClient) -> None:
    """Four settled questions cannot support a percentage."""
    w = await _board_world()
    r = await client.get(BOARD, headers=_auth(w["token"]))
    assert r.json()["summary"]["thin"] is True
