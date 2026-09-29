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

type GradeLike = { score_status: string | null; percent: number | null } | null | undefined;

/** A grade as a single number, or null when there isn't one. */
export function gradeValue(g: GradeLike): number | null {
  if (!g || !g.score_status) return null;
  if (g.score_status === "full") return 100;
  if (g.score_status === "zero") return 0;
  return g.percent == null ? null : Math.round(g.percent);
}

/** Teacher minus AI, in points — negative means the AI over-credited.
 *  Null unless both sides carry a number. */
export function gradeGap(r: TeacherReportData): number | null {
  const ai = gradeValue(r.ai_grade);
  const t = gradeValue(r.teacher_grade);
  return ai === null || t === null ? null : t - ai;
}

/** "−60" / "+25" / "±0" — a signed gap for mono columns. */
export function fmtGap(gap: number): string {
  if (gap === 0) return "±0";
  return gap > 0 ? `+${gap}` : `−${Math.abs(gap)}`;
}

/**
 * The inbox order. Open before resolved; then reports that arrived with
 * a submission attached — those can be diagnosed from the console right
 * now, where a sidebar note usually needs a reply first; then newest.
 */
export function byPriority(a: TeacherReportData, b: TeacherReportData): number {
  const open = Number(b.status === "open") - Number(a.status === "open");
  if (open) return open;
  const evidence = Number(!!b.submission_id) - Number(!!a.submission_id);
  if (evidence) return evidence;
  return b.created_at.localeCompare(a.created_at);
}

/** The teacher's page path for a context-free report ("/school/teacher"). */
export function pagePath(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
