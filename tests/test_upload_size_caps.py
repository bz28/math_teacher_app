"""The upload size caps must stay derived from one another.

These are the regression tests for a live incident: the transport cap
(`Settings.max_request_size`, 10MB, written with the original scaffold)
and the submission cap (`MAX_SUBMISSION_TOTAL_BYTES`, 50MB, added eight
weeks later) were independent literals with no relationship. Files
travel base64 inside JSON (~4/3 inflation), so the real ceiling was
~7.5MB of photo rather than the advertised 50MB, and students hit an
opaque 413 on their phones while the endpoint's own 50MB check sat
unreachable behind the smaller middleware limit.

Every test here asserts a RELATIONSHIP rather than a value, so the
numbers stay free to move and the chain between them cannot silently
break again.
"""

from __future__ import annotations

import math
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.config import Settings
from api.core.constants import (
    ANTHROPIC_MAX_REQUEST_BYTES,
    MAX_REQUEST_B64_BYTES,
    MAX_SUBMISSION_FILES,
    MAX_SUBMISSION_TOTAL_BYTES,
    MIN_REQUEST_SIZE_BYTES,
)

# Bound at import, which happens at collection — BEFORE conftest's
# autouse `_mock_integrity_ai` fixture replaces the module attribute
# with an AsyncMock. These two tests are the only ones in the suite that
# need the real Vision wrapper; everything else wants the mock.
from api.core.integrity_ai import extract_student_work as _real_extract_student_work


def _b64_len(decoded_bytes: int) -> int:
    """Exact base64 length of `decoded_bytes` raw bytes, with padding."""
    return 4 * math.ceil(decoded_bytes / 3)


def _worst_case_encoded_submission() -> int:
    """Encoded size of a maximal submission, split to maximise padding.

    Each file pads independently, so the same total decoded bytes cost
    more encoded when spread across the maximum file count.
    """
    per_file = MAX_SUBMISSION_TOTAL_BYTES // MAX_SUBMISSION_FILES
    remainder = MAX_SUBMISSION_TOTAL_BYTES - per_file * (MAX_SUBMISSION_FILES - 1)
    return sum(
        _b64_len(n) for n in [per_file] * (MAX_SUBMISSION_FILES - 1) + [remainder]
    )


# ── The derivation chain ────────────────────────────────────────────


def test_maximal_submission_round_trips_under_the_anthropic_cap() -> None:
    """A submission we ACCEPT must be one Vision can actually read.

    Files are stored base64 and forwarded base64, so the decoded cap
    re-inflates by 4/3 on the way into the request budget. A submission
    cap above this would take homework the model can never see.
    """
    assert _worst_case_encoded_submission() < MAX_REQUEST_B64_BYTES
    assert MAX_REQUEST_B64_BYTES < ANTHROPIC_MAX_REQUEST_BYTES


def test_transport_cap_clears_a_maximal_submission() -> None:
    """The middleware must not reject what the endpoint would accept.

    This is the exact inversion that produced the incident: a body-size
    limit BELOW the largest legal submission rejects real homework
    before any handler runs, so the student gets a bare 413 with none of
    the endpoint's explanatory message.
    """
    assert MIN_REQUEST_SIZE_BYTES >= _worst_case_encoded_submission()


def test_endpoint_total_size_check_is_reachable() -> None:
    """The endpoint's own cap must be able to fire.

    Before the fix it could not: triggering it needed >50MB decoded
    (>66MB encoded) against a 10MB middleware cap, so it was dead code
    that had never run once in production. There must be a real window
    where a body passes the middleware and is then rejected by the
    endpoint with its useful message.
    """
    smallest_rejected_body = _b64_len(MAX_SUBMISSION_TOTAL_BYTES + 1)
    assert smallest_rejected_body < MIN_REQUEST_SIZE_BYTES, (
        "no payload can reach the endpoint's size check — it is dead code"
    )


def test_derived_caps_do_not_regress_below_the_live_mitigation() -> None:
    """Never re-break the students unblocked by the hotfix.

    MAX_REQUEST_SIZE=31457280 (30MB) was set in Railway on 2026-09-07 to
    unblock a class mid-deadline. Deriving the cap must raise it, not
    quietly lower it back under that.
    """
    live_mitigation_bytes = 31_457_280
    assert MIN_REQUEST_SIZE_BYTES >= live_mitigation_bytes


