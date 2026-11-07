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

/** The whole-reading flag sends the work to the teacher with no AI grade,
 *  so it carries a short note saying what's wrong — her only pointer to
 *  where to look. A couple of characters ("?", "no") isn't one. The
 *  server keeps the note optional so older app builds still flag. */
export const FLAG_NOTE_MIN = 3;

export function flagNoteReady(note: string): boolean {
  return note.trim().length >= FLAG_NOTE_MIN;
}

/** One-tap starters for the note, so a student on a phone doesn't have to
 *  type from nothing. Each is a real pointer for the teacher, and the
 *  student can add to it. */
export const FLAG_NOTE_STARTERS = [
  "Most lines are wrong",
  "It mixed up my problems",
  "Some of my work is missing",
  "My photos are hard to read",
] as const;

/** Add a starter to the note: fills an empty note, is appended to one the
 *  student already wrote, and is never added twice. */
export function withStarter(note: string, starter: string): string {
  const current = note.trim();
  if (!current) return starter;
  if (current.toLowerCase().includes(starter.toLowerCase())) return note;
  const sep = /[.!?]$/.test(current) ? " " : ". ";
  return `${current}${sep}${starter}`;
}

/** The answer we read for a problem, as short text for the "which problem
 *  looks wrong?" tiles — what a student scans to spot the misread. Plain
 *  text first (it reads without rendering); null when none was read. */
export function answerPreview(
  fa: { answer_latex?: string | null; answer_plain?: string | null } | null | undefined,
): string | null {
  if (!fa) return null;
  return (fa.answer_plain ?? "").trim() || (fa.answer_latex ?? "").trim() || null;
}
