# Phase 5.5 — Bank-as-source-of-truth refactor

> **Status:** Approved, in progress
> **Branch:** `feat/school-phase-5-homework` (continues from Phase 5 commits)

## The architectural shift

Today's model: question bank holds the questions, homework holds **frozen
snapshots** of the questions it uses. Two stores of question content,
managed separately, drift apart over time.

New model: question bank is the **single source of truth**. Homework
references bank items by id. Editing a bank question updates everywhere
it's referenced (subject to locking, see below).

## What this fixes

1. **No more drift.** Edit a question once, it propagates.
2. **Generate similar is natural.** A bank item gets a `parent_question_id`;
   teacher clicks "make 5 more like this" and the AI seeds from this
   question's source docs + constraint + the question text itself.
3. **Import existing homework is natural.** Upload a worksheet PDF, AI
   extracts each problem, each lands in the bank as `pending` with
   `source = imported`. Same review pipeline as generated.
4. **Hand-written questions are natural.** "+ Add question" button in
   the bank, types a question, lands as `pending` with `source = manual`.
5. **Student practice/learn becomes one query** — bank items where
   `status = approved` AND unit unlocked AND not currently locked by an
   active assignment for this section.
6. **"Used in" labels** — bank items show which homework/test references
   them.

## Locked decisions (from the planning conversation)

| Question | Decision |
|---|---|
| Locked-question conflict resolution | **Hard refuse.** While a question is locked, content edits, status changes (reject/archive), and deletion are all blocked. Teacher must unpublish or delete the referencing assignment first. |
| Where does manual "+ Add question" live? | UI-god call: **inline in the bank tab**, next to "+ Generate Questions." |
| Migrate existing snapshot data? | **Drop it.** No real users yet; force a re-pick from the bank if anyone has a draft homework lying around. |
| Tests tab: same component as Homework? | Yes, but **defer** — out of scope for this refactor. |
| Status change (reject/archive) on a locked question | **Refused** — same as content edits. Locked is locked. |
| Generate-similar UI | **Reuse the chat workshop** — already has the conversational pattern. |
| Import flow lives where? | **Bank tab**, alongside Generate Questions. Materials stays for raw source files. |
| Branch | **This branch** — continuation of `feat/school-phase-5-homework`. |

## What's in scope for THIS refactor PR

Just the foundation. The new entry points (Generate similar, Import,
Manual add) get their own follow-up commits.

### Backend
1. **Migration**: add columns to `question_bank_items`:
   - `locked` (bool, default false) — placeholder for the future publish step
   - `parent_question_id` (uuid, nullable, FK self-ref) — variation tree
   - `source` (string, default "generated") — generated / imported / manual
2. **Migration**: add `homework_problems` join table (or keep storing in
   `assignments.content` as `{ "problem_ids": [...] }`). Lean: **stay
   with the JSON column** for now — it's fewer moving parts and the
   refactor is about content not snapshots, not table structure. Future
   PR can normalize if needed.
3. **Refactor `snapshot_bank_items`** in `teacher_assignments.py`:
   - Stop copying question content
   - Just validate the bank items are approved + in this course
   - Store as `{ "problem_ids": ["uuid1", "uuid2", ...] }` instead of
     the full snapshot
4. **Update `assignment_to_dict` and `GET /teacher/assignments/{id}`**:
   - Read `content.problem_ids`
   - JOIN to fetch the live bank items
   - Return them as `content.problems` so the frontend doesn't have to
     change shape (but the data is now live, not frozen)
5. **Lock-aware PATCH on bank items**: when `locked = true`, refuse
   edits to question/solution_steps/final_answer and refuse status
   changes to rejected/archived. (Defer to publish-step PR — for this
   refactor the lock column exists but is never set, so behavior is
   unchanged.)

### Frontend
1. **No changes to the homework picker** — it already passes
   `bank_item_ids` and the backend handles the new shape transparently.
2. **No changes to the homework detail modal** — `content.problems`
   shape is preserved by the backend serializer.
3. **Bank cards show "Used in" label** when referenced by any
   assignment — small text under the existing unit label, listing
   homework titles.
