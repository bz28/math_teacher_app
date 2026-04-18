# Enforce one enrollment per (student, course)

## Why

The student portal's sidebar shows two highlighted entries when a
student is enrolled in two sections of the same course — both href
to `/school/student/courses/{course_id}` (identical), so the active
check `pathname.startsWith(href)` matches both. The `listHomework`
endpoint also merges HWs across all sections the student shares with
that course, which is ambiguous from the student's POV.

In real-world schools a student takes a course once per term — one
enrollment per course is the honest data model. Enforcing that at the
DB level eliminates the sidebar bug, the URL ambiguity, and the
merged-HW-list confusion, all without touching routing.

## Scope — one commit

1. **Alembic migration.** Delete duplicate enrollments (keep the
   earliest per `(student_id, course_id)`), then add a unique index
   on that pair. Pre-launch — no real users — so dedupe is safe; no
   notification / grandfathering.

2. **Pre-check in the section-join endpoint.** The DB constraint
   alone would surface a generic 500 on violation. Add an explicit
   check: if the student is already in another section of this
   course, return a 400 with the other section's name so the UI can
   show a clean error.

3. **Backend test.** Two cases: same-course second join → 400; other-
   course join → success.

## Out of scope

- Un-enroll flow (schedule-change edge case). Separate feature.
- Frontend changes — the join form already surfaces API error
  messages.
- Sidebar URL rewrite. Once the constraint holds, `course_id`
  unambiguously implies a single section per student.
