"use client";

import type { CourseSetupStatus } from "@/lib/api";
import { setupSteps, type SetupStepKey } from "./setup-steps";

const COPY: Record<SetupStepKey, { title: string; detail: string; done: string; action: string }> = {
  sections: {
    title: "Add your sections",
    detail: "One per class period. Type them all at once: “Period 1, Period 3”",
    done: "Your class periods are in",
    action: "Add sections",
  },
  codes: {
    title: "Share the join codes",
    detail: "Students join by code; each section has its own",
    done: "A student has joined",
    action: "Show codes",
  },
  homework: {
    title: "Create the first homework",
    detail: "You approve each problem before it’s assigned",
    done: "Your first homework is made",
    action: "New homework",
  },
};

/** A new course's three setup steps, each with the one button that does
 *  it. Driven by the course's setup status; gone once all three are done. */
export function SetupChecklist({
  courseName,
  status,
  onAction,
}: {
  courseName: string;
  status: CourseSetupStatus;
  onAction: (step: SetupStepKey) => void;
}) {
  const steps = setupSteps(status);
  if (!steps) return null;
  const doneCount = steps.filter((s) => s.done).length;
  // The next step to do is the one that gets the filled button; a step
  // whose turn hasn't come (codes before any section) waits quietly.
  const next = steps.find((s) => !s.done)?.key;
  return (
    <section
      aria-labelledby="setup-checklist"
      data-testid="setup-checklist"
      className="mt-6 max-w-2xl"
    >
      <div className="overflow-hidden rounded-[--radius-lg] border border-border-light bg-surface shadow-sm">
        <div className="flex items-baseline justify-between gap-4 border-b border-border-light px-5 py-3.5">
          <h2 id="setup-checklist" className="font-serif text-[20px] leading-tight text-text-primary">
            Set up {courseName}
          </h2>
          <span className="shrink-0 text-xs tabular-nums text-text-muted">
            {doneCount} of {steps.length} done
          </span>
        </div>
        <ol>
          {steps.map((step, i) => {
            const copy = COPY[step.key];
            const blocked = step.key === "codes" && !status.has_section;
            return (
              <li
                key={step.key}
                className="flex items-center gap-4 border-b border-border-light px-5 py-3.5 last:border-b-0"
              >
                {step.done ? (
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white"
                  >
                    ✓
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[12px] font-semibold tabular-nums text-text-secondary"
                  >
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${step.done ? "text-text-secondary" : "text-text-primary"}`}>
                    {copy.title}
                    {step.done && <span className="sr-only"> (done)</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">{step.done ? copy.done : copy.detail}</p>
                </div>
                {step.done ? (
                  <span className="shrink-0 text-xs font-semibold text-success">Done</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAction(step.key)}
                    disabled={blocked}
                    title={blocked ? "Add a section first" : undefined}
                    className={`shrink-0 rounded-[--radius-md] px-3.5 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      step.key === next
                        ? "bg-primary text-white hover:bg-primary-dark"
                        : "border border-border-light text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
                    }`}
                  >
                    {copy.action}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-2 text-xs text-text-muted">This goes away once all three are done.</p>
    </section>
  );
}
