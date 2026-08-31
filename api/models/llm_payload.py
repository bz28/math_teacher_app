from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class LLMPayload(Base):
    """A static payload an LLM call sent, stored once per distinct text.

    Two kinds, and both were previously unrecorded:

      * ``system_prompt`` — the rubric, the guardrails, the spec.
      * ``tool_schema`` — the output contract the model is forced into.
        On a measured call this was **656 of 962 input tokens**, larger
        than the system prompt itself, and it defines the shape of the
        answer (the deduction ledger, the score fields). A grade you
        cannot explain is often a grade whose schema you cannot see.

    ## Why this table exists

    `llm_calls.input_text` holds the user message and nothing else
    (`llm_client._log_and_persist`), while every call also sends a system
    prompt that we never recorded. Measured across a real call log, the
    stored half is **0.7%-15% of the tokens actually sent** — around 4%
    typically:

        decompose            4,921 sent      32 stored     0.7%
        integrity_agent      4,252 sent     104 stored     2.4%
        ai_grading           3,553 sent     139 stored     3.9%
        generate_questions  10,058 sent   1,493 stored    14.8%

    The missing part is the part that decides the behaviour: the grading
    rubric and answer key, the tutoring guardrails, the generation spec.
    An operator looking at a bad grade could see the wrong answer but not
    the instructions that produced it — which is the only thing you can
    actually act on.

    ## Why a separate table, and why keyed on a hash

    System prompts are built to be **byte-identical across a class**. That
    is not incidental, it is the caching contract: `_build_system_prompt`
    in `grading_ai` deliberately excludes everything student-specific so
    one cached prefix serves an entire set of submissions, turning 30
    full-price prompts into 1 write + 29 reads.

    So content-addressing them costs almost nothing — one row per distinct
    prompt, shared by every call that sent it — where inlining the text on
    `llm_calls` would duplicate ~18KB per row across the fastest-growing
    table in the schema.

    ## What this stores, and what it does NOT

    Verified across all 15 call sites that supply a system prompt: **no
    OCR-extracted handwriting, student answer, chat turn, name, email, id,
    section or school** reaches one. `_build_system_prompt`'s claim to
    keep the extraction in the user message holds, and that is what makes
    the dedupe work at all, so the two properties stand or fall together.

    Two narrower things DO get in, and an earlier version of this comment
    wrongly denied both:

    * **Student-derived, not student-identifying.** `integrity_ai`
      interpolates a `posture` fragment into its agent system prompt
      (`integrity_ai.py:489-496`), derived from whether *this* student got
      anything right and how much they wrote — e.g. "got every final
      answer wrong AND barely wrote anything". It is a three-value enum,
      so a row identifies no one, but it is student-derived text.
    * **Unvalidated teacher free text.** `rubric["notes"]` and
      `rubric["common_mistakes"]` are rendered verbatim
      (`grading_ai.py:183-189`), and `Assignment.rubric` is accepted as a
      bare dict with no key whitelist, value validation or length cap
      (`teacher_assignments.py:78`). `common_mistakes` is the riskier of
      the two — its natural phrasing is per-student ("Jamie drops the
      negative").

    What it DOES newly persist is assessment content: every problem's
    `question` and `Answer key`, plus the teacher-authored `full_credit` /
    `partial_credit` / `common_mistakes` / `notes` off `Assignment.rubric`.
    Those already live indefinitely in `assignments.rubric`, so this is a
    duplicate of retained data rather than a new category — but a
    duplicate with no deletion path: `ondelete="SET NULL"` means removing
    the assignment, submission, student, school or call row leaves this
    row untouched.

    **Open decision, deliberately not made here:** rubric `notes` is an
    unfiltered teacher free-text field, so a teacher writing "watch
    Jamie's usual sign flips" puts a student name in a row nothing
    deletes. Retention, and whether payload rows should be purged when
    their last referencing call goes, is a product/compliance call rather
    than something to decide inside a logging change.

    ## The diagnostic that falls out for free

    Because the hash IS the cache key in everything but name, two calls in
    one class carrying **different** `system_prompt_id`s mean something
    student-specific leaked into the cached half and silently killed the
    cache hit for every submission after it. Today that failure is
    invisible: you'd see the bill rise and have no way to attribute it.
    With this table it's a `GROUP BY`.
    """

    __tablename__ = "llm_payloads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    # SHA-256 of the exact bytes sent. Unique so concurrent writers
    # converge on one row (the insert is ON CONFLICT DO NOTHING).
    sha256: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True,
    )

    # The prompt itself. Uncapped `Text` on purpose: the whole point is to
    # hold the part that was being dropped, and `MAX_STORED_TEXT_LENGTH`
    # (10KB) is under the ~18KB a grading prompt actually runs to. Stored
    # once per distinct prompt rather than once per call, so the size is
    # bounded by how many distinct prompts exist, not by traffic.
    text: Mapped[str] = mapped_column(Text, nullable=False)

    # Denormalised so the console can rank and paginate prompts without
    # pulling every body over the wire.
    char_len: Mapped[int] = mapped_column(Integer, nullable=False)

    # "system_prompt" or "tool_schema".
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    # The call site that FIRST stored this payload, e.g. "ai_grading".
    #
    # Not authoritative, and deliberately named on the read endpoint as
    # "first seen from". The relationship runs both ways: one function has
    # as many payloads as it has rubrics, AND one payload can be shared by
    # many functions. The `SAFETY_PREAMBLE` row is the extreme case — every
    # `call_claude_vision` site sends exactly that as its system prompt, so
    # a single row backs `image_extract`, `bank_extract`, `suggest_units`,
    # `generate_questions`, `bank_chat` and more. Recording only the first
    # writer would be a quiet lie if the column were presented as "the
    # function this belongs to".
    function: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
