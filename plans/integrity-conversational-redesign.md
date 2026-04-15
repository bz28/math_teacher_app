# Integrity checker — conversational redesign

## Why

Today's checker is a 2-3 question quiz per problem, scored independently per answer, then averaged into a badge. The code audit flagged several real problems with that shape:

- **Pre-written questions waste turns.** Confident students burn through 2-3 questions they could nail in one. Struggling students get abandoned with a "bad" verdict instead of a follow-up.
- **Independent scoring can't probe.** A vague answer gets marked "weak" and that's it — no "can you say more about that step?"
- **Three prompts doing one job.** Separate generate + score + badge-math stages instead of one agent with a goal.
- **Dead fields and mixed framing.** `rephrase_used`, `tab_switch_count`, `VERDICT_REPHRASED`, `VERDICT_SKIPPED` are in the schema but nothing writes them. Generate prompt says "not to catch cheaters" while scoring looks for `acknowledges_cheating` — pick one.
- **Teacher can't see what the agent saw.** `student_work_extraction` is stored but never rendered, so flagged students come with no way to verify the agent wasn't hallucinating.

The redesign: **one teacher-agent, one conversation per submission, one goal — reach strong confidence that this student understands the material and did their own work.**

Branch: new branch off `main`.

---

## Principles

- **The agent has a goal, not a script.** It probes until confident, then submits a verdict and moves on.
- **One conversation, one transcript.** Everything the teacher needs is visible as a chat log.
- **Grounded in extracted work.** The agent references specific steps the student wrote. Confidence is earned by explaining those steps, not by assertion.
- **Two registers, one system prompt.** Backend instructions speak honestly about determining authenticity. Student UI copy stays warm.
- **Clean cutover.** Pre-scale feature. No feature flag, no parallel old flow. Drop existing integrity data in the migration — no real-user data at stake.

---

## 1. The student experience

### Phase 1 — Submit (unchanged)
Student uploads HW image, lands on pending view, polls until ready.

### Phase 2 — Warm entry (unchanged)
Same `IntegrityCheckEntry` copy: "Quick understanding check · ~2 minutes · Start".

### Phase 3 — Chat (redesigned)

A real chat UI. Agent opens first with a personalized message, student replies, turn by turn. No visible "Problem 1 of 3, Question 1 of 2" counter — the agent naturally transitions: *"Okay, let's look at problem 2 now. You wrote ∫2x dx = x². What does the 2 in front of the x tell you to do?"*

**What it looks like:**

```
┌────────────────────────────────────────┐
│  Quick understanding check             │
│  [━━━━━━━━━━──────] 1 of 3            │
│                                        │
│  Agent: Hi! I saw your work on these   │
│  problems. On problem 1 you wrote      │
│  (x+5)(x-3). How did you pick those    │
│  two numbers?                          │
│                                        │
│                    You: I multiplied   │
│                    them to get -15 and │
│                    added to get 2      │
│                                        │
│  Agent: Nice. Let's look at problem 2. │
│  ...                                   │
│                                        │
│  [textarea · "Type your answer"]  Send │
└────────────────────────────────────────┘
```

- Thin progress bar at the top reflects problems verdicted so far (e.g. 1 of 3). No turn counter.
- Minimum 5 chars per student message (preserved from today).
- When `finish_check` fires: agent says *"Thanks! Your work is with your teacher."* and the "Back to homework" button appears.
- **Mobile:** single-column chat, textarea docks to the keyboard, send button beside it. Standard mobile chat pattern.

### Edge cases

- **Unreadable image** (extraction confidence < 0.3): skip the chat entirely, mark the whole check `skipped_unreadable`. Student sees *"All set — no questions this time."*
- **Student closes tab mid-conversation:** rejoins where they left off. Conversation state lives in the DB, re-render from transcript on mount.
- **Agent hits turn cap without finishing:** server forces `finish_check` with overall `uncertain` + "hit turn limit" reasoning. Don't let cost run away.
- **Backend error mid-turn:** show "Something went wrong, try again" with retry. Don't lose the transcript.
- **Student sends gibberish repeatedly:** the agent will flag low confidence naturally; the turn cap prevents infinite dig-in.

