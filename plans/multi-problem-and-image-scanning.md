# Multi-Problem Input & Image Scanning

## Overview
Add support for inputting multiple math problems per session (both learn and practice modes), then layer on camera/gallery image scanning to extract problems from photos of worksheets, textbooks, etc.

**Two phases, shipped as separate PRs:**
- **Phase 1:** Multi-problem input UI + practice queue logic
- **Phase 2:** Image scanning (camera + gallery → Claude Vision OCR)

---

## Phase 1: Multi-Problem Input & Practice Queue

### 1.1 Input Screen UI Changes (`App.tsx`)

**New state:**
```ts
const [problemQueue, setProblemQueue] = useState<string[]>([]);
```

**Input field changes:**
- Add `[+]` button inside the TextInput (right-aligned, icon `add-circle-outline`)
- `[+]` is disabled when input is empty, disables at 10 problems (cap)
- Pressing `[+]`: appends `input.trim()` to `problemQueue`, clears input, refocuses input
- Haptic feedback on add (`expo-haptics` — already installed)

**Problem list (below math keyboard, above Start button):**
- Vertical numbered list of queued problems
- Each row: `{index + 1}. {problem text}` + `[✕]` remove button
- Tap problem text → removes from queue and loads back into input (edit flow)
- Subtle entry animation (fade + slide up) for delight
- Show "10 max" hint when queue reaches 10

**Start button changes:**
- 0 problems in queue + text in input → same as today ("Go")
- 1+ problems in queue → "Start Learning (N)" or "Start Practice (N)"
- If text is in input when Start pressed → auto-add to queue first, then start

**Practice stepper visibility:**
- Show "Similar problems to generate" stepper only when queue has 0 problems
- When queue has 1+ problems → hide stepper entirely

### 1.2 Store: New `startPracticeQueue` Action (`stores/session.ts`)

**New action:**
```ts
startPracticeQueue: async (problems: string[]) => Promise<void>
```

**Logic:**
- For each problem, call `generatePracticeProblems(problem, 0)` to solve it and get the answer (same pattern as `practiceFlaggedFromLearnQueue`)
- Build a flat `PracticeProblem[]` array: `{ question, answer }` for each
- Set `practiceBatch` with these problems, `loadingMore: false`
- No similar problem generation — just the user's problems as-is

**Progressive loading (same pattern as existing batch):**
- Solve first problem immediately, set phase to `awaiting_input`
- Solve remaining in background via `Promise.all`, append as they resolve
- This reuses the existing `loadingMore` / polling pattern

### 1.3 Update `handleGo` in `App.tsx`

```ts
const handleGo = async () => {
  // Collect all problems: queue + any text in input
  const allProblems = [...problemQueue];
  const text = input.trim();
  if (text) allProblems.push(text);
  if (allProblems.length === 0) return;

  setError(null);

  if (allProblems.length === 1) {
    // Single problem — existing behavior
    if (mode === "practice") {
      await startPracticeBatch(allProblems[0], practiceCount);
    } else {
      await startSession(allProblems[0], mode);
    }
  } else {
    // Multi-problem
    if (mode === "practice") {
      await startPracticeQueue(allProblems);
    } else {
      await startLearnQueue(allProblems);
    }
  }

  const { phase } = useSessionStore.getState();
  if (phase !== "error") {
    setProblemQueue([]);
    setScreen("session");
  }
};
```

### 1.4 Remove `learnSimilarProblem`

**Why:** In learn mode, "learn a similar problem" is redundant — that's what practice mode is for. The existing "Try a practice problem" button already covers this.

**Changes:**
- `stores/session.ts`: Remove `learnSimilarProblem` action and its interface entry
- `SessionScreen.tsx`: Remove "Learn Similar Problem" button from learn completion view (lines ~443) and learn queue completion view (lines ~450)
- Keep "Try a practice problem" (`tryPracticeProblem`) — that's the correct post-learn action
- Keep `advanceLearnQueue` — still needed for multi-problem learn flow

### 1.5 Session Screen: Disable Similar in Multi-Problem Practice

In SessionScreen.tsx, when practice batch mode is active and the batch came from a multi-problem queue (not generated similar problems), hide/disable any "try similar" prompts on the summary screen.

**Detection:** Add a `isUserQueue: boolean` flag to `PracticeBatch` interface. Set `true` when started via `startPracticeQueue`, `false` when started via `startPracticeBatch`.

**PracticeSummary.tsx changes:**
- When `isUserQueue`, the "Retry Flagged" button still works (retries those exact problems)
- "Learn Flagged" still works (sends flagged to learn queue)
- No "generate more similar" option

### 1.6 Reset Problem Queue on Navigation

When user navigates back from input screen to mode select, clear the `problemQueue` state so it doesn't persist across mode switches.

---

## Phase 1 Commits (estimated)

| # | Commit | ~Lines | Description |
|---|--------|--------|-------------|
| 1 | `feat: add problem queue state and [+] button to input screen` | ~80 | New state, add button in input, problem list rendering |
| 2 | `feat: add startPracticeQueue action to session store` | ~60 | New store action for multi-problem practice with progressive loading |
| 3 | `feat: wire multi-problem handleGo and dynamic start button` | ~50 | Updated handleGo logic, button text, stepper visibility |
| 4 | `refactor: remove learnSimilarProblem and add isUserQueue flag` | ~80 | Clean up learn similar, add queue detection for practice summary |
| 5 | `feat: add edit-on-tap and entry animations to problem list` | ~60 | Polish: tap to edit, fade+slide animations, haptics |

