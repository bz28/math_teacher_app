import type { SubmissionsInboxRow } from "@/lib/api";

/** What's waiting on the teacher in one section, as the review page
 *  and the home queue count it:
 *  toApprove — grades not yet out that still want Approve ✓
 *  toPublish — grades not yet out, already approved: only Publish left
 *              (with toApprove, the section's share of "Publish N grades")
 *  notGraded — turned in with no grade yet (the AI hasn't reached it, it
 *              can't, or it's waiting on the student) */
export function sectionCounts(r: SubmissionsInboxRow) {
  const toPublish = r.to_publish;
  const toApprove = Math.max(0, r.to_grade + r.dirty - toPublish);
  const notGraded = Math.max(0, r.submitted - r.published - r.to_grade);
  const allOut = r.submitted > 0 && r.published === r.submitted && r.dirty === 0;
  return { toApprove, toPublish, notGraded, allOut };
}