---

## 2. The teacher experience

Per submission in the submissions panel, the "Understanding Check" section becomes:

```
┌────────────────────────────────────────────────────────┐
│  Understanding Check                                   │
│                                                        │
│  ✗ Unlikely · 88% confidence                          │
│  "Student couldn't explain the factoring on problem 1  │
│   and gave contradictory reasoning on problem 3."      │
│                                                        │
│  ─── Per problem ─────────────────────────────────     │
│                                                        │
│  Problem 1   ✗ Unlikely · 91%                          │
│    Could not identify why (x+5)(x-3) was chosen.       │
│    ▸ What the agent saw  (collapsed by default)        │
│    [Dismiss this check]                                │
│                                                        │
│  Problem 2   ✓ Likely · 82%                            │
│    Explained the substitution clearly.                 │
│    ▸ What the agent saw                                │
│                                                        │
│  Problem 3   ...                                       │
│                                                        │
│  ─── Full conversation (collapsed) ────────────────    │
└────────────────────────────────────────────────────────┘
```

**Overall block (top):**
- Badge (likely / uncertain / unlikely / unreadable) with confidence %.
- One-sentence summary written by the agent at `finish_check`.

**Per-problem card:**
- Badge + confidence + one-line reasoning.
- **New:** "What the agent saw" collapsible block (collapsed by default) — renders extracted steps with LaTeX + extraction confidence. Teachers can eyeball whether the agent was working from accurate input before trusting a flag.
- Dismiss button + reason textarea (unchanged).

**Full conversation (new, collapsed by default):**
- Entire transcript, student/agent alternating.
- Timestamps + seconds-per-turn for each entry.
- Replaces today's Q&A grid with verdict pills.

**What's removed:**
- Per-question verdict pills (`good` / `weak` / `bad`).
- `tab_switch_count` and `rephrase_used` columns.

---

## 3. The agent

### System prompt (draft)

> You are a math teacher meeting one-on-one with a student who just turned in handwritten homework. Your goal is to determine, with strong confidence within a few minutes, whether this student genuinely understands the material and did the work themselves.
>
> You have the student's extracted work steps for each sampled problem. Confidence is earned when the student explains *specific* things they wrote — which numbers they picked, why they applied a particular rule, what a symbol in their work represents. Confidence is *not* earned by assertion ("I understand it"), by correct final answers ("the answer is 5"), or by generic textbook definitions.
>
> Probe like a teacher who cares. Start with an open question about what they wrote. If the answer is specific and grounded in their steps, move on. If it's vague, contradictory, or generic, ask a focused follow-up about the specific step. Aim for 1-3 student turns per problem — move on as soon as you have real signal.
>
> Red flags: the student's explanation contradicts their own written work; they admit they didn't do it; they can't explain any step on a problem they got right. Green flags: they reference specific numbers/operations from their work; small mistakes in explanation are fine if the reasoning is theirs.
>
> When you've reached strong confidence on a problem (positive or negative), call `submit_problem_verdict`. When all problems have verdicts, call `finish_check` with an overall badge and one-sentence summary. If you hit the turn cap without confidence, submit `uncertain`.
>
> Tone: warm, curious, never accusatory. Never use the words "cheat," "honest," or "verify" with the student. The student sees this as a quick chat about their work.

### Tools

- **`submit_problem_verdict(problem_id, badge, confidence, reasoning)`**
  - `badge`: `likely` | `uncertain` | `unlikely`
  - `confidence`: 0.0-1.0
  - `reasoning`: one sentence, teacher-facing.
  - Minimum 1 student turn on the problem before this is accepted (soft floor — agent can dispatch obviously-confident problems quickly).

