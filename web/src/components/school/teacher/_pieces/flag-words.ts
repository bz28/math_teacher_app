/** A flagged count by kind, in a few words each, for lines of text (a
 *  headline, a "Grade next" reason, a section's line). Same words as
 *  FlagPills, and never "flagged": a photo problem never reads like an
 *  integrity concern. Empty when nothing is flagged. */
export function flagWords(c: { worth_a_look: number; photo_problems: number; too_long: number }): string[] {
  const words: string[] = [];
  if (c.worth_a_look > 0) words.push(`${c.worth_a_look} worth a look`);
  if (c.photo_problems > 0) {
    const n = c.photo_problems;
    words.push(`${n} photo or reading problem${n === 1 ? "" : "s"}`);
  }
  if (c.too_long > 0) words.push(`${c.too_long} too long to AI-grade`);
  return words;
}
