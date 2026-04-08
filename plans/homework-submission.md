# Homework Submission Flow

> Status: Approved, ready to implement
> Branch: feat/homework-submission
> Depends on: feat/student-practice-loop (already merged)
> Out of scope: AI grading, integrity checker, resubmission, drafts, mobile

## Why

The school-student practice loop is shipped, but the homework page has a "submission coming soon" placeholder where the answer field would be. Students currently have no way to actually turn in a homework. Teachers have a dead `⚙ Submissions` button that doesn't open anything. This PR ships the missing CRUD: kid finishes homework → uploads a picture of their work + types final answers → teacher sees the submission.

The integrity checker (next PR after this one) hooks into "after submission" — so we have to ship this first or the integrity work has nothing to attach to.

## Locked decisions

| Decision | Value |
|---|---|
| Submission shape | One image of the entire completed HW (source of truth) + per-problem text final-answer fields (optional but encouraged) |
| Resubmission | Not allowed in v1. Once submitted, locked. (Future PR can layer this on with no schema change.) |
| Drafts / autosave | Not in v1. Submission is atomic. |
| Late policy | Soft lockout: past `due_at` shows a warning banner but still accepts the submission and marks `is_late=true`. |
| Teacher view | Wire up the existing `⚙ Submissions` placeholder in `homework-detail-modal.tsx`. Click → list → click row → per-submission detail panel. |
| AI grading | Not touched. `submission_grades` table stays unused. |
| Image storage | Reuse the existing base64-in-DB approach (`Submission.image_data`). S3 migration is tracked tech debt, separate concern. |
| Loop after submission | Practice/Learn similar buttons remain functional after submission — the loop is a study tool, not gated by submission state. |
| HW list status badge | Real data: `not_started` / `submitted`. No "in progress" since there's no draft system. |

## What's NOT in this PR (actively skipped, not just deferred)

- AI grading of submissions
- Integrity-check Q&A flow (the next PR)
- Teacher annotations / written feedback on submissions
- Resubmission / submission history
- Per-problem image uploads (one whole-HW image only)
- Late penalty calculation (we set the flag, no math)
- Email/notification on submit
- Mobile parity
- S3 image storage migration

## Data model

### Existing tables (reuse, evolve minimally)

`submissions` (already exists from an earlier feature):
- `id`, `assignment_id`, `student_id`, `section_id`, `status`, `image_data`, `submitted_at`, `is_late`

What we add:
- `final_answers: JSON | None` — `{ "<bank_item_id>": "<text answer>" }` map. Optional per problem.

`submission_grades` — left untouched. Not used in this PR.

### Migration `ah1000025_add_submission_final_answers.py`

```python
op.add_column(
    "submissions",
    sa.Column("final_answers", postgresql.JSON(), nullable=True),
)
```

That's the entire schema change. Everything else uses existing columns.

### Why one column, not a new table

The integrity-checker plan adds richer per-problem state in dedicated tables (`integrity_check_problems`, `integrity_check_responses`). Those are about the *check*, not the submission itself. The submission's final answers are a flat key-value map — JSON is the right shape, no normalization needed, no future cross-submission queries on individual answers.

## Backend

### Endpoints

