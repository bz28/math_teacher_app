# Integrity Checker — PR 1 (data model + stubbed pipeline)

> Status: Approved, ready to implement
> Branch: feat/integrity-checker-pr1
> Depends on: feat/homework-submission (merged)
> Parent plan: plans/integrity-checker.md (full 6-PR rollout)

## Why

PR #193 ships student homework submissions. The next product surface is the **understanding-check chat** that fires after a kid submits — short Q&A tied to their actual shown work, producing a confidence badge for the teacher. The full vision is in `plans/integrity-checker.md` (6 PRs total). This PR is the foundation: data + endpoints + stubbed AI, no UI. The point is to ship the entire pipe — submit → integrity rows created → questions generated (stubbed) → answers stored → scoring (stubbed) → badge computed → teacher detail endpoint — so that PR 4 swaps in real Vision + Sonnet calls with zero plumbing changes.

Stubbed AI lets us test the whole flow at $0 cost. The stub returns hardcoded "fake" questions and a deterministic length-based score. PR 4 replaces it; nothing else changes.

## Locked decisions

| Decision | Value |
|---|---|
| Trigger | Coupled — submit_homework fires it in the same request |
| Sync vs async | Async scaffolding now (background task pattern). The stub itself is instant but the wiring is async-shaped so PR 4 swap is one-line. |
| Sample policy | First N (capped at 5) primary problems, deterministic, sampled at submit time. Store the picked ids on the integrity rows so a resume gets the same problems. |
| Questions per problem | 2 (stub returns hardcoded pair). PR 4 generates 2-3 dynamically. |
| Confirm-extracted-answers screen | DROPPED. Misreads surface in the chat answers; no separate confirm step. |
| Status column on submissions | Skipped for PR 1 — derive from per-problem rows. PR 4 may add it for fast index. |
| Per-class enable/disable | Skipped — `assignments.integrity_check_enabled` defaults to true, no UI to flip it yet. |
| UI in this PR | None. Backend + tests only. |
| Real LLM calls in this PR | None. |
| Tab-switch / accessibility | Skipped — covered in PR 5. |

## Out of scope

- Student-facing UI (PR 2)
- Teacher-facing badges + expand view (PR 3)
- Real Vision extraction + Claude question generation + scoring (PR 4)
- Per-class / per-student config overrides (PR 5)
- Background worker process (the FastAPI BackgroundTasks pattern is enough at this stage)
- Cost tracking + alarms (PR 4)
- Bulk teacher actions (PR 3+)

## Data model

### Migration `aj1000027_add_integrity_check_tables.py`

Three changes in one migration:

**1. New column on `assignments`:**
```python
op.add_column(
    "assignments",
    sa.Column("integrity_check_enabled", sa.Boolean(),
              nullable=False, server_default=sa.text("true")),
)
```

**2. New table `integrity_check_problems`:**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| submission_id | uuid fk submissions, CASCADE | |
| bank_item_id | uuid fk question_bank_items, CASCADE | |
| sample_position | int | order within the sampled set (0..N-1, ≤ 4) |
| status | varchar(32) | `pending` / `generating` / `awaiting_student` / `scoring` / `complete` / `skipped_unreadable` / `dismissed` |
| student_work_extraction | json nullable | `{steps: [...]}` from Vision (stubbed for now) |
| badge | varchar(20) nullable | `likely` / `uncertain` / `unlikely` / `unreadable` |
| raw_score | float nullable | mean of question weights, 0.0–1.0 |
| ai_reasoning | text nullable | one-line summary the teacher sees |
| teacher_dismissed | boolean default false | |
| teacher_dismissal_reason | text nullable | |
| created_at, updated_at | timestamptz | |

Indexes:
- `(submission_id)` — hot lookup for the teacher detail view
- `unique(submission_id, bank_item_id)` — one row per (submission, problem)

**3. New table `integrity_check_responses`:**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| integrity_check_problem_id | uuid fk integrity_check_problems, CASCADE | |
| question_index | int | 0-based within this problem |
| question_text | text | |
| expected_shape | text nullable | hint for the scorer (e.g. "1-2 sentences referencing factoring") |
| rubric_hint | text nullable | |
| student_answer | text nullable | filled when the kid answers |
| answer_verdict | varchar(20) nullable | `good` / `weak` / `bad` / `skipped` / `rephrased` |
| seconds_on_question | int nullable | |
| tab_switch_count | int nullable default 0 | |
| rephrase_used | boolean default false | |
| created_at | timestamptz | |
| answered_at | timestamptz nullable | |
| scored_at | timestamptz nullable | |

Indexes:
- `unique(integrity_check_problem_id, question_index)` — one row per (problem, question slot)

### SQLAlchemy models

`api/models/integrity_check.py` (new file) — `IntegrityCheckProblem` + `IntegrityCheckResponse`. Imported from `api/models/__init__.py` and any other place models are registered.

## Stubbed AI module

`api/core/integrity_stub.py` (new file). Three pure functions, all clearly marked as stubs:

