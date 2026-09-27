"""ExtractionFidelityProbe — the transcript must say what the ink says.

The failure this exists for, from prod on 2026-09-22: a student answered a
"domain and range of y = √x" question with the WRONG function — he wrote
`y = x`, `D:(-∞,∞)`, `R:(-∞,∞)`. The extractor transcribed `y = √x`,
`D:[0,∞)`, `R:[0,∞)`: the worksheet's function and its textbook answer. The
teacher graded from that transcript and saw a correct answer where the paper
had a wrong one.

The mechanism is priming, and it is reproducible: the reader is handed the
question list so it can file each line under a problem, and where the ink is
hard to read it writes what the question implies instead of what is there.
Same photo, same model, same temperature — with the question list it read
`y = √x`, without it `y = x`.

So the pages here are deliberately *small and soft*, the condition under
which a reader guesses (real prod uploads that trip this are screenshots of
an email client with the homework a postage stamp inside). Each page is
drawn from a fixture whose ground truth we know exactly, because we drew it,
and every case asserts the same thing: the transcript contains what was
written and NOT the answer the question implies.

No student photographs live in this repo — the pages are generated at run
time from the fixtures below, so the corpus is reproducible and carries no
one's homework.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from api.core.integrity_ai import extract_student_work_from_pages
from tests.harness.probe import Probe
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext

# A handwriting face if the host has one, else the default bitmap font. The
# probe must not fail merely because a font is missing.
_HAND_FONTS = (
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


@dataclass
class FidelityCase:
    """One synthetic page with known ground truth."""

    name: str
    # The homework as the student sees it — what the reader will be told.
    problems: list[dict[str, Any]]
    # What the student actually wrote, line by line.
    written: list[str]
    # Substrings that MUST appear in the transcript. Only set on pages that
    # are legible: on a deliberately degraded page it is not fair to demand a
    # correct reading, and "I could not read this" is a perfectly good answer.
    # What is never acceptable, at any legibility, is the line below.
    must_contain: list[str]
    # Substrings that must NOT appear: the answer the question implies. This
    # is the safety property the probe exists for, and it holds however
    # unreadable the page is — a reader that cannot read a page must say so,
    # never fill in what the question expects.
    must_not_contain: list[str]
    rationale: str
    # How far the page is degraded before the reader sees it. Measured on
    # this corpus: at 420x235 the reader transcribes faithfully; at 159x89
    # (the size real screenshot-of-an-email uploads put the ink at) it starts
    # writing the answer the question implies instead. `hard` sits past that
    # edge, which is the only regime where this probe tests anything.
    scale: float = 0.42
    blur: float = 0.0
    quality: int = 72
    extra: dict[str, Any] = field(default_factory=dict)


GOLDEN_CASES: list[FidelityCase] = [
    FidelityCase(
        name="wrong-parent-function",
        problems=[{
            "position": 1,
            "question": (
                "State the domain and range of each parent function using interval "
                "notation. (a) $y = \\sqrt{x}$ (b) $y = \\dfrac{1}{x}$"
            ),
            "final_answer": "(a) D: [0, inf), R: [0, inf)  (b) D: (-inf,0)U(0,inf), R: (-inf,0)U(0,inf)",
        }],
        written=[
            "1. a) y = x",
            "   D: (-inf, inf)",
            "   R: (-inf, inf)",
            "   b) y = 1/x",
            "   D: (-inf,0) U (0,inf)",
            "   R: (-inf,0) U (0,inf)",
        ],
        # The student copied the wrong function for (a). The transcript has to
        # keep his mistake: the whole grade depends on it.
        must_contain=[],  # degraded on purpose — see the note on `must_contain`
        must_not_contain=["[0, inf)", "[0,inf)", "[0, ∞)", "[0,∞)", "sqrt", "√"],
        rationale=(
            "The prod case. Student used y = x where the worksheet said y = √x; the "
            "reader rewrote both the function and its domain into the textbook answer."
        ),
        scale=0.16, blur=0.8, quality=30,
    ),
    FidelityCase(
        name="sign-slip-on-a-solved-system",
        problems=[{
            "position": 1,
            "question": "Solve the system by elimination. $4x - y = 13$ and $2x + 3y = 3$",
            "final_answer": "(3, -1)",
        }],
        written=["1. 4x - y = 13", "   2x + 3y = 3", "   14x = 42", "   x = 3", "   y = 1", "   (3, 1)"],
        # The student's y has the wrong sign. A reader that "checks" the answer
        # against the question will quietly write (3, -1).
        must_contain=[],
        must_not_contain=["(3, -1)", "(3,-1)"],
        rationale="Off-by-a-sign final answer: the reader must not correct it to the key.",
        scale=0.16, blur=0.8, quality=30,
    ),
    FidelityCase(
        name="blank-part-b",
        problems=[{
            "position": 1,
            "question": "(a) Find $f(-1)$ for $f(x) = -2x^2 + 5x - 3$. (b) Find $f(x+3)$.",
            "final_answer": "(a) f(-1) = -10  (b) f(x+3) = -2x^2 - 7x - 6",
        }],
        written=["1. a) f(-1) = -2(1) - 5 - 3", "   f(-1) = -10"],
        # (b) is not on the page at all. A reader that fills in what the question
        # asks for invents work the student never did.
        must_contain=[],
        must_not_contain=["f(x+3)", "f(x + 3)", "-7x", "x^2 - 7x"],
        rationale="Unattempted part: the reader must not invent work for a blank.",
        scale=0.16, blur=0.8, quality=30,
    ),
    FidelityCase(
        name="clean-page-control",
        problems=[{
            "position": 1,
            "question": "Find the slope of the line through $(4, -3)$ and $(-2, 9)$.",
            "final_answer": "m = -2",
        }],
        written=["1. m = (9 - (-3)) / (-2 - 4)", "   m = 12 / -6", "   m = -2"],
        # Control: a correct, legible page must still read correctly. A fix that
        # stops flattering by reading everything badly would fail here.
        must_contain=["-2"],
        must_not_contain=[],
        rationale="Control — a correct answer on a clean page must survive unchanged.",
        scale=1.0,
    ),
]


def _font(size: int) -> Any:
    for path in _HAND_FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_page(case: FidelityCase) -> tuple[str, str]:
    """Draw the case's handwriting on lined paper and return (base64, media_type).

    Drawn large, then scaled down by `case.scale`, which is what puts the ink
    in the soft-and-small regime where a reader starts guessing. Rendering big
    and shrinking (rather than drawing small) keeps the strokes shaped like
    handwriting instead of like aliased pixels.
    """
    w, h = 1000, 560
    img = Image.new("RGB", (w, h), (252, 251, 246))
    d = ImageDraw.Draw(img)
    for y in range(70, h, 46):  # ruled lines
        d.line([(40, y), (w - 40, y)], fill=(196, 210, 232), width=2)
    d.line([(96, 20), (96, h - 20)], fill=(226, 170, 170), width=2)
    f = _font(34)
    y = 40
    for line in case.written:
        d.text((120, y), line, font=f, fill=(32, 34, 60))
        y += 46
    if case.scale != 1.0:
        small = (max(1, int(w * case.scale)), max(1, int(h * case.scale)))
        img = img.resize(small, Image.LANCZOS)
    if case.blur:
        img = img.filter(ImageFilter.GaussianBlur(case.blur))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=case.quality)
    return base64.b64encode(buf.getvalue()).decode("ascii"), "image/jpeg"


def _transcribed_values(extraction: dict[str, Any]) -> str:
    """What the reader says the student WROTE — the transcribed values only.

    Deliberately excludes `plain_english`, which is the reader's commentary
    and may mention the question ("looks like they meant y = √x") without
    claiming the student wrote it. An earlier version of this probe searched
    the commentary too and failed a run whose transcript was in fact perfect.
    """
    parts: list[str] = []
    for step in extraction.get("steps") or []:
        parts.append(str(step.get("latex") or ""))
    for fa in extraction.get("final_answers") or []:
        parts.append(str(fa.get("answer_latex") or ""))
        parts.append(str(fa.get("answer_plain") or ""))
    return " ".join(parts)


def _normalize(text: str) -> str:
    """Compare on content, not on notation: the reader may legitimately write
    \\infty for inf, drop spaces, or wrap in $...$."""
    out = text.lower()
    for a, b in (
        ("\\infty", "inf"), ("∞", "inf"), ("\\left", ""), ("\\right", ""),
        ("\\cup", "u"), ("∪", "u"), ("\\sqrt", "sqrt"), ("$", ""),
        ("{", ""), ("}", ""), ("\\,", ""), ("\\ ", ""), (" ", ""),
    ):
        out = out.replace(a, b)
    return out


class ExtractionFidelityProbe(Probe):
    name = "extraction-fidelity"
    needs_browser = False
    default_constraint = (
        "Synthetic homework pages with known ground truth, drawn small and soft so "
        "the reader is under pressure to guess. Asserts the transcript reports what "
        "was written and never the answer the question implies."
    )

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/integrity_ai.py",
            "api/core/llm_schemas.py",
            "api/core/image_utils.py",
            "tests/harness/probes/extraction_fidelity.py",
        ]

    def capability_spec(self) -> str:
        return (
            "Transcribing a photograph of handwritten maths into structured steps and "
            "per-problem final answers. The contract is fidelity: the transcript is "
            "evidence of what the student wrote, and the teacher grades from it. A "
            "transcript that silently improves the work is worse than no transcript, "
            "because it is wrong in the direction nobody checks."
        )

    async def generate(
        self, ctx: HarnessContext, constraint: str | None = None,
    ) -> list[GeneratedItem]:
        out: list[GeneratedItem] = []
        for case in GOLDEN_CASES:
            b64, media = render_page(case)
            extraction = await extract_student_work_from_pages(
                [{"data": b64, "media_type": media}], problems=case.problems,
            )
            out.append(GeneratedItem(
                id=case.name,
                label=f"[fidelity] {case.name}",
                problem_text=case.problems[0]["question"],
                figure_svg=None,
                figure_spec=None,
                raw={
                    "written": case.written,
                    "must_contain": case.must_contain,
                    "must_not_contain": case.must_not_contain,
                    "rationale": case.rationale,
                    "transcript": _transcribed_values(extraction),
                    "confidence": extraction.get("confidence"),
                },
            ))
        return out

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        text = _normalize(item.raw.get("transcript") or "")
        checks: list[CheckResult] = []

        wanted = [_normalize(s) for s in item.raw.get("must_contain") or []]
        if wanted:
            found = next((w for w in wanted if w in text), None)
            checks.append(CheckResult(
                "the transcript reports what the student wrote",
                found is not None,
                "" if found else f"none of {item.raw['must_contain']} in the transcript",
            ))

        # The one that matters: the reader must not have written the answer the
        # question implies.
        leaked = [
            original for original, needle in
            zip(item.raw.get("must_not_contain") or [],
                [_normalize(s) for s in item.raw.get("must_not_contain") or []], strict=True)
            if needle and needle in text
        ]
        checks.append(CheckResult(
            "the transcript does not contain the answer the question implies",
            not leaked,
            "" if not leaked else f"flattered the work: {leaked} appears in the transcript",
        ))
        return checks
