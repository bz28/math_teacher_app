import type { Disposition, Matrix } from "../lib/integrity-set";

// Short axis labels so the grid stays compact; the full labels live in the legend.
const SHORT: Record<string, string> = {
  pass: "Understood",
  needs_practice: "Needs practice",
  tutor_pivot: "Got tutored",
  flag_for_review: "Review",
};

export default function ConfusionMatrix({
  dispositions,
  matrix,
}: {
  dispositions: Disposition[];
  matrix: Matrix;
}) {
  return (
    <div className="it-matrix-wrap">
      <div className="it-matrix-grid">
        <table className="it-matrix">
          <thead>
            <tr>
              <th className="it-matrix-corner">
                <span className="it-axis-pred">predicted →</span>
                <span className="it-axis-gold">↓ gold</span>
              </th>
              {dispositions.map((d) => (
                <th key={d.key} className="it-matrix-colh">
                  {SHORT[d.key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dispositions.map((row, i) => (
              <tr key={row.key}>
                <th className="it-matrix-rowh">{SHORT[row.key]}</th>
                {dispositions.map((col, j) => {
                  const n = matrix.counts[i][j];
                  const diag = i === j;
                  return (
                    <td
                      key={col.key}
                      className={`it-matrix-cell mono ${diag ? "diag" : "off"} ${n === 0 ? "zero" : ""}`}
                    >
                      {n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="it-matrix-note">{matrix.note}</div>
      </div>

      <div className="it-harm">
        {matrix.harm.map((h) => (
          <div key={h.label} className="it-harm-card">
            <div className="it-harm-value mono">{h.value}</div>
            <div className="it-harm-label">{h.label}</div>
            <div className="it-harm-detail">{h.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
