# Veradic — Product & Customer Overview

> Source-of-truth product context for the codebase. Written to ground the autonomous
> improver's "ideate" arm: it should propose **gaps**, not rebuild what already exists.
> The customer/positioning statements here were reviewed and confirmed with the owner;
> anything still unverified is marked `<!-- confirm -->`. No pricing, named customers, or
> dates are asserted here.

## 1. What Veradic is

Veradic is an AI math-education platform built around one loop: a student photographs
their handwritten homework, and the platform reads the work, **grades** every problem
with a written justification (a "receipt"), runs a short conversational **understanding
check** to distinguish real understanding from a memorized or copied right answer, and
gives the teacher a class-at-a-glance view with the students who need help surfaced
first. It began as a single-student photo-tutoring app and has grown into a **school
portal**: teachers run courses, assign homework, and review AI-drafted grades, while the
original self-study loop (Learn / Practice / Mock-test) remains for individual learners.
All AI runs on Anthropic Claude.

The product's headline capabilities are dramatized in the standalone sales demo
(`demo/`) as four stories: **integrity** (understanding check), **grading**,
**generation** (build a trusted problem set from a worksheet), and **teacher-day** (walk
in already knowing who needs you).

## 2. Who it's for

Three customer segments share one platform. The role model in code is
`user.role ∈ {student, teacher, admin}`, and schools carry a `kind` of `institutional`
vs `individual` (an indie teacher's own "school"), so the code supports both
institution-backed and solo usage.

| Segment | Who | Job-to-be-done |
|---|---|---|
| **Students — school** | Enrolled in a teacher's section via invite/join-class | Do assigned homework by photographing work, see grades + feedback, practice weak spots. |
| **Students — independent** | Self-study learners, no class | Snap or type any problem, get tutored step-by-step, generate practice, take mock tests. |
| **Teachers** | Run courses/sections; institutional or indie | Turn worksheets into trusted assignments, let AI grade + understanding-check the class, walk in knowing who is struggling and what to reteach — with far less grading time. |
| **Schools / districts** | The institutions teachers belong to; the buyer for `/for-districts` | Roll Veradic out across teachers/classes with trust, privacy, and visibility into learning. |

**Positioning (owner-confirmed):** **Build for teachers, sell to districts.** The teacher
is the hero and daily user — the product has to win their love first; if teachers don't
love it, nothing else matters. The **district is the buyer** and the expansion path (the
`/for-districts` page and the `institutional` school kind), i.e. the sales motion, not the
daily user. The **student app is the input surface** that feeds the teacher's loop. So:
teacher-first *product*, district *sales*.

## 3. Core capabilities

Framed by the four demo stories, plus the self-study modes. Each is real code, not just
demo content.

- **Integrity — understanding check** (`api/core/integrity_ai.py`, `integrity_pipeline.py`;
  `api/models/integrity_check.py`). After a student submits homework, an extraction runs
  over the photo, up to ~3 primary problems are sampled, and a **single warm one-on-one
  agent conversation** probes the student to explain their own steps and answer one
  conceptual question before a correct answer is cleared. It emits per-problem
  badges/confidence/reasoning and an overall verdict; every turn (incl. tool calls) is
  stored for audit. *Value: catches the student who got the right answer without
  understanding — the gap a graded answer alone can't see.*
- **Grading** (`api/core/grading_ai.py`; `api/models/assignment.py` → `SubmissionGrade`).
  One text-only LLM call per submission consumes the extraction (work steps + final
  answers), compares against the teacher's answer key + rubric, and produces a per-problem
  grade **that pre-fills the teacher's review page**. *Value: the whole class graded, every
  point explained, before the teacher opens it — but the teacher still reviews every grade.*
- **Generation** (`api/core/assignment_generation.py`, `question_bank_generation.py`).
  Turn a worksheet (or a topic) into a ready-to-assign problem set, with **every answer
  independently re-derived** and the key checked before the teacher sees it. Backed by a
  reusable question bank (`api/models/question_bank.py`) and generation jobs.
  *Value: a problem set the teacher can trust, without a Sunday of hunting or hand-checking
  an AI generator's output.*
- **Teacher-day** (teacher grades/analytics routes; `api/routes/teacher_grades.py`,
  `teacher_practice_activity.py`; `api/models/practice_activity.py`). The teacher opens to
  a **to-do list, not a scoreboard**: the handful of students who need them first, then
  analytics on which students are slipping and which concepts the class is missing, and a
  path from a struggle signal to a reteach/practice set. *Value: visibility into learning,
  ranked and surfaced — no spreadsheet.*
- **Learn** (self-study; `SessionMode.LEARN`, `api/core/step_decomposition.py`,
  `tutor.py`). Decomposes a problem into ordered teachable steps with an interactive tutor
  the student can chat with at any step. *Value: guided problem-solving, not answers.*
- **Practice** (`api/core/practice.py`, `api/routes/practice.py`,
  `school_student_practice.py`). Generate unlimited similar problems from a seed or an
  assignment; school students get per-assignment practice tied to class analytics.
  *Value: targeted repetition on the exact weak spot.*
- **Mock-test** (`SessionMode.MOCK_TEST`). Timed/untimed exam simulation with free
  navigation and photo work-submission for AI diagnosis. *Value: low-stakes rehearsal
  before the real test.*
- **Weak spots / Review** (`api/routes/weak_spots.py`; mobile `WeakSpotsScreen`). Surfaces
  a student's recurring error patterns to review. *Value: study what you actually keep
  getting wrong.*

Supporting AI infrastructure: a **geometry figure
engine** (`api/core/geometry/`), **document vision + image extraction**
(`document_vision.py`, `image_extract.py`), and full **LLM logging + cost tracking**
(`llm_logging.py`, `cost_tracker.py`) surfaced in the admin dashboard.

## 4. Feature map by surface

Concrete inventory of **what exists today**, derived from `tests/harness/improver/surfaces.py`,
`web/src/app/**`, `api/routes/**`, and `api/models/**`.

### Student — web `(app)/` + `/school/student/*` and mobile
- Self-study: Home, Learn + Learn session, Practice, Mock-test, Review, History (list + detail).
- Classroom: student school home, course detail, homework detail, per-assignment practice,
  grades, practice-history; join a section via invite/`JoinClassScreen`.
- Homework submission by photo → extraction confirm → grade + integrity understanding-check chat.
- Account, pricing/subscription (Stripe on web, RevenueCat on mobile), onboarding tours.

### Teacher — web `/school/teacher/*`
- Courses, **units**, **sections** (+ section invites), assignments/homework (draft →
  published; types: homework / quiz / test / practice; source: upload / ai_generated /
  library / manual; optional per-assignment integrity check).
- **Grade review** per section and per student (AI-pre-filled grades the teacher approves/edits),
  homework review flow.
- **Question bank** (build/generate reusable questions; question-bank chat).
- Documents, unit suggestions, **"Try as Student" preview** (shadow preview student),
  section **visibility** controls, practice-activity analytics.

### Admin — `dashboard/`
- **Sales/ops**: Leads + lead detail (notes, meetings), Schools + school detail,
  Independent students, Independent teachers + teacher detail, Admins (invite), Audit logs.
- **AI quality/diagnostics**: LLM calls, Harness runs, Quality, Grading quality, Golden set,
  per-submission trace.

### Public / marketing — web
- Landing, `/students`, `/for-districts`, `/demo` (request-a-demo → contact lead),
  `/subjects/{math,physics,chemistry}`, legal (`privacy` / `terms` / `support` / `trust`).

### Sales demo — `demo/` (standalone, no auth/API)
- Hub (`/`) + present mode (`/present`) with the four stories (integrity, grading,
  generation, teacher-day), all from bundled captured data.

**Subjects (owner-confirmed):** **math is the full, mature subject; physics and chemistry
are partial.** They appear as marketing surfaces (subject pages + mobile subject pills) and
self-study sessions carry a `subject`, but engine depth beyond math is not complete — so
ideate *may* propose deepening physics/chemistry, and should not assume they are on par
with math.

## 5. Principles / non-goals

- **The teacher sees every AI grade.** Grading *pre-fills* the teacher's review page
  (`grading_ai.py`: "pre-fills the teacher's review"); it is a draft for the teacher, not
  an auto-posted score.
- **Integrity raises scrutiny, it does not auto-punish.** The check probes understanding and
  emits badges/verdicts + reasoning for the teacher; a submission it can't read is marked
  `skipped_unreadable` rather than penalized. It raises scrutiny / surfaces for the teacher,
  never auto-flags.
- **Generation is verified before it's trusted.** Generated problems have their answers
  independently re-derived / key-checked before the teacher sees them — the product does not
  hand teachers un-checked AI output.
- **Tutoring guides, it doesn't give answers.** Learn mode decomposes into steps and tutors
  toward the student's own solution.
- **Nothing auto-merges (engineering).** The autonomous improver stops at PR-open for human
  review (`tests/harness/improver/README.md`); it never merges its own work.
- **AI cost + quality are first-class.** Every LLM call is logged and cost-tracked, with an
  evaluation harness, golden set, and quality dashboards — quality is measured, not assumed.
- **Focused on the AI loop today — a current scope, not a permanent boundary.** Today the
  scope is the homework → grade → understand → reteach loop, and Veradic *complements* tools
  like Google Classroom / Canvas rather than replacing them: there is no gradebook export,
  SIS/roster sync, messaging, or attendance in the code. This is where the product is
  focused **now**, not a forever non-goal — general class-management ("LMS") capabilities
  are a possible future expansion. For now, ideate should propose within the AI loop and
  treat LMS-style features as out of current scope unless explicitly reopened.
