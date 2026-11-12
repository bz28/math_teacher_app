/**
 * Picking a personal due date when a teacher reopens a homework for one
 * student. The API takes an ISO date with a time zone and refuses one in
 * the past or before the class due date; these keep the picker inside
 * those rules so she never meets the refusal.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** A `<input type="datetime-local">` value, in the browser's time zone. */
export function toLocalInputValue(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** The earliest date she may pick: now, or the class due date if later. */
export function reopenMinimum(now: Date, classDue: Date | null): Date {
  return classDue && classDue > now ? classDue : now;
}

/** Where the picker starts: two days past the earliest allowed date, at
 *  11:59 PM — an evening deadline, like most homework. */
export function defaultReopenDue(now: Date, classDue: Date | null): Date {
  const d = new Date(reopenMinimum(now, classDue));
  d.setDate(d.getDate() + 2);
  d.setHours(23, 59, 0, 0);
  return d;
}

/** Why `value` (a datetime-local string) can't be the personal date, or
 *  null when it can. Mirrors the API's checks. */
export function reopenDateProblem(value: string, now: Date, classDue: Date | null): string | null {
  if (!value) return "Pick a date and time.";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Pick a date and time.";
  if (d <= now) return "Pick a time in the future.";
  if (classDue && d < classDue) return "Pick a date on or after the class due date.";
  return null;
}
