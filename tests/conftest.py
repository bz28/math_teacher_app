import os

# Set test environment variables before importing anything else
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp_test")
os.environ.setdefault("JWT_SECRET", "test-secret-key")
# CLAUDE_API_KEY: not set here — reads from .env locally, from env vars in CI
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SENTRY_DSN", "")
os.environ.setdefault("JWT_REFRESH_GRACE_PERIOD_SECONDS", "0")

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import Base, get_engine, get_session_factory
from api.main import app
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course
from api.models.llm_call import LLMCall  # noqa: F401 — register models with Base
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.session import Session  # noqa: F401 — register models with Base
from api.models.user import User
from api.routes.school_student_practice import drain_integrity_background_tasks


@pytest.fixture(scope="session", autouse=True)
async def setup_db() -> None:
    """Create tables (if missing) and truncate before the test session.

    In CI, migrations run first via `alembic upgrade head`, so tables already
    exist.  We drop with CASCADE to handle circular FKs (schools <-> users),
    then recreate via metadata so tests always start from a clean schema.
    """
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
    async with get_session_factory()() as session:
        await session.execute(text("TRUNCATE TABLE sessions, refresh_tokens, users CASCADE"))
        await session.commit()


@pytest.fixture(scope="session")
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ── Shared school-student fixtures (used by multiple test files) ──

# A 1×1 transparent PNG for tests that need to send a real-looking
# image payload to the submit endpoint. Tiny enough to be inline.
TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
    "2mP8/x8AAusB9YpO3vQAAAAASUVORK5CYII="
)


def auth_headers(token: str) -> dict[str, str]:
    """Build a Bearer Authorization header for an access token."""
    return {"Authorization": f"Bearer {token}"}


# ── Global integrity AI mocks ──
#
# The integrity pipeline runs as a fire-and-forget asyncio task
# spawned from submit_homework. Any test that hits the submit
# endpoint will therefore kick off a background task that calls
# Claude Vision + Sonnet unless we mock the AI helpers here.
#
# The conversational redesign has two AI surfaces to mock:
# - extract_student_work: returns a fixed extraction.
# - run_agent_turn: returns content blocks matching whatever script
#   the current test wants. Tests that care about specific agent
#   behavior override the default via `set_agent_script`.
#
# Scoped to every test via autouse so we never accidentally make
# real API calls from CI.

_MOCK_EXTRACTION = {
    "steps": [
        {"step_num": 1, "latex": "mock", "plain_english": "mocked extraction"},
    ],
    "confidence": 0.9,
}


class _TextBlock:
    """Mimics an Anthropic TextBlock (has .type + .text)."""

    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _ToolUseBlock:
    """Mimics an Anthropic ToolUseBlock."""

    def __init__(self, name: str, tool_input: dict[str, Any], use_id: str) -> None:
        self.type = "tool_use"
        self.name = name
        self.input = tool_input
        self.id = use_id


# Mutable script the tests can swap in at runtime. Each call to
# run_agent_turn pops the next response from this list; when empty,
# returns a plain text turn so the pipeline keeps moving.
_AGENT_SCRIPT: list[list[Any]] = []
_AGENT_CALL_LOG: list[list[dict[str, Any]]] = []


def set_agent_script(script: list[list[Any]]) -> None:
    """Queue up responses for run_agent_turn. Each entry is a list of
    content blocks (_TextBlock / _ToolUseBlock) mirroring what a real
    Claude call would return."""
    _AGENT_SCRIPT.clear()
    _AGENT_SCRIPT.extend(script)


def get_agent_call_log() -> list[list[dict[str, Any]]]:
    """Return the recorded messages passed to run_agent_turn for each
    call. Tests can introspect this to assert on agent input."""
    return list(_AGENT_CALL_LOG)


def make_text(text: str) -> _TextBlock:
    return _TextBlock(text)


def make_tool_use(name: str, tool_input: dict[str, Any], use_id: str = "tool_001") -> _ToolUseBlock:
    return _ToolUseBlock(name, tool_input, use_id)


