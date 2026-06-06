"""Tests for POST /v1/admin/harness-runs/ingest — the service-authenticated
write path that lets CI populate the admin 'Harness Runs' tab.

Covers the not-configured (503), missing/bad token (401), oversized report
(413), and the happy path (201 + row written). No user session is involved —
auth is the shared X-Harness-Token secret.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from api.config import settings
from api.database import get_session_factory
from api.models.harness_run import HarnessRun

_SECRET = "harness_test_secret"
_PAYLOAD = {
    "probe": "improver", "mode": "plan",
    "items_generated": 3, "captures": 5, "det_pass": 5, "det_total": 6,
    "judge_count": 0, "judge_mean": None, "cost_usd": None,
    "passed": True, "note": "3 proposals · 5/6 surfaces loaded · 2 hits",
    "report_html": "<pre>digest</pre>",
}


@pytest.fixture(autouse=True)
async def _setup(monkeypatch: pytest.MonkeyPatch) -> None:
    # Feature on by default; the 503 test overrides to empty.
    monkeypatch.setattr(settings, "harness_ingest_token", _SECRET)
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE harness_runs RESTART IDENTITY CASCADE"))
        await s.commit()


async def test_not_configured_returns_503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "harness_ingest_token", "")
    r = await client.post(
        "/v1/admin/harness-runs/ingest", json=_PAYLOAD,
        headers={"X-Harness-Token": _SECRET},
    )
    assert r.status_code == 503


async def test_missing_token_returns_401(client: AsyncClient) -> None:
    r = await client.post("/v1/admin/harness-runs/ingest", json=_PAYLOAD)
    assert r.status_code == 401


async def test_bad_token_returns_401(client: AsyncClient) -> None:
    r = await client.post(
        "/v1/admin/harness-runs/ingest", json=_PAYLOAD,
        headers={"X-Harness-Token": "wrong"},
    )
    assert r.status_code == 401


async def test_oversized_report_returns_413(client: AsyncClient) -> None:
    payload = {**_PAYLOAD, "report_html": "x" * (512 * 1024 + 1)}
    r = await client.post(
        "/v1/admin/harness-runs/ingest", json=payload,
        headers={"X-Harness-Token": _SECRET},
    )
    assert r.status_code == 413


async def test_valid_ingest_writes_row(client: AsyncClient) -> None:
    r = await client.post(
        "/v1/admin/harness-runs/ingest", json=_PAYLOAD,
        headers={"X-Harness-Token": _SECRET},
    )
    assert r.status_code == 201
    assert "id" in r.json()

    async with get_session_factory()() as s:
        rows = (await s.execute(select(HarnessRun))).scalars().all()
    assert len(rows) == 1
    assert rows[0].probe == "improver"
    assert rows[0].items_generated == 3
    assert rows[0].passed is True
    assert rows[0].report_html == "<pre>digest</pre>"


async def test_harness_payloads_match_ingest_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    """The field dicts the harness builds must satisfy the endpoint's schema.
    Producer (tests/harness) and consumer (api) live in different layers, so
    this guards against silent drift between them."""
    from api.routes.admin_harness import HarnessRunIngest
    from tests.harness.improver import report as rpt

    captured: dict[str, object] = {}

    async def fake_deliver(fields: dict[str, object], **_: object) -> bool:
        captured["fields"] = fields
        return True

    monkeypatch.setattr(rpt, "deliver_harness_run", fake_deliver)

    await rpt.persist_scan_summary(
        scanned=1, total=2, hits=0, proposals=3, report_html="<pre/>",
        cost_usd=None, mode="plan", summary_url="x",
    )
    HarnessRunIngest(**captured["fields"])  # raises on drift

    await rpt.persist_execute_summary(
        proposal_id="abc", title="t", pr_url="http://x", summary_url="x",
    )
    HarnessRunIngest(**captured["fields"])