4. **Optional: bank workshop modal** shows the same "Used in" info in
   the header.

## What's out of scope (deferred to follow-up commits)

- **Publish step** — adds the `locked` flag enforcement
- **Generate similar** — the chat workshop "make 5 more like this" feature
- **Import existing homework** — PDF → extracted bank items
- **Manual "+ Add question"** — typed question form in the bank
- **Variation tree visualization** — see all questions descended from a
  parent question
- **Sections / due date / late policy on homework** — Phase 5 rest
- **Student side anything** — Phase 5 rest

These all become straightforward additions on top of the new model.

## Migration plan for the existing snapshot data

The previous commit on this branch shipped the snapshot helper.
Anyone who created a draft homework on this branch will have its
content as `{ "problems": [{ bank_item_id, position, question, ... }] }`.

We **drop the existing data** (no real users yet) by:
1. The new migration doesn't touch existing assignments
2. The new `snapshot_bank_items` writes the new format from now on
3. Old draft homework with the legacy format will be partially broken
   in the detail modal (the join won't find anything because the
   `content.problems` doesn't have `problem_ids`)
4. We accept this — anyone with old drafts re-creates them from the
   bank

To avoid surprising any draft we might have created during testing,
the backend reader should fall back: if `content.problems` is the old
shape (has `question` field), use it as-is; if it has `problem_ids`,
join to bank. This is 5 lines of code and prevents breakage.

## File-by-file changes

### Backend
- `api/alembic/versions/aa1000018_add_bank_provenance.py` — new migration
- `api/models/question_bank.py` — add `locked`, `parent_question_id`,
  `source`
- `api/routes/teacher_assignments.py`:
  - `snapshot_bank_items` → store IDs only, don't copy content
  - `assignment_to_dict` / `get_assignment` → JOIN to fetch live content
  - Add a `_used_in_assignments(bank_item_id)` helper for the "Used in" labels
- `api/routes/teacher_question_bank.py`:
  - List endpoint optionally returns `used_in_assignments` per item
  - PATCH endpoint refuses content edits on locked items (no-op for
    now since nothing sets locked)

### Frontend
- `web/src/lib/api.ts`:
  - `BankItem` interface gains `locked`, `source`, `parent_question_id`,
    `used_in_assignments` (optional list of `{id, title}`)
- `web/src/components/school/teacher/question-bank-tab.tsx`:
  - `BankItemCard` shows the "Used in N homeworks" label when applicable
- `web/src/components/school/teacher/workshop-modal.tsx`:
  - Header shows "Used in: ..." when applicable
- `web/src/components/school/teacher/homework-tab.tsx`:
  - No changes (the backend serializer preserves the response shape)

## Why the JSON column instead of a join table

I considered both. The join table (`homework_problems` with
`assignment_id`, `bank_item_id`, `position`) is the "more correct"
relational model. But:

- We already have `assignments.content` as JSON
- The current code writes/reads it via `content.problems`
- Switching to JSON-with-ids (`content.problem_ids`) is a 5-line change
- Switching to a join table is a 50-line change with new query patterns
- There's no real query benefit yet — we always read all problems for a
  given assignment
- The JOIN to fetch live content happens in Python code (one
  `WHERE id IN (...)` query) regardless of where the IDs live

Lean: **JSON column** for now. Promote to a join table later if we
need to query "which assignments use this bank item" frequently — that
single query is the only thing the join table would speed up.

(Actually wait — that exact query is what powers the "Used in" labels.
Let me think about this... it runs once per bank list response, so it's
N+1 if naive. But we can write it as a single `SELECT assignment_id,
content FROM assignments WHERE jsonb_path_query content` and parse in
Python. PostgreSQL's JSONB is fast at this. If perf becomes a problem,
promote to a join table. **Sticking with JSON column.**)

## Implementation order

One commit. Tightly coupled.

1. New migration — adds the new columns
2. Update model — adds the new fields
3. Refactor `snapshot_bank_items` — stop copying content
4. Update read paths — JOIN to live bank
5. Add fallback for legacy snapshot data
6. Add `used_in_assignments` to bank list response
7. Frontend: render the "Used in" label

Estimated diff: ~250 lines.
