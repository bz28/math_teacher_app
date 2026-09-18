import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type TeacherReportData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { KIND_LABEL, KIND_TONE, gradeLabel, whereLabel } from "../lib/reports";
import { btnGhost, btnPrimary } from "../lib/styles";
import { useToast } from "../lib/toast";
import ErrorState from "../components/ErrorState";
import StatusPill from "../components/StatusPill";
import MathText from "../components/MathText";

/**
 * One teacher report, in full — the teacher's note, the AI's call
 * beside the teacher's, the problem text, and links into the case
 * file. Resolving takes an internal note so the next person can see
 * what was done without re-deriving it.
 */
export default function ReportDetail() {
  const { reportId } = useParams<{ reportId: string }>();
  const toast = useToast();
  const [r, setR] = useState<TeacherReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    api
      .report(reportId)
      .then((d) => {
        if (cancelled) return;
        setR(d);
        setNote(d.resolution_note ?? "");
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, attempt]);
  const load = useCallback(() => setAttempt((n) => n + 1), []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!r) return <p className="muted">Loading…</p>;

  const setStatus = async (status: "open" | "resolved") => {
    setSaving(true);
    try {
      const updated = await api.updateReport(r.id, { status, resolution_note: note.trim() || null });
      setR(updated);
      toast(status === "resolved" ? "Marked resolved." : "Reopened.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const ai = r.ai_grade;

  return (
    <div className="case-file">
      <div className="case-head">
        <div>
          <div className="case-meta" style={{ marginBottom: 6 }}>
            <Link to="/reports" className="case-meta-link">← Reports</Link>
            <span className="case-meta-id">#{r.id.slice(0, 8)}</span>
            <span>{formatRelativeDate(r.created_at)}</span>
          </div>
          <h1 style={{ marginBottom: 6 }}>{KIND_LABEL[r.kind]}</h1>
          <div className="case-meta">
            <strong className="case-meta-item">{r.teacher_name ?? "Unknown teacher"}</strong>
            {r.teacher_email && <span className="case-meta-item">{r.teacher_email}</span>}
            {r.course_name && <span className="case-meta-item">{r.course_name}</span>}
          </div>
        </div>
        <div className="case-head-pills">
          <StatusPill tone={KIND_TONE[r.kind]} label={KIND_LABEL[r.kind]} />
          <StatusPill tone={r.status === "open" ? "live" : "ok"} label={r.status === "open" ? "Open" : "Resolved"} />
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 20, gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr)", gap: 20, alignItems: "start" }}>
        <section className="table-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <span className="eyebrow">What the teacher said</span>
            {r.note ? (
              <blockquote
                style={{
                  margin: "8px 0 0", padding: "10px 14px", borderLeft: "3px solid var(--warn)",
                  background: "var(--warn-soft)", borderRadius: "0 4px 4px 0",
                  fontFamily: "var(--font-display)", fontSize: 17, lineHeight: 1.45, fontStyle: "italic",
                }}
              >
                {r.note}
              </blockquote>
            ) : (
              <p className="muted" style={{ margin: "8px 0 0" }}>No note — the kind and the attached context are the whole report.</p>
            )}
          </div>

          <div>
            <span className="eyebrow">Where</span>
            <p style={{ margin: "6px 0 0", fontSize: 14 }}>{whereLabel(r)}</p>
            {r.problem_question && (
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                <strong style={{ color: "var(--ink)" }}>Problem {r.problem_position ?? ""}:</strong>{" "}
                <MathText>{r.problem_question}</MathText>
              </p>
            )}
          </div>

          {r.submission_id && (
            <div>
              <span className="eyebrow">The grade in question</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                <div style={{ padding: "10px 12px", background: "var(--paper-2)", borderRadius: 4 }}>
                  <div className="eyebrow" style={{ fontSize: 10 }}>AI gave</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ok)" }}>{gradeLabel(ai)}</div>
                  {ai?.confidence != null && (
                    <div className="muted" style={{ fontSize: 12 }}>confidence {Math.round(ai.confidence * 100)}%</div>
                  )}
                </div>
                <div style={{ padding: "10px 12px", background: "var(--paper-2)", borderRadius: 4 }}>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Teacher gave</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--warn)" }}>{gradeLabel(r.teacher_grade)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>at the time of the report</div>
                </div>
              </div>
              {ai?.reasoning && (
                <p className="muted" style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--ink)" }}>AI reasoning:</strong> <MathText>{ai.reasoning}</MathText>
                </p>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {r.submission_id && (
              <Link to={`/submissions/${r.submission_id}/trace`} style={btnGhost}>Open submission trace ↗</Link>
            )}
            {r.student_id && (
              <Link to={`/students/${r.student_id}`} style={btnGhost}>Student's case file ↗</Link>
            )}
            {r.teacher_id && (
              <Link to={`/teachers/${r.teacher_id}`} style={btnGhost}>Teacher ↗</Link>
            )}
            {r.page_url && (
              <a href={r.page_url} target="_blank" rel="noreferrer" style={btnGhost}>Page they were on ↗</a>
            )}
          </div>
        </section>

        <aside className="table-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Resolution</span>
          <label htmlFor="resolution" className="muted" style={{ fontSize: 12 }}>
            Internal note — what was done, or why nothing needed doing.
          </label>
          <textarea
            id="resolution"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Root cause: extractor never described drawings. Fixed in #912."
            style={{
              width: "100%", boxSizing: "border-box", resize: "vertical", padding: "8px 10px",
              border: "1px solid var(--rule-strong)", borderRadius: 4, background: "var(--surface)",
              font: "inherit", fontSize: 13, lineHeight: 1.5,
            }}
          />
          {r.status === "open" ? (
            <button type="button" style={btnPrimary} disabled={saving} onClick={() => setStatus("resolved")}>
              {saving ? "Saving…" : "Mark resolved"}
            </button>
          ) : (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Resolved {r.resolved_at ? formatRelativeDate(r.resolved_at) : ""}.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={btnGhost} disabled={saving} onClick={() => setStatus("resolved")}>
                  {saving ? "Saving…" : "Save note"}
                </button>
                <button type="button" style={btnGhost} disabled={saving} onClick={() => setStatus("open")}>
                  Reopen
                </button>
              </div>
            </>
          )}
          {r.teacher_email && (
            <a
              href={`mailto:${r.teacher_email}?subject=${encodeURIComponent(`Re: your Veradic report — ${KIND_LABEL[r.kind]}`)}`}
              style={{ ...btnGhost, textAlign: "center" }}
            >
              Email the teacher
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
