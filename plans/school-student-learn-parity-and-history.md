# School student Learn parity + revisit history

## Why

Two student-facing gaps in the school flow:

1. **Learn is visually flat vs the non-school version.** Non-school students get a single-page step timeline with click-to-collapse steps and a per-step chat. School students get a minimal prev/next stepper over the same pre-generated `solution_steps` data. Same data, worse UI.
2. **No way to revisit a problem.** `BankConsumption` captures every served practice / learn attempt (student, variation, HW anchor, timestamps, completion, flag). No read endpoint exists and the existing `/history` page — which already appears in the school student's nav — renders empty because the school loops write to `BankConsumption`, not `Session`.

Fix both together: they share a rendering layer (the timeline) and a conceptual model (a completed attempt is something you can re-open).

Branch: new off `main`.

---

## Principles

- **Lean on what's already stored.** BankConsumption has everything history needs. No new tables.
- **Keep Learn cheap.** School Learn uses pre-generated steps from the teacher's bank pipeline. Don't regenerate on every student attempt.
- **Share components, don't fork.** Extract the non-school Learn presentation into a shared layer. Both flows render through it.
- **Single source of truth.** History reads from BankConsumption, not from a parallel Session-mirror table.
- **Phase it.** Ship UX parity first, populate history second.

---

## 1. Learn UX parity — port the non-school pattern

### What non-school students see today

Route: `/learn/session`. After decomposition:

- **Step timeline**, top to bottom. Each completed step is a card with a check, title, one-line description, click to expand the body.
- **Current step** is an open card with title + description + final answer. Input at the bottom lets the student confirm "I understand" or ask a question.
- **Per-step chat** inside each expanded card — messages are pinned to their step. Live LLM calls, context is the variation's steps + current conversation.
- **Completion**: timeline collapses to a scannable read-only view; a "ask another question about the whole problem" chat sits at the bottom.

### What school students see today

`learn-loop-surface.tsx` renders one step at a time from `variation.solution_steps`:
- `step.title` as header, `step.description` as body.
- Prev/Next buttons.
- No collapse, no timeline, no "I understand" gesture, no chat, no inline final-answer reveal.

Same data shape (`solution_steps: [{title, description}]` + `final_answer`), just presented as a wizard.

### Diff

| Feature | Non-school | School today | Ported school |
|---|---|---|---|
| Step timeline, all visible at once | ✓ | ✗ | ✓ |
| Click-to-collapse on completed steps | ✓ | ✗ | ✓ |
| "I understand" per-step gesture | ✓ | ✗ (Next button) | ✓ |
| Final answer reveal at end | ✓ | ✓ | ✓ |
| Per-step chat | ✓ (LLM, live only, not persisted) | ✗ | ✓ (LLM, live only, not persisted) |
| "Ask about the whole problem" chat | ✓ | ✗ | ✓ |
| Unified Practice/Learn toggle inside the loop | n/a | ✗ | ✓ (new — see §2) |

### Shared component extraction

Non-school `/learn/session/page.tsx` has the timeline + chat logic inline (~400 lines). Extract the presentation into two shared components so both flows render identically.

- **`web/src/components/shared/step-timeline.tsx`** (new)
  - Props: `steps`, `currentStepIndex`, `onConfirmStep`, `chat`, `onAskStepQuestion`.
  - Renders the collapsible timeline with per-step chat affordances.
  - Knows nothing about where data or chat came from — caller's problem.
- **`web/src/components/shared/problem-chat.tsx`** (new)
  - Post-completion "ask about the whole problem" chat.
  - Props: `messages`, `onSend`.

**Callers:**

- Non-school `session/page.tsx`: replace inline timeline with `<StepTimeline>`. Chat handler calls existing `/v1/session/{id}/respond`. **Behavior preserved** — this is a DRY refactor, not a redesign.
- School `LearnLoopSurface`: replace the step-at-a-time view with `<StepTimeline>`. Chat handler calls a **new** school-side endpoint (§4) that runs an LLM with the variation's steps + conversation as context. No DB writes.

### Edge cases

- **Variation has no steps.** Surface an empty-state: "No steps available for this problem — ask a question below." Chat still works against the variation's question + final answer.
- **Student mid-chat, navigates away.** Chat state is client-only; navigating loses it. Matches non-school behavior before its persistence was added.
- **Mobile.** Timeline cards stack full-width; chat panels use `dvh` so the keyboard doesn't clip them. Existing `MathText` renders the same.

### Why no chat persistence

For non-school students, the chat IS the session — it's how they study a problem solo, and it functions as their study notebook when revisited later. For school students, the chat is a small help-panel inside a larger Learn surface — nobody's going to scroll back to "what did I chat about on problem 4 last Tuesday." Storing it just bloats the DB.

