# Teacher platform IA restructure + grading workflow

## Goal

Make the teacher platform feel like an inbox, not a spreadsheet. Teachers spend their time in three places: **authoring HW**, **reviewing submissions**, and **checking student grades** — each with a dedicated tab. Everything else (materials, sections, settings) is one click away but out of the main flow.

Bar: a math teacher using this should never want to go back to Canvas or Schoology.

## Scope

**In scope (this plan):**
- IA restructure: 6 tabs + gear icon for Settings
- Remove Question Bank tab; generation becomes scoped per-HW
- 2-step HW create wizard (details + problems)
- Upgraded per-HW approval queue (full-page, progress rail, keyboard shortcuts, completion state)
- New **Submissions** tab — review inbox with per-problem grading UI
- New **Grades** tab — per-section student grade view
- Rubric field added to HW (authored now, consumed by AI later)
- Per-problem grade breakdown stored on `SubmissionGrade`
- "Publish grades" workflow (per-HW button)
- Integrity-check-driven "needs your eyes" flagging

**Deferred to future PRs:**
- **AI grading engine itself** (consumes rubric + produces `ai_score` + confidence). v1 teacher grades manually using the exact UI that AI will pre-fill later. Zero UI rework when AI lands.
- Tests tab implementation (stays placeholder)
- Multi-section HW assignment UX
- Email/push notifications (v1 = in-app badge only)
- Per-problem image cropping

---

## 1. New information architecture

**Current:** `Sections | Materials | Question Bank | Homework | Tests | Settings` (6 tabs)

**New:** `Sections | Materials | HW | Tests | Submissions | Grades` (6 tabs) + gear icon in header for Settings

**What changes:**
- **Question Bank** tab → removed. Generation lives inside each draft HW.
- **Homework** → renamed **HW** for tab brevity.
- **Submissions** → new.
- **Grades** → new.
- **Settings** → moves to a gear icon top-right.

Teachers land on the course workspace, Sections tab by default (unchanged). First-time teachers see a small onboarding banner pointing at HW → Submissions → Grades as the three-step loop.

---

## 2. HW tab — 2-step create wizard + per-HW generation

**What the teacher sees:** a list of HW cards — Draft / Published — sorted by due date. Big `+ New HW` button top-right.

**Creation flow (2-step wizard):**

**Step 1 — Details:**
- Title
- Unit(s) — required, multi-select
- Due date
- Late policy
- Section(s)
- `Continue →`

**Step 2 — Problems:**
- Count (default 10)
- Difficulty mix (easy/medium/hard sliders)
- Source material (optional — pulls from Materials tab)
- Topic hint (text box, optional)
- Two buttons:
  - **Create & generate** (primary) — creates draft HW, immediately generates problems, opens approval queue
  - **Skip for now** — creates empty draft, lands on detail page with "Generate problems" CTA

**HW detail page** (replaces the current modal):
- Header: title, due date, sections, unit chips, Publish button (disabled until ≥1 approved problem).
- **Rubric section** (collapsed by default): plain-text block. Placeholder: "e.g., Full credit requires correct final answer and shown work. Partial credit for correct setup with arithmetic error."
- **Problems section**: approved problems in order. Below: `Generate more` button and `Reopen review queue` button (shown when pending problems exist).
- If the teacher left mid-queue: persistent banner at top — "7 of 10 generated problems still need your review — Resume queue."

**Edge cases:**
- Teacher publishes with only 3 approved problems from a 10-generated batch — allowed.
- Teacher un-publishes to add more — allowed; student-side HW goes back to "not yet assigned" but preserves any submissions.
- Teacher edits a problem after publish → confirm modal warns if students have already submitted.

**Why this works:** Teachers think in assignments, not in abstract question banks. "Generate for *this* HW" is scoped, concrete intent — faster and better judgment than "is this question bank-worthy?"

---

## 3. Upgraded per-HW approval queue

Today's workshop modal has queue mechanics but feels generic. For per-HW review, we wrap the existing editing affordances in a queue frame that feels purpose-built.

