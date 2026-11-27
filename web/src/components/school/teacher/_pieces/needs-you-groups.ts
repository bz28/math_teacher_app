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
   *  toApprove — not released and not yet approved (Approve ✓ is owed)
   *  toPublish — not released, already approved (only Publish is owed);
   *              with toApprove, its share of "Publish N grades"
   *  flagged   — its Flagged chip
   *  cantAiGrade — its "N can't be AI-graded" note
   *  ungraded  — the rest: turned in, no grade yet, nothing blocking the
   *              AI (waiting on the due date or the student's confirm). */
  toApprove: number;
  toPublish: number;
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
        toPublish: 0,
        flagged: 0,
        cantAiGrade: 0,
        ungraded: 0,
      };
      groups.set(key, g);
    }
    g.items.push(it);
    if (it.to_approve) g.toApprove += 1;
    if (it.to_publish) g.toPublish += 1;
    if (it.flagged) g.flagged += 1;
    if (it.cant_ai_grade) g.cantAiGrade += 1;
    if (!it.to_approve && !it.to_publish && !it.flagged && !it.cant_ai_grade) g.ungraded += 1;
  }
  return [...groups.values()];
}

/** How many different students the queue holds — one student can have
 *  work waiting on several homeworks. */
export function studentCount(items: NeedsAttentionItem[]): number {
  return new Set(items.map((i) => i.student_id)).size;
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

export type StudentChip = "flagged" | "republish" | "to_approve" | "to_publish" | "cant_ai_grade" | "overdue" | "ungraded";

/** The one chip a student gets in an expanded row, from the same facts
 *  the row's counts are summed from — so a "1 to publish" row never
 *  lists its student as "Ungraded". Flagged first, as on the server. */
export function studentChip(item: NeedsAttentionItem): StudentChip {
  if (item.flagged) return "flagged";
  if (item.reason === "dirty") return "republish";
  if (item.to_approve) return "to_approve";
  if (item.to_publish) return "to_publish";
  if (item.cant_ai_grade) return "cant_ai_grade";
  return item.reason === "overdue" ? "overdue" : "ungraded";
}
