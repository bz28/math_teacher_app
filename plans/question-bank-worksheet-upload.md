# Question Bank: Worksheet Upload

## Goal
Teachers can upload photos of existing worksheets (problem sets) and have them extracted into individual question bank items via Claude Vision, entering the existing review flow as pending items.

## How It Differs from "Generate"
- **Generate**: Teacher provides a topic + count → AI *invents* new questions
- **Upload**: Teacher provides worksheet images → AI *extracts* existing questions from the images

The downstream pipeline (solve each problem, generate distractors, persist as pending bank items) is identical.

## Backend Changes

### 1. Migration: add `mode` and `uploaded_images` to `question_bank_generation_jobs`
- `mode` String(20), default `"generate"` — values: `"generate"` | `"upload"`
- `uploaded_images` JSON, nullable — stores `[{data: base64, media_type: str}]` for worksheet uploads (images aren't Documents — they're transient extraction inputs, not course materials)

Why not store as Documents? Worksheets uploaded for extraction aren't course materials the teacher wants in their Materials tab. They're one-time inputs to the extraction pipeline. Storing them as Documents would clutter the materials view and conflate two different concepts.

### 2. New endpoint: `POST /courses/{course_id}/question-bank/upload`
Request body:
```python
class UploadWorksheetRequest(BaseModel):
    images: list[str]  # base64 encoded, 1-10 images
    unit_id: UUID | None = None
```

Flow:
1. Validate teacher owns course, unit exists + is top-level
2. Validate each image (reuse `validate_and_decode_image` from `image_utils.py`)
3. Create `GenerationJob(mode="upload", uploaded_images=[...], requested_count=0)`
4. Fire-and-forget `schedule_generation_job(job.id)`
5. Return 202 with serialized job

### 3. Branch in `_execute()` based on `job.mode`
When `mode == "upload"`:
1. Load images from `job.uploaded_images`
2. Call Vision with all images + a new extraction prompt that returns `[{title, text, difficulty}]` (reuse `GENERATE_QUESTIONS_SCHEMA` — same output shape as generate)
3. Set `job.requested_count` to the number of extracted problems
4. Continue to existing `generate_solutions()` + `generate_distractors()` + persist steps

The extraction prompt is distinct from the student-facing `image_extract.py` prompt: it asks for titles, difficulty ratings, and uses the same output schema as generate.

### 4. New LLM mode: `BANK_EXTRACT`
Added to `LLMMode` for logging/tracking.

## Frontend Changes

### 5. API client method
```ts
teacher.uploadWorksheet(courseId, { images: string[], unit_id?: string }) → BankJob
```

### 6. Upload button in question-bank-tab header
Add "Upload Worksheet" button next to existing "Generate Questions" button. Opens `UploadWorksheetModal`.

### 7. `UploadWorksheetModal` component
- Drop zone for images (1-10, JPEG/PNG only)
- Image preview thumbnails with remove buttons
- Unit picker (same pattern as generate modal — top-level units + Uncategorized)
- Submit button → calls API → returns job → closes modal, parent starts polling

## Commit Plan
1. **Backend: migration + model** — add `mode` and `uploaded_images` columns (~40 lines)
2. **Backend: extraction logic + endpoint** — new prompt, branch in `_execute`, new route (~120 lines)
3. **Frontend: API + modal + tab wiring** — upload modal component, API method, tab integration (~170 lines)

## Edge Cases
- Empty extraction (AI finds no problems): job fails with descriptive error message
- Low-confidence extraction: handled by the review flow — teacher approves/rejects each item
- Duplicate problems across pages: not deduped — teacher handles this in review (same as generated duplicates)
- PDFs: rejected at validation — JPEG/PNG only (Claude Vision limitation)
- Images > 10: rejected by validation
