# Learn History Feature

## Goal
Let students review past learn-mode sessions from within each subject. Replace the static "What You Can Do" section on the homescreen. Students can tap into a past session and see all steps + answers as a static review.

## UX Flow

```
Home (tap subject) → ModeSelectScreen (now "Subject Hub")
                      ├── Learn / Mock Test cards (top, unchanged)
                      └── "Your History" section (below, scrollable)
                           ├── Recent learn sessions (5 max, newest first)
                           ├── "See All" link → full history list
                           └── Empty state: "No sessions yet — start learning..."

Tap history card → SessionReviewScreen
                    ├── Problem text (header)
                    ├── Steps list (all expanded, read-only)
                    │   └── Step N: description + final answer
                    └── "Practice Similar" button (bottom)
```

## What a history card shows
```
┌─────────────────────────────────────────┐
│  ✓  Solve 2x + 5 = 13                  │
│  3 steps · Mar 24                       │
└─────────────────────────────────────────┘
```
- Green checkmark for completed, gray clock for abandoned
- Problem text (truncated to 1 line)
- Step count + relative date

## Implementation Plan

### Commit 1: Backend — session history endpoint
**Files changed:**
- `api/routes/session.py` — add `GET /session/history?subject=math&limit=20&offset=0`
- `api/schemas/session.py` — add `SessionHistoryItem` and `SessionHistoryResponse` schemas

**Details:**
- New endpoint: `GET /session/history`
  - Query params: `subject` (required), `limit` (default 20), `offset` (default 0)
  - Filters: `user_id = current_user`, `subject = subject`, `mode = learn` (no mock tests)
  - Orders by `created_at DESC`
  - Returns lightweight list (no `exchanges` or full `steps` — just `id`, `problem`, `status`, `total_steps`, `created_at`)
- The existing `GET /session/{id}` already returns full step data — we reuse it for the detail view (no new endpoint needed)

### Commit 2: Mobile — API client + types
**Files changed:**
- `mobile/src/services/api.ts` — add `getSessionHistory()` function and `SessionHistoryItem` type

**Details:**
- `getSessionHistory(subject: string, limit?: number, offset?: number)` → calls `GET /session/history`
- Type: `SessionHistoryItem { id, problem, status, total_steps, created_at }`

### Commit 3: Mobile — ModeSelectScreen becomes Subject Hub with history
**Files changed:**
- `mobile/src/components/ModeSelectScreen.tsx` — add history section below mode cards
- `mobile/App.tsx` — pass `subject` prop to ModeSelectScreen, add `session-review` screen

**Details:**
- ModeSelectScreen receives `subject` prop
- On mount, fetches `getSessionHistory(subject, 5)` (5 most recent)
- Renders history cards below mode cards in a ScrollView
- Shows loading skeleton while fetching
- Empty state: encouraging message for first-time users
- "See All" link if there are more sessions (we know because we asked for 5 but could be more)
- Tapping a card navigates to SessionReviewScreen with the session ID

### Commit 4: Mobile — SessionReviewScreen (detail view)
**Files changed:**
- `mobile/src/components/SessionReviewScreen.tsx` — new component
- `mobile/App.tsx` — wire up the new screen

**Details:**
- Fetches full session via existing `getSession(id)` on mount
- Displays:
  - Problem text at top (styled like a card)
  - All steps expanded: step number, description, final answer
  - "Practice Similar" button at bottom → calls `getSimilarProblem(id)` and navigates to input screen with that problem pre-filled
- Back button returns to ModeSelectScreen

### Commit 5: Mobile — Remove "What You Can Do" from HomeScreen
**Files changed:**
- `mobile/src/components/HomeScreen.tsx` — remove the tips grid section

### Commit 6: Mobile — Full history list screen
**Files changed:**
- `mobile/src/components/HistoryListScreen.tsx` — new component
- `mobile/App.tsx` — wire up the new screen

**Details:**
- Full scrollable list of all learn sessions for a subject
- Paginated: loads 20 at a time, "Load More" at bottom (or infinite scroll)
- Same card style as ModeSelectScreen preview
- Tapping a card → SessionReviewScreen

## Out of scope (for now)
- Mock test history (different data shape, user said skip for now)
- Global cross-subject history
- Search/filter within history
- Re-playing sessions interactively (Option B from earlier discussion)
