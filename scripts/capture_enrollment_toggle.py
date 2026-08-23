"""Screenshot the section card's enrollment control (open + closed).

Evidence for the change that replaced the 7-day `join_code_expires_at`
timer with a teacher-controlled `enrollment_open` flag. The old card
showed a join code with no expiry and no state; the new one shows the
state and lets the teacher close or reopen enrollment in place.

Standalone (not a durable test) — drives the running local stack:

    WEB_BASE=http://localhost:3007 .venv/bin/python -m scripts.capture_enrollment_toggle

Writes docs/design/shots-enrollment-open.png / -closed.png.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3007").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"



async def seed() -> dict[str, str]:
    """A teacher with one course, one section carrying a live join code,
    and two enrolled students so the card renders a real roster count."""
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        # Unique per run — join_code carries a UNIQUE index, so a fixed
        # literal collides the second time this script is used.
        join_code = f"3FH{suffix[:3].upper()}"
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"enroll_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"enroll_teacher_{suffix}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()

        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        section = Section(course_id=course.id, name="Period 3", join_code=join_code)
        s.add(section)
        await s.flush()

        for name in ("Ava Chen", "Marcus Hill"):
            student = User(
                email=f"{name.split()[0].lower()}_{suffix}@t.com",
                password_hash=hash_password("x"), grade_level=9, role="student",
                name=name, school_id=school.id,
            )
            s.add(student)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=section.id, course_id=course.id, student_id=student.id,
            ))

        await s.commit()

        access = create_access_token(str(teacher.id), "teacher")
        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()

    return {
        "join_code": join_code,
        "course_id": str(course.id),
        "section_id": str(section.id),
        "access": access,
        "refresh": refresh,
    }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding enrollment world …")
    w = await seed()
    url = f"{WEB_BASE}/school/teacher/courses/{w['course_id']}"

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1100, "height": 900})

            async def shot(label: str) -> None:
                # span -> flex row -> share block -> card root
                card = page.locator("span", has_text="Share with your class").locator(
                    "xpath=ancestor::div[3]"
                ).first
                out = OUT_DIR / f"shots-enrollment-{label}.png"
                await card.screenshot(path=str(out))
                print(f"  -> {out}")

            await page.goto(url, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1500)

            code_visible = await page.get_by_text(w["join_code"], exact=False).count()
            close_btn = page.get_by_role("button", name="Close enrollment")
            print(f"  open state: join code on page={code_visible}, "
                  f"'Close enrollment' buttons={await close_btn.count()}")
            await shot("open")

            await close_btn.first.click()
            await page.wait_for_timeout(2000)
            # Park the cursor off the card so the shot shows resting
            # state, not the hover style left behind by the click.
            await page.mouse.move(0, 0)
            await page.wait_for_timeout(300)

            closed_chip = await page.get_by_text("Closed", exact=True).count()
            reopen = await page.get_by_role("button", name="Reopen enrollment").count()
            print(f"  closed state: 'Closed' chips={closed_chip}, "
                  f"'Reopen enrollment' buttons={reopen}")
            await shot("closed")

            if errors:
                print(f"  console errors: {errors[:5]}")
                return 1
            if not (code_visible and closed_chip and reopen):
                print("  FAIL: expected controls missing")
                return 1

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
