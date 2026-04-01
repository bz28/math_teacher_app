# School Platform — Master Plan

## What are we building?

A teacher dashboard at `admin.veradicai.com`. Teachers log in and manage their courses, students, and materials. Same app admins use — different view based on role.

We build the **skeleton now** (courses, sections, documents). Everything else is a future feature that plugs into this skeleton.

---

## MVP — What we build now

### 1. Course Management

A course is the main thing a teacher creates. It represents a subject they teach — like "Algebra II" or "AP Chemistry."

**What the teacher does:**
- Creates a course: name, subject, grade level
- Sees a list of all their courses
- Clicks a course → goes to the course detail page
- Can edit or delete a course

**What the page looks like:**
- Course list with name, subject, section count, document count
- "+ New Course" button with a simple form
- Click a course → course detail page with tabs

---

### 2. Sections (class periods)

A section is one group of students under a course. If you teach Algebra II three times a day, you have three sections: Period 1, Period 2, Period 3.

**What the teacher does:**
- Inside a course, creates sections: "Period 1", "Block A", etc.
- Adds students to a section by email
- Generates a join code (like "HKR42N") that students enter to self-enroll
- Removes students or deletes sections

**What the page looks like:**
- Tab inside the course detail page
- List of sections with student counts
- Click a section → see student roster
- Join code displayed with a copy button
- Add-by-email input field

---

### 3. Document Upload Hub

A simple place to upload and store teaching materials per course. Photos of worksheets, textbook pages, handouts. No AI — just file storage.

**What the teacher does:**
- Uploads an image file
- Sees it in the document list with filename, date, size
- Can view the full image
- Can delete documents

**What the page looks like:**
- Tab inside the course detail page
- Grid or list of uploaded documents
- Upload button, delete button per doc

**Why build this without AI?** It's the foundation. Every future feature (extracting problems, generating tests, creating homework from worksheets) starts with "teacher has uploaded documents." Get the storage right, add intelligence later.

---

### 4. Dummy tabs

These appear in the sidebar but show "Coming Soon" when clicked:
- **Homework** — create assignments, AI grading
- **Tests** — generate quizzes from course content
- **Analytics** — student monitoring, struggle patterns

---

## Page structure

```
Sidebar (teacher):
  Courses       ← the main thing (MVP)
  Homework      ← coming soon
  Tests         ← coming soon
  Analytics     ← coming soon

Course List Page:
  [+ New Course]
  Table: name, subject, # sections, # documents

Course Detail Page (3 tabs):
  [Sections]    → section list, student rosters, join codes
  [Documents]   → upload hub, view/delete files
  [Settings]    → edit course name/subject, delete course
```

---

## Future Features

Each of these is its own feature built on top of the MVP skeleton. They're listed in rough priority order.

### Student Analytics
See how students are doing across sections. Who's struggling, on what topics, completion rates. Traffic-light system (green/yellow/red) per student. Class-wide struggle patterns. Queries existing session data — no extra student input needed.

### Homework + AI Grading
Teacher creates a homework assignment, picks problems, assigns to sections. Students submit photos of their work. AI compares student work against answer keys step-by-step and gives each problem a score. Teacher reviews AI grades, overrides where needed. Class analytics show score distribution and common mistakes.

### AI Document Processing + Units
AI reads uploaded documents and extracts problems from them. Teacher chooses to let AI organize problems into units (like textbook chapters) or organizes manually. Teacher always reviews and edits what AI finds. This turns uploaded photos into structured, usable content that feeds into homework and tests.

### Test Generation
Pick a topic or unit, set difficulty and question count. AI generates a test with verified answer key. Teacher reviews and edits. Can generate variants (different questions, same difficulty) to prevent cheating. Export as PDF.

### LMS Integration
Connect to Canvas, Schoology, or Clever to auto-pull student rosters. Teacher clicks "Connect" → logs in to their school platform → classes and students sync automatically. No manual student management needed.

### Content Visibility Controls
Hide specific documents or units from specific sections. "Period 1 can't see this worksheet yet." Default is everything visible — teacher opts to hide.

### Practice Restrictions
Limit what students can practice in the app. "Period 2 can only practice Unit 1-2 this week." Required for school adoption — prevents students using the app to cheat on homework.

### Data Labeling
Teachers rate AI quality (grading accuracy, solution quality). Improves the AI over time. Simple thumbs up/down interface.

### Student Mobile App Changes
Separate plan doc. Covers: assignments tab, submit homework, view grades, join sections, see class membership.

---

## Starting fresh

We nuke the current branch changes and start from scratch:
- Reset `feat/school-platform` to main
- Build clean: courses → sections → documents → dummy tabs
- One PR with small, logical commits

**What we delete:**
- All current Feature 1-3 code (class models, homework, course extraction, dashboard pages)
- `plans/school-platform.md` (replaced by this plan)

**What we keep from main:**
- School model, teacher role in user model, auth middleware (`require_teacher`)
- Dashboard app shell (role-based routing, layout, CSS)
- Everything student-facing (unchanged)
