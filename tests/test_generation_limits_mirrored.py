"""The frontend's copy of the generation limits must match the backend's.

`SourceMaterialPicker` warns the teacher when her selection exceeds what
one generation call can carry ("only 5 files are sent", "these total
32MB, over the 23MB limit"). Those numbers live in Python but have to be
known in the browser to warn *before* she generates, so they're mirrored
in `web/src/lib/constants.ts` — the same way MATERIAL_UPLOAD_MAX_* already
mirrors the upload caps.

Mirrored constants drift. If someone raises MAX_VISION_IMAGES here and
not there, the warning quietly starts lying to the teacher — and a
warning that lies is worse than no warning, because she'll trust it and
stop checking. This test is the thing that makes the mirror safe.
"""

import re
from pathlib import Path

from api.core.document_vision import MAX_TOTAL_SOURCE_B64_BYTES, MAX_VISION_IMAGES

_CONSTANTS_TS = (
    Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "constants.ts"
)


def _read_ts_const(name: str) -> str:
    """Pull `export const NAME = <expr>;` out of the TS constants file."""
    source = _CONSTANTS_TS.read_text()
    match = re.search(rf"export const {name} =\s*(.+?);", source, re.S)
    assert match, f"{name} is missing from {_CONSTANTS_TS.name}"
    return match.group(1).strip()


def _eval_ts_number(expr: str) -> int:
    """Evaluate the small arithmetic literals we allow in these constants.

    Deliberately not a JS engine — it only handles the `A * B`, `(A * B) / C`,
    `Math.floor(...)` shapes the constants file uses, and raises on anything
    else so a fancier expression fails loudly instead of silently passing.
    """
    cleaned = expr.replace("Math.floor(", "(")
    assert re.fullmatch(r"[\d\s*/()+-]+", cleaned), f"unexpected expression: {expr}"
    return int(eval(cleaned))  # noqa: S307 - literal arithmetic, asserted above


def test_frontend_doc_count_limit_matches_backend() -> None:
    assert _eval_ts_number(_read_ts_const("GENERATION_MAX_SOURCE_DOCS")) == (
        MAX_VISION_IMAGES
    )


def test_frontend_size_limit_matches_backend_budget() -> None:
    """The frontend budgets RAW bytes (what `file_size` reports); the
    backend budgets the BASE64 payload. Base64 inflates by 4/3, so the
    frontend number must be the backend's budget scaled back down."""
    frontend_raw = _eval_ts_number(_read_ts_const("GENERATION_MAX_SOURCE_BYTES"))
    expected_raw = MAX_TOTAL_SOURCE_B64_BYTES * 3 // 4
    assert frontend_raw == expected_raw


def test_frontend_upload_caps_match_backend() -> None:
    """The pre-existing mirror, now that something checks the new one."""
    from api.core.constants import MAX_IMAGE_BYTES, MAX_PDF_BYTES

    assert _eval_ts_number(
        _read_ts_const("MATERIAL_UPLOAD_MAX_IMAGE_BYTES")
    ) == MAX_IMAGE_BYTES
    assert _eval_ts_number(
        _read_ts_const("MATERIAL_UPLOAD_MAX_PDF_BYTES")
    ) == MAX_PDF_BYTES