```python
async def extract_student_work(submission_id: uuid.UUID) -> dict:
    """STUB. Returns hardcoded extraction. Real Vision call lands in PR 4."""
    return {
        "steps": [
            {"step_num": 1, "latex": "stub step 1", "plain_english": "stubbed extraction"},
        ],
        "confidence": 0.9,
    }


def generate_questions(problem_text: str, extraction: dict) -> list[dict]:
    """STUB. Returns 2 hardcoded questions per problem. PR 4 calls Sonnet."""
    return [
        {
            "question": "What was the first step you took to solve this?",
            "expected_shape": "Brief description, 1-2 sentences",
            "rubric_hint": "Should reference an actual operation, not just 'I solved it'",
        },
        {
            "question": "Walk me through how you arrived at the final answer.",
            "expected_shape": "1-2 sentences explaining the last step",
            "rubric_hint": "Should connect their work to the final answer specifically",
        },
    ]


def score_answer(question: dict, answer: str) -> dict:
    """STUB. Length-based scoring. PR 4 calls Sonnet with rubric."""
    n = len(answer.strip())
    if n < 5:
        verdict = "bad"
    elif n < 30:
        verdict = "weak"
    else:
        verdict = "good"
    return {"verdict": verdict, "reasoning": f"Stub: answer length {n} chars", "flags": []}
```

The signatures are deliberately what the real PR 4 versions will need. PR 4 swaps the bodies; callers stay identical.

## Pipeline orchestrator

`api/core/integrity_pipeline.py` (new file) — `start_integrity_check(submission_id, db)`:

1. Load submission + assignment.
2. If `assignment.integrity_check_enabled is False` → no-op, return.
3. If `assignment.type != "homework"` → no-op (defense in depth).
4. Pick the first 5 primary bank_item_ids from `assignment.content.problem_ids`. Store them as the sampled set on new IntegrityCheckProblem rows with `sample_position=0..N-1` and `status="pending"`.
5. For each row: call `extract_student_work` → set `student_work_extraction`, advance status to `generating`.
6. Call `generate_questions` per problem → insert IntegrityCheckResponse rows (one per question, `question_index=0..1`), advance the problem status to `awaiting_student`.
7. Commit.

This is the **synchronous-but-async-shaped** path. The function is `async def`, takes an `AsyncSession`, returns awaitable. PR 4 will make it real-async by calling Vision + Sonnet, but the call sites don't change.

## Trigger from `submit_homework`

In `api/routes/school_student_practice.py`, immediately after the existing `await db.commit()` for the submission, **call `start_integrity_check` in the same request**:

```python
db.add(submission)
try:
    await db.commit()
except IntegrityError:
    await db.rollback()
    raise HTTPException(status_code=409, detail="Already submitted") from None
await db.refresh(submission)

# Fire the integrity check pipeline. Stubbed for PR 1 — runs inline
# in the same request because the stub is instant. PR 4 will move
# this to a background task when it becomes real Vision + Sonnet.
try:
    await start_integrity_check(submission.id, db)
    await db.commit()
except Exception as e:
    # Pipeline failure must NOT block submit. Log and continue —
    # the kid's submission is still saved.
    logger.warning("Integrity pipeline failed for submission %s: %s", submission.id, e)
    await db.rollback()
```

The submit endpoint's existing test for the happy path will need a small assertion that integrity rows now exist after submit.

## Endpoints

New router file `api/routes/integrity_check.py`. Mounted at `/v1` (the role-based prefixes live inside).

### Student side — under `/v1/school/student/integrity`

**`GET /submissions/{submission_id}`**
Returns the kid's own integrity check state for resume:
```
{
  "status": "in_progress",  // derived: any awaiting_student → in_progress, all complete → complete
  "problems": [
    {
      "problem_id": uuid,
      "status": "awaiting_student",
      "question_count": 2,
      "answered_count": 0
    },
    ...
  ]
}
```
Ownership: 404 if submission isn't this student's.

**`GET /submissions/{submission_id}/next`**
Returns the next pending question for this kid, or `{done: true}`:
```
{
  "done": false,
  "problem_id": uuid,
  "problem_position": 1,  // sample_position + 1, for "Problem 1 of 5" UI
  "total_problems": 5,
  "question_id": uuid,
  "question_index": 0,  // for "q1 of 2"
  "questions_in_problem": 2,
  "question_text": "What was the first step you took?"
}
```
Picks the lowest unanswered (problem.sample_position, response.question_index). Ownership enforced.

**`POST /submissions/{submission_id}/answer`**
Body: `{question_id, answer, seconds_on_question, tab_switch_count}`. Idempotent on `question_id` — re-posting overwrites the previous answer for that question_id (same kid).
- Validates the question belongs to this submission and this student.
- Validates `len(answer.strip()) >= 5` to prevent empty-spam (per the locked plan §2.2).
- Calls `score_answer` (stub).
- Updates the response row with answer + verdict + scored_at.
- Recomputes the parent IntegrityCheckProblem's badge + raw_score if all questions for that problem are now answered.
- Returns the same shape as `next` (the next question, or done).

