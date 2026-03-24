# Submit Your Work — Personalized Diagnosis

## Overview

Let students optionally photograph their work after answering problems in practice and test modes. The app generates the optimal solution steps (via `decompose_problem()`), then uses Claude Vision to compare the student's handwritten work against those steps. Shows a one-line diagnosis on the summary screen and personalizes the learn mode walkthrough for flagged problems. Problems with detected issues are auto-flagged alongside wrong answers.

**Three phases, shipped as separate PRs:**
- **Phase 1:** Backend — generate optimal steps, diagnose student work via vision, WorkSubmission model
- **Phase 2:** Frontend — submit button in practice/test, summary screen teasers, auto-flag logic
- **Phase 3:** Personalized learn mode — reuse cached steps, enrich walkthroughs with student-specific annotations

---

## Phase 1: Backend — Diagnosis Endpoint + Model

### 1.1 WorkSubmission Model

**New file: `api/models/work_submission.py`**

```python
class WorkSubmission(Base):
    __tablename__ = "work_submissions"

    id: UUID (PK)
    user_id: UUID (FK → users.id)
    session_id: UUID (FK → sessions.id)
    problem_index: int                   # which problem in the session
    diagnosis: dict                      # structured JSON (see 1.3)
    summary: str                         # one-line teaser for summary screen
    has_issues: bool = False             # quick flag: were problems detected?
    created_at: datetime
```

Lean model — 8 fields. Problem text, correct answer, and correct steps already live on the session record (DRY). No image storage — the image is processed in-memory and discarded. If v2 error pattern tracking needs images, add storage then.

**Index:** `(user_id, created_at)` for future error pattern queries.

**Migration:** New Alembic migration to create `work_submissions` table.

### 1.2 Work Submission Schemas

**New file: `api/schemas/work.py`**

```python
class SubmitWorkRequest(BaseModel):
    image_base64: str = Field(..., max_length=7_000_000)  # ~5MB decoded
    session_id: UUID
    problem_index: int = Field(..., ge=0)

class DiagnosisStep(BaseModel):
    step_description: str          # the correct step
    status: str                    # "correct" | "error" | "skipped" | "suboptimal" | "unclear"
    student_work: str | None       # what the student wrote for this step
    feedback: str | None           # explanation of the issue (if any)

class DiagnosisResult(BaseModel):
    steps: list[DiagnosisStep]
    summary: str                   # one-line teaser (e.g. "Sign error in step 2")
    has_issues: bool               # any errors or concerns detected
    overall_feedback: str          # brief overall assessment

class SubmitWorkResponse(BaseModel):
    id: UUID
    diagnosis: DiagnosisResult | None
```

The frontend sends only `image_base64`, `session_id`, and `problem_index`. The backend looks up the problem from the session record and generates correct steps itself. No sensitive data sent from the client.

### 1.3 Diagnosis Endpoint

**New file: `api/routes/work.py`**

**Endpoint:** `POST /v1/work/submit`

**Flow:**
1. Validate + decode base64 image
2. Look up session by `session_id`, verify ownership via `user_id`
3. Extract problem data from session: `problem_text`, user's answer, correctness
4. **Call `decompose_problem()`** to generate the optimal solution steps + final answer. Cache the result on the session record (updates `steps` field) so learn mode can reuse it later without another LLM call
5. **Call Claude Vision** — send the image + the optimal steps from step 4, get diagnosis back
6. Save `WorkSubmission` record with diagnosis
7. Return structured diagnosis

**Why two LLM calls (decompose + vision):**
- Practice/test problems only store the final answer, not solution steps. We need steps to compare against.
- `decompose_problem()` generates the *optimal teaching steps* — this is what lets us detect suboptimal methods, not just incorrect ones.
- The steps get cached on the session, so when the student later taps "Learn" on this problem, we skip decomposition entirely. The two calls here save one call later — net cost is lower.

