"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type TeacherAssignment } from "@/lib/api";

// Popover that lists draft homeworks and lets the teacher pick one,
// or create a new draft inline (title-only — fields like due date and
// sections get filled in later from the homework tab; existing publish
// gating prevents half-baked homeworks from reaching students).
//
// Pure picker: doesn't perform the attach itself. Returns the chosen
// assignmentId (or a brand new title to create) via callback so the
// parent can do the approve + attach in one logical action.
export function DestinationPicker({
  courseId,
  busy = false,
  onClose,
  onPickExisting,
  onCreateNew,
}: {
  courseId: string;
  /** True while the parent is processing the pick. Disables all
   *  buttons + the form so the teacher can't double-submit during
   *  the network round-trip. */
  busy?: boolean;
  onClose: () => void;
  onPickExisting: (assignment: TeacherAssignment) => void;
  onCreateNew: (title: string) => void;
}) {
  const [drafts, setDrafts] = useState<TeacherAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .assignments(courseId)
      .then((res) => {
        if (cancelled) return;
        setDrafts(
          res.assignments.filter(
            (a) => a.type === "homework" && a.status !== "published",
          ),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load homeworks");
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // Click-outside dismiss.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const t = newTitle.trim();
    if (!t) return;
    onCreateNew(t);
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-[--radius-lg] border border-border-light bg-surface p-3 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-text-muted">
        Add to homework
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {drafts === null ? (
        <p className="mt-2 text-xs text-text-muted">Loading…</p>
      ) : drafts.length === 0 && !creating ? (
        <p className="mt-2 text-xs text-text-muted italic">No draft homeworks yet.</p>
      ) : (
        <ul className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
          {drafts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onPickExisting(a)}
                disabled={busy}
                className="block w-full rounded-[--radius-md] px-2 py-1.5 text-left text-sm text-text-primary hover:bg-bg-subtle disabled:opacity-50"
              >
                <span className="font-semibold">{a.title}</span>
                <span className="ml-2 text-[10px] uppercase tracking-wider text-text-muted">
                  draft
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="my-2 h-px bg-border-light" />

      {creating ? (
        <form onSubmit={submitNew} className="space-y-2">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            disabled={busy}
            placeholder="Homework title"
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !newTitle.trim()}
              className="flex-1 rounded-[--radius-md] bg-primary px-2 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create & add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewTitle("");
              }}
              disabled={busy}
              className="rounded-[--radius-md] border border-border-light px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-text-muted">
            Title only for now. Add sections and due date from the Homework tab when you&rsquo;re
            ready to publish.
          </p>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="block w-full rounded-[--radius-md] px-2 py-1.5 text-left text-xs font-semibold text-primary hover:bg-bg-subtle"
        >
          + New homework
        </button>
      )}
    </div>
  );
}