- **`finish_check(overall_badge, overall_confidence, summary)`**
  - Rolled up from per-problem verdicts.
  - Server validates every sampled problem has a verdict before accepting.

### Guardrails (server-side, not prompt-side)

- **Sample size: 3 problems** (down from 5). Fewer problems, more depth.
- **Per-problem soft cap: 3 student turns.** Agent told explicitly to aim for 1-3.
- **Total hard cap: 10 student turns.** At 9, inject system message "wrap up any remaining problems now." At 10, force `finish_check` server-side with overall `uncertain` + "hit turn limit."
- **Total time cap:** 10 minutes wall clock from first turn. Enforced at the endpoint.
- **Token budget per turn:** max 400 output tokens. Keep the agent terse.

Target wall-clock: ~4 minutes on average (student typing ~30s per turn, ~8 turns typical). Matches the "quick understanding check · ~2 minutes" copy loosely — confident students finish fast, flagged students take longer, and that's correct.

### Model

Claude Sonnet (matches today's `MODEL_REASON`). **Tradeoff:** Opus would likely give better judgment on ambiguous cases at ~5× cost. Starting with Sonnet; revisit after we see real teacher feedback on verdict quality.

---

## 4. Data model changes

Drop and recreate — pre-scale, no real-user data. Existing integrity checks get nuked by the migration.

**New structure:**

- **`IntegrityCheckSubmission`** (new, one per submission that has a check)
  - `id`, `submission_id` (FK, unique), `status` (`extracting` | `awaiting_student` | `in_progress` | `complete` | `skipped_unreadable`), `overall_badge`, `overall_confidence`, `overall_summary`, `created_at`, `updated_at`.

- **`IntegrityCheckProblem`** (kept, simplified)
  - `id`, `integrity_check_submission_id` (FK), `bank_item_id`, `sample_position`.
  - `student_work_extraction` (JSON, unchanged).
  - `badge`, `confidence` (renamed from `raw_score`), `ai_reasoning`.
  - `teacher_dismissed`, `teacher_dismissal_reason`.
  - Status enum simplified: `pending` | `verdict_submitted` | `dismissed` | `skipped_unreadable`.

- **`IntegrityConversationTurn`** (replaces `IntegrityCheckResponse`)
  - `id`, `integrity_check_submission_id` (FK), `ordinal` (0-based turn number).
  - `role`: `agent` | `student` | `tool_call` | `tool_result`.
  - `content` (text, or JSON for tool calls).
  - `seconds_on_turn` (student only), `created_at`.
  - Tool call turns store the full tool payload so teachers can audit verdicts in context.

**Dropped:**
- All three unused statuses (`pending`, `generating`, `scoring`).
- Verdicts `rephrased`, `skipped`.
- Fields `rephrase_used`, `tab_switch_count`, `question_text`, `expected_shape`, `rubric_hint`, `student_answer`, `answer_verdict`.

---

## 5. Backend changes

**Pipeline (`integrity_pipeline.py`):**
1. Submission hits endpoint → pipeline spawned as fire-and-forget task (unchanged pattern).
2. Extraction runs in background (same code, same prompt, same vision tool).
3. Sample up to 3 problems.
4. Insert `IntegrityCheckSubmission` with `status=awaiting_student` + `IntegrityCheckProblem` rows.
5. Agent generates its opening turn server-side (one completion, system prompt + extracted work, asked for its first message). Store as the first `agent` turn.
6. Student opens chat, fetches transcript, sees the opener.

**Endpoints:**
- **`GET /school/student/integrity/submissions/{id}`** — returns status, problems summary, and full transcript so far. Used on mount and reconnect.
- **`POST /school/student/integrity/submissions/{id}/turn`** — body: `{message: str}`. Appends student turn, runs agent (one completion, processes any tool calls, appends agent turn), returns the new turns + updated problem states + overall status. Single round-trip per student message.
- **Remove:** `/next` and `/answer`.
- **Teacher:** `GET /v1/teacher/integrity/submissions/{id}` returns overall badge/confidence/summary + per-problem data + full transcript. Dismiss endpoint unchanged.

**Prompts (`integrity_ai.py`):**
- Keep `extract_student_work` and its prompt (still works).
- Delete `generate_integrity_questions` and `score_answer` and their prompts.
- Add `run_agent_turn(transcript, extracted_work, problems_state)` — one Sonnet call with the conversational system prompt + tool definitions. Returns agent message and any tool calls.

**Guardrails in the endpoint:**
- Reject turn request if submission is `complete` or `skipped_unreadable`.
- Reject if hard turn cap reached — force-finalize instead.
- Reject `submit_problem_verdict` tool calls with no student turn yet on the problem (agent gets a tool error, tries again).
- Server-side retry cap of 2 per turn for invalid tool calls. If agent produces invalid tool calls twice, skip the tool and treat the turn as message-only.

---

## 6. Frontend changes

**Student (`integrity-check-chat.tsx`):**
- Rewrite as a real chat. State: `transcript: Turn[]`, `status`, `sending: boolean`.
- On mount: `GET /submissions/{id}` → hydrate transcript and render.
- On send: append optimistic student turn, `POST /turn`, replace with server response (which includes the agent's reply).
- Minimum 5 chars preserved.
- Done state triggered by `status === "complete"`.

**Student entry + pending views:** mostly unchanged. Entry copy stays warm. Pending polls until first agent turn is ready.

**Teacher (`submissions-panel.tsx`):**
- Rewrite `IntegritySection` / `ProblemCard`:
  - Top: overall badge + confidence + summary.
  - Per-problem cards: badge, confidence, one-line reasoning, "What the agent saw" collapsible (collapsed by default, LaTeX render of extracted steps + confidence), dismiss control.
  - Bottom: "Full conversation" collapsible with the transcript.
- Remove verdict-pill Q&A grid.
- API types in `api.ts` updated to match new response shape.

---

## 7. Phasing

Three cohesive commits on **one branch**, merged atomically as a single PR. No broken-UI window on main — schema, backend, and both UIs land together.

**Commit 1 — Schema + backend + prompts.**
- Migration (drop old tables, create new).
- New pipeline + agent turn function + endpoints.
- New system prompt + tool definitions.
- Unit tests for turn cap, minimum floor, unreadable gate.

**Commit 2 — Student chat UI.**
- New chat component.
- Transcript hydration on mount.
- Done state.
- Mobile check.

**Commit 3 — Teacher dashboard UI.**
- Overall block + redesigned per-problem cards + "What the agent saw" + transcript.
- Delete old Q&A grid code.

Total likely ~500-700 lines across the three commits.

---

## 8. Risks

- **Manipulation:** student asserts understanding or parrots back the problem. Mitigation: system prompt explicitly grounds confidence in referencing specific extracted steps. The agent won't accept generic restatement. Worth eval-testing with adversarial student answers before shipping.
- **Runaway cost:** hard turn cap + time cap + output token cap. At worst: 10 turns × ~1500 input + 400 output tokens ≈ $0.06 per submission on Sonnet. Extraction adds ~$0.02. Comparable to or cheaper than today's flow.
- **Verdict inconsistency:** conversational agents aren't deterministic. Full transcript logging lets teachers audit. Dismiss button is the relief valve.
- **Agent talks past the student:** keep the prompt explicit about one question per turn. Monitor the first real runs.
- **Tool call errors / infinite tool loops:** server-side retry cap of 2 per turn handles this.

---

## 9. Out of scope

Called out explicitly so they don't creep in:

- Streaming responses (agent replies appear all at once; fine for turn-based chat).
- Tutoring mode pivot when student is struggling (separate plan in memory).
- Multi-anchor variations (separate plan).
- Teacher override beyond dismiss (edit verdict, re-run check).
- Real-time typing indicators.
- Conversation resumption across devices beyond the natural "re-fetch transcript on mount."
