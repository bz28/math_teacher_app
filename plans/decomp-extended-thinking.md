# Decomp Extended Thinking

## Goal

Fix the "guess-and-check then realize" failure mode on problems like factoring
`x² - 11x + 24` by giving the step decomposition LLM call a hidden scratchpad
(extended thinking) so it can plan the approach before writing student-facing
steps.

This is a **quality-only** change. Zero functionality changes. Same inputs,
same output shape, same caching, same error handling. The only observable
differences are:

- Decomp steps read more principled (no visible guess-and-check).
- Uncached decomps take ~1–3 s longer.
- Uncached decomps cost ~1.6–1.8× more; cached decomps are unchanged ($0).

Model stays on Sonnet 4 (`claude-sonnet-4-20250514`). If thinking alone does
not resolve the quality issue, upgrading to Opus 4.6 is a separate follow-up.

## Component 1 — Thread `thinking_budget` through the LLM client

**File:** `api/core/llm_client.py`

1. Add `thinking_budget: int | None = None` kwarg to `call_claude_json`
   and `call_claude_vision`.
2. When `thinking_budget` is set:
   - Pass `thinking={"type": "enabled", "budget_tokens": thinking_budget}`
     to `client.messages.create(...)`.
   - Override `tool_choice` to `{"type": "auto"}` for that call — extended
     thinking is incompatible with forced `{"type": "tool", ...}`.
   - Enforce `thinking_budget >= 1024` (Anthropic API minimum).
   - Enforce `max_tokens > thinking_budget` (API requirement — `max_tokens`
     must leave room for actual output after thinking).

**Why opt-in:** the other ~15 call sites using `MODEL_REASON` (tutor,
work_diagnosis, question_bank_chat, practice, integrity_ai,
assignment_generation, question_bank_generation) don't need thinking yet.
Keeping it opt-in lets us enable it surgically on decomp and evaluate.

**Why tool_choice must flip to auto:** Anthropic's extended thinking rejects
forced tool_use (`{"type": "tool", "name": ...}`) and `{"type": "any"}`.
Only `"auto"` or `"none"` are allowed. With `"auto"` the model chooses
whether to call the tool — in practice it always will because the prompt
structure leaves no other sensible action.

**Defensive handling for `auto` tool_choice:** with forced tool_use today,
`_extract_tool_result` is guaranteed to find a `tool_use` block. With
`"auto"`, the model could theoretically emit only text and return
`stop_reason == "end_turn"` with no `tool_use` block. The existing code
already raises `ValueError("No tool_use block in response")` in that case,
which `call_claude_json` catches and retries. `call_claude_vision` raises
without retry; if the model skips the tool, the student sees an error and
re-submits. Acceptable for v1.

**Why `_extract_tool_result` needs no changes:** it iterates
`response.content` looking for `block.type == "tool_use"`. Thinking blocks
have `type == "thinking"` and are silently skipped.

## Component 2 — Enable thinking on the decomp call sites

**File:** `api/core/step_decomposition.py`

1. `call_claude_vision` call: add `thinking_budget=2000`, bump
   `max_tokens` from 4096 → 8192.
2. `call_claude_json` call: add `thinking_budget=2000`, bump
   `max_tokens` from 4096 → 8192.

**Budget rationale:** 2000 tokens is enough for meaningful planning
(identifying the approach, scratchpad arithmetic, checking constraints)
without wasting tokens rambling. Anthropic's minimum is 1024; 2000 is in
the sweet spot.

**Max tokens rationale:** `max_tokens` must strictly exceed `thinking_budget`
AND leave room for the full tool output. Current decomp output can reach
~3500 tokens for complex multi-step problems with LaTeX.
`8192 = 2000 (thinking) + ~6192 (output headroom)` is comfortable.

**Caching preserved:** `step_decomposition.py`'s in-memory `_cache` is
unaffected — it keys on problem text, not call params. The Anthropic prompt
cache (`_system_with_cache`) is also preserved.

## Component 3 — Cost tracking (no changes needed)

Thinking tokens are billed as output tokens at the same rate and are
already included in `response.usage.output_tokens`. The existing
`_calc_cost` and admin dashboard cost aggregation
(`api/routes/admin_llm.py`) will pick them up automatically, correctly
attributed to mode `"decompose"` / `"decompose_diagnosis"`.

**Estimated cost delta per uncached decomp:**

- Thinking usage: ~1200–1600 tokens (60–80% of 2000 budget in practice).
- Extra cost: ~$0.018–0.024 per uncached call (Sonnet 4 output at $15/M).
- Current uncached: ~$0.028. New uncached: ~$0.046–0.052.
- Cached decomps: $0 (unchanged).

At 500 uncached decomps/day: ~$10/day = ~$300/month additional.
At 50/day: ~$30/month.

## Edge Cases & Error States

| Case | Behavior |
|---|---|
| Model returns only text + thinking, no tool_use (`auto` mode risk) | JSON path: existing retry loop handles it. Vision path: raises, student re-submits. |
| `max_tokens` hit mid-thinking | `stop_reason == "max_tokens"`, existing handling raises and retries. 8192 makes this very unlikely. |
| `thinking_budget < 1024` | Guard in `llm_client.py` raises `ValueError` before calling API. |
| Circuit breaker / cost limit / timeout | Unchanged. |
| `work_diagnosis` path (personalized decomp) | Uses same call sites → gets thinking automatically. |
| Image path (vision decomp) | Same `thinking_budget=2000`, same `max_tokens=8192`. No retry today. |

## What the User Sees

**Student (text decomp):** existing loading spinner stays on screen ~1–3 s
longer; step 1 reads as "identify the pattern" rather than "try pairs."
No visible guess-and-check.

**Student (vision decomp):** same as above; loading state handles the extra
latency naturally.

**Teacher:** no UI change. Admin dashboard shows slightly higher avg cost
per `decompose` call, correctly attributed.

## Scoped Out (follow-ups)

- Opus 4.6 upgrade — separate PR if thinking alone is insufficient.
- Thinking on other `MODEL_REASON` call sites — evaluate on decomp first.
- Promoting `thinking_budget` to env var / config — hardcoded 2000 for v1.
- Admin UI to visualize thinking token breakdown — bundled into output.

## Testing Checklist

1. **Factoring regression:** submit `x² - 11x + 24`; verify step 1 is
   "identify the pattern" not "try pairs."
2. **Multi-step algebra:** submit a 4–5 step problem; verify steps render.
3. **Word problem:** submit a word problem; verify translation step works.
4. **Vision decomp:** submit a photo of a handwritten problem.
5. **Work diagnosis:** submit a problem, make a mistake, request
   personalized decomp; verify "where you went wrong" language still works.
6. **Cache hit:** submit the same problem twice; second should be instant.
7. **Admin cost page:** after testing, check `decompose` mode costs are
   slightly higher than before.
