import type { ClassRubricRule, GradedRule, TeacherRubric } from "@/lib/api";

/** A homework's own text fields. Full and partial credit guidance lives
 *  on the class (`ClassRubric`) and is only ever read here, off a grade's
 *  snapshot. */
const TEXT_FIELDS = ["common_mistakes", "notes"] as const;

// The class's default credit guidance, shown pre-filled in class settings.
//
// KEEP IN SYNC with the backend fallbacks in
// api/core/grading_ai.py::_DEFAULT_FULL_CREDIT / _DEFAULT_PARTIAL_CREDIT.
// A class that never edits them stores nothing and the grader falls back
// to this same text, so what the teacher sees is what the AI applies.
export const CREDIT_DEFAULTS = {
  full_credit:
    "Correct final answer (mathematically equivalent forms like 1/2 and 0.5 both count). Enough work shown that the reasoning is followable — students can skip routine or mental steps as long as the path from set-up to answer is unambiguous to the grader, with no non-obvious leaps. A bare final answer with no set-up doesn't qualify. If the problem names an algebraic method (\"using elimination\") full credit requires that method, and if the question is marked as requiring a drawing, full credit requires the drawing.",
  partial_credit:
    "Anchor partial credit on how much of the correct reasoning is intact. Right approach with a small execution error (sign flip, arithmetic slip) — around 95%. Right approach with multiple errors or stopped mid-solution — around 60%. Correct answer but the method or drawing the problem asked for is missing — around 50%; present but incomplete — around 75%. Right setup but substantially incomplete, or a plausible attempt with a wrong method — around 30%. Use judgment between these anchors. Incoherent attempts that show no sign of the right concept are zero, not partial.",
} as const;

/** Collapse a homework rubric into the tight shape the server stores:
 *  trimmed text fields, empty ones dropped, skipped rule ids deduped and
 *  sorted (dropped when none). Every writer goes through this, so a save
 *  from one field never loses another — `skipped_rule_ids` included. */
export function normalizeRubric(r: TeacherRubric | null): TeacherRubric {
  const out: TeacherRubric = {};
  for (const f of TEXT_FIELDS) {
    const v = r?.[f];
    if (v && v.trim()) out[f] = v.trim();
  }
  const skipped = [...new Set(r?.skipped_rule_ids ?? [])].sort();
  if (skipped.length) out.skipped_rule_ids = skipped;
  return out;
}

/** What the grader applies to one homework: its own fields plus the
 *  class rules it hasn't skipped. Mirrors the server's
 *  `class_rubric.effective_rubric`, so the review page can tell whether a
 *  grade's snapshot is out of date. */
export function effectiveRubric(
  classRules: ClassRubricRule[],
  hw: TeacherRubric | null,
): TeacherRubric | null {
  const { skipped_rule_ids, ...own } = hw ?? {};
  const skipped = new Set(skipped_rule_ids ?? []);
  const rules: GradedRule[] = classRules
    .filter((r) => !skipped.has(r.id))
    .map((r) => ({ id: r.id, text: r.text, points: r.points }));
  const merged: TeacherRubric = { ...own };
  if (rules.length) merged.rules = rules;
  return Object.keys(merged).length ? merged : null;
}

/** Has this homework's own rubric changed since this grade was made?
 *  Compares the homework's text fields (missing = empty). The class's
 *  rules and credit guidance — adding, editing, skipping — never put a
 *  grade up for a regrade: they apply to grading from now on, and a
 *  regrade would replace the teacher's edits on every paper the class
 *  already graded. */
export function rubricChanged(
  current: TeacherRubric | null,
  snapshot: TeacherRubric | null,
): boolean {
  const a = current ?? {};
  const b = snapshot ?? {};
  return TEXT_FIELDS.some((f) => (a[f] ?? "") !== (b[f] ?? ""));
}

/** The homework has text of its own (not just skipped class rules). */
export function hasRubricText(r: TeacherRubric | null): boolean {
  return TEXT_FIELDS.some((f) => Boolean(r?.[f]?.trim()));
}

/** A rubric as labeled blocks for read-only display (the review page's
 *  rubric panel and the "rubric at grading time" view). Class rules come
 *  first, one per line with their points. */
export function rubricFields(r: TeacherRubric | null): { label: string; text: string }[] {
  if (!r) return [];
  const out: { label: string; text: string }[] = [];
  if (r.rules?.length) {
    out.push({
      label: "Class rules",
      text: r.rules
        .map((x) => `• ${x.text}${x.points === null ? "" : ` (−${x.points})`}`)
        .join("\n"),
    });
  }
  if (r.full_credit) out.push({ label: "Full credit", text: r.full_credit });
  if (r.partial_credit) out.push({ label: "Partial credit", text: r.partial_credit });
  if (r.common_mistakes) out.push({ label: "Common mistakes", text: r.common_mistakes });
  if (r.notes) out.push({ label: "Extra rules for this homework", text: r.notes });
  return out;
}
