"""Tests for GET /v1/admin/llm-calls/defects — the improver's production-defect
channel.

Covers the pure detection/grouping helpers (no DB) and the endpoint itself: the
admin gate, corruption detection through the JSON-serialized `output_text`,
grouping of recurring defects, and the incremental `since`/`watermark` contract.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.config import settings
from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from api.models.user import User
from api.routes.admin_llm import _corruption_chars, _defect_of, _defect_signature
from tests.conftest import auth_headers

# A corrupt output as it is actually STORED: json.dumps of a parsed result whose
# string was mangled to a formfeed + "rac" — serializes to the escape `\f`.
_CORRUPT = json.dumps({"answer": ["\frac{1}{2}"]})   # non-raw: \f is a formfeed
_CLEAN = json.dumps({"answer": [r"\frac{1}{2}"]})     # raw: a real backslash


# --- pure helpers ---------------------------------------------------------

def test_corruption_chars_parses_json_before_scanning() -> None:
    # Correct LaTeX (escaped backslash in the JSON) is NOT corruption...
    assert _corruption_chars(_CLEAN) == ""
    # ...but a control char hiding inside a parsed string value IS.
    assert _corruption_chars(_CORRUPT) == "\f"
    # Non-JSON free-text falls back to a raw scan.
    assert _corruption_chars("plain \x0c text") == "\f"
    assert _corruption_chars("totally fine") == ""
    assert _corruption_chars(None) == ""


def test_defect_classification() -> None:
    failed = SimpleNamespace(success=False, output_text=None, function="decompose")
    corrupt = SimpleNamespace(success=True, output_text=_CORRUPT, function="decompose")
    healthy = SimpleNamespace(success=True, output_text=_CLEAN, function="decompose")
    assert _defect_of(failed) == ("failed", "")        # type: ignore[arg-type]
    assert _defect_of(corrupt) == ("corrupt", "\f")    # type: ignore[arg-type]
    assert _defect_of(healthy) is None                 # type: ignore[arg-type]


def test_signature_groups_same_defect_and_splits_by_function() -> None:
    a = _defect_signature("decompose", "corrupt", "\f")
    b = _defect_signature("decompose", "corrupt", "\f")
    c = _defect_signature("solve", "corrupt", "\f")        # different function
    d = _defect_signature("decompose", "corrupt", "\r")    # different fingerprint
    assert a == b and a != c and a != d
    assert len(a) == 12


# --- endpoint -------------------------------------------------------------

async def _seed_admin() -> tuple[str, str]:
    """Returns (admin_id, student_id) — both real users so require_admin yields a
    clean 403 for the student rather than a 401 for an unknown id."""
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE llm_calls, users RESTART IDENTITY CASCADE"))
        admin = User(email=f"a_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                     grade_level=99, role="admin", name="A")
        student = User(email=f"s_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                       grade_level=8, role="student", name="S")
        s.add_all([admin, student])
        await s.flush()
        ids = (str(admin.id), str(student.id))
        await s.commit()
    return ids


def _call(*, function: str, output: str | None, success: bool, when: datetime) -> LLMCall:
    return LLMCall(
        function=function, model="claude-sonnet-4-6",
        input_tokens=1, output_tokens=1, latency_ms=10.0, cost_usd=0.0,
        input_text="x", output_text=output, success=success, created_at=when,
    )


async def _seed_calls(calls: list[LLMCall]) -> None:
    async with get_session_factory()() as s:
        s.add_all(calls)
        await s.commit()


async def test_non_admin_forbidden(client: AsyncClient) -> None:
    _, student_id = await _seed_admin()
    student = create_access_token(student_id, "student")
    r = await client.get("/v1/admin/llm-calls/defects", headers=auth_headers(student))
    assert r.status_code == 403


async def test_no_auth_at_all_forbidden(client: AsyncClient) -> None:
    await _seed_admin()
    r = await client.get("/v1/admin/llm-calls/defects")
    assert r.status_code == 403


async def test_service_key_authorizes_without_jwt(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The scheduled CI scanner authenticates with the static service key, NOT a
    # (15-min) admin JWT.
    admin_id, _ = await _seed_admin()
    monkeypatch.setattr(settings, "improver_api_key", "svc-secret-123")
    await _seed_calls([_call(function="solve", output="boom", success=False,
                             when=datetime.now(UTC) - timedelta(minutes=5))])
    r = await client.get("/v1/admin/llm-calls/defects", headers={"X-Improver-Key": "svc-secret-123"})
    assert r.status_code == 200
    assert r.json()["defect_groups"] == 1


async def test_wrong_service_key_forbidden(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _seed_admin()
    monkeypatch.setattr(settings, "improver_api_key", "svc-secret-123")
    r = await client.get("/v1/admin/llm-calls/defects", headers={"X-Improver-Key": "nope"})
    assert r.status_code == 403


async def test_unset_key_rejects_empty_header(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Security guard for the short-circuit: with service-key auth UNSET, an empty
    # X-Improver-Key must NOT authorize — even though compare_digest('', '') is
    # True. The `if key and ...` short-circuit (key="" is falsy) is what prevents
    # the bypass; this regression-tests that the operands never get reordered.
    await _seed_admin()
    monkeypatch.setattr(settings, "improver_api_key", "")
    r = await client.get("/v1/admin/llm-calls/defects", headers={"X-Improver-Key": ""})
    assert r.status_code == 403


async def test_admin_jwt_still_authorizes(client: AsyncClient) -> None:
    # The interactive admin path keeps working even with no service key set.
    admin_id, _ = await _seed_admin()
    token = create_access_token(admin_id, "admin")
    r = await client.get("/v1/admin/llm-calls/defects", headers=auth_headers(token))
    assert r.status_code == 200


async def test_groups_recurring_defects_and_ignores_healthy(client: AsyncClient) -> None:
    admin_id, _ = await _seed_admin()
    base = datetime.now(UTC) - timedelta(hours=1)
    # 3 identical corrupt calls (one group), 1 failed call, 1 healthy (ignored).
    await _seed_calls([
        _call(function="decompose", output=_CORRUPT, success=True, when=base),
        _call(function="decompose", output=_CORRUPT, success=True, when=base + timedelta(minutes=1)),
        _call(function="decompose", output=_CORRUPT, success=True, when=base + timedelta(minutes=2)),
        _call(function="solve", output="boom", success=False, when=base + timedelta(minutes=3)),
        _call(function="solve", output=_CLEAN, success=True, when=base + timedelta(minutes=4)),
    ])
    token = create_access_token(admin_id, "admin")
    r = await client.get("/v1/admin/llm-calls/defects?hours=24", headers=auth_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["defect_groups"] == 2           # corrupt(decompose) + failed(solve); healthy ignored
    by_count = {d["function"]: d for d in body["defects"]}
    assert by_count["decompose"]["count"] == 3  # the 3 recurring corrupts collapsed
    assert by_count["decompose"]["kind"] == "corrupt"
    assert by_count["solve"]["count"] == 1 and by_count["solve"]["kind"] == "failed"
    # watermark is a composite cursor "<iso>|<id>" of the newest scanned row
    # (the healthy one at +4m).
    assert body["watermark"].startswith((base + timedelta(minutes=4)).isoformat() + "|")


async def test_since_filters_older_rows(client: AsyncClient) -> None:
    admin_id, _ = await _seed_admin()
    old = datetime.now(UTC) - timedelta(hours=5)
    new = datetime.now(UTC) - timedelta(minutes=5)
    await _seed_calls([
        _call(function="decompose", output=_CORRUPT, success=True, when=old),
        _call(function="solve", output="boom", success=False, when=new),
    ])
    token = create_access_token(admin_id, "admin")
    cutoff = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    r = await client.get("/v1/admin/llm-calls/defects", params={"since": cutoff}, headers=auth_headers(token))
    assert r.status_code == 200
    body = r.json()
    assert body["defect_groups"] == 1 and body["defects"][0]["function"] == "solve"


async def test_invalid_since_400(client: AsyncClient) -> None:
    admin_id, _ = await _seed_admin()
    token = create_access_token(admin_id, "admin")
    r = await client.get("/v1/admin/llm-calls/defects?since=not-a-date", headers=auth_headers(token))
    assert r.status_code == 400


async def test_naive_since_does_not_crash(client: AsyncClient) -> None:
    # Regression: an offset-less ISO `since` used to TypeError (500) when compared
    # against the tz-aware created_at. It must be treated as UTC.
    admin_id, _ = await _seed_admin()
    await _seed_calls([_call(function="solve", output="boom", success=False,
                             when=datetime.now(UTC) - timedelta(minutes=5))])
    token = create_access_token(admin_id, "admin")
    naive = (datetime.now(UTC) - timedelta(hours=1)).replace(tzinfo=None).isoformat()
    r = await client.get("/v1/admin/llm-calls/defects", params={"since": naive}, headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["defect_groups"] == 1


async def test_keyset_paging_never_skips_duplicate_timestamps(client: AsyncClient) -> None:
    # Regression: three defects sharing the EXACT same created_at, paged at
    # limit=2. A created_at-only strict-`>` cursor would drop the row beyond the
    # limit that shares the boundary timestamp; the composite (created_at, id)
    # cursor must drain all three.
    admin_id, _ = await _seed_admin()
    ts = datetime.now(UTC) - timedelta(minutes=10)
    await _seed_calls([
        _call(function="solve", output="boom", success=False, when=ts),
        _call(function="decompose", output="boom", success=False, when=ts),
        _call(function="grade", output="boom", success=False, when=ts),
    ])
    token = create_access_token(admin_id, "admin")
    cursor: str | None = (ts - timedelta(seconds=1)).isoformat()
    seen: set[str] = set()
    for _ in range(5):  # bounded; should drain in 2 pages of 2
        r = await client.get("/v1/admin/llm-calls/defects",
                             params={"since": cursor, "limit": 2}, headers=auth_headers(token))
        assert r.status_code == 200
        body = r.json()
        if body["scanned"] == 0:
            break
        seen.update(d["function"] for d in body["defects"])
        cursor = body["watermark"]
    assert seen == {"solve", "decompose", "grade"}  # none skipped across pages
