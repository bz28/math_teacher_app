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

    # Which call site produced it, e.g. "ai_grading". Not unique — the
    # same function has as many payloads as it has rubrics.
    function: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
