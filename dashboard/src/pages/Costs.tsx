import { useSearchParams } from "react-router-dom";
import { Checkbox } from "../components/Checkbox";
import { scopeParams, useSchoolScope } from "../lib/useSelectedSchool";
import SpendTab from "./costs/SpendTab";
import "./costs/costs.css";

/**
 * Costs — the console's money job. Spend is what we actually paid and
 * where it went; Unit costs and Margin (next) are what one of each thing
 * costs and what that means at a price.
 *
 * The tab and the internal toggle live in the URL so a link to "spend by
 * teacher, internal included" lands exactly there. The page follows the
 * rail's school scope.
 */

const TABS = [{ key: "spend", label: "Spend" }] as const;
type Tab = (typeof TABS)[number]["key"];

export default function Costs() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "spend";
  // Excluded unless the URL says otherwise: internal calls and preview
  // work aren't a customer's usage.
  const includeInternal = params.get("internal") === "1";
  const scope = useSchoolScope();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <div className="costs-page">
      <div className="page-header">
        <span className="eyebrow">Money</span>
        <h1>Costs</h1>
      </div>

      <div className="costs-tabs">
        <div role="tablist" aria-label="Costs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? "on" : ""}
              onClick={() => set("tab", t.key === "spend" ? null : t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Checkbox
          checked={!includeInternal}
          onChange={(exclude) => set("internal", exclude ? null : "1")}
          label="Exclude internal & preview"
        />
      </div>

      {tab === "spend" && (
        <SpendTab scopeParams={scopeParams(scope)} includeInternal={includeInternal} />
      )}
    </div>
  );
}
