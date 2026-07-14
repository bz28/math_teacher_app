import type { ReactNode } from "react";

/**
 * StatTile — the canonical headline metric. Hairline-separated (no card
 * chrome), mono tabular big number, mono-uppercase label, an optional
 * period-over-period delta and a tiny sparkline.
 *
 * Elevates the older StatCard: same warm-paper grid slot, but with a
 * first-class delta (arrow + tone) and sparkline so a tile can carry a
 * trend on its own. Drop several into a `.tile-grid`.
 */

export interface StatDelta {
  /** Signed percent change vs the prior comparable window. */
  pct: number;
  /** Which direction is *good*. Cost → "down"; usage/active → "up".
   *  Drives the color (moss when good, sienna when bad). Default "up". */
  goodWhen?: "up" | "down";
  /** Optional label appended after the delta, e.g. "vs prev 30d". */
  note?: string;
}

export type TileTone = "default" | "ok" | "warn" | "danger";

interface Props {
  label: string;
  value: ReactNode;
  /** Small caption under the value — units, window, breakdown. */
  sub?: ReactNode;
  delta?: StatDelta;
  /** Tints the big number (e.g. danger for a bad error rate). */
  tone?: TileTone;
  /** Sparkline series (chronological). Rendered as a hairline area. */
  spark?: number[];
  onClick?: () => void;
  active?: boolean;
}

const TONE_COLOR: Record<TileTone, string> = {
  default: "var(--ink)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

function Delta({ pct, goodWhen = "up", note }: StatDelta) {
  const rounded = Math.round(Math.abs(pct));
  if (rounded === 0) {
    return (
      <span className="stat-tile-delta stat-tile-delta-flat">
        <span aria-hidden="true">→</span> 0%{note ? ` ${note}` : ""}
      </span>
    );
  }
  const up = pct > 0;
  const good = (up && goodWhen === "up") || (!up && goodWhen === "down");
  return (
    <span className={`stat-tile-delta ${good ? "stat-tile-delta-good" : "stat-tile-delta-bad"}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span> {rounded}%{note ? ` ${note}` : ""}
    </span>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 96;
  const h = 26;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / span) * (h - 2) - 1;
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pts[0][0]},${h} ${line} ${pts[pts.length - 1][0]},${h}`;
  return (
    <svg className="stat-tile-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={area} fill="var(--accent-soft)" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={1.25} />
    </svg>
  );
}

export default function StatTile({
  label, value, sub, delta, tone = "default", spark, onClick, active,
}: Props) {
  const body = (
    <>
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value" style={{ color: TONE_COLOR[tone] }}>{value}</div>
      <div className="stat-tile-foot">
        {delta && <Delta {...delta} />}
        {sub && <div className="stat-tile-sub">{sub}</div>}
      </div>
      {spark && spark.length >= 2 && <Sparkline data={spark} />}
    </>
  );

  if (!onClick) return <div className={`stat-tile${active ? " stat-tile-active" : ""}`}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`stat-tile stat-tile-btn${active ? " stat-tile-active" : ""}`}
    >
      {body}
    </button>
  );
}
