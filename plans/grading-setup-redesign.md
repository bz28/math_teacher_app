# Grading Setup Redesign

Replace the bottom-of-page `RubricBlock` with a prominent, simplified "Grading setup" card right below Problems on the HW detail page. Drop the never-used `grading_mode` picker. Pre-fill the two primary fields with opinionated defaults. Add a live preview pane so teachers see what the AI will grade against. Bundle a small Submissions-tab per-row pill split as separate commits in the same branch.

## Scope (one PR, feature branch `feat/grading-setup-redesign`)

### 1. Grading setup card

**Position:** directly below the Problems card, above the "Settings / Configuration" accordion.

**Layout:**
- Desktop (`md+`): two-column grid `[minmax(0,1fr) minmax(260px,340px)]`. Left = fields. Right = live preview.
- Mobile / narrow: single column, preview stacks below the fields.

**Fields visible by default:**
- `Full credit` — primary, `rows={3}`, bold label, pre-filled.
- `Partial credit` — primary, `rows={3}`, bold label, pre-filled.
- `▸ Optional details (Common mistakes, Notes)` — collapsible, collapsed by default. When expanded, reveals two smaller (`rows={2}`) textareas with muted labels.

**No mode picker.** `grading_mode` is removed from the `TeacherRubric` TypeScript type and the UI. The DB column stays (no migration needed — harmless dead field).

**Pre-filled defaults** (shown as actual values in the textareas on first page load):
- Full credit: `"Correct final answer. Mathematically equivalent forms (e.g. 1/2 and 0.5) count as correct. Work shown when the problem asks for it."`
- Partial credit: `"Right approach with an arithmetic or sign error — typically around 60%. Multiple errors or unfinished work — around 30%."`
- Common mistakes: blank with placeholder `"e.g. Sign errors when distributing; flipping the inequality direction when multiplying by negatives."`
- Notes: blank with placeholder `"Anything else the AI grader should know."`

**Save behavior:**
- Stored as an empty `rubric = null` until the teacher edits any field.
- On blur of any field with a changed value, the full rubric is saved (existing `onChangeRubric` + `useAsyncAction` flow).
- If the teacher clears a field back to the default string, we don't auto-save (avoids false-dirty). If the teacher doesn't interact at all, the stored rubric stays null, and the backend's default fallback kicks in on AI grading — and the fallback text matches what the teacher saw, so there's no divergence.

**Save-state hint:** `InlineSavedHint` moves inline next to each field's label (not at panel top), so the teacher sees "Saving…" / "Saved" where they're actively looking.

**Card chrome:**
- Matches the `Problems` card styling (`rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm`).
- Header: small uppercase `GRADING SETUP` label + one-line subtitle `"Tell the AI how to grade. We've filled in sensible defaults — edit to match how you grade."`.

**Empty state:**
- There is no separate "empty" state. The defaults are always rendered. A fresh HW and an edited HW look identical except for field content.

### 2. Live preview pane (right column)

Pure React component. No LLM call. Reads the current rubric state and renders plain English.

**Header:** `🤖 How the AI will grade this`

**Body (when fields have content — default or edited):**
```
✓ Full credit when: {full_credit text}
◐ Partial credit when: {partial_credit text}
⚠ Watch for: {common_mistakes text}     ← only if filled
📝 Notes: {notes text}                   ← only if filled
```

Muted styling for optional fields. Full + Partial always render because they always have at least the default text.

**Sticky on desktop** (follows the teacher as they scroll through the fields). Stacks below on mobile.

**`aria-live="polite"`** so screen readers announce changes when the teacher edits.

### 3. Backend change — keep defaults in sync

Update `api/core/grading_ai.py::_build_rubric_block` so the "no rubric provided" fallback uses the exact same Full credit and Partial credit text as the frontend pre-fill. One source of truth — if the teacher skips the UI, the AI grades against exactly what the UI showed.

Add a code comment on both sides: `# keep in sync with web/src/.../grading-setup-card.tsx defaults` and the mirror.

### 4. Configuration card (formerly "Settings")

