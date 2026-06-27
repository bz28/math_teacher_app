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

/** Deterministic FNV-1a-seeded Fisher–Yates shuffle. Same seed → same
 *  order, so the choices don't reshuffle on every render, but distinct
 *  problems get distinct orders so "the answer is always A" can't be
 *  learned. (Single home for the helper that used to be duplicated
 *  across the page and the now-deleted practice-loop-surface.) */
function shuffleStable<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Build the deduped, stably-shuffled MCQ choice list for a problem:
 *  the correct answer + its distractors. Returns `[]` when the problem
 *  has no usable answer set. */
export function buildChoices(problem: StudentPracticeProblem): string[] {
  const correct = (problem.final_answer || "").trim();
  const raw = [correct, ...(problem.distractors ?? [])]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const c of raw) {
    if (!seen.has(c)) {
      seen.add(c);
      deduped.push(c);
    }
  }
  return shuffleStable(deduped, problem.bank_item_id);
}

/** A problem is practiceable as MCQ when it yields at least two choices. */
export function isMCQ(problem: StudentPracticeProblem): boolean {
  return buildChoices(problem).length >= 2;
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
