import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ExtractionQualityData,
  type ExtractionCase,
  type ExtractionDetail,
  type ExtractionBucket,
} from "../lib/api";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import ErrorState from "../components/ErrorState";
import { EditorialModal } from "../components/EditorialModal";
import { Pagination } from "../components/Pagination";
import { PAGE_SIZE } from "../lib/pagination";
import { MetaChip } from "../components/MetaChip";
import { formatRelativeDate } from "../lib/format";
import { windowLabel } from "../lib/definitions";
import { SUBJECT_LABEL } from "../lib/quality";

// ────────────────────────────────────────────────────────────────────
// Handwriting extraction quality — scoring the Vision read.
//
// This page answers "can the AI read a student's handwriting", and the
// judge is the one person who knows for certain: the student who wrote
// the page. The post-submit confirm screen already records their
// verdict, so unlike the other quality tabs nothing new had to be
// recorded to build this.
//
// The design rule that shapes everything below: AWAITING SITS OUTSIDE
// THE RATE. A submission nobody has ruled on is not a pass and not a
// failure. It gets a tile, visibly separated, and never enters the
// numerator or denominator — because folding it in either direction
// produces a confident number about work no one has looked at, which
// is exactly the defect that made the old Solution-quality page
// announce a verdict from an empty table.
// ────────────────────────────────────────────────────────────────────

const BUCKET_META: Record<
  ExtractionBucket,
  { label: string; tone: "ok" | "warn" | "danger"; color: string; blurb: string }
> = {
  clean: {
    label: "Read clean", tone: "ok", color: "var(--ok)",
    blurb: "student confirmed, changed nothing",
  },
  repaired: {
    label: "Corrected", tone: "warn", color: "var(--warn)",
    blurb: "student fixed rows before confirming",
  },
  flagged: {
    label: "Flagged", tone: "danger", color: "var(--danger)",
    blurb: "student said the reader got it wrong",
  },
  empty: {
    label: "Read nothing", tone: "danger", color: "var(--danger)",
    blurb: "no steps and no answers came back",
  },
};

function rateTone(rate: number): "ok" | "warn" | "danger" {
  if (rate >= 95) return "ok";
  if (rate >= 85) return "warn";
  return "danger";
}

/** One row of the read, AI beside student. The diff IS the diagnostic —
 *  a count tells you the reader is struggling, only this says how. */
