# Audit findings — teacher portal + school student code

**Date:** 2026-04-10
**Context:** Post-shipping PRs #204 (integrity background task), #205 (school student join form), and #206 (lint cleanup). Ran a deep-dive audit while looking at code quality across the teacher portal and the school-linked student flows.

**⚠️ Status: UNCONFIRMED.** This plan is a checklist of findings to investigate. The user plans to do their own deep dive to verify each item is real and worth fixing before touching code. Do NOT fix anything from this plan without an explicit per-item go-ahead.

---

## How this plan was produced

Two sources of findings:

1. **External audit agent** — produced 28 items (3 critical / 13 warning / 12 nitpick) against specific line numbers
2. **Independent audit agent** — ran a fresh deep-dive on the teacher portal and school student code, told not to duplicate the external agent's findings

Both sets were then **verified by spot-reading the code** at the cited locations. Each item below has a verification status:

- **REAL** — issue is present as described
- **REAL (wrong file)** — issue is present but the audit pointed at the wrong location
- **PARTIAL** — some truth to it but severity or description is off
- **FALSE** — issue doesn't exist or was misdiagnosed
- **NOT VERIFIED** — flagged but code not yet read at that location

---

## Severity legend

- **🔴 Critical** — security or data integrity. Auth bypass, IDOR, silent data corruption, known-crash paths
- **🟡 Warning** — real bug or real quality issue. Won't crash everything but causes real user-visible or operator-visible problems
- **⚪ Nitpick** — cleanup / polish. Code smell, dead code, minor inconsistencies

---

## 🔴 Critical — must fix before ship

### C1. PATCH assignment status bypass
**Verification: REAL (verified by reading code)**
**File:** `api/routes/teacher_assignments.py:452-453`

**The problem:**
```python
if body.status is not None:
    a.status = body.status
```
The general PATCH endpoint writes `status` directly with zero validation. The dedicated `POST /assignments/{id}/publish` endpoint (line 503-539) performs 3 validation checks (has problems, has unit_ids, has at least one AssignmentSection) AND calls `recompute_bank_locks`. The PATCH path skips all of that.

**Secondary bug in the same block:** the `config_fields_touched` check at line 434-440 does NOT include `status`. A teacher can atomically flip `published → draft` + edit `content` in the same PATCH request, because the `if a.status == "published"` check at line 469 runs AFTER `a.status` has been reassigned.

**Impact if not fixed:**
- Teacher integrations / API clients can publish empty HWs (surface damage limited because no student sees them without a section assigned, but it pollutes state)
- Teacher can bypass the "unpublish to edit" UX flow via a single crafted PATCH
- Bank lock recomputation is skipped, leaving locks inconsistent

**Suggested fix:** Remove `status` from `UpdateAssignmentRequest` entirely. Force all status transitions through the dedicated `/publish` and `/unpublish` endpoints. ~5 line diff.

**To verify yourself:** Read `UpdateAssignmentRequest` (line 90-107) and the PATCH endpoint (line 421-482). Compare to `publish_assignment` (line 503-539).

---

### C2. Cross-course unit_id on bank item update
**Verification: REAL (audit pointed at wrong file)**
**Audit said:** `api/routes/teacher_sections.py:149`
**Actual location:** `api/routes/teacher_question_bank.py:347-350`

**The problem:**
```python
if body.clear_unit:
    item.unit_id = None
elif body.unit_id is not None:
    item.unit_id = body.unit_id
```
No validation that the new `unit_id` belongs to the same course as the bank item, or that the unit exists at all, or that the teacher owns the unit.

**Compare to the correct pattern** in `api/routes/teacher_documents.py:153-156`:
```python
if not unit:
    raise HTTPException(404, "Unit not found in this course")
doc.unit_id = body.unit_id
```

