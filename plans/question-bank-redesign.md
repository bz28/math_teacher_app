# Question Bank tab redesign

Fix three UX problems teachers hit on the Question Bank tab:

1. Pending and Approved use totally different layouts (cards vs table) — jarring to switch.
2. Pending lumps primary questions and practice variations into one list, but they need different approve flows — teachers can't tell which is which at a glance.
3. Approved shows a flat table with jargon ("Needs Vars / No Vars"), ambiguous red dots on variations, and allows an "approved but not in any homework" state that doesn't match the teacher's mental model.

Plus one unrelated cleanup caught during testing: the "DRAFT" badge on courses is a vestigial field that does nothing.

Branch: `fix/question-bank-redesign` (off main).

---

## Principles

- **Pending is the main workspace.** Teachers open it first, ~90% of the time. Optimize it.
- **Approve = attach to homework.** No "approved but orphaned" state. The teacher mental model is: "I'm approving questions into a specific homework." (The WorkshopModal queue already follows this pattern with sticky-homework.)
- **Practice variations are first-class, not a column of red dots.** They're scaffolding tied to a parent question. Teachers think about them explicitly.
- **One row pattern across all tabs.** Same rich-row shape, different chrome per tab. Scans like email — consistent mental model.
- **Kill jargon.** "Vars" → "practice problems." Unlabeled icons → labeled or removed.

---

## 1. Remove "DRAFT" badge on courses

Precondition. The `course.status` field defaults to "draft", can be updated via `PATCH /teacher/courses/:id`, but **nothing in the app checks it**. It's dead metadata that renders a confusing badge on every new course.

**Changes:**
- Remove the status badge from the courses list card (and anywhere else it renders).
- Leave the backend field + migration alone for now — ripping the column out is separate cleanup. Just stop displaying it.
- Remove the `status` update from the Settings tab (the edit UI for something meaningless just adds surface).

**Out of scope:** dropping the column, or re-wiring it to mean "visible to students." Do that in a separate PR if you ever want a real publish/archive flow.

---

## 2. Row pattern — the atomic unit

All question rows (Pending, Approved, any future tab) render in this shape:

```
┌───────────────────────────────────────────────────────────────────────┐
│  ① Matrix multiplication with 2×2 and 2×3                     [STATE] │  ← primary
│     Given matrices B and C, find D = BC. Let B = ...                  │  ← snippet
│     [matrices] [medium] [from Ch5 notes] · 3 days ago    [ACTION]    │  ← meta + action
└───────────────────────────────────────────────────────────────────────┘
```

Spec per line:
- **Primary line:** question title, bold, 15px text. On the far right: a small status chip (`PENDING` amber / `APPROVED` green / `REJECTED` gray).
- **Snippet line:** first ~80 chars of the question text, muted color, truncated with ellipsis. Gives scanning context without needing to open the modal.
- **Meta line:** three small chips left-to-right:
  - Unit chip (e.g. `matrices` or `Uncategorized`)
  - Difficulty chip (`easy` green / `medium` amber / `hard` red — existing colors)
  - Source chip (`generated` vs `from <doc name>` for uploaded/worksheet-sourced)
  - Created-at date in muted text at the end of the meta line
- **Action area (far right of meta line):** tab-dependent primary action (covered below).

Hover: subtle shadow lift. Click: opens the WorkshopModal (no change from today).

**What this replaces:**
- Pending's sparse `[star] [doc icon] Title [difficulty pill]` cards.
- Approved's wide-table columns.

**Mobile:** meta chips wrap below snippet, action chip stays on the right.

---

## 3. Pending tab — split into two sub-sections

Replace the current flat list with **two sections stacked in one page**, each with its own mini-header and the shared row pattern.

```
Pending (5)
─────────────────────────────────────────

NEW QUESTIONS  (3)                      [Review all →]
┌───── row: primary question ──────────┐
├───── row: primary question ──────────┤
└───── row: primary question ──────────┘

PRACTICE PROBLEMS  (2)                  [Review all →]
Practice scaffolding for:
  ◼ Matrix multiplication with 2×2 and 2×3  (1 pending)
  ◼ Sum of ones digits of squares            (1 pending)
```

