"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";

interface Props {
  assignmentId: string;
  onClose: () => void;
}

/**
 * Modal that lists all submissions for a homework, with a click-to-
 * expand per-submission detail subview. Wired up from the
 * `⚙ Submissions` button in homework-detail-modal.tsx (was a
 * placeholder; now a real view).
 *
 * No grading or annotations in this PR — just "here's what they
 * turned in." Reuses the existing list endpoint
 * `/v1/teacher/assignments/{id}/submissions` and the new detail
 * endpoint `/v1/teacher/submissions/{id}`.
 */
export function SubmissionsPanel({ assignmentId, onClose }: Props) {
  const [rows, setRows] = useState<TeacherSubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  // Derived: we're loading the detail iff a row is open and the
  // detail object hasn't arrived yet. Avoids a separate state slice
  // (and the cascading-render lint rule that comes with setting it
  // synchronously inside the fetch effect).
  const detailLoading = openId !== null && detail === null;

  useEffect(() => {
    teacher
      .listAssignmentSubmissions(assignmentId)
      .then((d) => setRows(d.submissions))
      .catch(() => setError("Couldn't load submissions."));
  }, [assignmentId]);

  useEffect(() => {
    // Only fetch when transitioning into the detail view. Clearing
    // the detail when openId becomes null happens in the close-row
    // handler below — keeping the effect "fetch only" satisfies
    // the no-cascading-render rule and matches the React docs'
    // recommended pattern (https://react.dev/learn/you-might-not-need-an-effect).
    if (!openId) return;
    let cancelled = false;
    teacher
      .submissionDetail(openId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load submission detail.");
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  function closeDetail() {
    setOpenId(null);
    setDetail(null);
  }

  return (
    // z-[60] (one layer above the homework detail modal's z-50) so the
    // panel paints on top instead of behind it. Click outside the
    // dialog body closes the panel for a snappy escape.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-[--radius-lg] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
          <h2 className="text-lg font-bold text-text-primary">
            {openId && detail ? `${detail.student_name} — ${detail.assignment_title}` : "Submissions"}
          </h2>
          <button
            onClick={openId ? closeDetail : onClose}
            className="rounded-[--radius-sm] border border-border-light px-3 py-1 text-xs font-bold text-text-secondary hover:bg-bg-subtle"
          >
            {openId ? "← Back to list" : "Close"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <p className="text-sm text-error">{error}</p>}

          {!openId && rows === null && !error && (
            <p className="text-sm text-text-muted">Loading…</p>
          )}

          {!openId && rows && rows.length === 0 && (
            <p className="text-sm text-text-muted">No submissions yet.</p>
          )}

          {!openId && rows && rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="flex cursor-pointer items-center justify-between rounded-[--radius-sm] border border-border bg-surface p-4 hover:border-primary"
                >
                  <div>
                    <div className="text-sm font-semibold text-text-primary">
                      {r.student_name || r.student_email}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">{r.student_email}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    {r.is_late && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
                        LATE
                      </span>
                    )}
                    {r.submitted_at && (
                      <span>{new Date(r.submitted_at).toLocaleDateString()}</span>
                    )}
                    <span>→</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {openId && detailLoading && (
            <p className="text-sm text-text-muted">Loading…</p>
          )}

          {openId && detail && (
            <div className="space-y-6">
              <div className="text-xs text-text-muted">
                Submitted {new Date(detail.submitted_at).toLocaleString()}
                {detail.is_late && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
                    LATE
                  </span>
                )}
              </div>

              {detail.problems.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-text-primary">Per-problem answers</div>
                  <ul className="mt-2 space-y-3">
                    {detail.problems.map((p) => (
                      <li
                        key={p.bank_item_id}
                        className="rounded-[--radius-sm] border border-border bg-background p-3"
                      >
                        <div className="text-xs font-bold text-text-muted">
                          Problem {p.position}
                        </div>
                        <div className="mt-1 text-sm text-text-primary">
                          <MathText text={p.question} />
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                              Student answered
                            </div>
                            <div className="mt-0.5 text-text-secondary">
                              {p.student_answer ? (
                                <MathText text={p.student_answer} />
                              ) : (
                                <span className="italic text-text-muted">— blank —</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                              Answer key
                            </div>
                            <div className="mt-0.5 text-text-secondary">
                              {p.final_answer ? <MathText text={p.final_answer} /> : "—"}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.image_data && (
                <div>
                  <div className="text-sm font-semibold text-text-primary">Submitted work</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      detail.image_data.startsWith("data:")
                        ? detail.image_data
                        : `data:image/jpeg;base64,${detail.image_data}`
                    }
                    alt={`${detail.student_name}'s submitted homework`}
                    className="mt-2 max-h-[600px] w-full rounded-[--radius-sm] border border-border object-contain"
                  />
                </div>
              )}

              {!detail.image_data && detail.problems.every((p) => !p.student_answer) && (
                <p className="text-sm text-text-muted">No content was submitted.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
