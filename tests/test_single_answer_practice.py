"""Practice problems ask for exactly one answer.

Prod, 2026-10-29: the published set "Parallel & Perpendicular Lines"
(5e29f355…) had multi-part items whose wrong options answered one part,
so on the student practice page the right answer — the one long
"(a) … (b) …" block among three short values — gave itself away.

Generation tells practice (never homework) to write one answer per
problem, and `has_part_labels` is the backstop that keeps a multi-part
practice item from becoming multiple choice. The label strings below are
the real shapes from prod's 202 bank items (22 of them multi-part).
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from api.core.auth import hash_password
from api.core.part_labels import PRACTICE_SINGLE_ANSWER_RULE, has_part_labels, is_multi_part
from api.core.question_bank_generation import _run_generation, real_newlines, regenerate_one
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit
from api.models.user import User
from api.services.bank import approved_practice_items

_PATH = (
    Path(__file__).resolve().parent.parent
    / "api/alembic/versions/da1000096_single_answer_practice.py"
)
_spec = importlib.util.spec_from_file_location("da1000096", _PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


MULTI_PART = [
    # The two give-aways in the prod set.
    "**(a)** $x = 12$ (both corresponding angles $= 51°$)\n\n**(b)** Corresponding Angles "
    "**Converse** Postulate",
    "**(a)** $m_p = m_q = \\dfrac{1}{2}$ $\\Rightarrow$ **parallel**.\n\n**(b)** **perpendicular**."
    "\n\n**(c)** $y = \\dfrac{1}{2}x - 1$",
    # Labels inside math.
    "$(a)$ **Parallel** — both slopes equal $2$\n\n$(b)$ **Perpendicular**",
    "$(a)\\ \\omega = 48\\pi \\text{ rad/min}$ \\quad $(b)\\ v = 96\\pi \\text{ ft/min}$",
    # Inline in the question.
    "Find (a) the length of the arc and (b) the area of the sector.",
    # a) / a. at line starts.
    "Consider the statement.\n\na) Write the converse.\nb) Write the inverse.",
    "**a) Biconditional:** Two lines…\n\n**b) Two Conditionals:** 1. If…",
    "Classify each angle:\n\na. $47°$\nb. $90°$",
    # Part A / Part (a) / Part 1.
    "**Part 1:** $7 + 11 = 18$\n\n**Part 2:** $x \\in \\{7, 8, 9\\}$",
    "**Part (a) Proof:** By the Segment Addition Postulate…\n\n**Part (b)** …",
    "Part A: find the slope. Part B: write the equation.",
    # Roman numerals.
    "(i) Find the slope.\n(ii) Write the equation.",
    # Upper-case labels.
    "(A) Find x. (B) Find y.",
    # Numbered parts, each opening a line or a sentence.
    "Answer each.\n1. Find the slope.\n2. Find the intercept.",
    "1) Find the slope of $\\ell$.\n2) Write its equation.",
    "(1) Find x.\n(2) Find y.",
    "Solve the system. (1) Find x. (2) Find y.",
    # Glued to the part's first word, at a line start.
    "(a)Find x.(b)Find y.",
    "(a)Find x(b)Find y",
    # A run that starts at a later letter.
    "(c) Find the slope.\n(d) Find the intercept.",
]

SINGLE_ANSWER = [
    "$y = 2x + 3$",
    "$x = 10$",
    # Intervals and ordered pairs.
    "The solution set is $(a, b)$ where $a < b$.",
    "$[0,\\infty)$ and $(-\\infty,0)\\cup(0,\\infty)$",
    "$P = \\left(\\dfrac{13}{5},\\ \\dfrac{19}{5}\\right)$",
    # Function calls on a and b.
    "Compute $f(a) - f(b)$ for $f(x) = x^2$.",
    "If $g(a) = 4$ and $g(b) = 7$, find the slope.",
    "$\\left(a\\right)\\left(b\\right) = ab$",
    # Equation numbers.
    "Subtract (1) from (2) to get $y = 3$.",
    "(1) $2x + y = 5$\n(2) $x - y = 1$\nSolve the system.",
    # A single (a) is a variable, not a part.
    "The constant (a) must be positive.",
    # "part" in prose.
    "Part of the line lies above the axis.",
    "$\\angle A + \\angle B + \\angle C = 180°$",
    # Labels that name or list things mid-sentence.
    "Copper (I) oxide or copper (II) oxide",
    "Which of statements (i) and (ii) are true?",
    "In part 1 of its trip the train goes north; in part 2 it goes east",
    "Pick one: (A) 3 (B) 4",
    "x = (a) + (b)",
    "Are lines (a) and (b) parallel?",
    "",
    None,
]

# A worked answer's numbered lines are its steps, not parts.
ANSWER_STEPS = [
    "**Construction Summary:**\n\n1. Draw transversal $PQ$.\n2. At $Q$: strike an arc.",
    "Two conditionals:\n1. If two lines are perpendicular, they meet at a right angle.\n"
    "2. If two lines meet at a right angle, they are perpendicular.",
]


@pytest.mark.parametrize("text", MULTI_PART)
def test_multi_part_text_has_part_labels(text: str) -> None:
    assert has_part_labels(text)
    assert mig.has_part_labels(text)


@pytest.mark.parametrize("text", SINGLE_ANSWER)
def test_single_answer_text_has_none(text: str | None) -> None:
    assert not has_part_labels(text)
    assert not mig.has_part_labels(text)


@pytest.mark.parametrize("text", ANSWER_STEPS)
def test_numbered_steps_in_an_answer_are_not_parts(text: str) -> None:
    assert not has_part_labels(text, numbered=False)
    assert not mig.has_part_labels(text, numbered=False)
    assert not is_multi_part("Construct the line.", text)
    # The same lines in a question are numbered parts.
    assert has_part_labels(text)


def test_part_n_still_counts_in_an_answer() -> None:
    assert has_part_labels("**Part 1:** $x = 2$\n\n**Part 2:** $y = 3$", numbered=False)


def test_either_side_makes_it_multi_part() -> None:
    assert is_multi_part("Find (a) x and (b) y.", "$x = 2$, $y = 3$")
    assert is_multi_part("Solve.", "**(a)** $x = 2$\n\n**(b)** $y = 3$")
    assert not is_multi_part("Solve $2x = 4$.", "$x = 2$")


@pytest.mark.parametrize(("raw", "want"), [
    # The prod shape: backslash-n pairs between parts.
    ("**(a)** $x = 12$\\n\\n**(b)** Postulate", "**(a)** $x = 12$\n\n**(b)** Postulate"),
    ("using:\\n1. $\\angle ABM = \\angle DCM$\\n2. $BM = MC$",
     "using:\n1. $\\angle ABM = \\angle DCM$\n2. $BM = MC$"),
    ("never intersect.\\n\\n$$\\boxed{\\text{No solution}}$$",
     "never intersect.\n\n$$\\boxed{\\text{No solution}}$$"),
    # Math is left alone: \neq, \nabla, \nu start with backslash-n.
    ("$x \\neq 3$ and $\\nabla f$", "$x \\neq 3$ and $\\nabla f$"),
    ("$$a \\ne b$$\\n\\nso $\\nu = 2$", "$$a \\ne b$$\n\nso $\\nu = 2$"),
    # Outside math, a single one before a letter may be a bare LaTeX
    # command, so it is kept; a run of two or more is always line breaks.
    ("x \\notin A", "x \\notin A"),
    ("p \\nRightarrow q", "p \\nRightarrow q"),
    ("\\nu", "\\nu"),
    ("x \\neq 3", "x \\neq 3"),
    ("\\n\\nThe answer", "\n\nThe answer"),
    ("x=2\\n", "x=2\n"),
    ("\\n1.", "\n1."),
    ("so:\\n $x$", "so:\n $x$"),
    # A LaTeX line break followed by n is not a literal newline.
    ("a \\\\n b", "a \\\\n b"),
    ("plain", "plain"),
])
def test_real_newlines(raw: str, want: str) -> None:
    assert real_newlines(raw) == want
    assert mig.real_newlines(raw) == want


@pytest.mark.parametrize(("raw", "has"), [
    (None, False), ("null", False), ("[]", False), ([], False),
    (["$x = 3$", "$x = 24$", "$x = 6$"], True), ('["1", "2", "3"]', True),
])
def test_migration_reads_every_stored_shape(raw: Any, has: bool) -> None:
    assert mig._has_options(raw) is has


def test_migration_reads_an_answer_with_literal_newlines_as_rendered() -> None:
    # Prod 354df559: its "(b)" follows a literal backslash-n pair.
    answer = "**(a)** $x = 12$\\n\\n**(b)** Corresponding Angles Converse Postulate"
    assert mig.is_multi_part("Solve.", answer)
    assert mig.is_multi_part("(a) Find x.\n(b) Name the postulate.", "$x = 12$")
    assert not mig.is_multi_part("Solve.", "$x = 12$")


# ── generation ──


async def _world(kind: str) -> dict[str, Any]:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{tag}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="T")
        course = Course(name="Geometry", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="Unit 3", position=0)
        s.add(unit)
        await s.flush()
        a = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                       title="Parallel & Perpendicular Lines", type=kind, status="draft")
        s.add(a)
        await s.commit()
        return {"teacher": teacher.id, "course": course.id, "unit": unit.id, "assignment": a.id}


_QUESTIONS = [
    {"title": "one", "text": "Find the slope of $y = 2x + 1$.", "difficulty": "easy"},
    {"title": "two", "text": "Find (a) the slope and (b) the intercept of $y = 2x + 1$.",
     "difficulty": "easy"},
]
_SOLUTIONS = [
    {"question_text": "", "steps": [], "final_answer": "$m = 2$"},
    {"question_text": "", "steps": [], "final_answer": "**(a)** $m = 2$\\n\\n**(b)** $b = 1$"},
]


async def _generate(kind: str) -> tuple[dict[str, Any], AsyncMock, list[QuestionBankItem]]:
    w = await _world(kind)
    async with get_session_factory()() as s:
        job = QuestionBankGenerationJob(
            course_id=w["course"], unit_id=w["unit"], originating_assignment_id=w["assignment"],
            created_by_id=w["teacher"], status="queued", requested_count=2,
            constraint="word problems",
        )
        s.add(job)
        await s.commit()
        job_id = job.id

    gen = AsyncMock(return_value=[dict(q) for q in _QUESTIONS])
    distractors = AsyncMock(return_value=["$m = 3$", "$m = -2$", "$m = 1$"])
    with (
        patch("api.core.question_bank_generation.generate_questions", gen),
        patch("api.core.question_bank_generation.generate_solutions",
              AsyncMock(return_value=[dict(x) for x in _SOLUTIONS])),
        patch("api.core.question_bank_generation.generate_distractors", distractors),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(QuestionBankGenerationJob.id == job_id)
            )).scalar_one()
            await _run_generation(s, job)
    async with get_session_factory()() as s:
        items = list((await s.execute(
            select(QuestionBankItem)
            .where(QuestionBankItem.originating_assignment_id == w["assignment"])
            .order_by(QuestionBankItem.title)
        )).scalars().all())
    return dict(gen.call_args.kwargs), distractors, items


@pytest.mark.asyncio
async def test_practice_generation_asks_for_one_answer_and_skips_options_on_parts() -> None:
    kwargs, distractors, items = await _generate("practice")
    assert PRACTICE_SINGLE_ANSWER_RULE in kwargs["extra_instructions"]
    # The teacher's own brief still leads.
    assert kwargs["extra_instructions"].startswith("word problems")
    one, two = items
    assert one.distractors == ["$m = 3$", "$m = -2$", "$m = 1$"]
    # The multi-part slip gets no wrong options — no model call at all.
    assert two.distractors is None
    assert distractors.await_count == 1
    # And its answer's literal backslash-n pairs are real line breaks.
    assert two.final_answer == "**(a)** $m = 2$\n\n**(b)** $b = 1$"


@pytest.mark.asyncio
async def test_homework_generation_is_unchanged() -> None:
    kwargs, distractors, items = await _generate("homework")
    assert PRACTICE_SINGLE_ANSWER_RULE not in (kwargs["extra_instructions"] or "")
    assert kwargs["extra_instructions"] == "word problems"
    # Homework may be multi-part, and keeps its options.
    assert all(it.distractors for it in items)
    assert distractors.await_count == 2


async def _regenerate(kind: str, answer: str) -> tuple[AsyncMock, QuestionBankItem]:
    w = await _world(kind)
    async with get_session_factory()() as s:
        item = QuestionBankItem(
            course_id=w["course"], unit_id=w["unit"], originating_assignment_id=w["assignment"],
            title="t", question="old", final_answer="1", distractors=["2", "3", "4"],
            status="approved", source="generated",
        )
        s.add(item)
        await s.commit()
        item_id = item.id
    call = AsyncMock(return_value={"title": "t", "question": "Find (a) x and (b) y.",
                                   "solution_steps": [], "final_answer": answer})
    distractors = AsyncMock(return_value=["5", "6", "7"])
    with (
        patch("api.core.question_bank_generation.call_claude_json", call),
        patch("api.core.question_bank_generation.generate_distractors", distractors),
    ):
        async with get_session_factory()() as s:
            item = (await s.execute(
                select(QuestionBankItem).where(QuestionBankItem.id == item_id)
            )).scalar_one()
            course = (await s.execute(select(Course).where(Course.id == w["course"]))).scalar_one()
            await regenerate_one(s, item, course, instructions=None, user_id=w["teacher"])
            await s.refresh(item)
    return call, item


@pytest.mark.asyncio
async def test_regenerating_a_practice_item_asks_for_one_answer() -> None:
    call, item = await _regenerate("practice", "**(a)** $x = 1$\n\n**(b)** $y = 2$")
    assert PRACTICE_SINGLE_ANSWER_RULE in call.call_args.args[1]
    assert item.distractors is None


@pytest.mark.asyncio
async def test_regenerating_a_homework_item_is_unchanged() -> None:
    call, item = await _regenerate("homework", "**(a)** $x = 1$\n\n**(b)** $y = 2$")
    assert PRACTICE_SINGLE_ANSWER_RULE not in call.call_args.args[1]
    assert item.distractors == ["5", "6", "7"]


# ── order of a practice set written directly ──


@pytest.mark.asyncio
async def test_a_direct_practice_set_keeps_its_problem_list_order() -> None:
    w = await _world("practice")
    at = datetime.now(UTC)
    async with get_session_factory()() as s:
        # One batch: every item shares created_at, as a generation job's do.
        items = [
            QuestionBankItem(
                course_id=w["course"], unit_id=w["unit"], originating_assignment_id=w["assignment"],
                title=f"p{i}", question=f"q{i}", final_answer="1", status="approved",
                source="generated", created_at=at,
            )
            for i in range(4)
        ]
        s.add_all(items)
        await s.flush()
        listed = [items[2], items[0], items[3]]  # items[1] was never put on the list
        practice = (await s.execute(
            select(Assignment).where(Assignment.id == w["assignment"])
        )).scalar_one()
        practice.content = {"problem_ids": [str(it.id) for it in listed]}
        await s.commit()
        want = [it.id for it in listed] + [items[1].id]

    for _ in range(3):
        async with get_session_factory()() as s:
            practice = (await s.execute(
                select(Assignment).where(Assignment.id == w["assignment"])
            )).scalar_one()
            got = [it.id for it in await approved_practice_items(s, practice)]
        assert got == want


def test_look_alike_variations_serve_multi_part_items_without_options() -> None:
    from api.routes.school_student_practice import _serialize

    def item(answer: str) -> QuestionBankItem:
        return QuestionBankItem(id=uuid.uuid4(), question="Solve.", final_answer=answer,
                                distractors=["1", "2", "3"], difficulty="easy")

    assert _serialize(item("**(a)** $x = 1$\n\n**(b)** $y = 2$")).distractors == []
    assert _serialize(item("$x = 1$")).distractors == ["1", "2", "3"]
