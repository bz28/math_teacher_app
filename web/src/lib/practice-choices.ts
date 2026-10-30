/** The fields a practice problem needs to become a multiple-choice
 *  question. Structural so the student runner and the teacher's
 *  practice view build the exact same choices from their own types. */
export interface ChoiceSource {
  bank_item_id: string;
  final_answer: string | null;
  distractors?: string[] | null;
}

/** Deterministic FNV-1a-seeded Fisher–Yates shuffle. Same seed → same
 *  order, so the choices don't reshuffle on every render, but distinct
 *  problems get distinct orders so "the answer is always A" can't be
 *  learned. */
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
export function buildChoices(problem: ChoiceSource): string[] {
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
export function isMCQ(problem: ChoiceSource): boolean {
  return buildChoices(problem).length >= 2;
}
