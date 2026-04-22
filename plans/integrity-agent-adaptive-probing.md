# Integrity agent — adaptive probing, rubric, and tutor-pivot

## Overview

Replaces today's quiz-style integrity checker with a one-conversation-per-submission agent whose job is to reach confidence that the student understood the work and did it themselves. The check is a real chat, not a scripted Q&A, and everything the teacher needs lives in a single transcript.

Core design pieces:

1. **Adaptive probe problem selection** — AI picks one problem to discuss based on live submission signals (usually a challenging one the student got right; override to anomaly-flagged wrong answers if any look copied).
2. **Six-dimension rubric** — paraphrase originality, causal fluency, transfer, prediction, authority resistance, self-correction.
3. **Behavioral telemetry** — window focus, paste events, typing cadence. Combined with rubric, never flagging alone.
4. **Four-way disposition** — PASS / NEEDS_PRACTICE / TUTOR_PIVOT / FLAG_FOR_REVIEW.
5. **Inline variant disambiguator** — for the "correct work but blank verbal" ambiguous case, agent generates a fresh isomorphic problem and asks for the student's approach (not a full solution).
6. **Two practice handoffs** — *inline variant* (agent-controlled, v1) for ambiguity resolution; *external practice page CTA* (student-controlled, v2) for everyone who wants reinforcement.
7. **Time budgeting and accessibility** — visible soft budget, silent hard inactivity timeout, "need more time" button, mobile/device flex.

---

## Principles

- **False positive cost >> false negative cost.** Accusing an honest student is a brand-wrecking event; missing a cheater is a rounding error. Default to trust.
- **Time alone never triggers a flag.** Patterns trigger. Time + other signals trigger.
- **Agent surfaces evidence; teacher decides integrity.** The agent never renders a verdict visible to the student as an accusation.
- **The tutor-pivot is the killer feature.** Most "cheating" is "gave up." Converting confusion into help shrinks the integrity problem and improves the product's real job.
- **Announce the rules, then enforce.** Visible budget, visible expectations, visible escape hatch. Transparency beats panopticon vibes.
- **Accept the ceiling.** Second-device lookup, physical helper, AI-polished prose — not feasible to catch without hostile surveillance. Goal is to raise the cost of cheating above the cost of learning, not to build a force field.

---

## 1. Adaptive probe problem selection

Live AI selection driven by submission signals, not a fixed random sample.

### Selection algorithm

At pipeline kickoff, after extraction runs:

1. Score each submitted problem on three dimensions:
   - **Correctness** — got it right or wrong.
   - **Differentiation value** — how conceptually rich is this problem? (Derived from problem metadata: difficulty tag, step count, presence of a conceptual hinge vs pure computation.)
   - **Anomaly signal** — does anything about the answer look copied? Specifically:
     - Does the written answer solve a *different* problem (matched against extraction vs intended problem)?
     - Is the final answer suspiciously precise (e.g. exact form, zero scratch work)?
     - Is the method unusual for the taught curriculum?

2. Pick the probe target:
   - **Primary rule**: choose a problem the student got right with the highest differentiation value. That's the best signal of genuine understanding.
   - **Override rule**: if any problem has a strong anomaly signal (looks copied), pick that one instead — it's the highest-value probe regardless of correctness.
   - **Skip rule**: if the student got *everything* wrong with no anomaly signals, **skip the integrity check entirely** and mark the submission for tutor-pivot consideration. Integrity probing a student who clearly didn't understand any of it is cruel and low-signal.

3. Start with **one** problem. Only add a second or third if the first gave ambiguous signal — not a fixed sample of three.

### Why this is better than fixed sampling

- **Honest fluent students exit in 45 seconds.** One problem, one walkthrough, done.
- **Higher depth per probe.** The agent spends its token budget on the one question that matters.
- **Adapts to submission shape.** A student with one suspicious answer and nine clean ones gets probed on the suspicious one, not a random sample.
- **Avoids probing wrong-answer tutoring territory.** Problems the student clearly struggled with are out of scope unless they look copied.

### When to escalate to a second or third problem

Only escalate if the first problem's rubric comes back **mixed** — some dimensions strong, others weak, and behavioral signals are inconclusive. Escalation picks the next-highest-signal problem by the same algorithm.