**`POST /submissions/{submission_id}/rephrase`**
Body: `{question_id}`. Sets `rephrase_used=true` on the response row, returns the question with a hardcoded alternate phrasing (stub: just appends " (in your own words)"). One-shot per question.

### Teacher side — under `/v1/teacher/integrity`

**`GET /submissions/{submission_id}`**
Returns the full Q&A + reasoning payload for the teacher detail panel:
```
{
  "submission_id": uuid,
  "overall_status": "complete" | "in_progress" | ...,
  "problems": [
    {
      "problem_id": uuid,
      "bank_item_id": uuid,
      "position": 1,
      "status": "complete",
      "badge": "uncertain",
      "raw_score": 0.5,
      "ai_reasoning": "...",
      "teacher_dismissed": false,
      "responses": [
        {"question_text": "...", "student_answer": "...", "verdict": "good", ...},
        ...
      ]
    },
    ...
  ]
}
```
Ownership: 403 if teacher doesn't own the assignment.

**`POST /submissions/{submission_id}/dismiss`**
Body: `{problem_id, reason}`. Sets `teacher_dismissed=true` and `teacher_dismissal_reason`. Idempotent. Ownership enforced.

## Score → badge logic

Per the parent plan §6, ships in PR 1 even though the stub feeds it:

```python
def compute_badge(verdicts: list[str], flags: list[str]) -> tuple[str, float]:
    weights = {"good": 1.0, "weak": 0.5, "bad": 0.0, "skipped": 0.0}
    if not verdicts:
        return ("uncertain", 0.0)
    score = sum(weights.get(v, 0.0) for v in verdicts) / len(verdicts)
    hard_flags = {"contradicts_own_work", "acknowledges_cheating"}
    if any(f in hard_flags for f in flags):
        return ("unlikely", score)
    if score >= 0.75:
        return ("likely", score)
    if score >= 0.40:
        return ("uncertain", score)
    return ("unlikely", score)
```

Lives in `api/core/integrity_pipeline.py`. PR 4 may tune the thresholds but the function shape stays.

## Tests

`tests/test_integrity_check.py` (new). Reuses the existing `world` fixture from `test_school_student_practice.py` where possible (the seeded teacher/student/HW/section).

**Migration:**
- Round-trip up + down + up

**Pipeline + trigger:**
- Submit fires the pipeline, integrity rows exist with status `awaiting_student`
- Submit with `integrity_check_enabled=False` → no rows created
- Submit with HW that has > 5 problems → only first 5 sampled
- Submit with HW that has 0 problems → no rows, no error

**Student endpoints:**
- `GET /submissions/{id}` returns `in_progress` initially, `complete` after all answered
- `GET /next` returns the lowest unanswered question; ownership 404
- `POST /answer` happy path: stores, scores via stub, advances; returns next
- `POST /answer` idempotent on question_id (second post overwrites)
- `POST /answer` rejects answers shorter than 5 chars (400)
- `POST /answer` last question → recomputes problem badge → marks problem complete
- `POST /rephrase` sets the flag, returns the alternate phrasing
- Resume: partial answer → `next` returns the same un-answered question

**Teacher endpoints:**
- `GET /submissions/{id}` returns full Q&A; teacher 403 if not owner
- `POST /dismiss` sets the flag; idempotent; preserves the row

**Score → badge:**
- All `good` → `likely`, score 1.0
- All `bad` → `unlikely`, score 0.0
- Mixed → `uncertain` in the 0.40–0.75 band
- Empty verdicts → `uncertain` (defensive)

~20 tests total.

## Implementation order (small commits, autopilot)

1. **Migration + models** — ah... wait, head is `ai1000026`, so this is `aj1000027_add_integrity_check_tables.py`. Add column + 2 tables. Models. Test up/down.
2. **Stub module** — `integrity_stub.py` with the three functions. Pure unit test the stub.
3. **Pipeline orchestrator + score helper** — `integrity_pipeline.py`. Unit tests for `compute_badge` + an integration-style test that calls `start_integrity_check` against a seeded submission.
4. **Trigger hook** — wire `start_integrity_check` into `submit_homework` with a try/except so a pipeline failure doesn't block the submit. Update the submit happy-path test to assert integrity rows exist.
5. **Student endpoints** — `GET /submissions/{id}`, `GET /next`, `POST /answer`, `POST /rephrase`. Tests per branch.
6. **Teacher endpoints** — `GET /submissions/{id}`, `POST /dismiss`. Ownership tests.
7. **Polish** — state-machine assertions, error cases, hardening.

Each commit ~100-300 lines. Standard testing: ruff, mypy, pytest, tsc(N/A), eslint(N/A), build(N/A) — backend-only PR.

## Critical files

- `api/alembic/versions/aj1000027_add_integrity_check_tables.py` (new)
- `api/models/integrity_check.py` (new)
- `api/models/__init__.py` (register new models)
- `api/core/integrity_stub.py` (new)
- `api/core/integrity_pipeline.py` (new)
- `api/routes/integrity_check.py` (new)
- `api/routes/school_student_practice.py` (trigger hook in submit_homework)
- `api/main.py` (mount the new router)
- `tests/test_integrity_check.py` (new)
