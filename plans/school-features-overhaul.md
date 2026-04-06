# School Features Overhaul — Implementation Plan

> **Status:** Living document. Review feature by feature, update as we go.
> **Branch:** `worktree-feat+school-features-overhaul`
> **Scope:** Web only. No mobile in v1.

---

## The Big Idea

Turn the app into a **closed-loop classroom tool** for high schools. Teachers control everything their students see; students work inside that controlled world. The headline new feature is a **homework integrity checker** — AI verifies a student actually did their own work by asking them follow-up questions about their own submission.

For school-enrolled students:
- All Learn/Practice/Homework problems come from a **teacher-approved question bank**
- No photo uploads to start arbitrary Learn sessions (loophole closed)
- Photo uploads ARE allowed for homework submissions (showing work)
- Personal accounts (no school enrollment) keep the existing open experience

---

## Ground Rules

- **Web only.** Next.js app in `web/`. No React Native in this overhaul.
- **Build new alongside old.** New code lives in a `school/` namespace. Old teacher pages stay until the new ones reach parity, then we delete them.
- **Reuse what works:** API client (`web/src/lib/api.ts`), auth + entitlements stores, math rendering (KaTeX), UI primitives, image upload utilities, session machinery from Learn/Practice.
- **Build fresh:** course/section/unit + subfolder structure, question bank, homework + integrity flow, today feed, bank-restricted Learn/Practice.
- **Desktop-first for teachers.** Fully responsive for students.
- **Schools exist in the database from day one** but there's no school admin role and no self-serve school management UI in v1. Founder provisions schools manually.
- **Single teacher per course in v1**, but use a `course_teachers` join table from the start so co-teachers are a UI lift later, not a migration.
- **Tests are bare-bones in v1**, with the polished test experience (timer, lockdown, randomization) deferred.

---

## Build Order

This is the order we'll work in. Update as we go.

1. **Phase 1 — Scaffolding (UI shell, no backend)**
   - Mock the entire teacher dashboard layout: course cards, course workspace tabs (Sections, Materials, Question Bank, Assignments, Settings), empty states, navigation
   - Goal: click around the new shape, react to it, iterate cheaply
   - Rule: style pixels and structure, but don't write form handlers or interactive flows yet

2. **Phase 2 — Foundations + Course/Section Management (real)**
   - Database changes (Feature 0)
   - Course CRUD, section CRUD, join codes, roster (Feature 1)
   - Goal: a teacher can create a class for real

3. **Phase 3 — Materials Upload + Folder Structure (real)**
   - PDF/image upload, units, sub-folders (2 levels max), drag-to-move (Feature 2)
   - Goal: a teacher can upload files and organize them

4. **Phase 4 — Question Bank (real) — the linchpin**
   - Generation pipeline with natural language constraints
   - Review UI: approve/reject/edit/regenerate
   - Bulk actions
   - Goal: a teacher can turn materials into approved questions

5. **Phase 5 — Homework (the deep build)**
   - Homework creation from the bank (Feature 4)
   - Student Today feed (Feature 6)
   - Student class view + homework view + show-work submission (Feature 7)
   - Goal: end-to-end flow from teacher creating homework to student submitting

6. **Phase 6 — Bank-Restricted Practice/Learn (Feature 10)**
   - Close the loophole for school students
   - Topic picker replaces photo upload
   - Practice this concept button on homework problems

7. **Phase 7 — Integrity Checker (Feature 9)**
   - Dedicated design pass first (UX, framing, confidence model)
   - Then plumbing + UI
   - Parallel workstream after Phase 5

8. **Phase 8 — Grading View (Feature 11)**
   - Bare-bones: AI grading, rubric upload/creation, comments, common mistakes, bulk approve, teacher-gated release

9. **Phase 9 — Bank Exhaustion Dashboard (Feature 8)**
   - Per-section per-unit consumption tracking
   - Heatmap, low-bank warnings, one-click regenerate

10. **Phase 10 — Tests (Feature 5, bare-bones)**
    - Test creation flow that mirrors homework but flagged as test
    - Real test features (timer, lockdown, randomization) deferred to a future phase