Hard cap: **3 problems** per session.

---

## 2. The understanding rubric

Every problem probed gets scored on six dimensions, each low / mid / high. The rubric is what makes the disposition auditable.

| Dimension | What it measures | How the agent probes for it | Low-signal | High-signal |
|---|---|---|---|---|
| **Paraphrase originality** | Own words vs textbook regurgitation | Open walkthrough; agent listens for vocabulary shape | Verbatim textbook phrasing, generic definitions | Student's own frame, reasonable analogies, colloquial phrasing |
| **Causal fluency** | Does "because X, then Y" flow? | Single "why that step?" follow-up if walkthrough is thin | Disconnected facts, "just because" | Smooth causal chain linking steps |
| **Transfer** | Can they flex the method? | One "what if X were negative/zero/doubled?" twist | Freezes or gives same answer | Adapts the method correctly or explains why it breaks |
| **Prediction** | Direction before calculation | "Before solving, which way does the answer go?" | Can't predict; must compute | Forecasts direction with reasoning |
| **Authority resistance** | Do they defer to plausible-wrong suggestions? | Agent floats one wrong premise; watches reaction | Accepts without pushback | Pushes back, catches the error |
| **Self-correction** | Do they catch their own slips? | Passive — observed during walkthrough, not forced | No self-corrections; shrugs off errors | Catches own errors mid-explanation |

### Scoring

The agent emits a rubric entry per probed problem as part of the `submit_problem_verdict` tool call. Teachers see the rubric in the per-problem card, collapsed by default.

### Not every dimension is always scored

- **Authority resistance** only gets a score if the agent chose to float a wrong premise. It's an optional probe, used when signal is mixed.
- **Self-correction** can be "not observed" — agent didn't see enough student text to judge.
- **Transfer** and **prediction** only score if the agent actually asked the probe. On a fluent short session, neither is needed.

Minimum to emit a verdict: **paraphrase + causal fluency** scored. Everything else is optional depth.

---

## 3. Behavioral telemetry

Rubric alone can't distinguish "slow honest thinker" from "looking it up in another tab." Behavioral telemetry closes that gap.

### What's tracked

| Signal | How it's captured | What it means |
|---|---|---|
| **Window focus retention** | `visibilitychange` + `blur`/`focus` events on the chat window | Blur during a pause = possible lookup. Tell student upfront: "stay in the window." |
| **Paste events** | `paste` handler on the textarea, logging byte count and timing | Small pastes (equations) fine. Paragraph-sized pastes after a silent pause = red flag. |
| **Typing cadence** | Keystroke timestamps, computed into a cadence shape | Steady typing with edits = honest. Silence then a single dump = suspicious. |
| **Inter-turn latency** | Time from agent message to student send | Combined with cadence, distinguishes thinking from stalling. |

### How it combines with the rubric

Behavioral telemetry is a **weight**, not a trigger. The disposition logic uses it to break ties when rubric is ambiguous.

- Rubric clear + behavioral clean → PASS (high confidence)
- Rubric clear + behavioral red flags → still PASS but with a teacher note (low-priority review)
- Rubric shallow + behavioral clean → TUTOR_PIVOT
- Rubric shallow + behavioral red flags → FLAG_FOR_REVIEW (this is the only path to a flag)

Telemetry alone never produces a flag. A cheater with a clean browser and a memorized answer passes — that's fine, accept the ceiling.

### Privacy and framing — hard principles

**Upfront rule announcement (required for fairness):** one sentence on the entry screen, before the student taps "Start." Example copy:

> "Quick check-in about your work. Stay in this window and answer in your own words — you don't need to look anything up. Takes about 3 minutes."

Why required: catching a student for tabbing out when we never told them not to is entrapment-flavored. The one-line announcement makes the rule explicit, so behavioral signals carry meaning. Also reduces the "panopticon" feel — honest students know the expectations, which lowers their anxiety.

**Detection events are never surfaced to the student at any point.** Not during the chat ("we noticed you tabbed away"), not at session end ("we detected a paste"), never. If the agent flags the session, the student still sees exactly the same "Thanks! Your work is with your teacher" message as a PASS student. The student is never told what we captured or that we captured anything.

