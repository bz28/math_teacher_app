# History Filters + Selection Mode (Pick from History)

## Problem

The "More ->" link on the Recent Activity panel (Plan 1) sends users to the history tab, but the history tab currently only filters by subject. Users need to filter by mode (Learn vs Mock Test) and subtopic (algebra, geometry, etc.), select specific problems, and send them back to `/learn` to generate a new session.

## Depends on

`recent-activity-panel.md` (Plan 1) — the backend changes (mode + all_problems on history items) are prerequisites.

---

## A: Subtopic Classification

### Approach: Free-form with scope-anchoring examples

The LLM generates a topic label freely (no fixed enum), but the prompt anchors the scope level with examples so labels stay consistent. This avoids maintaining a fixed list per subject while keeping labels at a uniform granularity (e.g. "derivatives" not "calculus", "perimeters" not "geometry").

The decomposition prompt includes:

> *"Classify this problem with exactly ONE word (lowercase) representing the broad mathematical/scientific branch. Examples: algebra, geometry, trigonometry, calculus, statistics, combinatorics, arithmetic, mechanics, thermodynamics, optics, stoichiometry, electrochemistry, organic."*

One-word broad labels produce the most consistent grouping. Multi-word specific labels (e.g. "inverse trigonometric equations" vs "trigonometric equations") created inconsistent splits in testing. Broad one-word branches (e.g. "trigonometry" covers both) are reliably consistent across runs.

### Future: two-level classification

The current design uses a single `topic` column. The code should be structured so adding a second level (broad topic + specific subtopic) later is a clean migration:
- The `topic` column and `Decomposition.topic` field remain as-is
- A future `broad_topic` column can be added alongside without breaking anything
- The filter UI uses a flat dropdown now but can be swapped to a grouped dropdown later
- The decomposition prompt can be extended to request both levels without changing the schema pattern

### Backend implementation

1. **Add `topic` to `DECOMPOSITION_SCHEMA`** in `api/core/llm_schemas.py` — new string property with a description that includes the scope-anchoring examples.

2. **Update `Decomposition` dataclass** in `api/core/step_decomposition.py` — add `topic: str`, populate from LLM response, normalize to lowercase/trimmed.

3. **Add `topic` column to `Session` model** in `api/models/session.py` — `topic: Mapped[str | None] = mapped_column(String(50), nullable=True)`. New Alembic migration.

4. **Persist topic** in `api/core/session.py` — `topic=decomp.topic`.

5. **For mock test / practice batch sessions** that skip decomposition: set `topic` to null. Mock tests may span multiple topics. They appear under "All Topics" filter.

6. **Backfill existing sessions:** Not critical for launch. Old sessions have `topic = null` and appear when no topic filter is active.

7. **Add `topic` to `SessionHistoryItem`** in `api/schemas/session.py`.

8. **New endpoint**: `GET /session/history/topics?subject=math` returning `{ topics: string[] }` — distinct non-null topics from the user's session history for that subject. This populates the filter dropdown.

---

## B: History Page Filters

### New filter rows (added to existing history page)

Three filter rows, always visible (not just in selection mode):

1. **Subject** (existing) — Math / Physics / Chemistry pill buttons
2. **Mode** (new) — "All" / "Learn" / "Mock Test" pill toggle
3. **Subtopic** (new) — dropdown showing "All Topics" by default, populated from `GET /session/history/topics?subject={subject}`

### Backend changes

Update history endpoint in `api/routes/session.py`:
- Add optional `mode` query param: `GET /session/history?subject=math&mode=mock_test`
- Add optional `topic` query param: `GET /session/history?subject=math&topic=algebra`
- Both filters are additive (AND logic)

### What the user sees

