// The due-date chips' arithmetic, kept free of React so it runs under
// plain node --test. Dates are the browser's local time; a due date
// travels as a datetime-local string ("YYYY-MM-DDTHH:mm"), the shape the
// wizard already kept, or "" for no due date.

/** Every real homework so far was due at 11:59 PM; it stays editable. */
export const DEFAULT_DUE_TIME = "23:59";

export interface DueChoice {
  /** "YYYY-MM-DD" in local time. */
  date: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for a local Date. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return out;
}

/** The first `weekday` (0 = Sun … 6 = Sat) strictly after `after`. */
function nextWeekday(after: Date, weekday: number): Date {
  const gap = (weekday - after.getDay() + 7) % 7 || 7;
  return addDays(after, gap);
}

/** "Fri 11/27" */
export function shortDayLabel(d: Date): string {
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${day} ${d.getMonth() + 1}/${d.getDate()}`;
}

/** Tomorrow, then the first Monday and the first Friday after tomorrow:
 *  the dates a teacher sets homework for, in order. */
export function dueChoices(now: Date): DueChoice[] {
  const tomorrow = addDays(now, 1);
  const days = [tomorrow, nextWeekday(tomorrow, 1), nextWeekday(tomorrow, 5)];
  days.sort((a, b) => a.getTime() - b.getTime());
  const seen = new Set<string>();
  const out: DueChoice[] = [];
  for (const d of days) {
    const date = localDate(d);
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({
      date,
      label: d === tomorrow ? `Tomorrow · ${shortDayLabel(d)}` : shortDayLabel(d),
    });
  }
  return out;
}

/** Split a datetime-local value; "" splits to no date. */
export function splitDue(value: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return m ? { date: m[1], time: m[2] } : null;
}

export function joinDue(date: string, time: string): string {
  return `${date}T${time || DEFAULT_DUE_TIME}`;
}

/** A Date's datetime-local value ("YYYY-MM-DDTHH:mm") in local time. */
export function toLocalDueValue(d: Date): string {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
