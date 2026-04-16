# Recent Activity Sidebar

## Layout

The `/learn` page changes from `max-w-3xl` centered to a two-column grid on `lg:` screens:

```
Desktop (≥lg):
+------ flex-1, max-w-3xl ------+--- flex sidebar ---+
|                                |  Recent Activity   |
|   Subject pills                |                    |
|   Learn / Mock Test toggle     |  * Solve sin(x)dx  |
|   [Mock test config]           |    Learn · 2h ago   |
|   Snap a problem               |                [+] |
|   Type a problem               |  * Mock Test        |
|   Queued problems              |    4/12/2026        |
|   [Start]                      |                [+] |
|                                |  * Find dy/dx       |
|                                |    Learn · 1d ago   |
|                                |                [+] |
|                                |                    |
|                                |     More ->        |
+--------------------------------+--------------------+

Mobile (<lg): sidebar hidden (not in scope)
```

- Outer wrapper: `flex gap-8` with `max-w-5xl mx-auto`
- Left column: `flex-1 max-w-3xl` (existing content, unchanged)
- Right column: `w-72 shrink-0 sticky top-24 self-start hidden lg:block`
- Sidebar flexes with the viewport — at very wide screens the gap grows, but the sidebar content stays `w-72`

## What the sidebar shows

5 most recent sessions for the current subject, filtered by the active tab:

**Learn tab active:**
- All recent mock test sessions (no time restriction)
- Learn sessions **excluding the past hour** (assumption: you just learned it, come back later)
- Result: a mix of learn + mock test, ordered by most recent, capped at 5

**Mock Test tab active:**
- All recent sessions regardless of mode or time (learn + mock test)
- Result: everything recent, ordered by most recent, capped at 5

## Row display

- **Learn session row:** Truncated problem text (1 line), "Learn" badge, relative time (e.g. "2h ago"), `[+]` button
- **Mock test row:** "Mock Test" label, date (e.g. "4/12/2026"), `[+]` button
- **"More ->"** link at the bottom navigates to `/history`

## [+] button behavior

Adds to the existing queue (does not replace):
- Learn session → adds `item.problem` to `problemQueue`
- Mock test → adds all `item.all_problems` to `problemQueue`

## Data flow

- Fetch `session.history(subject, 10, 0)` on mount and when subject changes (fetch 10 to have room after client-side filtering)
- Client-side filter based on active tab (learn vs mock-test) and the 1-hour rule
- Slice to 5 after filtering
- No new backend endpoint needed for filtering

## Backend changes

### `api/schemas/session.py`

Add to `SessionHistoryItem`:
- `mode: str` (already on Session model, just not exposed)
- `all_problems: list[str]` (for mock tests: full question list; for learn: `[problem]`)

### `api/routes/session.py`

History endpoint:
- Remove `mode.in_([LEARN, PRACTICE])` filter so mock test sessions appear
- Populate `all_problems` from the session's `exchanges[0].problems` for mock tests, or `[session.problem]` for learn/practice
- Populate `mode` from `session.mode`

### `web/src/lib/api.ts`

Update `SessionHistoryItem` type:
- Add `mode: string`
- Add `all_problems: string[]`

## Frontend changes

### New: `web/src/components/shared/recent-activity.tsx`

Props:
- `subject: string`
- `activeTab: "learn" | "mock-test"`
- `onUseProblems: (problems: string[]) => void`

Behavior:
- Fetches history on mount / subject change
- Filters client-side based on `activeTab` and 1-hour rule
- Renders up to 5 rows with [+] buttons
- Returns `null` if no sessions match (hides entirely)
- "More ->" links to `/history`

### Modified: `web/src/app/(app)/learn/page.tsx`

- Change outer `div` from `max-w-3xl mx-auto` to a two-column flex layout
- Import and render `<RecentActivity>` in the right column
- Pass `mode` as `activeTab` and wire `onUseProblems` to `addToQueue`
- Sidebar hidden below `lg:` breakpoint

## Edge cases

- **No history for subject** → sidebar hidden entirely
- **All 10 fetched sessions filtered out** (e.g. all learn sessions from past hour on Learn tab) → sidebar hidden
- **Subject change** → re-fetch, reset sidebar
- **Tab change** (learn ↔ mock-test) → re-filter existing data, no re-fetch
- **API error** → silently hide sidebar
- **Queue already at max** → [+] button disabled or hidden
- **User adds same problem twice** → allowed (queue doesn't deduplicate today)

## Files touched

| File | Change |
|---|---|
| `api/schemas/session.py` | Add `mode` and `all_problems` to `SessionHistoryItem` |
| `api/routes/session.py` | Include mock_test in history, populate new fields |
| `web/src/lib/api.ts` | Update `SessionHistoryItem` type |
| `web/src/components/shared/recent-activity.tsx` | New sidebar component |
| `web/src/app/(app)/learn/page.tsx` | Two-column layout, render sidebar |
