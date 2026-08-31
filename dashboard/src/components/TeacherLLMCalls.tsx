import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type LLMCallsData } from "../lib/api";
import { fmtClockTime, fmtCost, shortModel } from "../lib/format";
import { Pagination } from "./Pagination";
import StatusPill from "./StatusPill";

/**
 * Every model call this teacher caused, opened in place.
 *
 * The teacher page used to link out to /llm-calls pre-filtered, which
 * answered "how much did this teacher cost" but not the question you
 * actually have when they report something odd: *what did we send, and
 * what came back?* That was one click into a different page, with the
 * filter to re-apply and the name to re-find.
 *
 * So the calls live here, and expanding one shows the exchange plus the
 * numbers that explain a bad one: tokens, cache traffic, latency, retries,
 * cost. Nothing new is stored; `llm_calls` has carried `input_text` /
 * `output_text` all along.
 *
 * Two things this panel got wrong on its first pass, both of the same
 * kind — it displayed a subset while implying it was the whole:
 *
 *   1. It sent no `hours`, so it silently took the endpoint's 168h
 *      default while the cost figure beside it was 30-day. A teacher
 *      quiet for eight days rendered "No model calls yet" directly under
 *      a non-zero cost. Now explicitly `WINDOW_HOURS`, matching the page.
 *   2. It took the first 25 rows with no total, no pager and no filters,
 *      while the response already carried `total_count_window`,
 *      `failure_count` and `by_function`. All three are read now, and the
 *      header states the bounds instead of leaving them to be inferred.
 */

const PAGE = 25;
const WINDOW_HOURS = 720; // 30d — matches the cost window on this page.

