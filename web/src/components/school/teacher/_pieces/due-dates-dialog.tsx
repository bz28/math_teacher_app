"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { teacher } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { DueDateChips } from "./due-date-chips";
import { toLocalDueValue } from "./due-choices";
import { changeNote, datesDiffer, dueDatesBody, type SectionDate } from "./due-dates";

const local = (iso: string | null) => (iso ? toLocalDueValue(new Date(iso)) : "");

type Preview =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ready"; note: string }
  | { state: "error" };

/**
 * Change a homework's due date, draft or published: one date for every
 * section, or a date per section. Before she saves, a dry run says what
 * the change does to work already turned in: how many turn-ins change
 * lateness, and how many published grades will show as changed until she
 * republishes. Nothing a student sees changes until she does.
 */
export function DueDatesDialog({
  assignmentId,
  title,
  dueAt,
  sections,
  onSaved,
  onClose,
}: {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  sections: SectionDate[];
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { busy, error, run } = useAsyncAction();
  const canSplit = sections.length > 1;
  const [mode, setMode] = useState<"same" | "per-section">(
    canSplit && datesDiffer(sections) ? "per-section" : "same",
  );
  const [same, setSame] = useState(() => local(dueAt));
  const [perSection, setPerSection] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((s) => [s.section_id, local(s.due_at ?? dueAt)])),
  );
  // The last dry run's answer, keyed by the request it answered.
  const [checked, setChecked] = useState<{ key: string; note: string | null } | null>(null);
  const titleId = useId();

  const saved = useMemo(
    () => Object.fromEntries(sections.map((s) => [s.section_id, s.due_at ?? dueAt])),
    [sections, dueAt],
  );
  const body = useMemo(
    () => dueDatesBody(mode, same, perSection, saved),
    [mode, same, perSection, saved],
  );
  const unchanged = useMemo(() => {
    if (mode === "same") return same === local(dueAt) && !datesDiffer(sections);
    return sections.every((s) => perSection[s.section_id] === local(s.due_at ?? dueAt));
  }, [mode, same, perSection, dueAt, sections]);

  // What saving would do to work already in, once the picks settle.
  const key = body && !unchanged ? JSON.stringify(body) : null;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const t = setTimeout(() => {
      teacher
        .setDueDates(assignmentId, { ...JSON.parse(key), dry_run: true })
        .then((r) => !cancelled && setChecked({ key, note: changeNote(r) }))
        .catch(() => !cancelled && setChecked({ key, note: null }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assignmentId, key]);
  const preview: Preview = !key
    ? { state: "idle" }
    : checked?.key !== key
      ? { state: "checking" }
      : checked.note === null
        ? { state: "error" }
        : { state: "ready", note: checked.note };

  const onSave = () =>
    run(async () => {
      if (!body) return;
      await teacher.setDueDates(assignmentId, body);
      await onSaved();
      onClose();
    }, "Couldn’t change the due date");

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      labelledById={titleId}
      className="max-w-xl p-0"
    >
      <div className="border-b border-border-light px-6 py-4">
        <h2 id={titleId} className="font-serif text-xl leading-tight text-text-primary">
          Due date
        </h2>
        <p className="mt-0.5 truncate text-sm text-text-muted">{title}</p>
      </div>

      <div className="space-y-5 px-6 py-5">
        {canSplit && (
          <div
            role="radiogroup"
            aria-label="Due date for"
            className="inline-flex rounded-[--radius-pill] border border-border-light bg-bg-subtle p-0.5"
          >
            {(
              [
                ["same", "Every section"],
                ["per-section", "Different per section"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                disabled={busy}
                className={`rounded-[--radius-pill] px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === value
                    ? "bg-surface text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "same" ? (
          <DueDateChips
            value={same}
            onChange={setSame}
            disabled={busy}
            noneHint="No due date: nothing is late and it never closes."
          />
        ) : (
          <ul className="divide-y divide-border-light rounded-[--radius-md] border border-border-light">
            {sections.map((s) => {
              const inputId = `due-${s.section_id}`;
              return (
                <li key={s.section_id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <label htmlFor={inputId} className="text-sm font-semibold text-text-primary">
                    {s.name}
                  </label>
                  <input
                    id={inputId}
                    type="datetime-local"
                    value={perSection[s.section_id] ?? ""}
                    onChange={(e) =>
                      setPerSection((p) => ({ ...p, [s.section_id]: e.target.value }))
                    }
                    disabled={busy}
                    className="rounded-[--radius-md] border border-border-light bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                </li>
              );
            })}
          </ul>
        )}

        <p
          aria-live="polite"
          className={`rounded-[--radius-md] px-4 py-3 text-sm ${
            preview.state === "ready" && !preview.note.startsWith("No ")
              ? "bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning-dark)]"
              : "bg-bg-subtle text-text-secondary"
          }`}
        >
          {preview.state === "checking"
            ? "Checking work already turned in…"
            : preview.state === "ready"
              ? preview.note
              : preview.state === "error"
                ? "Couldn’t check work already turned in. Saving still re-checks it."
                : mode === "per-section" && !body
                  ? "Give every section a date."
                  : "Lateness and late penalties follow each student’s section date."}
        </p>
        {error && (
          <p role="alert" className="text-sm font-semibold text-[color:var(--color-error)]">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3.5">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !body || unchanged}
          className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save due date"}
        </button>
      </div>
    </Modal>
  );
}
