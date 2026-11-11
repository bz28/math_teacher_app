// The late-penalty line a student sees under a published grade
// (api/core/late_policy.py: 10% of the score per started day late).

/** One decimal, never rounded away: 10% off 85% is 76.5%. */
export function oneDecimal(value: number): string {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** The line in two parts: what the work earned, and what lateness took —
 *  the amount and the percent of the score it was. 85% a day late reads
 *  "85% for the work" / "−8.5% for turning it in late (10% of the score,
 *  10% per day late)". */
export function latePenaltyLine(
  finalScore: number,
  latePenalty: number,
  percent: number,
): { work: string; late: string } {
  return {
    work: `${oneDecimal(finalScore + latePenalty)}% for the work`,
    late:
      `−${oneDecimal(latePenalty)}% for turning it in late ` +
      `(${oneDecimal(percent)}% of the score, 10% per day late)`,
  };
}
