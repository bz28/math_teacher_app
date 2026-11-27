"""One whose-call rule (api/core/llm_attribution.py), read by every level.

The world: one school with teacher Tess, her student Sam (who handed in her
homework), and a second teacher Theo with student Ola. Plus an admin call
stamped with no school.

  c_grade   Sam's grading call on his submission to Tess's HW   $1.00  (Sam)
  c_gen     Tess's own question generation                       $2.00  (Tess)
  c_gone    an integrity call whose submission was deleted       $0.50  (Sam)
  c_other   Ola's grading call on Theo's HW                      $8.00  (Ola)
  c_admin   the admin's call, no school                          $4.00  (admin)

Pins:
  * a teacher's number = own calls + calls on submissions to their HW
    ($3.00 for Tess) — the same on the calls filter, her page, the school
    page and the Users list;
  * a student's number = calls they made + calls on their submissions
    ($1.50 for Sam, including the deleted-submission call);
  * the deleted-submission call is labelled and stays with Sam — Tess,
    Theo and the school's other people never get it;
  * a school's number is the stamped school_id; blank = Internal;
  * a call shared by a student and their teacher counts once in a total.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from api.core.auth import create_access_token, hash_password
from api.core.llm_attribution import (
    SUBMISSION_STAMPED_SINCE,
    call_owners,
    calls_of,
    is_deleted_submission_call,
)
from api.core.llm_client import LLMMode
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers

pytestmark = pytest.mark.asyncio


def _user(role: str, name: str, school_id: uuid.UUID | None) -> User:
    return User(
        email=f"{name.lower()}_{uuid.uuid4().hex[:6]}@t.com",
        password_hash=hash_password("x"), grade_level=99 if role == "admin" else 9,
        role=role, name=name, school_id=school_id,
    )


def _call(**kw: Any) -> LLMCall:
    base: dict[str, Any] = dict(
        model="claude-opus-5-5", input_tokens=1, output_tokens=1,
        latency_ms=100.0, success=True, created_at=datetime.now(UTC) - timedelta(hours=1),
    )
    base.update(kw)
    return LLMCall(**base)


@pytest.fixture
async def world() -> dict[str, Any]:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submissions, assignments, sections, units, "
            "course_teachers, courses, schools, users RESTART IDENTITY CASCADE"
        ))
        school = School(
            name="Holy Prep", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="C", contact_email="c@holyprep.edu",
        )
        s.add(school)
        await s.flush()
        admin = _user("admin", "Admin", None)
        tess = _user("teacher", "Tess", school.id)
        theo = _user("teacher", "Theo", school.id)
        sam = _user("student", "Sam", school.id)
        ola = _user("student", "Ola", school.id)
        s.add_all([admin, tess, theo, sam, ola])
        await s.flush()

        subs = {}
        for teacher, kid in ((tess, sam), (theo, ola)):
            course = Course(name=f"{teacher.name} Algebra", subject="math", school_id=school.id)
            s.add(course)
            await s.flush()
            unit = Unit(course_id=course.id, name="U", position=0)
            section = Section(course_id=course.id, name="P1")
            s.add_all([unit, section, CourseTeacher(
                course_id=course.id, teacher_id=teacher.id, role="owner",
            )])
            await s.flush()
            asg = Assignment(
                course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                title="HW", type="homework", status="published", content={"problems": []},
            )
            s.add(asg)
            await s.flush()
            sub = Submission(
                assignment_id=asg.id, student_id=kid.id, section_id=section.id,
                status="submitted", submitted_at=datetime.now(UTC),
            )
            s.add(sub)
            await s.flush()
            subs[kid.name] = sub.id

        calls = {
            "grade": _call(function="ai_grading", user_id=sam.id, school_id=school.id,
                           submission_id=subs["Sam"], cost_usd=1.0, latency_ms=1000.0),
            "gen": _call(function="generate_questions", user_id=tess.id, school_id=school.id,
                         cost_usd=2.0, latency_ms=3000.0),
            "gone": _call(function="integrity_agent", user_id=sam.id, school_id=school.id,
                          submission_id=None, cost_usd=0.5, success=False,
                          latency_ms=60000.0, output_text="TimeoutError: read timed out"),
            "other": _call(function="ai_grading", user_id=ola.id, school_id=school.id,
                           submission_id=subs["Ola"], cost_usd=8.0, latency_ms=2000.0),
            "admin": _call(function="judge", user_id=admin.id, school_id=None, cost_usd=4.0,
                           model="claude-haiku-4-5", latency_ms=500.0),
        }
        s.add_all(calls.values())
        await s.commit()
        return {
            "token": create_access_token(str(admin.id), "admin"),
            "school": str(school.id),
            "tess": str(tess.id), "theo": str(theo.id), "sam": str(sam.id), "ola": str(ola.id),
            "calls": {k: str(c.id) for k, c in calls.items()},
        }


async def _get(client: AsyncClient, world: dict[str, Any], url: str, **params: str) -> Any:
    r = await client.get(url, params=params, headers=auth_headers(world["token"]))
    assert r.status_code == 200, r.text
    return r.json()


async def _summary(client: AsyncClient, world: dict[str, Any], **params: str) -> Any:
    return await _get(client, world, "/v1/admin/llm-calls/summary", hours="24", **params)


async def test_teacher_is_own_calls_plus_calls_on_her_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    tess = await _summary(client, world, teacher_id=world["tess"])
    assert (tess["calls"], tess["spend"]) == (2, 3.0)
    # The deleted-submission call is Sam's, never his teacher's.
    theo = await _summary(client, world, teacher_id=world["theo"])
    assert (theo["calls"], theo["spend"]) == (1, 8.0)


async def test_student_is_own_calls_plus_calls_on_his_submissions(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sam = await _summary(client, world, student_id=world["sam"])
    assert (sam["calls"], sam["spend"]) == (2, 1.5)
    body = await _get(client, world, "/v1/admin/llm-calls", hours="24", student_id=world["sam"])
    gone = next(c for c in body["calls"] if c["id"] == world["calls"]["gone"])
    assert gone["deleted_submission"] is True
    graded = next(c for c in body["calls"] if c["id"] == world["calls"]["grade"])
    assert graded["deleted_submission"] is False


async def test_school_is_the_stamped_school_and_blank_is_internal(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    school = await _summary(client, world, school_id=world["school"])
    assert (school["calls"], school["spend"]) == (4, 11.5)
    internal = await _summary(client, world, school_id="internal")
    assert (internal["calls"], internal["spend"]) == (1, 4.0)


async def test_every_level_shows_the_same_number(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Tess's $3.00 and Sam's $1.50 read the same on every page."""
    tess_page = await _get(client, world, f"/v1/admin/users/{world['tess']}/students")
    assert tess_page["teacher"]["total_cost_30d"] == pytest.approx(3.0)
    assert tess_page["teacher"]["call_count_30d"] == 2

    sam_page = await _get(client, world, f"/v1/admin/students/{world['sam']}")
    assert sam_page["student"]["total_cost_30d"] == pytest.approx(1.5)
    assert sam_page["student"]["call_count_30d"] == 2

    school_page = await _get(client, world, f"/v1/admin/schools/{world['school']}")
    by_name = {t["name"]: t for t in school_page["teachers"]}
    assert by_name["Tess"]["cost_30d"] == pytest.approx(3.0)
    assert by_name["Theo"]["cost_30d"] == pytest.approx(8.0)

    users = await _get(client, world, "/v1/admin/users", hours="24", limit="50")
    cost = {u["name"]: u["total_cost"] for u in users["users"]}
    assert cost["Tess"] == pytest.approx(3.0)
    assert cost["Sam"] == pytest.approx(1.5)
    assert cost["Theo"] == pytest.approx(8.0)
    assert cost["Ola"] == pytest.approx(8.0)
    # Sam's grading call is Sam's AND Tess's, but a total counts it once:
    # every call in the window, $15.50, not $25.50.
    assert users["total_spend"] == pytest.approx(15.5)
    teachers = await _get(client, world, "/v1/admin/users", hours="24", role="teacher")
    assert teachers["total_spend"] == pytest.approx(11.0)


