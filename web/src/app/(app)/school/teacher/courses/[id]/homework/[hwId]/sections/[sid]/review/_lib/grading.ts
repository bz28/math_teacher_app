import { isFlaggedSubmission } from "@/components/school/teacher/roster-flagged";
import type {
  AiGradeBlock,
  AiGradeEntry,
  GradeBreakdownEntry,
  TeacherGraphCheck,
  TeacherSubmissionDrawing,
  TeacherSubmissionRow,
} from "@/lib/api";
import type { RosterEntry, RosterFilter, AiSkip } from "./types";
import { needsTeacher } from "./next-student";

// AI grader confidence bands. The pipeline reports a calibrated 0-1
// score per problem; we read it, never compute it. <0.6 is the
// long-standing "alarm" threshold (amber low-confidence emphasis);
// 0.6-0.85 is medium; >=0.85 is high. Surfacing all three — instead of
// only the alarm — lets a teacher triage toward the calls the model was
// least sure of, the safety rail a future bulk-accept feature needs.
export const CONFIDENCE_LOW = 0.6;

const CONFIDENCE_HIGH = 0.85;

// Shared empty set for the "this state belongs to a different submission"
// derivation — avoids allocating a new Set on every render while a
// student's confirm/expand selections are scoped to their submission id.
export const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

export function confidenceBand(c: number): "high" | "medium" | "low" {
  if (c >= CONFIDENCE_HIGH) return "high";
  if (c >= CONFIDENCE_LOW) return "medium";
  return "low";
}

// A problem the AI is confident about — high band (>=0.85) on a present
// AI grade. These COLLAPSE to a one-line confirm row in the triage detail
// pane; everything else (medium / low / no AI grade) stays fully
// expanded. A teacher override re-expands the row (handled at the call
// site via the override check) so the teacher is never editing inside a
// collapsed summary.
export function isConfidentAi(ai: AiGradeEntry | null): boolean {
  return ai !== null && ai.confidence !== null && ai.confidence >= CONFIDENCE_HIGH;
}

// The grading key that re-affirms the AI's suggestion in place. Quarter
// scale: 1=full, 5=zero, partial→nearest quarter key (2=75, 3=50, 4=25).
// Pressing this key on a collapsed confident row CONFIRMS it; pressing
// any other grade key is an override that expands + re-grades.
export function aiConfirmKey(ai: AiGradeEntry | null): "1" | "2" | "3" | "4" | "5" | null {
  if (!ai) return null;
  if (ai.score_status === "full") return "1";
  if (ai.score_status === "zero") return "5";
  if (ai.percent >= 62.5) return "2";
  if (ai.percent >= 37.5) return "3";
  return "4";
}

// Has the teacher moved a problem off the AI's call? Compares the live
// grade entry to the AI suggestion (status, and percent for partials).
// Used both to draw the "revert" breadcrumb and to force a confident
// row back open — a teacher mid-edit must never be editing inside a
// collapsed one-liner.
export function teacherOverrodeAi(
  entry: GradeBreakdownEntry | null,
  ai: AiGradeEntry | null,
): boolean {
  if (!ai || !entry) return false;
  if (entry.score_status !== ai.score_status) return true;
  return (
    entry.score_status === "partial" &&
    Math.round(entry.percent) !== Math.round(ai.percent)
  );
}

// The AI's call on a graph problem, with the teacher's ✗ on items the
// drawing check left unclear taken off — the grade the AI's check and
// her calls make together. Measuring "did she override the AI" against
// this keeps a ✗ from reading as an override (and "revert" from undoing
// it); ✓ changes nothing, since an unclear item already kept its points.
// Her calls count even once she re-scores the problem by hand, so
// "revert" goes back to the AI's call with them, not without.
export function withGraphCalls(
  ai: AiGradeEntry | null,
  graph: TeacherGraphCheck | null | undefined,
): AiGradeEntry | null {
  if (!ai || !graph || graph.points <= 0) return ai;
  const off = graph.items
    .filter((i) => i.verdict === "unclear" && i.teacher === "no")
    .reduce((sum, i) => sum + (i.points * 100) / graph.points, 0);
  if (off === 0) return ai;
  const percent = Math.min(Math.max(ai.percent - off, 0), 100);
  const score_status = percent >= 100 ? "full" : percent <= 0 ? "zero" : "partial";
  return { ...ai, percent, score_status };
}

