# Try as Student — Shadow Student Account

## Summary
When a teacher clicks "Try as Student," the system creates (or reuses) a real
student account tied to that teacher, auto-enrolls it in all the teacher's
sections, and swaps the frontend JWT so the teacher experiences the exact
student flow. A banner at the top provides "Back to teacher view."

## Why a real account
The student experience touches enrollment, homework visibility, image submission,
integrity check pipeline, practice/learn loops, consumption tracking. Faking any
of it would make the preview inaccurate. A real shadow student goes through
identical code paths.

## Data Model

### Migration: add `is_preview` + `preview_owner_id` to `users`
- `is_preview: bool, default false` — marks shadow students
- `preview_owner_id: UUID FK → users.id, nullable` — the teacher who owns this shadow

These two columns let us:
- Find/reuse the shadow: `WHERE preview_owner_id = teacher_id AND is_preview = true`
- Filter from analytics: `WHERE NOT is_preview`

## Backend

### New endpoint: `POST /teacher/preview-student`
1. Look for existing shadow: `SELECT * FROM users WHERE preview_owner_id = :teacher_id AND is_preview = true`
2. If not found, create one:
   - email: `preview+{teacher_id_hex8}@veradic.ai`
   - name: `{teacher_name} (Preview)`
   - role: `student`
   - school_id: teacher's school_id
   - is_preview: true
   - preview_owner_id: teacher_id
   - password_hash: random (never used for login)
3. Sync enrollments: for each section the teacher owns, ensure a SectionEnrollment exists for the shadow student. Delete enrollments for sections the teacher no longer owns.
4. Return `{ access_token, refresh_token }` — JWT for the shadow student account.

### New endpoint: `POST /teacher/exit-preview`
Nothing special needed — the frontend just swaps back to the stored teacher JWT. But we provide this endpoint to invalidate the preview student's refresh token for cleanliness.

### Filter preview students
Anywhere we count or list students, add `WHERE NOT users.is_preview`:
- `list_submissions` (teacher_assignments.py) — already returns student rows, add filter
- Submissions panel count badges
- Section enrollment counts
- Any analytics/averages

## Frontend

### Token swap mechanism
- `localStorage` keys: `veradic_access_token`, `veradic_refresh_token`
- New keys for stashing: `veradic_teacher_access_token`, `veradic_teacher_refresh_token`
- "Try as Student" click:
  1. Call `POST /teacher/preview-student` → get student tokens
  2. Stash current teacher tokens under the `_teacher_` keys
  3. Save student tokens as the active tokens
  4. Call `loadUser()` to refresh auth store → user is now a student
  5. Router push to `/school/student`
- "Back to teacher view" click:
  1. Restore teacher tokens from `_teacher_` keys
  2. Clear the `_teacher_` stash
  3. Call `loadUser()` → user is now a teacher
  4. Router push to `/school/teacher`

### Preview banner
- In `/school/student/layout.tsx`, check if `_teacher_` tokens exist in localStorage
- If yes, render a sticky top banner: "Previewing as student · Back to teacher view"
- The banner component calls the exit flow on click

### Role guard update
- `/school/student/layout.tsx` currently blocks non-students
- The shadow student IS a real student (role=student, school_id set), so it passes the guard naturally — no changes needed

## Commits (3-4)

1. **Migration + model** — add `is_preview`, `preview_owner_id` columns
2. **Backend** — `POST /teacher/preview-student` endpoint, enrollment sync, filter preview students from submissions/counts
3. **Frontend** — token swap, banner, "Try as Student" wired to new endpoint, "Back to teacher" exit flow

## Edge Cases

| Scenario | Behavior |
|---|---|
| Teacher creates new section after first preview | Next "Try as Student" click re-syncs enrollments |
| Teacher deletes a section | Shadow's enrollment for that section is orphaned but harmless (cascade delete handles it) |
| Shadow student shows up in submissions list | Filtered by `is_preview` |
| Teacher logs out while in preview mode | Teacher tokens in stash are lost. Next login is as teacher. Shadow student session expires naturally. |
| Two teachers at same school | Each gets their own shadow (tied by preview_owner_id) |
| Shadow student's integrity check data | Real data, but filtered from teacher's view by is_preview on the student row |

## Not in this PR
- Shadow student cleanup/deletion
- Admin view of shadow students
- Mobile "Try as Student" (web only for now)
