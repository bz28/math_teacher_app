import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, type UnitEconomicsData } from "../lib/api";
import { FEATURE_BUCKETS } from "../lib/llm_modes";
import {
  computeMargin, marginAtPrice, type ModelChoice, type Scenario,
} from "../lib/marginModel";
import { scopeParams, useSchoolScope } from "../lib/useSelectedSchool";
import StatTile from "../components/StatTile";
import ErrorState from "../components/ErrorState";

/**
 * Unit Economics & Margin Simulator.
 *
 * Left half is MEASURED and not editable; right half is the operator's
 * assumptions. Keeping that split visible is the page's whole idea — a
 * margin figure is only defensible if you can see which half of it is a
 * fact. Every repriced number arrives precomputed from the backend; this
 * page looks up and multiplies, it never reprices.
 */

// Scenario defaults. The rate card, minimum, onboarding fee and school
// year are the owner's v1 spreadsheet figures, seeded as a starting
// point and editable — a rate-card change must not need a deploy.
const DEFAULT_RATE_CARD: number[][] = [
  [32, 29, 26, 23],
  [28, 25, 22, 20],
  [24, 22, 19, 17],
  [20, 18, 16, 14],
];
const TIER_LABELS = ["1–99", "100–299", "300–599", "600+"];
const TIER_MINS = [1, 100, 300, 600];

const DEFAULTS: Omit<Scenario, "models"> = {
  enrollment: 92,
  studentsPerClass: 24,
  studentsPerTeacher: 30,
  subjects: 1,
  homework: 8,
  quiz: 2,
  test: 0.5,
  practice: 4,
  unitsPerYear: 8,
  schoolYearMonths: 9.5,
  pricePerStudent: 28,
  annualMinimum: 3000,
  onboardingFee: 1500,
  fixedMonthly: 250,
  fairUseCap: 1.5,
};

const NUM_KEYS = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];

