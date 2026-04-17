/**
 * Color-coded due-date pill. Drives urgency color in one place so the
 * dashboard stays visually consistent without each row re-deciding.
 *
 * Tones (text + background):
 * - overdue / due in <24h  → red
 * - due in <3 days         → amber
 * - due in >3 days / null  → muted (transparent bg)
 */
export function UrgencyPill({ dueAt }: { dueAt: string | null }) {
  const { label, tone } = urgencyLabelAndTone(dueAt);
  const toneCls =
    tone === "red"
      ? "bg-error-light text-error"
      : tone === "amber"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      : "bg-transparent text-text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneCls}`}
    >
      {label}
    </span>
  );
}

function urgencyLabelAndTone(dueAt: string | null): {
  label: string;
  tone: "red" | "amber" | "muted";
} {
  if (!dueAt) return { label: "No due date", tone: "muted" };
  const due = new Date(dueAt);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const absDays = Math.round(Math.abs(diffMs) / 86400000);
  const hours = Math.round(Math.abs(diffMs) / 3600000);

  if (diffMs < 0) {
    // Overdue
    if (absDays === 0) return { label: `overdue by ${hours} hr`, tone: "red" };
    if (absDays === 1) return { label: "overdue by 1 day", tone: "red" };
    return { label: `overdue by ${absDays} days`, tone: "red" };
  }
  if (hours < 24) {
    if (hours === 0) return { label: "due now", tone: "red" };
    return { label: `due in ${hours} hr`, tone: "red" };
  }
  if (absDays === 1) return { label: "due tomorrow", tone: "amber" };
  if (absDays <= 3) return { label: `due in ${absDays} days`, tone: "amber" };
  return { label: `due in ${absDays} days`, tone: "muted" };
}