- Still uses `<CollapsibleSection>`.
- Auto-expands only when Problems is empty (unchanged).
- Rename label from "Settings" to "Configuration" (slightly more precise; small copy change).
- Position: moves down, below the new Grading setup card.

### 5. Submissions tab per-row pills (polish)

**File:** `web/src/components/school/teacher/submissions-tab.tsx` — the `InboxRow` component's pill block.

Before: single pill `"X/Y grades published to students"`.

After: up to three conditional pills rendered in a flex row.
- `⦿ N to grade` (amber) — when `to_grade + dirty > 0`. Uses combined count since the teacher cares about "needs action" not the mechanical split.
- `⚑ N flagged` (red) — when `flagged > 0`.
- `✓ N published` (green) — when `published > 0`.

Fallback: when `submitted === 0` still show the muted `"No submissions yet"` pill (unchanged).

Sort logic in `compareRows` stays exactly as today.

---

## Teacher flow

1. Teacher creates a HW, generates problems, lands on the HW detail page.
2. Sees Problems card (hero, unchanged).
3. **Immediately below**, sees the Grading setup card with both primary fields pre-filled with sensible defaults.
4. Reads Full credit + Partial credit text. Thinks "that's roughly how I grade" → moves on, or edits to match their style. Live preview on the right shows what the AI will grade against.
5. Expands Optional details only if they want to add common mistakes or notes for this specific HW.
6. Configures due date, sections, etc. in the Configuration card below.
7. Clicks Publish.

---

## Commits (target ~150 lines each)

1. `feat(web): extract GradingSetupCard component + rubric defaults constant`
2. `feat(web): live preview pane (GradingPreview) reading rubric state`
3. `feat(web): wire Optional details collapsible (Common mistakes + Notes)`
4. `feat(web): relocate grading setup above Settings on HW detail`
5. `feat(api): align _build_rubric_block fallback with frontend defaults`
6. `refactor(web): drop grading_mode from TeacherRubric type + related UI`
7. `feat(web): split Submissions tab row pill into to-grade/flagged/published triad`

---

## Files

- `web/src/app/(app)/school/teacher/courses/[id]/homework/[hwId]/page.tsx` — replace `<RubricBlock>` usage with `<GradingSetupCard>`; remove in-file `RubricBlock` + `RubricField` + `GRADING_MODE_OPTIONS`; update imports; relocate in layout.
- `web/src/components/school/teacher/_pieces/grading-setup-card.tsx` — new file (card scaffold + fields + save wiring).
- `web/src/components/school/teacher/_pieces/grading-preview.tsx` — new file (preview pane).
- `web/src/lib/api.ts` — drop `grading_mode` field and `GradingMode` union from `TeacherRubric`.
- `web/src/components/school/teacher/submissions-tab.tsx` — swap single Pill for triad.
- `api/core/grading_ai.py` — update `_build_rubric_block` default text to match frontend.

---

## Out of scope (deferred)

- Subject-specific rubric templates (math-only today; revisit when chem/physics become active).
- Template library across HWs (saved/cloneable rubrics).
- Per-HW AI-grading-enabled toggle in the UI.
- HW tab filter `<select>` → pill redesign (separate polish branch).
- Removing the `grading_mode` DB column (no migration; harmless dead field).

---

## Questions resolved during planning

- **Pre-fill mechanic:** actual values in textareas on first load (not placeholder-only). Teacher accepts with zero typing.
- **Equivalence note in Full credit default:** include it. Strict graders can edit; lenient default prevents the #1 AI false-negative.
- **Percent anchors in Partial credit default:** include them (60% / 30%). AI calibration benefit outweighs minor opinionation.
- **Common mistakes placeholder:** math-centric example is fine for now.
- **Grading mode:** dropped from UI + TypeScript type. DB column remains unused.
- **Preview pane:** pure React, no LLM call, `aria-live="polite"`.

---

## Defaults text (source of truth — duplicate in both places with comment)

Full credit:
```
Correct final answer. Mathematically equivalent forms (e.g. 1/2 and 0.5) count as correct. Work shown when the problem asks for it.
```

Partial credit:
```
Right approach with an arithmetic or sign error — typically around 60%. Multiple errors or unfinished work — around 30%.
```
