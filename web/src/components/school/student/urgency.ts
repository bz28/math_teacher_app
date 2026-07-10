/**
 * Maps an assignment due date to a human label + urgency tone. Kept pure (and
 * separate from the pill's rendering) so the arithmetic can be unit-tested and
 * so urgency color is decided in exactly one place.
 *
 * Tones:
 * - overdue / due in <24h → red
 * - due in <3 days        → amber
 * - due in >3 days / null → muted (transparent bg)
 *
 * Time is always rounded DOWN, never up: rounding up would claim more time than
 * actually remains and understate urgency exactly when it matters most. Under
 * two hours we show minutes ("due in 45 min") instead of collapsing to a whole
 * hour ("due in 1 hr") for the same reason.
 *
 * `now` is injectable so tests can pin a reference time; production omits it.
 */
export function urgencyLabelAndTone(
  dueAt: string | null,
  now: Date = new Date(),
): { label: string; tone: "red" | "amber" | "muted" } {
  if (!dueAt) return { label: "No due date", tone: "muted" };
  const diffMs = new Date(dueAt).getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const minutes = Math.floor(absMs / 60000);
  const hours = Math.floor(absMs / 3600000);
  const absDays = Math.round(absMs / 86400000);

  if (diffMs < 0) {
    // Overdue — mirror the upcoming buckets so we never render "overdue by 0 hr".
    if (absDays === 0) {
      if (minutes < 1) return { label: "overdue", tone: "red" };
      if (minutes < 120) return { label: `overdue by ${minutes} min`, tone: "red" };
      return { label: `overdue by ${hours} hr`, tone: "red" };
    }
    if (absDays === 1) return { label: "overdue by 1 day", tone: "red" };
    return { label: `overdue by ${absDays} days`, tone: "red" };
  }
  if (hours < 24) {
    if (minutes < 1) return { label: "due now", tone: "red" };
    if (minutes < 120) return { label: `due in ${minutes} min`, tone: "red" };
    return { label: `due in ${hours} hr`, tone: "red" };
  }
  if (absDays === 1) return { label: "due tomorrow", tone: "amber" };
  if (absDays <= 3) return { label: `due in ${absDays} days`, tone: "amber" };
  return { label: `due in ${absDays} days`, tone: "muted" };
}
