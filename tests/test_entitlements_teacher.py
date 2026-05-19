"""Teacher entitlement tests.

Covers:
- The 10/day GENERATE_PROBLEM cap for independent free teachers.
- The school-active-teacher bypass (no cap when school_id is set
  on an active school).
- Pro teachers bypass the cap.
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from api.core.auth import hash_password
from api.core.entitlements import (
    TEACHER_DAILY_GENERATION_LIMIT,
    Entitlement,
    EntitlementError,
    check_entitlement,
)
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.user import User


async def _make_teacher(
    *,
    email: str,
    school_id: uuid.UUID | None = None,
    subscription_tier: str = "free",
) -> User:
    """Insert a teacher row and return it (re-fetched from a fresh session)."""
    async with get_session_factory()() as session:
        teacher = User(
            email=email,
            name="T",
            password_hash=hash_password("StrongPass1"),
            grade_level=12,
            role="teacher",
            school_id=school_id,
            subscription_tier=subscription_tier,
        )
        session.add(teacher)
        await session.commit()
        await session.refresh(teacher)
        return teacher


async def _make_school(
    *, is_active: bool = True, kind: str = "institutional",
) -> School:
    async with get_session_factory()() as session:
        school = School(
            name="Test School",
            kind=kind,
            contact_name="Contact",
            contact_email=f"c_{uuid.uuid4().hex[:6]}@s.com",
            is_active=is_active,
        )
        session.add(school)
        await session.commit()
        await session.refresh(school)
        return school


async def _log_generate_problem(user_id: uuid.UUID, n: int) -> None:
    """Insert N generate_problem LLMCall rows for `user_id` today."""
    async with get_session_factory()() as session:
        for _ in range(n):
            session.add(LLMCall(
                user_id=user_id,
                function="generate_questions",
                model="claude-test",
                input_tokens=0,
                output_tokens=0,
                latency_ms=0.0,
                cost_usd=0.0,
                success=True,
                created_at=datetime.now(UTC),
            ))
        await session.commit()


@pytest.mark.asyncio
async def test_teacher_cap_blocks_at_limit() -> None:
    """An independent free teacher hits EntitlementError on call #11."""
    teacher = await _make_teacher(email=f"cap_{uuid.uuid4().hex[:6]}@t.com")
    await _log_generate_problem(teacher.id, TEACHER_DAILY_GENERATION_LIMIT)

    async with get_session_factory()() as session:
        # Re-fetch in the session we'll pass to check_entitlement so SQLAlchemy
        # doesn't complain about a detached instance.
        user = (await session.execute(
            select(User).where(User.id == teacher.id)
        )).scalar_one()
        with pytest.raises(EntitlementError) as exc:
            await check_entitlement(session, user, Entitlement.GENERATE_PROBLEM)
        assert exc.value.is_limit is True


@pytest.mark.asyncio
async def test_teacher_cap_allows_below_limit() -> None:
    """A teacher with N-1 calls today can still generate."""
    teacher = await _make_teacher(email=f"under_{uuid.uuid4().hex[:6]}@t.com")
    await _log_generate_problem(teacher.id, TEACHER_DAILY_GENERATION_LIMIT - 1)

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.id == teacher.id)
        )).scalar_one()
        await check_entitlement(session, user, Entitlement.GENERATE_PROBLEM)


@pytest.mark.asyncio
async def test_school_teacher_bypasses_cap() -> None:
    """A teacher attached to an active school bypasses the cap entirely."""
    school = await _make_school(is_active=True)
    teacher = await _make_teacher(
        email=f"sch_{uuid.uuid4().hex[:6]}@t.com", school_id=school.id,
    )
    # 2x the limit — should still be allowed.
    await _log_generate_problem(teacher.id, TEACHER_DAILY_GENERATION_LIMIT * 2)

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.id == teacher.id)
        )).scalar_one()
        await check_entitlement(session, user, Entitlement.GENERATE_PROBLEM)


@pytest.mark.asyncio
async def test_inactive_school_teacher_does_not_bypass() -> None:
    """If the school is inactive, the teacher is treated as independent."""
    school = await _make_school(is_active=False)
    teacher = await _make_teacher(
        email=f"inact_{uuid.uuid4().hex[:6]}@t.com", school_id=school.id,
    )
    await _log_generate_problem(teacher.id, TEACHER_DAILY_GENERATION_LIMIT)

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.id == teacher.id)
        )).scalar_one()
        with pytest.raises(EntitlementError):
            await check_entitlement(session, user, Entitlement.GENERATE_PROBLEM)


@pytest.mark.asyncio
async def test_pro_teacher_bypasses_cap() -> None:
    """A teacher on the Pro tier never hits the cap."""
    async with get_session_factory()() as session:
        teacher = User(
            email=f"pro_{uuid.uuid4().hex[:6]}@t.com",
            name="Pro",
            password_hash=hash_password("StrongPass1"),
            grade_level=12,
            role="teacher",
            subscription_tier="pro",
            subscription_status="active",
        )
        session.add(teacher)
        await session.commit()
        await session.refresh(teacher)
        teacher_id = teacher.id

    await _log_generate_problem(teacher_id, TEACHER_DAILY_GENERATION_LIMIT * 2)

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.id == teacher_id)
        )).scalar_one()
        await check_entitlement(session, user, Entitlement.GENERATE_PROBLEM)


@pytest.mark.asyncio
async def test_individual_school_teacher_still_capped() -> None:
    """An indie teacher whose school_id points at a kind='individual'
    school must still hit the cap — the synthetic personal school is
    the post-refactor indie signal, not a paying institution.
    Regression guard for the school.kind switch in
    `is_school_active_teacher`.
    """
    indie_school = await _make_school(is_active=True, kind="individual")
    teacher = await _make_teacher(
        email=f"indie_{uuid.uuid4().hex[:6]}@t.com",
        school_id=indie_school.id,
    )
    await _log_generate_problem(teacher.id, TEACHER_DAILY_GENERATION_LIMIT)

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.id == teacher.id)
        )).scalar_one()
        with pytest.raises(EntitlementError):
            await check_entitlement(session, user, Entitlement.GENERATE_PROBLEM)


@pytest.mark.asyncio
async def test_student_skips_generate_problem_cap() -> None:
    """The GENERATE_PROBLEM entitlement is teacher-only — students fall through."""
    async with get_session_factory()() as session:
        student = User(
            email=f"stu_{uuid.uuid4().hex[:6]}@t.com",
            name="Stu",
            password_hash=hash_password("StrongPass1"),
            grade_level=8,
            role="student",
        )
        session.add(student)
        await session.commit()
        await session.refresh(student)
        student_id = student.id

    await _log_generate_problem(student_id, TEACHER_DAILY_GENERATION_LIMIT * 3)

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.id == student_id)
        )).scalar_one()
        # No raise — students aren't gated on GENERATE_PROBLEM yet.
        await check_entitlement(session, user, Entitlement.GENERATE_PROBLEM)