function ReadRow({ row }: { row: ExtractionDetail["rows"][number] }) {
  const changed = row.changed;
  return (
    <li className="xq-row" style={{ borderLeftColor: changed ? "var(--warn)" : "var(--rule)" }}>
      <div className="xq-row-key">
        {row.unattributed
          ? "unplaced row"
          : row.kind === "final_answer"
            ? `P${row.problem_position} answer`
            : `P${row.problem_position} · step ${row.step_num}`}
        {row.unattributed && (
          // Vision couldn't tie this row to a problem, so the student was
          // never shown it to correct. Often the most interesting misread
          // on the page — dropping it made the list's count disagree with
          // this modal.
          <span className="xq-unplaced" title="The reader could not tell which problem this belongs to, so the student was never asked about it">
            not shown to student
          </span>
        )}
      </div>
      <div className="xq-row-pair">
        <div className="xq-read">
          <span className="xq-read-label">AI read</span>
          <p>{row.ai_read ?? <em>nothing read</em>}</p>
        </div>
        {changed ? (
          <div className="xq-read xq-read-fixed">
            <span className="xq-read-label">Student said</span>
            {row.deleted ? (
              // A cleared row is a DELETION — the overlay drops it. Showing
              // an empty string here would read as "no change" on the one
              // screen built to surface misreads.
              <p><em>row deleted — nothing was written here</em></p>
            ) : (
              <p>{row.student_said}</p>
            )}
          </div>
        ) : (
          <div className="xq-read xq-read-agree">
            <span className="xq-read-label">Student said</span>
            <p className="xq-agree">
              {row.unattributed ? "— never asked —" : "— same —"}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ExtractionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .extractionDetail(id)
      .then((d) => { if (!cancelled) { setDetail(d); setError(null); } })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load this submission.");
      });
    return () => { cancelled = true; };
  }, [id]);

  const changedCount = detail?.rows.filter((r) => r.changed).length ?? 0;

  return (
    <EditorialModal
      eyebrow="Extraction drill-in"
      title={detail ? detail.course : "Loading…"}
      subtitle={
        detail
          ? `${changedCount} of ${detail.rows.length} rows corrected by the student.`
          : undefined
      }
      maxWidth={860}
      onClose={onClose}
    >
      <div style={{ padding: "18px 30px 30px" }}>
        {error && <p className="empty-mini">{error}</p>}
        {!detail && !error && <p className="loading">Loading…</p>}
        {detail && (
          <div className="xq-detail">
            {/* The strokes. You cannot diagnose a misread without seeing
                what was actually on the page. */}
            <div className="xq-shot">
              {detail.files.length === 0 ? (
                <div className="xq-shot-empty">No image stored for this submission.</div>
              ) : (
                detail.files.map((f, i) => (
                  <img
                    key={i}
                    src={`data:${f.media_type};base64,${f.data}`}
                    alt={`Submitted work, page ${i + 1}`}
                    loading="lazy"
                  />
                ))
              )}
            </div>
            <div>
              {detail.rows.length === 0 ? (
                <p className="empty-mini">Nothing was extracted from this submission.</p>
              ) : (
                <ol className="xq-rows">
                  {detail.rows.map((r) => <ReadRow key={r.key} row={r} />)}
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
    </EditorialModal>
  );
}

export default function ExtractionQuality() {
  const [data, setData] = useState<ExtractionQualityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hours, setHours] = useState("2160");
  const [bucket, setBucket] = useState("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      // Paged on the server. Sending no limit took the endpoint's default
      // 50 while the count in the heading read the true total, so the table
      // showed a prefix and said nothing about it.
      .extractionQuality({ hours, bucket, limit: String(PAGE_SIZE), offset: String(offset) })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load extraction quality.");
      });
    return () => { cancelled = true; };
  }, [hours, bucket, offset, reloadKey]);

  const cols: Column<ExtractionCase>[] = useMemo(() => [
    {
      key: "bucket", header: "Outcome", width: "18%",
      sortValue: (c) => c.bucket,
      render: (c) => (
        <StatusPill tone={BUCKET_META[c.bucket].tone} label={BUCKET_META[c.bucket].label} />
      ),
    },
    {
      key: "course", header: "Course", width: "34%",
      sortValue: (c) => c.course,
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)" }}>{c.course}</div>
          <div style={{ marginTop: 4 }}>
            <MetaChip
              label={SUBJECT_LABEL[c.subject] ?? c.subject}
              kind="subject"
              value={c.subject}
            />
          </div>
        </div>
      ),
    },
    {
      key: "corrected_rows", header: "Rows fixed", numeric: true, width: "16%",
      sortValue: (c) => c.corrected_rows,
      render: (c) => (
        <span className="num" style={{ color: c.corrected_rows > 0 ? "var(--warn)" : "var(--muted-2)" }}>
          {c.corrected_rows}
        </span>
      ),
    },
    {
      key: "steps_read", header: "Rows read", numeric: true, width: "14%",
      sortValue: (c) => c.steps_read,
      render: (c) => <span className="num" style={{ color: "var(--muted)" }}>{c.steps_read}</span>,
    },
    {
      key: "ruled_at", header: "Judged", numeric: true, width: "18%",
      sortValue: (c) => (c.ruled_at ? new Date(c.ruled_at).getTime() : 0),
      render: (c) => (
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
          {c.ruled_at ? formatRelativeDate(c.ruled_at) : "—"}
        </span>
      ),
    },
  ], []);

  if (!data && error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!data) return <p className="loading">Loading…</p>;

  const { summary } = data;
  const win = windowLabel(Number(hours));
  const settled = summary.settled;
  const tone = rateTone(summary.clean_rate);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Diagnostic</span>
          <h1>Handwriting extraction quality</h1>
          <p>
            How well the AI reads a photo of handwritten work — scored by the
            student who wrote it. Everything downstream, including the grade,
            rests on this read being right.
          </p>
        </div>
        <StatusPill tone="info" label="STUDENT SIGNAL" title="The student who wrote the page is the ground truth for what it says" />
      </div>

      <div className="filters">
        <select value={hours} onChange={(e) => { setOffset(0); setHours(e.target.value); }}>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
          <option value="87600">All time</option>
        </select>
        <select value={bucket} onChange={(e) => { setOffset(0); setBucket(e.target.value); }}>
          <option value="">All outcomes</option>
          <option value="flagged">Flagged only</option>
          <option value="repaired">Corrected only</option>
          <option value="clean">Read clean only</option>
        </select>
      </div>

      {settled === 0 ? (
        // Honest empty state. A new school will see this for weeks, so it
        // states what is true — nothing has been judged — rather than
        // rendering 0% and letting an unmeasured reader read as a broken one.
        <div className="empty-state">
          <div className="empty-state-title">No reads judged yet</div>
          <div className="empty-state-sub">
            {summary.awaiting > 0
              ? `${summary.awaiting.toLocaleString()} submission${summary.awaiting === 1 ? " has" : "s have"} been read but not yet confirmed by a student. The score appears once students rule on them.`
              : "Once students confirm or flag what the AI read from their work, the score appears here."}
          </div>
        </div>
      ) : (
        <>
          <div className="tile-grid">
            <StatTile
              label="Read correctly"
              // A percentage over a handful of reads is noise. Below the
              // floor it is shown without a health colour, because
              // painting 0% red off two submissions asserts a problem
              // the data cannot support.
              tone={summary.thin ? "default" : tone}
              value={<span style={{ fontSize: 44, letterSpacing: -1 }}>{summary.clean_rate}%</span>}
              sub={`${summary.clean}/${settled} reads needed no correction · ${win}`}
              spark={data.trend.map((t) => t.clean_rate)}
            />
            <StatTile
              label="Corrected"
              tone={summary.repaired > 0 ? "warn" : "default"}
              value={summary.repaired.toLocaleString()}
              sub={BUCKET_META.repaired.blurb}
            />
            <StatTile
              label="Flagged"
              tone={summary.flagged > 0 ? "danger" : "default"}
              value={summary.flagged.toLocaleString()}
              sub={BUCKET_META.flagged.blurb}
            />
            <StatTile
              label="Read nothing"
              tone={summary.empty > 0 ? "danger" : "default"}
              value={summary.empty.toLocaleString()}
              sub={BUCKET_META.empty.blurb}
            />
            <StatTile
              label="Awaiting confirm"
              value={summary.awaiting.toLocaleString()}
              sub="not judged — excluded from the score"
            />
          </div>

          {summary.thin && (
            <div className="callout-warn">
              <StatusPill tone="warn" label="THIN" />
              <span>
                Only {settled} read{settled === 1 ? " has" : "s have"} been
                judged in this window — too few for the percentage above to
                mean much. Widen the window or wait for more confirms before
                reading anything into it.
              </span>
            </div>
          )}

          {summary.awaiting > settled && (
            // Not a quality problem — a funnel problem. It would otherwise
            // hide behind a small, healthy-looking denominator.
            <div className="callout-warn">
              <StatusPill tone="warn" label="THIN" />
              <span>
                More submissions are waiting on a student confirm
                ({summary.awaiting.toLocaleString()}) than have been judged
                ({settled.toLocaleString()}). The score above speaks only for
                the judged slice — students may be abandoning the confirm step.
              </span>
            </div>
          )}

          {data.by_subject.length > 1 && (
            <div className="table-card">
              <h3>By subject — weakest read first</h3>
              <DataTable
                columns={[
                  {
                    key: "subject", header: "Subject", width: "40%",
                    sortValue: (s) => s.subject,
                    render: (s) => (
                      <MetaChip
                        label={SUBJECT_LABEL[s.subject] ?? s.subject}
                        kind="subject"
                        value={s.subject}
                      />
                    ),
                  },
                  {
                    key: "clean_rate", header: "Read correctly", width: "34%",
                    sortValue: (s) => s.clean_rate,
                    render: (s) => (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, height: 7, background: "var(--paper-2)", overflow: "hidden" }}>
                          <div style={{
                            width: `${s.clean_rate}%`, height: "100%",
                            background: `var(--${rateTone(s.clean_rate)})`,
                            minWidth: s.clean_rate > 0 ? 2 : 0,
                          }} />
                        </div>
                        <span className="num" style={{ fontSize: 13, minWidth: 46, textAlign: "right" }}>
                          {s.clean_rate}%
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: "flagged", header: "Flagged", numeric: true, width: "13%",
                    sortValue: (s) => s.flagged,
                    render: (s) => <span className="num">{s.flagged}</span>,
                  },
                  {
                    key: "settled", header: "n", numeric: true, width: "13%",
                    sortValue: (s) => s.settled,
                    render: (s) => <span className="num" style={{ color: "var(--muted)" }}>{s.settled}</span>,
                  },
                ]}
                rows={data.by_subject}
                rowKey={(s) => s.subject}
                unpaged
                minWidth={480}
                empty={<span className="dt-state-title">No subject data in this window.</span>}
              />
            </div>
          )}

          <div className="table-card">
            <h3>
              Reads — worst first
              <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 13 }}>
                {" · "}{data.total_count.toLocaleString()}
              </span>
            </h3>
            <DataTable
              columns={cols}
              rows={data.cases}
              rowKey={(c) => c.submission_id}
              onRowClick={(c) => setOpenId(c.submission_id)}
              rowStatus={(c) => BUCKET_META[c.bucket].color}
              drill
              minWidth={680}
              empty={<span className="dt-state-title">No reads match this filter.</span>}
            />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total_count}
              onChange={setOffset}
            />
          </div>
        </>
      )}

      {openId && <DetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
