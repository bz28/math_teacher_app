import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type StudentDetailData,
  type StudentSubmissionRow,
  type SubmissionStage,
} from "../lib/api";
import {
  fmtAge, fmtCost, fmtClockTime, formatRelativeDate,
} from "../lib/format";
import { activityPill, activityStatus } from "../lib/definitions";
import { STAGE_META, STAGE_ORDER, isStalled } from "../lib/stages";
import DataTable, { type Column } from "../components/DataTable";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import { useScopeToSchool } from "../lib/useSelectedSchool";

/**
 * Per-student drill-in — the case file for one kid's work.
 *
 * The console could show you a teacher and it could show you an
 * aggregate quality report, but it could not show you a student.
 * Clicking one took you to a raw list of model invocations, which
 * answers a question nobody asked. Every fact needed was already
 * stored; what was missing was a door.
 *
 * The funnel is the page's argument. Counting submissions says a
 * student is participating; counting how many reached a published grade
 * says whether the product worked for them, and the shortfall is
 * itemised by the hop it died on. So the strip weights the STALLED
 * stages, not the settled ones — a funnel that colours "published"
 * green and leaves "awaiting confirm" grey is optimising for
 * reassurance on a page built for finding stuck work.
 */

const FETCH_LIMIT = 200;

function fmtScore(n: number | null): string {
  return n === null ? "—" : `${Math.round(n)}%`;
}

/** How long this submission has sat where it is. The finding on this
 *  page is nearly always a gap, not an event. Shares `fmtAge` with the
 *  submission trace so the same stall cannot read "waiting 5d" here and
 *  "waiting 6d" one click later. */
function waited(since: string | null): string | null {
  return since ? fmtAge(since) : null;
}

// How long past its scheduled time a queued job can sit before the
// delay means something is wrong rather than busy.
//
// This is deliberately an hour, not the drain's 5-minute cadence. One
// pass claims at most DEFAULT_DRAIN_LIMIT = 200 jobs, passes cannot
// overlap (`concurrency: grading-drain`, `cancel-in-progress: false`),
// and each is capped at `--max-time 600`. So a class night that puts
// 1000 jobs in one due-date window legitimately takes ~5 serialized
// passes — the better part of an hour — to clear, with every unclaimed
// job sitting past due the whole time and nothing at all wrong.
//
// A 15-minute window (three cron ticks) assumed each pass claims
// everything due. It doesn't, so that threshold would have painted a
// district's busiest evening red — crying wolf on the one night an
// operator most needs to trust this page, which is the inverse of the
// bug it was added to fix. An hour clears any plausible backlog and is
// still well inside a school day for a real drain outage.
const DRAIN_GRACE_MS = 60 * 60_000;

function queuedNote(
  scheduledFor: string | null,
): { text: string; bad: boolean } {
  if (!scheduledFor) {
    // NULL means the assignment has no due date, so the job genuinely
    // waits for a teacher to ask. Not overdue, just unscheduled.
    return { text: "grading waiting on the teacher", bad: false };
  }
  const overdueBy = Date.now() - new Date(scheduledFor).getTime();
  if (overdueBy > DRAIN_GRACE_MS) {
    const age = fmtAge(scheduledFor);
    return {
      text: age ? `grading overdue by ${age}` : "grading overdue",
      bad: true,
    };
  }
  return {
    text: `grading queued for ${fmtClockTime(scheduledFor)}`,
    bad: false,
  };
}

