# School Platform — Master Plan

## What are we building?

A B2B school system where teachers manage courses and students on the main Veradic AI website (`veradicai.com`). Teachers get in by invite only — schools reach out to us, we close the deal, we invite their teachers. Students connected to a school only see their enrolled courses (no free exploration).

The admin dashboard (`admin.veradicai.com`) stays internal — we use it to manage schools, track leads, and invite teachers.

We are building the **web app only** for now. Mobile changes come later.

---

## How it works (plain English)

**Three experiences, one website, one account system:**

- **Regular student** — signs up freely, picks any subject, free tier or pays for Pro. This is the current experience, unchanged.
- **School student** — same account, but once they join a class via join code, their home screen only shows their enrolled courses. No generic subject browsing. Access comes from the school plan. If they had a personal Pro subscription, it gets cancelled — the school covers them now.
- **Teacher** — can only get in through an invite from us. Manages their own courses, sections, and students. Each teacher is independent — no sharing between teachers at the same school.

**A student can't be both regular and school.** Joining a school section switches their experience entirely.

---

## The sales funnel

1. Teacher or school contact finds `veradicai.com/teachers` (marketing landing page)
2. They fill out a contact form (school name, name, email, role, approx students, message)
3. We get notified two ways: email + lead appears in admin dashboard "Leads" tab
4. We have a conversation, do a demo, close the deal
5. We create the school in admin dashboard → invite teacher(s) by email
6. Teacher clicks invite link → `veradicai.com/register?invite=TOKEN` → sets name + password (email + school pre-filled)
7. Teacher lands on teacher dashboard, connected to their school
8. Teacher creates courses → sections → shares join codes with students
9. Students enter join code → enrolled → experience switches to school mode

---

## Data model

### New models

```
School
  id              UUID, primary key
  name            string ("Lincoln High School")
  city            string, nullable
  state           string, nullable
  contact_name    string (person who signed the deal)
  contact_email   string
  is_active       boolean, default true (kill switch)
  notes           text, nullable (internal admin notes)
  created_at      datetime
  updated_at      datetime

TeacherInvite
  id              UUID, primary key
  school_id       FK → School
  email           string (who's being invited)
  invited_by      FK → User (admin who sent it)
  token           string, unique, URL-safe
  status          "pending" | "accepted" | "expired"
  expires_at      datetime (14 days from creation)
  created_at      datetime

ContactLead
  id              UUID, primary key
  school_name     string
  contact_name    string
  contact_email   string
  role            string ("teacher", "admin", "IT director", etc.)
  approx_students integer, nullable
  message         text, nullable
  status          "new" | "contacted" | "converted" | "declined"
  created_at      datetime
```

### Changes to existing models

```
User (add one field)
  school_id       FK → School, nullable
                  null = regular student or admin
                  set = teacher affiliated with a school

Session (add one field)
  section_id      FK → Section, nullable
                  null = free exploration (regular student)
                  set = done within a school course context
                  This silently tags sessions for future teacher analytics
```

### How students connect to schools

There is NO `school_id` on students. Students connect to schools through section enrollments (which already exist):

```
Student → SectionEnrollment → Section → Course → Teacher → School
```

A student joins a section via join code → they're a school student. Remove them from all sections → they're a regular student again.

### Entitlements logic

```
is_pro(user):
  # Personal pro (self-paid Stripe/RevenueCat)
  if user has active personal subscription → True

  # School pro (enrolled in any active school's section)
  if user is enrolled in ANY section
     whose course's teacher belongs to an active school → True

  return False (free tier)
```

The school's `is_active` flag is the kill switch — deactivate it and all school students fall back to free tier.

---

## What teachers see (main web app)

```
┌──────────────────────────────────────────────┐
│  V  Veradic AI          Lincoln High School  │
├──────────────┬───────────────────────────────┤
│              │                               │
│  Dashboard   │  (role-based content)         │
│  Courses     │                               │
│  Homework 🔒 │                               │
│  Tests 🔒    │                               │
│  Analytics 🔒│                               │
│              │                               │
│  ─────────── │  🔒 = Coming Soon             │
│  Try as      │                               │
│  Student     │                               │
│              │                               │
│  Account     │                               │
└──────────────┴───────────────────────────────┘
```

