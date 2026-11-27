import type { NeedsAttentionItem } from "@/lib/api";

/** One "Needs you today" row: a homework in one section, with every
 *  submission in it that's waiting on the teacher. */
export interface NeedsYouGroup {
  key: string;
  course_id: string;
  course_name: string;
  subject: string;
  assignment_id: string;
  assignment_title: string;
  section_id: string;
  section_name: string;
  due_at: string | null;
  /** The submissions, in the server's most-urgent-first order. */
  items: NeedsAttentionItem[];
  /** Each count is the review page's own number for this section:
   *  toApprove — its share of "Publish N grades" (graded, not released)
   *  flagged   — its Flagged chip
   *  cantAiGrade — its "N can't be AI-graded" note
   *  ungraded  — the rest: turned in, no grade yet, nothing blocking the
   *              AI (waiting on the due date or the student's confirm). */
  toApprove: number;
  flagged: number;
  cantAiGrade: number;
  ungraded: number;
}

/** Folds the per-submission queue into one row per homework × section.
 *  The server sorts submissions most-urgent-first, so a group's position
 *  is where its most urgent submission sat, and its first item is the
 *  student the Review button opens on. */
export function groupNeedsYou(items: NeedsAttentionItem[]): NeedsYouGroup[] {
  const groups = new Map<string, NeedsYouGroup>();
  for (const it of items) {
    const key = `${it.assignment_id}:${it.section_id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        course_id: it.course_id,
        course_name: it.course_name,
        subject: it.subject,
        assignment_id: it.assignment_id,
        assignment_title: it.assignment_title,
        section_id: it.section_id,
        section_name: it.section_name,
        due_at: it.due_at,
        items: [],
        toApprove: 0,
        flagged: 0,
        cantAiGrade: 0,
        ungraded: 0,
      };
      groups.set(key, g);
    }
    g.items.push(it);
    if (it.to_approve) g.toApprove += 1;
    if (it.flagged) g.flagged += 1;
    if (it.cant_ai_grade) g.cantAiGrade += 1;
    if (!it.to_approve && !it.flagged && !it.cant_ai_grade) g.ungraded += 1;
  }
  return [...groups.values()];
}

/** The section review page, opened on the group's most urgent student. */
export function groupReviewHref(g: NeedsYouGroup): string {
  return studentReviewHref(g.items[0]);
}

export function studentReviewHref(item: NeedsAttentionItem): string {
  return (
    `/school/teacher/courses/${item.course_id}` +
    `/homework/${item.assignment_id}/sections/${item.section_id}/review` +
    `?student=${item.student_id}`
  );
}