// ────────────────────────────────────────────────────────────────────
// Roster filter — narrows the left pane to "anything that needs me"
// or "only the flagged ones". Default "all" keeps the section view.
// `needs_me` is the scan-mode for grading mode: hides students whose
// submissions are already published-and-clean. `flagged` is the
// scan-mode for the integrity check, hiding everything that isn't
// a verdict requiring teacher attention.
// ────────────────────────────────────────────────────────────────────

export function isFlagged(entry: RosterEntry): boolean {
  return !!entry.submission && isFlaggedSubmission(entry.submission);
}


// Pure read-only predicate over already-loaded roster data: true when
// any problem on the submission carries an AI grade the model flagged
// as low confidence. `breakdown` preserves the AI's per-problem
// confidence (a teacher click never rewrites it — see setProblemGrade),
// so this needs no extra fetch. Historical rows without a confidence
// value contribute nothing, matching the always-on signal's neutral
// treatment of null.
/** Turned in, no grade yet, and a grade is genuinely still coming.
 *
 *  Deliberately NOT just `final_score === null`. An unreadable
 *  submission also has no score, but the confirm path records the skip
 *  and never enqueues it (`school_student_practice`), so no grade is on
 *  its way and no `grading_jobs` row exists. Counting it as awaiting
 *  made "Grade N ungraded" a permanent no-op — it moved zero jobs,
 *  refetched to the identical state, and never disappeared. Its own
 *  status pill already says "Couldn't read · grade manually"; the
 *  grouping has to agree with the pill. */
export function isAwaitingGrade(entry: RosterEntry): boolean {
  const sub = entry.submission;
  if (!sub) return false;
  if (sub.final_score !== null) return false;
  return (
    sub.ai_grading_status !== "skipped_unreadable" &&
    sub.ai_grading_status !== "skipped_too_long"
  );
}

export function aiSkipReason(
  aiGradingStatus: string | null,
  block: AiGradeBlock | null | undefined,
  finalScore: number | null,
): AiSkip | null {
  if (finalScore !== null) return null;
  if (aiGradingStatus === "skipped_unreadable" || block === "unreadable") {
    return "unreadable";
  }
  if (aiGradingStatus === "skipped_too_long" || block === "too_long") {
    return "too_long";
  }
  return null;
}

export const AI_SKIP_COPY: Record<AiSkip, { status: string; title: string; body: string }> = {
  unreadable: {
    status: "Couldn't read · grade manually",
    title: "Couldn’t read this submission",
    body:
      "The work was too unclear to read, so nothing was auto-graded. Open " +
      "the pages and grade it by hand — the grading controls work the " +
      "same, there’s just no AI suggestion to start from.",
  },
  too_long: {
    status: "Too long for AI · grade by hand",
    title: "Too long for the AI to grade",
    body:
      "This submission is too long for the AI to grade in one pass, so " +
      "nothing was auto-graded. Please grade it by hand — the grading " +
      "controls work the same, there’s just no AI suggestion to start from.",
  },
};

/** "Full" / "No credit" / "Partial 70%" — how a grade reads on a
 *  report chip. */
export function chipGradeLabel(status: string, percent: number | null | undefined): string {
  if (status === "full") return "Full";
  if (status === "zero") return "No credit";
  return `Partial ${Math.round(percent ?? 0)}%`;
}

/** The server says the AI grader can take this submission: never
 *  graded in any form, readable work the student has confirmed (not
 *  flagged as misread), AI grading on. */
export function canAiGrade(sub: TeacherSubmissionRow): boolean {
  return sub.ai_grade_block === null;
}

/** A grade is on its way: sent from this page and not yet landed, or a
 *  drain is working on it right now. */
export function isAiGrading(
  sub: TeacherSubmissionRow,
  pending: ReadonlySet<string>,
): boolean {
  if (sub.final_score !== null) return false;
  return pending.has(sub.id) || sub.grading_job_status === "running";
}