### Teacher pages

```
/teacher                         → Dashboard overview (courses, student count, school name)
/teacher/courses                 → Course list (name, subject, section count, doc count)
/teacher/courses/[id]            → Course detail with 3 tabs:
                                     Sections — list, rosters, join codes, add/remove students
                                     Documents — upload hub, view/delete
                                     Settings — edit course, delete course
/teacher/homework                → Coming Soon
/teacher/tests                   → Coming Soon
/teacher/analytics               → Coming Soon
```

All under `/(app)` layout group, protected by `AuthGuard`. The app shell checks `user.role` and renders teacher sidebar vs student tabs.

### "Try as Student" toggle

Teachers can flip a switch to see the student experience — try solving problems, test practice mode. Same account, no context switch. Useful for teachers who want to try problems before assigning them.

---

## What school students see (main web app)

Home screen shows ONLY their enrolled courses. No generic subject browsing.

```
┌─────────────────────────────────┐
│  Your Classes                   │
│                                 │
│  ┌────────────┐ ┌────────────┐  │
│  │ Algebra I  │ │ Chemistry  │  │
│  │ Ms. Johnson│ │ Mr. Park   │  │
│  │ Period 3   │ │ Block A    │  │
│  └────────────┘ └────────────┘  │
│                                 │
│  Recent Sessions                │
│  ...                            │
└─────────────────────────────────┘
```

Click a course → pick mode (Learn, Practice, Mock Test) → same AI tutoring, just scoped to that course's subject/grade level. Sessions are tagged with `section_id` for future teacher analytics.

---

## What goes in admin dashboard (admin.veradicai.com)

**Existing tabs (no changes):** Overview, Users, Quality, LLM Calls, Sessions, Promo Codes

**New tabs:**

### Schools tab
- School list (name, city/state, teacher count, student count, status)
- Create school (name, contact info, notes)
- School detail: info, teachers list, invite teacher button, usage stats, deactivate button

### Leads tab
- List of incoming contact form submissions
- Status tracking (new → contacted → converted/declined)
- Contact info, school name, message, date

---

## Registration flows

### Teacher picks "Teacher" on register page (no invite)

```
"Teacher accounts are set up through school partnerships.

 If your school already uses Veradic AI,
 ask your school contact to request an invite for you.

 Want to bring Veradic AI to your school?
 [Learn More →]"
```

"Learn More" links to `/teachers` landing page. No dead end.

### Teacher with invite link

```
veradicai.com/register?invite=TOKEN

Email: jane@school.com (pre-filled, locked)
School: Lincoln High School (shown, locked)
Name: [____________]
Password: [____________]

[Create Account →]
```

Teacher lands directly on teacher dashboard after registration.

### Student enters join code

Existing flow — student enters 6-character code, gets enrolled in section. The change: their home screen immediately switches to show enrolled courses only.

---

## `/teachers` landing page

Marketing page. Not a signup page.

```
Hero: "AI-Powered Tutoring for Your Classroom"
Pitch: Manage courses, track progress, AI-graded homework (coming soon)

[Features section]
[How it works for teachers]

────────────────────────
"Bring Veradic AI to Your School"

  School Name:     [____________]
  Your Name:       [____________]
  Email:           [____________]
  Role:            [Teacher / Admin / IT Director]
  Approx Students: [____________]
  Message:         [____________]

  [Request a Demo →]
────────────────────────
```

Form submission → email notification to us + lead created in admin dashboard.

---

## Implementation phases

Build order. Each phase is one or more small commits pushed to the feature branch.

### Phase 0: Cleanup
- Remove old teacher pages from admin dashboard (`/dashboard/src/pages/teacher/`)
- Remove any old teacher-related routing/nav in the admin dashboard
- Clean slate before building the new approach

