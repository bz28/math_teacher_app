# Date Range + Search Filters for History Page

## What the user sees

```
+-------------------------------------------------+
|  Session History                                |
|                                                 |
|  [Math] [Physics] [Chemistry]                   |
|  [All] [Learn] [Mock Test]    [All Topics v]    |
|  [From: ___________] [To: ___________]          |
|  [🔍 Search problems...]                        |
|                                                 |
|  cos(x) = 1                                    |
|  trigonometry · Learn · 6m ago · Apr 15, 10:45  |
|                                                 |
|  3x + 10 = 20                                  |
|  algebra · Learn · 7m ago · Apr 15, 10:40       |
+-------------------------------------------------+
```

## A: Search Bar (client-side prefix match)

**Why client-side:** We already have up to 20 items loaded. Filtering them by prefix in the browser is instant — no API call needed. The search updates results as the user types (no submit button).

**How it works:**
- Text input with search icon, below the topic dropdown row
- As the user types, items are filtered: `item.problem.toLowerCase().startsWith(query)` for learn sessions, and for mock tests check if ANY problem in `all_problems` starts with the query
- Empty search = show all (no filter)
- Search persists in URL as `?q=cos` so it survives navigation

**Edge cases:**
- Mock test rows match if any of their questions match the prefix
- Clearing the search box instantly shows all results again
- Search applies ON TOP of mode/topic/date filters (AND logic)

## B: Date Range Filter (server-side)

**Why server-side:** Date filtering on paginated data must be server-side. If we filter client-side, we might have 20 loaded items from this week, but the user wants items from last month — those haven't been fetched yet.

### Backend changes in `api/routes/session.py`

- Add optional `date_from` and `date_to` query params (ISO date strings, e.g. `2026-04-10`)
- Add `SessionModel.created_at >= date_from` and `SessionModel.created_at < date_to + 1 day` to the filter list
- `date_to` is inclusive (the user expects "to April 15" to include all of April 15)

### Frontend

- Two native `<input type="date">` fields, side by side, labeled "From" and "To"
- Native date inputs work well on both desktop (calendar popup) and mobile (OS date picker)
- Changing either date triggers a re-fetch from offset 0 (same as other filters)
- Date values persist in URL as `?date_from=2026-04-10&date_to=2026-04-15`
- Both are optional — leaving "From" empty means "from the beginning", leaving "To" empty means "until now"
- Clearing both removes the date filter

### Edge cases

- If `date_from > date_to` — swap them silently (user probably made a mistake)
- Default: both empty (no date restriction)

## C: Frontend API changes

### `web/src/lib/api.ts`

- Add `date_from?: string` and `date_to?: string` to the history filter type

### `web/src/app/(app)/history/page.tsx`

- Add `dateFrom` and `dateTo` state, read from URL on mount
- Add `searchQuery` state, read from URL on mount
- `updateFilters` updated to include `date_from`, `date_to`, and `q` in URL
- Search filtering applied client-side after data loads
- Date filtering passed to API as server-side params

## Files touched

| File | Change |
|---|---|
| `api/routes/session.py` | Add `date_from`, `date_to` query params to history endpoint |
| `web/src/lib/api.ts` | Add `date_from`, `date_to` to history filter type |
| `web/src/app/(app)/history/page.tsx` | Date inputs, search bar, client-side search filter, URL sync |

## Not in scope

- Fuzzy search (only prefix match for now)
- Date presets like "Last 7 days" / "This month" (nice-to-have, can add later)
- Search on mock test question text in the collapsed state (we search `all_problems`, so it works even when collapsed)