**Decision:** school student chat is live-only. Persistence is explicitly out of scope.

---

## 2. Completion-screen pivots between Practice and Learn

### Why not a unified mode toggle

A toggle inside the loop ("Practice / Learn" tabs) was considered and rejected: it conflates two distinct intents. `Practice similar` = "I want to drill this." `Learn similar` = "I don't get this, walk me through it." Different mental models. A toggle invites mid-problem mode-switching that distracts more than it helps.

Two distinct entry points stay; the cross-mode option appears only at the **completion** moment, when the student naturally has a decision to make.

### Entry — unchanged

HW page keeps both buttons per primary problem:
```
1️⃣  Solve x² - 5x + 6 = 0
    [ Practice similar ]  [ Learn similar ]
```

### Practice completion screen

Practice is **one problem at a time**. After the student answers the MCQ (right or wrong) and dismisses the reveal:

```
┌───────────────────────────────────────────────┐
│   You practiced 1 problem · ✓ correct         │  ← also: "✗ incorrect"
│                                               │
│   [ Learn this problem ]   ← primary CTA      │
│   [ Practice another similar ]                │
│   [ Back to homework ]                        │
└───────────────────────────────────────────────┘
```

- **Learn this problem** opens the **same variation** they just practiced in Learn mode. Not a new one. The student wants to see the solution to the exact problem they tried. Implementation: reuse the same BankConsumption row's `bank_item_id`, open the Learn surface against it. (Whether to create a separate Learn consumption row or annotate the existing Practice row is a small call to make at code time — one attempt, one row in history is the lean default.)
- **Practice another similar** consumes a new variation. New BankConsumption row, context=practice.
- **Back to homework** exits.

Same action set whether they got it right or wrong — the framing in the header changes, the choices don't.

### Learn completion screen

After the student walks the timeline and final answer reveals:

```
┌───────────────────────────────────────────────┐
│   ✓ You worked through this problem.          │
│                                               │
│   [ Practice a similar one ]   ← primary CTA  │
│   [ Back to homework ]                        │
│   (small) [ Learn another similar ]           │
└───────────────────────────────────────────────┘
```

- **Practice a similar one** consumes a new Practice variation. Same anchor.
- **Back to homework** exits.
- **Learn another similar** consumes a new Learn variation (rare path — handles "show me one more example before I try").

### Flagging

Keep `BankConsumption.flagged` + the in-loop `⚑` button as-is. Don't surface flagged problems in completion screens or history UI in this plan. The column is a future hook ("review what you flagged") if usage data shows it's worth surfacing.

### Why this works

- **Intent stays clear at entry.** Two buttons, two paths. No on-screen toggle tempting mid-problem mode-flips.
- **Pivot only at decision moments.** The student sees the cross-mode option exactly once per attempt, at the natural "what's next?" moment.
- **Matches real study behavior.** Try a problem → see how it's done. Read a worked example → try one yourself. Both natural progressions.
- **No surface merge needed.** `PracticeLoopSurface` and `LearnLoopSurface` stay separate. Each gains a completion screen with a clear pivot. Less code churn than merging surfaces.

### Why NOT self-attempt gate before Learn

Considered: Learn surface opens with just the question + "I'll try first" textarea before revealing steps. Better pedagogy, but requires deciding how attempts are scored, whether they're stored, what happens on blank submits. Belongs in its own design pass. **Out of scope for this plan.**

---

## 3. Revisit flow — populate the existing `/history` tab

### The surface already exists

`/history` route is already in the school student's app nav. It's empty today because school loops don't write `Session` rows. Fix is data-side: new backend endpoint reading from `BankConsumption`.

### Why not mirror into `Session` rows

Alternative considered: have the school Practice/Learn loops ALSO write `Session` rows so the existing `/history` endpoint "just works." Rejected — Session would be mostly-empty filler (problem text copied from the variation, `exchanges=[]`, etc.), doubling storage + writes with no upside. BankConsumption is already the canonical record.

### Student mental model

Student thinks: "I remember practicing that matrix problem last Tuesday — where do I find it?" They think per-HW, by recency. **Group by HW, sort HWs by most recent activity, sort rows within HW by `served_at` desc.**

### What the History tab shows

