import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  sub?: string;
  /** When set, the card becomes a button — used as a one-tap filter
   *  toggle (e.g. the At-risk card on the Schools page). */
  onClick?: () => void;
  /** Highlights the card as the currently-selected filter. */
  active?: boolean;
}

export default function StatCard({ label, value, sub, onClick, active }: Props) {
  const content = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  );

  if (!onClick) {
    return (
      <div className={`stat-card${active ? " stat-card-active" : ""}`}>{content}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`stat-card stat-card-btn${active ? " stat-card-active" : ""}`}
    >
      {content}
    </button>
  );
}
