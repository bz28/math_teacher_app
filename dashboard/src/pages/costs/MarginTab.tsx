import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import StatTile from "../../components/StatTile";
import type { Stage, UnitEconomicsData } from "../../lib/costsApi";
import { computeMargin, marginAtPrice, type ModelChoice, type Scenario } from "./marginModel";
import {
  STAGES, cardPriceFor, defaultModels, readRateCard, scenarioDefaults, stageOptions, type NumKey,
} from "./marginScenario";
import PricingPanel from "./PricingPanel";
import { usd } from "./spendFormat";

/**
 * Margin — what the measured unit costs mean at a price. Every usage rate
 * starts at what the window measured and each stage's model at what
 * actually ran; the caption under each input says which it is. Moving a
 * model reprices from figures the server computed; nothing is repriced
 * here. The scenario lives in the URL, so a scenario is a link.
 */

interface Slider { key: NumKey; label: string; max: number; step: number }

const USAGE: Slider[] = [
  { key: "homework", label: "Homeworks per student per month", max: 12, step: 0.01 },
  { key: "quiz", label: "Quizzes per student per month", max: 8, step: 0.01 },
  { key: "test", label: "Tests per student per month", max: 4, step: 0.01 },
  { key: "practice", label: "Practice sets per student per month", max: 12, step: 0.01 },
  { key: "studentsPerTeacher", label: "Students per teacher", max: 200, step: 1 },
  { key: "studentsPerClass", label: "Students per class", max: 40, step: 1 },
  { key: "unitsPerYear", label: "Units generated per class per year", max: 30, step: 1 },
];

