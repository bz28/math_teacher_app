import { Link } from "react-router-dom";
import { setSchoolScope } from "../lib/useSelectedSchool";

/**
 * A school's spend in one line, pointing at where spend lives: the Costs
 * page, scoped to this school. The school page used to carry its own
 * month tiles, per-seat costs and trend; Costs shows all of that (and by
 * teacher, function and model), so keeping a second copy here only let the
 * two drift.
 */

interface Props {
  schoolId: string;
  thisMonth: number;
  projected: number;
  low: number;
  high: number;
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SchoolCostLine({ schoolId, thisMonth, projected, low, high }: Props) {
  const range = high > low ? ` (${usd(low)}–${usd(high)})` : "";
  return (
    <p style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 20px", margin: 0, fontSize: 14, color: "var(--ink-soft)" }}>
      <span>
        This month <strong style={{ fontFamily: "var(--font-mono)", fontWeight: 500, color: "var(--ink)" }}>{usd(thisMonth)}</strong>
      </span>
      <span>
        projected month-end{" "}
        <strong style={{ fontFamily: "var(--font-mono)", fontWeight: 500, color: "var(--ink)" }}>{usd(projected)}</strong>
        <span style={{ color: "var(--muted)" }}>{range}</span>
      </span>
      <Link to="/costs" className="link-btn" style={{ fontSize: 13 }} onClick={() => setSchoolScope(schoolId)}>
        Spend by teacher, function and model on Costs →
      </Link>
    </p>
  );
}
