import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ExtractionDetail, type TeacherReportData } from "../lib/api";
import { problemAnchor } from "../lib/anchor";
import { formatRelativeDate, shortId } from "../lib/format";
import { KIND_LABEL, creditLabel, fmtGap, gradeGap, gradeValue, pagePath, whereLabel } from "../lib/reports";
import { btnGhost, btnPrimary } from "../lib/styles";
import { useToast } from "../lib/toast";
import ErrorState from "../components/ErrorState";
import StatusPill from "../components/StatusPill";
import MathText from "../components/MathText";
import ExtractionReadout, { ReadRow, WorkFile } from "../components/ExtractionReadout";

/**
 * One teacher report, as a case: what the teacher said and how far the
 * AI was from them, then the evidence for the problem they reported —
 * the photo, what the AI read, why it graded as it did — without leaving
 * the page. One click opens the full submission at that problem.
 *
 * The teacher's own page is deliberately NOT the primary drill-in: the
 * teacher review page is membership-gated, and an admin opening it gets a
 * 404. The console's own trace and assignment pages carry the same facts
 * and are what every link here points at. The raw URL survives only as a
 * clearly labelled secondary link — it still says which screen the
 * teacher was on, which matters most for a sidebar report with nothing
 * else attached.
 */
export default function ReportDetail() {
  const { reportId } = useParams<{ reportId: string }>();
  const toast = useToast();
  const [r, setR] = useState<TeacherReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // The student's work behind the report. Keyed by submission id so a
  // stale response for another report can never render here; failure is
  // non-fatal — the report still reads, and the trace link still works.
  const [work, setWork] = useState<
    { id: string; data: ExtractionDetail | null; failed: boolean } | null
  >(null);

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
        const sid = d.submission_id;
        if (!sid) return;
        api
          .extractionDetail(sid)
          .then((w) => !cancelled && setWork({ id: sid, data: w, failed: false }))
          .catch(() => !cancelled && setWork({ id: sid, data: null, failed: true }));
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

  const pos = r.problem_position;
  const hash = pos ? `#${problemAnchor(pos)}` : "";
  const teacherPage = r.page_url && /^https?:\/\//i.test(r.page_url) ? r.page_url : null;
  const currentWork = work && work.id === r.submission_id ? work : null;

  return (
    <div className="rpt-case">
      <div className="case-head">
        <div>
          <div className="case-meta" style={{ marginBottom: 6 }}>
            <Link to="/reports" className="case-meta-link">← Reports</Link>
            <span className="case-meta-id" title={r.id}>#{shortId(r.id)}</span>
            <span title={r.created_at}>{formatRelativeDate(r.created_at)}</span>
          </div>
          <h1 style={{ marginBottom: 6 }}>{KIND_LABEL[r.kind]}</h1>
          <div className="case-meta">
            <span className="case-meta-item">
              {r.submission_id ? whereLabel(r) : `Sidebar · ${pagePath(r.page_url) ?? "no page recorded"}`}
            </span>
            {r.course_name && <span className="case-meta-item case-meta-muted">{r.course_name}</span>}
          </div>
        </div>
        <div className="case-head-pills">
          <StatusPill
            tone={r.status === "open" ? "live" : "ok"}
            label={r.status === "open" ? "Open" : "Resolved"}
            pulse={r.status === "open"}
          />
        </div>
      </div>

      <div className="rpt-body">
        <main className="rpt-main">
          {/* ── The answer band: what they said, and how far apart ── */}
          <figure className="rpt-said">
            {r.note ? (
              <blockquote className="rpt-quote">{r.note}</blockquote>
            ) : (
              <p className="rpt-quote rpt-quote-empty">No note — the kind and what's attached are the whole report.</p>
            )}
            <figcaption className="rpt-said-by">
              {r.teacher_id ? (
                <Link to={`/teachers/${r.teacher_id}`}>{r.teacher_name ?? "Unknown teacher"}</Link>
              ) : (
                (r.teacher_name ?? "Unknown teacher")
              )}
              {r.teacher_email && <span className="muted"> · {r.teacher_email}</span>}
            </figcaption>
          </figure>

          {r.submission_id && <GradeBand r={r} />}

          <nav className="rpt-actions" aria-label="Open the context">
            {r.submission_id ? (
              <Link to={`/submissions/${r.submission_id}/trace${hash}`} style={btnPrimary}>
                {pos ? `Open submission at Problem ${pos}` : "Open submission"}
              </Link>
            ) : null}
            {r.assignment_id && (
              <Link to={`/assignments/${r.assignment_id}${hash}`} style={btnGhost}>Homework</Link>
            )}
            {r.student_id && (
              <Link to={`/students/${r.student_id}`} style={btnGhost}>Student</Link>
            )}
            {r.teacher_id && (
              <Link to={`/teachers/${r.teacher_id}`} style={btnGhost}>Teacher</Link>
            )}
            {teacherPage && (
              <a
                href={teacherPage}
                target="_blank"
                rel="noreferrer"
                className="rpt-teacher-page"
                title="The page the teacher was on. It only opens for someone signed in as that teacher."
              >
                Teacher's view ↗ <span>teacher login only</span>
              </a>
            )}
          </nav>

          {r.submission_id && (
            <Evidence r={r} work={currentWork?.data ?? null} failed={!!currentWork?.failed} loading={!currentWork} />
          )}
        </main>

        <aside className="rpt-rail">
          <h3>Resolution</h3>
          <label htmlFor="resolution" className="muted" style={{ fontSize: 12 }}>
            Internal note — what was done, or why nothing needed doing.
          </label>
          <textarea
            id="resolution"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Root cause: extractor never described drawings. Fixed in #912."
            className="rpt-note-input"
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

/** AI gave · teacher gave · the gap — the disagreement at a glance. The
 *  grades are the snapshot taken when the teacher reported, so this reads
 *  the same after a regrade. */
function GradeBand({ r }: { r: TeacherReportData }) {
  const ai = gradeValue(r.ai_grade);
  const teacher = gradeValue(r.teacher_grade);
  const gap = gradeGap(r);
  if (ai === null && teacher === null) return null;
  return (
    <div className="case-decisions rpt-grades">
      <div className="case-decision">
        <div className="case-decision-label">AI gave</div>
        <div className="case-decision-value">{ai === null ? "—" : `${ai}%`}</div>
        <div className="case-decision-sub">
          {r.ai_grade ? creditLabel(r.ai_grade) : "no AI grade"}
          {r.ai_grade?.confidence != null && ` · confidence ${Math.round(r.ai_grade.confidence * 100)}%`}
        </div>
      </div>
      <div className="case-decision">
        <div className="case-decision-label">Teacher gave</div>
        <div className="case-decision-value">{teacher === null ? "—" : `${teacher}%`}</div>
        <div className="case-decision-sub">{creditLabel(r.teacher_grade)} · when they reported</div>
      </div>
      <div className="case-decision">
        <div className="case-decision-label">Gap</div>
        <div className={`case-decision-value${gap !== null && gap !== 0 ? " rpt-gap-value" : ""}`}>
          {gap === null ? "—" : `${fmtGap(gap)} pts`}
        </div>
        <div className="case-decision-sub">
          {gap === null
            ? "one side has no grade"
            : gap < 0
              ? "the AI gave more credit"
              : gap > 0
                ? "the AI gave less credit"
                : "same grade — see the note"}
        </div>
      </div>
    </div>
  );
}

/**
 * Which photos to show for a problem: the pages Vision said its rows came
 * from; the only page when there is one; otherwise every page, flagged as
 * a guess so nobody reads the wrong photo as the evidence.
 */
function pagesFor(work: ExtractionDetail, pos: number): { indices: number[]; known: boolean } {
  const n = work.files.length;
  const pages = new Set<number>();
  for (const row of work.rows) {
    if (row.problem_position === pos && row.page_index !== null && row.page_index <= n) {
      pages.add(row.page_index - 1);
    }
  }
  if (pages.size) return { indices: [...pages].sort((a, b) => a - b), known: true };
  if (n === 1) return { indices: [0], known: true };
  return { indices: work.files.map((_, i) => i), known: false };
}

function Evidence({
  r,
  work,
  failed,
  loading,
}: {
  r: TeacherReportData;
  work: ExtractionDetail | null;
  failed: boolean;
  loading: boolean;
}) {
  const pos = r.problem_position;
  const reasoning = r.ai_grade?.reasoning?.trim();

  const head = (
    <div className="rpt-evidence-head">
      <h3>{pos ? `The evidence · Problem ${pos}` : "The evidence · whole submission"}</h3>
      {r.problem_question && (
        <div className="rpt-question">
          <MathText>{r.problem_question}</MathText>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <section className="rpt-evidence">
        {head}
        <p className="muted">Loading the student's work…</p>
      </section>
    );
  }
  if (failed || !work) {
    return (
      <section className="rpt-evidence">
        {head}
        <p className="empty-mini">
          The student's work didn't load here. The submission trace above has it.
        </p>
        {reasoning && <Reasoning text={reasoning} />}
      </section>
    );
  }

  // A whole-submission report is about all of it — show the whole read.
  if (!pos) {
    return (
      <section className="rpt-evidence">
        {head}
        <ExtractionReadout detail={work} />
      </section>
    );
  }

  const rows = work.rows.filter((row) => row.problem_position === pos);
  const { indices, known } = pagesFor(work, pos);
  return (
    <section className="rpt-evidence">
      {head}
      <div className="xq-detail">
        <div className="xq-shot">
          {work.files.length === 0 ? (
            <div className="xq-shot-empty">No image stored for this submission.</div>
          ) : (
            <>
              {indices.map((i) => (
                <figure key={i} className="rpt-page">
                  <WorkFile file={work.files[i]} index={i} />
                  <figcaption>
                    {work.files[i].media_type === "application/pdf" ? "File" : "Page"} {i + 1} of{" "}
                    {work.files.length}
                  </figcaption>
                </figure>
              ))}
              {!known && (
                <p className="rpt-page-note">
                  The reader didn't record which page Problem {pos} is on, so every page is shown.
                </p>
              )}
            </>
          )}
        </div>
        <div>
          <span className="xq-read-label rpt-col-label">What the AI read</span>
          {rows.length === 0 ? (
            <p className="empty-mini">
              {work.extraction_present
                ? `The reader found nothing for Problem ${pos}.`
                : "No read has been stored for this submission."}
            </p>
          ) : (
            <ol className="xq-rows">
              {rows.map((row) => <ReadRow key={row.key} row={row} />)}
            </ol>
          )}
          {reasoning && <Reasoning text={reasoning} />}
        </div>
      </div>
    </section>
  );
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="rpt-reasoning">
      <span className="xq-read-label">Why the AI graded it that way</span>
      <p>
        <MathText>{text}</MathText>
      </p>
    </div>
  );
}
