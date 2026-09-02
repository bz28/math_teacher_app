import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type GenerationBoardData,
  type GenerationBoardQuestion,
  type GenerationOutcome,
  type QuestionEditHistory,
} from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { EditorialModal } from "../components/EditorialModal";
import { Pagination } from "../components/Pagination";
import { PAGE_SIZE } from "../lib/pagination";

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
  edit_manual: "Rewrote it",
  edit_workshop: "Used the workshop",
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
            tone={entry.kind === "edit_workshop" ? "info" : "neutral"}
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

// ── The board ────────────────────────────────────────────────────────
//
// Every generated question and what became of it. What this replaces
// could only show bad news: a question appeared ONLY once someone had
// edited it, so a perfect question was invisible and "0 repairs" had
// nothing to divide by.
//
// The three failure modes are shown as their own counts rather than
// summed into one "problem" number. A teacher binning a question and a
// teacher fixing a typo are not the same evidence, and averaging them
// would hide which kind of wrong the prompt is.

const OUTCOME_META: Record<
  GenerationOutcome,
  { label: string; tone: "ok" | "warn" | "danger"; color: string; blurb: string }
> = {
  clean: {
    label: "Kept as written", tone: "ok", color: "var(--ok)",
    blurb: "approved, never edited",
  },
  repaired: {
    label: "Repaired", tone: "warn", color: "var(--warn)",
    blurb: "edited, or redone with direction",
  },
  redone: {
    label: "Redone", tone: "danger", color: "var(--accent)",
    blurb: "attempt discarded, regenerated from scratch",
  },
  rejected: {
    label: "Rejected", tone: "danger", color: "var(--danger)",
    blurb: "binned outright",
  },
};

function boardTone(rate: number): "ok" | "warn" | "danger" {
  if (rate >= 90) return "ok";
  if (rate >= 75) return "warn";
  return "danger";
}

