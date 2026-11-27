"use client";

import { useEffect, useRef, useState } from "react";
import { FigureDisplay } from "@/components/shared/figure-display";
import { MathText } from "@/components/shared/math-text";
import type { HomeworkGraphChecklist } from "@/lib/api";
import { buildChoices } from "@/lib/practice-choices";
import { PointsInput } from "@/components/school/teacher/_pieces/problem-points";
import { GraphChecklistPanel } from "@/components/school/teacher/_pieces/graph-checklist";
import type { AssignmentProblem } from "../_lib/types";

// ── Problem row ──
//
// Fat card with the math-rendered question as the focal element. The
// action line is [Solution ▾] [Grading ▾] [Edit question]: Solution is
// on every row (answer + worked solution), Grading only on graded
// homework rows. The two open independently so a teacher can compare
// them; either one expands the full question.
export function ProblemRow({
  problem,
  points,
  onPointsChange,
  validatePoints,
  onEdit,
  checklist,
  checklistLookedAgain,
  onChecklistChanged,
  reveal,
  published,
  practiced,
}: {
  problem: AssignmentProblem;
  /** Changes when the page asks this row to open its Grading ▾ and
   *  scroll into view. */
  reveal?: number;
  published: boolean;
  /** On a live practice set: how many students answered this problem. */
  practiced?: number;
  /** Present for a problem that requires a drawing. */
  checklist?: HomeworkGraphChecklist;
  checklistLookedAgain: boolean;
  onChecklistChanged: () => Promise<void>;
  /** What it's worth; null for practice (ungraded: no points, no
   *  grading details). */
  points: number | null;
  onPointsChange: (n: number) => void;
  validatePoints: (n: number) => string | null;
  /** Opens the question in the Workshop editor; absent once published. */
  onEdit?: () => void;
}) {
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [gradingOpen, setGradingOpen] = useState(false);
  // A new reveal request opens Grading (adjusted during render, so the
  // panel is there on the first paint), then the effect scrolls to it.
  const [seenReveal, setSeenReveal] = useState(reveal);
  if (reveal !== seenReveal) {
    setSeenReveal(reveal);
    if (reveal !== undefined) setGradingOpen(true);
  }
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (reveal !== undefined) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [reveal]);
  const graded = points !== null;
  const expanded = solutionOpen || (graded && gradingOpen);
  const idSuffix = `${problem.position}-${problem.bank_item_id}`;
  const solutionId = `solution-${idSuffix}`;
  const gradingId = `grading-${idSuffix}`;
  const unchecked =
    !!checklist?.checklist && checklist.checklist.asks_for_drawing && !checklist.checklist.checked;
  // One box, placed beside the question on wide screens and under it on
  // a phone, where the question needs the width.
  const pointsBox = (where: string) =>
    points !== null && (
      <label className={`shrink-0 items-center gap-1.5 text-xs text-text-muted ${where}`}>
        <PointsInput
          value={points}
          label={`Points for problem ${problem.position}`}
          onCommit={onPointsChange}
          validate={validatePoints}
        />
        pts
      </label>
    );
  const answerKey = (
    <p className="min-w-0">
      <span className={`mr-2 ${PANEL_LABEL}`}>Answer key</span>
      {problem.final_answer ? (
        <span className="text-text-primary">
          <MathText text={problem.final_answer} />
        </span>
      ) : (
        <span className="text-text-muted">No final answer set.</span>
      )}
    </p>
  );
  return (
    <li ref={rowRef} className="scroll-mb-24 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white">
          {problem.position}
        </div>
        <div className="min-w-0 flex-1">
          {/* Two lines while scanning; the whole question once open. */}
          <div className={`${expanded ? "" : "line-clamp-2 "}text-[15px] leading-snug text-text-primary`}>
            <MathText text={problem.question} />
          </div>
          {expanded && problem.figure_svg && (
            // FigureDisplay owns its vertical rhythm (my-3), so no margin here.
            <FigureDisplay
              svg={problem.figure_svg}
              ariaLabel={`Figure for problem ${problem.position}`}
            />
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {pointsBox("order-last ml-auto flex sm:hidden")}
            {/* Own line on a phone, so the two toggles stay side by side. */}
            <span className="basis-full text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)] sm:basis-auto">
              {problem.difficulty}
            </span>
            <PanelToggle label="Solution" open={solutionOpen} controls={solutionId} onToggle={() => setSolutionOpen((o) => !o)} />
            {graded && (
              <PanelToggle label="Grading" open={gradingOpen} controls={gradingId} onToggle={() => setGradingOpen((o) => !o)} />
            )}
            {graded && unchecked && (
              <button
                type="button"
                onClick={() => setGradingOpen(true)}
                aria-controls={gradingOpen ? gradingId : undefined}
                className="rounded-full border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--color-warning-dark)] hover:border-[color:var(--color-warning)]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-warning)]"
              >
                Graph checklist · not checked
              </button>
            )}
            {practiced !== undefined && (
              <span className="text-xs tabular-nums text-text-muted">{practiced} practiced</span>
            )}
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex min-h-8 items-center text-xs font-medium text-text-secondary hover:text-primary hover:underline"
              >
                Edit question ↗
              </button>
            ) : (
              <span className="text-xs text-text-muted">Locked while published</span>
            )}
          </div>
        </div>
        {pointsBox("hidden sm:flex")}
      </div>
      {solutionOpen && (
        <ProblemPanel id={solutionId}>
          {graded ? answerKey : <PracticeChoices problem={problem} />}
          <WorkedSolution steps={problem.solution_steps} />
        </ProblemPanel>
      )}
      {graded && gradingOpen && (
        <ProblemPanel id={gradingId}>
          {answerKey}
          {checklist ? (
            <GraphChecklistPanel
              entry={checklist}
              bankItemId={problem.bank_item_id}
              problemPoints={points}
              lookedAgain={checklistLookedAgain}
              published={published}
              onChanged={onChecklistChanged}
              onEditQuestion={onEdit}
            />
          ) : (
            <p className="text-xs text-text-secondary">
              Graded by AI using the rules below.
            </p>
          )}
        </ProblemPanel>
      )}
    </li>
  );
}

