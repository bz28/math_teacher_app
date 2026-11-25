import {
  teacher,
  type GradeBreakdownEntry,
  type IntegrityDisposition,
  type TeacherSubmissionRow,
} from "@/lib/api";

export type GradeStatus = GradeBreakdownEntry["score_status"];

/**
 * Grading review workspace: one HW × one section.
 *
 * Route: /school/teacher/courses/[id]/homework/[hwId]/sections/[sid]/review
 *
 * Two-pane layout — left is the full section roster (every enrolled
 * student, whether they've submitted or not), right is the selected
 * student's work. Students who haven't submitted are visible in the
 * list with a "Not submitted" marker so the teacher can spot missing
 * work at a glance.
 *
 * Grading model: per-problem Full/Partial/Zero picks auto-save on
 * every click (the backend accepts full-replacement breakdown writes).
 * The overall percent is the backend's average of the per-problem
 * percents; we show it live in the detail pane's summary card. A
 * "Next student →" button jumps to the next submitter that still
 * needs a published grade. Publishing is a one-click, HW-wide action
 * gated by a confirmation dialog (the backend publishes every graded
 * submission on the HW at once — the dialog discloses cross-section
 * scope when applicable).
 */
export type RosterEntry = {
  student_id: string;
  student_name: string;
  student_email: string;
  /** Present if the student has submitted; null if they haven't. */
  submission: TeacherSubmissionRow | null;
  /** Their personal due date, when the teacher reopened it for them. */
  personal_due_at: string | null;
};

export type RosterFilter = "all" | "needs_me" | "flagged" | "low_confidence";

// A teacher's ✓ / ✗ on a graph checklist item, and what the server
// sends back once it has re-scored the problem.
export type GraphCall = { problemId: string; n: number; verdict: "yes" | "no" };

export type GraphCallResult = Awaited<ReturnType<typeof teacher.setGraphItemVerdict>>;

/** Why the AI left a submission for the teacher to grade by hand: the
 *  photo couldn't be read, or the homework was too long to grade in one
 *  pass. Null once a grade exists. Reads the stamped disposition AND the
 *  row's `ai_grade_block`, since the grading poll refreshes the row but
 *  not the open detail pane. */
export type AiSkip = "unreadable" | "too_long";

// ────────────────────────────────────────────────────────────────────
// One row of student work in the review panel. Renders the canonical
// (edited if the student corrected it on the confirm screen, else
// original Vision) text, plus an expandable disclosure exposing the
// original Vision read whenever the student edited the row. The
// teacher's daily flow stays clean — the badge is a quiet signal,
// not a diff — but verification against the original is one tap away.
// ────────────────────────────────────────────────────────────────────

// Anchor highlight for a student-work step that a receipt deduction
// points at — a color-matched tint + numbered badge so the eye links the
// "−20% sign error" ledger line to the exact step it happened on. Two
// tones (amber / info) cycle across a problem's deductions so multiple
// anchors stay visually distinct, matching the receipt's badge colors.
export type StepAnchor = { tone: "amber" | "info" };

// Visual treatment for each disposition. Paired with both an icon
// and explicit copy so color-only signal is never the whole story
// (colorblind-safe by design).
// Icon badge color (`iconBg`) carries the disposition valence in a
// solid, high-contrast form. The surrounding card stays on a light
// tint (`bg`) as soft context, but the TITLE lives in neutral
// `text-text-primary` so it's always unambiguously readable — we
// learned from two prior passes that light colored text on tinted
// bg reads as washed-out regardless of contrast math.
export type IntegrityBannerKey =
  | IntegrityDisposition
  | "unfinished"
  | "extracting"
  | "awaiting_student"
  | "in_progress"
  | "skipped_unreadable"
  | "needs_review";
