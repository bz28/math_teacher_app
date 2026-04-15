# Recent Activity Panel (Quick Overview on /learn)

## Problem

Users take mock exams or learn problems but have no way to quickly repeat similar work the next day without manually re-uploading everything. We need an inline panel on the `/learn` page that surfaces recent sessions so users can re-use those problems in one tap.

## What exists today

- `SessionHistoryItem` has no `mode` field. The backend `Session` model stores `mode` (learn/practice/mock_test) but the history API doesn't expose it and filters out mock_test sessions entirely.
- The `/learn` page has no awareness of past sessions.
- No student sidebar exists. Students have a top bar + mobile bottom tabs.

---

## Design

### Where it lives

On the `/learn` page, as an inline collapsible section below the mode selector, above the image upload card. Not a sidebar — the page is already narrow (`max-w-3xl`) and an inline section works identically on desktop and mobile.

### What the user sees

```
+-------------------------------------------+
| Recent Activity                     More ->|
+-------------------------------------------+
| * Solve sin(x)dx           Learn . 2h ago  [Use]
| * Mock Test              4/12/2026          [Use]
| * Find dy/dx of x^2        Learn . 1d ago  [Use]
| * Mock Test              4/11/2026          [Use]
+-------------------------------------------+
```

- Shows up to 5 most recent sessions for the currently selected subject
- **Learn sessions:** show truncated problem text, "Learn" badge, relative timestamp
- **Mock test sessions:** show as a single grouped row labeled "Mock Test" with the date taken (not individual questions). One row per mock test, not one row per question.
- Each row has a "Use" button
- **"Use" on a learn session:** adds the problem to the queue, keeps mode as "Learn"
- **"Use" on a mock test session:** retrieves all questions from that mock test and adds them all to the queue, switches mode to "Mock Test", defaults to "Generate similar"
- **"More ->"** link navigates to `/history` (Plan 2 will add selection mode and filters to history)
- Section is hidden entirely if no recent sessions exist
- Collapsible via local state

### Data flow

- On `/learn` mount, fetch `session.history(subject, 5, 0)` (reuses existing endpoint after backend updates)
- Re-fetch when subject changes
- "Use" on a learn session: populate `problemQueue` with `[item.problem]`
- "Use" on a mock test: populate `problemQueue` with `item.all_problems` (the full question list from that test)

---

## Backend Changes

### 1. Add `mode` to `SessionHistoryItem`

File: `api/schemas/session.py`

Add `mode: str` to `SessionHistoryItem`. The Session model already stores this.

### 2. Include mock_test sessions in history

File: `api/routes/session.py`

The history endpoint currently filters to `mode.in_([LEARN, PRACTICE])` at line 180. Remove that filter so mock_test sessions also appear. Mock tests appear as single entries (one Session row per mock test).

### 3. Add `all_problems` to `SessionHistoryItem`

For mock test sessions, we need to return the full list of question texts so the frontend can populate the queue when the user taps "Use". The `createMockTest` endpoint receives `all_problems` — we need to verify these are persisted on the session row and expose them in the history item.

Add `all_problems: list[str]` to `SessionHistoryItem`. For learn/practice sessions this is `[problem]`. For mock tests it's the full question list.

### 4. Update frontend API types

File: `web/src/lib/api.ts`

Update `SessionHistoryItem`:
```
- Add mode: string
- Add all_problems: string[]
```

---

## Frontend Changes

### New file: `web/src/components/shared/recent-activity.tsx`

The inline panel component. Props: `subject`, `onUseProblems(problems: string[], mode: "learn" | "mock-test")`.

- Fetches recent history on mount and when subject changes
- Renders learn sessions with problem text + "Learn" badge + relative time
- Renders mock test sessions as "Mock Test" + date (e.g. "4/12/2026") — one row per test
- "More ->" links to `/history`
- Returns null if no sessions found (hides the section)

### Modified: `web/src/app/(app)/learn/page.tsx`

- Import and render `<RecentActivity>` between the mode selector and the image upload card
- Wire `onUseProblems` to populate `problemQueue` and set `mode`

### Modified: `web/src/stores/learn.ts`

- Add `preloadQueue(problems: { text: string }[])` action that sets `problemQueue` directly (so the panel can inject problems without going through `addToQueue` one at a time)

---

## Mobile UX

- Same inline section, works in the existing narrow layout
- No layout changes needed — it's just another card in the vertical flow
- "Use" buttons are full tap targets

---

## Edge Cases

- **User switches subject on `/learn`** -> re-fetch recent activity for new subject
- **No history for a subject** -> section hidden entirely
- **Mock test with many problems** -> shows as single "Mock Test" row with date, all questions loaded on "Use"
- **Abandoned sessions** -> still shown (user may want to retry those problems)
- **User taps "Use" when queue already has items** -> replace the queue (simpler and less confusing)
- **API error fetching recent activity** -> silently hide the section (non-critical feature)