**Claude Vision prompt (Sonnet):**
```
You are analyzing a student's handwritten math work shown in the attached image.
Compare their work against the reference solution below.

Problem: {problem_text}
Reference solution (one correct approach):
{steps_from_decompose}
Correct answer: {final_answer}
Student's typed answer: {user_answer} ({"correct" | "incorrect"})

The reference solution is the OPTIMAL approach. A student's method can be valid but
less optimal (e.g. more steps, brute force instead of an elegant shortcut). Flag this —
the student should know a better approach exists.

Set has_issues to true when ANY of these apply:
- The student made an actual error (arithmetic, sign, conceptual)
- The student skipped critical steps and got lucky
- The student's method is mathematically unsound even if the answer is correct
- The student's method is valid but LESS OPTIMAL than the reference solution
  (less elegant, brute force, less generalizable, etc.)

Do NOT set has_issues to true when:
- The student's method is equally optimal or better than the reference — different
  is not wrong if it's equally efficient

For the status field on each step, use:
- "correct" — student performed an equivalent step correctly
- "error" — student made a mistake
- "skipped" — student skipped this step entirely
- "suboptimal" — student did something valid but less efficient here
- "unclear" — student's work is illegible for this step

Look at the student's handwritten work in the image and for each reference step:
1. Did the student perform an equivalent step? Did they do it correctly?
2. If there's an error, what specifically went wrong?
3. If their approach is valid but less optimal (less elegant, less generalizable, brute force), note this
4. If their work is illegible for a step, mark it as "unclear"

Return JSON: {
  "steps": [{"step_description": "...", "status": "correct|error|skipped|suboptimal|unclear", "student_work": "what they wrote", "feedback": "..."}],
  "summary": "One-line teaser for summary screen",
  "has_issues": true/false,
  "overall_feedback": "Brief overall assessment"
}
```

**Cost:** ~$0.02-0.04 per submission (1 decompose call + 1 vision call). The decompose call is amortized — it's free if the student later enters learn mode for this problem.

### 1.4 Register Routes

Add `/v1/work` router to `main.py`.

---

## Phase 1 Commits

| # | Commit | ~Lines | Description |
|---|--------|--------|-------------|
| 1 | `feat: add WorkSubmission model and migration` | ~60 | SQLAlchemy model, Alembic migration |
| 2 | `feat: add work submission schemas` | ~50 | Pydantic request/response schemas |
| 3 | `feat: add work diagnosis endpoint with decompose + vision` | ~150 | Route, decompose call, vision diagnosis, session step caching, cost tracking |
| 4 | `feat: register work routes in main app` | ~10 | Router registration |

---

## Phase 2: Frontend — Submit, Summary Teasers, Auto-Flag

### 2.1 Crop Strategy

Use `expo-image-picker` with `allowsEditing: true` — this gives a native crop UI on both iOS and Android with zero new dependencies. The built-in crop is good enough for selecting a region of handwritten work. If user feedback shows it's insufficient, swap to `react-native-image-crop-picker` later.

No new dependencies needed.

### 2.2 API Service Function

**Add to `api.ts`:**
```ts
export async function submitWork(params: {
  imageBase64: string;
  sessionId: string;
  problemIndex: number;
}): Promise<SubmitWorkResponse> {
  return request("/work/submit", {
    method: "POST",
    body: JSON.stringify({
      image_base64: params.imageBase64,
      session_id: params.sessionId,
      problem_index: params.problemIndex,
    }),
    timeout: 30_000,
  });
}
```

Minimal payload — just the image and a pointer to the problem. Backend handles the rest.

### 2.3 Work Submission Types + Store State

**New types in store or types file:**
```ts
interface WorkDiagnosisStep {
  step_description: string;
  status: "correct" | "error" | "skipped" | "suboptimal" | "unclear";
  student_work: string | null;
  feedback: string | null;
}

interface WorkDiagnosis {
  id: string;
  steps: WorkDiagnosisStep[];
  summary: string;        // one-line teaser
  has_issues: boolean;
  overall_feedback: string;
}
```

**Add to `PracticeBatch` interface:**
```ts
workSubmissions: (WorkDiagnosis | null)[];  // parallel to problems array, null = no work submitted
```

**Add to `MockTest` interface:**
```ts
workSubmissions: (WorkDiagnosis | null)[];  // parallel to questions array
workImages: (string | null)[];             // base64 photos held locally until test submit
```

### 2.4 Attach Work Button — Consistent UX (Both Modes)

Same UI pattern in both practice and test mode. An "Attach your work" button sits below the answer input, before the submit/answer button. The student attaches their photo *before* submitting their answer — like attaching a file before sending an email.

**Layout (same in both modes):**

```
┌──────────────────────────────────┐
│  Problem: 3x + 5 = 20           │
│                                  │
│  Your answer: [x = 5       ]    │
│                                  │
│  [📷 Attach your work]          │  ← before submitting, optional
│   or after photo: ✓ Work attached│  ← tappable to retake
│                                  │
│  [Submit Answer]                 │
└──────────────────────────────────┘
```

