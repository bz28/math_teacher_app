# Mock Exam "From Objectives" Mode

## Problem

Today, Mock Test mode requires the student to bring problems (snap a problem
sheet, paste text, or type one problem at a time). The only two `Questions`
options are `Use mine` (use the input verbatim) and `Generate similar` (treat
input as seeds, generate variations). Both require problem input.

Students often don't have problems to input — they have a **study guide / review
sheet / syllabus excerpt that lists the topics and objectives** the exam will
cover. Currently they can't use those to generate a practice exam.

## Goal

Add a third Mock Test source: **From objectives**. Student snaps (or types) an
objectives sheet, we extract the topics, they confirm/edit, provide light course
context (level, course name, count), and we generate a practice exam that
covers those objectives. They audit the generated questions before the exam
starts, after which decomposition runs in the background as today.

Scope: mobile-only (the web app's mock-test surface is different and out of
scope here). No changes to existing `Use mine` / `Generate similar` paths.

## User Flow

1. Student taps **Mock Test** mode on SolveScreen.
2. In the `Questions` row of `MockTestConfig`, picks **From objectives**
   (third pill, new).
3. Snap/Gallery/Type cards change affordance: camera targets an objectives
   sheet instead of a problem sheet (labels + copy change).
4. Student snaps a photo. Server extracts objectives. Existing
   `ExtractionModal` shows them as editable chips — student can toggle,
   edit, remove, add topics. Same UX as today's problem extraction.
5. After confirming topics, student fills the optional Objectives Sheet card:
   - **Course** (optional text, e.g., `AP Calc BC`)
   - **Level** (optional pills: Middle · HS · College · Other)
   - **# questions** (stepper, default 10, range 1–20)
   - Time and Answers rows continue to live in the existing `MockTestConfig`
     card above — shared across all three `Questions` sources.
6. Student taps **Generate Test (N)**. Server returns question *text only*.
7. New **Generated Questions Audit** screen shows the N questions. Student can
   deselect, inline-edit, regenerate individual question (nice-to-have, not
   v1). Confirm with **Start Exam**.
8. `startMockTest` is called with the audited question text as if they were
   `Use mine` problems. Decomposition + distractor generation runs in the
   background per the existing pattern (`mockTestActions.ts:86-103`).
9. Test proceeds identically to today.

## Changes

### Backend

#### 1. `api/core/image_extract.py` — new extractor for objectives

Add `extract_objectives_from_image(image_b64, subject) -> {topics, confidence}`.

Mirrors `extract_problems_from_image` exactly (same Claude Vision call, same
tool-use pattern) but with a different prompt + schema.

**Prompt** (new `_EXTRACT_OBJECTIVES_TEMPLATE`):

```
You are a {professor_role}. Given an image of a study guide, syllabus excerpt,
review sheet, or exam blueprint, extract the learning objectives or topics
the exam will cover.

Guidelines:
- One topic per list item. Phrase as a concept or skill, not a sentence.
  Good: "Related rates"  Bad: "Solve related rates problems involving ladders"
- Merge synonyms (e.g., "related rates problems" + "related rates" → one item).
- Drop administrative text: chapter numbers, due dates, instructor names, point
  values, instructions like "Show all work".
- If the sheet has sub-bullets, prefer the most specific student-facing phrasing.
- Use LaTeX $...$ for any math expressions.
- If the image clearly isn't an objectives / topics sheet (e.g., it's a problem
  set or a photo of something unrelated), return an empty list.

Return ONLY the topic list — do NOT invent problems, answers, or explanations.
```

**Tool schema** (new `IMAGE_EXTRACT_OBJECTIVES_SCHEMA` in `llm_schemas.py`):

```python
{
  "name": "return_objectives",
  "input_schema": {
    "type": "object",
    "properties": {
      "topics": {"type": "array", "items": {"type": "string"}},
      "confidence": {"type": "string", "enum": ["high", "medium", "low"]}
    },
    "required": ["topics", "confidence"]
  }
}
```

#### 2. `api/routes/image.py` — new endpoint

`POST /image/extract-objectives`

Body: `{ image_base64: string, subject: string }`
Response: `{ topics: string[], confidence: "high"|"medium"|"low" }`

Mirrors `POST /image/extract`. Uses entitlements the same way (counts as one
scan for rate limiting).

#### 3. `api/core/practice.py` — new generator from objectives

Add `generate_problems_from_objectives(topics, level, course_name, count,
subject) -> list[str]`.

Parallel structure to existing `generate_practice_problems`. Single Claude
call that returns all N question strings at once (same batched pattern as
the existing `generate` endpoint — no extra cost).

**Prompt** (new `_GENERATE_FROM_OBJECTIVES_TEMPLATE`):