function GenerationBoard({
  data, outcome, onOutcome, onOpen, offset, onOffset,
}: {
  data: GenerationBoardData;
  outcome: string;
  onOutcome: (v: string) => void;
  onOpen: (id: string) => void;
  offset: number;
  onOffset: (v: number) => void;
}) {
  const { summary } = data;
  const settled = summary.settled;

  const cols: Column<GenerationBoardQuestion>[] = [
    {
      key: "outcome", header: "Outcome", width: "18%",
      sortValue: (q) => q.outcome,
      render: (q) => (
        <StatusPill
          tone={OUTCOME_META[q.outcome].tone}
          label={OUTCOME_META[q.outcome].label}
        />
      ),
    },
    {
      key: "question", header: "Question", width: "52%",
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

  if (settled === 0) {
    // Honest empty state. A new school sees this for weeks, so it says
    // what is true — nothing has been ruled on — rather than rendering
    // 0% and letting an unmeasured prompt read as a broken one.
    return (
      <div className="empty-state">
        <div className="empty-state-title">No questions ruled on yet</div>
        <div className="empty-state-sub">
          {summary.awaiting > 0
            ? `${summary.awaiting.toLocaleString()} generated question${summary.awaiting === 1 ? " is" : "s are"} waiting for a teacher to approve or bin. The score appears once they do.`
            : "Once teachers approve or reject generated questions, the score appears here."}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="tile-grid">
        <StatTile
          label="Kept as written"
          // A percentage over a handful of questions is noise. Below the
          // floor it is shown without a health colour rather than
          // asserting a problem the data cannot support.
          tone={summary.thin ? "default" : boardTone(summary.clean_rate)}
          value={<span style={{ fontSize: 44, letterSpacing: -1 }}>{summary.clean_rate}%</span>}
          sub={`${summary.clean}/${settled} approved untouched`}
        />
        <StatTile
          label="Repaired"
          tone={summary.repaired > 0 ? "warn" : "default"}
          value={summary.repaired.toLocaleString()}
          sub={OUTCOME_META.repaired.blurb}
        />
        <StatTile
          label="Redone"
          tone={summary.redone > 0 ? "danger" : "default"}
          value={summary.redone.toLocaleString()}
          sub={OUTCOME_META.redone.blurb}
        />
        <StatTile
          label="Rejected"
          tone={summary.rejected > 0 ? "danger" : "default"}
          value={summary.rejected.toLocaleString()}
          sub={OUTCOME_META.rejected.blurb}
        />
        <StatTile
          label="Awaiting review"
          value={summary.awaiting.toLocaleString()}
          sub="not ruled on — excluded from the score"
        />
      </div>

      {summary.thin && (
        <div className="callout-warn">
          <StatusPill tone="warn" label="THIN" />
          <span>
            Only {settled} question{settled === 1 ? " has" : "s have"} been
            ruled on since counting began — too few for the percentage above
            to mean much.
          </span>
        </div>
      )}

      <div className="gq-filters">
        <label className="gq-filter">
          <span>Show</span>
          <select value={outcome} onChange={(e) => onOutcome(e.target.value)}>
            <option value="">Every outcome</option>
            <option value="rejected">Rejected only</option>
            <option value="redone">Redone only</option>
            <option value="repaired">Repaired only</option>
            <option value="clean">Kept as written only</option>
          </select>
        </label>
        <span className="gq-result-count">
          {data.total_count} question{data.total_count === 1 ? "" : "s"}
        </span>
      </div>

      <DataTable
        columns={cols}
        rows={data.questions}
        rowKey={(q) => q.id}
        onRowClick={(q) => onOpen(q.id)}
        rowStatus={(q) => OUTCOME_META[q.outcome].color}
        drill
        minWidth={680}
        empty={<span className="dt-state-title">No questions match this filter.</span>}
      />
      <Pagination
        offset={offset}
        limit={PAGE_SIZE}
        total={data.total_count}
        onChange={onOffset}
      />
    </>
  );
}


export default function GenerationQuality() {
  const [board, setBoard] = useState<GenerationBoardData | null>(null);
  const [trackingSince, setTrackingSince] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuestionEditHistory | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Only the newest load may write state — see the note on the same guard
  // in Quality.tsx. Paging makes overlapping fetches ordinary, and the
  // retry button calls load() directly, so a sequence beats a
  // cancelled-flag scoped to an effect.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      // Paged on the server. Sending no limit took the endpoint's default
      // 50 while the count beside the table read the true total, so the
      // table showed a prefix and said nothing about it.
      const brd = await api.generationBoard({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...(outcome ? { outcome } : {}),
      });
      if (seq !== loadSeq.current) return;
      setBoard(brd);
      setTrackingSince(brd.tracking_since);
    } catch (e) {
      if (seq === loadSeq.current) {
        setError(e instanceof Error ? e.message : "Couldn't load generation quality");
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [outcome, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    // Cleared at the START of every fetch, not only when the modal
    // closes. Opening row B directly from row A otherwise left A's error
    // in state, and once B loaded the guard below was true again — a
    // stale failure rendered over content that had loaded fine.
    setDetailError(null);
    setDetailLoading(true);
    api
      .questionEditHistory(openId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          // Without this the modal opened, showed its title, and sat
          // completely blank — a failed fetch that looked like a question
          // with no repair history. The sibling page surfaces it.
          setDetailError(
            e instanceof Error ? e.message : "Couldn't load this repair history.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

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
            Every question the AI wrote, and what a teacher did with it.
            One fix is taste; the same fix showing up across teachers is a
            prompt worth changing.
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
          Counting questions generated since {formatDate(trackingSince)} —
          repairs are only recorded from that date, so earlier questions
          would look clean whether or not anyone touched them.
        </p>
      )}

      {loading && !board && <p className="loading">Loading…</p>}

      {/* Two DIFFERENT states, and collapsing them was a real defect.
          With no board there is nothing to be stale — saying "the numbers
          below are from the last successful load" over an empty page is
          both wrong and confusing. With a board, the failure must be
          announced ABOVE the numbers it applies to, or the sentence
          points at nothing. */}
      {error && !board && (
        <div className="empty-state">
          <div className="empty-state-title">Couldn&rsquo;t load generation quality</div>
          <div className="empty-state-sub">{error}</div>
        </div>
      )}
      {error && board && (
        <div className="callout-warn" role="alert">
          <StatusPill tone="warn" label="STALE" />
          <span>
            {error} The numbers below are from the last successful load.{" "}
            <button
              type="button"
              onClick={() => void load()}
              style={{
                background: "none", border: "none", padding: 0,
                color: "var(--accent)", cursor: "pointer",
                font: "inherit", textDecoration: "underline",
              }}
            >
              Retry
            </button>
          </span>
        </div>
      )}

      {board && (
        <GenerationBoard
          data={board}
          outcome={outcome}
          onOutcome={(v) => { setOffset(0); setOutcome(v); }}
          onOpen={setOpenId}
          offset={offset}
          onOffset={setOffset}
        />
      )}

      {openId !== null && (
        <EditorialModal
          eyebrow="Generation quality"
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
