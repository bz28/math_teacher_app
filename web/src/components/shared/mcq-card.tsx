"use client";

import DOMPurify from "dompurify";
import { Button, Card } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

interface Props {
  /** Math-rendered question text (LaTeX or plain). */
  question: string;
  /** Already-shuffled multiple-choice options. Caller controls order. */
  choices: string[];
  /** Index of the chosen option in `choices`, or null if not yet picked. */
  selectedChoice: number | null;
  /** Caller-owned feedback state. Drives the result box + advance button. */
  feedback: "correct" | "wrong" | null;
  /** Caller's "request in flight" flag — disables MCQ buttons during the
   *  brief score request. */
  isThinking?: boolean;
  /** Fired when the kid taps an MCQ option. Caller decides what to do
   *  (score it, set feedback, etc). */
  onSelectChoice: (choice: string) => void;
  /** Fired when the kid clicks the inline advance button. When omitted
   *  (or `advanceLabel` is omitted), no inline advance button is
   *  rendered — the caller is using an external footer instead. */
  onAdvance?: () => void;
  /** Caller-supplied label for the inline advance button. Personal uses
   *  "Next Problem" or "See Results"; school omits this and uses an
   *  external footer with its own next/done buttons. */
  advanceLabel?: string;
  /** When true, MCQ buttons are disabled regardless of feedback. Used
   *  by school's one-shot mode (no retry after wrong) — caller flips
   *  this on as soon as a choice is picked. Personal leaves it false
   *  so the kid can retry until correct. */
  disableChoices?: boolean;
  /** When provided AND feedback === "wrong", revealed inside the
   *  wrong-feedback box ("The correct answer was X"). School uses
   *  this for its one-shot reveal; personal omits it because retry
   *  is the intended path. */
  correctAnswer?: string;
  /** Optional content rendered below the MCQ buttons but inside the
   *  card. Personal uses this for the "Skip this problem" link;
   *  school uses it for nothing (footer lives outside the card). */
  belowChoices?: React.ReactNode;
}

/**
 * The shared MCQ rendering primitive. Owns the Card + question text +
 * MCQ buttons + correct/wrong feedback boxes. Pure render — all state
 * (current question, feedback, selection) is owned by the parent.
 *
 * Used by:
 * - personal /practice page
 * - school PracticeLoopSurface
 *
 * Both surfaces feed it from their own stores; the visual is identical.
 */
export function MCQCard({
  question,
  choices,
  selectedChoice,
  feedback,
  isThinking,
  onSelectChoice,
  onAdvance,
  advanceLabel,
  disableChoices,
  correctAnswer,
  belowChoices,
}: Props) {
  const showInlineAdvance = onAdvance && advanceLabel;

  return (
    <Card variant="elevated" className="space-y-4">
      <div className="text-base font-medium text-text-primary">
        <MathText text={question} />
      </div>

      {feedback === "correct" ? (
        <div className="space-y-3">
          <div className="rounded-[--radius-md] border border-success-border bg-success-light p-3">
            <p className="text-sm font-medium">Correct!</p>
          </div>
          {showInlineAdvance && (
            <Button variant="secondary" size="sm" onClick={onAdvance}>
              {advanceLabel}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {feedback === "wrong" && (
            <div className="rounded-[--radius-md] border border-error-border bg-error-light p-3 text-sm font-medium">
              {correctAnswer ? (
                <>
                  Not quite. The correct answer was{" "}
                  <span className="font-bold">
                    <MathText text={correctAnswer} />
                  </span>
                  .
                </>
              ) : (
                "Not quite, try again!"
              )}
            </div>
          )}

          {choices.length > 0 ? (
            <div className="space-y-2">
              {choices.map((choice, i) => {
                const isSelected = selectedChoice === i;
                const isWrong = isSelected && feedback === "wrong";
                const isCorrectChoice =
                  feedback !== null
                  && correctAnswer !== undefined
                  && choice.trim() === correctAnswer.trim();
                const isSvg = choice.trim().startsWith("<svg");
                const buttonDisabled = isThinking || disableChoices;

                return (
                  <button
                    key={i}
                    onClick={() => onSelectChoice(choice)}
                    disabled={buttonDisabled}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[--radius-md] border px-4 py-3 text-left text-sm font-medium transition-all",
                      isWrong && "border-error bg-error-light text-error",
                      isCorrectChoice && !isWrong && "border-success-border bg-success-light",
                      !isWrong && !isCorrectChoice && "border-border bg-surface text-text-primary hover:border-primary hover:bg-primary-bg",
                      isThinking && !isSelected && "opacity-50",
                      disableChoices && !isSelected && !isCorrectChoice && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        isWrong && "bg-error text-white",
                        !isWrong && "bg-input-bg text-text-secondary",
                      )}
                    >
                      {isWrong ? "\u2717" : String.fromCharCode(65 + i)}
                    </span>
                    {isSvg ? (
                      <div
                        className="rounded bg-white p-2"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(choice, { USE_PROFILES: { svg: true } }),
                        }}
                      />
                    ) : (
                      <MathText text={choice} />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Loading choices...</p>
          )}

          {belowChoices}
        </div>
      )}
    </Card>
  );
}