async def test_both_shapes_of_the_rule_agree(world: dict[str, Any]) -> None:
    """`calls_of` (one person) and `call_owners` (grouped) are the same
    rule; a drift between them would make a list disagree with its page."""
    async with get_session_factory()() as s:
        owners = call_owners()
        for person in ("tess", "theo", "sam", "ola"):
            uid = uuid.UUID(world[person])
            one = set((await s.execute(select(LLMCall.id).where(calls_of(uid)))).scalars())
            grouped = set((await s.execute(
                select(owners.c.call_id).where(owners.c.owner_id == uid)
            )).scalars())
            assert one == grouped, person


async def test_every_filter_narrows_the_aggregates_too(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    body = await _get(client, world, "/v1/admin/llm-calls", hours="24", function="ai_grading")
    assert body["summary"]["calls"] == 2
    assert {r["function"] for r in body["by_function"]} == {"ai_grading"}
    assert body["total_count"] == 2

    failed = await _get(client, world, "/v1/admin/llm-calls", hours="24", success="false")
    assert failed["summary"]["calls"] == 1 and failed["summary"]["spend"] == 0.5

    haiku = await _summary(client, world, model="claude-haiku-4-5")
    assert (haiku["calls"], haiku["spend"]) == (1, 4.0)

    found = await _summary(client, world, search="TimeoutError")
    assert found["calls"] == 1


async def test_latency_is_over_successful_calls_with_its_sample_size(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    every = await _summary(client, world)
    # Four successful calls (500, 1000, 2000, 3000 ms); the failed 60 s
    # timeout is not latency and must not drag the tail.
    assert every["latency_n"] == 4
    assert every["latency_p50_ms"] == pytest.approx(1500.0)
    assert every["latency_p95_ms"] < 3000.0
    assert every["failed"] == 1 and every["failure_rate"] == 20.0
    assert [f["id"] for f in every["latest_failures"]] == [world["calls"]["gone"]]
    assert every["latest_failures"][0]["deleted_submission"] is True
    assert every["latest_failures"][0]["error"].startswith("TimeoutError")
    spend = {r["function"]: r["spend"] for r in every["spend_by_function"]}
    assert spend == {"ai_grading": 9.0, "judge": 4.0, "generate_questions": 2.0,
                     "integrity_agent": 0.5}


async def test_custom_date_range(client: AsyncClient, world: dict[str, Any]) -> None:
    today = datetime.now(UTC).date()
    hit = await _summary(client, world, **{"from": str(today - timedelta(days=1)), "to": str(today)})
    assert hit["calls"] == 5
    miss = await _summary(client, world, **{"from": str(date(2020, 1, 1)), "to": str(date(2020, 1, 31))})
    assert miss["calls"] == 0
    r = await client.get(
        "/v1/admin/llm-calls/summary", params={"from": "2026-02-02", "to": "2026-02-01"},
        headers=auth_headers(world["token"]),
    )
    assert r.status_code == 400
    assert "'to'" in r.json()["detail"]
    # A future `from` with no `to` names the real problem, not a `to`
    # the caller never sent.
    r = await client.get(
        "/v1/admin/llm-calls/summary", params={"from": str(today + timedelta(days=2))},
        headers=auth_headers(world["token"]),
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "'from' is in the future"


async def test_bad_ids_are_400(client: AsyncClient, world: dict[str, Any]) -> None:
    for key in ("teacher_id", "student_id"):
        r = await client.get(
            "/v1/admin/llm-calls/summary", params={key: "nope"},
            headers=auth_headers(world["token"]),
        )
        assert r.status_code == 400, key


def test_deleted_submission_label_covers_the_whole_pipeline_since_stamping() -> None:
    after = SUBMISSION_STAMPED_SINCE + timedelta(days=1)
    # Graph feedback runs inside the grading pass on one submission.
    assert is_deleted_submission_call(LLMMode.GRAPH_FEEDBACK, None, after)
    assert is_deleted_submission_call(LLMMode.AI_GRADING, None, after)
    # Before the pipeline stamped submission_id the NULL means "never
    # recorded", not "deleted".
    before = SUBMISSION_STAMPED_SINCE - timedelta(days=1)
    assert not is_deleted_submission_call(LLMMode.AI_GRADING, None, before)
    # Not a pipeline call, or a call that still has its submission.
    assert not is_deleted_submission_call("generate_questions", None, after)
    assert not is_deleted_submission_call(LLMMode.AI_GRADING, uuid.uuid4(), after)


async def test_owners_in_keeps_only_those_owners(world: dict[str, Any]) -> None:
    """A page about a few people restricts the rule to them, and the
    numbers it gets are the same as the unrestricted rule's for them."""
    tess = uuid.UUID(world["tess"])
    async with get_session_factory()() as s:
        everyone = call_owners()
        only_tess = call_owners(owners_in=select(User.id).where(User.id == tess))
        rows = (await s.execute(select(only_tess.c.owner_id, only_tess.c.call_id))).all()
        assert {r.owner_id for r in rows} == {tess}
        full = set((await s.execute(
            select(everyone.c.call_id).where(everyone.c.owner_id == tess)
        )).scalars())
        assert {r.call_id for r in rows} == full


async def test_an_admin_who_sets_homework_reads_the_same_on_users_and_calls(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Admins can set homework (require_teacher admits them), so the Users
    row and the Calls view it links to (`teacher=`, the whose-call rule)
    must both count calls on it — not just the calls the admin made."""
    async with get_session_factory()() as s:
        admin = (await s.execute(select(User).where(User.role == "admin"))).scalar_one()
        sub = (await s.execute(
            select(Submission).where(Submission.student_id == uuid.UUID(world["ola"]))
        )).scalar_one()
        asg = (await s.execute(
            select(Assignment).where(Assignment.id == sub.assignment_id)
        )).scalar_one()
        asg.teacher_id = admin.id  # the admin set Ola's homework
        await s.commit()
        admin_id = str(admin.id)

    users = await _get(client, world, "/v1/admin/users", hours="24", role="admin")
    row = next(u for u in users["users"] if u["id"] == admin_id)
    calls = await _summary(client, world, teacher_id=admin_id)
    # Their own $4.00 judge call + Ola's $8.00 grading on their homework.
    assert row["total_cost"] == pytest.approx(12.0)
    assert calls["spend"] == pytest.approx(row["total_cost"])
