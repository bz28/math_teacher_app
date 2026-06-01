/** Quiz/practice/mock-test result for a single question. */
export interface QuizResult {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean | null;
}

/** Deterministic shuffle for MCQ choices using a string hash.
 *
 * Dedupes by trimmed value first. The distractor LLM sometimes returns
 * differently-annotated-but-identical strings that collapse to the same
 * bare value after `_strip_distractor_leak` runs on the backend; without
 * this guard the MC grid renders multiple buttons with the same text,
 * all of which select together when tapped (and React fires a
 * duplicate-key warning because the screens key by choice text).
 */
export function shuffleChoices(choices: string[], seed: number): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const c of choices) {
    const key = c.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  return deduped.sort((a, b) => {
    const ha = Array.from(a).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
    const hb = Array.from(b).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
    return ha - hb;
  });
}

/** Format seconds as m:ss elapsed time. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Format seconds as "Xm Ys" for summary display. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
