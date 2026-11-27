"""Why points came off a flagged problem — grouped from approved feedback.

Student Insights flags a problem when at least half a period didn't get
full credit on it (`insights_counting`). Saying *which* problem starts a
reteach; saying *why* plans one. The teacher's approved grades already
hold the why: every lost point carries her note and an itemized
deduction. This groups those notes into the 2–4 most common reasons, each
with the students behind it, using one call to the cheapest model per
flagged problem.

## When it runs

Never on a page view. The grading drain (`routes/grading_drain`) runs
`refresh_reteach_reasons` every pass. A homework × section is revisited
only when its approved or published grades move (`grades_signature`),
and a flagged problem is written:

- the first time it's flagged (no reasons stored yet), and
- again when what it would be given has changed, once no AI draft in the
  period is waiting on the teacher — i.e. when its grades are approved.

So a period whose teacher approves one paper at a time gets a first read
as soon as the flag appears and one more when she finishes, not a call per
approval. A call that fails is retried on later passes up to
`MAX_ATTEMPTS` for the same input, then left alone until the input moves.

## What the model sees

The problem's text and, for each student short of full credit, their
score on it, the note and the deduction reasons, numbered 1..N. No names,
no ids: the model answers with numbers, mapped back to submissions here.
Students whose grade carries no written feedback aren't sent; with none
left there is nothing to group, and the problem stores no reasons.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections import Counter
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.insights_counting import counted_breakdown, is_flagged, missed_full_credit, tally
from api.core.llm_client import MODEL_HAIKU, LLMMode, call_claude_json
from api.core.llm_schemas import ToolSchema
from api.core.prompts import load_prompt, prompt_version
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.reteach_reasons import ReteachReasons
from api.models.user import User
from api.services.bank import hydrate_assignment_content

logger = logging.getLogger(__name__)

_PROMPT = "reteach_reasons"
_SYSTEM = load_prompt(_PROMPT)

# Failed calls on one input before the writer stops trying it.
MAX_ATTEMPTS = 3
# Homework × section pairs one drain pass works through; the rest wait
# for the next pass.
PAIRS_PER_PASS = 20
MAX_REASONS = 4
_MAX_LABEL = 120
# One student's feedback, as sent. Real notes run ~220 characters.
_MAX_FEEDBACK = 800

RETEACH_REASONS_SCHEMA: ToolSchema = {
    "name": "return_reasons",
    "description": "The most common reasons these students lost points, most students first.",
    "input_schema": {
        "type": "object",
        "properties": {
            "reasons": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "description": "Under 12 words, about the work."},
                        "students": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "description": "The numbers of the students this reason explains.",
                        },
                    },
                    "required": ["label", "students"],
                },
            },
        },
        "required": ["reasons"],
    },
}


# ── What one student's lost points say ─────────────────────────────


def feedback_text(entry: dict[str, Any]) -> str:
    """The teacher-approved words on one problem: the note, then each
    deduction's reason. Empty when nothing was written."""
    parts = []
    note = entry.get("feedback")
    if isinstance(note, str) and note.strip():
        parts.append(f"Note: {note.strip()}")
    for d in entry.get("deductions") or ():
        if isinstance(d, dict) and isinstance(d.get("reason"), str) and d["reason"].strip():
            off = d.get("points_off")
            off_s = f" (-{off:g})" if isinstance(off, int | float) and not isinstance(off, bool) else ""
            parts.append(f"Points off{off_s}: {d['reason'].strip()}")
    return " | ".join(parts)[:_MAX_FEEDBACK]


def _score(entry: dict[str, Any]) -> str:
    pct = entry.get("percent")
    if isinstance(pct, int | float) and not isinstance(pct, bool):
        return f"{pct:g}%"
    return str(entry.get("score_status") or "")


def _input_key(question: str, items: list[tuple[str, str]]) -> str:
    """What the model would be given, as a hash: the same input never
    pays for a second call."""
    payload = json.dumps({"v": prompt_version(_PROMPT), "q": question, "items": sorted(items)})
    return hashlib.sha256(payload.encode()).hexdigest()


# ── The call ───────────────────────────────────────────────────────


def _user_message(question: str, items: list[tuple[str, str]]) -> str:
    lines = "\n".join(f"[{i}] {text}" for i, (_sid, text) in enumerate(items, start=1))
    return f"Problem:\n{question}\n\nStudents who didn't get full credit:\n{lines}"


