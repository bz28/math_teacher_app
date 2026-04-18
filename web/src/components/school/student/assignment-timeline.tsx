import { PercentBadge } from "@/components/school/shared/percent-badge";
import { formatRelativeDate } from "@/lib/utils";

/**
 * Slim assignment journey timeline (student portal v1 pillar 2).
 *
 * Four coarse stages the student can see from the HW detail page:
 *   1. Assigned        — always on once published.
 *   2. Submitted       — student uploaded their work.
 *   3. Being reviewed  — submitted, teacher hasn't published a grade.
 *   4. Graded          — teacher published a final score.
 *
 * Deliberately no "Next step" stage; pillar 5 (practice loop) ships
 * when teacher variation UX is revived. See
 * memory/project_student_portal_v2_deferred.md.
 *
 * The current stage gets a subtle animated pulse so the student
 * always sees where they are.
 */
export function AssignmentTimeline({
  submittedAt,
  finalScore,
  gradePublishedAt,
}: {
  submittedAt: string | null;
  finalScore: number | null;
  gradePublishedAt: string | null;
}) {
  const hasSubmission = submittedAt !== null;
  const hasPublishedGrade = gradePublishedAt !== null;

  const currentStage: Stage = hasPublishedGrade
    ? "graded"
    : hasSubmission
    ? "reviewing"
    : "assigned";

  const stages: Array<{ key: Stage; label: string; hint: string | null }> = [
    { key: "assigned", label: "Assigned", hint: null },
    {
      key: "submitted",
      label: "Submitted",
      hint: submittedAt ? formatRelativeDate(submittedAt) : null,
    },
    {
      key: "reviewing",
      label: "Being reviewed",
      hint: null,
    },
    {
      key: "graded",
      label: "Graded",
      hint: gradePublishedAt ? formatRelativeDate(gradePublishedAt) : null,
    },
  ];

  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Progress
        </span>
        {hasPublishedGrade && finalScore !== null && (
          <PercentBadge percent={finalScore} size="lg" />
        )}
      </div>
      <ol className="flex items-start gap-0">
        {stages.map((stage, i) => {
          const state = stageState(stage.key, currentStage);
          const isLast = i === stages.length - 1;
          return (
            <li key={stage.key} className="flex min-w-0 flex-1 items-start gap-0">
              <div className="flex min-w-0 flex-col items-center">
                <Dot state={state} />
                <div className="mt-1.5 text-center">
                  <div
                    className={
                      "text-[11px] font-semibold " +
                      (state === "done" || state === "current"
                        ? "text-text-primary"
                        : "text-text-muted")
                    }
                  >
                    {stage.label}
                  </div>
                  {stage.hint && (
                    <div className="text-[10px] text-text-muted">{stage.hint}</div>
                  )}
                </div>
              </div>
              {!isLast && <Connector done={state === "done"} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type Stage = "assigned" | "submitted" | "reviewing" | "graded";
type DotState = "done" | "current" | "pending";

function stageState(stage: Stage, current: Stage): DotState {
  const order: Stage[] = ["assigned", "submitted", "reviewing", "graded"];
  const sIdx = order.indexOf(stage);
  const cIdx = order.indexOf(current);
  if (sIdx < cIdx) return "done";
  if (sIdx === cIdx) return "current";
  return "pending";
}

function Dot({ state }: { state: DotState }) {
  if (state === "done") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    );
  }
  if (state === "current") {
    return (
      <div className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center">
      <span className="inline-flex h-3 w-3 rounded-full border-2 border-border" />
    </div>
  );
}

function Connector({ done }: { done: boolean }) {
  return (
    <div className={"mt-[11px] h-0.5 flex-1 " + (done ? "bg-primary" : "bg-border-light")} />
  );
}