```
┌─ History ──────────────────────────────────────────────┐
│                                                        │
│  [Algebra 1 ▾]                       ← course filter  │
│                                        (hidden if 1)   │
│                                                        │
│  HW 3 · Matrices                    most recent: 2h    │
│  ┌────────────────────────────────────────────────┐   │
│  │ Matrix multiplication with 2×2 and 2×3         │   │
│  │ Similar to Problem 1 · Learned · 2h ago        │   │
│  │                                      [Re-open] │   │
│  ├────────────────────────────────────────────────┤   │
│  │ Loose leaf tea 240g box                        │   │
│  │ Similar to Problem 2 · Practiced · 3h ago      │   │
│  │                                      [Re-open] │   │
│  ├────────────────────────────────────────────────┤   │
│  │ Matrix product with 3×3                        │   │
│  │ Similar to Problem 1 · In progress · yesterday │   │
│  │                                     [Continue] │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  HW 2 · Quadratics                  most recent: 3d   │
│  ...                                                   │
└────────────────────────────────────────────────────────┘
```

Per-row fields (all from BankConsumption + joined bank item / assignment):
- Variation title (`QuestionBankItem.title`).
- "Similar to Problem N" — ordinal of the HW primary this anchors to.
- Status: **Learned** (context=learn, completed), **Practiced** (context=practice, completed), **In progress** (completed_at is null).
- Relative timestamp (`served_at`).
- One action: **Re-open** (completed) or **Continue** (in-progress).

Course filter chip row at the top shows only when student is in 2+ courses.

### Scope of history rows

Surface **all Learn attempts**, completed or in-progress:
- ✅ `context = 'learn'` (any `completed_at` value)
- ❌ Practice attempts (disposable drills; revisiting a past MCQ just shows the same problem with the same answer. The Learn-this-problem pivot at Practice completion is the bridge — once a student clicks it and works the Learn, that Learn row goes in history.)

UI differentiation:
- Completed: status chip `Learned`, button `[ Re-open ]`.
- In-progress: status chip `In progress`, button `[ Continue ]`.

Both buttons do the same thing under the hood (open the Learn surface for that `bank_item_id`); the label differentiates for the student's mental model.

`BankConsumption.flagged` keeps being written by the in-loop `⚑` button. Just not surfaced anywhere yet — future hook.

### Re-opening — detail page

Click `Re-open` on a history row → routes to `/school/student/history/[consumption_id]`. The detail page mirrors the non-school history detail UX:

- **Anchor breadcrumb**: `Similar to Problem N · HW <title>` (clickable to jump back to the HW).
- **Problem text** at the top.
- **Step timeline** rendered via shared `<StepTimeline>` component. All steps render as collapsed cards because they're completed — that's how the timeline shows completed steps everywhere (mid-Learn, end-of-Learn, history). Click any step to re-expand and re-read.
- **Per-step chat panels** inside each step — live LLM, ephemeral, identical behavior to Learn.
- **Whole-problem chat panel** at the bottom — shared `<ProblemChat>` component, live LLM.
- **Primary CTA `[Practice similar]`** — spawns a new Practice attempt from the same `anchor_bank_item_id` (same flow as clicking Practice similar on the HW page for that primary). Surfaces "exhausted" message gracefully if no unseen variations remain.
- **Secondary `[Back to history]`** — exits.

**No new BankConsumption row created when re-opening for review.** The existing completed-Learn row is the archive; re-reading it doesn't re-consume.

If the student clicks `[Practice similar]` from history detail and then later hits `[Learn this problem]` on that Practice's completion screen — that creates a fresh Learn consumption (same variation) which then appears in history when completed. Each row remains one mode-attempt; no row mutation.

### URL + routing

- `/school/student/history` — list (replaces the empty school branch on the existing `/history` page, OR a fresh route — implementation choice).
- `/school/student/history/[consumption_id]` — detail.

Keeps school + non-school history concerns separated. Different data models, different fetches; routing them to separate routes avoids "session_id for non-school, consumption_id for school" overloading on the same path.

### Filters + search (v1)

None. Keep the list simple. Add filters only if it gets long enough to need them.

### Empty states

- No history yet: "Nothing here yet — practice or learn something from your homework."
- Course filter narrows to no rows: "No history in this course yet."

### Edge cases

- **Deleted variation.** FK cascade removes the BankConsumption row too. History just doesn't list it. Clean.
- **Deleted HW.** Same — cascade handles it.
- **Preview-student consumptions.** Filter out rows where the current user is a preview student (matches existing preview-hiding pattern elsewhere).
- **Student dropped the course.** Enrollment check at the endpoint. Student loses access as soon as they're unenrolled.

---

## 4. Data model + backend

### No schema changes needed

BankConsumption already has:
```
id, student_id, bank_item_id, anchor_bank_item_id,
assignment_id, context, served_at, completed_at, flagged
```

Joined to `QuestionBankItem` (title), `Assignment` (HW title), `Course` (course name, enrollment check) — everything history needs.

