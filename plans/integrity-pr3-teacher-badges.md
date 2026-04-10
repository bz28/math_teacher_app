# PR 3: Teacher Integrity Badges + Expandable Detail

## Summary
Show integrity check results in the teacher's Submissions panel:
1. Badge pill next to each student in the list (likely/uncertain/unlikely/pending)
2. Expandable "Understanding Check" section in the detail view with full Q&A
3. Dismiss button per problem with optional reason

## Backend
- Extend `list_submissions` to include `integrity_overview` per submission
  - `overall_status`: complete | in_progress | no_check
  - `overall_badge`: worst badge across problems (null if not complete)
- Add teacher integrity TS types + API methods to frontend client

## Frontend
- Integrity badge pill component (badge string → color/icon/label)
- Submissions list: render pill next to each row
- Detail view: collapsible Understanding Check section
  - Fetches `teacher.integrityDetail(id)` on expand
  - Per-problem cards: badge, Q&A rows, verdicts, timing, tab-switch
  - Dismiss button → reason textarea → calls dismiss endpoint

## Edge Cases
- `integrity_check_enabled = false` → no pill, no section
- Student hasn't started check → gray "Pending" pill
- Student mid-check → gray "In progress" pill, partial detail
- Teacher dismisses problem → row shows dismissed, badge recalculates
- No problems sampled → `no_check` → no pill

## Not in This PR
- Real AI scoring (PR 4)
- Teacher config for enable/disable (PR 5)
