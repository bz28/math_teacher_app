# Fix Teacher Portal Unwired Features

## Overview
Several features in the teacher dashboard have UI that isn't fully wired to the backend. This plan fixes the three main issues.

---

## Fix 1: AI Categorization Doesn't Create New Units (High Priority)

**Problem:** In the Materials tab, when a teacher uploads files and AI suggests placing them into a *new* unit (one that doesn't exist yet), pressing "Accept" uploads the files as Uncategorized. The code looks up the suggested unit name in the existing units list, finds nothing, and falls back to `unit_id: null`.

**Location:** `web/src/components/teacher/materials-tab.tsx`

**Affected functions:**
- `handleConfirmSuggestions()` (line ~288) — the "Accept" button after top-level upload + AI suggestions
- `handleAutoOrganize()` / `handleApplyAutoOrganize()` (line ~314) — the "Auto-organize" button for uncategorized docs

**Fix:**
1. In `handleConfirmSuggestions()`:
   - Collect all accepted suggestions where `isNew === true`
   - Deduplicate by unit name
   - Call `teacher.createUnit(courseId, name)` for each new unit
   - Collect the returned unit IDs
   - Use those IDs when uploading documents
   - Then proceed with existing upload logic

2. In `handleApplyAutoOrganize()`:
   - Same pattern: create new units first, then move docs using the new IDs

---

## Fix 2: "From Library" Doesn't Attach Documents to Assignment (Medium Priority)

**Problem:** In the Create Assignment modal, the "From Library" option lets teachers select existing documents, but the selected file IDs are never sent to the backend. `handleCreate()` only sends AI-generated `content` and `answer_key`.

**Location:** `web/src/components/teacher/create-assignment-modal.tsx`

**Fix:**
1. **Frontend:** In `handleCreate()`, include `document_ids: Array.from(selectedFiles)` in the create assignment payload when `source === "library"`.
2. **Backend:** Update the assignment creation endpoint to accept an optional `document_ids` field. Store the association (likely a new `assignment_documents` join table or a JSON field on the assignment).
3. Backend should validate that the referenced documents belong to the same course.

---

## Fix 3: Remove "Upload Worksheet" Option from Assignment Modal (Low Priority)

**Problem:** The "Upload worksheet" option in Step 2 of the Create Assignment modal is a placeholder stub with text saying "Upload not wired yet."

**Decision:** Remove this option entirely. Teachers upload files in the Materials tab, then select them via "From Library." No need for a duplicate upload path.

**Location:** `web/src/components/teacher/create-assignment-modal.tsx`

**Fix:**
1. Remove `"upload"` from the `ContentSource` type
2. Remove the "Upload worksheet" button from Step 2's source picker
3. Remove the stub UI that shows when `source === "upload"`
4. Optionally add an empty state to "From Library" that says "No documents yet — upload in the Materials tab first"

---

## Implementation Order

1. Fix 1 (AI categorization) — this is the bug the user hit
2. Fix 3 (remove upload stub) — quick cleanup
3. Fix 2 (From Library wiring) — needs frontend + backend work
