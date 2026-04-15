"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type TeacherAssignment } from "@/lib/api";
import { UnitMultiSelect } from "../_pieces/unit-multi-select";

// Popover that lists draft homeworks and lets the teacher pick one,
// or create a new draft inline (title + units; the rest of the HW
// config — sections, due date, late policy — gets filled in later
// from the homework tab; existing publish gating prevents half-baked
// homeworks from reaching students).
//
// Pure picker: doesn't perform the attach itself. Returns the chosen
// assignmentId (or a brand new title + unit_ids) via callback so the
// parent can do the approve + attach in one logical action.
export function DestinationPicker({
  courseId,
  defaultUnitIds = [],
  busy = false,
  align = "start",
  onClose,
  onPickExisting,
  onCreateNew,
}: {
  courseId: string;
  /** Pre-select these units when the inline create form opens. The
   *  question bank shell passes the currently-filtered unit so a
   *  one-click create lands in the right place. */
  defaultUnitIds?: string[];
  /** True while the parent is processing the pick. Disables all
   *  buttons + the form so the teacher can't double-submit during
   *  the network round-trip. */
  busy?: boolean;
  /** Horizontal anchor relative to the trigger. "start" anchors the
   *  popover's left edge to the trigger (default — works for left-aligned
   *  triggers). "end" anchors the right edge — needed
   *  when the trigger sits on the right of its container (e.g. workshop's
   *  ml-auto Add-to-Homework button) so the popover doesn't overflow off
   *  the right edge of the modal. */
  align?: "start" | "end";
  onClose: () => void;
  onPickExisting: (assignment: TeacherAssignment) => void;
  onCreateNew: (title: string, unitIds: string[]) => void;
}) {
  const [drafts, setDrafts] = useState<TeacherAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newUnitIds, setNewUnitIds] = useState<string[]>(defaultUnitIds);
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
    if (!t || newUnitIds.length === 0) return;
    onCreateNew(t, newUnitIds);
  };

  return (
    <div
      ref={ref}
      className={`absolute bottom-full z-30 mb-2 rounded-[--radius-lg] border border-border-light bg-surface p-3 shadow-xl ${
        align === "end" ? "right-0" : "left-0"
      } ${creating ? "w-80" : "w-72"}`}
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
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Unit · required
            </div>
            <UnitMultiSelect
              courseId={courseId}
              selected={newUnitIds}
              onChange={setNewUnitIds}
              disabled={busy}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !newTitle.trim() || newUnitIds.length === 0}
              className="flex-1 rounded-[--radius-md] bg-primary px-2 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create & add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewTitle("");
                setNewUnitIds(defaultUnitIds);
              }}
              disabled={busy}
              className="rounded-[--radius-md] border border-border-light px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-text-muted">
            Sections and due date can be added from the Homework tab when you&rsquo;re ready to
            publish.
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
