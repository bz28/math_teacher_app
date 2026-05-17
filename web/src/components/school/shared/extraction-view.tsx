"use client";

import type { IntegrityExtraction } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

/**
 * Renders what Vision read from a student's handwritten work.
 *
 * Two orthogonal axes:
 *
 *   `variant` controls *sizing* only:
 *     - "full"    — student's confirm screen, larger padding & text.
 *     - "compact" — teacher's tiny in-card version, the chat reference
 *                   column, and other small surfaces.
 *
 *   `showProse` controls *content*:
 *     - true  → prose description + LaTeX (the teacher's "interpretation
 *               + transcription" view, useful context for grading).
 *     - false → literal LaTeX only, with plain_english only as a
 *               fallback when no LaTeX (e.g. a written sentence).
 *               This is the right view for any *student-facing* surface
 *               — the question is "did we read your page right?", not
 *               "do you agree with our description of what you did?".
 *
 * Defaults preserve the original semantics (student confirm = literal,
 * teacher card = prose+LaTeX) so existing callers don't change.
 *
 * Same source data (`student_work_extraction` JSON). Keep this
 * presentational — no data fetching, no actions.
 */
export function ExtractionView({
  extraction,
  variant = "compact",
  showProse,
}: {
  extraction: IntegrityExtraction;
  /** Sizing only — see component doc. */
  variant?: "compact" | "full";
  /** Content control — see component doc. Defaults to false on
   *  variant="full" (student confirm) and true on variant="compact"
   *  (teacher card), matching the original behavior. Pass explicitly
   *  to mix size and content (e.g. compact + literal for the chat's
   *  student-facing reference column). */
  showProse?: boolean;
}) {
  const isFull = variant === "full";
  const renderProse = showProse ?? !isFull;
  const hasSteps = extraction.steps.length > 0;
  const hasFinals = extraction.final_answers.length > 0;
  return (
    <div
      className={cn(
        "rounded-[--radius-sm] bg-background",
        isFull ? "p-4" : "mt-2 p-2",
      )}
    >
      {!hasSteps && !hasFinals && (
        <p
          className={cn(
            "italic text-text-muted",
            isFull ? "mt-2 text-sm" : "mt-1 text-xs",
          )}
        >
          No legible work was extracted.
        </p>
      )}
      {hasSteps && (
        <ol
          className={cn(
            "list-decimal space-y-1 pl-5 text-text-secondary",
            isFull ? "mt-2 text-sm" : "mt-1 text-xs",
          )}
        >
          {extraction.steps.map((s, i) => (
            <li key={`${s.step_num}-${i}`}>
              {renderProse ? (
                // Prose + LaTeX. The narrative description carries the
                // AI's interpretation of what the student did, which
                // is useful context when an adult is reading this to
                // grade or debug.
                <>
                  <span className="font-medium text-text-primary">
                    {s.plain_english}
                  </span>
                  {s.latex && (
                    <div className="mt-1 text-xs text-text-muted">
                      {/* Wrap in $$…$$ (display math) so matrices and
                          fractions render as proper blocks rather than
                          squished inline expressions. */}
                      <MathText text={`$$${s.latex}$$`} />
                    </div>
                  )}
                </>
              ) : (
                // Literal LaTeX only. The student already confirmed
                // we read the page right; the panel's job is to be a
                // reference of what they actually wrote, not what the
                // AI thinks they did. Fall back to plain_english only
                // when there's no LaTeX (e.g. a written sentence like
                // "let x = apples").
                s.latex ? (
                  <div className="text-text-primary">
                    <MathText text={`$$${s.latex}$$`} />
                  </div>
                ) : (
                  <span className="font-medium text-text-primary">
                    {s.plain_english}
                  </span>
                )
              )}
            </li>
          ))}
        </ol>
      )}
      {hasFinals && (
        // Final-answer block renders independently of steps so a row
        // where the student wrote ONLY a final answer (no scratchwork)
        // doesn't surface the misleading "no legible work" copy. Order
        // by problem_position so multi-problem slices read top-to-
        // bottom like the page they came from.
        <dl
          className={cn(
            "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-text-secondary",
            hasSteps ? (isFull ? "mt-3" : "mt-2") : (isFull ? "mt-2" : "mt-1"),
            isFull ? "text-sm" : "text-xs",
          )}
        >
          {[...extraction.final_answers]
            .sort((a, b) => a.problem_position - b.problem_position)
            .map((fa) => (
              <div
                key={fa.problem_position}
                className="contents"
              >
                <dt className="font-medium text-text-muted">
                  Problem {fa.problem_position} answer
                </dt>
                <dd className="text-text-primary">
                  {fa.answer_latex ? (
                    <MathText text={`$${fa.answer_latex}$`} />
                  ) : (
                    fa.answer_plain || (
                      <span className="italic text-text-muted">(blank)</span>
                    )
                  )}
                </dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}