const SWEEP = [14, 20, 24, 28, 32];

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n)}%`;
}

function tone(m: number | null) {
  return m === null ? "default" : m >= 60 ? "ok" : m >= 30 ? "warn" : "danger";
}

interface Props {
  data: UnitEconomicsData;
  modelLabel: (id: string) => string;
}

export default function MarginTab({ data, modelLabel }: Props) {
  const [params, setParams] = useSearchParams();
  const defaults = useMemo(() => scenarioDefaults(data), [data]);
  const seeded = useMemo(() => defaultModels(data), [data]);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  // A URL value overrides the measured default; one equal to the default
  // is dropped, so a link carries only what the sender actually moved.
  const num = (k: NumKey): number => {
    const raw = params.get(k);
    return raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : defaults[k].value;
  };
  const setNum = (k: NumKey, v: string) => set(k, v === "" || Number(v) === defaults[k].value ? null : v);

  const models: ModelChoice = { ...seeded };
  for (const s of STAGES) {
    const v = params.get(`m_${s}`);
    if (v) models[s] = v;
  }
  const setModel = (s: Stage, id: string) => set(`m_${s}`, id === seeded[s] ? null : id);

  const rateCard = readRateCard(params.get("rates"));
  const nums = Object.fromEntries(
    (Object.keys(defaults) as NumKey[]).map((k) => [k, num(k)]),
  ) as Record<NumKey, number>;
  const cardPrice = cardPriceFor(rateCard, nums.enrollment, nums.subjects);
  const scenario: Scenario = { ...nums, pricePerStudent: cardPrice, models };
  const r = computeMargin(data, scenario);
  const months = Math.max(scenario.schoolYearMonths, 1);

  return (
    <div className="costs-margin">
      <div className="tile-grid">
        <StatTile
          label="AI cost / student / mo"
          value={usd(r.costPerStudentMonth)}
          sub={`${usd(r.costPerStudentYear)} per ${months}-month year`}
        />
        <StatTile
          label="Price / student / mo"
          value={usd(cardPrice / months)}
          sub={`${usd(cardPrice, 0)} per student per subject per year`}
        />
        <StatTile label="AI-only gross margin" value={pct(r.marginPct)} tone={tone(r.marginPct)} />
        <StatTile
          label="Fair-use headroom"
          value={r.capHeadroom === null ? "—" : `${r.capHeadroom.toFixed(1)}×`}
          tone={r.overCap ? "danger" : "default"}
          sub={`${r.overCap ? "over" : "vs"} the ${usd(scenario.fairUseCap)} cap`}
        />
      </div>

      {(r.anyThin || r.anyUnpriced || r.excluded.length > 0) && (
        <div className="costs-note warn" role="note">
          {r.anyThin && <>Some unit costs rest on fewer than {data.min_sample} observations. </>}
          {r.excluded.length > 0 && (
            <>Left out because this window is too short to read a monthly rate from: {r.excluded.join(", ")}. </>
          )}
          {r.anyUnpriced && <>Some functions couldn&rsquo;t be repriced and hold their measured cost. </>}
          Treat this margin as directional.
        </div>
      )}

      <div className="costs-margin-grid">
        <section className="costs-section">
          <div className="costs-section-head"><h3>Usage</h3></div>
          {USAGE.map((s) => {
            const d = defaults[s.key];
            const v = nums[s.key];
            return (
              <label key={s.key} className="costs-slider">
                <span className="costs-slider-head">
                  <span>{s.label}</span>
                  <span className="mono">{v}</span>
                </span>
                <input
                  type="range" min={0} max={Math.max(s.max, v)} step={s.step} value={v}
                  onChange={(e) => setNum(s.key, e.target.value)}
                />
                <span className="costs-caption">
                  {d.measured ? `measured: ${d.value}` : `assumption · started at ${d.value}`}
                </span>
              </label>
            );
          })}
        </section>

        <section className="costs-section">
          <div className="costs-section-head"><h3>Model per stage</h3></div>
          {STAGES.map((s) => {
            const used = data.models_in_use[s];
            const options = stageOptions(data.model_catalog, used.catalog_id, models[s]);
            return (
              <div key={s} className="costs-stage">
                <span className="costs-slider-head"><span>{used.label}</span></span>
                <div className="costs-toggle" role="group" aria-label={`${used.label} model`}>
                  {options.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={models[s] === m.id}
                      className={models[s] === m.id ? "on" : ""}
                      onClick={() => setModel(s, m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <span className="costs-caption">
                  {used.model ? `ran on ${modelLabel(used.catalog_id ?? used.model)}` : "didn't run in this window"}
                </span>
              </div>
            );
          })}
          <p className="costs-foot">
            Cost is half the decision: a cheaper misread is a wrong grade in front of a teacher.
            Check accuracy before moving a model.
          </p>
        </section>
      </div>

      <section className="costs-section">
        <div className="costs-section-head"><h3>Where it goes · per student per month</h3></div>
        <table className="costs-table">
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.key} className={l.perStudentMonth ? "" : "muted"}>
                <td>{l.label}</td>
                <td className="num">{usd(l.perStudentMonth, 3)}</td>
                <td className="num">
                  {r.costPerStudentMonth ? `${Math.round((l.perStudentMonth / r.costPerStudentMonth) * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="costs-section">
        <div className="costs-section-head"><h3>Margin by price · per student per subject per year</h3></div>
        <div className="costs-sweep">
          {SWEEP.map((p) => {
            const m = marginAtPrice(r.costPerStudentYear, p, scenario);
            // Under the annual minimum the price doesn't set revenue, the
            // floor does; without saying so every cell reads the same.
            const floored = Math.max(nums.enrollment, 0) * Math.max(nums.subjects, 1) * p < nums.annualMinimum;
            return (
              <div key={p} className={`costs-sweep-cell ${tone(m)}`}>
                <span>${p}</span>
                <strong>{pct(m)}</strong>
                {floored && <em>at the {usd(nums.annualMinimum, 0)} minimum</em>}
              </div>
            );
          })}
        </div>
      </section>

      <PricingPanel
        rateCard={rateCard}
        nums={nums}
        onRates={(next) => set("rates", next ? JSON.stringify(next) : null)}
        onNum={setNum}
        grossProfit={r.grossProfit}
        revenue={r.revenue}
        yearOneNetCash={r.yearOneNetCash}
      />
    </div>
  );
}
