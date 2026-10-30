/**
 * Pure helpers for the confirm screen's "Something looks wrong" step.
 * Kept out of the component so they can be unit-tested on plain Node.
 */

/** Server cap on the flag note (`_MAX_FLAG_NOTE_LEN` in
 *  api/routes/school_student_practice.py). The textarea's maxLength. */
export const FLAG_NOTE_MAX = 500;

/** Structural subset of `IntegrityExtraction` — only what this reads. */
interface ExtractionLines {
  steps: { problem_position: number | null }[];
  final_answers: {
    problem_position: number | null;
    answer_latex?: string | null;
    answer_plain?: string | null;
  }[];
}

/** True when the student has at least one line they can fix themselves.
 *  Mirrors the confirm view's own rules: a line is editable only when it
 *  has a problem position to key the edit by, and an empty final answer
 *  isn't rendered at all. With nothing editable, "Just a few lines" would
 *  lead nowhere, so the step goes straight to sending it to the teacher. */
export function hasEditableLines(extraction: ExtractionLines): boolean {
  if (extraction.steps.some((s) => s.problem_position !== null)) return true;
  return extraction.final_answers.some(
    (fa) =>
      fa.problem_position !== null &&
      !!((fa.answer_latex ?? "").trim() || (fa.answer_plain ?? "").trim()),
  );
}
