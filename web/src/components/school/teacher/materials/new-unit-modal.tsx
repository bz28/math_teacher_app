"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { teacher } from "@/lib/api";

interface NewUnitModalProps {
  courseId: string;
  parentId: string | null;
  onClose: () => void;
  onCreated: () => void;
}

export function NewUnitModal({ courseId, parentId, onClose, onCreated }: NewUnitModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await teacher.createUnit(courseId, { name: name.trim(), parent_id: parentId });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create unit");
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="text-lg font-bold text-text-primary">
          {parentId ? "New Subfolder" : "New Unit"}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          {parentId
            ? "Subfolders organize files inside a unit."
            : "e.g. \u201cUnit 1: Linear Equations\u201d"}
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={200}
          placeholder={parentId ? "Subfolder name" : "Unit name"}
          className="mt-4 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
