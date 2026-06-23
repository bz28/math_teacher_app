import type { Extraction, ExtractionFinalAnswer, ExtractionStep } from "../services/api";

// The extraction comes back as flat lists of steps + final answers, each
// tagged with a problem_position. The confirm screen shows them grouped by
// problem, so this buckets them (mirroring the web client's groupByProblem).

export interface ExtractionGroup {
  position: number | null;
  steps: ExtractionStep[];
  finalAnswer: ExtractionFinalAnswer | null;
}

export function groupExtraction(extraction: Extraction): ExtractionGroup[] {
  const groups = new Map<string, ExtractionGroup>();
  const keyOf = (p: number | null) => (p == null ? "null" : String(p));
  const ensure = (position: number | null) => {
    const k = keyOf(position);
    let g = groups.get(k);
    if (!g) {
      g = { position, steps: [], finalAnswer: null };
      groups.set(k, g);
    }
    return g;
  };

  for (const step of extraction.steps) ensure(step.problem_position).steps.push(step);
  for (const fa of extraction.final_answers) ensure(fa.problem_position).finalAnswer = fa;

  // Real problem positions ascending; unattributed work ("Other") last.
  return [...groups.values()].sort((a, b) => {
    if (a.position == null) return 1;
    if (b.position == null) return -1;
    return a.position - b.position;
  });
}

export type ConfidenceBand = "high" | "medium" | "low";

/** Map the numeric extraction confidence (0-1) to a display band. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}
