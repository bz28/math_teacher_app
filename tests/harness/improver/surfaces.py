"""The surface catalog — the real routes the improver walks, grouped by app.

Routes mirror the actual file-based routers:
  web   → web/src/app/**            (Next.js, default :3000)
  admin → dashboard/src/App.tsx     (Vite/React, default :5173)
  mobile_web → the Expo web build   (react-native-web, default :8081)

`{course_id}` / `{assignment_id}` / `{student_id}` placeholders are filled from
the seeded world (tests/harness/seed.py:Seed) at scan time.

Auth note: web surfaces authenticate via the localStorage token injection in
HarnessBrowser (`veradic_access_token`). admin and mobile_web use different
token storage + an admin user that `seed_world()` does not yet mint, so they
are excluded from the default scan set until that plumbing lands (Phase 0.5).
Track them here now so the catalog is the single source of truth.
"""

from __future__ import annotations

from tests.harness.improver.types import App, Surface

# --- web: public (no auth) ------------------------------------------------
_WEB_PUBLIC = [
    Surface("web.public.landing", "web", "/", "public", "Landing page"),
    Surface("web.public.login", "web", "/login", "public", "Login"),
    Surface("web.public.register", "web", "/register", "public", "Register"),
    Surface("web.public.demo", "web", "/demo", "public", "Request a demo"),
    Surface("web.public.for_districts", "web", "/for-districts", "public", "For districts"),
    Surface("web.public.privacy", "web", "/privacy", "public", "Privacy policy"),
    Surface("web.public.terms", "web", "/terms", "public", "Terms of service"),
    Surface("web.public.support", "web", "/support", "public", "Support"),
    Surface("web.public.subjects_math", "web", "/subjects/math", "public", "Subject: math"),
    Surface("web.public.subjects_physics", "web", "/subjects/physics", "public", "Subject: physics"),
    Surface("web.public.subjects_chemistry", "web", "/subjects/chemistry", "public", "Subject: chemistry"),
    Surface("web.public.students", "web", "/students", "public", "Students landing"),
]

# --- web: authenticated (shared + student + teacher) ----------------------
_WEB_STUDENT = [
    Surface("web.app.home", "web", "/home", "student", "Home (authed)"),
    Surface("web.app.account", "web", "/account", "student", "Account"),
    Surface("web.student.practice", "web", "/practice", "student", "Free practice"),
    Surface("web.student.learn", "web", "/learn", "student", "Learn"),
    Surface("web.student.learn_session", "web", "/learn/session", "student", "Learn session"),
    Surface("web.student.mock_test", "web", "/mock-test", "student", "Mock test"),
    Surface("web.student.history", "web", "/history", "student", "Session history"),
    Surface("web.student.pricing", "web", "/pricing", "student", "Pricing"),
    Surface("web.student.school_root", "web", "/school/student", "student", "Student school home"),
    Surface(
        "web.student.school_course", "web",
        "/school/student/courses/{course_id}", "student", "Student course detail",
    ),
    Surface("web.student.school_grades", "web", "/school/student/grades", "student", "Student grades"),
]

_WEB_TEACHER = [
    Surface("web.teacher.school_root", "web", "/school/teacher", "teacher", "Teacher school home"),
    Surface(
        "web.teacher.course", "web",
        "/school/teacher/courses/{course_id}", "teacher", "Teacher course detail",
    ),
    Surface(
        "web.teacher.homework", "web",
        "/school/teacher/courses/{course_id}/homework/{assignment_id}",
        "teacher", "Teacher homework detail",
    ),
    Surface(
        "web.teacher.homework_review", "web",
        "/school/teacher/courses/{course_id}/homework/{assignment_id}/review",
        "teacher", "Teacher homework review",
    ),
]

# --- admin (dashboard) — needs admin-user seed + dashboard token key -------
_ADMIN = [
    Surface("admin.leads", "admin", "/leads", "admin", "Leads"),
    Surface("admin.schools", "admin", "/schools", "admin", "Schools"),
    Surface("admin.quality", "admin", "/quality", "admin", "Quality"),
    Surface("admin.harness_runs", "admin", "/harness-runs", "admin", "Harness runs"),
    Surface("admin.llm_calls", "admin", "/llm-calls", "admin", "LLM calls"),
]

# --- mobile (Expo web build) — needs Expo token key -----------------------
_MOBILE_WEB = [
    Surface("mobile.auth", "mobile_web", "/", "public", "Mobile auth/onboarding"),
    Surface("mobile.solve", "mobile_web", "/", "student", "Mobile solve tab"),
]

CATALOG: list[Surface] = [
    *_WEB_PUBLIC, *_WEB_STUDENT, *_WEB_TEACHER, *_ADMIN, *_MOBILE_WEB,
]

# Apps with working auth + base-url plumbing today. admin/mobile_web join once
# their token injection + (for admin) an admin-user seed land.
DEFAULT_APPS: tuple[App, ...] = ("web",)


def surfaces_for(apps: tuple[App, ...] = DEFAULT_APPS) -> list[Surface]:
    """The catalog filtered to the given apps (default: the ones that scan
    cleanly today)."""
    allow = set(apps)
    return [s for s in CATALOG if s.app in allow]
