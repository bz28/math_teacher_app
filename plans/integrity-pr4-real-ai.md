# PR 4: Replace AI Stubs with Real Claude Calls + Remove Rephrase

## Summary
Swap the 3 stub functions in `integrity_stub.py` with real Claude Vision + Sonnet
calls. Remove the rephrase feature entirely (button, endpoint, stub).

## What Changes

### 1. `extract_student_work(submission_id, db)` — Vision
- Load the submission's `image_data` (base64) from the DB
- Send to `call_claude_vision()` with a prompt asking the model to extract
  the student's work steps as structured JSON
- Tool schema returns `{steps: [{step_num, latex, plain_english}], confidence: float}`
- If confidence < 0.3 → mark problem `skipped_unreadable`
- Needs `db` param added (currently takes only submission_id)

### 2. `generate_questions(problem_text, extraction)` — Sonnet text
- System prompt: worldclass professor who cares about student learning.
  Wants to ask 2-3 short questions that test whether the student
  understands *their own* work. Rules:
  - Reference something specific the student wrote
  - Answerable in 1-2 sentences by someone who did the work
  - NOT answerable by someone who only has the final answer
  - No trick questions, grade-appropriate language
  - Do not ask them to re-derive the solution
- Tool schema returns `[{question_text, expected_shape, rubric_hint}]`
- 2-3 questions per problem

### 3. `score_answer(question, answer)` — Sonnet text
- Gets: question, expected_shape, rubric_hint, student's extraction, answer
- System prompt: evaluate whether the answer demonstrates genuine
  understanding of the work. Be fair — short but correct answers are fine.
- Tool schema returns `{verdict: good|weak|bad, reasoning: str, flags: []}`
- Flags: `vague`, `contradicts_own_work`, `generic_textbook`, `acknowledges_cheating`

### 4. Remove rephrase
- Delete `rephrase_question()` from stub
- Delete `/rephrase` endpoint from `integrity_check.py`
- Remove "I don't get this" button from `integrity-check-chat.tsx`
- Remove rephrase-related frontend API method + type
- DB column `rephrase_used` stays (no migration), just never set

## LLM Modes (for cost tracking)
- `integrity_extract` — Vision call
- `integrity_generate` — question generation
- `integrity_score` — answer scoring

## Pipeline Changes
- `start_integrity_check` needs to pass `db` to `extract_student_work`
  so it can load the submission image
- `extract_student_work` becomes the only function that needs `db`;
  `generate_questions` and `score_answer` stay pure (no DB access)
- `score_answer` needs the extraction context added to its signature
  so it can check answers against the student's actual work

## Cost Estimate
- Per submission (5 problems, ~2.5 questions each):
  - 1 vision call for extraction: ~3k in / 500 out
  - 5 generation calls: ~2k in / 1k out each
  - ~12 scoring calls: ~1.5k in / 300 out each
  - Total: ~$0.08-0.15 at Sonnet pricing

## Not in This PR
- Teacher config (enable/disable) — PR 5
- Rollout + polish — PR 6
