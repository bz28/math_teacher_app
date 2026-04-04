# Document-Aware Vision for Unit Suggestions + Question Generation

## Overview

Both unit suggestions and question generation currently work on text only (filenames / topic names). This plan adds vision support so Claude reads actual document images for smarter results.

## Shared Utility — `api/core/document_vision.py`

New helper module:
- `fetch_document_images(db, document_ids, course_id, max_images=5)` — validates course ownership, fetches base64 + file_type, filters to JPEG/PNG only, caps at max_images
- `build_vision_blocks(images, text_prompt)` — builds Claude vision content blocks (images first, then text)

## Feature 1: Question Generation with Document Vision

### Backend
- Add `document_ids: list[UUID] | None` to `GenerateQuestionsRequest`
- Endpoint fetches images via shared helper
- `generate_questions()` accepts optional images, switches to `call_claude_vision` when present
- Prompt updated: "read the attached material and generate questions based on it"

### Frontend
- Pass `document_ids: Array.from(selectedFiles)` in generateQuestions call
- Add `document_ids?: string[]` to API client type
- No files selected → falls back to text-only (current behavior)

## Feature 2: Unit Suggestions with Document Vision

### Backend
- Change suggest endpoint to also accept `document_ids: list[UUID] | None`
- When doc IDs provided, fetch images via shared helper
- `suggest_units()` accepts optional images, switches to `call_claude_vision` when present
- Prompt updated: "look at the document content, not just the filename"

### Frontend — Revised Upload Flow
- Top-level upload: upload files as uncategorized first, then call suggest with doc IDs, then move
- Auto-organize: backend already has doc IDs, fetches images directly

## Edge Cases
- PDFs: skip for vision (JPEG/PNG only), fall back to filename-only
- Cap at 5 images per vision call
- Vision API failure: fall back to text-only, log error
- No files selected: current behavior unchanged

## Implementation Order
1. Shared helper (`document_vision.py`)
2. Question generation with images (backend + frontend)
3. Unit suggestions with images (backend + frontend upload flow refactor)