export default function TeacherLLMCalls({ teacherId }: { teacherId: string }) {
  const [data, setData] = useState<LLMCallsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [fn, setFn] = useState<string>("");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // A filter change invalidates the current page — page 3 of "all calls"
  // is not page 3 of "failures only" — so both setters reset the offset
  // at the control rather than in an effect reacting to them.
  const pickFunction = (next: string) => {
    setFn(next);
    setOffset(0);
  };
  const pickFailuresOnly = (next: boolean) => {
    setFailuresOnly(next);
    setOffset(0);
  };

  useEffect(() => {
    let cancelled = false;
    const params: Record<string, string> = {
      user_id: teacherId,
      hours: String(WINDOW_HOURS),
      limit: String(PAGE),
      offset: String(offset),
    };
    if (fn) params.function = fn;
    if (failuresOnly) params.success = "false";
    api
      .llmCalls(params)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId, offset, fn, failuresOnly, reloadKey]);

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Couldn&rsquo;t load model calls</div>
        <div>{error}</div>
        <button
          type="button"
          className="btn-secondary"
          style={{ marginTop: 10 }}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  const calls = data?.calls ?? [];
  const filtering = Boolean(fn) || failuresOnly;

  // With no filters applied and nothing returned, this teacher genuinely
  // caused no calls in the window. With filters, the window isn't empty —
  // the filter is — and saying "no calls yet" would be false.
  if (data && calls.length === 0 && !filtering) {
    // "No model calls" was false and provably so: this panel filters on
    // the teacher's own user id, and grading/integrity calls are billed
    // to the student, so a teacher whose class submitted 45 calls' worth
    // of work rendered this empty state directly beneath a table counting
    // them. Say which calls are missing and where they are.
    return (
      <div className="empty-state">
        <div className="empty-state-title">
          Nothing generated in the last 30 days
        </div>
        <div>
          Grading and integrity calls are billed to the student who
          submitted — open a row in Work handed in for those.
        </div>
      </div>
    );
  }

  const functions = data?.by_function ?? [];
  const failures = data?.failure_count ?? 0;

  return (
    <>
      {data && (
        <div className="panel-bar">
          {/* The bounds, stated. `total_count_window` is the count for the
              whole window; `calls.length` is what's on this page. */}
          <div className="panel-bar-facts">
            {/* `total_count` respects the active filter; the `_window`
                figures do not. Showing the filtered count keeps the strip
                and the table describing the same set — the cost and
                failure totals stay window-wide and are labelled as such
                only when nothing is filtering them out. */}
            <span>
              <strong>{data.total_count.toLocaleString()}</strong> call
              {data.total_count === 1 ? "" : "s"}
            </span>
            {!filtering && (
              <>
                <span className={failures > 0 ? "bad" : undefined}>
                  <strong>{failures.toLocaleString()}</strong> failed
                </span>
                <span className="muted">{fmtCost(data.total_cost_window)}</span>
              </>
            )}
            <span className="muted">
              {filtering
                ? `of ${data.total_count_window.toLocaleString()} in the last 30 days`
                : "last 30 days"}
            </span>
          </div>
          <div className="panel-bar-controls">
            {functions.length > 1 && (
              <select
                className="mini-select"
                value={fn}
                onChange={(e) => pickFunction(e.target.value)}
                aria-label="Filter by function"
              >
                <option value="">All functions</option>
                {functions.map((f) => (
                  <option key={f.function} value={f.function}>
                    {f.function} ({f.count})
                  </option>
                ))}
              </select>
            )}
            {/* Only offered when there is something to isolate — a
                failures-only toggle on a teacher with zero failures is a
                control that can only ever empty the table. */}
            {(failures > 0 || failuresOnly) && (
              <label className="mini-check">
                <input
                  type="checkbox"
                  checked={failuresOnly}
                  onChange={(e) => pickFailuresOnly(e.target.checked)}
                />
                Failures only
              </label>
            )}
          </div>
        </div>
      )}

      <div className="dt-scroll">
        {/* Five columns, not nine. `table.dt td` ellipsizes, so nine
            columns in this panel truncated every field that mattered —
            "practice…" is indistinguishable from "practice_eval". Widening
            the table instead just pushed cost and status off-screen.
            Tokens, cache traffic and latency are DETAIL: you want them once
            you've picked a call, not while scanning for it. They moved into
            the expansion, which has room and already holds the exchange. */}
        <table className="dt" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ width: 38 }} aria-hidden="true" />
              <th>When</th>
              <th>Function</th>
              <th>Model</th>
              <th style={{ textAlign: "right" }}>Cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data === null ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="dt-row dt-row-skeleton">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j}>
                      <span className="dt-shimmer" style={{ width: "60%" }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : calls.length === 0 ? (
              <tr>
                {/* The state class goes on a DIV inside the cell, never on
                    the <td>: `.dt-state` is `display: flex`, which
                    overrides `table-cell` and makes the browser ignore
                    colSpan entirely. `DataTable` already does it this
                    way. */}
                <td colSpan={6}>
                  <div className="dt-state">No calls match this filter.</div>
                </td>
              </tr>
            ) : (
              calls.map((c) => {
                const isOpen = open === c.id;
                return (
                  <CallRows
                    key={c.id}
                    call={c}
                    isOpen={isOpen}
                    onToggle={() => setOpen(isOpen ? null : c.id)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {data && data.total_count > PAGE && (
        <Pagination
          offset={offset}
          limit={PAGE}
          total={data.total_count}
          onChange={setOffset}
        />
      )}
    </>
  );
}

type Call = LLMCallsData["calls"][number];

function CallRows({
  call,
  isOpen,
  onToggle,
}: {
  call: Call;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="dt-row dt-row-click"
        onClick={onToggle}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onToggle();
        }}
        aria-expanded={isOpen}
      >
        <td className="mono" style={{ color: "var(--muted-2)" }}>
          {isOpen ? "▾" : "▸"}
        </td>
        {/* Absolute, not relative. Nine calls from one grading run all read
            "3d ago"; the reason you look at this column is to line a call
            up against a submission and a teacher action, which needs a
            clock. Full ISO timestamp on hover. */}
        <td className="mono" title={call.created_at}>
          {fmtClockTime(call.created_at)}
        </td>
        {/* Longest names still clip at narrow widths; the full one is
            one hover away rather than one column wider. */}
        <td className="mono" title={call.function}>{call.function}</td>
        <td className="mono" title={call.model}>{shortModel(call.model)}</td>
        <td className="num">{fmtCost(call.cost_usd)}</td>
        <td>
          {call.success ? (
            call.retry_count > 0 ? (
              <StatusPill tone="warn" label={`retry ${call.retry_count}`} />
            ) : (
              <StatusPill tone="ok" label="ok" />
            )
          ) : (
            <StatusPill tone="danger" label="failed" />
          )}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} style={{ padding: 0 }}>
            <div className="call-body">
              <div className="call-metrics">
                {/* Labelled "Prompt", not "Input": the block below is also
                    called Input and is measured in characters, so two
                    different quantities shared one word 40px apart. */}
                <Metric k="Prompt" v={`${call.input_tokens.toLocaleString()} tok`} />
                <Metric k="Output" v={`${call.output_tokens.toLocaleString()} tok`} />
                {/* A read earns the discount; a write paid to create the
                    prefix. Neither means the call touched no cache. */}
                <Metric
                  k="Cache"
                  v={
                    call.cache_read_tokens > 0
                      ? `${call.cache_read_tokens.toLocaleString()} read`
                      : call.cache_write_tokens > 0
                        ? `${call.cache_write_tokens.toLocaleString()} written`
                        : "none"
                  }
                  good={call.cache_read_tokens > 0}
                />
                <Metric k="Latency" v={`${Math.round(call.latency_ms).toLocaleString()}ms`} />
                <Metric k="Retries" v={String(call.retry_count)} />
                {call.submission_id && (
                  <div className="call-metric">
                    <div className="call-metric-k">Submission</div>
                    <div className="call-metric-v">
                      <Link to={`/submissions/${call.submission_id}/trace`}>
                        Open trace →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
              <IOBlock
                who="User message"
                body={call.input_text}
                missing="Not recorded for this call."
                note={promptGapNote(call)}
              />
              <IOBlock
                who="Output"
                body={call.output_text}
                missing={call.success ? "Not recorded." : "The call failed — no output."}
              />
              {call.metadata && Object.keys(call.metadata).length > 0 && (
                <IOBlock who="Metadata" body={JSON.stringify(call.metadata, null, 2)} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Say out loud how much of the prompt is missing.
 *
 * `llm_client` persists `input_text=user_message` (llm_client.py:577) and,
 * for multi-turn calls, only the LAST user message (`_summarize_last_user_
 * message`, :853). The system prompt — sent on every call at :550, and the
 * part that carries the grading rubric, the tutoring guardrails and the
 * generation spec — is never stored at all.
 *
 * Measured across the call log that is 0.7%–15% of what was actually sent,
 * ~4% typically. A panel that renders that fragment under the heading
 * "Input" and stops is not just incomplete, it is misleading: you would
 * conclude the prompt was tiny. Until the prompt is recorded properly,
 * this states the gap on every call so nobody reasons from the fragment.
 */
function promptGapNote(call: Call): string | undefined {
  const sent = call.input_tokens + Math.max(call.cache_read_tokens, call.cache_write_tokens);
  if (sent <= 0) return undefined;
  const stored = Math.round((call.input_text?.length ?? 0) / 4);
  if (stored >= sent * 0.9) return undefined;
  return `System prompt not recorded — this is the user message only, roughly ${stored.toLocaleString()} of the ${sent.toLocaleString()} tokens actually sent.`;
}

function Metric({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="call-metric">
      <div className="call-metric-k">{k}</div>
      <div className={`call-metric-v${good ? " good" : ""}`}>{v}</div>
    </div>
  );
}

function IOBlock({
  who,
  body,
  missing,
  note,
}: {
  who: string;
  body: string | null;
  missing?: string;
  note?: string;
}) {
  return (
    <div className="io">
      <div className="io-head">
        <span className="io-who">{who}</span>
        {body && <span className="io-len">{body.length.toLocaleString()} chars</span>}
      </div>
      {note && <div className="io-note">{note}</div>}
      <pre className="io-pre">{body ?? missing ?? "—"}</pre>
    </div>
  );
}
