"use client";

import { useState } from "react";
import { teacher } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { BankPicker } from "./bank-picker";
import { UnitMultiSelect } from "./unit-multi-select";

/**
 * Modal for creating a new (draft) homework — title + units + bank
 * picker. Every HW must belong to ≥1 unit so the question bank can
 * group everything by unit.
 */
export function NewHomeworkModal({
  courseId,
  defaultUnitIds = [],
  onClose,
  onCreated,
}: {
  courseId: string;
  /** Pre-select these units (e.g. the unit currently filtered in the
   *  question bank rail). Teacher can change the selection. */
  defaultUnitIds?: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>(defaultUnitIds);
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, error, setError, run } = useAsyncAction();

  const submit = () =>
    run(async () => {
      const t = title.trim();
      if (!t) {
        setError("Title is required");
        return;
      }
      if (unitIds.length === 0) {
        setError("Pick at least one unit");
        return;
      }
      if (picked.length === 0) {
        setError("Pick at least one question");
        return;
      }
      await teacher.createAssignment(courseId, {
        title: t,
        type: "homework",
        unit_ids: unitIds,
        bank_item_ids: picked,
      });
      onCreated();
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">New Homework</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Title */}
          <label className="block text-sm font-bold text-text-primary">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            maxLength={300}
            placeholder="e.g. Quadratics HW #1"
            className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />

          {/* Units */}
          <div className="mt-5">
            <label className="block text-sm font-bold text-text-primary">
              Units <span className="font-normal text-text-muted">· required</span>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Pick one. Multi-select for midterms or review HWs that span topics.
            </p>
            <div className="mt-2">
              <UnitMultiSelect
                courseId={courseId}
                selected={unitIds}
                onChange={setUnitIds}
                disabled={busy}
              />
            </div>
          </div>

          {/* Bank picker */}
          <div className="mt-6">
            <label className="block text-sm font-bold text-text-primary">
              Pick problems from your bank
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Only approved questions show up here. Pending and rejected questions
              are filtered out. Pick from any unit — homework can mix units.
            </p>
            <BankPicker
              courseId={courseId}
              picked={picked}
              onChange={setPicked}
            />
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-light px-6 py-3">
          <span className="text-xs text-text-muted">
            {picked.length} {picked.length === 1 ? "problem" : "problems"} selected
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save homework"}
          </button>
        </div>
      </div>
    </div>
  );
}
