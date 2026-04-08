# Student Practice / Learn Similar Loop (school students, web)

> Status: Approved, ready to implement
> Branch: feat/student-practice-loop
> Depends on: question-bank redesign (PRs already merged) — `parent_question_id` + approved variations exist
> Related: plans/question-bank-redesign-v2.md, plans/school-features-overhaul.md (Features 0, 7, 10)
> Out of scope: HW submission flow, chat verification engine, mobile, Tests tab, direct (non-HW) Practice tab

## Why

The teacher portal already builds homework with primaries and generates approved sibling variations linked via `parent_question_id`. The student side is the payoff: when a school student is stuck on a HW problem, they need to drop into a *gated* practice loop that burns through that problem's pre-approved variation pool — without ever getting AI help on the HW problem itself. This PR ships that loop end-to-end on web for school students.

The personal-student web app already exists; what's missing is the school-student variant (different UI branch when the logged-in user is tied to a school).

## Locked decisions

| Decision | Value |
|---|---|
| HW primaries are locked from direct Practice/Learn | Yes |
| Entry points on HW page | Two buttons per problem: **Practice similar** and **Learn similar**. Kid picks "try it" vs "see it done" based on need. |
| Source pool | Approved bank items where `parent_question_id = <HW primary id>` |
| Anchor semantics | The HW primary is the permanent anchor; loop button always pulls a sibling of the anchor |
| Recursion | Forbidden — backend keys off the anchor id, never the current variation id |
| Sibling order | Oldest `created_at` first (deterministic, teacher-controlled) |
| Practice answer checking | Pure string equality on MCQ click. No LLM. No equivalence fallback. |
| Practice→Learn transition | Two paths: (a) direct **Learn similar** button on the HW card (primary), (b) flag look-alikes during practice → end-of-session summary "Learn N flagged" button (bonus revisit path) |
| Learn step source | Pre-stored solution steps from the variation. **No** `decompose_problem` call. |
| Learn chat input | **Visible.** `step_chat` / `completed_chat` LLM calls allowed on look-alikes (bounded to teacher-approved content) |
| Question/content LLM calls | Zero on the student side. All content was generated at teacher publish time. |
| Submission | Out of scope. Next PR. |
| Mobile | Out of scope. Later plan. |
| Class detail page | Flat HW list. No Tests / Practice tabs in this PR. |

## LLM call inventory (school student side)

| Moment | LLM? |
|---|---|
| Loading any school-student page | No |
| Pulling next sibling | No |
| MCQ answer check | No (string equality) |
| Entering Learn on a look-alike | No (uses pre-stored steps) |
| Reading Learn steps statically | No |
| Kid types a question into the Learn chat | **Yes** — `step_chat` per message |
| Kid asks a question after completing all steps | **Yes** — `completed_chat` per message |
| Loop mechanics (exhausted / flag / end-of-session) | No |

The only LLM calls on the school-student side are optional, on-demand, per-message Learn chat.

## Product flow

1. Student logs in. Role check routes school students to `/school/student`.
2. **Class picker** — list of enrolled classes. Tap one.
3. **Class detail** — flat list of published homeworks with title, due date, status badge. Tap one.
4. **Homework page** — list of problem cards. Each card:
   - Math-rendered question.
   - Lock icon with tooltip "this is your homework — practice similar problems below."
   - Answer field stub (no submission yet — disabled or read-only placeholder).
   - Two buttons: **Practice similar** and **Learn similar**.
   - Subline: "3 practice problems available" / "You've practiced everything — ask your teacher for more" / "No practice available yet."
5. Tapping **Practice similar** calls `POST /school/student/homework/{assignment_id}/problems/{bank_item_id}/next-variation?mode=practice`.
6. Response is one of:
   - `{ status: "served", variation, consumption_id, remaining }` → swap into the Practice loop surface.
   - `{ status: "exhausted", seen }` → disable button, update tooltip.
   - `{ status: "empty" }` → disable button from the start.
7. **Practice loop surface** — full-screen focused view:
   - Breadcrumb: "Practicing similar to problem 3 of Linear Equations" with back arrow.
   - Look-alike question (math rendered).
   - MCQ option buttons.
   - On click: instant ✓ / ✗ via string equality. If wrong, show the correct option.
   - **Flag** button on each look-alike (mirrors personal Practice).
   - Footer: **Practice similar (next)** · *"2 more available"* · **Done practicing**.
8. Tapping **Practice similar (next)** → same backend call, same anchor, next unseen sibling. Swap payload in place.
9. Tapping **Done practicing** (or hitting exhausted) → **Practice summary**:
   - List of look-alikes done with ✓/✗ marks.
   - If any flagged: **Learn N flagged problems** button (mirrors `practice-summary.tsx` personal flow).
   - **Back to homework** button.
