"""Seed a two-school world for the admin console's school scope.

Two institutional schools with different volumes (so a leak is visible
as a wrong number), a preview student in one, and an admin LLM call with
no school. Drives `scripts/check_admin_school_scope.py` and the
screenshots in docs/design/admin-school-scope-*.png.

TRUNCATES users, schools and their data — point it at a throwaway DB:
    DATABASE_URL=postgresql+asyncpg://…/<scratch_db> python -m scripts.seed_admin_school_scope

Login afterwards: admin@veradiclocal.com / admin
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from api.models.user import User
from tests.test_admin_school_scope import _school


async def main() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE teacher_reports, "
            "llm_calls, sessions, submission_grades, submissions, assignments, "
            "section_enrollments, sections, units, course_teachers, courses, "
            "teacher_invites, schools, users RESTART IDENTITY CASCADE"
        ))
        admin = User(email="admin@veradiclocal.com", password_hash=hash_password("admin"),
                     grade_level=99, role="admin", name="Console Admin")
        s.add(admin)
        await s.flush()
        a = await _school(s, "Lincoln High", students=6, reports=2, cost=1.25,
                          with_preview=True)
        b = await _school(s, "Riverside Prep", students=14, reports=5, cost=3.40)
        # extra spread so the cost chart has two days
        now = datetime.now(UTC)
        for i, (sid, c) in enumerate([(a["id"], 0.6), (b["id"], 1.1)]):
            s.add(LLMCall(function="image_extract", model="claude", input_tokens=1,
                          output_tokens=1, latency_ms=900.0, cost_usd=c, success=i == 0,
                          school_id=uuid.UUID(sid), created_at=now - timedelta(hours=20)))
        s.add(LLMCall(function="judge", model="claude", input_tokens=1, output_tokens=1,
                      latency_ms=100.0, cost_usd=0.9, success=True, user_id=admin.id))
        await s.commit()
    print("seeded: admin@veradiclocal.com / admin", a, b)


if __name__ == "__main__":
    asyncio.run(main())
