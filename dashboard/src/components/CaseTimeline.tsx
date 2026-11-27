import { activityDetail } from "../lib/activityActions";
import { formatRelativeDate } from "../lib/format";
import type { CaseGradingJob, CaseTimelineEvent, SubmissionCase } from "../lib/caseFile";

// Who did what to this grade, and when: the AI's run (on the schedule, or
// because a teacher pressed a button) and every step the teacher took
// after it — save, approve, reopen, publish. Read from the activity log
// and the grading job (api/routes/admin_case_timeline.py).

const num = (m: CaseTimelineEvent["metadata"], k: string) =>
  typeof m?.[k] === "number" ? (m[k] as number) : null;

function sentence(e: CaseTimelineEvent, student: string): string {
  const who = e.actor_name ?? "Someone";
  switch (e.action) {
    case "grading.auto":
      return e.metadata?.late
        ? "AI-graded automatically after the late turn-in"
        : "AI-graded automatically at due date";
    case "grade.regrade":
      return `${who} regraded with AI (replaced the grade)`;
    case "grading.requested":
      // A press from before Grade all / Grade with AI were logged.
      return `${who} requested AI grading (teacher-requested)`;
    case "grade.ai_batch": {
      const n = num(e.metadata, "queued");
      return `${who} pressed Grade all${n != null ? ` (${n})` : ""}`;
    }
    case "grade.ai_single":
      return `${who} pressed Grade for ${student}`;
    case "grade.save": {
      const s = num(e.metadata, "final_score");
      return `${who} saved the grade${s != null ? ` · ${Math.round(s)}%` : ""}`;
    }
    case "grade.mark_reviewed":
      return `${who} approved the grade`;
    case "grade.unmark_reviewed":
      return `${who} reopened the grade for review`;
    case "grade.publish": {
      const n = num(e.metadata, "published_count");
      return `${who} published grades${n != null ? ` (${n})` : ""}`;
    }
    default:
      return `${who}: ${activityDetail(e.action, e.metadata)}`;
  }
}

/** The job's state, when it says something the events don't: queued
 *  for later, failed, or running now. */
function jobNote(job: CaseGradingJob | null): string | null {
  if (!job) return null;
  switch (job.status) {
    case "queued":
      return job.scheduled_for
        ? `AI grading queued for ${new Date(job.scheduled_for).toLocaleString()}`
        : "AI grading waits for a teacher to press Grade (no due date)";
    case "running":
      return "AI grading is running now";
    case "failed":
      return `AI grading failed after ${job.attempts} attempt${job.attempts === 1 ? "" : "s"}${
        job.last_error ? `: ${job.last_error}` : ""
      }`;
    case "skipped":
      return "AI grading was skipped (nothing gradeable, or AI grading off)";
    default:
      return null;
  }
}

export default function CaseTimeline({ data }: { data: SubmissionCase }) {
  const note = jobNote(data.grading_job);
  if (data.timeline.length === 0 && !note) return null;
  const student = data.student_name ?? "this student";
  return (
    <section className="ct" aria-labelledby="ct-title">
      <h3 id="ct-title" className="cp-title">Grade timeline</h3>
      <ol className="ct-list">
        {data.timeline.map((e, i) => (
          <li key={`${e.action}-${e.at}-${i}`} className={`ct-item ct-${e.action.split(".")[0]}`}>
            <span className="ct-at" title={e.at}>{formatRelativeDate(e.at)}</span>
            <span className="ct-dot" aria-hidden="true" />
            <span className="ct-text">{sentence(e, student)}</span>
          </li>
        ))}
        {note && (
          <li className={`ct-item ct-note${data.grading_job?.status === "failed" ? " ct-failed" : ""}`}>
            <span className="ct-at">now</span>
            <span className="ct-dot" aria-hidden="true" />
            <span className="ct-text">{note}</span>
          </li>
        )}
      </ol>
    </section>
  );
}