**NEW QUESTIONS section:**
- Primary questions awaiting approval.
- Each row uses the standard pattern, with action `[Review →]` that opens WorkshopModal in single-item mode (or queue mode via the top `Review all →` button — preserves today's queue UX).
- Status chip: `PENDING` in amber.

**PRACTICE PROBLEMS section:**
- Pending variations, grouped by parent question.
- Each group shows the parent's title + count of pending variations under it.
- Clicking a parent group opens the WorkshopModal in variation-queue mode (already implemented).
- No individual row per variation — too noisy. Parent-grouped scan.

**Empty states:**
- No new questions: "All caught up — nothing new to review. [+ Generate] [Upload Worksheet]"
- No practice problems pending: section collapses entirely (no header).
- Whole tab empty: friendly "You're all caught up" page-level state.

**Kill:**
- Top yellow "Review now" banner (redundant with the section `Review all →` action).
- Star icon, unlabeled doc icon.

---

## 4. Approved tab — group by homework

Reframe from "a flat table of approved questions" to "my questions organized by the homework they're in."

```
Approved (14)
─────────────────────────────────────────
[Search...]    Unit: All ▾   Difficulty: All ▾

HOMEWORK 1 · Chapter 5 Review · Due Fri
  ▸ 5 questions
  
HOMEWORK 2 · Midterm Prep
  ▸ 8 questions
  
NOT YET IN A HOMEWORK (1)
  ▸ 1 question
```

Each homework group is collapsed by default with count visible. Expanding shows the shared row pattern underneath, one row per question. Click a row → opens WorkshopModal.

**Why group by homework:** matches the teacher's mental model per your feedback ("approved should always be in a HW"). Makes finding "which question is in which HW" trivial. Reduces the need for a separate "Used In" column.

**"Not yet in a homework" group:**
- Catches edge cases: variations without a direct HW link, legacy approvals from before the mandatory-destination flow, manual bulk-approves.
- Usually small (often empty). Collapsed by default.

**Filter chips at the top** still work — filtering affects which rows show inside each group.

**Kill:**
- "Needs Vars / No Vars" filter pills (replaced by variation handling in section 5).
- Separate "Variations" column (replaced by nesting).
- The "Used In" column (redundant with grouping).

---

## 5. Practice variations — nest under parent

Inside a homework group, practice variations hang off their parent question as a thin secondary line:

```
① Matrix multiplication with 2×2 and 2×3                       [APPROVED]
   Given matrices B and C, find D = BC. Let B = ...
   [matrices] [medium] [generated] · 3 days ago                [Edit ✎]
   ⤷ 3 practice problems · [Generate more] · [Review pending (1)]
```

Semantics:
- "3 practice problems" links to a detail view (modal or side panel) listing the approved variations.
- "Generate more" triggers the existing generate-similar flow.
- "Review pending (1)" appears only when there are pending variations under this parent — opens the variation-review queue for just that parent.

**Teacher speak:** "practice problems" instead of "variations" across all UI copy. Internally the data model / API names stay as `parent_question_id` etc. — we're just renaming the teacher-facing label.

---

## 6. Search + filters — top bar

Shared across Pending and Approved tabs:
- **Search input** (full text on title + question body). Always visible.
- **Filter chips below:** `Unit ▾` / `Difficulty ▾` / `Source ▾`. Clickable dropdowns, multi-select.
- Chips show selected state ("Unit: matrices ✕") — click the ✕ to clear that filter.

Behavior:
- On Pending: search/filter across both New Questions + Practice Problems sections.
- On Approved: search/filter across all homework groups — groups with zero matching questions collapse or hide.

---

## 7. Homework detail view (small polish)

When a teacher clicks a homework group header (or a dedicated `[View homework →]` link on the group), we could deep-link into the HW detail page. Out of scope for this PR unless it's trivial — I'll skip by default and just expand/collapse inline.

---

## File/route changes (rough)

**Frontend:**
- `web/src/components/school/teacher/question-bank-tab.tsx` — main refactor.
- `web/src/components/school/teacher/question-bank/question-row.tsx` — **new**, the shared row component.
- `web/src/components/school/teacher/question-bank/pending-sections.tsx` — **new**, the two-section pending layout.
- `web/src/components/school/teacher/question-bank/approved-by-homework.tsx` — **new**, the grouped approved view.
- Delete: `approved-table.tsx`, `pending-tray.tsx`, `review-banner.tsx` (functionality folded into the section headers).
- Delete: status badge + edit control in settings-tab for course status (if trivial).
- Delete: course status badge render in the courses list page.

**Backend:**
- No schema changes.
- Maybe trim `course.status` edit endpoint if we're confident nothing depends on it. Defer — not needed for the UI work.
- No API surface changes needed for Pending/Approved view. Existing `teacher.bank()` returns status-filtered items; frontend groups them in the new way.

**Might need a small backend addition:**
- `GET /teacher/courses/:id/homeworks-with-questions` — returns homework groups + their questions, saves the frontend from N queries (or we compute it frontend-side from `assignments()` + `bank(status=approved)` — probably fine for v1, can optimize later).

---

## Commits (rough)

1. `fix(web): remove DRAFT badge and status control for courses`
2. `feat(web): shared QuestionRow component`
3. `feat(web): pending tab with New / Practice sections`
4. `feat(web): approved tab grouped by homework, variations nested`
5. `chore(web): clean up dead question-bank components`

(May collapse some of these — we'll see during implementation.)

---

## Explicitly out of scope

- Bulk select / bulk actions (punted per teacher interview — add if they ask).
- Backend `course.status` column removal (UI-only cleanup now).
- Dedicated homework detail page / deep-linking.
- Deletion/archive of rejected questions (today's flow is fine).
- Keyboard shortcuts for the new tabs (copy from WorkshopModal patterns later).

---

## Known risks / things to watch

- **Tab performance** with many approved questions. Grouping client-side + rendering all rows at once could be slow at 200+ questions. If observed, we add virtualization. Not designing for it v1.
- **Variation visibility** when a parent is rejected/deleted. Current behavior: orphan variations. New UI would need to handle these gracefully — probably surface them in a "No parent" subgroup of the Practice Problems section in Pending.
- **Animation of expand/collapse** on homework groups: needs to feel snappy, not janky. Reuse whatever existing pattern the app uses (framer-motion, likely).
