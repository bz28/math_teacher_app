// The due-dates dialog's logic, kept apart from React so it's testable:
// what to send for what the teacher picked, what to tell her about work
// already in, and how the homework page sums up per-section dates.

export interface SectionDate {
  section_id: string;
  name: string;
  /** ISO with a time zone, or null when the homework has no due date. */
  due_at: string | null;
}

export interface DueDatesBody {
  due_at?: string;
  clear_due_at?: boolean;
  section_due_dates?: Record<string, string>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → the datetime-local value a picker shows for it. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** datetime-local value ("YYYY-MM-DDTHH:mm", the browser's zone) → ISO. */
function toIso(local: string): string | null {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The request for what she picked. One date: every section takes it
 * ("" clears the homework's date). Per section: each section's date, and
 * the homework's own date becomes the earliest of them, so lists that
 * show one date show the first one due. Null while a per-section date is
 * missing or invalid: there's nothing valid to send yet.
 */
export function dueDatesBody(
  mode: "same" | "per-section",
  same: string,
  perSection: Record<string, string>,
  /** Each section's date as saved (ISO). A section she didn't touch keeps
   *  it exactly, rather than its minute-precision picker value. */
  saved: Record<string, string | null> = {},
): DueDatesBody | null {
  if (mode === "same") {
    if (!same) return { clear_due_at: true };
    const iso = toIso(same);
    return iso ? { due_at: iso } : null;
  }
  const entries = Object.entries(perSection);
  if (entries.length === 0) return null;
  const dates: Record<string, string> = {};
  for (const [id, local] of entries) {
    const was = saved[id];
    const iso = was && local === toLocalInput(was) ? was : local ? toIso(local) : null;
    if (!iso) return null;
    dates[id] = iso;
  }
  const earliest = Object.values(dates).reduce((a, b) =>
    new Date(a).getTime() <= new Date(b).getTime() ? a : b,
  );
  return { due_at: earliest, section_due_dates: dates };
}

/** True when the sections don't all share one date. */
export function datesDiffer(sections: SectionDate[]): boolean {
  const times = new Set(sections.map((s) => (s.due_at ? new Date(s.due_at).getTime() : null)));
  return times.size > 1;
}

/** What saving does to work already turned in, from a dry run. */
export function changeNote(p: { lateness_changed: number; published_grades_changed: number }): string {
  const n = p.lateness_changed;
  const m = p.published_grades_changed;
  if (n === 0 && m === 0) return "No work already turned in changes.";
  const parts: string[] = [];
  if (n > 0) {
    parts.push(`${n} turned-in submission${n === 1 ? "" : "s"} ${n === 1 ? "changes" : "change"} lateness`);
  }
  if (m > 0) {
    parts.push(
      `${m} published grade${m === 1 ? "" : "s"} will show as changed until you republish`,
    );
  }
  return parts.join(" · ") + ".";
}
