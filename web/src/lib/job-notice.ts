// The notes finished generation jobs show beside their problems. A set
// that came back short (a problem whose diagram couldn't be confirmed is
// left out, never swapped for an off-topic one) says so in its own
// `notice` field, which is not an error: the job is done.

export interface NoticeJob {
  id: string;
  status: string;
  notice?: string | null;
}

/** The notices to show: finished jobs that carry one, once nothing is
 *  still generating (the progress strip owns the screen until then). */
export function jobNotices(jobs: NoticeJob[], stillGenerating: boolean): { id: string; text: string }[] {
  if (stillGenerating) return [];
  return jobs
    .filter((j) => j.status === "done" && typeof j.notice === "string" && j.notice.trim() !== "")
    .map((j) => ({ id: j.id, text: j.notice as string }));
}