async def _mock_run_agent_turn(
    system_prompt: str,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> list[Any]:
    _ = system_prompt, kwargs
    _AGENT_CALL_LOG.append(list(messages))
    if _AGENT_SCRIPT:
        return _AGENT_SCRIPT.pop(0)
    # Default: a benign text reply so the pipeline doesn't stall.
    return [_TextBlock("Got it — thanks!")]


@pytest.fixture(autouse=True)
def _mock_integrity_ai() -> Any:
    """Mock all integrity AI calls so tests don't hit Claude."""
    _AGENT_SCRIPT.clear()
    _AGENT_CALL_LOG.clear()
    with (
        patch(
            "api.core.integrity_pipeline.extract_student_work",
            new_callable=AsyncMock,
            return_value=_MOCK_EXTRACTION,
        ),
        patch(
            "api.core.integrity_pipeline.run_agent_turn",
            side_effect=_mock_run_agent_turn,
        ),
    ):
        yield


@pytest.fixture(autouse=True)
async def _drain_integrity_tasks() -> AsyncIterator[None]:
    """Drain any integrity background tasks spawned during the test.

    Runs AFTER the test body so any fire-and-forget tasks from the
    submit endpoint finish (or fail) cleanly before the next test
    starts. Prevents tasks from leaking across tests and hitting a
    session that's about to be truncated.
    """
    yield
    await drain_integrity_background_tasks()


async def _truncate_world_tables() -> None:
    """Wipe the tables touched by the `world` fixture so each test
    starts from a clean slate. Cheaper than dropping and recreating
    the schema."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE bank_consumption, assignment_sections, assignments, "
            "section_enrollments, sections, question_bank_items, courses, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()


@pytest.fixture
async def world() -> dict[str, Any]:
    """Seed a school-student world: a teacher, a student, an outsider
    student (not enrolled), a course, a section, an enrollment, an
    approved primary problem with 3 approved siblings + 1 pending,
    and a published HW assignment with the primary on it.

    Used by every school-student test file.
    """
    await _truncate_world_tables()
    async with get_session_factory()() as s:
        teacher = User(
            email=f"teacher_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="T",
        )
        student = User(
            email=f"student_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="S",
        )
        outsider = User(
            email=f"outsider_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="O",
        )
        s.add_all([teacher, student, outsider])
        await s.flush()

        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()

        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()

        s.add(SectionEnrollment(section_id=section.id, student_id=student.id))

        primary = QuestionBankItem(
            course_id=course.id,
            title="Quadratics 1",
            question="Solve x^2 - 5x + 6 = 0",
            solution_steps=[{"title": "Factor", "description": "(x-2)(x-3)"}],
            final_answer="x = 2 or x = 3",
            distractors=["x=1", "x=-2", "x=5"],
            status="approved",
            source="generated",
        )
        s.add(primary)
        await s.flush()

        siblings_approved = []
        for i, q in enumerate([
            ("Sib A", "Solve x^2 - 7x + 12 = 0", "x = 3 or x = 4"),
            ("Sib B", "Solve x^2 - 9x + 20 = 0", "x = 4 or x = 5"),
            ("Sib C", "Solve x^2 - 11x + 30 = 0", "x = 5 or x = 6"),
        ]):
            sib = QuestionBankItem(
                course_id=course.id,
                title=q[0],
                question=q[1],
                solution_steps=[{"title": "Factor", "description": "..."}],
                final_answer=q[2],
                distractors=[f"d{i}a", f"d{i}b", f"d{i}c"],
                status="approved",
                source="practice",
                parent_question_id=primary.id,
            )
            s.add(sib)
            siblings_approved.append(sib)

        pending_sib = QuestionBankItem(
            course_id=course.id,
            title="Sib pending",
            question="Solve x^2 - 13x + 42 = 0",
            solution_steps=[],
            final_answer="x = 6 or x = 7",
            distractors=["a", "b", "c"],
            status="pending",
            source="practice",
            parent_question_id=primary.id,
        )
        s.add(pending_sib)
        await s.flush()

        assignment = Assignment(
            course_id=course.id,
            unit_ids=[],
            teacher_id=teacher.id,
            title="HW 1",
            type="homework",
            status="published",
            content={"problems": [
                {
                    "bank_item_id": str(primary.id), "position": 1,
                    "question": primary.question,
                    "solution_steps": primary.solution_steps,
                    "final_answer": primary.final_answer,
                    "difficulty": primary.difficulty,
                },
            ]},
        )
        s.add(assignment)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=assignment.id,
            section_id=section.id,
            published_at=datetime.now(UTC),
        ))
        await s.commit()

        return {
            "student_id": student.id,
            "outsider_id": outsider.id,
            "teacher_id": teacher.id,
            "assignment_id": assignment.id,
            "primary_id": primary.id,
            "approved_sibling_ids": [s.id for s in siblings_approved],
            "pending_sibling_id": pending_sib.id,
            "student_token": create_access_token(str(student.id), "student"),
            "outsider_token": create_access_token(str(outsider.id), "student"),
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
        }