# ── The env override may raise the cap, never lower it ──────────────


def _settings(**overrides: Any) -> Settings:
    base = {
        "database_url": "postgresql+asyncpg://x:x@localhost:5432/x",
        "jwt_secret": "test-secret",
        "claude_api_key": "sk-ant-test",
    }
    return Settings(**{**base, **overrides})  # type: ignore[arg-type]


def test_default_request_size_is_the_derived_floor() -> None:
    assert _settings().max_request_size == MIN_REQUEST_SIZE_BYTES


def test_too_small_override_is_clamped_up() -> None:
    """A stale override must not recreate the bug.

    Clamped rather than rejected on purpose: this validator runs at
    import, so raising would make a bad env value unbootable, and a
    server that won't start is worse than a widened limit.
    """
    assert (
        _settings(max_request_size=10 * 1024 * 1024).max_request_size
        == MIN_REQUEST_SIZE_BYTES
    )


def test_larger_override_is_preserved() -> None:
    """Raising the cap stays possible — a bigger box, a future format."""
    roomier = MIN_REQUEST_SIZE_BYTES * 2
    assert _settings(max_request_size=roomier).max_request_size == roomier


# ── The vision call refuses rather than truncating ──────────────────


class _StubResult:
    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar_one_or_none(self) -> Any:
        return self._value


class _StubSession:
    """Minimal stand-in: extract_student_work only reads Submission.files."""

    def __init__(self, files: Any) -> None:
        self._files = files

    async def execute(self, *_args: Any, **_kwargs: Any) -> _StubResult:
        return _StubResult(self._files)


@pytest.mark.asyncio
async def test_oversized_submission_refuses_instead_of_dropping_pages() -> None:
    """Over budget must mean "couldn't read it", not a partial read.

    Dropping the pages that don't fit would grade a student on work the
    model never saw, with nothing telling them or the teacher. The
    unreadable sentinel routes through the existing gate to
    `record_unreadable_grading_skip`, which surfaces "needs manual
    grading" and fabricates no score.
    """
    from api.core import integrity_ai

    # PDFs pass through vision preprocessing untouched, so they are the
    # only page type that can reach the budget. Shrink the budget rather
    # than building a 32MB fixture.
    files = [
        {"data": "A" * 400, "media_type": "application/pdf"},
        {"data": "B" * 400, "media_type": "application/pdf"},
    ]
    with (
        patch.object(integrity_ai, "MAX_REQUEST_B64_BYTES", 500),
        patch.object(
            integrity_ai, "call_claude_vision", new_callable=AsyncMock
        ) as vision,
    ):
        result = await _real_extract_student_work(
            uuid.uuid4(), _StubSession(files),  # type: ignore[arg-type]
        )

    assert result == {"steps": [], "final_answers": [], "confidence": 0.0}
    assert result["confidence"] < integrity_ai.UNREADABLE_THRESHOLD, (
        "must fall under the unreadable gate so the teacher is told"
    )
    vision.assert_not_awaited()


@pytest.mark.asyncio
async def test_within_budget_submission_still_reaches_vision() -> None:
    """The guard must not fire on work that fits."""
    from api.core import integrity_ai

    files = [{"data": "A" * 40, "media_type": "application/pdf"}]
    with (
        patch.object(integrity_ai, "MAX_REQUEST_B64_BYTES", 500),
        patch.object(
            integrity_ai,
            "call_claude_vision",
            new_callable=AsyncMock,
            return_value={"steps": [], "final_answers": [], "confidence": 0.9},
        ) as vision,
    ):
        result = await _real_extract_student_work(
            uuid.uuid4(), _StubSession(files),  # type: ignore[arg-type]
        )

    vision.assert_awaited_once()
    assert result["confidence"] == 0.9


# ── No module may keep a private copy of the shared budget ──────────


def test_document_vision_shares_the_request_budget() -> None:
    """Teacher documents and student submissions spend one allowance.

    document_vision used to define its own `_ANTHROPIC_MAX_REQUEST_BYTES`.
    Restating the limit per module is how the caps drifted apart in the
    first place.
    """
    from api.core import document_vision

    assert document_vision.MAX_TOTAL_SOURCE_B64_BYTES == MAX_REQUEST_B64_BYTES