### New endpoints

**`POST /v1/school/student/bank-item/{bank_item_id}/step-chat`** — for the per-step live chat in Learn mode.
- Body: `{step_index: int, question: str, prior_messages: ChatMessage[]}`.
- Auth: student must own a BankConsumption row for this `bank_item_id`.
- Builds system prompt from the variation's question + solution_steps + final_answer + step_index context. Runs LLM. Returns content blocks.
- **No DB writes.** Chat state lives in the client.

**`POST /v1/school/student/bank-item/{bank_item_id}/problem-chat`** — for the "ask about the whole problem" chat after Learn completes.
- Similar shape, without `step_index`.
- Again no DB writes.

**`GET /v1/school/student/history`** — for the history tab.
- Optional query param `course_id` for filtering.
- Returns `{ courses: [{ course_id, course_name, homeworks: [{ assignment_id, title, most_recent_activity, items: [...] }] }] }`.
- Student only sees their own rows. Enrolled-course gate applied.

### Tool / LLM cost estimate

The decomposition itself is free at runtime — `QuestionBankItem.solution_steps` is filled in once at teacher-authoring time by the bank pipeline. Every school Learn attempt (including the Practice→"Learn this" pivot) just reads that JSON; no Sonnet call to break the problem into steps.

LLM cost only kicks in when the student opts into chat:

- Per-step chat: ~3 exchanges × 5k input + 400 output tokens × Sonnet pricing ≈ $0.03 per Learn attempt that uses chat.
- Whole-problem chat after completion: similar bound, additive.

Most Learn attempts won't touch chat (the student just walks the timeline and exits). Realistic average is ~$0.005-0.01 per attempt. Far cheaper than non-school Learn, which pays for an LLM decomposition on every session before the student types anything.

---

## 5. Phasing

Two PRs, each shippable independently.

**PR 1 — Shared components + school Learn parity + mode toggle.**
- Extract `StepTimeline` + `ProblemChat` into shared components.
- Refactor non-school `/learn/session` to use them (behavior-preserving — don't change the UX, just swap rendering).
- Rewrite `LearnLoopSurface` to render via `StepTimeline`.
- Add unified Practice/Learn mode toggle inside both `PracticeLoopSurface` and `LearnLoopSurface` (or consolidate them into a single `HomeworkLoopSurface` — decide during implementation).
- Add anchor banner "Similar to Problem N — <question>" at the top of the loop.
- Add new `/step-chat` and `/problem-chat` endpoints for school students.

Rough size: 500-700 lines.

**PR 2 — History populated.**
- New `GET /v1/school/student/history` endpoint.
- Extend `/history` page: for school students, call the new endpoint and render grouped-by-HW view.
- Course filter chip row (hidden when in 1 course).
- "Re-open" / "Continue" buttons wired to the existing Practice/Learn loop entrypoint, with the specific `bank_item_id` carried through in the URL.

Rough size: 200-300 lines.

---

## 6. Risks + open questions

- **Non-school refactor risk.** Extracting `StepTimeline` from the non-school session page is a behavior-preserving refactor that touches a widely-used page. Mitigation: smoke-test the non-school Learn flow after PR 1 commits.
- **Chat quality.** The school chat handler has the variation's steps + final answer as context. Should be able to answer specific questions well. But the student might ask questions outside the variation's solution scope. System prompt should allow general help grounded in the variation. Worth eval-testing with a few adversarial prompts.
- **Mode toggle ergonomics.** Tapping between Practice and Learn should feel instant (no refetch — the variation is already loaded). Verify no loading spinner on toggle.
- **Enrollment re-check on history.** A student who dropped a course should lose access to that course's history. Use the existing enrollment helper.
- **Anchor banner truncation.** Long HW primary questions need line-clamp. Trivial.
- **Accessibility.** Timeline cards need proper disclosure semantics (`aria-expanded`, keyboard expand/collapse). `StepTimeline` extraction is the right moment to get this right.
- **Mobile.** Verify timeline + chat work well on a real phone viewport before merging PR 1.

---

## 7. Out of scope

Explicit non-goals:

- Teacher view of student history (separate feature, different audience).
- Search within history.
- Flagged filter in history UI (BankConsumption.flagged stays in DB, no surface).
- Bookmarking / favorites on history rows.
- Self-attempt gate before Learn reveals steps (pedagogically interesting, own design pass).
- Difficulty auto-ramp in practice.
- Checkpoint quiz after Learn completes.
- Cross-course aggregate history.
- Persisted per-step chat — deferred indefinitely unless student research says otherwise.
- Redesigning non-school Learn UX — we only extract shared components, behavior is preserved.
