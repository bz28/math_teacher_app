import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  sub?: string;
}

export default function StatCard({ label, value, sub }: Props) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