11. **Phase 11 — Cutover & Cleanup (Feature 12)**
    - Redirect old `/teacher/*` routes to new `/school/*` routes
    - Delete old teacher pages and components
    - Final dead code sweep

---

## Feature 0 — Foundations

**What it is:** Database tables, code namespace, role plumbing. Invisible but critical.

**What we're doing:**
- New `schools` table: id, name, optional domain, created_at
- New `course_teachers` join table (single row per course in v1, ready for co-teachers later)
- Add `parent_unit_id` column to `units` for one level of nesting
- New `question_bank_items` table: id, unit_id, question text, problem type, difficulty, source document, generation prompt used, status (pending/approved/rejected/archived), worked solution, final answer, timestamps
- New `bank_consumption` table: id, student_id, question_id, context (learn/practice/homework), timestamp
- Extend `assignments` table: `integrity_check_enabled`, `submission_format`, `release_status`
- Extend `submissions` table: `work_image_url` or `canvas_data`, `final_answer`, `integrity_check_status`, `integrity_check_results` (JSON)
- New `integrity_check_responses` table: per-submission per-problem follow-up Q&A and AI scoring
- Add `school_context` column to existing sessions table (tag personal vs school sessions)
- New `school/` folder in `web/src/app/(app)/` for all new pages

**Open questions:**
- Soft-delete or hard-delete bank items? (Lean: soft-delete with "show archived" toggle)
- "Viewed but didn't answer" vs "answered" for consumption tracking?

---

## Feature 1 — Course & Section Management

**What it is:** Teacher's workspace for setting up classes. Evolved from existing code, rebuilt in the new namespace.

**What we're doing:**
- **Courses dashboard** (`/school/teacher`): cards for each course, "+ New Course" button
- **Course workspace** (`/school/teacher/courses/[id]`): tabbed page with Overview, Sections, Materials, Question Bank, Assignments, Settings
- **Sections tab**: list of class periods, each card shows student count + join code + manage button
- **Section detail**: roster view, add/remove students by email, regenerate/copy join code
- **Settings tab**: edit course basics, soft-delete in danger zone

