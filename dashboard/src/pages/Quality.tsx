import { useCallback, useEffect, useState } from "react";
import {
  api,
  type SolutionQualityData,
  type SolutionQuestion,
  type SolutionOutcome,
  type SolutionRepairHistory,
} from "../lib/api";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { EditorialModal } from "../components/EditorialModal";
import { formatRelativeDate } from "../lib/format";

// ────────────────────────────────────────────────────────────────────
// Solution quality — scoring the solve call.
//
// This page read an LLM judge's verdict for its whole life, and the
// judge never ran once: the call site shipped commented out and was
// later deleted, so the table was empty by construction. The page
// rendered a red "WEAK" pill and 0.0/5 on every dimension — asserting
// the AI was bad at something nobody had ever measured. That is worse
// than showing nothing.
//
// It now reads what teachers actually did to the worked answer, which
// costs nothing and is real. `decompose` runs behind five surfaces and
// the question bank is the only one where a human corrects it, so this
// is the only evidence available about that prompt.
//
// Solutions have no "rejected" of their own — binning belongs to the
// question that owns the solution. So the two exclusions are labelled by
// REASON. "Never assessed" describes our bookkeeping; "the question was
// rejected" describes what actually happened to it.
// ────────────────────────────────────────────────────────────────────

const OUTCOME_META: Record<
  SolutionOutcome,
  { label: string; tone: "ok" | "warn"; color: string }
> = {
  clean: { label: "Held up", tone: "ok", color: "var(--ok)" },
  repaired: { label: "Teacher fixed it", tone: "warn", color: "var(--warn)" },
};