const PANEL_LABEL =
  "text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]";

function PanelToggle({
  label,
  open,
  controls,
  onToggle,
}: {
  label: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {label} <span aria-hidden>{open ? "▴" : "▾"}</span>
    </button>
  );
}

// The shell both of a row's panels (Solution, Grading) sit in.
function ProblemPanel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      className="mt-3 ml-9 space-y-3 rounded-[--radius-md] border border-border-light bg-bg-subtle/40 px-3 py-2.5 text-sm"
    >
      {children}
    </div>
  );
}

// The worked solution, each step with its own figure (the same
// FigureDisplay call the student's Learn view makes in step-timeline).
function WorkedSolution({ steps }: { steps: AssignmentProblem["solution_steps"] }) {
  const list = steps ?? [];
  if (list.length === 0) {
    return (
      <p className="text-xs text-text-muted">No worked solution for this problem.</p>
    );
  }
  return (
    <section>
      <h4 className={PANEL_LABEL}>Worked solution</h4>
      <ol className="mt-2 space-y-2.5">
        {list.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-[10px] font-bold text-text-secondary">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              {s.title && (
                <div className="font-semibold text-text-primary">
                  <MathText text={s.title} />
                </div>
              )}
              <FigureDisplay
                svg={s.figure_svg}
                className="max-h-44"
                ariaLabel={
                  s.title ? `Figure for step ${i + 1}: ${s.title}` : `Figure for step ${i + 1}`
                }
              />
              <div className="mt-0.5 text-[13px] leading-relaxed text-text-secondary">
                <MathText text={s.description} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// What a practice student actually picks from: the answer choices the
// runner shows (same order: buildChoices is shared with the student
// page), correct one marked.
function PracticeChoices({ problem }: { problem: AssignmentProblem }) {
  const choices = buildChoices(problem);
  const correct = (problem.final_answer ?? "").trim();
  if (choices.length < 2) {
    return (
      <section>
        <h4 className={PANEL_LABEL}>Answer</h4>
        <div className="mt-1.5 text-text-primary">
          {correct ? <MathText text={correct} /> : <span className="text-text-muted">No answer set.</span>}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          No answer choices, so students don&apos;t get this one as multiple choice.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h4 className={PANEL_LABEL}>Answer choices students see</h4>
      {!correct && (
        <p
          role="alert"
          className="mt-2 rounded-[--radius-sm] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2.5 py-1.5 text-xs font-semibold text-[color:var(--color-warning-dark)]"
        >
          No correct answer stored, so students can&apos;t get this right.
          Edit or regenerate it.
        </p>
      )}
      <ol className="mt-2 space-y-1.5">
        {choices.map((c, i) => {
          const isCorrect = c === correct;
          return (
            <li
              key={c}
              className={`flex items-start gap-2.5 rounded-[--radius-sm] border px-2.5 py-1.5 ${
                isCorrect
                  ? "border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)]"
                  : "border-border-light bg-surface"
              }`}
            >
              <span
                className={`mt-px shrink-0 font-mono text-xs font-bold ${
                  isCorrect ? "text-[color:var(--color-success)]" : "text-text-muted"
                }`}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <div className="min-w-0 flex-1 text-text-primary">
                <MathText text={c} />
              </div>
              {isCorrect && (
                // Just the check on a phone, so a long multi-part
                // answer keeps the row's width.
                <span className="shrink-0 text-[11px] font-semibold text-[color:var(--color-success)]">
                  <span aria-hidden>✓</span>
                  <span className="sr-only sm:not-sr-only sm:ml-1">Correct</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