10. Tapping **Learn N flagged** → walk through flagged look-alikes one at a time in the Learn surface (stepper through pre-stored solution steps + visible chat input).
11. **Back to homework** returns to the HW page with state preserved.

## The anchor rule, explicit

- Stack is always (HW primary as anchor) + (current variation as transient view).
- The current variation's id is **never** passed to `next-variation`. Only the anchor is.
- Backend validates the supplied id is one of the assignment's *primary* problems, not an arbitrary bank item. This makes recursion structurally impossible.

## Data model

### New table: `bank_consumption`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| student_id | uuid fk users | |
| bank_item_id | uuid fk question_bank_items | the variation actually served |
| anchor_bank_item_id | uuid fk question_bank_items | the HW primary |
| assignment_id | uuid fk assignments, nullable | the HW the loop launched from |
| context | enum("homework_loop","direct_practice","direct_learn") | `homework_loop` for this PR |
| served_at | timestamp | set on serve |
| completed_at | timestamp, nullable | filled when Practice cycle ends or Learn session exits |
| flagged | boolean, default false | set when student flags this look-alike during practice |
| created_at | timestamp | |

Indexes:
- `(student_id, anchor_bank_item_id)` — hot lookup for "what has this kid seen for this anchor?"
- `(student_id, assignment_id)` — future per-HW analytics
- `(bank_item_id)` — future "how many kids saw this variation"

`anchor_bank_item_id` is denormalized from `parent_question_id` to make the hot lookup a single index hit. Worth the duplication.

`flagged` lives on the consumption row, not a separate `bank_flag` table — one row already exists per (student, look-alike), no need for a second table.

### No schema changes to `question_bank_items`

`parent_question_id` and `status = "approved"` are the only filters needed.

## Backend

### New router: `api/routes/school_student_practice.py`

Mounted at `/school/student`. All routes require `get_current_user_full` and enforce school-student role.

#### `POST /homework/{assignment_id}/problems/{bank_item_id}/next-variation`

Query: `mode` ∈ {"practice","learn"}.

Validation chain (fail fast):
1. Student is enrolled in a section the assignment is assigned to.
2. Assignment `release_status = "published"`.
3. `bank_item_id` is one of the assignment's primary problem ids (not an arbitrary bank item).
4. **Refresh-safe re-serve:** look up an existing consumption row for `(student_id, anchor_bank_item_id, completed_at IS NULL)`. If one exists, return it instead of advancing.
5. Fetch approved children: `WHERE parent_question_id = :bank_item_id AND status = 'approved'`.
6. Fetch already-seen ids from `bank_consumption`.
7. unseen = approved − seen.
8. If approved is empty → `{"status": "empty"}`.
9. If unseen is empty → `{"status": "exhausted", "seen": len(seen)}`.
10. Pick oldest by `created_at`.
11. Insert `bank_consumption` row with `context="homework_loop"`, `served_at=now()`, `flagged=false`.
12. Return `{"status": "served", "variation": <full payload>, "consumption_id": <id>, "remaining": len(unseen)-1, "anchor_bank_item_id": bank_item_id}`.

The variation payload reuses the existing `BankItem` schema (question, MCQ options, correct answer, solution steps).

#### `POST /bank-consumption/{consumption_id}/complete`

Fills `completed_at`. Idempotent. Called when the Practice cycle ends or the Learn session exits.

#### `POST /bank-consumption/{consumption_id}/flag`

Body: `{ flagged: bool }`. Toggles the `flagged` column. Used by the in-loop flag button.

#### `GET /homework/{assignment_id}/problems/{bank_item_id}/flagged-consumptions`

Returns the list of consumption rows for this anchor where `flagged = true`, ordered by `served_at`. Used by the practice summary screen to populate the "Learn N flagged" queue.

### Reuse, don't fork

- Existing Learn session machinery — accept a pre-baked solution steps payload (skip `decompose_problem`). Existing `step_chat` and `completed_chat` reused as-is for the in-Learn chat.
- Existing math rendering, auth, role guards.
- Do **not** extend `/practice/generate`. Personal-only.

### Entitlements

School students bypass session entitlement limits when launched from the HW loop — the school is paying. Mark such sessions with `school_context` so usage analytics can distinguish.

## Frontend (web)

### New route tree: `web/src/app/(app)/school/student/`

- `school/student/layout.tsx` — role check, redirect non-school-students.
- `school/student/page.tsx` — class picker.
- `school/student/courses/[courseId]/page.tsx` — class detail (flat HW list).
- `school/student/courses/[courseId]/homework/[assignmentId]/page.tsx` — HW page.

### New components: `web/src/components/school/student/`

