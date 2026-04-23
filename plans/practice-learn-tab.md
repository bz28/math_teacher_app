# Practice / Learn Tab

Ungraded practice sets in the teacher + student portals. Reuses the existing question-bank variation prompt, practice loop, and learn loop. Gives the integrity agent's `needs_practice` / `tutor_pivot` dispositions a student-facing destination for the first time.

## Why

Today:
- The **teacher "Tests" tab** is a stub (`web/src/app/(app)/school/teacher/courses/[id]/page.tsx:284` → `<ComingSoon name="Tests" phase="Phase 5" />`). Zero cost to replace.
- The **student "Practice similar" / "Learn similar" buttons** live on individual HW problem cards (`web/src/app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/page.tsx:403-421`). Students only reach Practice/Learn *through* a HW, which couples graded assignments with study surfaces. It's also the only way: if HW has no variations, there's nowhere to study.
- The **integrity agent** already emits a disposition — `pass`, `needs_practice`, `tutor_pivot`, `flag_for_review` — from `AGENT_SYSTEM_PROMPT` (`api/core/integrity_ai.py:186-270`). The disposition ships to the frontend in `IntegrityStateResponse.disposition` (`api/routes/integrity_check.py:84-92`) but is **only rendered on the teacher review panel**. The student never sees or is routed by it.

After this change:
- Practice lives in its own tab for both teacher and student. HW stays purely a submit surface.
- Teachers can clone a HW into a linked practice set (1:1 variations) in one click, inheriting the HW title.
- The integrity agent gets a CTA at end-of-chat that routes to the linked practice set when disposition ∈ `{needs_practice, tutor_pivot}` and a set exists.
- Practice is ungraded. No submission, no integrity check, no grading. Zero student-side tracking in v1.

## Explicit scope boundaries

- **1:1 variations only** — N HW problems → N practice problems, one each. No clustering. Reuses the existing "SIMILAR TO but DIFFERENT FROM" prompt at `api/core/question_bank_generation.py:213-231` which activates when `QuestionBankGenerationJob.parent_question_id` is set (same machinery as the current orphaned `generate-similar` endpoint at `api/routes/teacher_question_bank.py:569-609`).
- **MCQ only** — reuse `web/src/components/school/student/practice-loop-surface.tsx` as-is. Distractors are auto-generated at publish time (`api/core/question_bank_generation.py:262-282`), so no new LLM work. Free-form answer input is deferred.
- **No progress tracking** — no `PracticeAttempt` table, no "learned 2/5" UI. Additive to add later.
- **Not graded** — no `Submission` row created for practice. Integrity check only runs on HW.
- **Pedagogical tradeoff (acknowledged)** — if a teacher hasn't published a linked practice set, students have no self-serve help during HW. Accepted deliberately: HW is HW, practice is practice.

## Schema

New migration after `ay1000042_add_extraction_flagged_at.py`:

```
az1000043_add_practice_assignment_fields.py
  ALTER assignments ADD COLUMN source_homework_id UUID NULL
    REFERENCES assignments(id) ON DELETE SET NULL
  CREATE INDEX ix_assignments_source_homework_id
```

- `assignments.type` stays `String(20)` — no enum, just a runtime validator. Extend the validator to accept `"practice"` (`api/routes/teacher_assignments.py:78-83`).
- `assignments.source_homework_id` is nullable. Only populated when a practice set is cloned from a HW. `ON DELETE SET NULL` so a deleted HW doesn't cascade-nuke the practice set.

## PR stack

Four stacked PRs off `main`, managed by Graphite. Each is logically cohesive and reviewable in isolation. Estimated sizes are rough budgets — the stack bottom carries infra, the top finishes UX.

---

### PR 1 — Schema + backend clone endpoint (~200 lines)

**Branch:** `practice-learn-tab` (base)