function usd(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  })}`;
}

function pct(n: number | null, dp = 1): string {
  return n === null ? "—" : `${n.toFixed(dp)}%`;
}

function tierFor(enrollment: number): number {
  for (let i = TIER_MINS.length - 1; i >= 0; i--) {
    if (enrollment >= TIER_MINS[i]) return i;
  }
  return 0;
}

export default function UnitEconomics() {
  const schoolId = useSchoolScope();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<UnitEconomicsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<string>(params.get("days") ?? "");
  const [excludeInternal, setExcludeInternal] = useState(
    params.get("internal") !== "1",
  );
  const [rateCard, setRateCard] = useState<number[][]>(() => {
    const raw = params.get("rates");
    if (!raw) return DEFAULT_RATE_CARD;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length === 4 ? parsed : DEFAULT_RATE_CARD;
    } catch {
      return DEFAULT_RATE_CARD;
    }
  });

  // Scenario numbers live in the URL so a scenario is a shareable link.
  const scenarioNums = useMemo(() => {
    const out = { ...DEFAULTS };
    for (const k of NUM_KEYS) {
      const raw = params.get(k);
      if (raw !== null && raw !== "" && Number.isFinite(Number(raw))) {
        out[k] = Number(raw);
      }
    }
    return out;
  }, [params]);

  const [models, setModels] = useState<ModelChoice>({});

  // State is set only from the promise callbacks, never synchronously in
  // the effect body — the same shape the other console pages use. Stale
  // data stays on screen while a refetch is in flight, which avoids a
  // flash of "Loading…" every time a filter moves.
  useEffect(() => {
    let cancelled = false;
    const q: Record<string, string> = {
      ...scopeParams(schoolId),
      exclude_internal: String(excludeInternal),
    };
    if (days) q.days = days;
    api
      .unitEconomics(q)
      .then((d) => {
        if (cancelled) return;
        setError(null);
        setData(d);
        // Seed each knob with the model those calls actually ran on, so
        // the page opens showing today's reality rather than a guess.
        setModels((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const seeded: ModelChoice = {};
          for (const b of FEATURE_BUCKETS) {
            const match = Object.values(d.functions_by_unit)
              .flat()
              .find((f) => b.functions.includes(f.function));
            // measured_catalog_id, not measured_model: the raw id can
            // carry a date pin that matches no <option> value, which
            // makes the select fall back to the first model in the list.
            seeded[b.key] =
              match?.measured_catalog_id ??
              d.model_catalog.find((m) => m.is_configured)?.id ??
              d.model_catalog[0]?.id ??
              "";
          }
          return seeded;
        });
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [schoolId, days, excludeInternal]);

  function setNum(key: keyof typeof DEFAULTS, value: string) {
    const next = new URLSearchParams(params);
    if (value === "" || Number(value) === DEFAULTS[key]) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  function setRate(tier: number, subj: number, value: string) {
    const next = rateCard.map((r) => [...r]);
    next[tier][subj] = Number(value) || 0;
    setRateCard(next);
    const p = new URLSearchParams(params);
    p.set("rates", JSON.stringify(next));
    setParams(p, { replace: true });
  }

  const tier = tierFor(scenarioNums.enrollment);
  const subjIdx = Math.min(Math.max(scenarioNums.subjects, 1), 4) - 1;
  const cardPrice = rateCard[tier]?.[subjIdx] ?? DEFAULTS.pricePerStudent;

  const scenario: Scenario = useMemo(
    () => ({ ...scenarioNums, pricePerStudent: cardPrice, models }),
    [scenarioNums, cardPrice, models],
  );

  const result = useMemo(
    () => (data ? computeMargin(data, scenario) : null),
    [data, scenario],
  );

  if (loading && !data) return <div className="loading">Loading unit economics…</div>;
  if (error) {
    return <ErrorState message={error} onRetry={() => setDays((d) => d)} />;
  }
  if (!data || !result) return null;

  const gap = data.reconciliation.gap_pct;
  const gapIsReal = Math.abs(gap) > 1;
  const marginTone =
    result.marginPct === null ? "default"
      : result.marginPct >= 60 ? "ok"
      : result.marginPct >= 30 ? "warn"
      : "danger";

  const featureCostData = result.lines
    .filter((l) => l.perStudentMonth > 0)
    .map((l) => ({ name: l.label, cost: Number(l.perStudentMonth.toFixed(4)) }));

  const sweepPrices = [14, 20, 24, 28, 32];
  const sweep = sweepPrices.map((p) => ({
    name: `$${p}`,
    margin: Number((marginAtPrice(result.costPerStudentYear, p) ?? 0).toFixed(1)),
  }));

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Unit economics</span>
        <h1>Margin simulator</h1>
        <p>
          What one homework, exam or generated unit actually costs us — and the
          margin that follows at a given price per student.
        </p>
      </div>

      {/* ── Window + basis ─────────────────────────────────────────── */}
      <div className="filters" style={{ alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <label className="stat-label" htmlFor="ue-days">Window</label>
        <select
          id="ue-days"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="">
            Since the model changed
            {data.window.cutover_model ? ` (${data.window.cutover_model})` : ""}
          </option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            id="ue-internal"
            type="checkbox"
            checked={excludeInternal}
            onChange={(e) => setExcludeInternal(e.target.checked)}
          />
          <span className="stat-label" style={{ margin: 0 }}>Exclude internal traffic</span>
        </label>

        <span className="filter-badge" title="Recorded spend vs the same tokens priced at published rates">
          Portal {gap >= 0 ? "+" : ""}{gap.toFixed(1)}%
          {gapIsReal ? " ⚠" : " ✓"}
        </span>
        {result.trustDeltaPct !== null && (
          <span
            className="filter-badge"
            title="Repricing onto the models we actually ran must reproduce what we paid"
          >
            Trust check {result.trustDeltaPct >= 0 ? "+" : ""}
            {result.trustDeltaPct.toFixed(1)}%
          </span>
        )}
        {data.reconciliation.unpriced_models.length > 0 && (
          <span className="filter-badge" style={{ color: "var(--danger)" }}>
            Unpriced: {data.reconciliation.unpriced_models.join(", ")}
          </span>
        )}
      </div>

      {/* ── Verdict ────────────────────────────────────────────────── */}
      <div className="tile-grid" style={{ marginTop: 20 }}>
        <StatTile
          label="Cost / student / mo"
          value={usd(result.costPerStudentMonth, 2)}
          sub={`${usd(result.costPerStudentYear, 2)} per ${scenario.schoolYearMonths}-mo year`}
        />
        <StatTile
          label="Gross margin"
          value={pct(result.marginPct)}
          tone={marginTone}
          sub={`at ${usd(cardPrice, 0)} / student / subject`}
        />
        <StatTile
          label="Fair-use headroom"
          value={result.capHeadroom === null ? "—" : `${result.capHeadroom.toFixed(1)}×`}
          tone={result.overCap ? "danger" : "ok"}
          sub={
            result.overCap
              ? `over the ${usd(scenario.fairUseCap)} cap`
              : `vs ${usd(scenario.fairUseCap)} cap`
          }
        />
        <StatTile
          label="Gross profit / yr"
          value={usd(result.grossProfit, 0)}
          sub={`on ${usd(result.revenue, 0)} revenue`}
        />
        <StatTile
          label="Year-1 net cash"
          value={usd(result.yearOneNetCash, 0)}
          sub={`incl. ${usd(scenario.onboardingFee, 0)} onboarding`}
        />
      </div>

      {(result.anyThin || result.anyUnpriced) && (
        <p className="empty-state-sub" style={{ marginTop: 12, color: "var(--warn)" }}>
          {result.anyThin && (
            <>Some unit costs rest on fewer than {data.min_sample} observations. </>
          )}
          {result.anyUnpriced && (
            <>Some functions could not be repriced and fall back to measured cost. </>
          )}
          Treat this margin as directional.
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.4fr)",
          gap: 28,
          marginTop: 24,
        }}
      >
        {/* ── Measured ────────────────────────────────────────────── */}
        <div className="table-card">
          <h3>Measured — live</h3>
          <p className="empty-state-sub" style={{ marginBottom: 12 }}>
            From {data.reconciliation.call_count.toLocaleString()} calls over{" "}
            {data.window.days.toFixed(1)} days. Not editable.
          </p>
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th className="num">Median</th>
                <th className="num">n</th>
              </tr>
            </thead>
            <tbody>
              {data.units.map((u) => (
                <tr key={u.kind} style={{ opacity: u.sufficient ? 1 : 0.55 }}>
                  <td>
                    {u.label}
                    <div className="empty-state-sub" style={{ fontSize: 11 }}>
                      {u.denominator}
                    </div>
                  </td>
                  <td className="num">
                    {u.cost_median === null ? (
                      <span style={{ color: "var(--muted)" }}>no data</span>
                    ) : (
                      usd(u.cost_median, 4)
                    )}
                  </td>
                  <td className="num">
                    {u.n}
                    {!u.sufficient && u.n > 0 && (
                      <span style={{ color: "var(--warn)" }} title="thin sample"> ⚠</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: 22 }}>Teacher : student</h3>
          <p className="empty-state-sub">
            {data.teacher_student_ratio.teachers} teachers ·{" "}
            {data.teacher_student_ratio.students} students ·{" "}
            {data.teacher_student_ratio.students_per_teacher === null
              ? "—"
              : `${data.teacher_student_ratio.students_per_teacher.toFixed(1)} students per teacher (measured)`}
          </p>
        </div>

        {/* ── Scenario ────────────────────────────────────────────── */}
        <div className="table-card">
          <h3>Scenario — yours to move</h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {([
              ["enrollment", "Enrollment"],
              ["studentsPerClass", "Students / class"],
              ["studentsPerTeacher", "Students / teacher"],
              ["subjects", "Subjects"],
            ] as const).map(([key, label]) => (
              <label key={key} style={{ display: "block" }}>
                <span className="stat-label">{label}</span>
                <input
                  id={`ue-${key}`}
                  type="number"
                  inputMode="decimal"
                  value={scenarioNums[key]}
                  onChange={(e) => setNum(key, e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            ))}
          </div>

          <h3>Per student per month</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {([
              ["homework", "Homework"],
              ["quiz", "Quiz"],
              ["test", "Test"],
              ["practice", "Practice"],
              ["unitsPerYear", "Units / yr"],
            ] as const).map(([key, label]) => (
              <label key={key} style={{ display: "block" }}>
                <span className="stat-label">{label}</span>
                <input
                  id={`ue-${key}`}
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  value={scenarioNums[key]}
                  onChange={(e) => setNum(key, e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            ))}
          </div>

          <h3>Model per feature</h3>
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Model</th>
                <th className="num">Rate in/out</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_BUCKETS.map((b) => {
                const chosen = models[b.key] ?? "";
                const m = data.model_catalog.find((x) => x.id === chosen);
                return (
                  <tr key={b.key}>
                    <td>{b.label}</td>
                    <td>
                      <select
                        id={`ue-model-${b.key}`}
                        value={chosen}
                        onChange={(e) =>
                          setModels({ ...models, [b.key]: e.target.value })
                        }
                      >
                        {data.model_catalog.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                            {opt.is_configured ? " (running)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      {m ? `$${m.input_per_mtok}/$${m.output_per_mtok}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="empty-state-sub" style={{ marginTop: 8 }}>
            Cost is half the decision. Check{" "}
            <a href="/extraction-quality">extraction quality</a> and{" "}
            <a href="/grading-quality">grading quality</a> before moving a model —
            a cheaper misread is a wrong grade in front of a teacher.
          </p>
        </div>
      </div>

      {/* ── Charts ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 24,
          marginTop: 8,
        }}
      >
        <div className="chart-card">
          <h3>Where the money goes — $ / student / month</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={featureCostData} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid stroke="var(--rule)" horizontal={false} />
              <XAxis
                type="number" stroke="var(--muted)" fontSize={11}
                tickFormatter={(v) => `$${v}`}
              />
              <YAxis
                type="category" dataKey="name" stroke="var(--muted)"
                fontSize={11} width={110}
              />
              <Tooltip formatter={(v) => usd(Number(v), 4)} />
              <Bar dataKey="cost" fill="var(--accent)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Margin by price — $ / student / subject / year</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sweep}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted)" fontSize={11} />
              <YAxis
                stroke="var(--muted)" fontSize={11}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip formatter={(v) => `${Number(v)}%`} />
              <Bar dataKey="margin">
                {sweep.map((row) => (
                  <Cell
                    key={row.name}
                    fill={
                      row.margin >= 60 ? "var(--ok)"
                        : row.margin >= 30 ? "var(--warn)"
                        : "var(--danger)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Rate card ──────────────────────────────────────────────── */}
      <div className="table-card">
        <h3>Rate card — editable</h3>
        <p className="empty-state-sub" style={{ marginBottom: 10 }}>
          $ per student per subject per year. The highlighted cell is the one this
          scenario is priced at ({TIER_LABELS[tier]}, {scenario.subjects} subject
          {scenario.subjects === 1 ? "" : "s"}).
        </p>
        <table>
          <thead>
            <tr>
              <th>Students</th>
              {[1, 2, 3, 4].map((n) => (
                <th key={n} className="num">{n === 4 ? "4+" : n} subj</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rateCard.map((row, ti) => (
              <tr key={TIER_LABELS[ti]}>
                <td>{TIER_LABELS[ti]}</td>
                {row.map((v, si) => (
                  <td key={si} className="num">
                    <input
                      id={`ue-rate-${ti}-${si}`}
                      type="number"
                      value={v}
                      onChange={(e) => setRate(ti, si, e.target.value)}
                      style={{
                        width: 62,
                        textAlign: "right",
                        background:
                          ti === tier && si === subjIdx ? "var(--accent-soft)" : undefined,
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
            marginTop: 14,
          }}
        >
          {([
            ["fairUseCap", "Fair-use cap $/stu/mo"],
            ["annualMinimum", "Annual minimum $"],
            ["onboardingFee", "Onboarding (yr 1) $"],
            ["fixedMonthly", "Fixed overhead $/mo"],
            ["schoolYearMonths", "School year (months)"],
          ] as const).map(([key, label]) => (
            <label key={key} style={{ display: "block" }}>
              <span className="stat-label">{label}</span>
              <input
                id={`ue-${key}`}
                type="number"
                inputMode="decimal"
                step={key === "fairUseCap" || key === "schoolYearMonths" ? "0.5" : "50"}
                value={scenarioNums[key]}
                onChange={(e) => setNum(key, e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
          ))}
        </div>
      </div>

      {/* ── Reconciliation detail ──────────────────────────────────── */}
      <div className="table-card">
        <h3>Recorded spend vs published rates</h3>
        <p className="empty-state-sub" style={{ marginBottom: 10 }}>
          Recorded {usd(data.reconciliation.recorded_usd)} · recomputed{" "}
          {usd(data.reconciliation.recomputed_usd)}. A gap means a model is priced
          wrong in the catalog or missing from it.
        </p>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Calls</th>
              <th className="num">Recorded</th>
              <th className="num">At published rates</th>
            </tr>
          </thead>
          <tbody>
            {data.reconciliation.by_model.map((m) => (
              <tr key={m.model}>
                <td>{m.model}</td>
                <td className="num">{m.calls.toLocaleString()}</td>
                <td className="num">{usd(m.recorded_usd, 4)}</td>
                <td className="num">
                  {m.recomputed_usd === null ? (
                    <span style={{ color: "var(--danger)" }}>unpriced</span>
                  ) : (
                    usd(m.recomputed_usd, 4)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