- `class-list.tsx`
- `homework-list.tsx`
- `homework-view.tsx` — top-level HW surface.
- `_pieces/problem-card.tsx` — locked primary, lock icon, answer stub, **PracticeSimilarButton**.
- `_pieces/practice-similar-button.tsx` — handles `next-variation` call + navigation.
- `_pieces/practice-loop-surface.tsx` — wraps the existing Practice MCQ UI; injects the anchor breadcrumb, the in-loop footer, and the flag button.
- `_pieces/practice-summary.tsx` — end-of-session summary with "Learn N flagged" CTA. Mirrors personal `practice-summary.tsx`.
- `_pieces/learn-loop-surface.tsx` — wraps the existing Learn surface; feeds it pre-stored solution steps; passes through the Learn chat input.
- `_pieces/exhausted-state.tsx`
- `_pieces/empty-variations-state.tsx`
- `_hooks/use-next-variation.ts`
- `_hooks/use-flag-consumption.ts`

### API client additions: `web/src/lib/api.ts`

```
schoolStudent = {
  nextVariation(assignmentId, bankItemId, mode): Promise<NextVariationResponse>
  completeConsumption(consumptionId): Promise<void>
  flagConsumption(consumptionId, flagged: boolean): Promise<void>
  flaggedConsumptions(assignmentId, bankItemId): Promise<Consumption[]>
}
```

## Edge cases

| Case | Behavior |
|---|---|
| HW unpublished mid-loop | Next pull 403s → surface shows "this homework is no longer available" → back to class list. Current view left alone. |
| HW primary deleted mid-loop | Same as above, 404. |
| Variation rejected by teacher mid-loop | Filtered at query time (`status = 'approved'`). Currently-viewed look-alike untouched. |
| Teacher generates more variations mid-session | Pool grows; exhausted flips back to served on next pull. |
| Student refreshes mid-look-alike | Refresh-safe re-serve via `completed_at IS NULL` lookup. No double-burn. |
| Two tabs open | Each pulls/consumes independently. Rare; accepted. |
| Network error on next-variation | Inline error + retry. Insert is the last step in the transaction; failed call → no orphan row. |
| Zero variations from the start | Empty state, button disabled. Teacher already gets nagged on their side. |
| Rapid double-tap on Practice similar | Client-side debounce. Backend tolerates one extra row in worst case. |

## What's deferred

- Mobile app parity (separate plan).
- Submission flow (answer + show-work upload + submissions table + teacher viewing) — **next PR**.
- Chat verification engine on submitted work (interrogates the student's submitted work and produces a teacher-side AI summary).
- Direct (non-HW-anchored) Practice — Feature 10, separate plan.
- Tests tab.
- Analytics dashboards on per-student practice usage (Feature 8).
- Spaced repetition / re-serving completed look-alikes on request.
- Cleanup of dead `/practice/check` equivalence-fallback code path on personal side — separate small PR (mock-test usage to verify first).

## Implementation order (small commits)

1. **Migration + model** — `bank_consumption` table, SQLAlchemy model. Model-only tests.
2. **`next-variation` endpoint** — full validation chain incl. refresh-safe re-serve. Unit tests for each branch (enrollment, publish state, primary scoping, empty, exhausted, served, refresh re-serve).
3. **`complete-consumption` + `flag-consumption` + `flagged-consumptions` endpoints.** Idempotent. Unit tests.
4. **API client** — all `schoolStudent.*` methods on `web/src/lib/api.ts`.
5. **Student shell** — `school/student/layout.tsx` with role check; class picker page.
6. **Class detail** — flat HW list page.
7. **HW page skeleton** — render HW detail, problem cards with locked badge, answer stub, both buttons (Practice similar + Learn similar), initially disabled.
8. **Wire Practice similar** — call `next-variation` mode=practice, navigate to Practice loop surface, wrap existing Practice MCQ UI (string-equality check, no LLM), in-loop footer with next-CTA and flag.
9. **Wire Learn similar** — call `next-variation` mode=learn, navigate to Learn loop surface, feed pre-stored solution steps, keep chat input visible, in-loop footer with next-CTA.
10. **Practice summary + Learn flagged queue** — end-of-session screen with flagged list and "Learn N flagged" CTA that walks flagged consumptions through the Learn surface.
11. **Empty + exhausted states** — copy, disabled buttons, tooltips.
12. **Edge-case hardening** — refresh-safe re-serve, mid-session unpublish/reject, error toasts, debounce.
13. **Polish** — skeletons, transitions, accessibility, copy review.

Each commit ~100–250 lines. PR opens when the human gives the word.

## Critical files

- `api/routes/school_student_practice.py` (new)
- `api/models/question_bank.py` (add `BankConsumption` model)
- alembic migration (new)
- `web/src/lib/api.ts` (add `schoolStudent` client)
- `web/src/app/(app)/school/student/...` (new route tree)
- `web/src/components/school/student/_pieces/practice-loop-surface.tsx` (new)
- `web/src/components/school/student/_pieces/practice-summary.tsx` (new)
- `web/src/components/school/student/_pieces/learn-loop-surface.tsx` (new)
