// Gradebook arithmetic, kept apart from the grid component so it can be
// unit-tested (node --test) and so every number on the Grades tab comes
// from one place.
import type { GradebookAssignment, GradebookCell, GradebookStudent } from "./api.ts";

/** The number a teacher sees. Tone, filters and buckets all judge this,
 *  never the raw float — a 69.96 shown as "70%" must not read as below
 *  70 anywhere on the page. */
export function shown(percent: number): number {
  return Math.round(percent);
}

/** Mean of the students' averages — the section average. Always over the
 *  whole section, never a filtered view, so it agrees with the section
 *  tab. Students with nothing published yet don't count. */
export function sectionAverage(students: GradebookStudent[]): number | null {
  const avgs = students.flatMap((s) => (s.avg_percent === null ? [] : [s.avg_percent]));
  return avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
}

export type UnscoredState = Exclude<GradebookCell["state"], "published">;

/** What a student's average is built from: the published scores it
 *  averages (column order), and a count of each state it leaves out. */
export function averageBreakdown(
  student: GradebookStudent,
  assignments: GradebookAssignment[],
): { scores: number[]; leftOut: Partial<Record<UnscoredState, number>> } {
  const scores: number[] = [];
  const leftOut: Partial<Record<UnscoredState, number>> = {};
  for (const a of assignments) {
    const c = student.cells[a.id];
    if (!c) continue;
    if (c.state === "published") scores.push(c.score);
    else leftOut[c.state] = (leftOut[c.state] ?? 0) + 1;
  }
  return { scores, leftOut };
}

/** The score the teacher gave, before any late penalty — what compares
 *  with the AI's suggestion, which never has the penalty in it. */
export function scoreGiven(cell: Extract<GradebookCell, { state: "published" }>): number {
  return cell.score + cell.late_penalty;
}

/** The late policy's cut as a percent of the score she gave (10 per day
 *  late): 85% with 8.5 taken off is 10. 0 when nothing was taken. */
export function lateRate(cell: Extract<GradebookCell, { state: "published" }>): number {
  const given = scoreGiven(cell);
  return given > 0 ? (cell.late_penalty / given) * 100 : 0;
}

/** Did the teacher publish something other than the AI's suggestion?
 *  Judged on the numbers shown, so the dot agrees with the hover card's
 *  "AI suggested X% · you gave Y%". Both are means of per-problem
 *  percents, so a grade approved as-is is equal. A late penalty is the
 *  policy's, not her change, so it doesn't count. */
export function changedFromAi(cell: Extract<GradebookCell, { state: "published" }>): boolean {
  return cell.ai_score !== null && shown(cell.ai_score) !== shown(scoreGiven(cell));
}

export type SortKey = "name" | "avg" | string; // string = assignment id
export type SortDir = "asc" | "desc";

/** Last-name-first sort key, matching the roster's. */
export function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toLowerCase();
  return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
}

/** Sort rows by name, average, or one homework's published score. A row
 *  with no score sinks to the bottom either way — it isn't low, it's
 *  absent. */
export function sortRows(
  rows: GradebookStudent[],
  sort: { key: SortKey; dir: SortDir },
): GradebookStudent[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  const out = rows.slice();
  if (sort.key === "name") {
    return out.sort((a, b) => lastNameKey(a.name).localeCompare(lastNameKey(b.name)) * mul);
  }
  const value = (r: GradebookStudent): number | null => {
    if (sort.key === "avg") return r.avg_percent;
    const c = r.cells[sort.key];
    return c?.state === "published" ? c.score : null;
  };
  return out.sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * mul;
  });
}
