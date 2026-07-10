import { urgencyLabelAndTone } from "./urgency";

/**
 * Color-coded due-date pill. Renders the label/tone decided by
 * `urgencyLabelAndTone` so the dashboard stays visually consistent without each
 * row re-deciding urgency.
 */
export function UrgencyPill({ dueAt }: { dueAt: string | null }) {
  const { label, tone } = urgencyLabelAndTone(dueAt);
  const toneCls =
    tone === "red"
      ? "bg-error-light text-error"
      : tone === "amber"
      ? "bg-warning-bg text-warning-dark"
      : "bg-transparent text-text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneCls}`}
    >
      {label}
    </span>
  );
}
