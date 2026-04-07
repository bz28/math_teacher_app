# Question Bank UX Redesign

> **Status:** Approved, ready to implement
> **Branch:** `feat/school-question-bank-ux` (cut off main after Phase 4 merged)
> **Replaces:** Phase 4 form-style Generate modal + scroll-and-click bank review

Four connected changes. Goal: make the bank a place teachers actually enjoy spending time in.

---

## Part 1 — Generate Questions modal redesign

A focused workspace where the **natural-language constraint is the hero**, source materials are picked visually, small decisions are inline chips at the bottom.

### Layout

```
┌─ Generate Questions ───────────────────────────── ✕ ─┐
│   What kind of questions do you want?                │
│   ┌───────────────────────────────────────────────┐ │
│   │ e.g. Only word problems with friendly numbers,│ │
│   │ match the textbook style                       │ │
│   └───────────────────────────────────────────────┘ │
│                                                       │
│   Source materials  (optional but recommended)       │
│                                                       │
│   📁 Unit 5: Quadratics                              │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│   │   📄     │ │   📄  ✓  │ │   📄  ✓  │           │
│   │ ch5.png  │ │  ws3.png │ │ vert.png │           │
│   └──────────┘ └──────────┘ └──────────┘           │
│                                                       │
│   📁 Unit 4: Factoring                               │
│   ┌──────────┐                                       │
│   │   📄     │                                       │
│   │ ex1.pdf  │  (PDF, skip)                          │
│   └──────────┘                                       │
│                                                       │
│   ─────────────                                      │
│                                                       │
│   How many?    ⚪ 5   ⚪ 10   🟢 20   ⚪ 50           │
│   Save to      [Unit 5: Quadratics ▾]               │
│                                                       │
│                                  [✨ Generate]       │
└───────────────────────────────────────────────────────┘
```

### Key changes

- **Constraint at the top as the hero** (was buried at the bottom)
- **Doc grid of cards** grouped by unit, replacing the vertical checkbox list
- **Quantity as chips** (5/10/20/50), no number input, no custom
- **Smart "Save to" default**: if all selected docs share a unit, auto-pick it; else "Uncategorized"
- **Single Generate button**, no Cancel (✕ in top right does that)
- PDFs render disabled with a "skip" badge

### Edge cases
- **No materials uploaded** → empty state with link to Materials tab
- **Only PDFs available** → all cards disabled, generation still works (constraint + unit name only)
- **Empty constraint AND no docs** → Generate allowed but tooltip warns
- **30+ docs** → grid scrolls vertically inside the modal

### Mobile
- Full-screen modal on small screens
- Doc cards wrap to 2 columns
- Quantity chips on one row
- Constraint textarea full width

---

## Part 2 — Review Mode

A focused single-question review interface that walks the teacher through pending questions one at a time.

### Invocation
1. **"Review now →"** button on the generation success banner
2. **Persistent "Review pending (X)" button** in the bank tab header next to "+ Generate Questions" — only visible when X > 0

Both launch the same modal. Queue is **all pending in the bank**, captured at open time.

### Layout

```
┌─ Reviewing pending questions ────────────  3 / 12  ─ ✕ ┐
│                                                          │
│   ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░  (progress)   │
│                                                          │
│   ┌─ Question ─────────────────── [pending] ────────┐  │
│   │   Solve x² + 5x + 6 = 0                          │  │
│   └────────────────────────────────────────────────────┘  │
│                                                          │
│   ▸ Show solution (3 steps)                             │
│                                                          │
│   Source: chapter5.png                                   │
│   Constraint: "Only word problems"                       │
│                                                          │
│   ──────────────                                         │
│                                                          │
│   [✕ Reject]   [Skip]   [✏ Edit]   [✓ Approve]         │
│                                                          │
│   ↵ approve · X reject · S skip · E edit · ↑ solution  │
└──────────────────────────────────────────────────────────┘
```

### Behaviors
- **Single pending question at a time**, big, MathText rendered
- **Progress bar + counter** at the top
- **Source + constraint** shown below the question card (separate footer area, keeps the question card clean)
- **Solution collapsed by default**, click ▸ to expand inline; toggle persists across questions in the session
- **Action buttons**: Reject / Skip / Edit / Approve
  - Approve / Reject hit the API and advance to next pending
  - Skip leaves status unchanged and advances (no new state — "skipped" just means "deferred")
  - Edit opens the QuestionDetailModal on top of review mode; closing returns to the same question
