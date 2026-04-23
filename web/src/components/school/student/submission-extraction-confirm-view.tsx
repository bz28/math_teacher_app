"use client";

import { useMemo, useState } from "react";
import {
  schoolStudent,
  type IntegrityExtraction,
  type IntegrityExtractionFinalAnswer,
  type IntegrityExtractionStep,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { useDeviceType } from "./use-device-type";

interface Props {
  submissionId: string;
  /** Full data-URL of the submitted work, shown alongside the
   *  extraction so the student can eyeball "is that really what I
   *  wrote?". The parent guarantees this is present before routing
   *  here — if the photo fetch failed, the confirm screen is skipped
   *  and the student goes straight to chat. */
  submittedImageDataUrl: string;
  extraction: IntegrityExtraction;
  /** Student confirmed the reader got it right. Parent transitions
   *  to the chat / submitted view. */
  onContinue: () => void;
  /** Student said the reader got something wrong. We fire the flag
   *  endpoint here and hand control back to the parent, which
   *  transitions onward — the flag is a signal for the teacher, not
   *  a gate. */
  onFlagged: () => void;
}

/**
 * Post-extraction confirm screen. Renders the FULL submission's
 * extraction (all steps + per-problem final answers) grouped by
 * problem_position, side-by-side with the submitted photo.
 *
 * Replaces the old IntegrityConfirmView, which only rendered the
 * integrity-sampled slice (one problem). Now the student sees
 * everything Vision read on their page — matching the mental model
 * of "does this match my whole submission?".
 *
 * Read-only — the student can flag but not edit. Editing would let
 * them rewrite their own work to dodge follow-ups.
 */
// Soft time budget matches the chat header. Mobile typing is ~2x
// slower, so mobile students see a longer expectation.
const BUDGET_COPY: Record<"desktop" | "mobile", string> = {
  desktop: "Takes about 3 minutes.",
  mobile: "Takes about 5 minutes.",
};

type ProblemGroup = {
  /** Null = unattributed scratchwork / cross-problem setup. */
  position: number | null;
  steps: IntegrityExtractionStep[];
  finalAnswer: IntegrityExtractionFinalAnswer | null;
};

/** Bucket extraction steps by problem_position + attach each
 *  problem's final answer. Unattributed steps (position=null) land
 *  in their own "Other work" group rendered last. */
function groupByProblem(extraction: IntegrityExtraction): ProblemGroup[] {
  // Use a Map keyed by "number|null" so we can preserve insertion
  // order for same-position steps AND still split out unattributed
  // steps into their own bucket.
  const map = new Map<number | "null", ProblemGroup>();
  for (const step of extraction.steps) {
    const key = step.problem_position ?? "null";
    if (!map.has(key)) {
      map.set(key, {
        position: step.problem_position,
        steps: [],
        finalAnswer: null,
      });
    }
    map.get(key)!.steps.push(step);
  }
  for (const fa of extraction.final_answers) {
    const key = fa.problem_position;
    if (!map.has(key)) {
      // Problem had a final answer but no tagged steps — still worth
      // surfacing so the student sees the answer we read for that
      // problem.
      map.set(key, {
        position: fa.problem_position,
        steps: [],
        finalAnswer: fa,
      });
    } else {
      map.get(key)!.finalAnswer = fa;
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    // Unattributed ("Other work") always renders last.
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  });
}

/** Render a single step. Prefer LaTeX wrapped as display math so
 *  matrices and fractions render as proper blocks; fall back to the
 *  plain-English description when no LaTeX is available (e.g. a
 *  written sentence like "let x = apples"). */
function StepRow({ step }: { step: IntegrityExtractionStep }) {
  if (step.latex) {
    return (
      <div className="text-text-primary">
        <MathText text={`$$${step.latex}$$`} />
      </div>
    );
  }
  return (
    <span className="font-medium text-text-primary">{step.plain_english}</span>
  );
}

/** Render a problem's final answer row. Prefer LaTeX; fall back to
 *  plain when the student wrote prose. */
function FinalAnswerRow({ fa }: { fa: IntegrityExtractionFinalAnswer }) {
  const content = fa.answer_latex ? (
    <MathText text={`$$${fa.answer_latex}$$`} />
  ) : (
    <span>{fa.answer_plain}</span>
  );
  return (
    <div className="mt-2 rounded-[--radius-sm] border border-border-light bg-bg-subtle/50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
        Final answer
      </div>
      <div className="mt-1 text-sm text-text-primary">{content}</div>
    </div>
  );
}

export function SubmissionExtractionConfirmView({
  submissionId,
  submittedImageDataUrl,
  extraction,
  onContinue,
  onFlagged,
}: Props) {
  // Two mutually-exclusive terminal actions on the confirm screen:
  //   Continue → server stamps extraction_confirmed_at, spawns
  //              integrity + AI grading.
  //   Flag     → server stamps extraction_flagged_at, submission goes
  //              to the teacher for manual grading. No AI calls run.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const device = useDeviceType();
  const groups = useMemo(() => groupByProblem(extraction), [extraction]);

  async function handleContinue() {
    setSubmitting(true);
    setError(null);
    try {
      await schoolStudent.confirmExtraction(submissionId);
      onContinue();
    } catch {
      setError("Couldn't confirm. Try again.");
      setSubmitting(false);
    }
  }

  async function handleFlag() {
    setSubmitting(true);
    setError(null);
    try {
      await schoolStudent.flagExtractionSubmission(submissionId);
      onFlagged();
    } catch {
      setError("Couldn't save your flag. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-text-primary">
        Here&rsquo;s what we read from your work
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        Before we chat about your homework, take a quick look — does this
        match what you wrote? If anything&rsquo;s off, let us know so your
        teacher knows too.
      </p>

      {/* Upfront rules — stated once, before the chat starts. Makes
          behavioral signals meaningful by setting the expectation,
          not ambushing the student after. */}
      <div className="mt-4 rounded-[--radius-sm] border border-border-light bg-bg-subtle px-4 py-3 text-sm text-text-secondary">
        <span className="font-semibold text-text-primary">Quick check-in:</span>{" "}
        Stay in this window and answer in your own words. You don&rsquo;t need
        to look anything up. {BUDGET_COPY[device]}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Your photo
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={submittedImageDataUrl}
            alt="Your submitted homework"
            className="mt-2 max-h-[520px] w-full rounded-[--radius-md] border border-border bg-surface object-contain"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
              What we read
            </div>
            <div className="text-[10px] text-text-muted">
              Reader confidence: {Math.round((extraction.confidence ?? 0) * 100)}%
            </div>
          </div>

          {groups.length === 0 ? (
            <p className="mt-3 italic text-sm text-text-muted">
              No legible work was extracted from your photo. Flag so your
              teacher knows, or continue if this looks right.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {groups.map((g) => (
                <section
                  key={g.position ?? "other"}
                  className="rounded-[--radius-md] border border-border-light bg-background p-3"
                >
                  <h3 className="text-sm font-bold text-text-primary">
                    {g.position !== null ? `Problem ${g.position}` : "Other work"}
                  </h3>
                  {g.steps.length === 0 ? (
                    <p className="mt-1 text-xs italic text-text-muted">
                      No steps extracted for this problem.
                    </p>
                  ) : (
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-text-secondary">
                      {g.steps.map((s, i) => (
                        <li key={`${s.step_num}-${i}`}>
                          <StepRow step={s} />
                        </li>
                      ))}
                    </ol>
                  )}
                  {g.finalAnswer && <FinalAnswerRow fa={g.finalAnswer} />}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={handleFlag}
          disabled={submitting}
          className="w-full rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 sm:w-auto"
        >
          {submitting ? "Saving…" : "Reader got something wrong"}
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={submitting}
          className="w-full rounded-[--radius-sm] bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
        >
          {submitting ? "Saving…" : "Looks right — continue"}
        </button>
      </div>
    </div>
  );
}
