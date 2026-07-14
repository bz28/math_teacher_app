import { useEffect, useMemo, useState } from "react";
import { api, type HarnessRun, type HarnessRunsData, type ProbeHealth } from "../lib/api";
import { fmtCost, formatRelativeDate } from "../lib/format";
import { HARNESS_STALE_AFTER_HOURS, isHarnessStale } from "../lib/definitions";
import StatusPill, { type PillTone } from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { Pagination } from "../components/Pagination";
import ErrorState from "../components/ErrorState";

const PAGE_SIZE = 50;

/** Deterministic pass-rate as a fraction, or null when a run ran no
 *  deterministic checks (so we never divide by zero or fake a 0%). */
function detRate(pass: number, total: number): number | null {
  return total > 0 ? pass / total : null;
}

/** A self-explaining result chip. A pass is moss; a non-pass says *why* in
 *  one word — explore runs report how many scenarios promoted to the
 *  regression corpus, normal runs how many deterministic checks failed — so
 *  the operator never has to open the report to know what needs a look. */
function resultChip(r: HarnessRun): { tone: PillTone; label: string } {
  if (r.passed) return { tone: "ok", label: "PASS" };
  const promoted = (r.note ?? "").match(/(\d+)\s+promoted/);
  if (promoted && Number(promoted[1]) > 0)
    return { tone: "warn", label: `${promoted[1]} PROMOTED` };
  const failed = r.det_total - r.det_pass;
  if (failed > 0) return { tone: "danger", label: `${failed} FAILED` };
  return { tone: "warn", label: "REVIEW" };
}

/* ── Per-probe health card — the AI-quality regression alarm ──────────── */

