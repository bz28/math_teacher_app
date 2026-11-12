"use client";

import { useId, useState } from "react";
import { teacher, type StudentReopen } from "@/lib/api";
import { defaultReopenDue, reopenDateProblem, reopenMinimum, toLocalInputValue } from "@/lib/reopen";

const WHEN: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/**
 * Reopen this homework for one student: a personal due date that
 * replaces the class date for them. A student who hasn't turned it in can
 * until then; one who has may turn it in once more, their grade standing
 * until they do.
 *
 * Three states, all on one line until she acts: an offer ("Reopen for
 * Sam"), the picker, and — once a personal date is set — what's in force,
 * with Change / Undo. The date is picked in her own time zone and sent
 * with it.
 */
export function ReopenControl({
  assignmentId,
  studentId,
  studentName,
  submitted,
  classDueAt,
  personalDueAt,
  reopenedAt,
  onChanged,
}: {
  assignmentId: string;
  studentId: string;
  studentName: string;
  /** They have a turn-in on this homework. */
  submitted: boolean;
  classDueAt: string | null;
  /** Their personal date, when one is set. */
  personalDueAt: string | null;
  /** Set while a reopen still owes them one more turn-in. */
  reopenedAt: string | null;
  onChanged: (result: StudentReopen) => void;
}) {
  const first = studentName.split(" ")[0] || studentName;
  const classDue = classDueAt ? new Date(classDueAt) : null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  const open = () => {
    const now = new Date();
    const current = personalDueAt ? new Date(personalDueAt) : null;
    setValue(toLocalInputValue(current && current > now ? current : defaultReopenDue(now, classDue)));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const problem = reopenDateProblem(value, new Date(), classDue);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChanged(await teacher.reopenForStudent(assignmentId, studentId, new Date(value).toISOString()));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reopen it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await teacher.cancelReopenForStudent(assignmentId, studentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't undo it. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const linkButton =
    "rounded-[--radius-sm] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

  if (editing) {
    return (
      <div className="mt-2 rounded-[--radius-md] border border-primary/25 bg-primary-bg/40 p-3">
        <label htmlFor={inputId} className="block text-xs font-semibold text-text-primary">
          Reopen for {first} until
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            id={inputId}
            type="datetime-local"
            value={value}
            min={toLocalInputValue(reopenMinimum(new Date(), classDue))}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={hintId}
            aria-invalid={error ? true : undefined}
            className="rounded-[--radius-md] border border-border-light bg-surface px-2.5 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Reopening…" : personalDueAt ? "Save date" : "Reopen"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            className="rounded-[--radius-md] px-2 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
        <p id={hintId} className="mt-2 text-[11px] leading-relaxed text-text-secondary">
          {submitted
            ? `${first} can turn it in once more by then. Their grade stands until they do — then the new work is read and graded for you to approve, and this turn-in is kept.`
            : `${first} can turn it in until then, and it counts as on time.`}{" "}
          Only {first}&rsquo;s due date changes.
        </p>
        {error && (
          <p role="alert" className="mt-1.5 text-[11px] font-semibold text-[color:var(--color-error)]">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (personalDueAt) {
    return (
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1 font-semibold text-primary">
          <span aria-hidden>↺</span>
          Reopened · due {new Date(personalDueAt).toLocaleString(undefined, WHEN)}
        </span>
        {reopenedAt ? (
          <span className="text-text-muted">can turn it in once more · the grade stands until then</span>
        ) : !submitted ? (
          <span className="text-text-muted">not turned in yet</span>
        ) : null}
        <button type="button" onClick={open} disabled={busy} className={linkButton}>
          Change date
        </button>
        <button type="button" onClick={() => void undo()} disabled={busy} className={linkButton}>
          {busy ? "Undoing…" : "Undo reopen"}
        </button>
        {error && (
          <span role="alert" className="font-semibold text-[color:var(--color-error)]">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 text-[11px]">
      <button type="button" onClick={open} className={linkButton}>
        Reopen for {first}…
      </button>
    </div>
  );
}
