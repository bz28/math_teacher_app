/**
 * The submission-lifecycle vocabulary — labels, tones, and the sentence
 * that explains an empty trace.
 *
 * The stage strings come from `api.core.submission_stage`; this is the
 * console's half of that contract. Kept in one module because three
 * surfaces render the same seven words (the student funnel, the
 * submissions table, the case-file header) and a stage that reads
 * "Awaiting confirm" on one and "Not confirmed" on another is how an
 * operator stops trusting the page.
 *
 * ── The two that matter ───────────────────────────────────────────
 * `awaiting_confirm` — the read landed, the student was shown it, and
 *   they never ruled. Confirming is what spawns the integrity check and
 *   enqueues grading, so nothing downstream will ever run: the work sits
 *   handed-in and ungradeable until someone notices. This is the stage
 *   the per-student page was built to surface.
 *
 * `extraction_off` vs `awaiting_extraction` — both mean no read exists.
 *   The first is the teacher switching both AI toggles off, and its
 *   empty trace is correct. The second means a read was owed and never
 *   arrived. Same absence, opposite meanings; colouring them the same
 *   would report lost work as a feature.
 */

import type { PillTone } from "../components/StatusPill";
import type { ExtractionDetail, SubmissionStage } from "./api";

interface StageMeta {
  label: string;
  tone: PillTone;
  /** One line, shown under the label — what this stage means for the
   *  student, not what the database holds. */
  blurb: string;
}

export const STAGE_META: Record<SubmissionStage, StageMeta> = {
  published: {
    label: "PUBLISHED",
    tone: "ok",
    blurb: "graded and released to the student",
  },
  graded: {
    label: "GRADED",
    tone: "info",
    blurb: "AI grade drafted — teacher hasn't published it",
  },
  flagged: {
    label: "READER REJECTED",
    tone: "warn",
    blurb: "student said the read was wrong — needs manual grading",
  },
  confirmed: {
    label: "CONFIRMED",
    tone: "info",
    blurb: "student signed off — grading queued",
  },
  awaiting_confirm: {
    label: "AWAITING CONFIRM",
    tone: "danger",
    blurb: "read landed, student never ruled — nothing downstream will run",
  },
  awaiting_extraction: {
    label: "NO READ",
    tone: "danger",
    blurb: "a read was owed and never arrived",
  },
  extraction_off: {
    label: "AI OFF",
    tone: "neutral",
    blurb: "teacher switched both AI toggles off — no read was owed",
  },
};

/** Funnel order, furthest-along first. Mirrors the backend's
 *  STAGE_ORDER so the two never disagree about ranking. */
export const STAGE_ORDER: SubmissionStage[] = [
  "published",
  "graded",
  "flagged",
  "confirmed",
  "awaiting_confirm",
  "awaiting_extraction",
  "extraction_off",
];

/** Stages where the submission is waiting on something that may never
 *  come. `confirmed` is excluded: grading is queued durably and may be
 *  legitimately waiting for a due date. */
const STALLED = new Set<SubmissionStage>([
  "awaiting_confirm",
  "awaiting_extraction",
]);

export function isStalled(stage: SubmissionStage): boolean {
  return STALLED.has(stage);
}

/**
 * Why this submission has no logged model calls.
 *
 * An empty trace used to render as a blank timeline, which reads as
 * "nothing to see" when it is often the most interesting thing on the
 * page. There are only a few ways to get here and the stored facts
 * separate them, so say which one it is rather than leaving the
 * operator to guess.
 *
 * Returns null when there ARE calls — the timeline speaks for itself.
 */
export function noCallsDiagnosis(
  d: ExtractionDetail | null,
  callCount: number,
): { headline: string; detail: string } | null {
  if (callCount > 0) return null;
  if (!d) {
    return {
      headline: "No model calls logged for this submission.",
      detail:
        "The submission record couldn't be loaded, so there's nothing to "
        + "check the empty timeline against.",
    };
  }
  if (!d.integrity_check_enabled && !d.ai_grading_enabled) {
    return {
      headline: "No calls because the AI was switched off for this homework.",
      detail:
        "Both the integrity check and AI grading are disabled on this "
        + "assignment, so no read was ever requested. The empty timeline is "
        + "correct — this is the teacher's setting, not a failure.",
    };
  }
  if (d.files_count === 0) {
    return {
      headline: "No calls because there were no photos to read.",
      detail:
        "The submission carries no files, so extraction returned an empty "
        + "read without calling Vision.",
    };
  }
  if (!d.extraction_present) {
    return {
      headline: "A read was owed and never arrived.",
      detail:
        "AI is enabled on this homework and there are photos, but no "
        + "extraction was persisted and no call was logged — so the request "
        + "never reached the model. Extraction runs as a background task in "
        + "the web process, and a restart, an open circuit breaker, or the "
        + "daily cost cap all end it before anything is recorded.",
    };
  }
  return {
    headline: "The read landed but no call was logged against this submission.",
    detail:
      "An extraction is stored, so Vision did run — the call was recorded "
      + "without a submission id, or predates per-submission logging.",
  };
}