**What changes:**
- **Full-page overlay**, not a small modal. Teachers spend 5+ minutes here — give them the canvas.
- **Left progress rail**: N numbered dots. Current one highlighted. Green check on approved, red X on rejected, grey on pending. Click any dot to jump.
- **Header anchors context**: "Reviewing problem 3 of 10 — *Quadratics HW #3*".
- **Sticky bottom action bar**: big **Reject** (left), **Edit inline** (middle), **Approve** (right, primary). Large tap targets.
- **Keyboard shortcuts**: `A` approve, `R` reject, `E` edit, `←/→` navigate. Tooltip on first visit.
- **Inline editing**: question text, answer, solution steps editable in place with autosave — no sub-modal.
- **Completion state**: after last question → celebration card: "8 approved, 2 rejected for Quadratics HW #3. Generate 2 more? / Back to HW."
- **Resume state**: if teacher leaves mid-queue, HW detail page shows a persistent "Resume review (7/10 left)" banner that reopens the queue at the next pending question.

Internals (question render, edit fields, save API) are unchanged — reused from today's workshop modal.

---

## 4. Tests tab

Stays as the current "Coming soon" placeholder. No work in this plan. Kept visible so schools know tests are coming and don't confuse "where do I make a quiz?"

---

## 5. Submissions tab — the review inbox

**Landing view:** a single feed, not a grid. Each row is *one HW × one section* (e.g., "Quadratics HW #3 — Period 2"). Rows sorted by default by **needs-review urgency**:
- 🔴 Needs your eyes (integrity flags, unreadable handwriting, late without grades)
- 🟡 Graded, not yet published
- 🟢 Published
- ⚪ Not yet due / no submissions

Toggle top-right: `Urgency ↓` | `Due date ↓`. Filter chips: `All sections` | `This week` | `Flagged only`.

**Row content:**
- HW title + section
- `18 / 24 submitted`
- Inline pills: `3 flagged` (red), `15 to grade` (neutral), `0 published` (grey)
- Due date + "2 days late" if overdue
- Right side: `Review →`

**Clicking `Review →` opens the HW review page:**

**Left panel — student list**. Each row:
- Avatar + name
- Status pill: `Needs review` / `Graded, not published` / `Published` / `Not submitted`
- Integrity badge: 🟢 Likely / 🟡 Uncertain / 🔴 Unlikely / ⚫ Unreadable
- Current score if graded

**Right panel — selected student's submission:**
- **Snapshot**: integrity badge + summary, late indicator, submission time.
- **Per-problem grading**: for each problem —
  - Problem text
  - Student's typed answer
  - Student's handwritten work (inline image — whole photo for v1)
  - **Grading controls**: `Full` / `Partial` / `Zero` buttons. Optional feedback text box. Partial prompts for a % slider.
  - Red banner if this problem was integrity-flagged: "Understanding check flagged — [View chat]"
- **Overall**: rubric (collapsible reference), total score auto-summed, teacher notes textbox.

**Sticky bottom bar:**
- `Save draft` (autosaves anyway)
- `Next student →`
- After all submissions graded on every problem: `Publish all grades` becomes primary.

**Publish flow:** `Publish all grades` → confirm modal: "Publish grades for 18 students? They'll see their scores and feedback immediately." → students see grades next time they open the HW.

**Why this works:**
- One screen per HW. No tab-switching.
- Keyboard-driven review (`F/P/Z` for grade, `J/K` or arrows for students — v1.1).
- Urgency-first sort = things needing judgment surface first. Canvas defaults to alphabetical — this is the opposite.
- "Publish all" is deliberate — teachers feel in control.

**Future AI grading integration:** pre-fills each problem with `Full/Partial/Zero + confidence pill`. High-confidence problems get ✓ with quieter styling; low-confidence get amber "Needs your eyes." A `Approve all confident grades` button appears at the top. Manual UX becomes AI-reviewed UX with zero structural change.

---

## 6. Grades tab — the "look up a student" view

**Layout:** a grid. Rows = students (sorted by last name). Columns = published HWs (chronological). Cells show the score.

**Interactions:**
- Top-right section selector (defaults to all sections, filter to one).
- Click row → **student detail drawer** from right: name, avg %, all HWs with score + date + comment excerpt, trend chart.
- Click cell → opens that submission's review page.
- Click column header → opens HW review page.
- Top-right: **Export CSV** (report-card season; low-effort win).

