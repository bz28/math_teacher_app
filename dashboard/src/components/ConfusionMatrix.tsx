import type { Disposition, DispositionKey, Matrix } from "../lib/integrity-set";

// Short axis labels so the grid stays compact; the full labels live in the legend.
const SHORT: Record<string, string> = {
  pass: "Understood",
  needs_practice: "Needs practice",
  tutor_pivot: "Got tutored",
  flag_for_review: "Review",
};

// The two harm regions — the cells where a miss would actually hurt a student.
// These are NOT every off-diagonal cell: the benign off-diagonal cells are
// conservative within-band calls. A cell is a harm cell only when the
// prediction lands OUTSIDE the acceptable band in a harmful direction:
//   · false-pass — anything stricter than "Understood" cleared as Understood
//     (a memorizer / copied answer slips through): the Understood column,
//     below the diagonal.
//   · false-flag — an honest, correct student ("Understood" gold) pushed all
//     the way to Review: the top-right corner.
// In this run every one of these is 0 — that's the load-bearing guarantee.
function isHarmCell(gold: DispositionKey, pred: DispositionKey): boolean {
  const falsePass = pred === "pass" && gold !== "pass";
  const falseFlag = gold === "pass" && pred === "flag_for_review";
  return falsePass || falseFlag;
}

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
                  const kind =
                    i === j ? "diag" : isHarmCell(row.key, col.key) ? "harm" : "off";
                  return (
                    <td
                      key={col.key}
                      className={`it-matrix-cell mono ${kind} ${n === 0 ? "zero" : ""}`}
                    >
                      {n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="it-matrix-legend">
          <span className="it-matrix-key it-matrix-key-diag">Exact match</span>
          <span className="it-matrix-key it-matrix-key-off">Within band — conservative call</span>
          <span className="it-matrix-key it-matrix-key-harm">Harm zone — held to zero</span>
        </div>
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
