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
  bodyTourId,
}: {
  title: string;
  /** Shown next to the title as a muted number. Hidden when undefined. */
  count?: number;
  children: React.ReactNode;
  /** Optional `data-tour-id` stamped on the card body (the list region).
   *  Lets a tour spotlight a stable container that exists even when the
   *  list is empty — unlike a per-row target, which doesn't mount. */
  bodyTourId?: string;
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
      <div data-tour-id={bodyTourId}>{children}</div>
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
  // No rose, no amber.
  //
  // This palette is identity — "which class is this" — but it used the
  // two hues that carry MEANING everywhere else in the product: rose is
  // a failing grade and an overdue pill, amber is work awaiting review.
  // With six courses hashed across six colours, a third of a student's
  // classes were badged in alarm colours at random, on the same screen
  // where a real 55% is printed in the same red. Colour cannot mean
  // "this is bad" in one row and "this is Geometry" in the next.
  //
  // What remains is six calm, distinguishable hues that no status uses,
  // so the only red on a student's dashboard is a red that means
  // something.
  const palette = [
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
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
