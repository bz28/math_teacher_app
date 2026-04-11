# Mock Test Preview / Loading Screen

## Problem

After generating similar questions (fast, ~2-3s), the exam screen appears immediately but answers and distractors are still loading in. Users see blank/spinning multiple choice options — unpleasant UX.

## Solution

Add an interim screen between question generation and the exam. Behavior differs by exam type.

## Flow

```
User hits "Start Exam"
        ↓
Generate similar question texts (fast)
        ↓
Is it timed?
    ├── NO  → Preview Screen (questions visible, user clicks "Begin Exam")
    │              background: solve all questions in parallel
    └── YES → Loading Screen ("Preparing your exam..." spinner, no questions shown)
                   background: solve all questions in parallel
                        ↓
                   All questions solved → auto-navigate to exam
```

## Preview Screen (untimed only)

- Header: "Your exam is ready" + subject badge
- Numbered list of question texts (KaTeX rendered, no answers)
- Timer reminder if applicable
- "Begin Exam" button — calls `beginMockTest()` in store
- Small subtle spinner if answers still solving in background ("Preparing answers...")
- Back button → calls `reset()`, returns to learn page

## Loading Screen (timed only)

- "Preparing your exam..." with spinner
- Shows question count + time limit: "5 questions · 30 minutes"
- No question texts shown (prevent pre-reading before timer starts)
- Auto-navigates to exam once ALL questions are solved (not just Q1)
- Back button → cancel

## Store Changes (`mock-test.ts`)

- New phase: `"mock_test_preview"` (sits between `"loading"` and `"mock_test_active"`)
- New action: `beginMockTest()` — sets phase to `"mock_test_active"`
- `startMockTest` sets phase to `"mock_test_preview"` after question texts are ready, continues solving in background
- For timed exams: wait for ALL questions before transitioning (not just Q1)

## Component Changes

- New: `web/src/app/(app)/mock-test/_components/mock-test-preview.tsx`
- Update: `web/src/app/(app)/mock-test/page.tsx` — add `mock_test_preview` branch

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User clicks Begin before answers ready (untimed) | Exam starts normally, answers still load in as they arrive |
| Only 1 question | Preview still shows |
| User hits Back | `reset()` → back to learn page |
| Timed exam | Timer starts only when exam screen appears, not on loading screen |
| All solve calls fail | Fall back to exam with empty answers (same as today) |

## Backend Changes

None — purely frontend.