---

## Phase 2: Image Scanning (Camera + Gallery)

### 2.1 Install Dependencies (Mobile)

```bash
npx expo install expo-image-picker
```

No need for `expo-camera` — `expo-image-picker` handles both camera capture and gallery selection with a simpler API and fewer permissions.

### 2.2 Backend: Image Extract Endpoint

**New file:** `api/routes/image.py`

**Endpoint:** `POST /v1/image/extract`

**Request schema:**
```python
class ImageExtractRequest(BaseModel):
    image_base64: str  # base64-encoded image (JPEG/PNG)
    extract_multiple: bool = True  # try to find multiple problems
```

**Response schema:**
```python
class ImageExtractResponse(BaseModel):
    problems: list[str]  # extracted problem texts
    confidence: str  # "high" | "medium" | "low"
```

**Logic:**
- Receive base64 image
- Validate size (reject > 5MB after decode)
- Call Claude Vision (Sonnet) with the image + prompt:
  ```
  Extract all math problems from this image. Return each problem as a
  separate item. Output JSON: {"problems": ["problem 1", "problem 2", ...]}
  If you cannot read the image clearly, return fewer problems with only
  the ones you're confident about.
  ```
- Parse response, return problem list
- Use AsyncAnthropic with `messages` API, image as `base64` source type
- Add cost tracking (same pattern as tutor.py)
- Add to router in `main.py`

### 2.3 Mobile: API Service

**Add to `api.ts`:**
```ts
export async function extractProblemsFromImage(
  base64Image: string,
): Promise<{ problems: string[]; confidence: string }> {
  return request("/image/extract", {
    method: "POST",
    body: JSON.stringify({
      image_base64: base64Image,
      extract_multiple: true,
    }),
  });
}
```

### 2.4 Mobile: Image Capture UI

**Input screen changes (`App.tsx`):**

Add a camera/gallery button row between the input field and math keyboard:

```
  ┌─────────────────────────────[+]─┐
  │ e.g. 2x + 6 = 12               │
  └─────────────────────────────────┘

  [Camera]  [Gallery]      ← new row

  [÷] [×] [+] [-] [^] ...
```

- Two icon buttons: `camera-outline` and `image-outline`
- On press → `expo-image-picker` (camera or gallery respectively)
- Image captured → compress to 1024px max dimension, quality 0.7
- Convert to base64 → call `extractProblemsFromImage()`
- Show loading state while extracting

### 2.5 Mobile: Extraction Confirmation Modal

After Claude returns extracted problems, show a confirmation modal:

```
┌─────────────────────────────────┐
│                                 │
│    Found 3 problems             │
│                                 │
│  ┌────────────────────────────┐ │
│  │ ☑ 2x + 6 = 12             │ │
│  │ ☑ x² - 4 = 0              │ │
│  │ ☑ 3(x + 2) = 15           │ │
│  └────────────────────────────┘ │
│                                 │
│  Tap to edit · Uncheck to skip  │
│                                 │
│  [ Add Selected ]  [ Cancel ]   │
│                                 │
└─────────────────────────────────┘
```

- Each problem is editable (tap → inline edit)
- Checkbox to include/exclude individual problems
- "Add Selected" → adds checked problems to `problemQueue`
- Respects 10-problem cap (disable unchecked problems beyond limit)
- If only 1 problem extracted → skip modal, add directly to input field for quick edit

### 2.6 Image Preprocessing (Mobile-Side)

Before sending to backend:
- Resize: max 1024px on longest dimension (keeps base64 payload ~200-500KB)
- Quality: 0.7 JPEG compression
- Strip EXIF metadata (expo-image-picker does this by default)
- This keeps the request well under the 10MB server limit

### 2.7 Error & Edge Cases

- **No problems found:** Show toast "Couldn't find any math problems. Try a clearer photo."
- **Low confidence:** Show warning banner on confirmation modal
- **Camera permission denied:** Show settings prompt
- **Network error during extraction:** Show retry button
- **Large images:** Client-side resize handles this before upload

---

## Phase 2 Commits (estimated)

| # | Commit | ~Lines | Description |
|---|--------|--------|-------------|
| 1 | `feat: add image extract endpoint with Claude Vision` | ~120 | Backend route, Claude Vision call, schemas, router registration |
| 2 | `feat: add expo-image-picker and extractProblemsFromImage API call` | ~40 | Install dep, add API service function |
| 3 | `feat: add camera/gallery buttons to input screen` | ~80 | UI buttons, image picker integration, loading state |
| 4 | `feat: add extraction confirmation modal` | ~150 | Modal with editable problems, checkboxes, add to queue |
| 5 | `feat: add error handling and edge cases for image extraction` | ~60 | Permission handling, error toasts, retry logic |

---

## Out of Scope (for now)
- Handwriting recognition optimization (Claude Vision handles it reasonably well already)
- Batch scanning multiple pages
- Progress persistence / resume across app restarts
- Offline image queuing
- Image history / re-scan

## Dependencies
- `expo-image-picker` (Phase 2 only)
- No new backend dependencies — Claude Vision is part of the existing `anthropic` SDK

## Risk / Open Questions
- Claude Vision latency: expect 2-4 seconds per image extraction. The confirmation modal provides a natural buffer — user reviews while waiting feels fast.
- Cost: ~$0.01-0.03 per image (Sonnet vision). At scale, could downgrade to Haiku for simple printed text if needed.
