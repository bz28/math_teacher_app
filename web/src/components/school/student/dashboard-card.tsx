/**
 * Titled container used for each section of the student Today
 * dashboard (Due this week, Recently graded, etc). Keeps the card
 * chrome — uppercase tracking-wide title label + count, rounded
 * surface — consistent across sections.
 */
export function DashboardCard({
  title,
  count,
  children,
}: {
  title: string;
  /** Shown next to the title as a muted number. Hidden when undefined. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface">
      <header className="flex items-baseline gap-2 border-b border-border-light px-5 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </h2>
        {typeof count === "number" && (
          <span className="text-xs font-semibold text-text-muted">
            {count}
          </span>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

/**
 * Deterministic avatar color from a seed (course_id). Returns a class
 * name applied to a small square. Keeps the same color for the same
 * course across mounts so students recognize their classes at a glance.
 */
export function avatarColorClass(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const palette = [
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  ];
  return palette[h % palette.length];
}

export function CourseAvatar({ courseId, courseName }: { courseId: string; courseName: string }) {
  const letter = (courseName || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[--radius-sm] text-sm font-bold ${avatarColorClass(courseId)}`}
      aria-hidden
    >
      {letter}
    </div>
  );
}