def _parse(out: dict[str, Any], items: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """The model's groups as `{label, submission_ids}`, most students
    first. Numbers out of range are dropped, and a student lands in one
    reason only (the first that names them)."""
    placed: set[int] = set()
    reasons = []
    raw = out.get("reasons")
    for r in raw if isinstance(raw, list) else ():
        if not isinstance(r, dict) or not isinstance(r.get("label"), str) or not r["label"].strip():
            continue
        nums = []
        for n in r.get("students") or ():
            if isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= len(items) and n not in placed:
                placed.add(n)
                nums.append(n)
        if nums:
            reasons.append({
                "label": " ".join(r["label"].split())[:_MAX_LABEL],
                "submission_ids": [items[n - 1][0] for n in nums],
            })
    reasons.sort(key=lambda r: -len(r["submission_ids"]))
    return reasons[:MAX_REASONS]


async def group_reasons(
    question: str, items: list[tuple[str, str]], *, user_id: str | None = None,
) -> list[dict[str, Any]]:
    """`items` is `(submission_id, feedback_text)` per student short of
    full credit. Raises when the call fails, so the caller counts it."""
    out = await call_claude_json(
        _SYSTEM,
        _user_message(question, items),
        LLMMode.RETEACH_REASONS,
        tool_schema=RETEACH_REASONS_SCHEMA,
        model=MODEL_HAIKU,
        max_tokens=800,
        temperature=0.0,
        user_id=user_id,
        prompt_ids=(_PROMPT,),
    )
    return _parse(out, items)


# ── Deciding what to write ─────────────────────────────────────────


def needs_call(entry: dict[str, Any] | None, key: str, *, drafts_waiting: bool) -> bool:
    """Whether a flagged problem's stored entry should be (re)written for
    the input `key`. See the module docstring."""
    if entry is None:
        return True
    if entry.get("input_key") == key and entry.get("reasons") is not None:
        return False  # already written for exactly this
    if entry.get("failed_key") == key and int(entry.get("attempts") or 0) >= MAX_ATTEMPTS:
        return False  # gave up on this input; a new one tries again
    if entry.get("reasons") is not None and drafts_waiting:
        return False  # it has a read; the next waits for her approvals
    return True


def _signature(count: int, reviewed: Any, published: Any) -> str:
    return f"{count}|{reviewed.isoformat() if reviewed else ''}|{published.isoformat() if published else ''}"


def _grade_scope() -> Any:
    """Grades that can count, on homework students turned in to a period."""
    return (
        select(Submission.assignment_id, Submission.section_id)
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .where(
            Submission.section_id.is_not(None),
            User.is_preview.is_(False),
            Assignment.type == "homework",
            Assignment.status == "published",
        )
    )


async def _stale_pairs(db: AsyncSession, limit: int) -> list[tuple[uuid.UUID, uuid.UUID, str]]:
    """Homework × section pairs whose approved / published grades moved
    since their reasons were last caught up, most recent first."""
    rows = (await db.execute(
        _grade_scope()
        .add_columns(
            func.count(SubmissionGrade.id).label("n"),
            func.max(SubmissionGrade.reviewed_at).label("reviewed"),
            func.max(SubmissionGrade.grade_published_at).label("published"),
        )
        .where(or_(SubmissionGrade.reviewed_at.is_not(None), SubmissionGrade.grade_published_at.is_not(None)))
        .group_by(Submission.assignment_id, Submission.section_id)
    )).all()
    seen = {
        (r.assignment_id, r.section_id): r.grades_signature
        for r in (await db.execute(
            select(ReteachReasons.assignment_id, ReteachReasons.section_id, ReteachReasons.grades_signature)
        )).all()
    }
    stale = [
        (r, sig) for r in rows
        if seen.get((r.assignment_id, r.section_id)) != (sig := _signature(r.n, r.reviewed, r.published))
    ]
    stale.sort(key=lambda x: max(t for t in (x[0].reviewed, x[0].published) if t is not None), reverse=True)
    return [(r.assignment_id, r.section_id, sig) for r, sig in stale[:limit]]


async def _refresh_pair(
    db: AsyncSession, assignment_id: uuid.UUID, section_id: uuid.UUID, signature: str,
) -> Counter[str]:
    """Bring one pair's reasons up to date. Holds the pair's row lock for
    the whole pass, so two drains never write (or pay for) it twice."""
    tally_out: Counter[str] = Counter()
    await db.execute(
        pg_insert(ReteachReasons)
        .values(id=uuid.uuid4(), assignment_id=assignment_id, section_id=section_id)
        .on_conflict_do_nothing(constraint="uq_reteach_reasons_pair")
    )
    row = (await db.execute(
        select(ReteachReasons)
        .where(ReteachReasons.assignment_id == assignment_id, ReteachReasons.section_id == section_id)
        .with_for_update(skip_locked=True)
    )).scalar_one_or_none()
    if row is None or row.grades_signature == signature:
        await db.rollback()
        return tally_out  # another drain has it, or already caught up

    hw = await db.get(Assignment, assignment_id)
    hydrated = await hydrate_assignment_content(db, hw) if hw else None
    questions = {
        str(p["bank_item_id"]): str(p.get("question") or "")
        for p in (hydrated or {}).get("problems") or []
        if isinstance(p, dict) and p.get("bank_item_id")
    }
    grades = (await db.execute(
        _grade_scope()
        .add_columns(
            Submission.id.label("submission_id"),
            SubmissionGrade.reviewed_at, SubmissionGrade.grade_published_at,
            SubmissionGrade.breakdown, SubmissionGrade.published_breakdown,
        )
        .where(Submission.assignment_id == assignment_id, Submission.section_id == section_id)
    )).all()
    counted = {str(g.submission_id): counted_breakdown(g) for g in grades}
    # An AI draft she hasn't approved yet, fresh or a regrade over a
    # published grade — the same draft `_coverage_bucket` calls "to approve".
    drafts_waiting = any(
        g.reviewed_at is None and isinstance(g.breakdown, list) and g.breakdown
        and g.breakdown != g.published_breakdown
        for g in grades
    )

    problems: dict[str, Any] = dict(row.problems or {})
    settled = True
    for pid, (n, missed) in tally(questions, counted.values()).items():
        if not is_flagged(n, missed):
            continue
        items = sorted(
            (sid, f"{_score(e)} | {text}")
            for sid, entries in counted.items()
            for e in entries or ()
            if str(e.get("problem_id")) == pid and missed_full_credit(e) and (text := feedback_text(e))
        )
        key = _input_key(questions[pid], items)
        entry = problems.get(pid)
        if not needs_call(entry, key, drafts_waiting=drafts_waiting):
            continue
        if not items:
            problems[pid] = {"input_key": key, "reasons": [], "prompt_version": prompt_version(_PROMPT)}
            continue
        try:
            reasons = await group_reasons(
                questions[pid], items, user_id=str(hw.teacher_id) if hw and hw.teacher_id else None,
            )
        except Exception:  # noqa: BLE001 — a missing reason is never worth failing the drain over
            logger.exception("reteach reasons failed assignment=%s section=%s problem=%s",
                             assignment_id, section_id, pid)
            prev = entry or {}
            attempts = (int(prev.get("attempts") or 0) if prev.get("failed_key") == key else 0) + 1
            problems[pid] = {**prev, "failed_key": key, "attempts": attempts}
            settled = settled and attempts >= MAX_ATTEMPTS
            tally_out["failed"] += 1
            continue
        problems[pid] = {"input_key": key, "reasons": reasons, "prompt_version": prompt_version(_PROMPT)}
        tally_out["written"] += 1

    row.problems = problems
    if settled:
        row.grades_signature = signature
    await db.commit()
    tally_out["pairs"] += 1
    return tally_out


async def refresh_reteach_reasons(limit: int = PAIRS_PER_PASS) -> dict[str, int]:
    """One pass: catch up every pair whose grades moved. Safe to run
    concurrently with itself (each pair is row-locked). Returns
    `pairs` / `written` / `failed` for the drain's log line."""
    async with get_session_factory()() as db:
        pairs = await _stale_pairs(db, limit)
    out: Counter[str] = Counter()
    for assignment_id, section_id, signature in pairs:
        async with get_session_factory()() as db:
            out.update(await _refresh_pair(db, assignment_id, section_id, signature))
    return {"pairs": out["pairs"], "written": out["written"], "failed": out["failed"]}
