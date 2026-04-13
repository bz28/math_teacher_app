/** Quiz/practice/mock-test result for a single question. */
export interface QuizResult {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean | null;
}

/** Deterministic shuffle for MCQ choices using a string hash. */
export function shuffleChoices(choices: string[], seed: number): string[] {
  return [...choices].sort((a, b) => {
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
