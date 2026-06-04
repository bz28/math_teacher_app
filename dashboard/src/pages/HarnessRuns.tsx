import { useEffect, useState } from "react";
import { api, type HarnessRunsData } from "../lib/api";

const PAGE_SIZE = 50;

function fmtCost(c: number | null): string {
  if (c === null) return "—";
  if (c === 0) return "$0 (replay)";
  return `$${c.toFixed(4)}`;
}

export default function HarnessRuns() {
  const [data, setData] = useState<HarnessRunsData | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e2ddcf" }}>
            <th style={{ padding: 8 }}>When</th>
            <th style={{ padding: 8 }}>Probe</th>
            <th style={{ padding: 8 }}>Mode</th>
            <th style={{ padding: 8 }}>Result</th>
            <th style={{ padding: 8 }}>Items</th>
            <th style={{ padding: 8 }}>Det. checks</th>
            <th style={{ padding: 8 }}>Cards</th>
            <th style={{ padding: 8 }}>Judge mean</th>
            <th style={{ padding: 8 }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.runs.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td style={{ padding: 8 }}>{r.probe}</td>
              <td style={{ padding: 8 }}>{r.mode}</td>
              <td style={{ padding: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 7px",
                    borderRadius: 6,
                    color: "#fff",
                    background: r.passed ? "#1f7a3d" : "#b03a2e",
                  }}
                >
                  {r.passed ? "PASS" : "CHECK"}
                </span>
              </td>
              <td style={{ padding: 8 }}>{r.items_generated}</td>
              <td style={{ padding: 8 }}>
                {r.det_pass}/{r.det_total}
              </td>
              <td style={{ padding: 8 }}>{r.captures}</td>
              <td style={{ padding: 8 }}>
                {r.judge_mean !== null ? `${r.judge_mean}/5 (${r.judge_count})` : "—"}
              </td>
              <td style={{ padding: 8 }}>{fmtCost(r.cost_usd)}</td>
            </tr>
          ))}
          {data.runs.length === 0 && (
            <tr>
              <td colSpan={9} style={{ padding: 16, color: "#999" }}>
                No harness runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