**Student side** (under `/v1/school/student/`, in `api/routes/school_student_practice.py` — same router file since it's already the school-student namespace):

1. `POST /homework/{assignment_id}/submit`
   - Body: `{ final_answers: {bank_item_id: text}, image_base64: string | null }`
   - Validates: enrolled, assignment is published HW, not already submitted (409), answer keys are valid bank_item_ids on this assignment.
   - Inserts a `Submission` row with `status='submitted'`, `submitted_at=now()`, `is_late=(now > due_at)`, `final_answers=...`, `image_data=image_base64`.
   - Idempotent on retry only by re-checking "already submitted" (409 on second call).
   - Returns `{ submission_id, submitted_at, is_late }`.

2. `GET /homework/{assignment_id}/submission`
   - Returns the student's own submission for this HW (or 404 if none).
   - Used by the HW page to render the "submitted" read-only state.

**Update existing endpoint:**

3. `homework_detail` — add a `submitted: boolean` field (and `submission_id` if any) so the HW page knows whether to show the submit form or the submitted state. **Don't include** the image / answers in the detail response — those come from the dedicated submission endpoint to keep payloads small.

4. `list_homework` — add a `status` field to each row: `"not_started"` or `"submitted"`. One JOIN to `submissions` filtered by `student_id`.

**Teacher side** (under `/v1/teacher/`, in `api/routes/teacher_assignments.py` since it's an extension of the assignments domain):

5. `GET /assignments/{assignment_id}/submissions`
   - Returns a list of submissions for this assignment, joined with student info: `{submission_id, student_id, student_name, student_email, submitted_at, is_late}`.
   - Validates the requesting teacher owns the course (uses existing `get_teacher_assignment`).

6. `GET /submissions/{submission_id}`
   - Returns the full submission detail: `{submission_id, student_name, student_email, submitted_at, is_late, image_data, final_answers, hw_problems: [...]}` so the teacher view can show the picture + per-problem typed answers + the original problem text side-by-side.
   - Validates teacher owns the assignment.

### Image upload validation

- Max 5 MB base64 (rough — `len(image_base64) < 7_000_000`). Reject `413` if over.
- Must start with `data:image/` or `iVBOR`/`/9j/` (PNG/JPEG magic). Reject `400` if not.
- No virus scanning for v1 (out of scope, base64 strings can't be executed anyway).

These are sanity checks, not security gates — the same approach the personal `/work/submit` endpoint already uses.

## Frontend (web)

### API client additions (`web/src/lib/api.ts`)

```ts
schoolStudent.submitHomework(assignmentId, body): Promise<{...}>
schoolStudent.getSubmission(assignmentId): Promise<StudentSubmission | null>
teacher.listSubmissions(assignmentId): Promise<TeacherSubmissionRow[]>
teacher.submissionDetail(submissionId): Promise<TeacherSubmissionDetail>
```

### HW page changes

`web/src/app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/page.tsx`:

- Fetch `homework_detail` AND (if `submitted: true`) `getSubmission` on mount.
- Two render states for the page body:
  - **Pre-submission:** existing problem cards + a new `<SubmissionPanel>` at the bottom of the list.
  - **Submitted:** existing problem cards (still show, still tappable for Practice/Learn similar) + a `<SubmittedView>` at the bottom showing their image + typed answers as read-only, plus a "Submitted at X" badge at the top.

### New components (`web/src/components/school/student/`)

- `submission-panel.tsx` — the "Submit Homework" section. Per-problem text input fields (one per HW primary, labeled by position), a single image upload area, soft-lockout warning if past due, Submit button with confirm dialog. Posts via `submitHomework`. Reuses existing image-upload component if there is one (otherwise minimal `<input type="file">` with FileReader → base64).
- `submitted-view.tsx` — read-only view: the submitted image, the per-problem typed answers, "Submitted Friday 4:32 PM" + "(late)" badge if applicable.

### HW list page

`web/src/app/(app)/school/student/courses/[courseId]/page.tsx`:

- Replace the hardcoded `Not started` badge with the real `status` from the API.
- Two states: amber `Not started`, green `Submitted ✓`.

### Teacher modal

`web/src/components/school/teacher/_pieces/homework-detail-modal.tsx`:

- The `⚙ Submissions` button currently does nothing. Wire it: clicking opens an inline panel inside the modal listing each submission row.
- Click a row → opens a per-submission detail subview (image preview + typed answers + original problem text).
- Reuses existing modal/list patterns — no new heavy UI primitives.

## Edge cases

| Case | Behavior |
|---|---|
| Kid submits with no image and no answers | 400 — at least one of (image, any final_answer) required |
| Kid submits image > 5MB | 413 with clear message |
| Kid hits Submit twice rapidly | Second call 409 ("already submitted") — UI debounces too |
| Past due | Soft warn banner pre-submit; submission still accepted, `is_late=true` |
| Teacher unpublishes HW after kid started typing | Submit returns 403; UI shows "this HW is no longer available" |
| Kid types an answer for a bank_item_id that isn't in the HW | 400 ("unknown problem id") — defends against tampered payloads |
| Teacher opens submissions list for HW with zero submissions | Empty state "no submissions yet" |
| Image data missing from old test rows | Detail endpoint returns null for image, UI shows "no image submitted" |
| Submission row exists but homework was deleted | Cascade-delete via FK on assignment_id (already exists) |
| Kid uses Practice/Learn similar after submitting | Works exactly as before, loop is independent |

## Implementation order (small commits, autopilot)

1. **Migration + model** — `ah1000025_add_submission_final_answers.py`, add `final_answers` to `Submission` model. Test up/down round trip.
2. **Student submit endpoint** — `POST /school/student/homework/{id}/submit` with full validation chain, plus `GET /school/student/homework/{id}/submission`. Unit tests for each branch (already submitted, late, validation, not enrolled, unknown problem id, oversized image, no content).
3. **Update existing read endpoints** — `homework_detail` returns `submitted` flag, `list_homework` returns `status`. Tests for each.
4. **Teacher list + detail endpoints** — `GET /assignments/{id}/submissions`, `GET /submissions/{id}`. Tests for ownership/scoping.
5. **API client** — add `schoolStudent.submitHomework`, `getSubmission`, `teacher.listSubmissions`, `teacher.submissionDetail`.
6. **HW page submission panel** — pre-submission UI, Submit button with confirmation, late warning, soft validation.
7. **HW page submitted state** — render `<SubmittedView>`, badge, read-only answers.
8. **HW list status badges** — wire to real data.
9. **Teacher submissions panel** — wire up the placeholder button, list view, detail subview.
10. **Edge-case hardening + polish** — empty states, error toasts, debounce.

Each commit ~100-300 lines. Pause-test-continue per the standard workflow.

## Critical files

- `api/alembic/versions/ah1000025_add_submission_final_answers.py` (new)
- `api/models/assignment.py` (extend `Submission`)
- `api/routes/school_student_practice.py` (extend with submission endpoints)
- `api/routes/teacher_assignments.py` (extend with teacher submission endpoints)
- `tests/test_school_student_practice.py` (extend)
- `tests/test_teacher_submissions.py` (new — or extend an existing teacher test file if one exists)
- `web/src/lib/api.ts` (extend)
- `web/src/components/school/student/submission-panel.tsx` (new)
- `web/src/components/school/student/submitted-view.tsx` (new)
- `web/src/app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/page.tsx` (extend)
- `web/src/components/school/teacher/_pieces/homework-detail-modal.tsx` (wire up the placeholder)
