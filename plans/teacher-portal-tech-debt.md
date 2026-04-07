# Teacher portal — known tech debt

> Last updated 2026-04-07 after the cleanup PR (`chore/teacher-portal-cleanup`).
>
> Items here are real concerns that were verified during deep audits but
> deferred from the cleanup PR because they're either bigger than they
> look, need a separate focused PR, or are not urgent enough to justify
> the regression risk right now. Don't let this list rot — refer to it
> when starting any new feature work in the teacher portal.

## Backend

### B1 — N+1 in `list_course_assignments` / `list_all_assignments`
**Files:** `api/routes/teacher_assignments.py:213-253`

Each list endpoint loops over assignments and per-iteration calls
`_get_section_names(a.id)` (1 query) + `get_assignment_stats(a.id)`
(4 queries). At 10 assignments that's 50 queries; will time out at scale.

**Fix:** rewrite as a single query with grouped subqueries / CTEs that
return total + submitted + graded + avg_score + section_names in one
pass joined to the assignments table.

### B2 — `_used_in_for_item` is a course-wide scan per call
**Files:** `api/services/bank.py:162-169`, called from 7 per-item endpoints

`used_in_for_item` calls `used_in_assignments_map(db, course_id)` which
loads ALL assignments in the course and parses their JSON in Python.
Called from PATCH / regenerate / chat send / chat accept / chat discard
/ chat clear / revert. At 50 assignments per course this is 50 row
loads + 50 JSON parses every time the teacher sends a chat message.

**Fix:** real fix is JSONB containment query against `assignments.content`
with a GIN index. Cheaper interim fix: drop `used_in` from per-item
responses entirely (the list endpoint refreshes it on next reload).

### B3 — `delete_course` swallows cascade failures
**Files:** `api/routes/teacher_courses.py:153-162`

Relies entirely on FK CASCADE. If a cascade is blocked (active
submissions, grades), SQLAlchemy raises `IntegrityError` and FastAPI
returns a generic 500 with no actionable message.

**Fix:** wrap `db.delete(course)` + `db.commit()` in try/except
`IntegrityError` and return 400 with "unpublish or remove referenced
assignments first".

### B4 — Bank-item ownership is implicit (not currently broken)
**Files:** `api/routes/teacher_question_bank.py:107-117`

Every per-item endpoint calls `_get_bank_item_for_teacher()` first.
12 of 12 endpoints currently do this correctly. But it's gating
authz from a helper, not a FastAPI dependency — one missed refactor =
broken authz.

**Fix:** promote ownership check to a FastAPI `Depends(...)` that
returns the item. Endpoints take the item directly, can't forget.

### B5 — Inconsistent HTTP codes across teacher routes
- Duplicate-student error returns 400, should be 409 (conflict)
- Expired join code returns 400, should be 410 (gone)
- A few other cases noted in audit

**Fix:** sweep all `HTTPException` calls in `api/routes/teacher_*.py`
and align with REST conventions.

### B6 — Workshop modal state machine refactor (`workshop-modal.tsx` 1324 LOC)
The 3-piece extraction in the cleanup PR helped but the shell still
has 11 useState + 9 useEffect + a `handlersRef` workaround at line ~340
to fight stale closures from the dual single/queue mode interaction.

**Fix:** replace dual state with a discriminated union:

```ts
type WorkshopMode =
  | { kind: "single"; item: BankItem }
  | { kind: "queue"; items: BankItem[]; index: number; resolved: ... };
```

Eliminates the handlersRef hack. Risk: regression surface in the most
complex component in the portal — needs its own PR with manual
verification of every flow.

### B7 — Pydantic response models for bank routes
**Files:** `api/routes/teacher_question_bank.py` `_serialize_item` (19-field dict literal)

Replace with `BankItemResponse(BaseModel)` and use `response_model=`
on every route. FastAPI generates correct OpenAPI; frontend types can
be auto-generated via `openapi-typescript-codegen`. Single source of
truth for the wire format.

