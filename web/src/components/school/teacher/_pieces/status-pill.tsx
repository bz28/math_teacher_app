/** Compact status pill used across teacher views (courses dashboard,
 *  course header, eventually per-HW rows). Three tones are enough for
 *  the workload semantics we surface: amber = needs attention,
 *  red = harder failure, green = caught up.
 *
 *  Single source of truth so all surfaces stay visually identical and
 *  any palette tweak lands in one place. */
export function StatusPill({
  tone,
  label,
  icon,
}: {
  tone: "amber" | "red" | "green";
  label: string;
  icon?: string;
}) {
  const styles: Record<typeof tone, string> = {
    amber:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    red:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
    green:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[--radius-pill] border px-2 py-0.5 text-[11px] font-semibold ${styles[tone]}`}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {label}
    </span>
  );
}
