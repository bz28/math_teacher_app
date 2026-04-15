"use client";

import type { IntegrityExtraction } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

/**
 * Renders what Vision read from a student's handwritten work.
 *
 * Shared between:
 *   - the student's post-extraction confirm screen (variant="full") —
 *     shows only the literal LaTeX transcription, since the student is
 *     verifying what we *read*, not the agent's description of what
 *     they *did*.
 *   - the teacher's "What the agent saw" collapsible (variant="compact")
 *     — shows both plain-English description and LaTeX, since the
 *     interpretation is useful context for grading.
 *
 * Same source data (`student_work_extraction` JSON). Keep this
 * presentational — no data fetching, no actions.
 */
export function ExtractionView({
  extraction,
  variant = "compact",
}: {
  extraction: IntegrityExtraction;
  /**
   * "compact" is the teacher's tiny in-card version.
   * "full" is the student's confirm screen — larger type, more padding,
   * easier to read at arm's length.
   */
  variant?: "compact" | "full";
}) {
  const isFull = variant === "full";
  return (
    <div
      className={cn(
        "rounded-[--radius-sm] bg-background",
        isFull ? "p-4" : "mt-2 p-2",
      )}
    >
      <div
        className={cn(
          "font-semibold uppercase tracking-wide text-text-muted",
          isFull ? "text-xs" : "text-[10px]",
        )}
      >
        Reader confidence: {Math.round((extraction.confidence ?? 0) * 100)}%
      </div>
      {extraction.steps.length === 0 ? (
        <p
          className={cn(
            "italic text-text-muted",
            isFull ? "mt-2 text-sm" : "mt-1 text-xs",
          )}
        >
          No legible steps were extracted.
        </p>
      ) : (
        <ol
          className={cn(
            "list-decimal space-y-1 pl-5 text-text-secondary",
            isFull ? "mt-2 text-sm" : "mt-1 text-xs",
          )}
        >
          {extraction.steps.map((s, i) => (
            <li key={`${s.step_num}-${i}`}>
              {isFull ? (
                // Student confirm view: show only the literal LaTeX
                // transcription so the question is purely "did we
                // read your page right?" — not "do you agree with
                // the AI's description of what you did?". Fall back
                // to plain_english only when there's no LaTeX
                // (e.g. a written sentence like "let x = apples").
                s.latex ? (
                  <div className="text-text-primary">
                    {/* Wrap in $$…$$ (display math) so matrices and
                        fractions render as proper blocks rather than
                        squished inline expressions. */}
                    <MathText text={`$$${s.latex}$$`} />
                  </div>
                ) : (
                  <span className="font-medium text-text-primary">
                    {s.plain_english}
                  </span>
                )
              ) : (
                <>
                  <span className="font-medium text-text-primary">
                    {s.plain_english}
                  </span>
                  {s.latex && (
                    <div className="mt-1 text-xs text-text-muted">
                      <MathText text={`$$${s.latex}$$`} />
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
