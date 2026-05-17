/** Status label used across teacher views (courses list, course header,
 *  per-HW rows, integrity panel). Tones express workload + classification
 *  state: amber = needs attention, red = harder failure, green = caught
 *  up, info = informational classification (e.g. AI-emitted diagnosis
 *  kind), muted = inert (dismissed / unreadable / errored). Editorial
 *  flat badge family — same grammar as the dashboard .badge: small-caps,
 *  tracked, design-token tinted, sharp 2px radius.
 *
 *  Single source of truth so all surfaces stay visually identical and
 *  any palette tweak lands in one place. */
export function StatusPill({
  tone,
  label,
  icon,
}: {
  tone: "amber" | "red" | "green" | "info" | "muted";
  label: string;
  icon?: string;
}) {
  const styles: Record<typeof tone, string> = {
    amber:
      "border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning-dark)]",
    red:
      "border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] text-[color:var(--color-error)]",
    green:
      "border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)] text-[color:var(--color-success)]",
    info:
      "border-[color:var(--color-info-border)] bg-[color:var(--color-info-light)] text-[color:var(--color-info)]",
    muted:
      "border-border-light bg-background text-text-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[2px] border px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.06em] ${styles[tone]}`}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {label}
    </span>
  );
}