- **Keyboard shortcuts**: Enter/A approve, X reject, S skip, E edit, ↑/↓ toggle solution, Esc close
- **Tip line at the bottom** spells the shortcuts out

### Completion state

```
┌─ All caught up  ─────────────────────────── ✕ ─┐
│                                                  │
│            🎉                                    │
│                                                  │
│      You reviewed 12 questions                  │
│      ✓ 9 approved                                │
│      ✕ 2 rejected                                │
│      ⏭ 1 skipped                                 │
│                                                  │
│             [Done]                               │
└──────────────────────────────────────────────────┘
```

### Edge cases
- **Zero pending when review mode opens** → empty state, modal closes
- **Action fails (network)** → inline error toast, do NOT advance, retry possible
- **Teacher closes mid-pass** → all changes already persisted, remaining pending stay in the bank
- **Edit modal opens, teacher accepts a chat proposal** → question is no longer pending, review mode auto-advances
- **New questions get generated mid-review** → not added to current session; queue is captured at open time

### Mobile
- Full-screen modal
- Buttons stack 2 per row: [Reject] [Skip] / [Edit] [Approve]
- Keyboard shortcuts hidden on touch
- **No swipe gestures** — too easy to mis-fire on questions that need careful review

### Out of scope
- Bulk approve / multi-select
- Filter by difficulty / source / unit
- Undo last review action
- Resume / save review progress
- Job-batch linking ("review only this batch")

---

## Part 3 — Kill the suggestion chips

Remove the 3 chips ("Make it harder", "Add a step to the solution", "Rewrite as a word problem") from the empty-state of the chat panel inside QuestionDetailModal.

The welcome message ("Hi! Ask me anything...") still renders. The chips are duplicating discoverability for no benefit — generic chips produce generic edits, and teachers who care will type their own.

---

## Part 4 — Bank list visual differentiator

Pending cards in the bank list look identical to approved/rejected cards. Tiny polish:

- **Pending cards**: thin amber left border (4px stripe)
- **Approved cards**: thin green left border
- **Rejected cards**: no border + reduced opacity (de-emphasized)

5 lines of Tailwind. Status pill on the right stays as the explicit indicator.

---

## What's NOT changing in this PR

**The QuestionDetailModal (workshop) stays as-is** except for the suggestion chips removal. Reasons:

1. It's the most recently iterated surface in the bank — going back so soon risks regressions
2. The bigger UX wins are upstream (bank list + generate modal get hit way more often)
3. Review mode obviates the workshop for the bulk case — workshop is now the escape hatch for "I need to actually edit this one carefully"
4. The workshop already has a clear visual identity (numbered solution cards, tinted final-answer callout, math rendering)

A future polish pass could improve: welcome state, mobile drawer transition animation, solution card per-step coloring, "AI is thinking" typing indicator. None blocking.

---

## Implementation chunks

One commit. Order:

1. **Strip suggestion chips** from `question-detail-modal.tsx` (5-line delete)
2. **Bank list card visual differentiator** in `question-bank-tab.tsx` BankItemCard (5-line change)
3. **New `ReviewModeModal` component** at `web/src/components/school/teacher/review-mode-modal.tsx`
4. **Wire review mode** into `question-bank-tab.tsx`:
   - State: `reviewModeOpen: boolean`
   - "Review pending (X)" button in the header (only when X > 0)
   - "Review now →" button on the success banner when activeJob.status === "done"
5. **Generate modal redesign** in `question-bank-tab.tsx` — full rewrite of `GenerateQuestionsModal`. Replace `DocCheckbox` with `DocCard` (grid card). Add smart save-to default logic.

Estimated diff: ~500 lines added, ~150 deleted.

---

## Locked design decisions

| Question | Decision |
|---|---|
| Quantity chip values | 5 / 10 / 20 / 50 (no custom) |
| Doc cards show image thumbnails? | No — icon only this PR (defer thumbnails to polish pass) |
| Skip = new state? | No — just leaves status pending, advances |
| Source/constraint position in review mode | Below the question card (separate footer area) |
| Bank list border colors | Reuse status badge palette (amber/green/gray) |
| "Review pending" button location | Bank tab header, next to "+ Generate Questions" |