function ProbeSpark({ data, tone }: { data: number[]; tone: PillTone }) {
  if (data.length < 2) return null;
  const w = 132;
  const h = 26;
  const step = w / (data.length - 1);
  // Deterministic pass-rate is already a 0–1 fraction, so the axis is fixed
  // (0 = all failed, 1 = all passed) — a dip is a real quality drop, not a
  // rescaled artifact of the window's own min/max.
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - Math.max(0, Math.min(1, v)) * (h - 2) - 1;
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pts[0][0]},${h} ${line} ${pts[pts.length - 1][0]},${h}`;
  const stroke = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : "var(--ok)";
  return (
    <svg className="probe-card-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={area} fill="var(--accent-soft)" opacity={0.5} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.25} />
    </svg>
  );
}

function ProbeHealthCard({ p, onOpenReport }: { p: ProbeHealth; onOpenReport: (id: string) => void }) {
  const stale = isHarnessStale(p.last_run_at);
  const rate = detRate(p.latest_det_pass, p.latest_det_total);
  const prevRate =
    p.prev_det_total !== null && p.prev_det_pass !== null
      ? detRate(p.prev_det_pass, p.prev_det_total)
      : null;
  const regressed = rate !== null && prevRate !== null && rate < prevRate;

  // Verdict drives the whole card's tone. A stale probe is muted even if its
  // last run passed — a green light nobody's refreshing isn't reassurance.
  const tone: PillTone = !p.latest_passed || regressed ? "danger" : stale ? "neutral" : "ok";

  return (
    <button
      type="button"
      className={`probe-card probe-card-${tone}`}
      onClick={() => onOpenReport(p.latest_run_id)}
      title="Open this probe's latest report"
    >
      <div className="probe-card-head">
        <span className="probe-card-name">{p.probe}</span>
        <span className="probe-card-pills">
          {stale && <StatusPill tone="neutral" label="STALE" />}
          {regressed && <StatusPill tone="danger" label="REGRESSION" />}
        </span>
      </div>

      <div className={`probe-card-verdict probe-card-verdict-${tone}`}>
        {p.latest_passed ? "PASS" : "FAIL"}
      </div>

      <div className="probe-card-det">
        <span className={`probe-card-det-rate${regressed || rate === null || rate < 1 ? " probe-card-det-bad" : ""}`}>
          {rate === null ? "—" : `${p.latest_det_pass}/${p.latest_det_total}`}
        </span>
        <span className="probe-card-det-label">det. checks</span>
        {p.prev_det_total !== null && (
          <span className={`probe-card-delta${regressed ? " probe-card-delta-bad" : ""}`}>
            was {p.prev_det_pass}/{p.prev_det_total}
          </span>
        )}
      </div>

      <ProbeSpark data={p.spark} tone={tone} />

      <div className="probe-card-meta">
        <span>
          {p.recent_judge_mean !== null ? `judge ${p.recent_judge_mean}/5` : "no judge"}
        </span>
        <span aria-hidden="true">·</span>
        <span>{p.total_runs} run{p.total_runs === 1 ? "" : "s"}</span>
        <span aria-hidden="true">·</span>
        <span className={stale ? "probe-card-stale-time" : undefined}>
          {formatRelativeDate(p.last_run_at)}
        </span>
      </div>
    </button>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function HarnessRuns() {
  const [data, setData] = useState<HarnessRunsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [probe, setProbe] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState<string | null>(null);

  const openReport = (id: string) => {
    setLoadingReport(id);
    api
      .harnessReport(id)
      .then((r) => setReportHtml(r.html))
      .catch(() => setReportHtml("<p style='padding:24px'>No report stored for this run.</p>"))
      .finally(() => setLoadingReport(null));
  };

  useEffect(() => {
    let cancelled = false;
    const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(offset) };
    if (probe) params.probe = probe;
    if (failedOnly) params.failed_only = "true";
    api
      .harnessRuns(params)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [probe, failedOnly, offset, reloadKey]);

  // Probe names for the filter dropdown — union of what's live in the health
  // band and the currently-selected probe (so a filtered-out selection stays
  // selectable). Sorted for a stable menu.
  const probeNames = useMemo(() => {
    const names = new Set((data?.probe_health ?? []).map((p) => p.probe));
    if (probe) names.add(probe);
    return [...names].sort();
  }, [data, probe]);

  const columns: Column<HarnessRun>[] = useMemo(
    () => [
      {
        key: "result",
        header: "Result",
        width: "34%",
        sortValue: (r) => (r.passed ? 0 : r.det_total - r.det_pass || 1),
        render: (r) => {
          const chip = resultChip(r);
          return (
            <div className="hr-result">
              <StatusPill tone={chip.tone} label={chip.label} />
              {r.note && (
                <span
                  className={`hr-note${r.prompt ? " hr-note-link" : ""}`}
                  title={r.prompt ? "Click to view the steer this run tested" : r.note}
                  onClick={
                    r.prompt
                      ? (e) => {
                          e.stopPropagation();
                          setPromptOpen(r.prompt);
                        }
                      : undefined
                  }
                >
                  {r.note}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "when",
        header: "When",
        width: "11%",
        sortValue: (r) => new Date(r.created_at).getTime(),
        render: (r) => (
          <span title={new Date(r.created_at).toLocaleString()}>
            {formatRelativeDate(r.created_at)}
          </span>
        ),
      },
      { key: "probe", header: "Probe", width: "11%", render: (r) => r.probe },
      { key: "mode", header: "Mode", width: "9%", render: (r) => r.mode },
      {
        key: "det",
        header: "Det.",
        numeric: true,
        width: "8%",
        sortValue: (r) => detRate(r.det_pass, r.det_total) ?? -1,
        render: (r) => (
          <span className={r.det_total > 0 && r.det_pass < r.det_total ? "hr-det-bad" : undefined}>
            {r.det_total > 0 ? `${r.det_pass}/${r.det_total}` : "—"}
          </span>
        ),
      },
      {
        key: "judge",
        header: "Judge",
        numeric: true,
        width: "10%",
        sortValue: (r) => r.judge_mean ?? -1,
        render: (r) =>
          r.judge_mean !== null ? (
            <>
              {r.judge_mean}/5 <span className="hr-dim">({r.judge_count})</span>
            </>
          ) : (
            "—"
          ),
      },
      {
        key: "items",
        header: "Items",
        numeric: true,
        width: "7%",
        sortValue: (r) => r.items_generated,
        render: (r) => r.items_generated,
      },
      {
        key: "report",
        header: "Report",
        align: "center",
        width: "8%",
        render: (r) => (
          <button
            className="hr-report-btn"
            onClick={(e) => {
              e.stopPropagation();
              openReport(r.id);
            }}
            disabled={loadingReport === r.id}
          >
            {loadingReport === r.id ? "…" : "View"}
          </button>
        ),
      },
    ],
    [loadingReport],
  );

  if (!data && error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }

  const summary = data?.summary;
  const health = data?.probe_health ?? [];
  const ciStale = isHarnessStale(summary?.newest_run_at);
  const failingProbes = health.filter((p) => {
    const rate = detRate(p.latest_det_pass, p.latest_det_total);
    const prevRate =
      p.prev_det_total !== null && p.prev_det_pass !== null
        ? detRate(p.prev_det_pass, p.prev_det_total)
        : null;
    const regressed = rate !== null && prevRate !== null && rate < prevRate;
    return !p.latest_passed || regressed;
  }).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">AI quality</span>
          <h1>Harness Runs</h1>
          <p>Is generation quality holding — and did anything regress since the last run?</p>
        </div>
      </div>

      {/* ── Top-line alarm ─────────────────────────────────────────────── */}
      {summary && (
        <div className={`probe-alarm${summary.recent_failing > 0 || ciStale ? " probe-alarm-hot" : ""}`}>
          <div className="probe-alarm-line">
            {summary.recent_window === 0 ? (
              <>
                <StatusPill tone="neutral" label="NO RUNS" />
                <span>No harness runs recorded yet.</span>
              </>
            ) : summary.recent_failing > 0 ? (
              <>
                <StatusPill tone="danger" label="ATTENTION" />
                <span>
                  <b>{summary.recent_failing}</b> of the last {summary.recent_window} runs failing
                  {failingProbes > 0 && <> across <b>{failingProbes}</b> probe{failingProbes === 1 ? "" : "s"}</>}.
                </span>
              </>
            ) : (
              <>
                <StatusPill tone="ok" label="HOLDING" />
                <span>
                  All {summary.recent_window} recent runs passing across {summary.probe_count} probe
                  {summary.probe_count === 1 ? "" : "s"}.
                </span>
              </>
            )}
            <span className="probe-alarm-cost">{fmtCost(summary.recent_cost)} · last {summary.recent_window} runs</span>
          </div>
          {ciStale && summary.recent_window > 0 && (
            <div className="probe-alarm-stale">
              <StatusPill tone="warn" label="STALE" />
              No new run in over {HARNESS_STALE_AFTER_HOURS}h — CI may have stopped reporting.
            </div>
          )}
        </div>
      )}

      {/* ── Per-probe health band ──────────────────────────────────────── */}
      {health.length > 0 && (
        <div className="probe-band">
          {health.map((p) => (
            <ProbeHealthCard key={p.probe} p={p} onOpenReport={openReport} />
          ))}
        </div>
      )}

      {/* ── Run log ────────────────────────────────────────────────────── */}
      <div className="table-card">
        <div className="hr-log-head">
          <h3 style={{ marginBottom: 0 }}>
            Run log{data ? <span className="hr-count"> · {data.total_count}</span> : null}
          </h3>
          <div className="hr-filters">
            <select
              value={probe}
              onChange={(e) => { setProbe(e.target.value); setOffset(0); }}
            >
              <option value="">All probes</option>
              {probeNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              type="button"
              className={`hr-toggle${failedOnly ? " hr-toggle-on" : ""}`}
              aria-pressed={failedOnly}
              onClick={() => { setFailedOnly((v) => !v); setOffset(0); }}
            >
              Failures only
            </button>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={data?.runs ?? []}
          rowKey={(r) => r.id}
          loading={!data && !error}
          error={data ? null : error}
          onRetry={() => { setError(null); setReloadKey((k) => k + 1); }}
          defaultSort={{ key: "when", dir: "desc" }}
          minWidth={820}
          empty={
            <span className="dt-state-title">
              {failedOnly ? "No failing runs — nice." : "No harness runs yet."}
            </span>
          }
        />

        {data && (
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total_count} onChange={setOffset} />
        )}
      </div>

      {promptOpen !== null && (
        <div className="hr-modal-scrim" onClick={() => setPromptOpen(null)}>
          <div className="hr-modal hr-modal-prompt" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-head">
              <b>Prompt tested</b>
              <button className="hr-modal-close" onClick={() => setPromptOpen(null)}>✕</button>
            </div>
            <pre className="hr-modal-prompt-body">{promptOpen}</pre>
          </div>
        </div>
      )}

      {reportHtml !== null && (
        <div className="hr-modal-scrim" onClick={() => setReportHtml(null)}>
          <div className="hr-modal hr-modal-report" onClick={(e) => e.stopPropagation()}>
            <div className="hr-modal-head">
              <b>Harness report</b>
              <button className="hr-modal-close" onClick={() => setReportHtml(null)}>✕</button>
            </div>
            <iframe
              title="Harness report"
              srcDoc={reportHtml}
              // Fully opaque sandbox: no scripts, no same-origin access. The
              // report is remotely writable (CI POSTs it through the ingest
              // endpoint), so it's untrusted HTML. Self-contained inline CSS +
              // base64 data-URI screenshots still render under this lockdown.
              sandbox=""
              style={{ flex: 1, border: "none", width: "100%" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
