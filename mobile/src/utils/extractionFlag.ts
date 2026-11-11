// The confirm screen's "Something looks wrong" step. A copy of the helpers
// in web/src/components/school/student/extraction-flag.ts (mobile can't
// import web) — keep the two in step.

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
