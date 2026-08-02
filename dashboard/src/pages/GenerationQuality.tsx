import { useCallback, useEffect, useState } from "react";
import {
  api,
  type EditedQuestion,
  type GenerationQualitySummary,
  type QuestionEditHistory,
} from "../lib/api";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { EditorialModal } from "../components/EditorialModal";

// ────────────────────────────────────────────────────────────────────
// Generation quality — which generated questions teachers had to fix.
//
// The page answers one question: is our generation prompt wrong? A
// teacher rewriting a question is the evidence. One teacher fixing one
// question is taste; four teachers fixing the same SHAPE of question is
// a defect with an address.
//
// So it opens ranked by how much repair a question needed, not by when
// it happened. A chronological feed would make the reader do the
// analysis; ranking does it for them — the same "what's broken" framing
// the Overview page uses.
//
// Visual language is inherited wholesale from the console (cream
// surfaces, serif display, the existing tiles/table/modal). A separate
// identity for one internal page would be noise. The one deliberate
// piece of design here is the REPAIR TRAIL in the drill-in: the diffs
// stacked in the order the teacher made them, under the prompt that
// produced the original. Numbering is used there and nowhere else on
// the page, because that sequence is the only place order carries real
// information — it's a teacher coming back to the same question again.
// ────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  manual: "Rewrote it",
  chat: "Used the workshop",
};

// How hard a teacher had to fight a question. Drives the row's status
// bar and the count's tone. Thresholds are judgements, not maths: one
// edit is ordinary polish, two is a pattern worth a look, four means
// the question arrived wrong.
function repairTone(count: number): "default" | "warn" | "bad" {
  if (count >= 4) return "bad";
  if (count >= 2) return "warn";
  return "default";
}

