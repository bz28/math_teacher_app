import type { ClassRubricRule, GradedRule, TeacherRubric } from "@/lib/api";

const TEXT_FIELDS = ["full_credit", "partial_credit", "common_mistakes", "notes"] as const;

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
 *  Compares the four text fields (missing = empty). Class rules — adding,
 *  editing, skipping — never put a grade up for a regrade: they apply to
 *  grading from now on, and a regrade would replace the teacher's edits
 *  on every paper the class already graded. */
export function rubricChanged(
  current: TeacherRubric | null,
  snapshot: TeacherRubric | null,
): boolean {
  const a = current ?? {};
  const b = snapshot ?? {};
  return TEXT_FIELDS.some((f) => (a[f] ?? "") !== (b[f] ?? ""));
}

/** A rubric as labeled blocks for read-only display (the review page's
 *  rubric panel and the "rubric at grading time" view). Class rules come
 *  first, one per line with their points. */
/** The homework has text of its own (not just skipped class rules). */
export function hasRubricText(r: TeacherRubric | null): boolean {
  return TEXT_FIELDS.some((f) => Boolean(r?.[f]?.trim()));
}

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
