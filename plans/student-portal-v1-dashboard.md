# Student Portal v1 — "Today" Dashboard + Sidebar Shell

**Branch:** `worktree-student-portal-v1` (worktree off `main`)
**Status:** Approved, ready to build
**Scope:** Web only. No mobile. No feedback surfaces.

---

## 1. Context

The student-facing school portal (`/school/student/*`, web-only, Next.js App Router) is minimal today: a flat class list → per-class HW list → upload-photo form. The teacher portal is rich (multi-tab workspace, grades tab, submissions inbox). v1 closes the gap by giving students a proper home — a sidebar shell, a prioritized "Today" dashboard, a My Grades page, and a visible timeline on each homework so submitting doesn't feel like dropping work into a black box.

### Current state (verified)

- `web/src/app/(app)/school/student/layout.tsx` — role-guard + teacher-preview banner. No sidebar.
- `web/src/app/(app)/school/student/page.tsx` — class list + join-code form (becomes dashboard in this plan).
- `web/src/app/(app)/school/student/courses/[courseId]/page.tsx` — per-class HW list (unchanged routing).
- `web/src/app/(app)/school/student/courses/[courseId]/homework/[assignmentId]/page.tsx` — HW detail, gets timeline addition.
- `api/routes/school_student_practice.py` — mounts at `/v1/school/student`. Has `GET /classes`, `GET /courses/{id}/homework`, `GET /homework/{id}`, `GET /homework/{id}/submission`. **No endpoint surfaces grade data to students today.**
- `web/src/components/school/teacher/percent-badge.tsx` — teacher-scoped folder, will move to shared.
- Per memory: no real users yet, so URL changes are fine.
- All existing student pages are client components (`"use client"`). Convention maintained.

---

## 2. Locked v1 scope

### IN
1. **Sidebar shell** wrapping all `/school/student/*` routes.
2. **Dashboard home** at `/school/student` (replaces class list).
3. **My Grades page** at `/school/student/grades`.
4. **Class detail + HW detail** — unchanged logic, rendered inside new shell.
5. **Slim pillar 2** — 4-stage `AssignmentTimeline` component on HW detail.
6. **UI polish pass** — motion, empty states, responsive.

### OUT (explicit)
- No per-problem feedback display
- No `ai_breakdown` surfacing
- No grade trends / charts / concept rollup
- No rank / percentile / class-average
- No practice-variation learning loop (pillar 5 blocked on teacher variation revival — see `project_practice_variations_revival.md`)
- No mobile / React Native changes
- No topic tags
- No changes to teacher portal
- No grade-publish logic changes

---

## 3. Backend

### Two new endpoints, one router

Both live in `api/routes/school_student_practice.py` (same JWT + role pattern as existing endpoints).

#### `GET /v1/school/student/dashboard`

Single aggregated endpoint — avoids three-way client waterfall.

```python
class DashboardAssignment(BaseModel):
    assignment_id: uuid.UUID
    title: str
    type: str
    due_at: datetime | None
    course_id: uuid.UUID
    course_name: str
    section_name: str
    status: Literal["not_started", "submitted"]
    is_late: bool

class DashboardGrade(BaseModel):
    assignment_id: uuid.UUID
    title: str
    course_id: uuid.UUID
    course_name: str
    section_name: str
    final_score: float
    max_score: float
    percent: float
    published_at: datetime

class StudentDashboardResponse(BaseModel):
    first_name: str
    due_this_week: list[DashboardAssignment]   # unsubmitted, due_at > now, due_at <= now+7d; ASC
    overdue:       list[DashboardAssignment]   # unsubmitted, due_at < now
    in_review:     list[DashboardAssignment]   # submitted, no published grade; DESC by submitted_at
    recently_graded: list[DashboardGrade]      # grade_published_at not null; DESC; limit 10
```

**Implementation notes:**
- Single SQL join: `SectionEnrollment → Section → AssignmentSection → Assignment` filtered to current user's enrollments, `status='published'`.
- Second join for graded: `Submission → SubmissionGrade WHERE grade_published_at IS NOT NULL`.
- No `teacher_notes`, no `breakdown`, no `ai_breakdown` in response. **Pydantic model deliberately omits these.**
- `first_name` derived from `User.name.split(" ")[0]`; fallback empty string (UI renders "Welcome back" when blank).
- Server-side timezone: UTC. Client formats relative times.
- No pagination (natural bounds: 7-day window, 10 recent grades).

#### `GET /v1/school/student/grades`

```python
class StudentGradesResponse(BaseModel):
    grades: list[DashboardGrade]  # all published grades, DESC by published_at
```

Sortable client-side. Volume small enough to skip pagination.

### No schema changes
`SubmissionGrade` already has `grade_published_at`, `final_score`. No migration.

### Tests
- `api/tests/test_school_student_dashboard.py` — happy path + empty state for each endpoint, role guard (teacher forbidden), multi-section enrollment, grade unpublished (absent from response).