const TONE_VAR: Record<string, string> = {
  default: "var(--ok)",
  warn: "var(--warn)",
  bad: "var(--accent)",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── The signature: one repair, shown as what changed ─────────────────

function RepairStep({
  index,
  entry,
}: {
  index: number;
  entry: QuestionEditHistory["edits"][number];
}) {
  return (
    <li className="gq-step">
      <div className="gq-step-rail" aria-hidden>
        <span className="gq-step-num">{index + 1}</span>
      </div>
      <div className="gq-step-body">
        <div className="gq-step-meta">
          <StatusPill
            label={KIND_LABEL[entry.kind] ?? entry.kind}
            tone={entry.kind === "chat" ? "info" : "neutral"}
          />
          <span className="gq-step-who">
            {entry.editor ?? "Unknown"}
            {entry.school ? ` · ${entry.school}` : ""}
          </span>
          <span className="gq-step-when">{formatDate(entry.created_at)}</span>
        </div>
        {/* Before above after, not side by side: these are sentences of
            maths prose, and reading them stacked keeps the changed
            words vertically aligned. Columns would force both into
            half-width and wrap them differently, which is exactly when
            a small wording change becomes hard to spot. */}
        <div className="gq-diff">
          <div className="gq-diff-side gq-diff-before">
            <span className="gq-diff-label">The AI wrote</span>
            <p>{entry.before ?? <em>nothing recorded</em>}</p>
          </div>
          <div className="gq-diff-side gq-diff-after">
            <span className="gq-diff-label">The teacher changed it to</span>
            <p>{entry.after ?? <em>nothing recorded</em>}</p>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function GenerationQuality() {
  const [data, setData] = useState<EditedQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [trackingSince, setTrackingSince] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenerationQualitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [minEdits, setMinEdits] = useState(1);
  const [kind, setKind] = useState<string>("");

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuestionEditHistory | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { min_edits: String(minEdits) };
      if (kind) params.kind = kind;
      const [list, sum] = await Promise.all([
        api.editedQuestions(params),
        api.generationQualitySummary(),
      ]);
      setData(list.questions);
      setTotal(list.total);
      setTrackingSince(list.tracking_since);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load generation quality");
    } finally {
      setLoading(false);
    }
  }, [minEdits, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api
      .questionEditHistory(openId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(
          e instanceof Error ? e.message : "Couldn't load this question",
        );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const columns: Column<EditedQuestion>[] = [
    {
      key: "question",
      header: "Question",
      width: "48%",
      render: (r) => (
        <div className="gq-cell-q">
          <span className="gq-cell-title">{r.title}</span>
          <span className="gq-cell-text">{r.question}</span>
        </div>
      ),
    },
    {
      key: "edit_count",
      header: "Repairs",
      numeric: true,
      sortValue: (r) => r.edit_count,
      render: (r) => (
        <span
          className="gq-count"
          style={{ color: TONE_VAR[repairTone(r.edit_count)] }}
        >
          {r.edit_count}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill label={r.status} tone="neutral" />,
    },
    {
      key: "last_edited_at",
      header: "Last touched",
      sortValue: (r) => r.last_edited_at ?? "",
      render: (r) => (
        <span className="gq-when">{formatDate(r.last_edited_at)}</span>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 24,
        }}
      >
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Diagnostic</span>
          <h1>Generation quality</h1>
          <p>
            Questions the AI wrote and a teacher had to fix. One teacher
            fixing one question is taste — the same fix showing up across
            teachers is a prompt worth changing.
          </p>
        </div>
        <StatusPill
          tone="info"
          label="REPAIR SIGNAL"
          title="Teacher repairs are the ground-truth signal for generation quality"
        />
      </div>

      {/* Stated up front, not buried. These events are only recorded
          forward: every edit made before this shipped is genuinely
          gone. Without saying so, an empty page reads as "no teacher has
          ever changed a question", which is the opposite of the truth. */}
      {trackingSince && (
        <p className="gq-tracking" role="note">
          Counting edits since {formatDate(trackingSince)}. Anything a teacher
          changed before then isn&rsquo;t recorded.
        </p>
      )}

      <div className="tile-grid">
        <StatTile
          label="Questions with repairs"
          value={summary ? String(summary.questions_touched) : "—"}
          sub="a teacher changed the wording"
        />
        <StatTile
          label="Total repairs"
          value={summary ? String(summary.total_edits) : "—"}
          sub="across every question"
        />
        <StatTile
          label="Rewritten by hand"
          value={summary ? String(summary.by_kind.manual ?? 0) : "—"}
          sub="teacher typed the fix"
        />
        <StatTile
          label="Fixed in the workshop"
          value={summary ? String(summary.by_kind.chat ?? 0) : "—"}
          sub="teacher asked the AI to redo it"
        />
      </div>

      <div className="gq-filters">
        <label className="gq-filter">
          <span>Show questions repaired</span>
          <select
            value={minEdits}
            onChange={(e) => setMinEdits(Number(e.target.value))}
          >
            <option value={1}>once or more</option>
            <option value={2}>twice or more</option>
            <option value={3}>3+ times</option>
            <option value={4}>4+ times</option>
          </select>
        </label>
        <label className="gq-filter">
          <span>How it was fixed</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Either way</option>
            <option value="manual">Rewritten by hand</option>
            <option value="chat">Fixed in the workshop</option>
          </select>
        </label>
        <span className="gq-result-count">
          {loading ? "…" : `${total} question${total === 1 ? "" : "s"}`}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={data}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        rowStatus={(r) => TONE_VAR[repairTone(r.edit_count)]}
        drill
        loading={loading}
        error={error}
        onRetry={() => void load()}
        defaultSort={{ key: "edit_count", dir: "desc" }}
        empty={
          // Two different zeros. "Nothing matches your filters" and
          // "nothing has ever been recorded" are opposite facts, and
          // showing the second while the tiles above count repairs was
          // the same lie this page exists to avoid.
          minEdits > 1 || kind ? (
            <div className="gq-empty">
              <p className="gq-empty-head">No questions match these filters.</p>
              <p>
                There are repairs recorded — just none matching what you asked
                for.{" "}
                <button
                  type="button"
                  className="gq-linkish"
                  onClick={() => {
                    setMinEdits(1);
                    setKind("");
                  }}
                >
                  Clear the filters
                </button>{" "}
                to see everything.
              </p>
            </div>
          ) : (
            <div className="gq-empty">
              <p className="gq-empty-head">No repairs recorded yet.</p>
              <p>
                Either the generated questions are landing well, or nobody has
                edited one since counting began. Come back after a few rounds of
                generation.
              </p>
            </div>
          )
        }
      />

      {openId !== null && (
        <EditorialModal
          eyebrow="Generation quality"
          title={detail?.title ?? "Repair history"}
          onClose={() => setOpenId(null)}
          maxWidth={760}
        >
          {detailLoading && <p className="gq-loading">Loading…</p>}
          {!detailLoading && detailError && (
            /* An empty modal with a title and nothing in it reads as
               "this question has no history", which is a different and
               wrong claim. Name the failure and offer the way out. */
            <div className="gq-loading" role="alert">
              <p>{detailError}</p>
              <button
                type="button"
                className="gq-retry"
                onClick={() => setOpenId((id) => (id ? `${id}` : id))}
              >
                Try again
              </button>
            </div>
          )}
          {!detailLoading && detail && (
            <div className="gq-detail">
              {/* The prompt first. It's the thing you actually change once
                  a pattern is clear — the diffs below are the evidence
                  that it needs changing. */}
              <section className="gq-prompt">
                <h3>What we asked the AI for</h3>
                {detail.generation_prompt ? (
                  <pre>{detail.generation_prompt}</pre>
                ) : (
                  <p className="gq-muted">
                    No prompt recorded — this question predates prompt capture,
                    or was written by hand.
                  </p>
                )}
              </section>

              <section className="gq-current">
                <h3>Where it stands now</h3>
                <p className="gq-current-q">{detail.question}</p>
                {detail.final_answer && (
                  <p className="gq-current-a">
                    <span>Answer key</span> {detail.final_answer}
                  </p>
                )}
              </section>

              <section>
                <h3>
                  What the teacher changed
                  <span className="gq-trail-count">
                    {detail.edits.length} repair
                    {detail.edits.length === 1 ? "" : "s"}
                  </span>
                </h3>
                {/* Numbered because this IS a sequence — a teacher coming
                    back to the same question. Nothing else on the page is
                    numbered, so the device means something here. */}
                <ol className="gq-trail">
                  {detail.edits.map((e, i) => (
                    <RepairStep key={e.id} index={i} entry={e} />
                  ))}
                </ol>
              </section>
            </div>
          )}
        </EditorialModal>
      )}
    </div>
  );
}