export default function StudentDetail() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudentDetailData | null>(null);
  const [rows, setRows] = useState<StudentSubmissionRow[] | null>(null);
  // Server-side total, so the page can tell when the table is holding a
  // prefix of it. The funnel counts every submission and the table
  // fetches FETCH_LIMIT of them — past that the two legitimately
  // disagree, and an admin page that lets a number contradict the list
  // under it without saying so is one nobody trusts again.
  const [total, setTotal] = useState<number | null>(null);
  // Split per fetch. Sharing one slot meant a 500 on the SUBMISSIONS
  // call rendered "Student not found" for a student whose detail call
  // had just succeeded — a false statement about someone who
  // demonstrably exists, on the page whose whole value is being
  // trustworthy. Only a failure to resolve the student is fatal; the
  // table failing is a table-shaped problem and says so there.
  const [error, setError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  // Clicking a funnel cell filters the table to that stage — what makes
  // the strip a tool rather than a readout.
  const [stageFilter, setStageFilter] = useState<SubmissionStage | null>(null);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    // Reset every per-student piece of state: navigating from student A
    // to student B must not leave A's rows under B's header.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setRows(null);
    setTotal(null);
    setError(null);
    setRowsError(null);
    setStageFilter(null);
    api
      .studentDetail(studentId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    api
      .studentSubmissions(studentId, { limit: String(FETCH_LIMIT) })
      .then((d) => {
        if (cancelled) return;
        setRows(d.submissions);
        setTotal(d.total);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setRows([]);
        setRowsError(e.message);
      });
    return () => { cancelled = true; };
  }, [studentId]);

  // Tell the rail which school this page is showing, so the switcher
  // can't name a different one an inch from the breadcrumb.
  useScopeToSchool(
    data?.student.school?.kind === "institutional"
      ? data.student.school.id
      : null,
  );

  const visible = useMemo(
    () => (stageFilter ? (rows ?? []).filter((r) => r.stage === stageFilter) : rows ?? []),
    [rows, stageFilter],
  );

  const columns: Column<StudentSubmissionRow>[] = [
    {
      key: "assignment",
      header: "Assignment",
      width: "26%",
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)" }}>{r.assignment_title ?? "—"}</div>
          <div className="sd-dim" style={{ fontSize: 12 }}>
            {r.course_name ?? "no course"}
          </div>
        </div>
      ),
      sortValue: (r) => r.assignment_title ?? "",
    },
    {
      key: "stage",
      header: "Stage",
      width: "22%",
      render: (r) => {
        const meta = STAGE_META[r.stage];
        const w = waited(r.stage_since);
        // A confirmed submission with no grade is the question this
        // column has to answer. The durable queue answers it when a job
        // exists — but the absence of a job is itself an answer, and an
        // earlier version rendered nothing at all in that case, so the
        // row said CONFIRMED and stopped while the pill's tooltip
        // promised "grading queued". Two reachable states have no job
        // and no grade coming: AI grading switched off for the HW, and
        // an unreadable read, which `confirm-extraction` deliberately
        // never queues. Both now say so.
        const job = r.grading_job;
        const jobNote = r.stage !== "confirmed" ? null : !job
          ? r.ai_grading_status === "skipped_unreadable"
            ? { text: "unreadable — no grade coming", bad: true }
            : !r.ai_grading_enabled
              ? { text: "AI grading off — teacher grades by hand", bad: false }
              : { text: "confirmed but never queued", bad: true }
          : job.status === "failed"
            ? { text: `grading failed after ${job.attempts} tries`, bad: true }
            : job.status === "skipped"
              // Terminal with no grade, and deliberately not "done".
              ? { text: "grading skipped — no grade coming", bad: true }
              : job.status === "queued"
                ? queuedNote(job.scheduled_for)
                : { text: `grading ${job.status}`, bad: false };
        return (
          <div>
            <StatusPill tone={meta.tone} label={meta.label} title={meta.blurb} />
            {isStalled(r.stage) && w && (
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}
              >
                waiting {w}
              </div>
            )}
            {jobNote && (
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: jobNote.bad ? "var(--danger)" : "var(--muted)",
                  marginTop: 4,
                }}
                title={job?.last_error ?? undefined}
              >
                {jobNote.text}
              </div>
            )}
          </div>
        );
      },
      sortValue: (r) => STAGE_ORDER.indexOf(r.stage),
    },
    {
      key: "read",
      header: "What the reader got",
      width: "18%",
      // Describes the READ and what the student did about it. An earlier
      // version said "read accepted" whenever nothing was edited, which
      // labelled an unconfirmed read — and a rejected one — as accepted:
      // the two rows on this page where that claim is exactly backwards.
      render: (r) => {
        if (!r.extraction_present) {
          return <span className="sd-dim">no read</span>;
        }
        if (r.extraction_empty) {
          return <span style={{ color: "var(--danger)" }}>read nothing</span>;
        }
        if (r.flagged_at) {
          return <span style={{ color: "var(--warn)" }}>student rejected it</span>;
        }
        if (!r.confirmed_at) {
          return (
            <span style={{ color: "var(--danger)" }}>not yet reviewed</span>
          );
        }
        return (
          <span className="sd-dim">
            {r.extraction_edited ? "student corrected it" : "read accepted"}
          </span>
        );
      },
      sortValue: (r) => (r.extraction_present ? (r.extraction_empty ? 1 : 2) : 0),
    },
    {
      key: "submitted",
      header: "Submitted",
      render: (r) => (
        <span className="mono" title={r.submitted_at ?? undefined}>
          {r.submitted_at ? fmtClockTime(r.submitted_at) : "—"}
          {r.is_late && <span className="sd-dim"> late</span>}
        </span>
      ),
      sortValue: (r) => r.submitted_at ?? "",
    },
    {
      key: "score",
      header: "AI → final",
      align: "right",
      numeric: true,
      render: (r) => {
        if (r.ai_score === null && r.final_score === null) {
          return <span className="sd-dim">—</span>;
        }
        if (!r.overridden) {
          return (
            <span className="mono">{fmtScore(r.final_score ?? r.ai_score)}</span>
          );
        }
        return (
          <span className="mono score-override">
            {fmtScore(r.ai_score)} → <strong>{fmtScore(r.final_score)}</strong>
          </span>
        );
      },
      sortValue: (r) =>
        r.overridden
          ? Math.abs((r.final_score ?? 0) - (r.ai_score ?? 0))
          : -1,
    },
    {
      key: "calls",
      header: "Calls",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className="mono">
          {r.call_count}
          {r.failed_count > 0 && (
            <span style={{ color: "var(--danger)" }}> · {r.failed_count} failed</span>
          )}
        </span>
      ),
      sortValue: (r) => r.call_count,
    },
  ];

  // Only a failure to resolve the STUDENT is fatal — see the state
  // declaration. A failed submissions fetch surfaces in the table.
  if (error) {
    return (
      <div className="page-header">
        <h1>Couldn't load this student</h1>
        <p>{error}</p>
        <Link to="/users?role=student" className="link-btn">
          ← Back to students
        </Link>
      </div>
    );
  }
  if (!data) return <p className="loading">Loading…</p>;

  const s = data.student;
  const health = activityPill(activityStatus(s.last_active_at));
  const breadcrumb =
    s.school && s.school.kind === "institutional"
      ? { to: `/schools/${s.school.id}`, label: s.school.name }
      : { to: "/students/independent", label: "Independent students" };

  const truncated = total !== null && rows !== null && total > rows.length;

  const stalledCount = STAGE_ORDER.filter(isStalled).reduce(
    (n, st) => n + (data.funnel[st] ?? 0),
    0,
  );

  return (
    <div>
      <Link to={breadcrumb.to} className="link-btn">
        ← {breadcrumb.label}
      </Link>

      <div className="case-head" style={{ marginTop: 12 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Student</span>
          <h1 style={{ marginBottom: 4 }}>{s.name}</h1>
          <div className="case-meta">
            <span className="case-meta-item">{s.email}</span>
            {s.grade_level != null && (
              <span className="case-meta-item">Grade {s.grade_level}</span>
            )}
            {data.sections.map((sec) => (
              <span key={sec.id} className="case-meta-item">
                {sec.course_name} · {sec.name}
                {sec.teachers.length > 0 && (
                  <>
                    {" — "}
                    {sec.teachers.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && ", "}
                        <Link to={`/teachers/${t.id}`} className="case-meta-link">
                          {t.name}
                        </Link>
                      </span>
                    ))}
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
        <StatusPill tone={health.tone} label={health.label} />
      </div>

      <div className="tile-grid">
        <StatTile
          label="Handed in"
          value={data.total_submissions.toLocaleString()}
          sub="submissions all time"
        />
        <StatTile
          label="Stuck"
          value={stalledCount.toLocaleString()}
          tone={stalledCount > 0 ? "danger" : "default"}
          sub="waiting on a read or a confirm"
        />
        <StatTile
          label="Last handed in"
          value={
            s.last_submitted_at ? formatRelativeDate(s.last_submitted_at) : "never"
          }
          // "Last active" folds in tutoring, logged actions AND
          // submissions, so it must not be worded as "opened the app" —
          // that named one narrow source and read as a flat
          // contradiction of the number directly above it.
          sub={
            s.last_active_at
              ? `last active ${formatRelativeDate(s.last_active_at)}`
              : "no activity on record"
          }
        />
        <StatTile
          label="AI cost · 30d"
          value={fmtCost(s.total_cost_30d)}
          sub={`${s.call_count_30d.toLocaleString()} calls`}
        />
      </div>

      {/* ── The funnel. Position encodes the sequence, so no numbering;
          the underbar carries the shape and the number stays legible at
          any count. Stalled stages take the weight. ───────────────── */}
      <h2 className="section-head">Where their work ended up</h2>
      <div className="funnel-strip" role="group" aria-label="Submission stages">
        {STAGE_ORDER.map((stage) => {
          const count = data.funnel[stage] ?? 0;
          const meta = STAGE_META[stage];
          const share = data.total_submissions
            ? (count / data.total_submissions) * 100
            : 0;
          const active = stageFilter === stage;
          return (
            <button
              key={stage}
              type="button"
              className={`funnel-cell${active ? " funnel-cell-active" : ""}${
                isStalled(stage) && count > 0 ? " funnel-cell-stalled" : ""
              }`}
              aria-pressed={active}
              disabled={count === 0}
              onClick={() => setStageFilter(active ? null : stage)}
              title={meta.blurb}
            >
              <span className="funnel-count">{count}</span>
              <span className="funnel-label">{meta.label}</span>
              <span className="funnel-bar" aria-hidden="true">
                <span
                  className="funnel-bar-fill"
                  style={{ width: `${share}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="section-head">
        Submissions
        {stageFilter && (
          <button
            type="button"
            className="link-btn"
            style={{ marginLeft: 12, fontSize: 13 }}
            onClick={() => setStageFilter(null)}
          >
            clear {STAGE_META[stageFilter].label.toLowerCase()} filter
          </button>
        )}
      </h2>
      {truncated && (
        <p style={{ color: "var(--warn)", fontSize: 12, margin: "0 0 10px" }}>
          Showing the {rows?.length} most recent of {total} submissions — the
          funnel above counts all {total}.
        </p>
      )}
      <div className="table-card">
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/submissions/${r.id}/trace`)}
          drill
          loading={rows === null}
          error={rowsError}
          minWidth={860}
          empty={
            <div>
              <div className="dt-state-title">
                {!stageFilter
                  ? "This student hasn't handed anything in yet."
                  // "Nothing at this stage" is false when the funnel
                  // counted rows the fetch didn't reach — the count
                  // above would be sitting there contradicting it.
                  : truncated
                    ? "None of the loaded submissions are at this stage."
                    : "Nothing at this stage."}
              </div>
              <div className="dt-state-sub">
                {stageFilter
                  ? truncated
                    ? `The funnel counts all ${total}; only the ${rows?.length ?? 0} most recent are loaded here.`
                    : "Pick another stage above, or clear the filter."
                  : "Submissions appear here as soon as they upload work."}
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
