import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import StatusPill from "./StatusPill";
import { api } from "../lib/api";
import { UPLOAD_REJECTION_REASONS } from "../lib/activityActions";
import { formatRelativeDate } from "../lib/format";
import type { BlockedSubmissionsData } from "../lib/caseFile";

// Homework uploads the platform refused. A refused upload writes no
// submission, so without this a student our caps kept turning away looks
// exactly like one who never tried. Small by design: on a student's page
// it's their attempts, on a school's page its students'.

const DAYS = 30;

const mb = (n: number | null) => (n == null ? null : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function BlockedUploads({
  studentId, schoolId,
}: {
  studentId?: string;
  schoolId?: string;
}) {
  const [data, setData] = useState<BlockedSubmissionsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params: Record<string, string> = { days: String(DAYS) };
    if (studentId) params.student_id = studentId;
    if (schoolId) params.school_id = schoolId;
    api.blockedSubmissions(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [studentId, schoolId]);

  const onStudentPage = Boolean(studentId);
  return (
    <section className="bu" aria-labelledby="bu-title">
      <h3 id="bu-title" className="cp-title">
        Blocked uploads <span className="bu-window">last {DAYS} days</span>
      </h3>
      {error ? (
        <p className="cp-muted">Couldn't load blocked uploads.</p>
      ) : !data ? (
        <p className="cp-muted">Loading…</p>
      ) : data.students.length === 0 ? (
        <p className="cp-muted">
          {onStudentPage ? "No upload of theirs was refused." : "No student had an upload refused."}
        </p>
      ) : (
        <table className="bu-table">
          <thead>
            <tr>
              {!onStudentPage && <th>Student</th>}
              <th>Homework</th>
              <th className="cp-r">Tries</th>
              <th>Why</th>
              <th className="cp-r">Largest</th>
              <th>Last try</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.students.map((r) => (
              <tr key={`${r.student_id ?? "gone"}-${r.assignment_id}`}>
                {!onStudentPage && (
                  <td>
                    {r.student_id ? <Link to={`/students/${r.student_id}`}>{r.student_name}</Link> : <span className="cp-muted">{r.student_name}</span>}
                  </td>
                )}
                <td>
                  {r.assignment_title ?? <span className="cp-muted">deleted homework</span>}
                  {r.course_name && <span className="cp-muted"> · {r.course_name}</span>}
                </td>
                <td className="cp-r cp-mono">{r.attempts}</td>
                <td title={Object.entries(r.reasons).map(([k, n]) => `${UPLOAD_REJECTION_REASONS[k] ?? k} × ${n}`).join("\n")}>
                  {UPLOAD_REJECTION_REASONS[r.top_reason] ?? r.top_reason}
                  {Object.keys(r.reasons).length > 1 && <span className="cp-muted"> +{Object.keys(r.reasons).length - 1}</span>}
                </td>
                <td className="cp-r cp-mono">{mb(r.largest_request_bytes) ?? "—"}</td>
                <td title={r.last_at}>{formatRelativeDate(r.last_at)}</td>
                <td>
                  {r.submitted_since
                    ? <StatusPill tone="ok" label="GOT THROUGH" title="Turned this homework in after the last refusal" />
                    : <StatusPill tone="danger" label="STILL BLOCKED" title="No turn-in since the last refusal" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