---

## 4. Frontend architecture

### Routing changes

| Before | After |
|---|---|
| `/school/student` → class list | **`/school/student` → Dashboard** |
| — | **`/school/student/grades`** (new) |
| `/school/student/courses/[id]` | unchanged routing, now inside sidebar |
| `/school/student/courses/[id]/homework/[id]` | unchanged routing, adds timeline |

### New files

```
web/src/app/(app)/school/student/
├── layout.tsx                     (MODIFIED — wraps children in sidebar shell)
├── page.tsx                       (REPLACED — dashboard home)
└── grades/
    └── page.tsx                   (NEW — My Grades list)

web/src/components/school/student/
├── sidebar.tsx                    (NEW — nav + class list + join button + account)
├── sidebar-join-modal.tsx         (NEW — join-code form extracted)
├── dashboard-card.tsx             (NEW — titled container)
├── dashboard-assignment-row.tsx   (NEW — Due / Overdue / In review row)
├── dashboard-grade-row.tsx        (NEW — Recently graded row)
├── urgency-pill.tsx               (NEW — color-coded due-date chip)
└── assignment-timeline.tsx        (NEW — 4-stage pillar-2 timeline)

web/src/components/school/shared/
└── percent-badge.tsx              (MOVED from teacher/ — teacher imports updated)
```

### Existing components reused
- `web/src/components/school/shared/empty-state.tsx` — every empty card.

### Data fetching strategy
- **Dashboard:** one `useEffect` → `schoolStudent.getDashboard()`. Per-card skeletons.
- **My Grades:** one `useEffect` → `schoolStudent.getGrades()`.
- **Sidebar classes:** fetched in `layout.tsx`, passed via React context to avoid double-fetch.
- **Revalidation:** `visibilitychange` listener on window — refetch when tab regains focus. Covers the "student checks email, comes back, sees new grade" moment. No SWR / React Query introduced.
- **Errors:** per-card inline error + retry button. No full-page red screen.
- **Auth:** existing `useAuthStore` + layout role-guard; no change.

### API client additions (`web/src/lib/api.ts`)
```ts
schoolStudent.getDashboard(): Promise<StudentDashboardResponse>
schoolStudent.getGrades(): Promise<StudentGradesResponse>
```

---

## 5. Killer-UI specifics

### Global shell
- Fixed left sidebar, 240px at ≥1024px; 64px icon-rail at 768–1023px; hamburger drawer at <768px.
- Sidebar bg: `bg-surface` + subtle right border. Main pane: `bg-background`. Two-tone without heaviness.
- Active nav item: 3px primary left-accent bar + `text-primary` label + subtle bg tint. Bar animates sliding between items on route change.
- Typography: dashboard H1 `text-3xl font-bold`, card titles `text-sm font-semibold uppercase tracking-wide text-text-muted` (Linear/Stripe-style section labels).

### Dashboard layout
- `max-w-5xl`, centered, `px-8 py-10`.
- Greeting: "Good morning, {first_name}" + muted subtitle with today's date ("Thursday, April 16").
- **In review** inline status line (shown only when `in_review.length > 0`): `"{N} assignments submitted — waiting for your teacher."` Small, muted, above the cards.
- **Due this week** card with **Overdue** as a red-tinted subsection inside it when non-empty.
- **Recently graded** card.
- 24px gap between cards.

### Urgency color system (`<UrgencyPill>`)

| State | Text | Pill bg | Label |
|---|---|---|---|
| Overdue | `text-red-700` | `bg-red-50` | "overdue by 2 days" |
| Due today / <24h | `text-red-600` | `bg-red-50` | "due today" / "in 3 hrs" |
| Due <3d | `text-amber-700` | `bg-amber-50` | "in 2 days" |
| Due >3d | `text-text-muted` | transparent | "in 5 days" |

Human-readable relative strings derived from `due_at` client-side.

### Assignment row
Layout: `[Course avatar 32px] [Title | Course name] [Urgency pill] [chevron]`
- Course avatar: rounded-square, first letter of course name, deterministic color from `course_id` hash.
- Hover: bg shifts to `bg-surface-hover`, chevron slides right 4px.
- Click: `/school/student/courses/{course_id}/homework/{assignment_id}`.
- Focus: 2px primary ring (existing pattern).

### Graded row
Layout: `[Course avatar] [Title | Course name · "published {date}"] [PercentBadge size=lg]`
- Shared `PercentBadge` (green ≥85, neutral ≥70, red <70).
- Click → HW detail (existing route).
- First-mount animation: count-up 0→percent over 250ms. One-time.

### Empty states
- **Due this week empty:** "You're all caught up — nothing due this week." + muted check icon.
- **Recently graded empty:** "No graded work yet. Once your teacher publishes, they'll show up here."
- **In review empty:** hide the inline line entirely.
- **Zero classes (new student):** full-page empty with a prominent "Join a class" CTA that opens the same modal as the sidebar "+".