// One grade usually lands in 10–40s; a class takes longer because the
// queue grades the first submission alone to warm the shared prompt
// cache. Past the timeout the page stops watching and shows the
// server's state as-is — a still-queued row offers the button again.
// Each poll reads the whole homework's roster (there is no lighter
// endpoint), so it backs off: quick while a single grade is likely to
// land, slower once it's clearly a class-sized batch.
export const AI_GRADE_POLL_TIMEOUT_MS = 4 * 60 * 1000;

// Whether a poll's fresh read of a row says anything the page doesn't
// already have. Whole-row comparison on purpose: a list of "the fields
// that matter" is a list someone forgets to extend.
export function sameRow(a: TeacherSubmissionRow, b: TeacherSubmissionRow): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function aiGradePollDelay(elapsedMs: number): number {
  if (elapsedMs < 20_000) return 3000;
  if (elapsedMs < 60_000) return 5000;
  return 10_000;
}

/** A graph item the drawing check couldn't decide, waiting on her. */
export function hasGraphToCheck(entry: RosterEntry): boolean {
  return (entry.submission?.graph_items_open ?? 0) > 0;
}

export function hasLowConfidence(entry: RosterEntry): boolean {
  const breakdown = entry.submission?.breakdown;
  if (!breakdown) return false;
  return breakdown.some(
    (b) => b.confidence !== null && b.confidence < CONFIDENCE_LOW,
  );
}

/** Her students, without her own rehearsal. See the two-populations
 *  note in HomeworkSectionReview: class counts use this, action counts
 *  use the full roster. */
export function classOnly(entries: RosterEntry[]): RosterEntry[] {
  return entries.filter((e) => !e.submission?.is_preview);
}

export function applyRosterFilter(
  roster: RosterEntry[],
  filter: RosterFilter,
): RosterEntry[] {
  if (filter === "all") return roster;
  // Same population the chips count — see RosterFilterBar.
  if (filter === "needs_me") return classOnly(roster).filter(needsTeacher);
  if (filter === "low_confidence")
    return classOnly(roster).filter(hasLowConfidence);
  return classOnly(roster).filter(isFlagged);
}

export function rowStatusLabel(
  entry: RosterEntry,
  aiGrading: false | "watched" | "unwatched" = false,
): {
  text: string;
  dotClass: string;
} {
  const sub = entry.submission;
  if (!sub) {
    return { text: "Not submitted", dotClass: "bg-gray-300" };
  }
  // Sent to the AI grader, grade not back yet. Above the flagged branch
  // on purpose: the teacher chose to AI-grade a flagged submission, and
  // "Reader misread" would read as though her click did nothing.
  if (aiGrading === "unwatched") {
    return {
      text: "Still grading · refresh to check",
      dotClass: "bg-primary",
    };
  }
  if (aiGrading) {
    return {
      text: "AI grading…",
      dotClass: "animate-pulse bg-primary",
    };
  }
  // Student said "the reader got my work wrong" on the confirm screen —
  // the submission skipped AI grading + integrity entirely and needs a
  // manual pass. Surface it loudly (red) until the teacher publishes a
  // clean grade, at which point the published branch below takes over.
  if (
    sub.extraction_flagged_at &&
    !(sub.grade_published_at && !sub.grade_dirty)
  ) {
    return {
      text: "Reader misread · review",
      dotClass: "bg-[color:var(--color-error)]",
    };
  }
  // A graph item the check couldn't decide holds up Approve — say so
  // before any graded/published state reads as finished.
  if (hasGraphToCheck(entry) && !sub.reviewed_at) {
    const n = sub.graph_items_open ?? 0;
    return {
      text: `${n === 1 ? "1 graph item" : `${n} graph items`} to check`,
      dotClass: "bg-[color:var(--color-warning)]",
    };
  }
  // The AI skipped it (unreadable photo, or too long to grade in one
  // pass) and never produced a grade — call it out distinctly so the
  // teacher knows this row needs a manual pass, not just an unopened
  // suggestion. Warning dot, reusing the same amber token the dirty/
  // ungraded states use. Once a grade exists the skip reads null and the
  // published / graded branches below take over.
  const skip = aiSkipReason(sub.ai_grading_status, sub.ai_grade_block, sub.final_score);
  if (skip) {
    return {
      text: AI_SKIP_COPY[skip].status,
      dotClass: "bg-[color:var(--color-warning)]",
    };
  }
  if (sub.grade_published_at) {
    if (sub.grade_dirty) {
      return { text: "Edited · not yet sent", dotClass: "bg-[color:var(--color-warning)]" };
    }
    return { text: "Published", dotClass: "bg-green-500" };
  }
  if (sub.final_score !== null) {
    return { text: "Graded, not published", dotClass: "bg-[color:var(--color-warning)]" };
  }
  if (sub.ai_grade_block === "awaiting_confirmation") {
    return { text: "Waiting for student to confirm", dotClass: "bg-gray-300" };
  }
  if (sub.ai_grade_block === "extracting") {
    return { text: "Reading work…", dotClass: "animate-pulse bg-gray-400" };
  }
  if (sub.ai_grade_block === "no_extraction") {
    return { text: "Work not read yet", dotClass: "bg-gray-400" };
  }
  return { text: "Needs review", dotClass: "bg-gray-400" };
}

