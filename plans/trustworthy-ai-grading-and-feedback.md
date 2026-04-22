# Trustworthy AI Grading + Per-Problem Feedback

Make the AI grader more trustworthy (calibrated confidence + rubric-aware reasoning + extended thinking) and add per-problem feedback students can actually see.

## Scope (one PR, 7 commits)

1. `feat(api): add confidence + rubric-aware grading prompt` — rewrite `_GRADING_SYSTEM` in `api/core/grading_ai.py` with calibration bands and explicit rubric-application instructions; tighten `_build_rubric_block` to use labeled fields; add `confidence` (0-1, required) to `AI_GRADING_SCHEMA`; persist into `ai_breakdown` + `breakdown`.
2. `feat(api): enable extended thinking on AI grading` — pass `thinking_budget=2048` to `call_claude_json`; bump `max_tokens` from 1024 to 4096 (required: `max_tokens > thinking_budget`).
3. `feat(web): rubric sidebar on teacher review page` — expandable section at the top of the Problems card on the review page; reads `rubric` from the already-fetched `teacher.assignment(assignmentId)` response.
4. `feat(web): low-confidence badge on AI call box` — subtle amber "⚠ Low confidence" pill inline with "AI's call" label when `aiGrade.confidence < 0.6`.
5. `feat(web): per-problem feedback textarea on teacher review` — always-visible `<textarea>` per problem in `ProblemGradeRow`, default value = `entry.feedback ?? aiGrade.reasoning ?? ""`; save on blur via `persistBreakdown`; max 2000 chars.
6. `feat(api): expose per-problem feedback to students on published HWs` — include `published_breakdown` feedback in `StudentHomeworkDetail` when `grade_published_at` is set.
7. `feat(web): render per-problem feedback on student HW detail` — under `app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/`, render per-problem feedback below each score.

## Teacher UX

Opens the review page. Rubric is one click away at the top. Low-confidence AI grades highlighted in amber. AI's reasoning auto-fills a student-facing feedback box; teacher eyeballs and edits ~few of them. Ships with real per-problem feedback.

## Student UX

Opens graded + published HW. Sees per-problem score + feedback sentence explaining what went right or wrong. Before publish: sees score only (existing rule).

## Prompt additions

**Calibration bands:**
- 0.9-1.0: Answer matches key (or trivially equivalent). Rubric criteria clearly met/unmet.
- 0.7-0.9: Confident but some judgment involved.
- 0.4-0.7: Substantive ambiguity.
- <0.4: Guessing. Say so in reasoning ("I'm unsure because X").

**Rubric application:**
For each problem, explicitly evaluate against the rubric:
- Does the student meet the full_credit criterion?
- If not, which partial_credit condition applies, and why?
- Did any common_mistakes appear? Call them out.
- State which specific rubric criterion drove the grade.

## Extended thinking

- `thinking_budget=2048` tokens.
- `max_tokens=4096` (strictly > thinking_budget, per `_build_thinking_kwargs` invariant).
- `call_claude_json` already supports thinking; no wrapper changes needed.
- Forces `tool_choice="auto"` (handled by wrapper).
- 2-3x latency; pipeline is background so no user-visible impact.

## Confidence threshold

0.6 — below triggers "⚠ Low confidence" pill. Adjust from production data later.

## Feedback textarea

- Always visible (not collapsed).
- Default value = teacher entry's feedback, else AI reasoning, else empty.
- Save on blur. Don't save if value equals the default and no prior feedback existed (avoids false-dirty rows).
- Max 2000 characters.
- Visible to student ONLY when `grade_published_at` is set.

## Rubric placement

Expandable section at the top of the Problems card. Simpler than a sidebar, works on narrower viewports, doesn't fight the existing 2-column layout. Collapsed by default. If rubric has no fields, shows "No rubric set for this homework."

## Out of scope (flagged)

- Subject-specific prompts (math-only today).
- Explicit math-equivalence instructions in prompt.
- Prompt caching.
- Keyboard shortcuts.
- Re-run AI grading button.
- Production measurement / before-after test set.
- Broader UI polish (image pane redesign, bulk ops, session-level metrics).

## Target files

- `api/core/grading_ai.py`
- `api/core/llm_schemas.py`
- `api/routes/school_student_practice.py`
- `web/src/lib/api.ts`
- `web/src/app/(app)/school/teacher/courses/[id]/homework/[hwId]/sections/[sid]/review/page.tsx`
- `web/src/app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/page.tsx` (or adjacent)