### Assignment timeline (pillar 2 slim)
- Component: `<AssignmentTimeline submission={...} grade={...} />` on HW detail page top.
- 4 stages:
  1. **Assigned** (always active — assignment exists)
  2. **Submitted** (active when `submission.submitted_at` set)
  3. **Being reviewed** (active when submitted AND grade not published)
  4. **Graded** (active when `grade.grade_published_at` set)
- Visual: filled dots for active stages, hollow dots for pending, connecting line between. Current stage gets a subtle pulse.
- No "Next step" stage (was pillar-5 territory; deferred).
- Data source: fields already on `StudentHomeworkDetail` + grade. **If `StudentHomeworkDetail` doesn't include published grade, extend it minimally** — add `final_score | null`, `max_score | null`, `grade_published_at | null`. Omit breakdown/notes/ai.

### Micro-interactions (v1 budget — tight)
- Card mount: staggered fade-in, 100ms offset, one-time on page load.
- Percent-badge count-up on Recently Graded.
- Sidebar active-indicator slide on route change.
- Nothing else.

### Responsive
- ≥1024px: 240px sidebar + main.
- 768–1023px: 64px icon-rail (tooltips on hover).
- <768px: hamburger drawer; cards stack full-width.
- Goal: survive iPad/phone browser. Not a real mobile experience.

---

## 6. Testing & verification

### Manual QA checklist
- [ ] Student with multiple classes: all appear in sidebar
- [ ] Student with 0 classes: empty-state page + join CTA
- [ ] Due-this-week card: unsubmitted only, sorted ASC
- [ ] Overdue subsection: red treatment, correct items
- [ ] Submit an HW → it moves from Due to In review line
- [ ] Teacher publishes grade (via teacher preview) → student sees it in Recently graded after focus refresh
- [ ] Click any row → lands on correct HW detail
- [ ] HW detail shows 4-stage timeline with correct active stage
- [ ] Sidebar 1024/768 breakpoints work
- [ ] Join-code modal: invalid → error; valid → class added to sidebar
- [ ] Preview-mode banner still renders for teachers previewing as student
- [ ] Account link navigates to existing `/account`

### Edge cases
1. Student in multiple sections of same course → sidebar shows both entries distinguished by section
2. `due_at = null` → filter out of Due/Overdue; check assignment model allows null
3. Section with 0 published HWs → class in sidebar, empty-state dashboard
4. Grade unpublished after publish → disappears from Recently Graded
5. Long names → truncate with ellipsis
6. Dashboard fetch error → per-card error + retry
7. Student with only overdue (no upcoming) → card shows overdue section only, no "nothing upcoming" filler

### Unit tests
- **Backend:** pytest in `api/tests/test_school_student_dashboard.py`. Mirror existing patterns.
- **Frontend:** no web test runner in `web/package.json` — skip. Introducing Vitest is a separate PR.

---

## 7. Commit plan

Branch: `worktree-student-portal-v1` off main. Each commit independently green.

1. **`refactor(web): move PercentBadge to school/shared/`** — one file moved, teacher imports updated. ~30 lines.
2. **`feat(api): student dashboard + grades endpoints`** — Pydantic models, 2 handlers, tests. ~250 lines.
3. **`feat(web): student portal sidebar shell`** — `sidebar.tsx`, `sidebar-join-modal.tsx`, layout wrapper, class-list context. Existing `page.tsx` still renders (temporarily). ~200 lines.
4. **`feat(web): student Today dashboard`** — replace `page.tsx`, add `dashboard-card.tsx`, `dashboard-assignment-row.tsx`, `dashboard-grade-row.tsx`, `urgency-pill.tsx`, API client wiring. ~280 lines.
5. **`feat(web): student My Grades page`** — `grades/page.tsx` + small table component. ~100 lines.
6. **`feat(web): HW detail assignment timeline`** — `assignment-timeline.tsx` + HW detail integration + minor backend response extension if needed. ~130 lines.
7. **`polish(web): student portal motion + empty states + responsive`** — fade-in, count-up, empty copy, breakpoint QA. ~80 lines.

Total: ~1070 lines across 7 commits.

---

## 8. Shipping checklist

Before requesting review:
- [ ] All commits build green locally
- [ ] Backend tests pass (`pytest api/tests/test_school_student_dashboard.py`)
- [ ] Manual QA checklist run in browser
- [ ] Dev server + preview-as-student used end-to-end
- [ ] No teacher-portal regression (smoke check teacher dashboard still loads)
- [ ] Account link confirmed working

Then user approval → push branch → open PR → monitor CI → merge (no squash, per project convention).

**Post-merge reminder (tracked in memory `project_student_portal_v2_deferred.md`):** surface pillar 3 (feedback display) and pillar 5 (practice loop — blocked on teacher variation revival) design decisions.