**Edge cases:**
- Soft-delete courses (don't lose a semester to a click)
- Block duplicate emails in same section
- Removed students keep their submission history (becomes "unenrolled student")
- 6-character join code uniqueness check + retry

**Open questions:**
- Default join code expiration?
- CSV roster import in v1?

**Deferred:** Co-teachers (data model ready, no UI)

---

## Feature 2 — Materials Upload & Folder Organization

**What it is:** Upload PDFs and images, organize into units and sub-folders.

**What we're doing:**
- **Materials tab** in course workspace
- Two-pane layout: folder tree on left, contents on right
- Max 2 levels deep: unit → sub-folder → documents
- Drag-and-drop file upload
- Drag-and-drop to move documents/folders
- Breadcrumb trail at top
- "Generate questions from this" action on documents/units (bridge to Feature 3)
- **Per-section visibility toggle** preserved from existing code, extended to sub-folders
- **No automatic AI processing on upload** — teacher explicitly triggers

**Edge cases:**
- Max file size (TBD: 25MB? 50MB?)
- Duplicate filenames
- Deleting a unit with contents (confirmation lists what's inside)
- Deleting a document with approved bank questions (orphan vs delete)
- Reject non-PDF/image file types

**Open questions:**
- Max file size?
- Orphan or cascade-delete bank questions when source doc deleted? (Lean: orphan)

**Deferred:** DOCX, Google Drive, PowerPoint, links, deeper nesting, auto-process on upload

---

## Feature 3 — The Question Bank (the linchpin)

**What it is:** The pool of teacher-approved questions. Everything student-facing pulls from here. Nothing reaches a student that hasn't been approved.

### Generation
- Teacher picks document(s) or a unit, clicks "Generate questions"
- Modal: quantity (default 20, max 50/run), difficulty mix sliders, **natural language constraint field** ("only word problems", "skip trig", "match textbook style")
- Background job runs, teacher can navigate away
- Notification when done

### Review
- **Question Bank tab** in course workspace
- Organized by unit, with counts (pending/approved/rejected)
- Filters: status, difficulty, unit
- Each question card: problem text (math rendered), answer, steps (collapsible), difficulty, source doc, generation prompt
- Per-question actions: Approve, Reject, Edit (inline), Regenerate, Delete
- Bulk actions: select multiple → approve/reject/delete

### Constraints
- Only **approved** questions are ever served to students
- Teachers can edit approved questions (re-verification TBD)

**Edge cases:**
- Generation fails partway → retry without losing partial results
- Garbage results → bulk reject + iterate on constraint
- Long generation jobs → background, teacher comes back later
- Edits to approved questions used in active homework → snapshot at publish time, old responses stay valid against old version
- Near-duplicate detection? (Possible v1.5 enhancement)

**Open questions:**
- Approve-once-everywhere or context-specific (homework-only / practice-only)?
- Auto re-verify answers on edit, or trust teacher?
- "Favorites" / "starred" status on top of approved?

**This is the biggest single feature in v1 and the highest-leverage one.**

---

## Feature 4 — Homework Creation

**What it is:** Teacher assembles a homework from the bank, picks sections, sets due date, publishes.

**What we're doing:**
- **Assignments tab** in course workspace, list of all homework + tests with status badges
- "+ New Homework" → 3-step wizard:

**Step 1 — Basics:**
- Title, description (optional), due date/time, late policy (none / penalize % / no credit after)

**Step 2 — Pick problems:**
- Picker showing approved bank, filterable by unit/difficulty/topic
- Click to add, drag to reorder
- "Suggest a set" button (AI proposes a balanced selection from a natural language description)
- Optional: NL search ("word problems involving rate")

**Step 3 — Assign:**
- Pick sections (all by default)
- Toggle: integrity check on/off (default on, inherits course default)
- Toggle: auto-release grades (default off)
- Save draft or publish

**Edge cases:**
- Block publish with 0 problems / 0 sections / past due date (warn)
- Editing published homework → block major edits (don't yank problems mid-assignment), allow due date extension, description tweaks
- **Snapshot questions at publish time** so unapproving in the bank doesn't break active homework
- Confirmation when deleting homework with submissions

**Open questions:**
- Allow custom (non-bank) problems written directly in the homework creator? (Lean: no, force discipline through the bank)
- Notify students when teacher edits published homework?

---

## Feature 5 — Tests (bare-bones structure)

**What it is:** Same flow as homework, flagged as a test, with real test features deferred.

**What we're doing:**
- "+ New Test" button shares the homework creation flow
- Test-specific fields visible but disabled with "coming soon": timer, randomization, lockdown, results-withheld
- Tests get their own status badges and section in the assignments list
- Student-side test view in v1 = homework view with a "TEST" label

**Open questions:**
- Should v1 tests even be publishable to students, or only saveable as drafts until real test features ship?

**Deferred to a later phase:** Timer + auto-submit, one-sitting enforcement, tab-switch + fullscreen exit detection (flag not block), randomized question/answer order, results withheld until release.

---

## Feature 6 — Student Today Feed

**What it is:** First thing a school student sees. Unified deadline-first feed across all their classes.

**What we're doing:**
- New `/school/home` (or replace existing `/home`)
- Detect: are they enrolled in any school class?
  - **Yes:** show Today feed at top, class cards below
  - **No:** show existing personal-mode home (subjects, generic learn/practice)
- **Today feed sections:**
  - Overdue (red)
  - Today (orange)
  - This week (yellow)
  - Upcoming (gray, collapsed)
- Each item: class name, type (HW/Test), title, due countdown, status, jump-in button
- **Below feed:** class cards with quick stats ("3 things due this week")
- "+ Join class" button up top for new code entry

**Edge cases:**
- Empty state ("You're all caught up! Want to practice anyway?")
- Just joined first class → empty feed, encourage browsing materials
- Overdue grows forever → archive/dismiss without losing data
- Multi-school student (rare) → group by class, not by school

**Open questions:**
- "Upcoming" horizon? (30 days? Forever?)
- Streak / progress / encouragement element, or pure deadline focus?

---

## Feature 7 — Student Class View, Homework, & Submissions

**What it is:** Where students do the actual work.

### Class view (`/school/student/courses/[id]`)
- Header: class name, teacher, section
- Tabs: Homework, Tests, Practice, Learn, Materials (read-only)
- Each tab scoped to this one class

### Homework view
- Header: title, description, due date countdown, status, time remaining
- Problems numbered 1, 2, 3...
- Each problem: question (math rendered), final answer field, **show-work area** (photo upload OR canvas), "Practice this concept" button
- "Practice this concept" → drops them into Learn/Practice mode on a *different* bank problem in the same unit (no AI help on the actual homework problem itself)
- Floating "Submit homework" button, disabled until every problem has answer + work
- **Autosave** on every change so they can come back later

### Submission flow
- Confirm modal: "About to submit. Integrity check will start."
- Submit → status flips → integrity check kicks in (Feature 9)

### Materials view
- Read-only folder tree, scoped to what teacher made visible to this section
- PDF/image previews, no editing

**Edge cases:**
- Tab close mid-homework → autosave restore
- Submit with incomplete problems → block + scroll to missing
- Blurry photos → warn, don't block (AI can re-request if needed)
- Teacher reopens homework after submit → clear "please review" notice
- Mid-homework due date passes → late policy decides

**Open questions:**
- Autosave every keystroke or on tab blur?
- Allow submit before all problems done (give-up mode)?
- "Practice this concept" — count against limits? (Lean: no, free as part of learning)

---

## Feature 8 — Bank Exhaustion Tracking & Dashboard

**What it is:** Teacher sees how much of their bank has been consumed so they generate more before kids run out.

**What we're doing:**
- Track per-student per-question consumption (every serve, in any context)
- Each unit shows consumption indicator: "Period 2: 32/40 used in Unit 3 (80%)"
- **Bank dashboard** in course workspace: matrix view, units × sections, % consumed
- Color thresholds: yellow at 75%, red at 90%
- "Generate more" prefilled with the unit/difficulty gap
- Teacher home notification when any cell crosses threshold

**Edge cases:**
- Track effective bank size (post-rejection)
- Departed students keep history but don't affect active stats
- "Consumed" = served, not "answered correctly"

**Open questions:**
- Reset consumption per-unit when class moves on, or accumulate forever?
- Allow repetition for spaced repetition? (Lean: yes for Practice, no for homework)

---

## Feature 9 — The Integrity Checker

**What it is:** After homework submission, AI verifies the student actually did their own work by asking surgical follow-up questions about *their specific submission*. The most novel feature in the build. **Needs a dedicated design pass before implementation.**

### v1 plumbing (build now)
- Mandatory by default. Teacher toggle off per-class or per-assignment.
- After submission, integrity check kicks off automatically
- Per problem: AI reads student's work → generates 2–3 short follow-up questions about *their approach*
- Examples: "You wrote `x = -b/2a`. What does this formula give you?" / "You factored as `(x-3)(x+5)`. What changes if the constant was +15?"
- Student answers each in 30–60s in the app, can't navigate away (tab switch flagged not blocked)
- AI scores → per-problem confidence rating: Likely understands / Uncertain / Unlikely

### What student sees
- "Quick understanding check, ~2 min" framing — NOT "cheating check"
- One question at a time, gentle timer, progress bar
- After: "Thanks! Your work is being reviewed."
- Student does NOT see the confidence rating (TBD in design pass)

### What teacher sees
- Per-problem badge in grading view: 🟢 / 🟡 / 🔴
- Click to expand: actual Q&A + AI reasoning
- Use as a *signal*, not automated punishment

### Design pass needed before implementation
- Exact prompt engineering for follow-up generation
- Confidence rating model + thresholds
- Pacing/framing UX so kids don't hate it
- Disagreement handling (high score + low confidence)
- Teacher override of bad AI questions
- Retry/resume flow
- Accessibility (LD, anxiety, etc.)

**Edge cases:**
- Student pulled away mid-check → pause/resume?
- Student "doesn't understand" the AI's question → rephrase
- Bad AI question → teacher dismiss + override rating
- Long checks (10 problems × 3 questions) → chunk or cap
- Partial submissions → check what was done or skip?
- Resubmissions → re-run or remember?

**Open questions:**
- Block grading on bad integrity check, or always advisory?
- Should student see their own rating?

---

## Feature 10 — Bank-Restricted Practice & Learn (school students)

**What it is:** Practice and Learn still work for school students, but the source is locked to the teacher's approved bank. Photo upload is hidden.

**What we're doing:**
- When a school student opens Practice/Learn from a class, pulls from that class's approved bank for unlocked units
- Photo upload entry point hidden for school students
- Replaced with "Pick a topic" / "Continue practicing"
- Learn mode flow unchanged (step-by-step tutoring), source swapped underneath
- Practice mode unchanged (MCQ + feedback), source swapped
- "Practice this concept" from homework lands here, scoped to same unit
- Empty bank state: "Your teacher hasn't added practice for this unit yet"

**Edge cases:**
- Multi-class student → pick which class to practice from
- Personal+school dual user → only school enrollment triggers restriction
- Bank empty for unit → friendly empty state

**Open questions:**
- "All my classes" Practice option, or always pick one?
- School student wants to study outside curriculum → no in-app option, must use a personal account. Confirmed.

---

## Feature 11 — Teacher Grading View (bare-bones)

**What it is:** Where teachers review submissions, see AI grades + integrity check, approve/override, release.

**What we're doing:**
- **Grading view** opens from assignments tab
- Split-pane (desktop only): student list left, submission detail right
- Submission detail per problem: question, final answer, work (photo/canvas), AI grade, AI reasoning, integrity check badge
- Per-problem: approve/override controls, comments, common-mistake tag
- "Approve all AI grades" — per submission AND per assignment (bulk)
- **Rubric**: upload file or write inline, AI uses as grading guidance
- Mark reviewed → next pending
- "Release grades to students" button (or auto-release if toggled)

**Edge cases:**
- Resubmissions → versioning, show both
- Unreadable submission → surface, prompt teacher to ask for resubmit
- Override after release → student sees update

**Open questions:**
- Bulk grade across students for one problem ("everyone got #3 right")?
- Gradebook as separate tab vs inside this view?

**Deferred:** Voice feedback, inline annotations on photo/canvas, smarter bulk operations.

---

## Feature 12 — Cutover & Cleanup

**What it is:** Delete the old teacher pages, route everything to new namespace.

**What we're doing:**
- Redirect old `/teacher/*` to new `/school/*`
- Delete old teacher pages, components, dead code
- Migrate any seed/test data
- Update navigation, links, references
- Final sweep

---

## What's NOT in this plan (and we should be loud about it)

**Deferred to a later phase:**
- Tests with real lockdown / timer / randomization
- Voice feedback, inline annotations, smart bulk grading
- Agentic command bar ("make me a 10-question quiz on Unit 3, due Friday")
- Proactive AI nudges to teachers
- Cross-student cheating detection
- Co-teacher roles
- School admin dashboard / self-serve school management
- Native mobile app (any platform)
- DOCX / Google Drive / PowerPoint / link uploads
- Auto-processing on upload
- Session migration UI for personal → school
- Parent accounts
- Gradebook export (PowerSchool, Canvas, Google Classroom)
- SSO (Google, Clever, ClassLink)
- Compliance work (FERPA, COPPA, retention policies)
- Billing per school
- Teacher analytics dashboard

---

## Two Big Risks

1. **The integrity checker is the most novel thing in this build, and we have no design for it yet.** Dedicated design pass before implementation. If we wing it we ship a polygraph kids hate or a toothless quiz that catches nothing.

2. **Bank exhaustion is a scaling problem we need to solve early.** If a teacher generates 20 questions and 30 kids blow through them in a week, empty bank + angry teachers. Need clear story for: how do we know it's running low, how do we tell the teacher, how cheap is regenerating, do we auto-queue regeneration for review.
