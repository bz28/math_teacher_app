# Question Bank Tab Redesign (v2)

> **Status:** Drafted, awaiting approval
> **Branch:** `feat/question-bank-redesign` (cut fresh off `main`)
> **Scope:** Web only. **Homework only** — Test and Mock Exam flows deferred to a follow-up plan.

---

## Why we're doing this

The question bank tab today is a 1,375-line single-file dump. Teachers see a dense list, can't search, can't bulk-act, and "approving" a question is disconnected from actually using it — leaving a forgotten pile of approved-but-unassigned questions. The materials tab just got a redesign that nailed the visual language (folder rail, cards, dialogs, skeletons). We want the question bank to feel the same way, AND we want to fix the deeper UX flaw: **approval should be the act of assigning a question to a homework**, not a separate step.

We also want the bank to make the **closed-loop learning model** (from `school-features-overhaul.md`) visible and intuitive: each homework problem is locked from direct student practice; students can only learn through similar variations linked to that problem. The bank UI should make it obvious which problems have practice variations and which are starving.

---

## The model (locked)

**Two kinds of bank questions for HW:**

| Kind | Where it lives | Student-facing? |
|---|---|---|
| **Primary problem** | Inside a Homework | 🔒 Locked — appears in the assignment, can't be tapped for learn/practice |
| **Variation** | Child of a primary problem (`parent_question_id`) | ✅ Practiceable — served when student taps "Practice similar" on the parent |

**The student loop (gated) — future student-side work, NOT in this PR:**
- Each HW problem in the student view will get two buttons: **Practice similar** (MCQ + feedback flow) and **Learn similar** (step-by-step tutoring flow).
- Tapping either serves the next unseen sibling variation of that HW problem.
- From inside Practice/Learn mode, the student can hit "Practice/Learn similar" again → loops to the *next sibling variation of the original HW problem* (never a child of the current variation, never the parent itself).
- Per-student exhaustion tracking: each student burns through Q3's variation pool. When exhausted: "Ask your teacher for more practice."
- **What this PR enables:** the variation data the teacher creates here (HW primary → N child variations via `parent_question_id`) is exactly what the future student endpoints will read. No data rework needed later.
- (Student UI + per-student exhaustion tracking are out of scope for this PR. Teacher bank UI just needs to show how many variations exist per problem.)

**Test / Mock Exam are explicitly deferred.** Future plan will add a parallel "Mock Exam" surface (1:1 with a test) covering broader topic prep. Not in this PR.

---

## What we're building

### 1. Question Bank tab — new structure