**Attach flow:**
1. Tap "Attach your work" → camera opens via `expo-image-picker` with `allowsEditing: true` (native crop UI)
2. User takes photo and crops to relevant work
3. Compress (max 1024px, quality 0.7)
4. Button changes to "✓ Work attached" (tappable to retake photo)
5. Photo stored locally as base64 in `workImages[currentIndex]`

**Submit without attachment — nudge:**
1. Student taps "Submit Answer" without attaching a photo
2. Gentle nudge modal: "Want to attach your work? You'll get feedback on exactly where you went wrong."
3. Two buttons: "Attach work" (opens camera) / "Skip" (submits without photo)

**What happens after submit (mode-specific):**

- **Practice mode:** If photo attached, diagnosis call fires immediately in the background while student moves to the next problem. Result stored in `workSubmissions[currentIndex]` when it resolves.
- **Test mode:** Photo is just held locally — no diagnosis during the test (don't break focus or waste time). All diagnosis calls fire after the test is submitted, in parallel with a concurrency cap of 3 (`Promise.all` on chunks of 3). Summary screen shows "Analyzing..." spinners that resolve to teasers as results come in.

### 2.6 Updated Summary Screens

**PracticeSummary.tsx changes:**

Each problem row gets a diagnosis teaser if work was submitted:

```
Q1: ✓  [📷] "Method verified ✓"                     [flag toggle]
Q2: ✗  [📷] "Sign error in step 2"         (flagged) [flag toggle]
Q3: ✓  [📷] "Correct, but a more optimal approach exists" (flagged) [flag toggle]
Q4: ✗        —                              (flagged) [flag toggle]
Q5: ✓        —                                        [flag toggle]
```

- The `[📷]` icon indicates work was submitted
- The teaser text comes from `workSubmissions[i].summary`
- If diagnosis is still loading, show a small spinner with "Analyzing..."
- If diagnosis failed, show "Analysis unavailable"

**MockTestSummary.tsx changes:** Same pattern — add teaser text and 📷 indicator per question.

### 2.7 Auto-Flag Logic Updates

**Current auto-flag rules:**
- Wrong answer → auto-flag

**New auto-flag rules:**
- Wrong answer → auto-flag (unchanged)
- Submitted work with `has_issues: true` → auto-flag (NEW — even if answer was correct)

**Implementation in `session.ts`:**

For practice mode, update the logic that runs when a diagnosis result comes back:
```ts
// When diagnosis resolves for problem at index i:
if (diagnosis.has_issues && !flags[i]) {
  flags[i] = true;  // auto-flag
}
```

For mock test mode, update `submitMockTest` to also auto-flag after diagnoses resolve.

The summary screen should visually distinguish auto-flag reasons:
- Wrong answer flags: existing red styling
- Work-issue flags (correct answer but bad method): orange/yellow styling with the teaser explaining why

---

## Phase 2 Commits

| # | Commit | ~Lines | Description |
|---|--------|--------|-------------|
| 1 | `feat: add submitWork API function and work types` | ~50 | API service, TypeScript interfaces |
| 2 | `feat: add work submission state to practice and mock test stores` | ~50 | Store types, initialization, submission tracking |
| 3 | `feat: add attach work button and nudge to practice mode` | ~130 | Camera with native crop, attach button, skip nudge, background diagnosis |
| 4 | `feat: add attach work button and nudge to mock test mode` | ~100 | Same attach UX, local photo storage, parallel batch diagnosis on submit |
| 5 | `feat: add diagnosis teasers to practice and test summaries` | ~120 | Summary row updates, loading states, teaser display |
| 6 | `feat: auto-flag problems with detected work issues` | ~60 | Updated flag logic, visual distinction for work-issue flags |

---

## Phase 3: Personalized Learn Mode

### 3.1 Reuse Cached Steps — No Redundant LLM Call

When a student submits work in Phase 1, `decompose_problem()` runs and the steps are cached on the session record. When they later tap "Learn" on that flagged problem, the backend detects that steps already exist and skips decomposition entirely.

**Changes to session creation (`api/core/session.py`):**
- Before calling `decompose_problem()`, check if the session already has cached steps (from a prior work submission)
- If steps exist, use them directly
- If not, run `decompose_problem()` as normal

This means submitting work pre-warms learn mode — zero extra LLM cost for the learn walkthrough.

### 3.2 Backend Lookup — No Frontend Pass-Through

The backend checks if a `WorkSubmission` exists for the user + problem. No new fields on `CreateSessionRequest` — the backend looks it up itself.

**Changes to session creation:**
- Query `WorkSubmission` by `user_id` + `session_id` (or matching `problem_text`)
- If found, pass `diagnosis` to step decomposition for personalization
- If not found, proceed with standard (generic) decomposition

This keeps the API surface unchanged and avoids sending diagnosis data from the client (which could be tampered with).

### 3.3 Personalized Step Decomposition

**Changes to `step_decomposition.py`:**

`decompose_problem()` accepts an optional `work_diagnosis: dict | None` parameter.

When provided, append to the decomposition prompt:

```
IMPORTANT: The student has already attempted this problem. Their work has been analyzed:
{work_diagnosis}

When writing each step description, reference their specific mistakes where relevant.
For steps they got right, acknowledge it briefly: "You got this right —" then explain the step.
For steps where they made errors, address it directly: "This is where your work diverged —" then explain what they should have done and why their approach was wrong.
For steps they skipped, note it: "You skipped this step —" then explain why it matters.
If the student got the correct answer but with a flawed/suboptimal method, point out the better approach and explain why it matters for harder problems.

Keep the tone encouraging and constructive. The goal is to teach, not to criticize.
```

The step structure stays the same (`description`, `final_answer`, `choices`). The descriptions just become personalized. No frontend changes needed — the learn walkthrough renders step descriptions as-is.

### 3.4 Non-Personalized Fallback

If no `WorkSubmission` exists for the problem, learn mode works exactly as it does today. No changes to the default path.

---

## Phase 3 Commits

| # | Commit | ~Lines | Description |
|---|--------|--------|-------------|
| 1 | `feat: reuse cached steps from work submission in learn mode` | ~30 | Skip decomposition when steps already cached |
| 2 | `feat: look up work diagnosis on learn session creation` | ~40 | Query WorkSubmission, pass to decomposition |
| 3 | `feat: personalize step decomposition when work diagnosis available` | ~60 | Prompt enhancement, conditional logic |
| 4 | `test: add tests for personalized vs generic decomposition` | ~80 | Verify both paths work correctly |

---

## Out of Scope (future work)

- **Error pattern tracking (v2 monetization):** Currently, WorkSubmissions are deleted after learn mode consumes them. To enable pattern tracking ("you make sign errors 35% of the time"), add a lightweight `error_log` table that persists just the error types/categories from each diagnosis before deletion. This separates the transient personalization data from the long-term analytics data. Gate the pattern dashboard behind a paywall.
- **Payment/subscription system:** Gate error pattern features behind a paywall later. The submit-and-diagnose flow stays free for now. Easy to add a feature flag check before the pattern dashboard.
- **Image storage (R2/S3):** Not needed for v1 — images are processed in-memory and discarded. Add persistent storage if v2 error patterns need to reference original images.
- **Offline queuing:** Queue work submissions when offline, upload when back online.
- **Video capture:** Record solving process, not just final state.
- **Multiple photos per problem:** e.g. front and back of paper.

## Dependencies

- No new mobile dependencies — `expo-image-picker` (already installed) with `allowsEditing: true` handles camera + crop
- No new backend dependencies — Claude Vision is part of the existing `anthropic` SDK
- No new infrastructure — no object storage needed for v1

## Risks / Open Questions

- **Vision accuracy on handwriting:** Claude Vision handles printed math well. Messy handwriting may produce "unclear" step diagnoses. The prompt handles this gracefully ("unclear" status) but the user experience depends on extraction quality. Monitor and iterate on the prompt based on real submissions.
- **Diagnosis latency:** ~5s per submission (decompose ~2s + vision ~3s). Running in background while student continues practicing mitigates this. For mock tests, parallel batch diagnosis (capped at 3 concurrent) keeps total wait reasonable.
- **Image size on mobile:** Need to verify `allowsEditing` + compress (max 1024px, quality 0.7) keeps payloads under 5MB consistently across devices.
- **Native crop UI variance:** `allowsEditing` on Android vs iOS may look/behave slightly differently. Test on both platforms. If insufficient, `react-native-image-crop-picker` is a drop-in upgrade.
- **Alternative valid methods:** The vision prompt explicitly allows different-but-valid approaches. Need to test with diverse student work to verify Claude doesn't over-flag valid alternatives.
