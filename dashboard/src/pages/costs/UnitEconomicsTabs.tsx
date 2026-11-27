import { useSearchParams } from "react-router-dom";
import ErrorState from "../../components/ErrorState";
import MarginTab from "./MarginTab";
import UnitCostsTab from "./UnitCostsTab";
import { WINDOWS, useUnitEconomics, windowLabel } from "./useUnitEconomics";

/**
 * The Unit costs and Margin tabs share one /admin/unit-economics fetch and
 * one window, so switching between them is instant and both read the same
 * numbers. The window lives in the URL (`days`; empty = since the model
 * cutover).
 */

interface Props {
  tab: "units" | "margin";
  scopeParams: Record<string, string>;
  includeInternal: boolean;
}

export default function UnitEconomicsTabs({ tab, scopeParams, includeInternal }: Props) {
  const [params, setParams] = useSearchParams();
  const days = params.get("days") ?? "";
  const { data, error, retry } = useUnitEconomics(scopeParams, includeInternal, days);

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data) return <p className="loading">Loading…</p>;

  const labels = new Map(data.model_catalog.map((m) => [m.id, m.label]));
  const modelLabel = (id: string) => labels.get(id) ?? id;

  const setDays = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set("days", v);
    else next.delete("days");
    setParams(next, { replace: true });
  };

  return (
    <div className="costs-section">
      <div className="costs-section-head">
        <h3>
          {tab === "units" ? "What one of each thing costs" : "Margin simulator"} ·{" "}
          {windowLabel(data, days, modelLabel)}
        </h3>
        <select aria-label="Window" value={days} onChange={(e) => setDays(e.target.value)}>
          {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
        </select>
      </div>
      {tab === "units"
        ? <UnitCostsTab data={data} modelLabel={modelLabel} />
        : <MarginTab data={data} modelLabel={modelLabel} />}
    </div>
  );
}
