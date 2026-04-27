import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type LLMCallsData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { useScope } from "../lib/scope";

// Per-submission flight recorder. Pulls every LLM call stamped with
// the given submission_id and renders them as a vertical chronological
// timeline — earliest call at the top, latest at the bottom — with the
// metadata chips, posture, tokens, cost, latency, and input/output
// preview inlined per row. Designed for debugging weird sessions or
// individual cost outliers without scrolling through the global LLM
// Calls list.

const PIPELINE_BUCKETS: { label: string; functions: string[] }[] = [
  { label: "Vision", functions: ["vision_extract"] },
  { label: "Integrity", functions: ["integrity_agent", "integrity_answer_equivalence"] },
  { label: "Grading", functions: ["ai_grading"] },
];

function bucketFor(fnName: string): string {
  for (const b of PIPELINE_BUCKETS) {
    if (b.functions.includes(fnName)) return b.label;
  }
  return "Other";
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtRelativeMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function shortModel(model: string): string {
  if (model.includes("sonnet")) return "Sonnet 4";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("opus")) return "Opus 4";
  return model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
}

export default function SubmissionTrace() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const { scope } = useScope();
  // Scope-aware "back" path — when the user came in via a school
  // route the trail returns to that school's LLM Calls list, not
  // the admin one. Avoids silently bouncing them into Admin scope.
  const llmCallsPath =
    scope.kind === "school"
      ? `/school/${scope.schoolId}/llm-calls`
      : "/admin/llm-calls";
  const [data, setData] = useState<LLMCallsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    // Pull every call for this submission. 200 is comfortably above
    // even pathological pipelines (typical: 5-15 calls per submission).
    api
      .llmCalls({
        submission_id: submissionId,
        limit: "200",
        // Query a wide time window so we don't miss old debug
        // submissions. The submission_id filter is selective enough
        // that this doesn't fan out.
        hours: "8760",
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [submissionId]);

  if (error) {
    return (
      <div>
        <h1>Submission trace</h1>
        <p style={{ color: "#dc2626" }}>{error}</p>
      </div>
    );
  }
  if (!data) return <p>Loading…</p>;

  // Backend returns DESC; flight recorder is ASC chronological.
  const calls = [...data.calls].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  if (calls.length === 0) {
    return (
      <div>
        <h1 style={{ marginBottom: 4 }}>Submission trace</h1>
        <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>
          No LLM calls found for submission{" "}
          <code>{submissionId?.slice(0, 8)}</code>.
        </p>
      </div>
    );
  }

  const totalCost = calls.reduce((s, c) => s + c.cost_usd, 0);
  const totalTokensIn = calls.reduce((s, c) => s + c.input_tokens, 0);
  const totalTokensOut = calls.reduce((s, c) => s + c.output_tokens, 0);
  const failures = calls.filter((c) => !c.success).length;
  const earliest = new Date(calls[0].created_at);
  const latest = new Date(calls[calls.length - 1].created_at);
  const wallMs = latest.getTime() - earliest.getTime();

  // Bucket counts so the user can scan "what stages this submission
  // went through" at the top of the page before reading any rows.
  const bucketCounts = new Map<string, number>();
  for (const c of calls) {
    const b = bucketFor(c.function);
    bucketCounts.set(b, (bucketCounts.get(b) ?? 0) + 1);
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ marginBottom: 4 }}>Submission trace</h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          <code>{submissionId}</code>
        </p>
      </div>

      <div className="trace-summary">
        <div className="trace-summary-cell">
          <div className="trace-summary-label">Calls</div>
          <div className="trace-summary-value">{calls.length}</div>
        </div>
        <div className="trace-summary-cell">
          <div className="trace-summary-label">Total cost</div>
          <div className="trace-summary-value">{fmtCost(totalCost)}</div>
        </div>
        <div className="trace-summary-cell">
          <div className="trace-summary-label">Tokens (in / out)</div>
          <div className="trace-summary-value">
            {totalTokensIn.toLocaleString()} / {totalTokensOut.toLocaleString()}
          </div>
        </div>
        <div className="trace-summary-cell">
          <div className="trace-summary-label">Wall time</div>
          <div className="trace-summary-value">
            {wallMs < 60_000
              ? `${(wallMs / 1000).toFixed(1)}s`
              : `${Math.floor(wallMs / 60_000)}m ${Math.round(
                  (wallMs % 60_000) / 1000,
                )}s`}
          </div>
        </div>
        <div className="trace-summary-cell">
          <div className="trace-summary-label">Failures</div>
          <div
            className="trace-summary-value"
            style={{ color: failures > 0 ? "#dc2626" : "#10b981" }}
          >
            {failures}
          </div>
        </div>
      </div>

      <div className="trace-buckets">
        {Array.from(bucketCounts.entries()).map(([label, count]) => (
          <span key={label} className="trace-bucket-pill">
            {label}: {count}
          </span>
        ))}
      </div>

      <ol className="trace-timeline">
        {calls.map((c, i) => {
          const elapsedMs =
            new Date(c.created_at).getTime() - earliest.getTime();
          const meta = c.metadata ?? {};
          // Posture is a high-signal integrity-pipeline tag; if it's
          // present we surface it on the row header instead of just
          // in the chip strip.
          const posture =
            typeof meta.posture === "string" ? meta.posture : null;
          return (
            <li key={c.id} className={`trace-row ${c.success ? "" : "trace-row-failed"}`}>
              <div className="trace-row-rail">
                <div className="trace-row-index">{i + 1}</div>
              </div>
              <div className="trace-row-body">
                <div className="trace-row-header">
                  <span className="trace-row-fn">{c.function}</span>
                  <span className="trace-row-bucket">{bucketFor(c.function)}</span>
                  {posture && (
                    <span className="trace-row-posture">posture: {posture}</span>
                  )}
                  <span className="trace-row-time" title={c.created_at}>
                    +{fmtRelativeMs(elapsedMs)} · {formatRelativeDate(c.created_at)}
                  </span>
                </div>
                <div className="trace-row-stats">
                  <span>{shortModel(c.model)}</span>
                  <span>
                    {c.input_tokens.toLocaleString()} →{" "}
                    {c.output_tokens.toLocaleString()} tokens
                  </span>
                  <span>{c.latency_ms.toFixed(0)}ms</span>
                  <span>{fmtCost(c.cost_usd)}</span>
                  {c.retry_count > 0 && (
                    <span style={{ color: "#f59e0b" }}>
                      {c.retry_count} retries
                    </span>
                  )}
                  {!c.success && (
                    <span style={{ color: "#dc2626", fontWeight: 700 }}>FAILED</span>
                  )}
                </div>
                <TraceMetadata metadata={c.metadata} />
                <details className="trace-row-detail">
                  <summary>Show input / output</summary>
                  <div className="trace-row-detail-grid">
                    <div>
                      <strong>Input</strong>
                      <pre>{c.input_text || "(not captured)"}</pre>
                    </div>
                    <div>
                      <strong>{c.success ? "Output" : "Error"}</strong>
                      <pre>{c.output_text || "(not captured)"}</pre>
                    </div>
                  </div>
                </details>
              </div>
            </li>
          );
        })}
      </ol>

      <div style={{ marginTop: 16 }}>
        <Link to={`${llmCallsPath}?submission=${submissionId}`}>
          ← Back to LLM Calls list view
        </Link>
      </div>
    </div>
  );
}

function TraceMetadata({
  metadata,
}: {
  metadata: Record<string, unknown> | null;
}) {
  // We render only the high-signal keys here (posture is already
  // shown on the header). Other keys go into the chip strip in their
  // raw form; debugging value > tidiness.
  const skipKeys = new Set(["submission_id", "school_id", "posture"]);
  const entries = metadata
    ? Object.entries(metadata).filter(([k]) => !skipKeys.has(k))
    : [];
  if (entries.length === 0) {
    return <div className="trace-row-meta-empty">no metadata</div>;
  }
  return (
    <div className="trace-row-meta">
      {entries.map(([k, v]) => (
        <span key={k} className="metadata-chip">
          <span className="metadata-chip-label">{k}</span>
          <span className="metadata-chip-value">{renderChipValue(v)}</span>
        </span>
      ))}
    </div>
  );
}

function renderChipValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[unserializable]";
    }
  }
  return String(v);
}