```
You are a {professor_role} writing a {count}-question practice exam.

Course context:
- Level: {level or "unspecified"}
- Course: {course_name or "unspecified"}

The exam must cover these objectives:
{numbered topic list}

Requirements:
- Produce exactly {count} problems, solvable on paper (no calculator-only
  problems unless the level/course clearly implies one).
- Cover each objective at least once when feasible; distribute evenly across
  the objective list.
- Match the difficulty a student at the given level would face on a real
  in-class exam in this course.
- Use LaTeX $...$ for all math. Describe any required diagrams in brackets
  [e.g., "a right triangle with legs 3 and 4"].
- Progress roughly foundational → challenging.

Return ONLY problem text — no answers, no step breakdowns, no explanations.
The downstream pipeline solves and decomposes separately.
```

**Tool schema**: reuses existing `PRACTICE_GENERATE_SCHEMA`
(`{"problems": [string]}`). Same output shape as `generate_similar`.

#### 4. `api/routes/practice.py` — new endpoint

`POST /practice/generate-from-objectives`

Body:
```
{
  topics: string[],
  level?: "middle" | "hs" | "college" | "other",
  course_name?: string,
  count: int,  // 1..20
  subject: string
}
```

Response: `{ problems: string[] }` (same shape as existing `/practice/generate`
response for symmetry).

Entitlement: same as existing practice generation (one session equivalent).

### Mobile

#### 5. `mobile/src/services/api.ts`

Two new functions:

```ts
extractObjectivesFromImage(base64: string, subject: string)
  : Promise<{ topics: string[]; confidence: "high"|"medium"|"low" }>

generateProblemsFromObjectives(args: {
  topics: string[];
  level?: "middle"|"hs"|"college"|"other";
  courseName?: string;
  count: number;
  subject: string;
}): Promise<{ problems: string[] }>
```

#### 6. `mobile/src/hooks/useImageExtraction.ts` — parameterize by extraction mode

Today the hook calls `extractProblemsFromImage` directly. Add a mode param
(`"problems" | "objectives"`) that selects the API function and adjusts the
copy used in `ExtractionModal` (e.g., "Edit topic" vs "Edit problem", confirm
button "Use these topics" vs "Use these problems").

Minimize surface area: the hook's shape stays the same, only the
`extract*` call and a couple of label strings change.

#### 7. `mobile/src/components/MockTestConfig.tsx` — three-way pill

Change `examType` from `"use_as_exam" | "generate_similar"` to
`"use_as_exam" | "generate_similar" | "from_objectives"`.

Extend `PillToggle` to three options. Check visual fit on iPhone SE width
(375pt). If the three labels don't fit, fall back to a vertical radio list
for the `Questions` row only.

#### 8. `mobile/src/components/ObjectivesSheetCard.tsx` — new component

New card rendered *below* `MockTestConfig` (and below the extracted-topic
preview) when `examType === "from_objectives"`. Fields:

- Course (text input, optional). Placeholder: `e.g., AP Calc BC, Alg 2 Honors`.
- Level (4-pill toggle, optional): Middle · HS · College · Other.
- # questions (stepper): default 10, min 1, max 20.

Reuses `MockTestConfig` visual language (card, dividers, pills, stepper).

#### 9. `mobile/src/components/SolveScreen.tsx` — conditional rendering

When `examType === "from_objectives"`:
- The Snap / Gallery / Type cards repoint to the objectives extraction flow.
  Copy changes: "Snap an objectives sheet" / "Paste topics" etc.
- The `useImageExtraction` hook runs in `"objectives"` mode.
- After topic confirmation (same `ExtractionModal` experience), the topics
  appear as a chip row. The `ObjectivesSheetCard` becomes visible.
- The Solve button label becomes `Generate Test (N)`; disabled until at least
  one topic is present and count ≥ 1.
- On press, call `generateProblemsFromObjectives(...)`, then open the new
  audit modal (below) with the returned problems.

#### 10. `mobile/src/components/GeneratedQuestionsAudit.tsx` — new modal

Full-screen modal. Architecturally parallel to `ExtractionModal` for problem
extraction: shows a list of the N generated questions, lets the student:
- Toggle include/exclude per question.
- Inline-edit each question text.
- Tap **Start Exam** to proceed.

Pressing **Start Exam** calls `startMockTest(auditedProblems, 0, timeLimit,
multipleChoice)` — note `generateCount = 0` because problems are already
finalized text at this point; the existing decomposition-in-background
pipeline takes over (`mockTestActions.ts:21-103` unchanged).

Pressing **Back** returns to the ObjectivesSheetCard with topics preserved.

#### 11. `mobile/src/stores/mockTestActions.ts` — no changes required

`startMockTest(problems, generateCount, timeLimit, multipleChoice)` already
handles the case where problems are provided and `generateCount = 0`. That's
exactly what we need — audited generated questions treated as `Use mine`.

### State preservation between pill toggles

When the student flips `Questions` between `Use mine`, `Generate similar`, and
`From objectives`, preserve each mode's inputs so nothing is lost:
- `problemQueue` state stays for the problem-input modes.
- Extracted topics + Objectives Sheet fields stay for `From objectives`.

On entering a mode the UI shows whatever was last entered there.

