# Batch Generate + Parallel Solve — Best of Both Worlds

## Goal

Reduce Claude API cost (batch generation) while keeping fast UX (parallel solving,
streaming answers into the exam as they resolve).

## The Problem With Previous Approaches

- **Pure parallel (pre-fix):** N generation calls + N solve calls all in parallel.
  Fast UX but expensive — N separate generation calls.
- **Pure batch:** 1 generation call, then parallel solves, but student waits for
  ALL steps to complete before seeing anything. Slower perceived UX.

## The Solution

Split the work into two phases on the frontend:

**Phase 1 — Batch generate (1 Claude call)**
Send all source problems in one request. Get back N generated question texts.
Show the exam immediately with placeholder answers ("loading...").

**Phase 2 — Parallel solve (N Claude calls, fired simultaneously)**
For each generated question text, fire a `count=0` solve call in parallel.
As each resolves, fill in that question's answer + distractors live in the store.
Student can start answering Q1 while Q2 and Q3 are still loading.

## Flow

```
1. practiceApi.generate({ problems: [...3 sources...] })
         ↓ (1 call, fast — just text generation)
   Returns: ["Generated Q1 text", "Generated Q2 text", "Generated Q3 text"]
         ↓
2. Show exam immediately with placeholder answers
         ↓
3. Fire in parallel:
   practiceApi.generate({ problem: "Generated Q1", count: 0 })  → fills Q1 answer
   practiceApi.generate({ problem: "Generated Q2", count: 0 })  → fills Q2 answer
   practiceApi.generate({ problem: "Generated Q3", count: 0 })  → fills Q3 answer
         ↓
   As each resolves, update that slot in the store live
```

## Cost

- Before: N generation calls + N solve calls = 2N calls
- After: 1 batch generation call + N solve calls = N+1 calls
- Saving: N-1 generation calls per exam start

## What Changes

Only `web/src/stores/mock-test.ts` — no backend changes needed.

In `startMockTest` when `generateCount > 0`:
1. Call batch generate to get question texts
2. Set exam phase to `mock_test_active` immediately with placeholder answers
3. Fire `count=0` solve calls in parallel using `.then()` to update each slot
4. Wait for first question before showing (same pattern as `count=0` path)

## What Stays the Same

- Backend: no changes
- `count=0` path (solve originals): unchanged
- `submitMockTest`: already waits for all answers to resolve before grading
- Image fallback: problems with images still use individual generate calls
