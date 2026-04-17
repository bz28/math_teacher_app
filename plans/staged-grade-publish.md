# Staged grade publishing — "republish" flow

## Why

Today: teacher edits a grade **after** publishing → students see the new value instantly. No dirty marker, no confirmation step. Footgun.

Target: publishing snapshots what students see. Later edits are held as drafts until the teacher clicks **Republish**, at which point students get the new value.

## Data model

One table affected: `submission_grades`. Add three columns, all nullable:

- `published_final_score  float`
- `published_breakdown    jsonb`
- `published_teacher_notes text`

Semantics:

| State                   | `grade_published_at` | `published_*`     | Student sees                 |
|-------------------------|----------------------|-------------------|------------------------------|
| Drafting                | null                 | null              | nothing                      |
| First publish           | set                  | copy of live      | `published_*`                |
| Teacher edits           | set                  | unchanged         | `published_*` (stale intent) |
| Teacher clicks republish| set (new timestamp)  | copy of live      | `published_*` (now fresh)    |

**Dirty = `grade_published_at IS NOT NULL AND graded_at > grade_published_at`.**
Cheaper than JSON diffing; `graded_at` already gets bumped on every grade write.

No migration backfill (per "no real users yet" memory). Existing published grades will appear as "dirty → republish needed" on deploy, which is acceptable in dev.

## API changes

1. **`POST /teacher/assignments/{id}/publish-grades`** (existing)
   Expand the query from "unpublished-only" to "unpublished OR dirty," and copy `final_score / breakdown / teacher_notes` → `published_*` for every row in the set. Set `grade_published_at = now()` for both cases. Idempotent.

2. **`PATCH /teacher/submissions/{id}/grade`** (existing)
   No change. Still writes live fields. `graded_at` bump already provides the dirty signal.

3. **Submission detail response** — add `grade_dirty: bool`
4. **Submission row response** — add `grade_dirty: bool`
5. **Submissions inbox aggregates** — add `dirty` count alongside `to_grade`. UI folds both into a single pill.
6. **Grades tab reads** — switch `get_course_grades` and `get_student_grades` to read `published_final_score / published_breakdown` instead of live. Grades tab is the "what students see" view.

## UI changes

**Review page (`…/sections/[sid]/review/page.tsx`)**
- `PublishButton` label becomes "Publish N" for all-fresh, "Republish N" when any dirty, "Publish N · M edited" when mixed. Confirmation dialog adjusts copy similarly.
- Per-student strip shows: "Edited · not yet sent to students" when `grade_dirty`.

**Submissions inbox (`submissions-tab.tsx`)**
- Pill rename: `N to grade` → `N to release` (or `N to publish`). Count = `to_grade + dirty`.

**Teacher Grades tab**
- No UI change — just reading from new columns server-side.

## Commit plan

1. `feat(api): snapshot grades on publish + dirty detection` — migration, publish endpoint copy, dirty flag on submission detail+row, grades read switch, inbox `dirty` count
2. `feat(web): republish flow for edited grades` — review page labels/hint, inbox pill rename

Out of scope (separate PR): unpublish button.
