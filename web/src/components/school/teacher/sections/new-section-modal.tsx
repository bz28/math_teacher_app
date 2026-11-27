"use client";

import { useState } from "react";
import { teacher } from "@/lib/api";
import { sectionNames } from "./section-names";

/** New section: one name, or several at once ("Period 1, Period 3").
 *  Each is created in turn; if one fails, those already made stay made
 *  (onAdded), and the field keeps only the names still to create. */

export function NewSectionModal({
  courseId,
  onClose,
  onCreated,
  onAdded,
}: {
  courseId: string;
  onClose: () => void;
  /** Every name was created; the modal is done. */
  onCreated: () => void;
  /** Some were created before one failed; the modal stays open. */
  onAdded?: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = sectionNames(name);

  const submit = async () => {
    if (names.length === 0) {
      setError("Name is required");
      return;
    }
    const long = names.find((n) => n.length > 100);
    if (long) {
      setError(`\u201c${long.slice(0, 24)}\u2026\u201d is too long: 100 characters at most`);
      return;
    }
    setSubmitting(true);
    setError(null);
    for (const [i, n] of names.entries()) {
      try {
        await teacher.createSection(courseId, n);
      } catch (e) {
        const why = e instanceof Error ? e.message : "Failed to create section";
        setName(names.slice(i).join(", "));
        setError(i === 0 ? why : `Created ${names.slice(0, i).join(", ")}. Couldn\u2019t create ${n}: ${why}`);
        setSubmitting(false);
        if (i > 0) onAdded?.();
        return;
      }
    }
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-sm rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="font-serif text-[22px] leading-tight tracking-[-0.01em] text-text-primary">New section</h2>
        <p className="mt-1 font-serif italic text-[14px] text-text-muted">
          One per class period. Add several at once: &ldquo;Period 1, Period 3&rdquo;
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          aria-label="Section names"
          placeholder="Period 1, Period 3"
          className="mt-4 w-full rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-[color:var(--color-error)]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting
              ? "Creating…"
              : names.length > 1
                ? `Create ${names.length} sections`
                : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
