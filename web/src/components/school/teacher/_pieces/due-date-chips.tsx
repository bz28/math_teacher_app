"use client";

import { useId, useRef, useState } from "react";
import { formatDue } from "@/lib/utils";
import { SelectableChip } from "./selectable-chip";
import {
  DEFAULT_DUE_TIME,
  dueChoices,
  joinDue,
  localDate,
  shortDayLabel,
  splitDue,
} from "./due-choices";

/**
 * Due date as chips: tomorrow, next Monday, next Friday, or any date,
 * at 11:59 PM unless the teacher changes the time. Pressing the picked
 * chip again clears it (no due date). `value` is a datetime-local string
 * ("YYYY-MM-DDTHH:mm") or "" for none.
 */
export function DueDateChips({
  value,
  onChange,
  disabled,
  noneHint,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** What having no due date means, shown when none is picked. */
  noneHint?: string;
}) {
  // One "now" per mount keeps render pure; a modal is open for minutes.
  const [now] = useState(() => new Date());
  const choices = dueChoices(now);
  const picked = splitDue(value);
  const [timeOpen, setTimeOpen] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeId = useId();

  const customPicked = picked !== null && !choices.some((c) => c.date === picked.date);
  const time = picked?.time ?? DEFAULT_DUE_TIME;
  const pick = (date: string) =>
    onChange(picked?.date === date ? "" : joinDue(date, time));

  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker is the only way to open a hidden date input; older
    // browsers fall back to focusing it.
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // Not allowed here (e.g. not a user gesture): fall through.
      }
    }
    el.focus();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {choices.map((c) => (
          <SelectableChip
            key={c.date}
            label={c.label}
            selected={picked?.date === c.date}
            onToggle={() => pick(c.date)}
            disabled={disabled}
          />
        ))}
        <span className="relative inline-flex">
          <SelectableChip
            label={
              customPicked
                ? shortDayLabel(new Date(`${picked.date}T00:00`))
                : "Pick a date…"
            }
            selected={customPicked}
            onToggle={openDatePicker}
            disabled={disabled}
          />
          <input
            ref={dateInputRef}
            type="date"
            aria-label="Due date"
            tabIndex={-1}
            value={picked?.date ?? ""}
            min={localDate(now)}
            onChange={(e) => {
              if (e.target.value) onChange(joinDue(e.target.value, time));
            }}
            disabled={disabled}
            className="pointer-events-none absolute inset-0 opacity-0"
          />
        </span>
      </div>
      <p className="mt-1.5 text-xs text-text-muted">
        {picked ? (
          <>
            {formatDue(new Date(value).toISOString())} · AI grading starts then ·{" "}
            {timeOpen ? (
              <>
                <label htmlFor={timeId} className="sr-only">
                  Due time
                </label>
                <input
                  id={timeId}
                  type="time"
                  value={time}
                  onChange={(e) => {
                    if (e.target.value) onChange(joinDue(picked.date, e.target.value));
                  }}
                  disabled={disabled}
                  className="rounded-[--radius-sm] border border-border-light bg-bg-base px-1.5 py-0.5 text-xs text-text-primary focus:border-primary focus:outline-none"
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setTimeOpen(true)}
                disabled={disabled}
                className="font-semibold text-text-secondary underline underline-offset-2 hover:text-primary"
              >
                change time
              </button>
            )}
          </>
        ) : (
          (noneHint ?? "No due date.")
        )}
      </p>
    </div>
  );
}