## Frontend

### F1 — `useBankData` + `useBankReview` custom hooks
**Files:** `web/src/components/school/teacher/question-bank-tab.tsx` (1411 LOC)

`QuestionBankTab` has 13 useState calls covering three orthogonal
concerns: data fetching, filter state, modal/queue state. Extract:

- `useBankData(courseId, statusFilter, unitFilter)` → `{items, units, counts, loading, error, reload}`
- `useBankReview(courseId)` → `{reviewQueue, reviewQueueParent, openVariationReview, startReview}`

Component shrinks to ~400 LOC with three custom hooks. Risk: touches
all data flow; needs careful testing of every refresh path.

### F2 — `homework-tab.tsx` split (856 LOC, 5 components in one file)
Same approach as workshop-modal split: extract `BankPicker`,
`HomeworkDetailModal`, `EditProblemsView`, `NewHomeworkModal` to
their own files in `_pieces/`. Mostly file moves, low risk.

### F3 — `lib/api.ts` is 940+ LOC
Split into `lib/api/teacher.ts`, `lib/api/student.ts`, `lib/api/auth.ts`,
keeping the shared `apiFetch` helper in `lib/api/_core.ts`.

### F4 — `ApiError.body` typed as `Record<string, unknown>`
**Files:** `web/src/lib/api.ts:173-189`

Loose typing means callers do unsafe casts. Tighten to
`{ detail?: string; [k: string]: unknown }` so callers get
intellisense for the common detail field without `any`-casting.

### F5 — Magic numbers strewn across teacher UI
- `POLL_LIMIT_MS` = 5 minutes (course page)
- 3000ms job poll interval (course page)
- 30000ms undo grace period (workshop modal somewhere)
- 25MB upload cap (materials tab)
- 4000ms toast auto-clear (course page)

**Fix:** consolidate into `web/src/lib/constants.ts` (which already
exists). Each constant gets a name + a comment explaining the choice.

### F6 — `conceptEmoji` should gate by course subject
**Files:** `web/src/components/school/teacher/question-bank-tab.tsx:36-70`

Pure-math keyword regex applied to physics / chemistry courses can
mis-classify (e.g. "rocket fuel" → 🚀, "cost of reagents" → 💰).
Cosmetic, not catastrophic.

**Fix:** pass `subject: string` into `conceptEmoji(title, question, subject)`
and gate the math/sports buckets behind `subject === "math"`.

### F7 — `useBankJobPolling` hook (defer further)
The audit suggested extracting the page-level job polling into a
custom hook. Currently single-use site, hook adds indirection without
payoff. Revisit only if a second consumer appears.

### F8 — JWT in `localStorage` (XSS-exposed)
**Files:** `web/src/lib/api.ts:173-189`

Access tokens currently live in localStorage. Plan already calls
this out — moving to `httpOnly` cookies is a session-management
overhaul that needs its own PR with backend cookie support.

### F9 — `eslint-disable-next-line react-hooks/exhaustive-deps` band-aids
**Files:** several locations in `question-bank-tab.tsx`

These exist because `reload` isn't memoized. Wrap `reload` in
`useCallback` (folded into F1 if we extract `useBankData`).

### F10 — `copyCode` not memoized in `sections-tab.tsx`
Currently fine (passed only into a static onClick) but becomes a
stale-closure foot-gun if the button moves into a memoized child.
Cosmetic.

## What's NOT in this list

These were considered and rejected as overengineering / not real:

- Extract `concept-emoji` to `lib/bank-concepts.ts` — single use site,
  YAGNI.
- `_published_refs` constant extraction in `recompute_bank_locks` —
  used once, naming an inline lambda is overkill.
- `iterUnits` helper in `lib/units.ts` — was speculative export,
  deleted in cleanup PR.
- Workshop modal `sourceItem` bounds-check — already defensive via
  TS optional chaining; adding explicit length guards is noise.