```
┌─ Question Bank ──────────────────────────────────────────────┐
│  [+ Generate Questions]               [Show rejected ▢]      │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ ⚡ 12 questions waiting for review     [Review now →]    ││
│  │ • 8 from "chapter5.pdf" (primaries)                     ││
│  │ • 4 variations of "Solve x² + 5x = 0"                   ││
│  └──────────────────────────────────────────────────────────┘│
│                                                                │
│  ┌────────────────┐ ┌─────────────────────────────────────┐ │
│  │ Units          │ │ HW #1 — Linear equations            │ │
│  │                │ │                                     │ │
│  │ ▾ Algebra I    │ │  Q1: Solve 2x+3=11           🔒    │ │
│  │   ▾ HW #1 (3)  │ │      📚 4 practice variations  →   │ │
│  │     ▸ HW #2 (5)│ │                                     │ │
│  │ ▸ Geometry     │ │  Q2: Solve x-7=10            🔒    │ │
│  │ ▸ Uncategorized│ │      ⚠️ 0 variations  [Generate →] │ │
│  │                │ │                                     │ │
│  │                │ │  Q3: ...                     🔒    │ │
│  │                │ │      📚 5 practice variations  →   │ │
│  └────────────────┘ └─────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Three zones:**

- **Top: Pending Review Tray** — banner that only shows when there's pending stuff. Counts grouped by source (which doc / which parent). One button: "Review now →" launches the full-screen review modal.
- **Left: Unit Rail** — nested tree, mirrors the materials folder rail visually. Structure: `Unit → HW → individual HW assignment` with question counts. Plus a top-level "Uncategorized" bucket for orphans (rare but possible — e.g., a question whose homework was deleted).
- **Right: Question List** — for the selected node:
  - **Selecting a HW**: shows its primary problems as cards. Each card has the question, locked badge, and a "📚 N practice variations" expander (or ⚠️ "0 variations [Generate]" if empty).
  - **Selecting a Unit**: shows all HWs in that unit as folder tiles + count of total questions.
  - **Selecting "Uncategorized"**: shows orphan questions.
- Click a problem card → opens existing **WorkshopModal** (edit, regenerate, delete, view solution). Unchanged.
- Click the variation expander → inline list of children, each clickable to its own WorkshopModal.

**Toolbar controls:**
- `+ Generate Questions` button (existing flow, modal unchanged in this PR)
- `Show rejected ▢` toggle — soft-deleted rejects are hidden by default, recoverable here
- (No search bar in v1 — defer until we see if teachers actually need it. Folder rail + card layout should be enough.)

**No drag-and-drop, no multi-select, no bulk actions in v1.** Keep it simple. If teachers ask for these later, add them.

---

### 2. Review Mode — the heart of the redesign

Full-screen modal launched from the pending tray banner. **Two flows depending on what's being reviewed**, but the same visual shell.

#### Flow A — Reviewing fresh primary problems (from "Generate from doc")

```
┌─ Reviewing pending questions ────────────  3 / 12 ────  ✕ ─┐
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                      │
│                                                                │
│   ┌─ Question ───────────────────── [primary · pending] ──┐  │
│   │   Solve  x² + 5x + 6 = 0                              │  │
│   └────────────────────────────────────────────────────────┘  │
│                                                                │
│   ▸ Show solution (3 steps)                                   │
│                                                                │
│   Source: chapter5.pdf · Constraint: "word problems only"     │
│                                                                │
│   ───────────                                                  │
│                                                                │
│        [→ Add to Homework]    [Edit]    [Reject]              │
│                                                                │
│   H = add to homework · E = edit · R = reject · ↑ = solution  │
└────────────────────────────────────────────────────────────────┘
```

**The action:** click `→ Add to Homework` (or press `H`).

A small popover slides up:

```
┌─ Add to homework ─────────────────┐
│  Which homework?                  │
│  ─────────────────                │
│  ◯ HW #1 — Linear equations  (3) │
│  ◯ HW #2 — Inequalities      (5) │
│  ─────────────────                │
│  + New homework                   │
└───────────────────────────────────┘
```

Pick one (or create a new one inline) → question is attached to that HW + status flips to `approved` + auto-advance to next pending question.

**Then:** if the just-approved problem has zero variations, a tiny inline nudge appears at the top of the next question card:

> *"✅ Added to HW #1. Generate practice variations for it? [Generate in background] [Skip]"*

"Generate in background" kicks off a `generate-similar` job for that problem with a default count (5). The variations land in pending (Flow B reviewable). The teacher doesn't have to wait — they keep reviewing the next primary.

#### Flow B — Reviewing variations (from "Generate similar")

Same modal shell, but the buttons are simpler because the destination is implicit (the parent):

```
┌─ Reviewing variations ──── of "Solve x²+5x=0" ── 2 / 4 ── ✕ ─┐
│  ████░░░░░░░░░░░░░░░░░                                          │
│                                                                  │
│   ┌─ Variation ──────────────── [variation · pending] ───┐    │
│   │   Solve  x² + 7x + 12 = 0                            │    │
│   └────────────────────────────────────────────────────────┘    │
│                                                                  │
│   ▸ Show solution (3 steps)                                     │
│                                                                  │
│   ───────────                                                    │
│                                                                  │
│         [✓ Approve]      [Edit]      [Reject]                   │
│                                                                  │
│   ↵/A = approve · E = edit · R = reject                        │
└──────────────────────────────────────────────────────────────────┘
```

`Approve` adds it to the parent HW problem's practice pool. Auto-advance to next variation in the queue.

#### Mixed queue behavior

When the teacher clicks "Review now →" from the pending tray, the queue contains both primary candidates AND variations. The modal shows them in order (primaries first, then variations grouped by parent), and the button set automatically swaps based on the question's type. The header label updates accordingly ("Reviewing pending questions" vs "Reviewing variations of …").

#### Completion state

```
┌─ All caught up  ───────────────────── ✕ ─┐
│            🎉                              │
│      You reviewed 12 questions             │
│      ✓ 9 approved (6 → HW #1, 3 → HW #2)  │
│      ✕ 2 rejected                          │
│      ⏭ 1 skipped                           │
│             [Done]                         │
└────────────────────────────────────────────┘
```

#### Edge cases

- **Action fails (network)** — inline error toast, do NOT advance, retry button.
- **Teacher closes mid-pass** — all changes already persisted, remaining pending stay in the bank.
- **New questions generated mid-review** — not added to current session (queue captured at open time).
- **Edit modal opened from review** — opens WorkshopModal on top, closing returns to the same question; if the edit changed status, auto-advance.
- **Trying to add a primary to a HW that's already published (locked)** — show inline warning, only allow draft HWs in the picker.
- **Approving a variation whose parent was deleted mid-pass** — drop the variation (auto-reject with toast), advance.

#### Mobile

- Full-screen modal.
- Buttons stack vertically.
- Keyboard shortcuts hidden on touch.
- No swipe gestures (too easy to mis-fire).

---

### 3. Visual polish (mirror materials tab)

- **Card layout** for primary problems and variations — not dense rows. Subtle hover lift, locked badge, difficulty chip, source pill.
- **Skeletons** while loading (not "Loading…" text).
- **Specific empty states** per node (e.g., "No questions yet in HW #1 — generate some →" with a button straight to Generate).
- **Pending tray banner** with amber accent, only renders when count > 0.
- **Dialogs** for destructive actions (reject confirmation only when soft-deleted item is being hard-deleted from rejected view).
- **Status pills** consistent with materials' chip styles.
- **Practice variation badge** is the standout new visual element: green "📚 N variations" pill = healthy, amber "⚠️ 0 variations" = needs attention, with one-click generate.

---

## Component breakdown

Slim down `question-bank-tab.tsx` from 1,375 lines into a shell + extracted pieces (mirroring how `materials-tab.tsx` was split):

```
question-bank-tab.tsx                       (shell, ~400 lines)
_pieces/
  pending-tray.tsx                          (banner + grouped counts)
  review-modal.tsx                          (full-screen review, both flows)
  destination-picker.tsx                    (which HW? popover)
  unit-rail.tsx                             (left tree, units → HWs)
  question-list.tsx                         (right side card grid)
  primary-card.tsx                          (one HW problem + variation expander)
  variation-list.tsx                        (children of a primary, expanded)
  generate-variations-nudge.tsx             (inline nudge after Flow A approve)
_hooks/
  use-pending-queue.ts                      (capture + advance through queue)
  use-bank-tree.ts                          (build unit → HW → problems tree)
```

**Reused as-is:** `WorkshopModal` (existing edit modal), `GenerateQuestionsModal` (existing generate flow), `GenerateSimilarDialog` (now invoked silently from the post-approval nudge with a default count), backend `/approve` + `createAssignment` endpoints — no API changes for v1.

**Backend changes needed for v1:**
- One small endpoint (or extend existing approve endpoint) to **approve + attach to assignment in one call**, atomically. Today these are two separate operations and we don't want to leave a window where a question is approved but not attached.
- (Optional) A way to query "primary problems in HW X with their variation counts" efficiently for the unit rail counts. Can be done client-side initially.

**Backend changes NOT needed for v1:**
- Per-student variation exhaustion tracking (student-side, separate work).
- Mock exam / test flows.
- Bank-consumption dashboard.

---

## What's explicitly NOT in this PR

- ❌ Test problem flow (deferred to Test redesign plan)
- ❌ Mock exam concept (deferred)
- ❌ Per-student variation exhaustion (student-side, separate work)
- ❌ Drag-and-drop
- ❌ Multi-select / bulk actions
- ❌ Search bar (revisit if teachers ask)
- ❌ Bank exhaustion dashboard (Feature 8, separate work)
- ❌ Generate Questions modal redesign (Part 1 of old plan — defer to a polish PR)
- ❌ Suggestion chips removal (Part 3 of old plan — defer)
- ❌ Big WorkshopModal redesign (it works, leave it)

---

## Implementation order (small, reviewable commits)

1. **Component scaffolding** — extract sub-files, no behavior changes. Verify nothing broke.
2. **Unit rail + question list** — replace dense list with the rail + card grid layout. No new functionality yet.
3. **Pending tray banner** — add the tray, wire to existing pending count. No review modal yet.
4. **Review modal — Flow A (primaries → HW)** — full screen review modal with destination picker, keyboard shortcuts.
5. **Backend: approve + attach atomic endpoint** — small backend touch.
6. **Review modal — Flow B (variations)** — variation review buttons, parent badge.
7. **Post-approval variation nudge** — the "Generate practice variations?" prompt.
8. **Variation count badges + expanders** on primary cards.
9. **Soft-reject + "Show rejected" toggle.**
10. **Polish pass** — skeletons, empty states, hover, dialogs, keyboard hints, mobile.

Each commit ~100–200 lines, conventional commit messages, all on the same feature branch. PR opened only when user gives the word.

---

## Locked decisions

| Question | Decision |
|---|---|
| Scope | Homework only (no Test / Mock Exam) |
| Destinations in Flow A | Just Homework (since Test is deferred) |
| Variation generation | Prompted after each Flow A approval, default count 5, runs in background |
| Variation loop | Siblings only, never recurse (V1 stuck → V2 sibling, never variation-of-V1) |
| Per-student exhaustion | Out of scope, server-side concern |
| Reject behavior | Soft delete, hidden by default, recoverable via "Show rejected" toggle |
| Search | Not in v1 |
| Multi-select / bulk | Not in v1 |
| Drag-and-drop | Not in v1 |
| Folder structure | Unit → HW → individual HW → problems → variations |
| Workshop modal | Unchanged (escape hatch for careful edits) |
| Generate Questions modal | Unchanged in this PR |
| Branch | `feat/question-bank-redesign` off fresh `main`, no worktree |

---

## Resolved decisions (was open questions)

1. **Approve + attach** — extend the existing `/question-bank/{id}/approve` endpoint to take an optional `assignment_id`. Single round-trip, no new route.
2. **New HW from destination picker** — streamlined inline form: title only, creates a draft. Existing publish gating (requires sections + due date + ≥1 problem) prevents half-baked homeworks from reaching students later.
3. **Rejecting a primary attached to a draft HW** — detach + reject in one action, with confirm dialog: *"Reject this question? It will be removed from HW #1 (draft)."* If the HW is **published**, reject is disabled entirely with tooltip *"Unpublish or remove from HW first"*.
