import type { PillTone } from "../components/StatusPill";
import type { ReportKind, TeacherReportData } from "./api";

/** Shared vocabulary for the Reports list and detail pages. */

export const KIND_LABEL: Record<ReportKind, string> = {
  wrong_grade: "Grade is wrong",
  misread_work: "Misread handwriting",
  understanding_check: "Understanding check",
  broken: "Something's broken",
  confusing: "Confusing",
  other: "Something else",
};

export const KIND_TONE: Record<ReportKind, PillTone> = {
  wrong_grade: "danger",
  misread_work: "warn",
  understanding_check: "warn",
  broken: "danger",
  confusing: "info",
  other: "neutral",
};

/** Just the number: "100%" / "50%" / "0%" / "—" — for the list column. */
export function gradePct(
  g: { score_status: string | null; percent: number | null } | null | undefined,
): string {
  if (!g || !g.score_status) return "—";
  if (g.score_status === "full") return "100%";
  if (g.score_status === "zero") return "0%";
  return g.percent == null ? "partial" : `${Math.round(g.percent)}%`;
}

/** "Full · 100%" / "Partial · 50%" / "No credit" / "—" */
export function gradeLabel(
  g: { score_status: string | null; percent: number | null } | null | undefined,
): string {
  if (!g || !g.score_status) return "—";
  if (g.score_status === "full") return "Full · 100%";
  if (g.score_status === "zero") return "No credit · 0%";
  return g.percent == null ? "Partial" : `Partial · ${Math.round(g.percent)}%`;
}

/** "Solving Systems · Problem 4 · D. Park", or the page for a
 *  context-free report. */
export function whereLabel(r: TeacherReportData): string {
  const parts = [
    r.assignment_title,
    r.problem_position ? `Problem ${r.problem_position}` : r.submission_id ? "Whole submission" : null,
    r.student_name,
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  if (r.page_url) {
    try {
      return new URL(r.page_url).pathname;
    } catch {
      return r.page_url;
    }
  }
  return "No context";
}