// Per-student approval marker for the roster, so the teacher sees review
// progress at a glance. `reviewed_at` means she stands behind the grade:
// the explicit Approve on an AI grade, or a hand grade (no AI score) with
// every problem scored — the server stamps that itself, since there's no
// AI number to vouch for. So an unstamped hand grade can only mean some
// problems are still unscored, and the marker says that rather than
// "Not reviewed", which would send her looking for an Approve button
// that isn't there. Returns null when there's nothing to approve yet (no
// grade — ungraded / skipped-unreadable, where the status label already
// tells the story).
export function reviewMarker(
  sub: TeacherSubmissionRow,
): { text: string; tone: "reviewed" | "unreviewed" } | null {
  if (sub.final_score === null) return null;
  if (sub.reviewed_at) return { text: "Approved", tone: "reviewed" };
  if (sub.ai_score === null) return { text: "Partly graded", tone: "unreviewed" };
  return { text: "Not reviewed", tone: "unreviewed" };
}

// ────────────────────────────────────────────────────────────────────
// Submission detail — right pane. The student's submitted pages
// (images + PDFs) are the source of truth; typed answers sit
// alongside the answer key so the teacher can compare without
// switching contexts. Per-problem Full/Partial/Zero picks auto-save
// on click.
// ────────────────────────────────────────────────────────────────────

/** "1 day late" / "3 days late". */
export function lateLabel(days: number): string {
  if (days <= 0) return "late";
  return `${days} ${days === 1 ? "day" : "days"} late`;
}

/** A percent for the penalty line: whole numbers as-is, else one
 *  decimal — 10% off 85% is 76.5%, and rounding it would hide the cut. */
export function formatPercent(value: number): string {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// The reader writes the units a question asks for into the answer even
// when the student wrote none ("15.76" read as "15.76 ft"). A unit that
// appears nowhere in the work is pointed out so the teacher checks the
// photo before crediting it.
export function unitsNotInWorkNote(units: string[]): string {
  const named = units.map((u) => `“${u}”`);
  const list = named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named[0];
  return `${list} ${units.length > 1 ? "aren’t" : "isn’t"} written anywhere in the student’s work — check the photo.`;
}

// "Table" for a proof's Statements/Reasons grid, "Graph" for a graph —
// naming what was recorded keeps a quiet line from overclaiming.
export function recordedLabel(drawn: TeacherSubmissionDrawing[]): string {
  const kinds = [...new Set(drawn.map((d) => d.kind.replace("_", " ")))];
  if (kinds.length !== 1 || kinds[0] === "other") return "Drawing";
  return kinds[0].charAt(0).toUpperCase() + kinds[0].slice(1);
}

// The page marker's label. "p. 3" for one page, "p. 3-5" for work that
// runs across a break, and an explicit list when the set has gaps —
// a student who flipped back leaves pages 1 and 4, and rendering that as
// "p. 1-4" would claim work on 2 and 3 that isn't there.
// Null when the extraction didn't tag a page, so the row shows no marker
// rather than a guess: a wrong page number costs the teacher more than
// no page number does.
export function pageLabelFor(pages: number[]): string | null {
  if (pages.length === 0) return null;
  const first = pages[0]!;
  const last = pages[pages.length - 1]!;
  if (first === last) return `p. ${first}`;
  const contiguous = last - first + 1 === pages.length;
  return contiguous ? `p. ${first}-${last}` : `p. ${pages.join(", ")}`;
}
