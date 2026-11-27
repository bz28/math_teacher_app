import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import type { OrphanSummary, UnitCost, UnitEconomicsData } from "../../lib/costsApi";
import { STAGES } from "./marginScenario";
import { usd } from "./spendFormat";

/**
 * Unit costs — what ONE of each thing costs: a homework handed in, a
 * teaching unit's problems generated, a teacher's or a student's month of
 * AI. Measured, not editable; the Margin tab is where assumptions live.
 *
 * Under the minimum sample a cost reads "not enough data", never $0. Each
 * row opens into the functions that make it up, priced on the model that
 * actually ran.
 */

const KIND_LABEL: Record<string, string> = {
  "submission:homework": "Homework",
  "submission:quiz": "Quiz",
  "submission:test": "Test",
  "submission:practice": "Practice",
  "generation:unit": "Unit generation",
  "residual:teacher": "Teacher-side AI",
  "residual:student": "Self-study",
};

/** A signed percent that never reads "−0.0%". */
function gap(pct: number): string {
  const r = Math.round(pct * 10) / 10;
  return `${r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}%`;
}

function cost(n: number | null): string {
  return n === null ? "—" : usd(n, 3);
}

function Sufficiency({ u, minSample }: { u: UnitCost; minSample: number }) {
  if (u.n === 0) return <span className="costs-pill">no data</span>;
  if (u.n < minSample) return <span className="costs-pill warn">not enough data</span>;
  if (u.window_too_short) return <span className="costs-pill warn">window too short</span>;
  return <span className="costs-pill ok">enough data</span>;
}

function orphanLine(o: OrphanSummary, what: string, over: string): string | null {
  if (!o.calls) return null;
  return `${o.calls.toLocaleString()} calls (${usd(o.cost_usd)}) ran for ${what} since deleted; they ride on the ${o.spread_over.toLocaleString()} surviving ${over}, +${usd(o.per_unit_usd, 4)} each.`;
}

interface Props {
  data: UnitEconomicsData;
  modelLabel: (id: string) => string;
}

export default function UnitCostsTab({ data, modelLabel }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const rec = data.reconciliation;
  const notes = [
    orphanLine(data.deleted_submissions, "submissions", "submissions"),
    orphanLine(data.deleted_generation_jobs, "discarded generation drafts", "units"),
  ].filter(Boolean);

  return (
    <div className="costs-units">
      <table className="costs-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th className="num">n</th>
            <th className="num">Median</th>
            <th className="num">Mean</th>
            <th className="num">p90</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.units.map((u) => {
            const fns = data.functions_by_unit[u.kind] ?? [];
            const isOpen = open === u.kind;
            return (
              <Fragment key={u.kind}>
                <tr className={u.n ? "" : "muted"}>
                  <td>
                    {fns.length ? (
                      <button
                        type="button"
                        className="costs-expand"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : u.kind)}
                      >
                        <span aria-hidden>{isOpen ? "▾" : "▸"}</span> {KIND_LABEL[u.kind] ?? u.label}
                      </button>
                    ) : (KIND_LABEL[u.kind] ?? u.label)}
                    <span className="costs-caption">{u.denominator}</span>
                  </td>
                  <td className="num">{u.n.toLocaleString()}</td>
                  <td className="num">{cost(u.cost_median)}</td>
                  <td className="num">{cost(u.cost_mean)}</td>
                  <td className="num">{u.n < data.min_sample ? "—" : cost(u.cost_p90)}</td>
                  <td><Sufficiency u={u} minSample={data.min_sample} /></td>
                </tr>
                {isOpen && (
                  <tr className="costs-legs">
                    <td colSpan={6}>
                      <table>
                        <thead>
                          <tr>
                            <th>Function</th>
                            <th>Ran on</th>
                            <th className="num">Calls / unit</th>
                            <th className="num">$ / unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fns.map((f) => (
                            <tr key={f.function}>
                              <td className="mono">
                                <Link to={`/llm-calls?function=${encodeURIComponent(f.function)}`}>{f.function}</Link>
                              </td>
                              <td>
                                {f.models.map(modelLabel).join(", ")}
                              </td>
                              <td className="num">{f.calls_per_unit.toFixed(2)}</td>
                              <td className="num">{usd(f.cost_per_unit, 4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="costs-foot">
        Under {data.min_sample} observations a cost reads &ldquo;not enough data&rdquo;, never $0. Recorded
        spend vs published rates: gap {gap(rec.gap_pct)}
        {rec.unpriced_models.length > 0 && <> · unpriced: {rec.unpriced_models.join(", ")}</>}.
      </p>
      {notes.map((n) => <p key={n} className="costs-foot">{n}</p>)}

      <section className="costs-section costs-stages">
        <div className="costs-section-head"><h3>Model each stage ran on</h3></div>
        <table className="costs-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Model</th>
              <th className="num">Spend in window</th>
            </tr>
          </thead>
          <tbody>
            {STAGES.map((key) => data.models_in_use[key]).map((s) => (
              <tr key={s.label} className={s.model ? "" : "muted"}>
                <td>{s.label}</td>
                <td className={s.model ? "mono" : ""}>
                  {s.model ? modelLabel(s.catalog_id ?? s.model) : "didn't run"}
                </td>
                <td className="num">{s.model ? usd(s.cost_usd) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
