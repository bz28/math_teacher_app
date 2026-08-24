"""Client-error intake.

These guard the properties that make the endpoint useful rather than
merely present. Every one of them exists because the caller is a page
that is ALREADY BROKEN, so the ordinary API instincts — reject bad input,
require auth, validate strictly — each throw away the evidence we're
trying to collect.

The regression these protect against is silent: if this endpoint starts
rejecting reports, nothing fails visibly. Crashes just stop arriving, and
that looks identical to "no crashes happened".
"""

import uuid

from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.client_error import ClientError
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.user import User


async def _fetch(fingerprint: str) -> ClientError | None:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(ClientError).where(ClientError.fingerprint == fingerprint)
        )).scalars().first()


def _body(**over: object) -> dict[str, object]:
    base: dict[str, object] = {
        "kind": "render",
        "message": "Cannot read properties of undefined",
        "fingerprint": uuid.uuid4().hex[:16],
    }
    base.update(over)
    return base


async def test_an_anonymous_crash_is_still_recorded(client: AsyncClient) -> None:
    """The login page can throw, and a crash nobody is signed in for is
    exactly the one we'd otherwise never hear about. No auth header must
    not mean no report."""
    body = _body(route="/login")
    r = await client.post("/v1/client-errors", json=body)
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.user_id is None
    assert row.route == "/login"


async def test_a_signed_in_crash_is_attributed_to_the_user_and_school(
    client: AsyncClient,
) -> None:
    """Attribution is the whole point for a pilot: "which teacher hit
    this" is the first question asked. school_id is denormalized at write
    time so the report stays scoped even if the user is later deleted."""
    async with get_session_factory()() as s:
        school = School(
            name="Err School", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="E", contact_email="e@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"err_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Err Teacher", school_id=school.id,
        )
        s.add(teacher)
        await s.commit()
        teacher_id, school_id = teacher.id, school.id

    token = create_access_token(str(teacher_id), "teacher")
    body = _body()
    r = await client.post(
        "/v1/client-errors", json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.user_id == teacher_id
    assert row.user_role == "teacher"
    assert row.school_id == school_id


async def test_a_bad_token_is_filed_anonymously_not_rejected(
    client: AsyncClient,
) -> None:
    """An expired session is a routine reason to crash. Refusing the
    report over a token we don't actually need would discard the evidence
    to enforce a rule that serves nothing here."""
    body = _body()
    r = await client.post(
        "/v1/client-errors", json=body,
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.user_id is None


async def test_an_unknown_kind_is_coerced_rather_than_refused(
    client: AsyncClient,
) -> None:
    """A client sending a kind we don't recognise (a stale deploy, a
    typo) still has a real crash to tell us about. Coerce and keep."""
    body = _body(kind="something_new")
    r = await client.post("/v1/client-errors", json=body)
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.kind == "unhandled"


async def test_an_oversized_stack_is_truncated_not_rejected(
    client: AsyncClient,
) -> None:
    """A half-truncated stack still names the bug. A 413 names nothing."""
    body = _body(stack="x" * 50_000)
    r = await client.post("/v1/client-errors", json=body)
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.stack is not None
    assert len(row.stack) < 50_000
    assert row.stack.endswith("[truncated]")


async def test_the_component_stack_survives(client: AsyncClient) -> None:
    """The React component stack is the valuable half of a render crash —
    a minified JS stack rarely names the broken component and this does.
    It has its own column so it can't be lost in a generic blob."""
    body = _body(component_stack="\n at GradesTab\n at ErrorBoundary")
    r = await client.post("/v1/client-errors", json=body)
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.component_stack is not None
    assert "GradesTab" in row.component_stack


# ── Regression guards for the blockers a cold review caught ──────────
#
# Each of these is a bug that shipped in the first cut of this endpoint
# and that the original tests missed. They are grouped here because they
# share a root cause: the first pass tested the fields that happened to be
# safe, and not the ones that weren't.


async def test_a_long_user_agent_does_not_destroy_the_report(
    client: AsyncClient,
) -> None:
    """The bug that mattered most.

    `_clip` used to append a 13-char marker AFTER slicing to the limit,
    producing 525 characters for a varchar(512) column. The INSERT raised,
    the endpoint 500'd, and the crash report vanished — in the one code
    path whose entire purpose is to stop reports vanishing.

    `user_agent` is the sharp edge because it is a REQUEST HEADER, not
    anything the page chooses: corporate/AV-injected agent strings on
    locked-down school laptops routinely exceed 512 characters. The
    machines this feature exists to serve were the ones guaranteed to hit
    it, and the original suite only ever tested an oversized `stack` — a
    Text column, which is immune.
    """
    body = _body()
    r = await client.post(
        "/v1/client-errors", json=body,
        headers={"User-Agent": "Mozilla/5.0 CorpProxy/" + "x" * 900},
    )
    assert r.status_code == 204, f"report lost: {r.status_code} {r.text[:200]}"

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None, "the report was silently dropped"
    assert row.user_agent is not None
    assert len(row.user_agent) <= 512


async def test_a_long_route_does_not_destroy_the_report(
    client: AsyncClient,
) -> None:
    """Same overflow, via the other varchar(512) column — and this one is
    attacker-settable on a public endpoint."""
    body = _body(route="/school/teacher/" + "z" * 900)
    r = await client.post("/v1/client-errors", json=body)
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.route is not None
    assert len(row.route) <= 512


async def test_an_oversized_context_is_dropped_not_stored(
    client: AsyncClient,
) -> None:
    """This endpoint takes no credentials. Without a bound on the one
    free-form field, anyone on the internet could write unbounded JSON into
    the production database at 300 requests/minute, with no retention to
    reclaim it. Verified before the fix: a 2MB blob was accepted and stored
    in full.

    Dropped rather than refused, on the same principle as clipping: a
    report without its extra detail still names the bug.
    """
    body = _body(context={"junk": "x" * 500_000})
    r = await client.post("/v1/client-errors", json=body)
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.context is not None
    assert "_dropped" in row.context
    assert len(str(row.context)) < 1_000


async def test_a_normal_context_survives_intact(client: AsyncClient) -> None:
    """The bound must not eat the ordinary case it exists to protect —
    an API path and a status code are what `api`-kind reports carry."""
    body = _body(kind="api", context={"path": "/teacher/x", "status": 500})
    r = await client.post("/v1/client-errors", json=body)
    assert r.status_code == 204

    row = await _fetch(str(body["fingerprint"]))
    assert row is not None
    assert row.context == {"path": "/teacher/x", "status": 500}
