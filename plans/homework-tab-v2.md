# Homework tab v2

> **Status:** Approved, implementing now
> **Branch:** `feat/homework-tab-v2`
> **Combines:** A (Homework tab redesign) + C (edit unit_ids on existing HWs) from the post-question-bank roadmap

## The big idea

Make the Homework tab the canonical place a teacher manages a homework as a deliverable — units, due date, late policy, sections, lifecycle state. Mirror the visual language of Question Bank (cards, chips, math previews) so the two tabs feel like siblings.

## What it answers for the teacher

1. *"What homeworks have I built and what state are they in?"*
2. *"Which are due soon? Late? Not assigned to any sections?"*
3. *"I need to set up HW 5 to publish next Friday to Period 2"*
4. *"I need to fix something on this homework"*
5. *"How are students doing on this?"* (placeholder hook for later)

---

## Page 1 — Homework tab (the list)

### Layout

```
┌─ Homework ───────────────────────────────────────────────┐
│  [+ New Homework]                                         │
│  3 published · 4 drafts                                   │
│  [🔍 Search homeworks…]                                   │
│                                                            │
│  ┌───────────────┐  ┌─────────────────────────────────┐  │
│  │ Filter by unit│  │ 📁 MATH                          │  │
│  │  All units 7  │  │   📝 hw 1: Linear eqs            │  │
│  │  No unit   1  │  │      Due Fri Apr 11              │  │
│  │  math      4  │  │      Period 2, Period 3          │  │
│  │  chem      2  │  │      DRAFT · 5 problems · ⚠️ 1   │  │
│  │  physics   1  │  │   📝 hw 2: Quadratics            │  │
│  │               │  │      No due date · No sections   │  │
│  │               │  │      DRAFT · 3 problems          │  │
│  │               │  │ 📁 CHEMISTRY                     │  │
│  │               │  │   📝 hw 3: Reactions             │  │
│  │               │  │      Due Mon Apr 14 · Period 1   │  │
│  │               │  │      PUBLISHED · 8 problems      │  │
│  └───────────────┘  └─────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### What each HW card shows
- Title + draft/published pill
- Due date (or "No due date") + section names (or "No sections")
- Status row: DRAFT/PUBLISHED · N problems · ⚠️ M need variations
- Open ↗ button (whole card is clickable)

### Sort
Within each unit section: **due-date-asc with no-date last**, then alphabetical by title as tiebreaker.

### Search
Title only.

---

## Page 2 — HomeworkDetailModal (the edit surface)

### Sections

**A. Header** — status pill + click-to-edit title + close

**B. Configuration block** (NEW)
1. **Units** (`UnitMultiSelect`) — required, inline auto-save
2. **Due date** — `input type=datetime-local` + Clear button, inline auto-save
3. **Late policy** — radio: None / 10% per day / No credit after due, inline auto-save
4. **Sections** (`SectionMultiSelect` — NEW component) — inline auto-save

**C. Problems block** — fat ProblemCard visual matching Question Bank, Edit Problems link unchanged

**D. Footer**
- Primary: `Publish ▸` (or `Unpublish` if published). Disabled with tooltip if missing prerequisites (units, sections, ≥1 problem).
- Secondary: `⚙ Submissions` placeholder (Coming soon tooltip)
- Destructive: `Delete` (existing flow)

### Inline auto-save
PATCH on field change. Subtle "saved a moment ago" hint that fades. Inline error + Retry on failure. Matches Notion/Linear/Asana pattern.

### Locked when published
Configuration block is read-only when status === "published". Banner: "Unpublish to edit configuration." Title can still be edited.

---

## Component breakdown

### New components
- `_pieces/section-multi-select.tsx` — chip picker mirroring UnitMultiSelect
- `_pieces/inline-saved-hint.tsx` — "saved" / "error / retry" indicator
- `_pieces/homework-card.tsx` — fat HW card with state at-a-glance
- `_pieces/homework-list.tsx` — unit-grouped list (mirrors ApprovedView)

### Modified files
- `homework-tab.tsx` — search bar, slim unit rail, render HomeworkList
- `_pieces/homework-detail-modal.tsx` — add configuration block, problem card upgrade, inline auto-save, footer publish gating
- `_pieces/new-homework-modal.tsx` — no changes (already has units; rest filled in detail modal)
- `lib/api.ts` — verify/add `teacher.sections(courseId)` if missing

### Reused
- `UnitMultiSelect` (from PR #189)
- `UnitRail` (small adapter prop for HW filter)
- `MathText`, card visual language, chip styles
- `assignment_to_dict` already serializes everything we need

### Backend
**No model changes.** `updateAssignment` already supports all the fields. `assignToSections` endpoint exists. Verify `teacher.sections(courseId)` exists in the client.

---

## Locked decisions

| Question | Decision |
|---|---|
| Inline auto-save vs explicit Save button | Inline auto-save |
| Due date / sections at create or detail? | Detail only — keep create lean, publish gates the rest |
| Submissions placeholder visible? | Yes, with "Coming soon" tooltip |
| Sort within unit sections | due-date-asc, no-date last, alphabetical tiebreaker |
| Search scope | Title only |
| Date picker | Native `input type=datetime-local` |
| UnitRail reuse | Adapter prop, no fork |

---

## What's deferred
- Real grading view (separate PR)
- Bulk actions on HW cards
- Sort dropdown (implicit due-date sort suffices)
- Drag-to-reorder problems
- Quizzes/Tests redesign
- Per-section publishing
- Mobile-specific date picker library

---

## Implementation order

1. Backend audit — verify `teacher.sections(courseId)` in lib/api.ts
2. `SectionMultiSelect` component (standalone)
3. `InlineSavedHint` component (standalone)
4. `HomeworkCard` + `HomeworkList` extracted to `_pieces/`
5. HomeworkTab restructure — search bar, slim rail, list
6. HomeworkDetailModal — configuration block (units edit = the C piece)
7. HomeworkDetailModal — fat problem cards
8. HomeworkDetailModal — footer + Submissions placeholder + publish gating
9. Empty states + polish + mobile

Each commit ~100-200 lines. Whole PR ~800 lines net add.
