import type { StudentPracticeProblem } from "@/lib/api";

/** Per-problem result of the practice runner.
 *  - `first`    → correct on the first pick
 *  - `retry`    → wrong once, then correct on the second pick
 *  - `revealed` → wrong twice, the answer was shown
 *
 * `first` and `retry` both count as solved; `revealed` does not. */
export type Outcome = "first" | "retry" | "revealed";

export function isSolved(o: Outcome): boolean {
  return o !== "revealed";
}

/** Map a runner Outcome onto the activity-log wire value. The runner's
 *  "first" is the API's "first_try"; "retry"/"revealed" pass through. */
export function toActivityOutcome(
  o: Outcome,
): "first_try" | "retry" | "revealed" {
  return o === "first" ? "first_try" : o;
}

/** A problem is learnable when it carries a worked solution. */
export function isLearnable(problem: StudentPracticeProblem): boolean {
  return (problem.solution_steps?.length ?? 0) > 0;
}

/** Celebration copy that scales with the practice score. */
export function encouragementFor(pct: number): { headline: string; sub: string } {
  if (pct >= 100)
    return {
      headline: "Flawless.",
      sub: "Every problem, clean. That is what mastery looks like.",
    };
  if (pct >= 80)
    return {
      headline: "Beautifully done.",
      sub: "You clearly have this. A little polish and it's perfect.",
    };
  if (pct >= 50)
    return {
      headline: "Solid work.",
      sub: "The shape is there — one more pass will lock it in.",
    };
  return {
    headline: "Good start.",
    sub: "Walk the worked steps, then run the set back. It clicks fast.",
  };
}
