# AI Grading Pipeline

## Flow

1. **Teacher publishes HW** with problems, answer key, and rubric (full credit criteria, partial credit criteria, common mistakes to watch for)

2. **Student submits their handwritten work** (uploads a photo of their paper)

3. **1 Vision LLM call extracts their work** — reads the handwritten image, outputs per-step LaTeX + plain English descriptions (plain English is for the integrity agent to talk naturally with the student), and extracts the student's final answer per problem

4. **2 parallel text-only LLM calls consume the extraction:**
   - **AI Grading call** — takes the extracted answers + the teacher's answer key + the teacher's rubric → outputs per-problem: score (Full/Partial/Zero), percent, the student's extracted answer, and reasoning explaining why it gave that grade. Prompt style matches existing system prompts ("You are a worldclass math professor...")
   - **Integrity agent call** — existing conversational agent that uses the extraction to quiz the student and confirm they understood and did their own work

5. **Teacher opens the review page and sees:**
   - The student's submitted handwritten image (the actual photo)
   - AI-extracted student answers per problem (rendered as LaTeX)
   - AI-suggested grades pre-filled on each problem (Full/Partial/Zero buttons lit up with an "AI" badge)
   - AI reasoning per problem (why it scored that way)
   - Integrity badge (likely/unlikely/uncertain)
   - Teacher verifies, overrides any AI grades they disagree with, then publishes all grades to students

## Details

- **Extraction is shared** — the image is read once. Both grading and integrity consume the text extraction. No duplicate Vision calls.
- **AI grading is independent from integrity** — teacher can toggle each on/off per HW (`ai_grading_enabled` + `integrity_check_enabled`). Both default to on.
- **AI grades don't block the teacher** — if the AI call fails or hasn't finished yet, teacher can still grade manually. AI grades pre-fill but never lock.
- **Teacher always has final say** — clicking any grade button overrides the AI suggestion. The "AI" badge disappears once the teacher touches a problem.
- **Storage:** AI output lands on `SubmissionGrade.ai_breakdown` (raw reasoning) and pre-fills `SubmissionGrade.breakdown` (the same field the teacher's manual grades write to). `ai_score` stores the AI's overall percent.
- **Broken image fix:** the review page currently hardcodes `image/jpeg` — will detect the actual format (PNG vs JPEG) from the base64 prefix so the student's photo actually renders.

## Implementation order

1. Enhance extraction schema — add `final_answers` per problem to the existing Vision call
2. New `grading_ai.py` — the grading LLM function + structured output schema + prompt
3. Pipeline refactor — pull extraction out as a shared step, wire parallel grading + integrity
4. Add `ai_grading_enabled` toggle to the Assignment model + HW settings UI
5. Backend: return extracted student answers in the submission detail endpoint
6. Frontend: show extracted answers, pre-filled grades with AI badge, reasoning tooltips
7. Fix broken image format detection
