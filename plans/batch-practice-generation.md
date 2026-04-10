# Batch Practice Generation — Reduce Claude API Costs

## Problem

For a 5-question mock exam with `generateCount > 0`, the current flow makes:

- 5 generation calls (one similar problem per source)
- 5 solve calls (one per generated problem)
- 5 distractor calls (one per generated problem)

= 15 Claude calls per exam start. At scale this is too expensive.

## Goal

Collapse the N generation calls into 1 by sending all source problems in a single
batched Claude call. The solve and distractor calls stay parallel — they can't be
batched since each depends on a different generated question.

New cost per exam start: 1 generation call + N solve calls + N distractor calls.

## Changes

### 1. `api/core/practice.py`

Modify `generate_practice_problems` to accept a list of problems instead of one string.

The user message sent to Claude becomes a numbered list:
> "Problem 1: [text]\nProblem 2: [text]\nProblem 3: [text]\n\nGenerate exactly 1
> similar problem for each, in the same order. Return them as a list."

- Claude returns a list of N generated problems in order
- 1-to-1 mapping preserved by numbered format + explicit ordering instruction
- The count=0 path (solve only) stays — just pass a single-item list

### 2. `api/routes/practice.py`

Accept a list of problems in the request body instead of a single string.
Keep the existing single-problem `/sessions/{id}/similar` endpoint working — it
still passes one problem and is unaffected.

### 3. `web/src/lib/api.ts`

Update `practiceApi.generate` to accept either a single problem or a list,
or add a dedicated `practiceApi.generateBatch(problems[])`.

### 4. `web/src/stores/mock-test.ts`

Replace the `Promise.all` of N individual generate calls with one single batch
call. The solve step remains `Promise.all` (parallel per question — unchanged).

## Flow

```
Before:
  Frontend → call 1 (problem 1) → Claude → question 1
  Frontend → call 2 (problem 2) → Claude → question 2   (parallel)
  Frontend → call 3 (problem 3) → Claude → question 3
  = N generation calls

After:
  Frontend → 1 call (problems 1, 2, 3) → Claude → questions 1, 2, 3
  = 1 generation call

Then (unchanged, parallel):
  Backend → solve question 1 → Claude
  Backend → solve question 2 → Claude
  Backend → solve question 3 → Claude
```

## UX

Student waits slightly longer before the exam appears (~5-8s vs first question
in ~3s). Show a "Generating your exam..." loading state. Exam loads all at once
cleanly rather than trickling in.

## Edge Cases

| Scenario | How to handle |
|---|---|
| Claude returns fewer problems than sent | Pad missing slots with the source problem as-is |
| Claude returns problems out of order | Numbered prompt enforces order; log warning and fall back if count mismatches |
| A problem has an image | Detect any image in the batch → fall back to parallel individual calls |
| Queue larger than 8 problems | Split into mini-batches of 5 to avoid token limits |

## What Stays the Same

- Solve step (parallel per question)
- Distractor step (parallel per question)
- `count=0` path (solve original only)
- `/sessions/{id}/similar` endpoint (single-problem, untouched)