```
+-------------------------------------------------+
|  <- Back    Session History                      |
|                                                  |
|  [Math] [Physics] [Chemistry]        <- existing |
|  [All] [Learn] [Mock Test]           <- new mode |
|  [All Topics v]                   <- new subtopic|
|                                                  |
|  Solve sin(x)dx                                  |
|  algebra . Learn . completed . 2h ago            |
|                                                  |
|  Find dy/dx of x^2                               |
|  calculus . Learn . completed . 1d ago           |
|                                                  |
|  Mock Test                                       |
|  Mock Test . 4/12/2026 . completed               |
|                                                  |
|  lim x->0 sinx/x                                |
|  calculus . Learn . abandoned . 2d ago           |
+-------------------------------------------------+
```

- Each history card shows **subtopic badge** (when non-null) and **mode badge** (Learn / Mock Test) as visible labels — always shown, not just when filters are active
- Mock tests show as "Mock Test" + date (same display as Plan 1 panel)
- Changing any filter resets the list and re-fetches from offset 0
- Changing subject also re-fetches the topics dropdown
- Practice sessions grouped under "Learn" in the mode filter

---

## C: Selection Mode (Pick from History)

### Trigger

User clicks "More ->" from the Recent Activity panel on `/learn`. Navigates to `/history?select=true&subject=math`.

### Selection mode behavior

When `?select=true` is in the URL:
- Checkboxes appear on each history row
- Tapping a row toggles its checkbox (instead of navigating to the detail page)
- Floating action bar appears at the bottom: "{N} selected -- [Generate from these]"

When `?select=true` is NOT in the URL:
- No checkboxes, no action bar
- History page works exactly as before (tapping a row navigates to detail)

### "Generate from these" action

1. Collect problem texts from selected items. Learn sessions -> `item.problem`. Mock tests -> `item.all_problems` (full question list).
2. Populate `problemQueue` in the learn store with all collected problems.
3. Navigate to `/learn?subject={subject}`.
4. User lands on `/learn` with problems pre-loaded in the queue. They can review, pick Learn/Mock Test mode, adjust settings, and hit Start. They are NOT auto-started.

### State management

New Zustand store: `web/src/stores/history-selection.ts`
- `selectedIds: Set<string>` — selected session IDs
- `toggle(id: string)` — toggle selection
- `clear()` — reset

Selections persist across "Load More" pagination clicks.

---

## Frontend Changes

### Modified: `web/src/app/(app)/history/page.tsx`

- Add mode filter pill toggle (All / Learn / Mock Test)
- Add subtopic dropdown (fetched from new topics endpoint)
- Add selection mode: checkboxes when `?select=true`, floating action bar
- Update each history card to show subtopic badge and mode badge as visible labels
- Pass `mode` and `topic` params to `session.history()` calls

### New: `web/src/stores/history-selection.ts`

Small Zustand store for selection state.

### Modified: `web/src/lib/api.ts`

- Add `topic: string | null` to `SessionHistoryItem`
- Add `mode` and `topic` optional params to `session.history()`
- Add `session.historyTopics(subject: string)` endpoint

---

## Mobile UX

- Filter rows stack vertically on narrow screens (subject tabs, mode pills, subtopic dropdown)
- Checkboxes are full tap targets
- Floating action bar fixed above the bottom tab bar (`bottom-20`)
- Subtopic dropdown uses native `<select>` on mobile

---

## Edge Cases

- **Old sessions with `topic = null`** -> shown normally, no topic badge displayed. Match "All Topics" filter but not any specific topic.
- **Mock test sessions have no topic** -> no subtopic badge shown, appear under "All Topics" + "Mock Test" mode filter only
- **Selection mode + pagination** -> selections persist across "Load More" (stored in Zustand)
- **Zero selections** -> confirm button disabled
- **User navigates away and back** -> selection state resets (store clears on unmount)
- **Topics dropdown empty** (no sessions with topics yet, e.g. all old data) -> hide the dropdown, show only mode filter
- **Practice sessions in mode filter** -> grouped under "Learn" (practice is not user-facing as a separate mode)
