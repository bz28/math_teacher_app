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

from httpx import AsyncClient
from sqlalchemy import text

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
    # watermark advanced to the newest scanned row (the healthy one at +4m).
    assert body["watermark"] == (base + timedelta(minutes=4)).isoformat()


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
