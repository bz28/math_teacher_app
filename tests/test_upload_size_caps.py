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
    MAX_PDF_BYTES,
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


def _rotated_noisy_image(
    fmt: str,
    noise: int,
    square: bool = False,
    edge: int | None = None,
    **save_kwargs: Any,
) -> str:
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
    width = edge or VISION_MAX_EDGE
    height = width if square else 1176
    img = Image.new("RGB", (width, height))
    pixels = img.load()
    assert pixels is not None
    for y in range(img.height):
        for x in range(img.width):
            value = max(0, min(255, 225 - noise // 2 + random.randint(-noise, noise)))
            pixels[x, y] = (value, value, max(0, value - 4))
    draw = ImageDraw.Draw(img)
    for i in range(height // 38):  # handwriting-ish strokes
        draw.line([(15, 38 * i), (width - 20, 38 * i + 14)], fill=(5, 5, 40), width=5)

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


def test_transport_clears_every_upload_route_not_just_submissions() -> None:
    """The derivation has to cover EVERY endpoint that takes an upload.

    Regression for a bug four rounds missed: the transport floor was
    derived from the student submission alone, so the teacher's document
    upload — same `validate_and_decode_upload`, same base64-in-JSON
    shape, `MAX_PDF_BYTES` per file — had a 33.3MB body against a 31.4MB
    cap and died pre-handler with a bare 413. That is the very bug this
    module exists to prevent, on the route the derivation forgot.
    """
    largest_single_upload = _b64_len(MAX_PDF_BYTES)
    assert MIN_REQUEST_SIZE_BYTES >= largest_single_upload, (
        f"a legal {MAX_PDF_BYTES / 1024 / 1024:.0f}MB upload is a "
        f"{largest_single_upload / 1024 / 1024:.1f}MB body, over the "
        f"{MIN_REQUEST_SIZE_BYTES / 1024 / 1024:.1f}MB transport cap"
    )


def test_the_growth_ceiling_holds_at_the_top_of_the_cap() -> None:
    """What the derivation actually promises, re-inflated.

    Every other test here relates the submission cap UPWARD to the
    request budget. None checked the quantity the guard in
    `extract_student_work` actually measures: the worst-case encoded
    submission AFTER preprocessing may grow by the ceiling. Flooring on
    the way down while base64 ceils on the way back up — and each file
    padding independently — left that ~26 bytes over budget.
    """
    from api.core.constants import VISION_OUTPUT_GROWTH_CEILING

    worst_after_growth = (
        _worst_case_encoded_submission() * VISION_OUTPUT_GROWTH_CEILING
    )
    assert worst_after_growth <= MAX_REQUEST_B64_BYTES, (
        f"a maximal submission assembles {worst_after_growth:,.0f} bytes "
        f"against a {MAX_REQUEST_B64_BYTES:,} budget"
    )


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


def test_any_configured_cap_still_admits_a_maximal_submission() -> None:
    """Never re-break the students unblocked by the hotfix.

    MAX_REQUEST_SIZE=31457280 (30MB) was set in Railway on 2026-09-07 to
    unblock a class mid-deadline. Whatever is configured — that value,
    nothing, or something hostile — the effective cap must still clear a
    maximal submission, because `floor_request_size` only ever raises.
    """
    for configured in (None, 31_457_280, 1024, MIN_REQUEST_SIZE_BYTES * 4):
        kwargs = {} if configured is None else {"max_request_size": configured}
        effective = _settings(**kwargs).max_request_size
        assert effective >= _worst_case_encoded_submission(), (
            f"MAX_REQUEST_SIZE={configured} yields {effective}, below a "
            f"maximal submission"
        )


def test_an_adversarial_cap_filling_submission_stays_under_budget() -> None:
    """The property the guard actually depends on.

    An earlier version asserted per-file growth < the allowance and had
    to be rewritten twice, because the allowance is an AGGREGATE and
    growth is anti-correlated with size: the pages that inflate most
    (small, low-quality JPEGs) are far too small to fill the cap, while
    anything big enough to fill it either downscales or is a PDF passed
    through unchanged.

    So build the worst submission that can actually exist — every page
    slot spent on the highest-growth class, the remaining cap filled
    with PDF bytes, which preprocessing never shrinks — and assert what
    `extract_student_work` will measure stays under the request budget.
    """
    import base64

    from api.core.image_utils import preprocess_image_for_vision

    pages = [
        # 1568 square (legal, 33% more pixels than the earlier fixture)
        # at the noise/quality that measured worst in review.
        _rotated_noisy_image("JPEG", 90, quality=25, square=True)
        for _ in range(MAX_SUBMISSION_FILES - 1)
    ]
    processed = [len(preprocess_image_for_vision(p, "image/jpeg")) for p in pages]

    images_decoded = sum(len(base64.b64decode(p)) for p in pages)
    assert images_decoded < MAX_SUBMISSION_TOTAL_BYTES, (
        "fixture pages already exceed the cap; they cannot model a filler"
    )
    # One PDF spends whatever cap the images left. PDFs skip
    # preprocessing entirely, so they inflate by exactly base64's 4/3 —
    # the worst any large payload can do.
    pdf_decoded = MAX_SUBMISSION_TOTAL_BYTES - images_decoded
    total_sent = sum(processed) + _b64_len(pdf_decoded)

    assert total_sent <= MAX_REQUEST_B64_BYTES, (
        f"a legal submission assembles {total_sent:,} bytes against a "
        f"{MAX_REQUEST_B64_BYTES:,} budget — extract_student_work would "
        f"refuse it as unreadable"
    )


def test_small_images_are_not_exempt_from_the_growth_ceiling() -> None:
    """The shrink floor must not become an enforcement hole.

    Regression for a bug found in review: the floor was 900px, justified
    on the reasoning that an image that small "cannot threaten the
    request budget anyway". It could. A 900px low-quality noisy JPEG
    skipped enforcement and grew 2.7x, and nine of them beside a PDF
    filling the cap assembled 32.9MB against a 31MB budget — a legal
    submission refused as unreadable after the server accepted it.

    This is the third time an assumption that growth and size are
    anti-correlated turned out to be false, so the ceiling is asserted
    directly rather than argued from size.
    """
    from api.core.constants import VISION_OUTPUT_GROWTH_CEILING
    from api.core.image_utils import _SHRINK_FLOOR_EDGE, preprocess_image_for_vision

    for edge in (900, 700, 500):
        assert edge > _SHRINK_FLOOR_EDGE, (
            f"{edge}px no longer sits above the shrink floor; pick sizes that "
            f"still exercise the loop"
        )
        encoded = _rotated_noisy_image(
            "JPEG", 110, square=True, edge=edge, quality=10
        )
        growth = len(preprocess_image_for_vision(encoded, "image/jpeg")) / len(encoded)
        assert growth <= VISION_OUTPUT_GROWTH_CEILING, (
            f"a {edge}px page grew {growth:.2f}x, over the "
            f"{VISION_OUTPUT_GROWTH_CEILING} ceiling the derivation depends on"
        )


@pytest.mark.parametrize(
    "container",
    ["exif", "xmp", "png_text", "jpeg_comment"],
)
def test_no_metadata_container_reaches_the_model(container: str) -> None:
    """Nothing the camera wrote may leave with the image.

    Re-encoding is the only thing that scrubs, and this is the test that
    has to know it. An earlier version asserted on `Image.getexif()` —
    the SAME predicate the code used to decide whether it could skip the
    re-encode — so it was structurally incapable of catching the bug it
    was written to prevent: `getexif()` reads only the Exif container,
    while scan apps write GPS into XMP. Each container here is therefore
    probed by searching the RETURNED BYTES, not by asking Pillow.
    """
    import base64
    import io

    from PIL import Image, PngImagePlugin

    from api.core.image_utils import preprocess_image_for_vision

    secret = b"GPSLatitude-40-44-54-N"
    xmp = (
        b'<?xpacket begin="?"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
        b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        b'<rdf:Description exif:GPSLatitude="' + secret + b'"/>'
        b"</rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
    )

    img = Image.new("RGB", (900, 700), (205, 205, 205))
    buf = io.BytesIO()
    if container == "exif":
        exif = img.getexif()
        exif[0x010F] = secret.decode()
        img.save(buf, format="JPEG", exif=exif)
        media_type = "image/jpeg"
    elif container == "xmp":
        img.save(buf, format="JPEG", xmp=xmp)
        media_type = "image/jpeg"
    elif container == "jpeg_comment":
        img.save(buf, format="JPEG", comment=secret)
        media_type = "image/jpeg"
    else:
        meta = PngImagePlugin.PngInfo()
        meta.add_text("Author", secret.decode())
        img.save(buf, format="PNG", pnginfo=meta)
        media_type = "image/png"

    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    assert secret in base64.b64decode(encoded), "fixture did not embed the metadata"

    returned = base64.b64decode(preprocess_image_for_vision(encoded, media_type))
    assert secret not in returned, (
        f"{container} survived preprocessing and would be sent to Anthropic"
    )


def test_a_small_inflation_does_not_cost_image_quality() -> None:
    """The quality ladder must trigger on magnitude, not on sign.

    Descending a rung costs real fidelity on faint pencil, and
    extraction accuracy on handwriting is what this system does. Paying
    that to claw back a few KB is the wrong trade.

    Asserts the output IS the plain default save — byte for byte — not
    merely that it came out small. An earlier version checked only
    `ratio <= 1.05`, which also holds when the ladder DOES descend, so
    deleting the gate left it green.
    """
    import base64
    import io

    from PIL import Image, ImageOps

    from api.core.image_utils import preprocess_image_for_vision

    encoded = _rotated_noisy_image("JPEG", 20, quality=75)
    processed = preprocess_image_for_vision(encoded, "image/jpeg")

    # What the function produces before any ladder rung is considered.
    source = Image.open(io.BytesIO(base64.b64decode(encoded)))
    ungated = io.BytesIO()
    ImageOps.exif_transpose(source).save(ungated, format="JPEG")

    assert base64.b64decode(processed) == ungated.getvalue(), (
        "the ladder descended on a sub-threshold inflation — a student's "
        "handwriting was re-compressed to save a few KB"
    )


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
