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


def _rotated_noisy_image(fmt: str, noise: int, **save_kwargs: Any) -> str:
    """A page that forces the re-encode path, returned as base64.

    Sensor noise plus an EXIF rotation is the hostile combination: the
    rotation makes a re-encode unavoidable, and noisy content compresses
    differently once rotated, so this is where growth actually happens.
    Sized at/below VISION_MAX_EDGE so no downscale masks the effect.
    """
    import base64
    import io
    import random

    from PIL import Image, ImageDraw

    from api.core.image_utils import VISION_MAX_EDGE

    random.seed(7)
    img = Image.new("RGB", (VISION_MAX_EDGE, 1176))
    pixels = img.load()
    assert pixels is not None
    for y in range(img.height):
        for x in range(img.width):
            value = 225 + random.randint(-noise, noise)
            pixels[x, y] = (value, value, max(0, value - 4))
    draw = ImageDraw.Draw(img)
    for i in range(30):  # handwriting-ish strokes
        draw.line([(20, 38 * i), (1540, 38 * i + 16)], fill=(5, 5, 40), width=5)

    exif = img.getexif()
    exif[0x0112] = 6  # rotate 90 — forces the re-encode
    buf = io.BytesIO()
    img.save(buf, format=fmt, exif=exif, **save_kwargs)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _worst_case_encoded_submission() -> int:
    """Encoded size of a maximal submission, split to maximise padding.

    Each file pads independently, so the same decoded total costs more
    encoded when spread across the maximum file count. Sizes are nudged
    to `n % 3 == 1`, the remainder that wastes the most padding — an
    even split happens to land on a multiple of 3 and pad nothing, which
    is the BEST case, not the worst.
    """
    per_file = MAX_SUBMISSION_TOTAL_BYTES // MAX_SUBMISSION_FILES
    per_file -= (per_file - 1) % 3  # drop to the nearest n % 3 == 1
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


def test_live_mitigation_still_admits_a_maximal_submission() -> None:
    """Never re-break the students unblocked by the hotfix.

    MAX_REQUEST_SIZE=31457280 (30MB) was set in Railway on 2026-09-07 to
    unblock a class mid-deadline. The derived floor sits slightly BELOW
    it (the preprocessing-growth allowance costs ~2MB), and that is
    fine — `floor_request_size` only ever raises, so the override still
    wins and the live cap does not drop. What must hold is that the
    override still clears a maximal submission.
    """
    live_mitigation_bytes = 31_457_280
    effective = _settings(max_request_size=live_mitigation_bytes).max_request_size
    assert effective == live_mitigation_bytes, "clamp must not lower a larger override"
    assert effective >= _worst_case_encoded_submission()


def test_preprocessing_growth_stays_inside_the_budgeted_allowance() -> None:
    """The guard budgets bytes measured AFTER vision preprocessing.

    This is the regression for a bug found in review: the original slack
    was 64KB (0.20% of the cap) and justified as covering base64 padding
    — but `extract_student_work` accumulates AFTER
    `preprocess_image_for_vision`, which RE-ENCODES. A rotated image
    genuinely compresses differently, so real submissions overflowed a
    padding-sized allowance and were told "couldn't read this".

    Uses real images through the real function rather than arithmetic,
    because the arithmetic was exactly what was wrong.

    Covers BOTH formats. An earlier version of this test used only PNG
    and passed for the wrong reason: PNG is the format where the dense
    retry reliably beats PIL's default, while a low-quality source JPEG
    was the case that actually blew the budget (+35%).
    """
    from api.core.image_utils import preprocess_image_for_vision

    headroom = MAX_REQUEST_B64_BYTES / (MAX_SUBMISSION_TOTAL_BYTES * 4 / 3)

    for fmt, media_type, save_kwargs, noise, label in (
        ("PNG", "image/png", {"compress_level": 9}, 30, "PNG level=9"),
        ("JPEG", "image/jpeg", {"quality": 25}, 35, "JPEG q25 (worst measured)"),
        ("JPEG", "image/jpeg", {"quality": 45}, 60, "JPEG q45, heavy noise"),
    ):
        encoded = _rotated_noisy_image(fmt, noise, **save_kwargs)
        growth = len(preprocess_image_for_vision(encoded, media_type)) / len(encoded)
        assert growth < headroom, (
            f"{label}: preprocessing grew {(growth - 1) * 100:.1f}% but the "
            f"derivation budgets only {(headroom - 1) * 100:.1f}% — a legal "
            f"submission would be refused as unreadable"
        )


