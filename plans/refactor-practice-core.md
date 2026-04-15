# Refactor: Split generate_practice_problems into clear functions

## Problem

`generate_practice_problems` does two unrelated things hidden behind `if count == 0 and len(problems) == 1`:
1. Generate similar question texts (batch, Haiku)
2. Solve a single problem (decompose + distractors, Sonnet)

## Solution

Split into two clearly named functions:

### `generate_similar_questions(problems: list[str], ...)`
- Takes source problems, returns similar question texts only
- No solving, no distractors
- Returns `list[str]`

### `solve_problem(problem: str, ...)`
- Takes one problem, returns answer + distractors
- Calls decompose_problem + generate_distractors
- Returns `{"question": ..., "answer": ..., "distractors": [...]}`

### `generate_practice_problems` — kept as thin wrapper
- Preserves backwards compatibility for any other callers
- Delegates to one of the two functions above

## What Changes
- `api/core/practice.py` — add the two new functions, simplify wrapper
- `api/routes/practice.py` — call functions by name directly

## What Stays the Same
- All API endpoints (no URL changes)
- Frontend (no changes)
- LLM call patterns (Haiku for generate, Sonnet for solve, parallel async)