**Files:**
- `api/alembic/versions/az1000043_add_practice_assignment_fields.py` — new
- `api/models/assignment.py` — add `source_homework_id` column + update `type` comment
- `api/routes/teacher_assignments.py`:
  - Extend `CreateAssignmentRequest.validate_type` at `:78-83` to accept `"practice"`
  - Extend `CreateAssignmentRequest` with optional `source_homework_id: uuid.UUID | None`
  - Extend `assignment_to_dict` at `:316-341` to serialize `source_homework_id`
  - New endpoint: `POST /teacher/courses/{course_id}/assignments/{hw_id}/clone-as-practice`
- `web/src/lib/api.ts` — add `teacher.cloneHomeworkAsPractice(courseId, hwId)` wrapper

**Clone endpoint contract:**
- Load source HW, verify it belongs to the teacher (pattern from `get_teacher_assignment` at `api/routes/teacher_assignments.py:165-173`)
- Require HW to have problems: enumerate bank items via `problem_ids_in_content(a.content)` (already used at `:334`)
- Create a new `Assignment` row with:
  - `title = source.title` (inherited, the user's discovery signal)
  - `type = "practice"`
  - `unit_ids = source.unit_ids`
  - `source_homework_id = source.id`
  - `status = "draft"` (teacher publishes explicitly, same as HW)
- For each bank item ID in source HW's content, create one `QuestionBankGenerationJob` with:
  - `originating_assignment_id = <new practice assignment>`
  - `parent_question_id = <source HW's bank item>`
  - `requested_count = 1`
  - `unit_id = parent.unit_id` (copied from parent bank item)
  - `source_doc_ids = parent.source_doc_ids`
- Call `schedule_generation_job(job.id)` for each (pattern at `api/routes/teacher_question_bank.py:608`)
- Return `{id, title, status, job_ids: [...]}` — frontend uses job_ids to poll

**No change to `QuestionBankItem.originating_assignment_id` semantics** — items still stamp the assignment that originated them, but now that assignment may be of `type="practice"`. The existing `bulk_assignment_stats` (`:196-294`) already buckets pending-review counts by `originating_assignment_id`, so practice sets get their own review queue for free.

**Edge cases:**
- Source HW has zero bank items → reject with 400. Match the 400 pattern at `api/routes/teacher_question_bank.py:580-582`.
- Source HW is itself `type="practice"` → reject. Only clone from homework.
- Any one generation job fails to queue → continue with the others. The teacher sees partial results in the review queue (same behavior as bulk generation). Return partial success in the response.

**Tests:** `tests/test_teacher_assignments.py` — clone endpoint happy path, authz, empty-HW rejection, `source_homework_id` round-trip.

---

### PR 2 — Teacher Practice tab + Clone-from-HW UI (~300 lines)

**Branch:** stacks on PR 1

**Files:**
- `web/src/app/(app)/school/teacher/courses/[id]/page.tsx`:
  - Rename `TabKey "tests"` → `"practice"` at `:20-27`
  - Change TABS label at `:35` from `Tests` to `Practice`
  - Swap `<ComingSoon name="Tests" />` at `:284` for `<PracticeTab courseId={course.id} />`
  - The "generation in flight" pulsing dot at `:266-270` currently shows only on `homework` tab — extend it to show on `practice` too (practice clones fire N generation jobs, same polling lifecycle).
- `web/src/components/school/teacher/practice-tab.tsx` — new. Mirrors `homework-tab.tsx` (`web/src/components/school/teacher/homework-tab.tsx`) almost verbatim: list, search, filters, bucketing. Filter `type === "practice"` instead of `"homework"` (`:53`). A cloned practice set shows a small badge like "Cloned from HW" with the source title (joined via `source_homework_id`).
- `web/src/components/school/teacher/_pieces/new-practice-modal.tsx` — new. Three-step wizard:
  - **Step 1 — Source:** radio with two options:
    - "Clone from a homework" (default) — select dropdown listing the teacher's HWs for this course (via `teacher.assignments(courseId)`). On submit, calls the clone endpoint from PR 1 and routes to the review queue — identical handoff pattern to `NewHomeworkModal.onCreateAndGenerate` at `web/src/components/school/teacher/_pieces/new-homework-modal.tsx:129-157`.
    - "Start from scratch" — falls through to steps 2+3 identical to the current HW wizard (Details + Problems).
  - **Step 2 — Details (scratch path only):** same fields as `NewHomeworkModal.Step1` (`:290-398`).
  - **Step 3 — Problems (scratch path only):** same fields as `NewHomeworkModal.Step2` (`:404-545`).
  - Wizard creates with `type: "practice"` and optionally `source_homework_id` set.

**Why a new modal rather than a flag on the existing one:** the current `NewHomeworkModal` has two well-tuned steps. Adding a pre-step to pick source mode would make the scratch path feel inflated, and the clone path needs zero of steps 2+3. Easier to read two files than one branchy one. If duplication is too much after implementation, factor out the `Step1Details`/`Step2Problems` subcomponents into `_pieces/assignment-wizard-steps.tsx`.

**Mobile UX:** same as HW tab — stacks vertically, no horizontal scroll on cards. The tab bar is already horizontally scrollable (`overflow-x-auto` at `page.tsx:251`).

**Edge cases:**
- Teacher has zero HWs when picking "Clone from" → disable the option with a hint "Create a homework first"
- Practice set cloned but all generation jobs failed → teacher lands in an empty review queue; existing retry affordance ("Generate more") is already wired.

**Tests:** UI-level tests are light in this codebase; verify via manual testing that the tab renders, the wizard submits both paths, and the generating-dot on the tab pill fires.

---

### PR 3 — Student Practice tab (~350 lines)

**Branch:** stacks on PR 2

**Files:**
- `api/routes/school_student_practice.py`:
  - New endpoint: `GET /school/student/courses/{course_id}/practice` — mirrors `list_homework` at `:486-549` but with `Assignment.type == "practice"`. Returns `StudentPracticeSummary` list.
  - Does **not** report a `status` field (no submitted/not_started concept for practice).
  - New endpoint: `GET /school/student/practice/{assignment_id}` — mirrors `homework_detail` structure so the existing bank-item hydration helpers apply, but skips grade/submission fields.
  - New endpoint: `GET /school/student/homework/{homework_id}/linked-practice` — returns `{practice_assignment_id}` or `null`. Scoped to only return practice sets (a) with `source_homework_id == homework_id`, (b) `status == "published"`, and (c) visible to the student via section enrollment (same section-enrollment join pattern used at `:494-503`). Powers the integrity-chat CTA in PR 4.
- `web/src/lib/api.ts` — add `schoolStudent.listPractice`, `schoolStudent.practiceDetail`, `schoolStudent.linkedPracticeForHomework`.
- `web/src/app/(app)/school/student/courses/[courseId]/page.tsx` — transform from flat list to tabbed layout:
  - Tabs: `Homework | Practice`. Tab key persisted via `?tab=` URL param (same pattern as teacher page at `web/src/app/(app)/school/teacher/courses/[id]/page.tsx:71-84`).
  - `Homework` tab: current flat list, unchanged.
  - `Practice` tab: new component `<PracticeList courseId={courseId} />` — same card layout as HW list, but no status badges. Click routes to `/school/student/courses/{courseId}/practice/{assignmentId}`.
- `web/src/app/(app)/school/student/courses/[courseId]/practice/[assignmentId]/page.tsx` — new. Simpler than the HW detail page (`web/src/app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/page.tsx`):
  - No `SubmissionPanel`, no `AssignmentTimeline`, no `IntegrityCheckChat`, no confirm/flagged branches.
  - Per-problem cards with **Answer** and **Learn it** buttons.
  - Reuses `<PracticeLoopSurface>` (`web/src/components/school/student/practice-loop-surface.tsx`) for Answer and `<LearnLoopSurface>` (`web/src/components/school/student/learn-loop-surface.tsx`) for Learn. Same `mode` state-machine pattern as the HW page at `:30-53`, trimmed to just `homework | practice | learn`.
  - Page header shows the source-HW title ("Cloned from Homework: Quadratics HW #1") when `source_homework_id` is set — reinforces the association.

**"Delightful" UI treatment for the per-problem click-in** — keep it light, don't over-engineer:
- Cards: same visual density as HW, but without the lock icon. Subtle lift on hover (`hover:border-primary` is already the pattern).
- When `approved_variation_count === 0`: show a gentle "Still being prepared" label instead of a disabled button. Practice generation is async — the teacher cloned, jobs are running, student lands before they finish. Polling the card like the teacher's review queue is overkill; a reload pulls fresh state.
- On Answer/Learn button click: same inline transition the HW page uses (mode swap, no route change). Smoother than a route transition.
- Empty Practice tab: a real empty state, not "no practice yet" flat text. One-liner + illustration budget: nothing new, just existing `<EmptyState>` pattern from `web/src/components/school/shared/empty-state.tsx`.

**Edge cases:**
- Student navigates to a practice set whose source HW has been deleted (`source_homework_id` is `ON DELETE SET NULL`) → header omits the "Cloned from" label but the practice set itself still works.
- Practice bank items were generated but the teacher hasn't approved them → they don't appear. Same `approved_variation_count` filter the HW page relies on today.
- A student in the middle of a Practice loop closes their browser → no state to preserve. Practice is stateless in v1; they just re-enter and start fresh.

**Mobile UX:** tabs row is horizontally scrollable if tight, cards stack, Answer/Learn buttons full-width on narrow viewports.

**Tests:** backend endpoints (`list_practice`, `practice_detail`, `linked_practice_for_homework`) — happy path + authz (student not enrolled in the course's sections gets `[]`).

---

### PR 4 — Integrity CTA + HW card cleanup (~150 lines)

**Branch:** stacks on PR 3

**Files:**
- `web/src/app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/page.tsx`:
  - Remove the `startLoop` helper at `:193-220`
  - Remove `loadingProblemId` state at `:61` and the whole `mode.kind === "practice"` and `mode.kind === "learn"` branches at `:240-266`
  - Remove the `pivotToLearnThis` helper at `:162-191`
  - Strip the **Practice similar** (`:404-412`) and **Learn similar** (`:413-421`) buttons from the problem card. Also strip the "N practice problems available" footer text (`:422-428`) and the title tooltip on the lock icon (`:391-396`) — with the buttons gone, it's out of place.
  - Simplify `Mode` type at `:30-53` to drop `"practice"` and `"learn"` variants.
  - After this cut the HW detail page is purely: assignment metadata, `AssignmentTimeline`, problem cards (no actions), `SubmissionPanel` or `SubmittedView`, and integrity flows.
- `web/src/components/school/student/integrity-check-chat.tsx`:
  - At the `isComplete` terminal block (`:345-356`), before the "Back to homework" button, render a **Go to Practice** CTA when:
    - `state.disposition === "needs_practice"` OR `state.disposition === "tutor_pivot"`, AND
    - A linked practice set exists (lookup on mount via `schoolStudent.linkedPracticeForHomework(homeworkId)` from PR 3)
  - The CTA button links to `/school/student/courses/{courseId}/practice/{practiceAssignmentId}`. CTA copy differs by disposition:
    - `needs_practice`: "Want to try a few more like this?"
    - `tutor_pivot`: "Not quite clear? Walk through it step by step."
  - Silent when disposition is `pass`, `flag_for_review`, `null`, or no linked practice set exists.
  - The component currently only receives `submissionId` — it needs `homeworkId` and `courseId` (or the linked-practice lookup result) passed down. Cleanest: extend `IntegrityCheckChat` props with `{assignmentId, courseId}` and thread through from the homework detail page at `:332-341`.

**Edge case: linked practice exists but has no approved variations yet.** Teacher cloned the HW, jobs are still running, student finishes the integrity check before items are approved. The CTA still routes — the Practice detail page's "Still being prepared" empty state (PR 3) handles it gracefully. Tradeoff: better than hiding the CTA, because the linked set does exist and will soon have content.

**Edge case: integrity chat re-opens after initial completion.** The terminal `isComplete` state persists across sessions (the overall_status is committed server-side). The CTA re-renders on re-entry, which is fine — the student can use it multiple times.

**Tests:** unit tests on the CTA conditional logic (disposition × linked-practice matrix); existing integrity tests cover the rest of the chat.

---

## Flow diagrams

### Teacher flow — clone from HW
```
Teacher: Courses → [Class] → Practice tab → + New Practice
  → Wizard Step 1: "Clone from a homework" → pick HW → Submit
    → POST /teacher/courses/{id}/assignments/{hw_id}/clone-as-practice
      → Creates Assignment(type=practice, source_homework_id=hw.id,
                           title=hw.title, status=draft)
      → Fires N QuestionBankGenerationJob rows (one per bank item in
        hw.content), each with parent_question_id = source item
      → Each job runs through existing question_bank_generation.py,
        lands items with source="practice", originating_assignment=new
    → Route teacher to /practice/{new_id}/review (skeleton while jobs run)
    → Teacher approves items → can publish (same flow as HW)
```

### Teacher flow — scratch
```
+ New Practice → "Start from scratch" → same two steps as NewHomeworkModal
  → Creates Assignment(type=practice, source_homework_id=null)
  → Same "Create & generate" or "Skip for now" terminal actions
```

### Student flow — browsing practice
```
Student: Classes → [Class] → Practice tab → Pick practice set
  → /practice/{id}: per-problem card with Answer | Learn it
    → Answer: <PracticeLoopSurface>  (MCQ, existing)
    → Learn it: <LearnLoopSurface>   (steps, existing)
  → No submit, no grade, no state. Close tab = exit.
```

### Integrity agent routing
```
Student submits HW → extraction → confirm → integrity chat
  → Chat completes → disposition committed server-side
  → isComplete terminal panel renders
    → If disposition ∈ {needs_practice, tutor_pivot}
       AND linked practice exists for this HW:
         → "Go to Practice" CTA appears
         → Click → /practice/{linked_assignment_id}
    → Else: terminal panel stays silent (just "Back to homework")
```

---

## What's explicitly NOT in scope

- Clustering (group HW problems → generate variations per group). Tracked as a future idea in `plans/smart-grouped-variations-v2.md` — revisit if teachers report 1:1 feels redundant.
- Free-form answer input. MCQ first via the existing surface; swap in an answer-checker later.
- Student practice progress tracking (attempts, "learned N/M"). Additive when needed.
- "Reshuffle variations" / "request more practice" student actions. Keep the surface read-only in v1.
- Practice on quizzes/tests. Only HW is clonable as a practice source — the current scope has no student-facing quiz/test flow anyway.
- Copying over a HW's rubric or integrity_check_enabled settings — neither is relevant for practice.

## Risks

- **Orphan generation jobs on partial failures:** if 1 of N jobs fails to schedule, the practice set ships incomplete. Mitigation: log and return partial status; teacher retries missing items via "Generate more" in the existing review queue.
- **Stale bank-item reference:** source HW bank item gets deleted after clone job queues but before it runs. The existing generator handles this with a clear error (`api/core/question_bank_generation.py:213-220`: "Parent question was deleted before its variations could be generated"). The partial failure above applies.
- **Session freeze:** teachers expect practice to survive a HW deletion. Set `ON DELETE SET NULL` on `source_homework_id` — practice set stays usable, just loses its "cloned from" label.

## Shipping checklist (per PR)

Before opening each PR:
- All new endpoints have a happy-path test and at least one authz test
- Types compile (`bun run typecheck`), lint passes
- Manual smoke of the specific PR's UI slice in the worktree
- Migration runs both directions locally

After opening:
- CI green before moving to the next PR in the stack
- `/review` run against the PR; confirmed issues fixed; hallucinated ones surfaced in response