def test_images_needing_no_work_are_not_re_encoded() -> None:
    """A no-op re-encode is pure inflation, paid twice.

    PIL's save defaults are weaker than most scanners', so passing an
    already-good image through cost up to +37% — against the request
    budget AND in vision tokens — for an identical picture.
    """
    import base64
    import io

    from PIL import Image, ImageDraw

    from api.core.image_utils import preprocess_image_for_vision

    img = Image.new("L", (1200, 1500), 255)
    draw = ImageDraw.Draw(img)
    for i in range(40):
        draw.line([(50, 40 * i), (1150, 40 * i + 20)], fill=0, width=3)
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=9, optimize=True)

    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    assert preprocess_image_for_vision(encoded, "image/png") is encoded


@pytest.mark.parametrize(
    ("orientation", "expect_untouched"),
    [
        (None, True),  # no EXIF at all
        (0, True),  # written by some Android stacks / EXIF strippers
        (1, True),  # explicitly "normal"
        (9, True),  # out of range — exif_transpose ignores it
        (6, False),  # a real rotation: must be applied
    ],
)
def test_only_transposable_orientations_trigger_a_re_encode(
    orientation: int | None, expect_untouched: bool
) -> None:
    """Skip the re-encode for every orientation that is a no-op.

    `ImageOps.exif_transpose` only transforms 2-8. Testing for
    "absent or 1" would re-encode an Orientation=0 image for nothing —
    exactly the inflation the passthrough exists to avoid.
    """
    import base64
    import io

    from PIL import Image

    from api.core.image_utils import preprocess_image_for_vision

    img = Image.new("RGB", (800, 600), (200, 200, 200))
    buf = io.BytesIO()
    save_kwargs = {}
    if orientation is not None:
        exif = img.getexif()
        exif[0x0112] = orientation
        save_kwargs["exif"] = exif
    img.save(buf, format="PNG", **save_kwargs)

    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    untouched = preprocess_image_for_vision(encoded, "image/png") is encoded
    assert untouched is expect_untouched


def test_passthrough_never_forwards_what_the_save_used_to_normalise() -> None:
    """The optimisation must not change what the model receives.

    Before the passthrough, every image was re-encoded, which silently
    normalised two awkward classes: CMYK JPEGs (whose Adobe APP14
    inversion marker not every decoder honours) and multi-frame files
    (APNG / MPO bursts, collapsed to frame one). Forwarding those raw
    would be a new behaviour, not a saved re-encode.
    """
    import base64
    import io

    from PIL import Image

    from api.core.image_utils import preprocess_image_for_vision

    cmyk = io.BytesIO()
    Image.new("CMYK", (800, 600)).save(cmyk, format="JPEG")
    cmyk_b64 = base64.b64encode(cmyk.getvalue()).decode("ascii")
    assert preprocess_image_for_vision(cmyk_b64, "image/jpeg") is not cmyk_b64

    animated = io.BytesIO()
    Image.new("RGB", (400, 300), (10, 20, 30)).save(
        animated,
        format="PNG",
        save_all=True,
        append_images=[Image.new("RGB", (400, 300), (90, 80, 70))],
    )
    animated_b64 = base64.b64encode(animated.getvalue()).decode("ascii")
    assert preprocess_image_for_vision(animated_b64, "image/png") is not animated_b64


# ── The env override may raise the cap, never lower it ──────────────


def _settings(**overrides: Any) -> Settings:
    base = {
        # `_env_file=None` matches tests/test_config.py: without it
        # Settings honours model_config["env_file"] = ".env", and the
        # repo's own .env carries MAX_REQUEST_SIZE — so asserting on the
        # derived default would go red for anyone who has the live
        # mitigation set locally, testing their shell instead of the code.
        "_env_file": None,
        "database_url": "postgresql+asyncpg://x:x@localhost:5432/x",
        "jwt_secret": "test-secret",
        "claude_api_key": "sk-ant-test",
    }
    return Settings(**{**base, **overrides})  # type: ignore[arg-type]


def test_default_request_size_is_the_derived_floor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The unconfigured default is the derivation, not a literal.

    `_env_file=None` stops Settings reading the repo's .env, but
    pydantic-settings still reads the real environment — and
    MAX_REQUEST_SIZE is set in production and on any machine carrying
    the live mitigation. Clear it so this asserts the code's default
    rather than whatever shell the suite happens to run in.
    """
    monkeypatch.delenv("MAX_REQUEST_SIZE", raising=False)
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
