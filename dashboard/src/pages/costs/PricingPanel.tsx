import { DEFAULT_RATE_CARD, TIER_LABELS, subjectIndex, tierFor, type NumKey } from "./marginScenario";
import NumberField from "./NumberField";
import { usd } from "./spendFormat";

/**
 * Pricing — the rate card and the deal terms. All assumptions; the owner's
 * v1 spreadsheet figures, editable so a rate-card change needs no deploy.
 * $ per student per subject per year, tiered by enrollment.
 */

const TERMS: { key: NumKey; label: string; step: number }[] = [
  { key: "enrollment", label: "Enrollment", step: 1 },
  { key: "subjects", label: "Subjects", step: 1 },
  { key: "annualMinimum", label: "Annual minimum $", step: 50 },
  { key: "onboardingFee", label: "Onboarding (yr 1) $", step: 50 },
  { key: "fixedMonthly", label: "Fixed overhead $/mo", step: 50 },
  { key: "fairUseCap", label: "Fair-use cap $/stu/mo", step: 0.5 },
  { key: "schoolYearMonths", label: "School year (months)", step: 0.5 },
];

interface Props {
  rateCard: number[][];
  nums: Record<NumKey, number>;
  onRates: (next: number[][] | null) => void;
  onNum: (k: NumKey, v: string) => void;
  grossProfit: number;
  revenue: number;
  yearOneNetCash: number;
}

export default function PricingPanel({
  rateCard, nums, onRates, onNum, grossProfit, revenue, yearOneNetCash,
}: Props) {
  const tier = tierFor(nums.enrollment);
  const subj = subjectIndex(nums.subjects);

  const setRate = (ti: number, si: number, v: string) => {
    const next = rateCard.map((row) => [...row]);
    next[ti][si] = Math.max(Number(v), 0);
    onRates(JSON.stringify(next) === JSON.stringify(DEFAULT_RATE_CARD) ? null : next);
  };

  return (
    <section className="costs-section costs-pricing">
      <div className="costs-section-head"><h3>Pricing · assumptions</h3></div>
      <p className="costs-foot">
        Gross profit {usd(grossProfit, 0)} a year on {usd(revenue, 0)} revenue · year-1 net cash{" "}
        {usd(yearOneNetCash, 0)} after onboarding and overhead.
      </p>
      <div className="costs-pricing-grid">
        <table className="costs-table costs-ratecard">
          <caption>$ per student per subject per year · the highlighted cell prices this scenario</caption>
          <thead>
            <tr>
              <th>Students</th>
              {[1, 2, 3, 4].map((n) => <th key={n} className="num">{n === 4 ? "4+" : n} subj</th>)}
            </tr>
          </thead>
          <tbody>
            {rateCard.map((row, ti) => (
              <tr key={TIER_LABELS[ti]}>
                <td>{TIER_LABELS[ti]}</td>
                {row.map((v, si) => (
                  <td key={si} className="num">
                    <NumberField
                      aria-label={`${TIER_LABELS[ti]} students, ${si + 1} subject${si ? "s" : ""}`}
                      className={ti === tier && si === subj ? "on" : ""}
                      min={0}
                      value={v}
                      onCommit={(x) => setRate(ti, si, x)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="costs-terms">
          {TERMS.map((t) => (
            <label key={t.key}>
              <span className="costs-caption">{t.label}</span>
              <NumberField
                inputMode="decimal" min={t.key === "subjects" ? 1 : 0} step={t.step}
                value={nums[t.key]}
                onCommit={(v) => onNum(t.key, v)}
              />
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