function rateTone(rate: number): "ok" | "warn" | "danger" {
  if (rate >= 90) return "ok";
  if (rate >= 75) return "warn";
  return "danger";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

/** One solution repair, shown as what changed. The diff is the payload:
 *  a count tells you WHICH solution to look at, only the before/after
 *  tells you what the solve prompt got wrong. */
function RepairStep({
  index, entry,
}: {
  index: number;
  entry: SolutionRepairHistory["edits"][number];
}) {
  return (
    <li className="gq-step">
      <div className="gq-step-rail" aria-hidden>
        <span className="gq-step-num">{index + 1}</span>
      </div>
      <div className="gq-step-body">
        <div className="gq-step-meta">
          <StatusPill
            label={entry.field === "final_answer" ? "Final answer" : "Steps"}
            tone={entry.field === "final_answer" ? "info" : "neutral"}
          />
          <span className="gq-step-who">
            {entry.editor ?? "Unknown"}
            {entry.school ? ` · ${entry.school}` : ""}
          </span>
          <span className="gq-step-when">{formatDate(entry.created_at)}</span>
        </div>
        <div className="gq-diff">
          <div className="gq-diff-side gq-diff-before">
            <span className="gq-diff-label">The AI solved it as</span>
            <p>{entry.before ?? <em>nothing recorded</em>}</p>
          </div>
          <div className="gq-diff-side gq-diff-after">
            <span className="gq-diff-label">The teacher corrected it to</span>
            <p>{entry.after ?? <em>nothing recorded</em>}</p>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function Quality() {
  const [data, setData] = useState<SolutionQualityData | null>(null);
  const [outcome, setOutcome] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SolutionRepairHistory | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.solutionQuality(outcome ? { outcome } : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load solution quality");
    } finally {
      setLoading(false);
    }
  }, [outcome]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!openId) { setDetail(null); setDetailError(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    api
      .solutionRepairs(openId)
      .then((d) => { if (!cancelled) { setDetail(d); setDetailError(null); } })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(e instanceof Error ? e.message : "Couldn't load this repair history.");
        }
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [openId]);

  const cols: Column<SolutionQuestion>[] = [
    {
      key: "outcome", header: "Solution", width: "20%",
      sortValue: (q) => q.outcome,
      render: (q) => (
        <StatusPill
          tone={OUTCOME_META[q.outcome].tone}
          label={OUTCOME_META[q.outcome].label}
        />
      ),
    },
    {
      key: "question", header: "Question", width: "50%",
      render: (q) => (
        <div className="gq-cell-q">
          <span className="gq-cell-title">{q.title}</span>
          <span className="gq-cell-text">{q.question}</span>
        </div>
      ),
    },
    {
      key: "created_at", header: "Generated", numeric: true, width: "18%",
      sortValue: (q) => (q.created_at ? new Date(q.created_at).getTime() : 0),
      render: (q) => (
        <span className="gq-when">
          {q.created_at ? formatRelativeDate(q.created_at) : "—"}
        </span>
      ),
    },
  ];

  const summary = data?.summary;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Diagnostic</span>
          <h1>Solution quality</h1>
          <p>
            Whether the AI's worked answers held up — measured by the teachers
            who had to fix them. The same solve prompt runs in tutoring and
            practice, where nobody corrects it.
          </p>
        </div>
        <StatusPill
          tone="info"
          label="REPAIR SIGNAL"
          title="A teacher correcting the worked answer is a human saying the solve was wrong"
        />
      </div>

      {data && (
        <p className="gq-tracking" role="note">
          Counting repairs since {formatDate(data.tracking_since)}. Anything a
          teacher changed before then isn&rsquo;t recorded.
        </p>
      )}

      {loading && !data && <p className="loading">Loading…</p>}
      {error && !data && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn&rsquo;t load solution quality</div>
          <div className="empty-state-sub">{error}</div>
        </div>
      )}

      {summary && summary.judged === 0 && (
        // Honest empty state. The page this replaces rendered 0% in red
        // and called the AI "WEAK" off an empty table — a verdict from no
        // evidence, which is the one thing a quality page must never do.
        <div className="empty-state">
          <div className="empty-state-title">No solutions judged yet</div>
          <div className="empty-state-sub">
            {summary.awaiting > 0
              ? `${summary.awaiting.toLocaleString()} generated question${summary.awaiting === 1 ? " is" : "s are"} still waiting for a teacher. A solution is only judged once its question is approved.`
              : "Once teachers approve generated questions, whether they had to fix the worked answer appears here."}
          </div>
        </div>
      )}

      {data && summary && summary.judged > 0 && (
        <>
          <div className="tile-grid">
            <StatTile
              label="Solutions that held"
              tone={summary.thin ? "default" : rateTone(summary.clean_rate)}
              value={<span style={{ fontSize: 44, letterSpacing: -1 }}>{summary.clean_rate}%</span>}
              sub={`${summary.clean}/${summary.judged} approved with the answer untouched`}
            />
            <StatTile
              label="Teacher fixed it"
              tone={summary.repaired > 0 ? "warn" : "default"}
              value={summary.repaired.toLocaleString()}
              sub="steps or final answer corrected"
            />
            <StatTile
              label="Question rejected"
              value={summary.question_rejected.toLocaleString()}
              sub="excluded — the solution never got a look"
            />
            <StatTile
              label="Awaiting review"
              value={summary.awaiting.toLocaleString()}
              sub="excluded — not judged yet"
            />
          </div>

          {summary.thin && (
            <div className="callout-warn">
              <StatusPill tone="warn" label="THIN" />
              <span>
                Only {summary.judged} solution
                {summary.judged === 1 ? " has" : "s have"} been judged since
                counting began — too few for the percentage above to mean much.
              </span>
            </div>
          )}

          <div className="gq-filters">
            <label className="gq-filter">
              <span>Show</span>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="">Every solution</option>
                <option value="repaired">Fixed by a teacher</option>
                <option value="clean">Held up</option>
              </select>
            </label>
            <span className="gq-result-count">
              {data.total_count} solution{data.total_count === 1 ? "" : "s"}
            </span>
          </div>

          <DataTable
            columns={cols}
            rows={data.questions}
            rowKey={(q) => q.id}
            onRowClick={(q) => setOpenId(q.id)}
            rowStatus={(q) => OUTCOME_META[q.outcome].color}
            drill
            minWidth={640}
            empty={<span className="dt-state-title">No solutions match this filter.</span>}
          />
        </>
      )}

      {openId !== null && (
        <EditorialModal
          eyebrow="Solution quality"
          title={detail?.title ?? "Repair history"}
          onClose={() => setOpenId(null)}
          maxWidth={760}
        >
          {detailLoading && <p className="gq-loading">Loading…</p>}
          {detailError && !detailLoading && (
            <p className="empty-mini">{detailError}</p>
          )}
          {!detailLoading && detail && (
            <div className="gq-detail">
              <section className="gq-current">
                <h3>The question</h3>
                <p className="gq-current-q">{detail.question}</p>
                {detail.final_answer && (
                  <p className="gq-current-a">
                    <span>Answer key</span> {detail.final_answer}
                  </p>
                )}
              </section>

              <section>
                <h3>
                  What the teacher corrected
                  <span className="gq-trail-count">
                    {detail.edits.length} repair
                    {detail.edits.length === 1 ? "" : "s"}
                  </span>
                </h3>
                {detail.edits.length === 0 ? (
                  <p className="gq-muted">
                    This solution was approved as written — nothing to show.
                  </p>
                ) : (
                  <ol className="gq-trail">
                    {detail.edits.map((e, i) => (
                      <RepairStep key={e.id} index={i} entry={e} />
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </EditorialModal>
      )}
    </div>
  );
}
