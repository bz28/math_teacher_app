// Pure grade helpers (no RN imports) so they're unit-testable. Mirrors
// the web gradebook's banding (web/src/components/school/shared/percent-badge.tsx):
// strong >= 85, average 70-84, struggling < 70.

export type ScoreTone = "strong" | "average" | "struggling";

export function scoreTone(score: number): ScoreTone {
  if (score >= 85) return "strong";
  if (score >= 70) return "average";
  return "struggling";
}

/** Rounded mean of the published scores, or null when there are none. */
export function averageScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round(sum / scores.length);
}