**Cell states:**
- Published: score (e.g., `85%`)
- Graded but not published: dashed border + `— / 20` (teacher-only)
- Not submitted: `Missing` in muted grey
- Not yet due: blank

**Edge cases:**
- Dropped student: row still shown with grey "Removed YYYY-MM-DD" tag.
- Late grading after publish: teacher grades individually; publishing updates Grades cell.

---

## 7. Rubric field

- Authored on HW detail page as a plain-text block.
- Stored on Assignment model: new column `rubric_text TEXT NULL`.
- v1 use: reference for teacher during manual grading.
- Future use: passed to AI grader in prompt.

Dead simple — no structured rubric editor in v1.

---

## 8. Data model changes

- `Assignment.rubric_text` — new nullable text column.
- `SubmissionGrade.breakdown` — new JSON column: `[{problem_id, score_status: "full"|"partial"|"zero", percent, feedback}]`. Agnostic to AI vs teacher authorship.
- `SubmissionGrade.grade_published_at` — timestamp. Null = draft; set when teacher publishes. Drives student visibility.
- `Submission.status` — unchanged.
- `ai_score` / `ai_breakdown` — untouched. Populated by future AI grading PR.

---

## 9. Student-facing changes

Minimal:
- Before teacher publishes: current "Submitted ✓" state, no score.
- After publish: grade + per-problem breakdown + teacher's notes. Simple score card at top.
- If teacher has published some students' grades but not theirs: "Your teacher is finalizing your grade."

No student notification in v1 — visible next time they open the page.

---

## 10. End-to-end flow

```
Teacher creates HW (2-step wizard) → generates problems → approval queue (full-page)
                                                              ↓
                                                      publishes HW
                                                              ↓
                                            Students see HW → submit work + photo
                                                              ↓
                                        (integrity check runs, existing behavior)
                                                              ↓
Teacher opens Submissions tab → row shows "18/24 submitted, 3 flagged"
                    ↓
            Clicks Review → review page, student-by-student
                    ↓
    Grades each problem Full/Partial/Zero → optional feedback → rubric reference
                    ↓
                Autosaves → next student → repeat
                    ↓
    All graded → "Publish all grades" → confirm → students see scores
                    ↓
            Grades tab cell updates with score
```

---

## 11. Implementation order (feature-by-feature commits)

Shipped as multiple commits on a single PR branch. Each commit ~150 lines, scoped to one logical change.

1. **Data model migration** — add `Assignment.rubric_text`, `SubmissionGrade.breakdown`, `SubmissionGrade.grade_published_at`.
2. **Backend: rubric CRUD** — assignment endpoints accept/return rubric_text.
3. **Backend: grading endpoints** — save per-problem breakdown; publish-all-grades per-HW.
4. **Nav restructure** — remove Question Bank tab, rename Homework → HW, add Submissions + Grades tabs, move Settings to gear.
5. **HW 2-step create wizard** — update new-homework-modal to 2 steps.
6. **HW detail page** — upgrade from modal to full page; rubric field; generate-more + resume-queue banner.
7. **Upgraded approval queue** — full-page overlay, progress rail, keyboard shortcuts, completion state.
8. **Submissions tab** — inbox feed + HW review page + per-problem grading UI.
9. **Publish grades flow** — confirmation modal, publish endpoint wiring.
10. **Grades tab** — grid view + student detail drawer + CSV export.
11. **Student-facing grade visibility** — waiting state + published-grade card.

---

## 12. Deferred / open items

**Future PRs:**
1. **AI grading engine** — reads rubric + handwritten image + typed answers; produces `ai_score`, confidence, per-problem breakdown. Pre-fills the Submissions review page.
2. **Multi-section HW authoring** — "create one HW, assign to three sections in one click." Revisit after teacher feedback.
3. **Tests tab** — timer, no-tutor-help mode, different grading weight, proctoring.
4. **Email/push notifications** — daily digest, per-submission alerts.
5. **Keyboard shortcut polish** — `F/P/Z` for grading, `J/K` for student navigation.
6. **Per-problem image cropping** — extract sub-regions of handwritten photo per problem.

**Reminders:**
- **Section scoping** — punted. Revisit when a teacher complains or analytics show the same HW created 3x across sections.
