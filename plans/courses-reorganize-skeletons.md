# Section 1: Courses — Reorganize + Skeletons

## Scope

Frontend-only PR. No backend changes, no new models, no migrations.

### Build now
- Sidebar: merge Homework + Tests into single "Assignments" nav item
- Course list: richer cards (use existing API data)
- Course detail: add Overview tab (default landing, uses existing data)
- Course detail: rename Documents → Materials (same flat list)
- Course detail: add Assignments tab (Coming Soon skeleton)
- Materials tab: add coming-soon banners for Units + Upload

### Skeleton placeholders (built in future PRs)
- Units organization in Materials tab
- Upload button (disabled)
- AI auto-organize (disabled)
- Assignments tab functionality

### Not in this PR
- No backend changes
- No Unit model or migrations
- No file upload or S3
- No AI suggestions
- No grade_level field (needs backend)

## Build order

1. `refactor: merge Homework+Tests into Assignments in sidebar`
2. `feat: add Overview tab and Assignments skeleton to course detail`
3. `feat: add coming-soon banners to Materials tab`
4. `feat: polish course list cards`

## Sets up future PRs

1. This PR (reorganize + skeletons)
2. Backend — Unit model, upload, grade_level
3. Frontend — Materials tab (units, upload, move docs)
4. Backend + Frontend — AI unit suggestions
5. Assignments section (full build)
6. Analytics section (full build)