**Impact if not fixed:**
- Teacher can assign a bank item to a unit in a different course (theirs or someone else's)
- UI bugs when listing bank items by unit
- Breaks the invariant that "a bank item in course X points to a unit in course X" — every future feature must defensively check

**Suggested fix:** Add the same unit-lookup pattern as `teacher_documents.py`. ~5 line diff.

**To verify yourself:** Read `update_bank_item` in `teacher_question_bank.py`. Search for `unit_id` in `teacher_documents.py` to see the correct pattern.

---

### C3. Blind setattr + weak email validation on admin school update
**Verification: MOSTLY FALSE + LOW-SEVERITY REAL PART**
**File:** `api/routes/admin_schools.py:194`

**The "blind setattr" part is FALSE.** The endpoint uses `body.model_dump(exclude_unset=True)` from a Pydantic model with default `extra = "ignore"`. Pydantic silently drops any field not in `UpdateSchoolRequest` (line 40-47), so setattr can only touch 7 whitelisted fields. Safe.

**The "weak email validation" part is REAL but LOW SEVERITY.** `UpdateSchoolRequest.contact_email` is typed as `str | None` instead of `EmailStr | None`. Inconsistent with `CreateSchoolRequest` which DOES use `EmailStr`. Admin-only field, stored as-is. Data quality issue, not security.

**Impact if not fixed:** Admins can save typo'd / malformed emails on school records. No security exposure.

**Suggested fix:** Change type to `EmailStr | None` in `UpdateSchoolRequest`. 1-line diff.

**To verify yourself:** Read `UpdateSchoolRequest` and `CreateSchoolRequest` in `admin_schools.py`, confirm the type difference.

---

### M1. IDOR in `toggle_visibility` — target_id not scoped to course
**Verification: NOT YET VERIFIED (reported by independent audit agent)**
**File:** `api/routes/teacher_visibility.py:66-113`

**Claimed problem:** Endpoint validates `section_id` belongs to the course but doesn't verify that `target_id` (a unit or document id) does. Teacher of course A can create a `SectionVisibility` row pointing at course B's unit.

**Impact if real:**
- Cross-course data pollution
- Potential for info leak if any future code reads visibility rows and follows target_id to fetch the unit
- Textbook IDOR — exactly the kind of finding that shows up in pen-tests

**Suggested fix:** After validating `section_id`, look up `target_id` scoped to the course and 404 if not found. ~8 line diff.

**To verify yourself:** Read `toggle_visibility` and trace every `target_id` use through to where it touches the DB.

---

### M2. Race condition in `next_variation` — double-serve
**Verification: NOT YET VERIFIED (reported by independent audit agent, claim is very specific)**
**File:** `api/routes/school_student_practice.py:600-708`

**Claimed problem:** No uniqueness constraint on `BankConsumption(student_id, anchor_bank_item_id, bank_item_id)` and no row-level lock on the "in-flight" check. Two concurrent clicks (or a double-tap) can both pass the SELECT, both pick `unseen[0]`, both insert. Student burns the same variation twice, "remaining" counter decrements wrong.

**Impact if real:**
- Students exhaust practice pool faster than expected
- Metrics poisoned (inflated consumption counts)
- Rare at low scale, frequent under load
- Nearly impossible to debug from logs alone

**Suggested fix:** Add `UniqueConstraint("student_id", "anchor_bank_item_id", "bank_item_id")` to `BankConsumption` model + handle `IntegrityError` to re-serve the existing row. ~15 lines + alembic migration.

**To verify yourself:** Read `next_variation` end-to-end. Read `BankConsumption` model in `api/models/question_bank.py` and check for existing constraints. Trace the "in-flight" SELECT and confirm there's no row-level lock (`.with_for_update()` or similar).

---

## 🟡 Warnings — real bugs, fix in a reasonable timeframe

### M5. Naive datetime crash on student submit
**Verification: NOT YET VERIFIED (reported by independent audit agent, but the logic is sound)**
**Files:** `api/routes/teacher_assignments.py:314,459` → `api/routes/school_student_practice.py:514`

**Claimed problem:** `datetime.fromisoformat(body.due_at)` returns a naive datetime if the input string has no timezone. Stored into a TZ-aware column. Later, `datetime.now(UTC) > assignment.due_at` raises `TypeError: can't compare offset-naive and offset-aware datetimes`.

**Impact if real:** One teacher editing a due date without a timezone breaks every student's submit for that HW. Every student sees "Submit failed, try again" until the teacher re-edits with a proper timezone. Hard to debug because the crash surfaces in a different file from the root cause.

**Suggested fix:** Normalize to UTC-aware at write time: `if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=UTC)`. ~3 line diff in both create and update.

**To verify yourself:** Read the `due_at` parsing in both `create_assignment` and `update_assignment` in `teacher_assignments.py`. Read the `is_late` check in `submit_homework` in `school_student_practice.py`. Test with a naive ISO string.

---

### M3. Teacher preview shadow student accumulates stale enrollments
**Verification: NOT YET VERIFIED (reported by independent audit agent)**
**File:** `api/routes/teacher_preview.py:72-98`

**Claimed problem:** The preview endpoint adds section enrollments to the shadow student but never deletes stale ones. If a teacher is later removed from a course, their shadow retains access to that course's sections via the old enrollment row.

**Impact if real:** Ghost access — a teacher who previewed course X and was later removed can still access course X via the Preview feature. Permission audits become unreliable.

**Suggested fix:** Before the sync-add, run a `DELETE FROM section_enrollments WHERE student_id=shadow.id AND section_id NOT IN (current_sections)`. ~10 line diff.

**To verify yourself:** Read `teacher_preview.py` and trace the shadow enrollment logic. Confirm there's no sync-delete step.

---

### W5. Fire-and-forget email with no error handling
**Verification: REAL (verified by external audit agent)**
**File:** `api/routes/admin_schools.py:291`

**Problem:** `asyncio.create_task(send_email(...))` with no error handler. If `send_email` raises, the exception vanishes into asyncio's default "unhandled task exception" log with no Sentry alert, no retry.

**Impact:** Silent invite email delivery failures. Admin clicks "Invite teacher," sees success, teacher never gets the email. No way to know it failed.

**Suggested fix:** Wrap in a helper that catches exceptions and logs via `logger.exception` (which flows to Sentry). ~5 line diff.

**To verify yourself:** Read the invite endpoint in `admin_schools.py` around line 291. Look for the `create_task` call.

---

### W6. `join_section` allows any role to enroll
**Verification: REAL (verified by external audit agent)**
**File:** `api/routes/teacher_sections.py:197-236`

**Problem:** Uses `Depends(get_current_user)` (any authenticated user) instead of a student-only dependency. Teachers/admins with a join code can enroll as students, mixing up their `school_id` + role state.

**Impact:** Role confusion states where a user has `school_id` set but `role != "student"`. Frontend route gates break (`role === "student" && school_id`). Not currently exploitable for privilege escalation, but creates inconsistent states.

**Suggested fix:** Add a dependency that checks `user.role == "student"` and 403s otherwise. ~5 line diff.

**To verify yourself:** Read `join_section` in `teacher_sections.py`, confirm it uses `get_current_user` with no role guard.

---

### W7. Vision branch of `regenerate_one` drops the system prompt
**Verification: REAL (verified by external audit agent)**
**File:** `api/core/question_bank_generation.py:315`

**Problem:** The text path calls `call_claude_json` passing a "you are a professor" system prompt with formatting instructions. The vision path calls `call_claude_vision(build_vision_content(...))` — which does NOT receive a system prompt.

**Impact:** Regenerated questions from image-based problems are noticeably worse quality — no professor tone, no formatting guidance, no safety rails. Silent quality degradation teachers wouldn't know to attribute to this bug.

**Suggested fix:** Pass the same system prompt to `call_claude_vision`. May require extending `call_claude_vision` to accept a system prompt parameter if it doesn't already. ~5-10 line diff.

**To verify yourself:** Read `regenerate_one` in `question_bank_generation.py`. Compare the two branches. Check `call_claude_vision`'s signature in `api/core/llm_client.py`.

---

### W8. `generate_questions` silently swallows exceptions
**Verification: REAL (verified by external audit agent)**
**File:** `api/core/assignment_generation.py:133`

**Problem:** Broad `except Exception` that logs via `logger.exception` and returns `[]`. Caller can't distinguish "no questions generated" from "Claude API crashed."

**Impact:** Callers show an empty questions list whether generation actually produced nothing or the API failed. No UX feedback to the teacher. Silent failures in production.

**Suggested fix:** Re-raise the exception after logging, OR change the return to a Result type (`{ok: true, questions}` / `{ok: false, error}`). Update call sites accordingly. ~10-20 line diff.

**To verify yourself:** Read `generate_questions` in `assignment_generation.py`. Find the `except` block.

---

### W12. Non-atomic approve + homework creation
**Verification: REAL (verified by external audit agent)**
**File:** `web/src/components/school/teacher/question-bank/review-modal.tsx:158-177`

**Problem:** The "Approve and add to homework" button runs `approveVariation(id)` then `createAssignment(...)`. If the second call fails, the first has already committed — variation is approved but never attached to any HW.

**Impact:** Inconsistent state on failure. User retries, may create duplicates. Partial-success bugs confuse users.

**Suggested fix:** Create a new backend endpoint `POST /teacher/variations/{id}/approve-and-add-to-hw` that does both in one transaction. Update the frontend to call the combined endpoint. ~40 line diff (new backend route + frontend call change).

**To verify yourself:** Read `createAndAdd` in `review-modal.tsx` around line 158-177. Confirm the two operations are sequential with no rollback.

---

### M11. `SchoolStudentLayout` SSR/client hydration mismatch
**Verification: NOT YET VERIFIED (reported by independent audit agent)**
**File:** `web/src/app/(app)/school/student/layout.tsx:22`

**Claimed problem:** `const preview = typeof window !== "undefined" && isInPreviewMode()` — evaluates to `false` on SSR and `true` on client, causing a React hydration warning and banner flash.

**Impact:** Console errors during preview-mode sessions, layout flash on mount.

**Suggested fix:** Standard client-only state pattern: `useState(false)` + `useEffect(() => setPreview(isInPreviewMode()), [])`. ~5 line diff.

**To verify yourself:** Read `layout.tsx`. Look for any `typeof window !== "undefined"` branches in render output.

---

### M13. Missing index on `QuestionBankItem.parent_question_id`
**Verification: NOT YET VERIFIED (reported by independent audit agent)**
**File:** `api/models/question_bank.py:56-60`

**Claimed problem:** `parent_question_id` is a foreign key but has no `index=True`. The hottest query in the student practice loop is `WHERE parent_question_id IN (...) AND status='approved'` — a seq scan under current indexing.

**Impact:** Linear slowdown as variations grow. Fine now, catastrophic at scale.

**Suggested fix:** Add `index=True` to the column definition + alembic migration. ~20 lines including migration.

**To verify yourself:** Read the `QuestionBankItem` model. Check for existing `Index(...)` declarations on the column. Run `EXPLAIN` against a representative query in dev if unsure.

---

### W9. Local `Field` component duplicates `shared/field.tsx`
**Verification: REAL but wrong path (verified)**
**File:** `web/src/app/(app)/school/teacher/page.tsx:271`
**Duplicated from:** `web/src/components/school/shared/field.tsx`

**Problem:** Two separate `Field` components with identical signatures and implementations. DRY violation.

**Impact:** Minor. Maintenance: fixing a bug in one won't fix it in the other.

**Suggested fix:** Delete the local one, import from `shared/field.tsx`. ~10 line diff.

**To verify yourself:** Read both files, confirm they're actually identical.

---

### W13. Modal backdrop duplication across 3 teacher files
**Verification: REAL (verified by external audit agent)**
**Files:**
- `web/src/components/school/teacher/_pieces/new-homework-modal.tsx:59`
- `web/src/components/school/teacher/_pieces/homework-detail-modal.tsx:288`
- `web/src/components/school/teacher/_pieces/submissions-panel.tsx:357`

**Problem:** All 3 use the identical backdrop classes: `"fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"`. Copy-pasted.

**Impact:** DRY violation. Consistent styling but brittle — any visual update requires touching all 3.

**Suggested fix:** Extract into a `<ModalBackdrop>` component in `components/ui/` or similar. ~30 line diff (new component + 3 callsite updates).

---

### W14. `reloadDetail` has no try/catch
**Verification: REAL (verified by external audit agent)**
**File:** `web/src/components/school/teacher/sections-tab.tsx:123-125`

**Problem:** Bare async function awaits `teacher.section()` with no error handling. Callers happen to wrap it in a `run()` helper that catches, but that's implicit.

**Impact:** Fragile. A future refactor that calls `reloadDetail` outside `run()` will crash silently.

**Suggested fix:** Add explicit try/catch inside `reloadDetail`, surface errors via the component's error state. ~10 line diff.

---

### W15. `content` typed as `unknown` with unsafe `as` cast
**Verification: REAL (verified by external audit agent)**
**File:** `web/src/components/school/teacher/_pieces/homework-detail-modal.tsx:53`

**Problem:** `hw` typed as `(TeacherAssignment & { content: unknown }) | null`. The code later uses `as` casts to treat it as a concrete shape with no runtime validation.

**Impact:** TypeScript is lying. If the server's `content` shape ever changes, the component renders garbage silently.

**Suggested fix:** Define a proper `HomeworkContent` type, parse/validate at fetch time (or use a runtime validator like Zod if available). ~20 line diff.

---

### M6. No pagination on teacher list endpoints
**Verification: NOT YET VERIFIED**
**Files:**
- `api/routes/teacher_assignments.py:375-403` — `list_course_assignments` / `list_all_assignments`
- `api/routes/teacher_question_bank.py:185-234` — `list_bank_items`

**Claimed problem:** Returns every row unconditionally. The bank endpoint is especially bad because it hydrates question + solution_steps + chat_history JSON for every item.

**Impact:** OOM at scale. Fine today, broken at 10k+ bank items per course.

**Suggested fix:** Add `limit`/`offset` or cursor pagination. Default page size 50. Frontend updated to paginate. ~50 line diff across backend + frontend.

---

### M7. `used_in_assignments_map` is O(all-assignments-in-course)
**Verification: NOT YET VERIFIED**
**File:** `api/services/bank.py:159-213`

**Claimed problem:** Loaded by every per-item endpoint (`serialize_item`, `approve`, `update`). Loads every assignment in the entire course to build a lookup for one item.

**Impact:** Slow bank item operations. Worse as course HW count grows.

**Suggested fix:** Targeted query `SELECT assignments WHERE content @> '{"problem_ids":["<id>"]}'::jsonb` instead of loading everything. ~20 line diff.

---

### M8. `approve_bank_item` re-snapshots entire HW, can 404 on stale siblings
**Verification: NOT YET VERIFIED**
**File:** `api/routes/teacher_question_bank.py:395-426`

**Claimed problem:** When approving an item "into a homework," the endpoint reads existing bank_item_ids, appends the new one, and passes the full list back through `snapshot_bank_items` which re-validates every id. If any OTHER item in that HW was since archived/deleted, the approve 404s on an unrelated item.

**Impact:** Teacher can't approve a new question into a draft HW if any unrelated item is stale. Confusing error.

**Suggested fix:** Only validate the newly-added id, merge into the existing snapshot without re-validating. ~15 line diff.

---

### M9. `delete_course` ghost safety handler
**Verification: NOT YET VERIFIED**
**File:** `api/routes/teacher_courses.py:212-231`

**Claimed problem:** The comments claim CASCADE blocks delete when published bank items exist, but no DB-level constraint enforces that — `QuestionBankItem.locked` is a plain boolean. The `IntegrityError` handler is dead code.

**Impact:** A teacher can delete a course with published HWs, leaving orphaned bank items with stale `locked=true`.

**Suggested fix:** Explicitly query for published assignments before delete, 400 if any exist. Also call `recompute_bank_locks` after delete. ~15 line diff.

---

### M10. `assign_to_sections` delete-loop-then-insert race
**Verification: NOT YET VERIFIED**
**File:** `api/routes/teacher_assignments.py:593-609`

**Claimed problem:** Iterates existing rows, deletes individually, then inserts new. Two concurrent tabs with overlapping desired sets produce non-deterministic final state.

**Impact:** Low. Only bites on concurrent teacher edits of the same assignment.

**Suggested fix:** Use a single `delete(...).where(...not in desired)` + bulk insert. ~10 line diff.

---

### M12. Teacher course page polling effect has stale closure
**Verification: NOT YET VERIFIED**
**File:** `web/src/app/(app)/school/teacher/courses/[id]/page.tsx:99-120`

**Claimed problem:** Timeout branch calls `updateActiveJob({...activeJob, ...})` where `activeJob` is captured at effect creation. If the job shape changed, the timeout overwrites with a stale object.

**Impact:** Rare — a successful job could be clobbered by a late timeout.

**Suggested fix:** Functional setState: `setActiveJob(prev => prev ? {...prev, status: "failed"} : prev)`. ~3 line diff.

---

### M14. `homework_detail` silently drops deleted primary problems
**Verification: NOT YET VERIFIED**
**File:** `api/routes/school_student_practice.py:416-420`

**Claimed problem:** If a primary problem is deleted from the bank after publish, the student sees the HW with fewer problems than `problem_count` on the list and no indication.

**Impact:** Student answer positions silently shift. Could produce incorrect scoring.

**Suggested fix:** Either 500 + log if mismatch detected, or show a "homework has missing problem" banner. ~15 line diff.

---

### M15. `delete_course` missing `recompute_bank_locks`
**Verification: NOT YET VERIFIED**
**Related:** M9
**File:** `api/routes/teacher_courses.py:212-231`

**Claimed problem:** After delete, locks on bank items that had `course_id` set to NULL via cascade become stale.

**Suggested fix:** Call `recompute_bank_locks` after the delete transaction commits. ~5 line diff.

---

## ⚪ Nitpicks — cleanup / polish

### N16. Redundant sqlalchemy import
**Verification: REAL**
**File:** `api/routes/school_student_practice.py:33` (top) + line inside a function body that re-imports `func as sqlfunc`
**Fix:** Remove the inline import.

### N18. Inline imports in `join_section`
**Verification: REAL**
**File:** `api/routes/teacher_sections.py:223-224`
**Fix:** Move `from api.models.course import Course` and `from api.models.user import User as UserModel` to the top of the file.

### N19. Redundant `created_at` + `served_at` on `BankConsumption`
**Verification: REAL**
**File:** `api/models/question_bank.py:175-182`
**Fix:** Pick one column, migrate the data, drop the other. Schema change, minor risk. Consider deferring until a later refactor.

### N22. `<img src>` when image_data is null triggers spurious request
**Verification: REAL**
**File:** `web/src/components/school/teacher/_pieces/submissions-panel.tsx:440-441`
**Fix:** Null-guard: only render the `<img>` element if `image_data` is present.

### N17. Inline imports in teacher_assignments
**Verification: PARTIAL (some are inline but not duplicating top-level imports)**
**File:** `api/routes/teacher_assignments.py:325,776,847-848`
**Fix:** Move to top-of-file for consistency. Low priority.

### M4. `grade_submission` grades preview students
**Verification: NOT YET VERIFIED**
**File:** `api/routes/teacher_assignments.py:695-745`
**Claimed problem:** Everywhere else filters `is_preview=False`, but grading doesn't. A teacher can grade their own preview submission, creating orphaned `SubmissionGrade` rows that don't flow into averages.
**Fix:** Add `if sub.student.is_preview: raise 400`. ~3 line diff.

### M16. Different HTTP codes for "not your resource"
**Verification: NOT YET VERIFIED**
**Files:** Multiple teacher endpoints use 403 ("Not your assignment"), school_student_practice uses 404 ("Not enrolled")
**Fix:** Standardize. Prefer 404 everywhere — avoids leaking existence via HTTP code.

### M17. `CreateSchoolRequest` uses `EmailStr` but `UpdateSchoolRequest` uses `str`
**Verification: REAL (same as C3 partial)**
**Fix:** Make them consistent. 1-line diff.

### M18. `schoolStudent.listClasses` swallows 401
**Verification: NOT YET VERIFIED**
**File:** `web/src/app/(app)/school/student/page.tsx:22`
**Claimed problem:** A 401 gets the same "Couldn't load your classes" message as a 500. Should redirect to login on 401.
**Fix:** Check `ApiError.status === 401` in the catch and call `router.push('/login')`.

### M19. `teacher_visibility` response shape not typed on frontend
**Verification: NOT YET VERIFIED**
**Fix:** Define a `TeacherVisibility` interface on the frontend matching the backend response.

---

## FALSE / NOT PRESENT (don't waste time on these)

The external audit agent flagged these but verification showed they don't exist or don't apply:

- **W4** — `school_id`/`invite_id` typed as `str` — these are FastAPI path parameters; FastAPI + DB FK handles validation. Not a security issue
- **W10** — `new-variation-dialog.tsx` useState initializer — **file doesn't exist** in the codebase
- **W11** — `image_data` in `<img src>` without validation — code trusts a `data:image/*;base64,...` format set by our own backend. Defense-in-depth is nice but not an active vulnerability
- **N20** — Stale comment about "upcoming" integrity checker — actually references a future "in-step chat input" feature, not the integrity checker
- **N21** — `cn()` with single static string — not found in the codebase
- **N23** — Stale "v2" version marker — not found
- **N24** — Emoji search icon — not found (SearchIcon is used properly)
- **N27** — `needsVariationCount` always null — variable doesn't exist in the codebase

---

## Recommended PR groupings (when ready to fix)

### PR A — Critical security + data integrity (HIGHEST PRIORITY)
**Estimated: ~200 lines total**
- C1 — PATCH status bypass
- C2 — Cross-course unit_id
- M1 — IDOR in toggle_visibility
- M2 — next_variation race
- M5 — Naive datetime normalization

These are independent fixes, each small, each preventing a specific known-broken scenario.

### PR B — Auth + enrollment correctness
**Estimated: ~50 lines total**
- M3 — Teacher preview shadow sync-delete
- W6 — `join_section` role check
- M4 — `grade_submission` skip preview students

Thematically related: "the right people access the right things."

### PR C — LLM generation observability + quality
**Estimated: ~30 lines**
- W7 — Vision prompt parity
- W8 — Stop swallowing generate_questions errors

Paired — both about the question generation subsystem.

### PR D — Operations reliability
**Estimated: ~60 lines**
- W5 — `send_email` error handling
- W12 — Atomic approve + createAssignment

Paired — both about silent failures in multi-step operations.

### PR E — Performance / DB
**Estimated: ~30 lines + migration**
- M13 — `parent_question_id` index

Standalone. High ROI once paid.

### PR F — Frontend cleanup
**Estimated: ~80 lines total**
- M11 — SchoolStudentLayout hydration fix
- M12 — Teacher course page stale closure
- W9 — Field component deduplication
- W13 — Modal backdrop extraction
- W14 — reloadDetail try/catch
- W15 — `content: unknown` proper typing

Thematically related: frontend quality.

### PR G — Nitpicks / polish
Grouped cleanup. Defer indefinitely if not worth a review cycle.

### Backlog (defer until performance becomes a problem)
- M6 — Pagination on list endpoints
- M7 — `used_in_assignments_map` optimization
- M8 — `approve_bank_item` snapshot rebuild
- M9 + M15 — `delete_course` cleanup
- M10 — `assign_to_sections` race
- M14 — `homework_detail` silent drop

---

## Verification checklist template

Use this while doing your deep dive. For each item, check it off when you've verified it's real AND worth fixing.

**Critical:**
- [ ] C1 — PATCH status bypass (verified REAL in this audit)
- [ ] C2 — Cross-course unit_id (verified REAL, wrong file in original audit)
- [ ] C3 — Admin email validation (low-sev, mostly false alarm)
- [ ] M1 — toggle_visibility IDOR
- [ ] M2 — next_variation race

**Warnings:**
- [ ] M5 — Naive datetime crash
- [ ] M3 — Preview shadow stale enrollments
- [ ] W5 — send_email error handling (verified REAL)
- [ ] W6 — join_section role check (verified REAL)
- [ ] W7 — Vision prompt dropped (verified REAL)
- [ ] W8 — generate_questions swallows errors (verified REAL)
- [ ] W12 — Non-atomic approve + createAssignment (verified REAL)
- [ ] M11 — SchoolStudentLayout hydration
- [ ] M13 — parent_question_id index
- [ ] W9 — Field duplication (verified REAL)
- [ ] W13 — Modal backdrop DRY (verified REAL)
- [ ] W14 — reloadDetail no try/catch (verified REAL)
- [ ] W15 — content: unknown cast (verified REAL)
- [ ] M6 — No pagination on list endpoints
- [ ] M7 — used_in_assignments_map O(n) scan
- [ ] M8 — approve_bank_item snapshot rebuild
- [ ] M9 — delete_course ghost handler
- [ ] M10 — assign_to_sections race
- [ ] M12 — Teacher course polling stale closure
- [ ] M14 — homework_detail silent drop
- [ ] M15 — delete_course recompute_bank_locks

**Nitpicks:**
- [ ] N16 — Redundant sqlalchemy import (verified REAL)
- [ ] N18 — Inline imports in join_section (verified REAL)
- [ ] N19 — created_at vs served_at on BankConsumption (verified REAL)
- [ ] N22 — `<img src>` spurious request on null (verified REAL)
- [ ] N17 — Inline imports in teacher_assignments (verified PARTIAL)
- [ ] M4 — grade_submission preview students
- [ ] M16 — Inconsistent HTTP codes
- [ ] M17 — EmailStr vs str on UpdateSchoolRequest (same as C3)
- [ ] M18 — listClasses swallows 401
- [ ] M19 — teacher_visibility response shape not typed

---

## Notes

- **This plan does NOT grant permission to fix anything.** Each item needs a separate explicit go-ahead after the user's verification.
- **The severity buckets are suggestions.** User may re-triage after reviewing.
- **The PR groupings are suggestions too.** User may slice differently once real vs not-real is resolved.
- **Some findings are paired** (e.g., C3 + M17 are the same thing). Grouped in the PR recommendations.
- **Timestamps / external coordination:** no deadlines, no blockers on anyone else.
