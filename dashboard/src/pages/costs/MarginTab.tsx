import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import StatTile from "../../components/StatTile";
import type { Stage, UnitEconomicsData } from "../../lib/costsApi";
import { computeMargin, marginAtPrice, type ModelChoice, type Scenario } from "./marginModel";
import {
  STAGES, cardPriceFor, defaultModels, ratesUnmeasured, readRateCard, scenarioDefaults, snapshotParams,
  stageOptions, unknownModels,
  type NumKey,
} from "./marginScenario";
import PricingPanel from "./PricingPanel";
import { usd } from "./spendFormat";
import { useSchoolScope } from "../../lib/useSelectedSchool";

/**
 * Margin — what the measured unit costs mean at a price. Every usage rate
 * starts at what the window measured and each stage's model at what
 * actually ran; the caption under each input says which it is. Moving a
 * model reprices from figures the server computed; nothing is repriced
 * here. The scenario lives in the URL, so a scenario is a link.
 */

interface Slider { key: NumKey; label: string; max: number; step: number }

const RATE_KEYS = ["homework", "quiz", "test", "practice"] as const;

const USAGE: Slider[] = [
  { key: "homework", label: "Homeworks per student per month", max: 12, step: 0.01 },
  { key: "quiz", label: "Quizzes per student per month", max: 8, step: 0.01 },
  { key: "test", label: "Tests per student per month", max: 4, step: 0.01 },
  { key: "practice", label: "Practice sets per student per month", max: 12, step: 0.01 },
  { key: "studentsPerTeacher", label: "Students per teacher", max: 200, step: 0.1 },
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
  // Clamped at the field's floor (subjects ≥ 1, everything else ≥ 0), so
  // the field, the URL and the arithmetic all hold the same number.
  const setNum = (k: NumKey, v: string) => {
    const n = v === "" ? NaN : Math.max(Number(v), k === "subjects" ? 1 : 0);
    set(k, Number.isNaN(n) || n === defaults[k].value ? null : String(n));
  };

  const models: ModelChoice = { ...seeded };
  for (const s of STAGES) {
    const v = params.get(`m_${s}`);
    if (v) models[s] = v;
  }
  const setModel = (s: Stage, id: string) => set(`m_${s}`, id === seeded[s] ? null : id);
  const unknown = unknownModels(models, data.model_catalog);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const school = useSchoolScope();

  const rateCard = readRateCard(params.get("rates"));
  const nums = Object.fromEntries(
    (Object.keys(defaults) as NumKey[]).map((k) => [k, num(k)]),
  ) as Record<NumKey, number>;
  const cardPrice = cardPriceFor(rateCard, nums.enrollment, nums.subjects);
  const scenario: Scenario = { ...nums, pricePerStudent: cardPrice, models };
  const r = computeMargin(data, scenario);
  const months = Math.max(scenario.schoolYearMonths, 1);
  // Until the operator sets a rate themselves.
  const noRates = ratesUnmeasured(data) && RATE_KEYS.every((k) => params.get(k) === null);
  const platformRates = RATE_KEYS.some((k) => defaults[k].source === "platform" && params.get(k) === null);

  const copyLink = () => {
    const q = snapshotParams(params, nums, models, rateCard, school);
    const url = `${window.location.origin}${window.location.pathname}?${q.toString()}`;
    const done = (r: "yes" | "failed") => {
      setCopied(r);
      setTimeout(() => setCopied(null), 2000);
    };
    // No clipboard (insecure context) or permission denied: say so.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(() => done("yes"), () => done("failed"));
  };

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

      <div className="costs-margin-actions">
        <button type="button" className="link-btn" onClick={copyLink}>
          {copied === "yes"
            ? "Copied: every input pinned"
            : copied === "failed"
              ? "Couldn't copy: the browser blocked the clipboard"
              : "Copy link to this scenario"}
        </button>
      </div>

      {platformRates && !noRates && (
        <div className="costs-note" role="note">
          This scope has no submission rates of its own in this window, so usage starts at the platform
          average (every school, same window).
        </div>
      )}

      {unknown.length > 0 && (
        <div className="costs-note warn" role="note">
          This link names a model the catalog doesn&rsquo;t price for{" "}
          {unknown.map((s) => data.models_in_use[s].label).join(", ")} ({unknown.map((s) => models[s]).join(", ")}),
          so that stage keeps its measured cost.
        </div>
      )}

      {!noRates && r.uncosted.length > 0 && (
        <div className="costs-note warn" role="note">
          No {r.uncosted.length > 1 ? `${r.uncosted.slice(0, -1).join(", ")} or ${r.uncosted.at(-1)}` : r.uncosted[0]} cost was measured for this scope in this window, so{" "}
          {r.uncosted.length === 1 ? "it adds" : "they add"} $0 and the margin leaves out their grading, reading and
          integrity cost. Widen the scope or the window before reading it.
        </div>
      )}

      {noRates && (
        <div className="costs-note warn" role="note">
          This window measured no submission rates
          {data.measured.window_too_short ? " (it's under a week)" : ", here or across the platform"}, so usage
          starts at 0 and the margin leaves out grading, reading and integrity cost. Set the rates below or pick a
          longer window before reading it.
        </div>
      )}

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
                  {d.source === "measured"
                    ? `measured: ${d.value}`
                    : d.source === "platform"
                      ? `platform average: ${d.value}`
                      : `assumption · started at ${d.value}`}
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
        {r.trustDeltaPct !== null && (
          <p className="costs-foot">
            Trust check: the calls these costs come from, repriced at published rates on the models that ran,
            land {Math.abs(r.trustDeltaPct) < 0.05 ? "exactly on" : `${Math.abs(r.trustDeltaPct).toFixed(1)}% ${r.trustDeltaPct > 0 ? "above" : "below"}`}{" "}
            what was recorded
            {r.trustUncheckedLegs > 0
              ? ` (${r.trustUncheckedLegs} function${r.trustUncheckedLegs === 1 ? "" : "s"} on unpriced models not checked)`
              : ""}.
          </p>
        )}
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