## System Prompts (full drafts)

Placed in this plan so they can be reviewed before implementation. House style:
role-based system message, LaTeX `$...$`, tool-use JSON output, no markdown
fencing. Drafts live in `api/core/image_extract.py` and `api/core/practice.py`.

(See the two prompt blocks in the Backend section above.)

## Commit Breakdown

Rough ~150-line commit plan:

1. **feat(api): extract objectives from image** — new endpoint + prompt +
   schema + unit tests for `extract_objectives_from_image`.
2. **feat(api): generate problems from objectives** — new endpoint + prompt +
   schema + tests for `generate_problems_from_objectives`.
3. **feat(mobile): API bindings for objectives extraction + generation** —
   additions to `services/api.ts` and type files only.
4. **feat(mobile): extend Questions pill to include From objectives** —
   `MockTestConfig` three-way pill and associated prop/type changes.
5. **feat(mobile): ObjectivesSheetCard + useImageExtraction mode param** —
   the new card component plus the hook's `objectives` mode.
6. **feat(mobile): GeneratedQuestionsAudit modal** — the new audit screen
   reusing `ExtractionModal` patterns.
7. **feat(mobile): wire From-objectives flow into SolveScreen** — conditional
   rendering, state glue, generate handler, audit → start-exam handoff.

Each commit should be independently reviewable and not break main.

## Edge Cases

| Scenario | Handling |
|---|---|
| Photo isn't an objectives sheet (empty `topics`) | Show empty state in `ExtractionModal` with "Try a different photo or type topics manually" CTA. |
| `low` confidence on extraction | Same banner/warning treatment as today's low-confidence problem extraction (reuse existing code). |
| Generation returns fewer problems than asked | Proceed with what we got; warn in audit header "Generated N of M requested — tap retry to add more" (retry = call generate again with `count = M - N`). Mirrors `batch-practice-generation.md:80`. |
| Generation timeout / API error | Same error banner UX as today's mock test; "Try again" button re-runs generation with identical inputs. |
| Student removes all topics in audit | Disable Start Exam, show empty state. |
| Pill toggle switch mid-flow | Preserve state per mode. Switching to `Use mine` doesn't wipe extracted topics; switching back restores them. |
| Free-tier daily session limit | Check entitlements before generation; reuse existing `EntitlementError` + paywall flow. |
| # questions stepper at bounds | Stepper arrows disabled at 1 and 20 (matches existing time-limit stepper). |
| Course name > 100 chars | Soft-cap via `maxLength={80}` on the TextInput. |

## Accessibility

- `PillToggle` three-option variant: each pill gets
  `accessibilityRole="tab"` + `accessibilityState={{selected: active}}`.
- `ObjectivesSheetCard` fields: visible labels (not placeholder-only).
  Textarea-style inputs get `accessibilityHint`.
- Audit modal question rows: 44×44 minimum touch target for toggle + edit.
- Screen-reader: when objectives get extracted, announce count via
  `AccessibilityInfo.announceForAccessibility` ("Extracted 5 topics").

## Out of Scope (v1)

- Web app surface (teacher/student web mock test doesn't exist in this form).
- Per-question regenerate button in the audit modal.
- Difficulty picker (level + course name + topics carry enough signal).
- Topic-chip autocomplete / course-aware topic suggestions.
- Saving a named objectives sheet for reuse across sessions.
- Automatic course-name inference from the photo (can be added to the extract
  prompt later; v1 keeps those fields manual).
- Analytics for "what % of objectives-mode sessions come from photo vs typed".

## Testing Plan

Unit (backend):
- `extract_objectives_from_image` — mocked Claude response returns topics;
  empty-list fallback on non-objectives image.
- `generate_problems_from_objectives` — mocked Claude response returns N
  problems; wrong-count response is handled gracefully.

Integration (backend): new endpoint tests for both routes — happy path,
invalid inputs (count > 20, count < 1, empty topics array), entitlement
enforcement.

Manual (mobile):
- Photo path: snap a real study-guide screenshot → extract → edit topic →
  fill course "AP Calc BC", level HS, count 5 → generate → audit → start →
  complete exam. Verify questions map to the topics.
- Type path: same flow but type topics manually. Verify optional fields work.
- Cancel paths: back out of audit → state preserved. Switch pill to Use mine
  → queue preserved both ways.
- Free-tier path: exceed limit → paywall appears at the right step.
- Accessibility: VoiceOver pass over the three new surfaces.

## Risks

- **Three-pill width on small phones**: verify on iPhone SE before shipping.
  Fallback plan (vertical list) already scoped.
- **Extraction quality on messy sheets** (handwritten, photo of laptop screen):
  existing problem-extractor handles these; same Vision model, same quality
  envelope. Monitor low-confidence rates post-launch.
- **Prompt-injection risk in objectives textarea**: student could type
  "Ignore previous instructions and …". The generate prompt wraps their input
  as a topic list; low but non-zero risk. Keep an eye on it; consider sanitation
  if we see issues.
