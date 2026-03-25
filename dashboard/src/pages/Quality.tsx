import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from "recharts";
import { api, type QualityData } from "../lib/api";
import StatCard from "../components/StatCard";

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 4 ? "#10b981" : score >= 3 ? "#f59e0b" : "#ef4444";
  return (
    <span
      style={{
        display: "inline-block",
        width: 28,
        textAlign: "center",
        fontWeight: 600,
        color,
      }}
    >
      {score}
    </span>
  );
}

export default function Quality() {
  const [data, setData] = useState<QualityData | null>(null);
  const [hours, setHours] = useState("168");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api
      .quality({ hours, only_failed: onlyFailed ? "true" : "" })
      .then(setData)
      .catch((e) => console.error("Quality API error:", e));
  }, [hours, onlyFailed]);

  if (!data) return <p>Loading...</p>;

  const { summary } = data;

  const avgChartData = [
    { name: "Correctness", score: summary.avg_correctness ?? 0, fill: "#10b981" },
    { name: "Optimality", score: summary.avg_optimality ?? 0, fill: "#6366f1" },
    { name: "Clarity", score: summary.avg_clarity ?? 0, fill: "#f59e0b" },
    { name: "Flow", score: summary.avg_flow ?? 0, fill: "#06b6d4" },
  ];

  return (
    <div>
      <h1>Solution Quality</h1>

      <div className="filters">
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(e) => setOnlyFailed(e.target.checked)}
          />
          Failed only
        </label>
      </div>

      <div className="stat-grid">
        <StatCard label="Total Evaluated" value={summary.total} />
        <StatCard label="Passed" value={summary.passed} sub={`${summary.pass_rate}%`} />
        <StatCard label="Avg Correctness" value={Number(summary.avg_correctness ?? 0).toFixed(1)} />
        <StatCard label="Avg Clarity" value={Number(summary.avg_clarity ?? 0).toFixed(1)} />
      </div>

      <div className="chart-row">
        <div className="chart-card">
          <h3>Average Scores</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={avgChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 5]} />
              <Tooltip />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {avgChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-card">
        <h3>Evaluations ({data.scores.length})</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Problem</th>
              <th>Correct</th>
              <th>Optimal</th>
              <th>Clarity</th>
              <th>Flow</th>
              <th>Pass</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {data.scores.map((s) => (
              <>
                <tr
                  key={s.id}
                  className="clickable"
                  onClick={() =>
                    setExpandedId(expandedId === s.id ? null : s.id)
                  }
                >
                  <td>{expandedId === s.id ? "\u25BC" : "\u25B6"}</td>
                  <td>{s.problem}</td>
                  <td><ScoreBadge score={s.correctness} /></td>
                  <td><ScoreBadge score={s.optimality} /></td>
                  <td><ScoreBadge score={s.clarity} /></td>
                  <td><ScoreBadge score={s.flow} /></td>
                  <td>{s.passed ? "PASS" : "FAIL"}</td>
                  <td>{new Date(s.created_at).toLocaleString()}</td>
                </tr>
                {expandedId === s.id && (
                  <tr key={`${s.id}-detail`}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div className="call-detail">
                        <div className="call-detail-section">
                          <strong>Issues</strong>
                          <pre>{s.issues || "None"}</pre>
                        </div>
                        <div className="call-detail-section">
                          <strong>Session ID</strong>
                          <pre>{s.session_id}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