**Full evidence is surfaced to the teacher only on FLAG_FOR_REVIEW.** Teacher dashboard shows: specific focus-blur events with durations, paste events with byte counts and timestamps, typing cadence shape (silent-then-dump vs character-by-character), transcript excerpts correlated to suspicious moments. No automated verdict — the teacher reads the evidence and decides. For PASS, NEEDS_PRACTICE, and TUTOR_PIVOT, telemetry is logged for audit but not surfaced in the teacher UI (keeps teacher UI clean — they don't need to scrutinize behavior for students we're confident about).

**What we explicitly don't do:**
- No webcam, no screen recording
- No keystroke content logging beyond cadence shape (pauses, edit count — not actual keystrokes)
- No real-time "caught you" feedback to the student
- No automated accusation — the agent cannot tell a student they failed an integrity check

---

## 4. Disposition logic

The agent emits one of **four** dispositions at session end.

| Disposition | Rubric signature | Behavioral | What it means | What happens |
|---|---|---|---|---|
| **PASS** | Causal + paraphrase high; transfer/prediction at least mid when probed | Clean | Student understood deeply | "Thanks, all set." Teacher dashboard green check. Subtle "Want more practice?" CTA. |
| **NEEDS_PRACTICE** | Paraphrase mid-high (can describe steps), causal low (can't say why); transfer low | Clean | Procedural only — did the work, thin on theory. Or mom/tutor/AI-helped and partially absorbed it. | Warm close: "Nice work — here's why it works [brief explanation]. Want to try one more to lock it in? →" Prominent CTA to external practice page. Teacher note: "procedural knowledge, consider revisiting concept." |
| **TUTOR_PIVOT** | Rubric low across the board, but the student got the problem **wrong** or showed partial/struggling work | Clean | Student is lost and owns it; learning, not cheating | "Sounds like this was tricky — let's work through it." Hands off to tutor mode. Teacher note: "student struggled, tutored." No integrity concern. |
| **FLAG_FOR_REVIEW** | Rubric shallow AND student got the problem **correct** on paper AND (behavioral red flags OR can't articulate any of their own work) | Red flags OR blank-on-correct-work | Probably didn't do it themselves | Student sees same "Thanks! Your work is with your teacher" message as PASS. Evidence (rubric, behavioral, transcript excerpts) logged for teacher review. |

### The key discriminators

- **TUTOR_PIVOT vs FLAG_FOR_REVIEW**: did the student get the problem **right** on paper? Got it wrong + can't explain = they're learning. Got it right + can't explain = something's off.
- **NEEDS_PRACTICE vs FLAG_FOR_REVIEW**: can the student at least **describe** what they did, even mechanically? If yes, it's procedural knowledge. If they're totally blank on their own correct work, it's a cheating signal.
- **PASS vs NEEDS_PRACTICE**: causal fluency. Can they answer "why" or only "what."

### The ambiguous case — and why the inline variant is essential

There's a real edge case that breaks a pure rubric: **student submitted correct work, can't verbalize any of it**. Could be:
- Cheated (didn't do it, can't fake an explanation)
- Anxious / ESL / spatial thinker (did it, can't articulate verbally)

These two look identical via chat alone. The agent must disambiguate, not guess. When signal is ambiguous, the agent uses `generate_variant(problem)` and presents a fresh isomorphic problem **in-chat** — but asks for the **approach in their own words**, not a full solution. Solving the variant from scratch is a modality mismatch with the chat (awkward typing, LaTeX, etc.) and overkill for the signal we need.

**Two-step probe:**

1. **Agent**: "Here's a similar problem: [variant]. How would you approach this one?"
2. If answer is **specific** (references the structure, key features, or specific numbers — e.g., "I'd factor out the 2 first because both terms are even"): → **upgrade to PASS**
3. If answer is **generic/gameable** (e.g., "I'd use the quadratic formula," "I'd solve for x"): → **one lightweight follow-up**: "Cool — what's the first thing you'd write down?"
4. Reasonable first step → **upgrade to PASS**
5. Still blank or wrong → **confirm FLAG_FOR_REVIEW**

Total: 30-90 seconds. Matches the chat modality (verbal probing). Anxious/ESL students can say "I'd factor first" — low barrier. Cheaters can't easily map an unfamiliar method to a new problem's specific structure.

This is a v1 feature, not v2. The agent already has `generate_variant`. It's the honest way to resolve ambiguity without forcing a modality shift.

### Critical rule: the student never sees the disposition as an accusation

Student-facing copy for PASS and FLAG_FOR_REVIEW is identical: *"Thanks! Your work is with your teacher."* NEEDS_PRACTICE gets a welcoming "here's more practice" framing. TUTOR_PIVOT hands off to tutoring warmly. The agent is incapable of telling a student they failed an integrity check — that's a policy decision belonging to the teacher.

---

## 5. Time budgeting and UX

### Two-layer budget

- **Soft budget (visible to student)**: "~3 minutes, 1-3 questions about one problem." Finish line reduces anxiety.
- **Hard inactivity timeout (silent floor)**:
  - 2 minutes of no keyboard activity → gentle nudge: *"Still there?"*
  - 4 minutes of no keyboard activity → session ends, marked incomplete, teacher decides.

### Per-probe soft targets

- Open walkthrough: ~2-3 min to deliver
- Why probe: ~60-90 sec
- Transfer probe: ~60-90 sec
- Prediction probe: ~30 sec

Exceeding a target doesn't fail the student — it's just an input to the disposition.

### Device flex

- Mobile detection → soft budget flexes 1.5-2x.
- Accommodations profile (teacher-set per student) → doubled budgets, no judgment.

### "Need more time" button

Prominent in the chat UI. Tapping it doubles the inactivity timeouts for the remainder of the session. No explanation required. Accessibility + kindness; cheaters rarely abuse it because they'd rather stay under the radar.

### Voice input (v2)

Deferred but called out because it's the single biggest cheat-resistance lever: copying into speech is hard, consulting a second device while talking aloud is hard. v2 goal is voice-by-default with typing as a fallback.

---

## 6. System prompt

```
You are a math teacher meeting one-on-one with a student who just turned
in handwritten homework. Your goal is to determine, with strong confidence
within a few minutes, whether this student genuinely understands the
material and did the work themselves.

You have the student's extracted work steps for the probe problem(s).
Confidence is earned when the student explains SPECIFIC things they
wrote — which numbers they picked, why they applied a particular rule,
what a symbol in their work represents. Confidence is NOT earned by
assertion ("I understand it"), by correct final answers ("the answer is
5"), or by generic textbook definitions.

Probe like a teacher who cares. Start with an open question about what
they wrote. If the answer is specific and grounded in their steps, move
on. If it's vague, contradictory, or generic, ask a focused follow-up
about the specific step. Aim for 1-3 student turns per problem — move
on as soon as you have real signal.

Red flags: the student's explanation contradicts their own written work;
they admit they didn't do it; they can't explain any step on a problem
they got right. Green flags: they reference specific numbers/operations
from their work; small mistakes in explanation are fine if the reasoning
is theirs.

Tone: warm, curious, never accusatory. Never use the words "cheat,"
"honest," or "verify" with the student. The student sees this as a
quick chat about their work.

PROBE SELECTION:
You are given one (occasionally two or three) probe problem(s), selected
by the pipeline based on submission signals. You did not choose them.
Trust the selection.

RUBRIC (you must emit):
For each problem you probe, score these dimensions when you have
signal on them:
  - paraphrase_originality: low | mid | high
  - causal_fluency: low | mid | high
  - transfer: low | mid | high | not_probed
  - prediction: low | mid | high | not_probed
  - authority_resistance: low | mid | high | not_probed
  - self_correction: low | mid | high | not_observed

Minimum required: paraphrase_originality and causal_fluency.
The others depend on which probes you chose to run.

DISPOSITION:
At session end, emit exactly one of: PASS, NEEDS_PRACTICE, TUTOR_PIVOT,
FLAG_FOR_REVIEW.
  - PASS: rubric mostly mid-or-high, behavioral clean. Understood deeply.
  - NEEDS_PRACTICE: paraphrase mid-high (can describe steps), causal low
    (can't say why). Behavioral clean. They did the work but their theory
    is thin — or they were helped by a tutor/AI/parent and partially
    absorbed it. Close warmly and offer practice reinforcement.
  - TUTOR_PIVOT: rubric low across the board AND student got the problem
    WRONG or showed partial/struggling work on paper. They're learning.
  - FLAG_FOR_REVIEW: rubric shallow AND student got the problem CORRECT
    on paper AND (behavioral red flags OR can't articulate any of the
    work they wrote down). They probably didn't do it themselves.

KEY DISCRIMINATORS:
  - TUTOR vs FLAG: did they get it RIGHT on paper? Wrong = learning.
    Right + can't explain any of it = something's off.
  - NEEDS_PRACTICE vs FLAG: can they at least DESCRIBE mechanically
    what they did? Yes = procedural knowledge. Totally blank on their
    own correct work = cheating signal.

AMBIGUITY RESOLUTION via INLINE VARIANT:
If you have correct work on paper but the student cannot articulate
any of it, and behavioral signal is clean, it's ambiguous — they may
be ESL/anxious rather than cheating. Call `generate_variant(problem)`
and present the variant in-chat. Ask for the APPROACH in their own
words — NOT a full solution. Two-step probe:

  Step 1: "Here's a similar problem: [variant]. How would you
          approach this one?"
    - If specific (references structure/features/numbers): upgrade
      to PASS.
    - If generic ("I'd use the quadratic formula"): ask step 2.

  Step 2: "Cool — what's the first thing you'd write down?"
    - If reasonable first step: upgrade to PASS.
    - If still blank or wrong: confirm FLAG_FOR_REVIEW.

Do NOT ask them to fully solve the variant. The goal is to test
whether they can map the method to new structure, not to re-test
execution. Takes 30-90 seconds.

You are incapable of accusing. Student-facing copy for PASS and
FLAG_FOR_REVIEW is identical: "Thanks! Your work is with your teacher."
NEEDS_PRACTICE gets a warm practice-offer framing. TUTOR_PIVOT hands
off to tutoring warmly.

ADAPTIVE PROBING:
Start with an open walkthrough. If fluent, exit. If mixed, ask ONE
targeted follow-up at the weakest dimension. If still mixed, ONE more,
or escalate to a second problem. Max 3 probes per problem, max 3
problems total. Hard ceiling, non-negotiable.

WRONG PREMISE PROBE:
If signal is ambiguous, you may float ONE plausible-but-wrong premise
and watch the student's reaction. Example: "So because it's linear,
we multiply both sides, right?" (when it's not actually linear). Score
authority_resistance based on whether they push back. Use this probe
sparingly — once per session max.

FORBIDDEN:
- No trivia questions
- No probing problems the student got wrong (unless anomaly-flagged)
- No accusations or "gotcha" framing
- No introducing jargon the student didn't use first
- No extending past 3 probes per problem or 3 problems total
```

---

## 7. Tool specification

### Tools

#### `select_probe_problem(submission, problems) -> {problem_id, reason}`

Called once at pipeline kickoff (not by the agent — by the backend pipeline). Runs the selection algorithm from section 1 and returns the chosen probe target with a reason tag: `highest_differentiation`, `anomaly_copied`, `anomaly_wrong_method`, `skip_all_wrong`.

Stored on `IntegrityCheckSubmission` so the teacher can see why this problem was picked.

#### `generate_variant(problem) -> {variant_problem_statement, expected_direction, expected_answer, key_structural_features}`

**v1, critical tool.** Used in two distinct modes:

1. **Transfer probe mode** — agent phrases a "what if" around the variant to test whether the student can flex the method.
2. **Ambiguity disambiguator mode** — when student has correct work on paper but is blank on articulation, and behavioral signal is clean (not obviously a cheating pattern), agent presents the variant and asks how they'd **approach** it (not solve it). Two-step: approach-first, optional "what's the first thing you'd write down?" follow-up if the approach was generic. Output upgrades to PASS (specific approach or reasonable first step) or confirms FLAG_FOR_REVIEW (blank/wrong).

The `key_structural_features` field lists what a "specific" approach should reference (e.g., `["common factor of 2", "difference of squares pattern", "negative discriminant"]`) — helps the agent judge whether the student's approach is specific or gameable-generic.

Also reused by the external practice-page CTA at session end, but that handoff is a v2 addition.

#### `canonical_reasoning_tree(problem) -> {steps: [{step, why}]}`

Called by the agent when it wants to compare a student's explanation against the expected causal chain. Returns the canonical reasoning path with "why" at each step. Agent uses this internally to detect gaps.

### Telemetry (not a tool, infrastructure)

Client sends telemetry events to the `/turn` endpoint as part of the student message payload:

```json
{
  "message": "...",
  "telemetry": {
    "focus_blur_events": [{"at": "2026-04-22T...", "duration_ms": 4200}],
    "paste_events": [{"at": "...", "byte_count": 85}],
    "typing_cadence": {"total_ms": 42000, "pauses_over_3s": 2, "edits": 5},
    "device_type": "desktop" | "mobile",
    "need_more_time_used": false
  }
}
```

Stored on `IntegrityConversationTurn` (new field: `telemetry` JSON column). Agent has read access to aggregated telemetry when composing its next turn and when emitting the final disposition.

#### `submit_problem_verdict`

```
submit_problem_verdict(
  problem_id,
  rubric: {paraphrase_originality, causal_fluency, transfer, prediction,
           authority_resistance, self_correction},
  reasoning  # one sentence, teacher-facing
)
```

Called once per probed problem after enough signal is collected. Per-problem rubric rolls up into the session-level disposition via `finish_check`.

#### `finish_check`

```
finish_check(
  disposition: PASS | NEEDS_PRACTICE | TUTOR_PIVOT | FLAG_FOR_REVIEW,
  summary,  # one sentence, teacher-facing
  evidence_excerpts,  # list of transcript excerpts that drove the disposition
  inline_variant_result?  # populated only if disambiguator variant was used
)
```

Called once at session end. Server validates every sampled problem has a verdict before accepting.

---

## 8. Edge cases — solvable

| Edge case | Handling |
|---|---|
| ESL / vocabulary mismatch | Weight causal_fluency > paraphrase_originality; offer voice input (v2) |
| Mobile device | Detect and flex time budgets 1.5-2x |
| Accessibility (dyslexia, ADHD, anxiety) | "Need more time" button, teacher-set accommodations profile, never punitive language |
| Student blanks under pressure | Inactivity nudge at 2 min, simpler fallback opener ("just tell me what the problem was about") |
| Student forgot details | Offer quick refresher pivot, re-probe after |
| Session disconnects / network drops | Resumable sessions — transcript lives in DB, client re-hydrates on mount. Don't penalize disconnects. |
| Agent picks an easy problem | Student passes quickly, that's fine — low-hanging PASS is still correct |
| Student refuses the check | No forced completion. Mark "integrity check pending" for teacher. Policy decides consequences. |
| Meta-gaming ("trying to sound honest") | Not a real problem. Gaming the rubric requires real understanding, so it's self-defeating. |
| Student did half, copied half | Probe picks a problem they "got right." If they copied it, the walkthrough breaks. Partial catch, fine. |
| Got everything wrong | `skip_all_wrong` from selection algorithm. No integrity check. Flag for teacher as tutoring candidate. |
| Anomaly flag was wrong | Agent's probe will reveal the student understood. Rubric comes back clean. PASS. No harm. |

## 9. Edge cases — accepted ceiling

These are fundamentally hard to detect without hostile surveillance. Do not attempt:

- **Second-device lookup** — phone next to laptop. No way to see it without webcam.
- **Live human helper in the room** — same. Webcam proctoring is invasive and wrong for this product.
- **AI-assisted prose** — increasingly undetectable. Arms race not worth fighting. *Explicitly considered and rejected:* generating an AI answer and comparing for similarity has high variability (two AI runs produce different wording), high false-positive rates against ESL/careful-writing students, and is trivially defeated by asking the AI to "match student voice." Stylometry-based detection (AI-tells in phrasing) has the same problems. A bounded *within-student* baseline comparison — "this response differs from how this student normally writes" — could be valid someday as teacher-facing context (not an automated flag), but requires months of baseline data and is v3+ at earliest.
- **Parent/tutor walked them through it all** — gray zone. Rubric typically reads as NEEDS_PRACTICE (procedural knowledge, thin theory). That's the right response regardless — more practice on the concept is what they need.
- **Prompt sharing** — students sharing integrity prompts. Mitigated by live adaptive probe selection (no fixed script to memorize) and live variant generation.

### The deeper reliability limitation

**We cannot reliably distinguish between:** mom-helped, tutor-helped, AI-helped, friend-copied, and memorized-from-answer-key. All produce similar verbal output: some understanding, uneven gaps, correct work on paper. The weak signals (vocabulary polish, struggle-point naturalness, "aha" moments) lean too hard on vibes to be actionable.

**Accept this.** The product framing isn't "we detect cheating" — it's **"we measure understanding."** The inline variant resolves the question the right way: did the student understand enough to do a fresh variant? If yes, the original was real enough regardless of help source. If no, the original wasn't real regardless of help source. The disposition scheme (NEEDS_PRACTICE vs FLAG) follows from that measurement, not from detective work about where the original answer came from.

Document these as known limitations. Don't chase them.

---

## 10. Data model

Drop and recreate — pre-scale, no real-user data at stake. Three tables:

### `IntegrityCheckSubmission` (one per submission with a check)

- `id`, `submission_id` (FK, unique), `created_at`, `updated_at`
- `status` (`extracting` | `awaiting_student` | `in_progress` | `complete` | `skipped_unreadable`)
- `probe_selection_reason` (enum: `highest_differentiation`, `anomaly_copied`, `anomaly_wrong_method`, `skip_all_wrong`)
- `disposition` (enum: `PASS`, `NEEDS_PRACTICE`, `TUTOR_PIVOT`, `FLAG_FOR_REVIEW`)
- `summary` (text, one-sentence teacher-facing)
- `inline_variant_used` (bool)
- `inline_variant_result` (enum: `specific_approach`, `approach_after_followup`, `blank_or_wrong`, `not_applicable`)

### `IntegrityCheckProblem` (one per probed problem, up to 3 per session)

- `id`, `integrity_check_submission_id` (FK), `bank_item_id`, `sample_position`
- `student_work_extraction` (JSON — extracted steps, LaTeX, extraction confidence)
- `rubric` (JSON: `{paraphrase_originality, causal_fluency, transfer, prediction, authority_resistance, self_correction}`)
- `selected_reason` (tag string, for audit)
- `ai_reasoning` (text, one-sentence teacher-facing)
- `status` (`pending` | `verdict_submitted` | `dismissed` | `skipped_unreadable`)
- `teacher_dismissed` (bool), `teacher_dismissal_reason` (text)

### `IntegrityConversationTurn` (one per message in the session)

- `id`, `integrity_check_submission_id` (FK), `ordinal` (0-based turn number)
- `role` (`agent` | `student` | `tool_call` | `tool_result`)
- `content` (text, or JSON for tool calls)
- `seconds_on_turn` (student turns only)
- `telemetry` (JSON, student turns only: focus events, paste events, cadence summary, device type, need_more_time_used)
- `created_at`

---

## 11. Phasing

Split into focused PRs, merged sequentially:

### PR 1 — Selection + Rubric + 4-way Disposition + Inline Variant (backend)

- Implement `select_probe_problem` algorithm.
- Implement `generate_variant` tool (used by agent for both transfer probes and ambiguity disambiguation).
- Update system prompt with rubric, 4-way disposition, and ambiguity-resolution instructions.
- Rework tool schemas: `submit_problem_verdict` with rubric, `finish_check` with 4-way disposition + `inline_variant_result`.
- Schema migration: drop badge/confidence, add rubric, disposition enum (4 values), probe_selection_reason, inline_variant fields.
- Unit tests: selection algorithm (all-wrong skip, anomaly override, correctness tiebreaker), disposition logic (correct-work-blank-verbal triggers variant, specific-approach upgrades to PASS, blank-or-wrong approach confirms FLAG).
- No UI changes yet — teacher dashboard reads new fields but renders as raw JSON temporarily.

### PR 2 — Behavioral telemetry

- Client instrumentation: focus/blur, paste, typing cadence.
- Telemetry storage on conversation turns.
- Server reads telemetry when composing disposition prompts.
- Privacy review of what's logged.

### PR 3 — UX: time budgeting, "need more time," rules copy, inline variant UI

- Soft budget display in chat UI.
- Inactivity nudge at 2 min, timeout at 4 min.
- "Need more time" button.
- Upfront rules copy ("stay in window, own words, no lookups").
- Mobile budget flex.
- Inline variant presentation in chat (LaTeX render, answer input, submit button).

### PR 4 — Tutor-pivot handoff

- TUTOR_PIVOT disposition transitions student into the already-planned tutoring chat mode (separate plan, linked in memory as `project_integrity_chat_tutoring_mode`).
- Teacher dashboard differentiates TUTOR_PIVOT from PASS/NEEDS_PRACTICE visually.

### PR 5 — Teacher dashboard redesign

- Rubric display in per-problem cards (collapsed by default).
- Behavioral evidence display for FLAG_FOR_REVIEW.
- 4-way disposition-aware summary at the top of each submission.
- Inline variant result shown when applicable.

### PR 6 — External practice page CTA

- At session end, show "Want more practice?" CTA with prominence varying by disposition (subtle for PASS, prominent for NEEDS_PRACTICE, offered-but-not-pushed for TUTOR_PIVOT post-tutoring, minimized for FLAG_FOR_REVIEW).
- Button redirects to practice/learn page (separate feature — revival plan already exists in `project_practice_variations_revival`).
- Blocked on practice page existing. Ship this PR after practice variations revival lands.

### Deferred (v2+)

- Voice input.
- Historical per-student baselines (needs data to accumulate).
- Pre-commit micro-reflection ("what was the trickiest step?").
- Progressive trust (lighter checks after N clean sessions).
- Teacher-override-as-training-signal.
- Practice-variant upgrades disposition mid-session for NEEDS_PRACTICE students (currently only used for ambiguous FLAG-vs-PASS cases).

---

## 12. Risks

- **Selection algorithm picks a bad probe.** Mitigation: algorithm explanation stored, teacher can inspect `probe_selection_reason`. If selection is obviously wrong, that's a signal to tune, not a reason to abandon adaptive selection.
- **Rubric inconsistency across Sonnet runs.** Full transcript + rubric logged. Teacher can audit. Dismiss-and-re-run is the relief valve.
- **Behavioral telemetry false positives.** This is why telemetry alone never flags. Rubric + telemetry together flag. Kids legitimately tab away to check something benign; the rubric catches that as "they actually understood it, just checked a formula." PASS stands.
- **Tutor-pivot is a new mode that needs to not feel like a punishment.** Copy and handoff need to feel welcoming. Design review needed before ship.
- **"Need more time" button gets ignored by panicked students.** Mitigate with prominent placement and maybe a proactive prompt at 2 min inactivity: "Want more time? [Yes, give me more]."

---

## 13. Open questions

- **Do we need a way for the teacher to flag a problem as "conceptually rich" for selection?** Current plan says no — metadata-driven differentiation score is enough. But if the score is noisy in practice, a simple teacher toggle ("this one's the hinge") is a cheap lever.
- **How do we calibrate "rubric shallow"?** Threshold for shallow: 3+ dimensions low? 2+? This needs real data. Start with 3+ low = shallow, 2+ low + red behavioral = shallow, tune after first 50 real sessions.
- **Should the wrong-premise probe be A/B tested?** It's a strong signal but also the riskiest (agent looks confused to students). Consider enabling it only for cases where signal is already ambiguous.
- **Do we log raw keystrokes or only cadence summary?** Raw keystrokes are more powerful (can detect copy-paste of a drafted answer) but heavier on privacy. Start with cadence summary only.
- **TUTOR_PIVOT: does it count as "submission complete" or "check incomplete" for the teacher?** Recommend "complete — tutored" as its own state. Student did their part; teacher sees they were confused and got help. No integrity concern.

---

## 14. Out of scope

Explicitly ruled out or deferred:

- Streaming responses.
- Real-time typing indicators.
- Cross-device conversation resumption beyond transcript re-fetch.
- Teacher-facing verdict editing (dismiss is the only lever).
- Anomaly detection by comparing to other students' submissions (would require cross-submission analysis; out of scope for v1).
- Webcam / screen-recording proctoring — explicitly ruled out, not just deferred.
