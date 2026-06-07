import { useEffect, useState } from "react";
import { api, type HarnessRun, type HarnessRunsData } from "../lib/api";

const PAGE_SIZE = 50;

function fmtCost(c: number | null): string {
  if (c === null) return "—";
  if (c === 0) return "$0 (replay)";
  return `$${c.toFixed(4)}`;
}

/** A self-explaining result chip. A pass is green; a non-pass says *why* in
 *  one word — explore runs report how many scenarios promoted to the
 *  regression corpus, normal runs how many deterministic checks failed — so
 *  the operator never has to open the report to know what needs a look. */
function resultChip(r: HarnessRun): { text: string; bg: string; title: string } {
  if (r.passed) return { text: "PASS", bg: "#1f7a3d", title: r.note ?? "" };
  const promoted = (r.note ?? "").match(/(\d+)\s+promoted/);
  if (promoted && Number(promoted[1]) > 0)
    return { text: `${promoted[1]} promoted`, bg: "#b5731f", title: r.note ?? "" };
  const failed = r.det_total - r.det_pass;
  if (failed > 0) return { text: `${failed} failed`, bg: "#b03a2e", title: r.note ?? "" };
  return { text: "review", bg: "#b5731f", title: r.note ?? "" };
}

export default function HarnessRuns() {
  const [data, setData] = useState<HarnessRunsData | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    api
      .harnessRuns({ limit: String(PAGE_SIZE) })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div style={{ padding: 24, color: "#b03a2e" }}>{error}</div>;
  if (!data) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Harness Runs</h1>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
        Autonomous test-harness runs (tests/harness). Deep detail lives in each
        run's HTML report.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {data.by_probe.map((p) => (
          <div
            key={p.probe}
            style={{
              border: "1px solid #e2ddcf",
              borderRadius: 8,
              padding: "8px 14px",
              background: "#fffdf8",
              fontSize: 13,
            }}
          >
            <b>{p.probe}</b> · {p.runs} runs ·{" "}
            {p.avg_judge !== null ? `avg judge ${p.avg_judge}/5` : "no judge"} ·{" "}
            ${p.total_cost.toFixed(4)} total
          </div>
        ))}
      </div>

      {/* tableLayout:auto overrides the global `table-layout:fixed`, which
          would force all 11 columns to equal width and ellipsis-truncate
          every header. Auto sizes each column to its content; the Prompt
          cell stays capped (maxWidth + ellipsis) so a long steer can't
          stretch the row. */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
          tableLayout: "auto",
        }}
      >
        <thead>
          <tr
            style={{
              textAlign: "left",
              borderBottom: "2px solid #e2ddcf",
              whiteSpace: "nowrap",
            }}
          >
            <th style={{ padding: 8 }}>When</th>
            <th style={{ padding: 8 }}>Probe</th>
            <th style={{ padding: 8 }}>Mode</th>
            <th style={{ padding: 8 }} title="The steer this run tested (hover a cell for the full text)">
              Prompt
            </th>
            <th style={{ padding: 8 }}>Result</th>
            <th style={{ padding: 8 }}>Items</th>
            <th style={{ padding: 8 }} title="Deterministic checks passed / total">
              Det.
            </th>
            <th style={{ padding: 8 }} title="Card screenshots captured">
              Cards
            </th>
            <th style={{ padding: 8 }} title="Mean Haiku judge score / 5 (samples)">
              Judge
            </th>
            <th style={{ padding: 8 }}>Cost</th>
            <th style={{ padding: 8 }}>Report</th>
          </tr>
        </thead>
        <tbody>
          {data.runs.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td style={{ padding: 8, whiteSpace: "nowrap" }}>{r.probe}</td>
              <td style={{ padding: 8 }}>{r.mode}</td>
              {r.prompt ? (
                <td
                  onClick={() => setPromptOpen(r.prompt)}
                  title="Click to view the full prompt"
                  style={{
                    padding: 8,
                    maxWidth: 240,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "#3a6ea5",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                  }}
                >
                  {r.prompt}
                </td>
              ) : (
                <td style={{ padding: 8, color: "#999" }}>—</td>
              )}
              <td style={{ padding: 8 }}>
                {(() => {
                  const chip = resultChip(r);
                  return (
                    <span
                      title={chip.title}
                      style={{
                        fontSize: 11,
                        padding: "1px 7px",
                        borderRadius: 6,
                        color: "#fff",
                        whiteSpace: "nowrap",
                        background: chip.bg,
                      }}
                    >
                      {chip.text}
                    </span>
                  );
                })()}
              </td>
              <td style={{ padding: 8 }}>{r.items_generated}</td>
              <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                {r.det_pass}/{r.det_total}
              </td>
              <td style={{ padding: 8 }}>{r.captures}</td>
              <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                {r.judge_mean !== null ? `${r.judge_mean}/5 (${r.judge_count})` : "—"}
              </td>
              <td style={{ padding: 8 }}>{fmtCost(r.cost_usd)}</td>
              <td style={{ padding: 8 }}>
                <button
                  onClick={() => openReport(r.id)}
                  disabled={loadingReport === r.id}
                  style={{
                    fontSize: 12,
                    padding: "2px 10px",
                    borderRadius: 6,
                    border: "1px solid #c9c2ad",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {loadingReport === r.id ? "…" : "View"}
                </button>
              </td>
            </tr>
          ))}
          {data.runs.length === 0 && (
            <tr>
              <td colSpan={11} style={{ padding: 16, color: "#999" }}>
                No harness runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {promptOpen !== null && (
        <div
          onClick={() => setPromptOpen(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 10,
              width: "min(720px, 92vw)",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 16px",
                borderBottom: "1px solid #eee",
              }}
            >
              <b style={{ fontSize: 13 }}>Prompt tested</b>
              <button
                onClick={() => setPromptOpen(null)}
                style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 16,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "system-ui, sans-serif",
                fontSize: 13,
                lineHeight: 1.5,
                color: "#1a1a17",
              }}
            >
              {promptOpen}
            </pre>
          </div>
        </div>
      )}

      {reportHtml !== null && (
        <div
          onClick={() => setReportHtml(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 10,
              width: "min(1100px, 95vw)",
              height: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 14px",
                borderBottom: "1px solid #eee",
              }}
            >
              <b style={{ fontSize: 13 }}>Harness report</b>
              <button
                onClick={() => setReportHtml(null)}
                style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
            <iframe
              title="Harness report"
              srcDoc={reportHtml}
              // Fully opaque sandbox: no scripts, no same-origin access. The
              // report is now remotely writable (CI POSTs it through the ingest
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