### Phase 1: Database foundation
- `School` model + migration
- `TeacherInvite` model + migration
- `ContactLead` model + migration
- Add `school_id` to User model + migration
- Add `section_id` to Session model + migration

### Phase 2: Admin dashboard — Schools tab
- School CRUD API endpoints (create, list, get, update, deactivate)
- Schools list page in admin dashboard
- School detail page (info, teachers, invite button)
- Invite teacher endpoint (creates invite + sends email)

### Phase 3: Admin dashboard — Leads tab
- Contact lead API endpoints (create, list, update status)
- Leads list page in admin dashboard
- Status update (new → contacted → converted/declined)

### Phase 4: Invite registration flow
- Backend: validate invite token endpoint, accept invite on registration
- Web app: `/register?invite=TOKEN` flow (pre-filled email + school, set name/password)
- Invite status updates to "accepted" on registration
- Teacher lands on teacher dashboard after signup

### Phase 5: Teachers landing page + contact form
- `/teachers` marketing landing page (hero, features, how it works)
- Contact form → POST to contact lead endpoint + email notification
- Responsive design, consistent with main landing page style

### Phase 6: Role-aware app shell
- `app-layout.tsx` checks `user.role`
- Teacher role → sidebar navigation (Dashboard, Courses, Homework, Tests, Analytics, Account)
- Student role → existing tab navigation (unchanged)
- Teacher sidebar shows school name in header

### Phase 7: Teacher course management pages
- `/teacher` — dashboard overview (school name, course count, student count)
- `/teacher/courses` — course list with create button
- `/teacher/courses/[id]` — course detail with 3 tabs:
  - Sections tab: section list, student rosters, join codes, add/remove students
  - Documents tab: upload, view, delete
  - Settings tab: edit course info, delete course
- Uses existing backend teacher API endpoints (already built)

### Phase 8: Registration gate
- Role picker on register page shows teacher partnership message (no invite = no signup)
- "Learn More" links to `/teachers` landing page

### Phase 9: School student experience
- Home screen: show enrolled courses only when student has section enrollments
- Course card shows: course name, teacher name, section name
- Click course → mode selection (Learn, Practice, Mock Test) scoped to course subject/grade
- Sessions tagged with `section_id`
- School-based entitlements: enrolled students get Pro-level access through school

### Phase 10: "Try as Student" toggle
- UI switch in teacher sidebar
- Swaps navigation to student view without changing user role
- Teacher can experience Learn, Practice, Mock Test as a student would

### Phase 11: Coming Soon placeholders
- Homework, Tests, Analytics tabs show coming soon state
- Clean placeholder design consistent with app style

---

## What we are NOT building yet

- **Pricing/billing** — handled offline for now
- **Homework and assignment system** — future feature
- **Test generation** — future feature
- **Teacher analytics** — coming soon placeholder only
- **Subscription cancellation logic** — when a student joins a school, their personal sub should cancel. Complex, deferred.
- **School admin role** — we manage everything for schools
- **Domain-based teacher approval** — invite-only is enough at this stage
- **Mobile app changes** — web first, mobile later
- **LMS integration** — future feature
- **Content visibility controls** — future feature
- **Practice restrictions** — future feature

---

## Future features (built on this skeleton)

Same as before, listed in rough priority order:

1. **Student Analytics** — traffic-light system per student, class-wide struggle patterns
2. **Homework + AI Grading** — create assignments, students submit work photos, AI grades
3. **AI Document Processing + Units** — extract problems from uploads, organize into units
4. **Test Generation** — AI generates tests with answer keys, export PDF, variants
5. **LMS Integration** — auto-sync Canvas, Schoology, Clever rosters
6. **Content Visibility Controls** — hide documents/units per section
7. **Practice Restrictions** — limit what students can practice per section
8. **Data Labeling** — teachers rate AI quality for improvement
9. **Student Mobile App Changes** — assignments tab, submit homework, join sections
