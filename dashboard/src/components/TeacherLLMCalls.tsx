import { useEffect, useState } from "react";
import { api, type LLMCallsData } from "../lib/api";
import { fmtCost, formatRelativeDate } from "../lib/format";
import StatusPill from "./StatusPill";

/**
 * Every model call this teacher caused, opened in place.
 *
 * The teacher page already linked out to /llm-calls pre-filtered, which
 * answered "how much did she cost" but not the question you actually have
 * when she reports something odd: *what did we send, and what came back?*
 * That is one click away into a different page, with the filter to
 * re-apply and her name to re-find.
 *
 * So the calls live here, and expanding one shows the whole exchange —
 * system prompt, user message, raw output — plus the numbers that explain
 * a bad one: tokens, cache traffic, latency, retries, cost. Nothing new is
 * stored; `llm_calls` has carried `input_text` / `output_text` all along.
 */

const PAGE = 25;

export default function TeacherLLMCalls({ teacherId }: { teacherId: string }) {
  const [data, setData] = useState<LLMCallsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .llmCalls({ user_id: teacherId, limit: String(PAGE) })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Couldn&rsquo;t load her calls</div>
        <div>{error}</div>
      </div>
    );
  }

  const calls = data?.calls ?? [];

  if (data && calls.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No model calls yet</div>
        <div>Every call she causes lands here, with its full input and output.</div>
      </div>
    );
  }

  return (
    <div className="dt-scroll">
      {/* Five columns, not nine. `table.dt td` ellipsizes, so nine
          columns in this panel truncated every field that mattered —
          "practice…" is indistinguishable from "practice_eval". Widening
          the table instead just pushed cost and status off-screen.
          Tokens, cache traffic and latency are DETAIL: you want them once
          you've picked a call, not while scanning for it. They moved into
          the expansion, which has room and already holds the exchange. */}
      <table className="dt" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ width: 28 }} aria-hidden="true" />
            <th>When</th>
            <th>Function</th>
            <th>Model</th>
            <th style={{ textAlign: "right" }}>Cost</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data === null
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="dt-row dt-row-skeleton">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j}>
                      <span className="dt-shimmer" style={{ width: "60%" }} />
                    </td>
                  ))}
                </tr>
              ))
            : calls.map((c) => {
                const isOpen = open === c.id;
                return (
                  <CallRows
                    key={c.id}
                    call={c}
                    isOpen={isOpen}
                    onToggle={() => setOpen(isOpen ? null : c.id)}
                  />
                );
              })}
        </tbody>
      </table>
    </div>
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
        <td className="mono">{formatRelativeDate(call.created_at)}</td>
        {/* Longest names still clip at narrow widths; the full one is
            one hover away rather than one column wider. */}
        <td className="mono" title={call.function}>{call.function}</td>
        <td className="mono" title={call.model}>
          {/* "claude-sonnet-4-6" -> "sonnet-4-6"; the date suffix on
              dated snapshots ("haiku-4-5-20251001") adds width and never
              disambiguates anything you'd act on. Full id on hover. */}
          {call.model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}
        </td>
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
                <Metric k="Input" v={call.input_tokens.toLocaleString()} />
                <Metric k="Output" v={call.output_tokens.toLocaleString()} />
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
              </div>
              <IOBlock
                who="Input"
                body={call.input_text}
                missing="Not recorded for this call."
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
}: {
  who: string;
  body: string | null;
  missing?: string;
}) {
  return (
    <div className="io">
      <div className="io-head">
        <span className="io-who">{who}</span>
        {body && <span className="io-len">{body.length.toLocaleString()} chars</span>}
      </div>
      <pre className="io-pre">{body ?? missing ?? "—"}</pre>
    </div>
  );
}
