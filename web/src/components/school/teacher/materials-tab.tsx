"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherDocument, type TeacherUnit } from "@/lib/api";
import { MATERIAL_UPLOAD_MAX_BYTES } from "@/lib/constants";
import { subfoldersOf, topUnits } from "@/lib/units";
import { EmptyState } from "@/components/school/shared/empty-state";
import { useAsyncAction } from "@/components/school/shared/use-async-action";

export function MaterialsTab({ courseId, onChanged }: { courseId: string; onChanged: () => void }) {
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null); // unit id, or null for "Uncategorized"
  const [showNewUnit, setShowNewUnit] = useState<{ parentId: string | null } | null>(null);
  const [renamingUnitId, setRenamingUnitId] = useState<string | null>(null);
  const [confirmingDeleteUnit, setConfirmingDeleteUnit] = useState<string | null>(null);
  const [movingDocId, setMovingDocId] = useState<string | null>(null);
  const [confirmingDeleteDoc, setConfirmingDeleteDoc] = useState<string | null>(null);
  const { busy, error, setError, run } = useAsyncAction();

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, d] = await Promise.all([teacher.units(courseId), teacher.documents(courseId)]);
      setUnits(u.units);
      setDocs(d.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load materials");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const tops = topUnits(units);
  const docsIn = (unitId: string | null) => docs.filter((d) => d.unit_id === unitId);

  const selectedUnit = selected ? units.find((u) => u.id === selected) ?? null : null;
  const selectedDocs = docsIn(selected);

  const handleUpload = (files: FileList | null) =>
    run(async () => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        if (file.size > MATERIAL_UPLOAD_MAX_BYTES) {
          throw new Error(`${file.name} exceeds 25MB`);
        }
        const base64 = await fileToBase64(file);
        await teacher.uploadDocument(courseId, {
          image_base64: base64,
          filename: file.name,
          unit_id: selected,
        });
      }
      await reload();
      onChanged();
    });

  const deleteUnit = (unitId: string) =>
    run(async () => {
      await teacher.deleteUnit(courseId, unitId);
      if (selected === unitId) setSelected(null);
      setConfirmingDeleteUnit(null);
      await reload();
      onChanged();
    });

  const renameUnit = (unit: TeacherUnit, nextName: string) =>
    run(async () => {
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === unit.name) {
        setRenamingUnitId(null);
        return;
      }
      await teacher.updateUnit(courseId, unit.id, { name: trimmed });
      setRenamingUnitId(null);
      await reload();
    });

  // Build a flat label list of every folder destination, used by the move popover
  const destinations = (() => {
    const out: { id: string | null; label: string }[] = [{ id: null, label: "Uncategorized" }];
    for (const top of tops) {
      out.push({ id: top.id, label: top.name });
      for (const sub of subfoldersOf(units, top.id)) {
        out.push({ id: sub.id, label: `${top.name} / ${sub.name}` });
      }
    }
    return out;
  })();

  const moveDocument = (doc: TeacherDocument, targetUnitId: string | null) =>
    run(async () => {
      await teacher.updateDocument(courseId, doc.id, { unit_id: targetUnitId });
      setMovingDocId(null);
      await reload();
      onChanged();
    });

  const deleteDocument = (docId: string) =>
    run(async () => {
      await teacher.deleteDocument(courseId, docId);
      setConfirmingDeleteDoc(null);
      await reload();
      onChanged();
    });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Materials</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewUnit({ parentId: null })}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            + New Unit
          </button>
          <label className="cursor-pointer rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark">
            + Upload Files
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => handleUpload(e.target.files)}
              className="hidden"
              disabled={busy}
            />
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">Loading…</p>
      ) : units.length === 0 && docs.length === 0 ? (
        <EmptyState text="No materials yet. Create a unit or upload files to get started." />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Left: folder tree */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className={`w-full rounded-[--radius-sm] px-2 py-1.5 text-left text-sm transition-colors ${
                selected === null
                  ? "bg-primary-bg font-semibold text-primary"
                  : "text-text-secondary hover:bg-bg-subtle"
              }`}
            >
              📥 Uncategorized
              <span className="ml-1 text-xs text-text-muted">({docsIn(null).length})</span>
            </button>

            <div className="my-2 h-px bg-border-light" />

            {tops.length === 0 && (
              <p className="px-2 py-1 text-xs text-text-muted">No units yet.</p>
            )}
            <ul className="space-y-0.5">
              {tops.map((u) => (
                <li key={u.id}>
                  <FolderRow
                    unit={u}
                    selected={selected === u.id}
                    docCount={docsIn(u.id).length}
                    isRenaming={renamingUnitId === u.id}
                    isConfirmingDelete={confirmingDeleteUnit === u.id}
                    busy={busy}
                    onSelect={() => setSelected(u.id)}
                    onStartRename={() => setRenamingUnitId(u.id)}
                    onSubmitRename={(name) => renameUnit(u, name)}
                    onCancelRename={() => setRenamingUnitId(null)}
                    onStartDelete={() => setConfirmingDeleteUnit(u.id)}
                    onConfirmDelete={() => deleteUnit(u.id)}
                    onCancelDelete={() => setConfirmingDeleteUnit(null)}
                    onAddSub={() => setShowNewUnit({ parentId: u.id })}
                  />
                  {subfoldersOf(units, u.id).length > 0 && (
                    <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-border-light pl-2">
                      {subfoldersOf(units, u.id).map((sub) => (
                        <li key={sub.id}>
                          <FolderRow
                            unit={sub}
                            selected={selected === sub.id}
                            docCount={docsIn(sub.id).length}
                            isRenaming={renamingUnitId === sub.id}
                            isConfirmingDelete={confirmingDeleteUnit === sub.id}
                            busy={busy}
                            onSelect={() => setSelected(sub.id)}
                            onStartRename={() => setRenamingUnitId(sub.id)}
                            onSubmitRename={(name) => renameUnit(sub, name)}
                            onCancelRename={() => setRenamingUnitId(null)}
                            onStartDelete={() => setConfirmingDeleteUnit(sub.id)}
                            onConfirmDelete={() => deleteUnit(sub.id)}
                            onCancelDelete={() => setConfirmingDeleteUnit(null)}
                            isSub
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: contents */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-text-primary">
                {selectedUnit ? selectedUnit.name : "Uncategorized"}
              </h3>
              <span className="text-xs text-text-muted">
                {selectedDocs.length} file{selectedDocs.length === 1 ? "" : "s"}
              </span>
            </div>

            {selectedDocs.length === 0 ? (
              <div className="mt-6 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
                No files in this folder yet. Use <span className="font-semibold">+ Upload Files</span> above to add some.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {selectedDocs.map((d) => (
                  <DocumentCard
                    key={d.id}
                    doc={d}
                    isMoving={movingDocId === d.id}
                    isConfirmingDelete={confirmingDeleteDoc === d.id}
                    destinations={destinations}
                    busy={busy}
                    onStartMove={() => setMovingDocId(d.id)}
                    onSubmitMove={(target) => moveDocument(d, target)}
                    onCancelMove={() => setMovingDocId(null)}
                    onStartDelete={() => setConfirmingDeleteDoc(d.id)}
                    onConfirmDelete={() => deleteDocument(d.id)}
                    onCancelDelete={() => setConfirmingDeleteDoc(null)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showNewUnit && (
        <NewUnitModal
          courseId={courseId}
          parentId={showNewUnit.parentId}
          onClose={() => setShowNewUnit(null)}
          onCreated={() => {
            setShowNewUnit(null);
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function FolderRow({
  unit,
  selected,
  docCount,
  isRenaming,
  isConfirmingDelete,
  busy,
  onSelect,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  onAddSub,
  isSub,
}: {
  unit: TeacherUnit;
  selected: boolean;
  docCount: number;
  isRenaming: boolean;
  isConfirmingDelete: boolean;
  busy: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onAddSub?: () => void;
  isSub?: boolean;
}) {
  if (isRenaming) {
    return (
      <FolderRenameForm
        initialName={unit.name}
        isSub={isSub}
        busy={busy}
        onSubmit={onSubmitRename}
        onCancel={onCancelRename}
      />
    );
  }

  if (isConfirmingDelete) {
    return (
      <div className="flex items-center justify-between rounded-[--radius-sm] bg-red-50 px-2 py-1.5 text-xs dark:bg-red-500/10">
        <span className="truncate font-semibold text-red-800 dark:text-red-300">
          Delete &ldquo;{unit.name}&rdquo;?
        </span>
        <div className="ml-2 flex shrink-0 gap-1">
          <button
            onClick={onConfirmDelete}
            disabled={busy}
            className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            onClick={onCancelDelete}
            className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between rounded-[--radius-sm] px-2 py-1.5 transition-colors ${
        selected ? "bg-primary-bg" : "hover:bg-bg-subtle"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`flex flex-1 items-center gap-1 truncate text-left text-sm ${
          selected ? "font-semibold text-primary" : "text-text-secondary"
        }`}
      >
        <span>{isSub ? "📂" : "📁"}</span>
        <span className="truncate">{unit.name}</span>
        <span className="text-xs text-text-muted">({docCount})</span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {onAddSub && (
          <button
            type="button"
            onClick={onAddSub}
            title="New subfolder"
            className="rounded p-1 text-xs text-text-muted hover:bg-surface hover:text-text-primary"
          >
            +
          </button>
        )}
        <button
          type="button"
          onClick={onStartRename}
          title="Rename"
          className="rounded p-1 text-xs text-text-muted hover:bg-surface hover:text-text-primary"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onStartDelete}
          title="Delete"
          className="rounded p-1 text-xs text-text-muted hover:bg-surface hover:text-red-600"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function DocumentCard({
  doc,
  isMoving,
  isConfirmingDelete,
  destinations,
  busy,
  onStartMove,
  onSubmitMove,
  onCancelMove,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  doc: TeacherDocument;
  isMoving: boolean;
  isConfirmingDelete: boolean;
  destinations: { id: string | null; label: string }[];
  busy: boolean;
  onStartMove: () => void;
  onSubmitMove: (target: string | null) => void;
  onCancelMove: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const sizeKb = Math.max(1, Math.round(doc.file_size / 1024));
  const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
  const currentLocation = destinations.find((dest) => dest.id === doc.unit_id)?.label ?? "Uncategorized";
  const availableDestinations = destinations.filter((dest) => dest.id !== doc.unit_id);
  const canMove = availableDestinations.length > 0;

  return (
    <div className="relative rounded-[--radius-md] border border-border-light bg-bg-subtle p-3 text-xs">
      <div className="flex items-start gap-2">
        <span className="text-base">📄</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-text-primary" title={doc.filename}>
            {doc.filename}
          </div>
          <div className="mt-0.5 text-text-muted">{sizeLabel}</div>
        </div>
      </div>

      {isConfirmingDelete ? (
        <div className="mt-2 flex flex-col gap-1 rounded-[--radius-sm] bg-red-50 p-2 dark:bg-red-500/10">
          <span className="text-[11px] font-semibold text-red-800 dark:text-red-300">
            Delete this file?
          </span>
          <div className="flex gap-1">
            <button
              onClick={onConfirmDelete}
              disabled={busy}
              className="flex-1 rounded-[--radius-sm] bg-red-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={onCancelDelete}
              className="rounded-[--radius-sm] border border-red-300 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={onStartMove}
            disabled={!canMove || busy}
            className="flex-1 rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-base"
          >
            Move
          </button>
          <button
            type="button"
            onClick={onStartDelete}
            className="rounded-[--radius-sm] border border-red-300 bg-surface px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
          >
            ×
          </button>
        </div>
      )}

      {isMoving && (
        <div
          className="absolute inset-x-2 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-[--radius-md] border border-border-light bg-surface p-1 shadow-lg"
          onMouseLeave={onCancelMove}
        >
          <div className="px-2 pb-1 pt-0.5 text-[10px] text-text-muted">
            Current location: <span className="font-semibold text-text-secondary">{currentLocation}</span>
          </div>
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Move to
          </div>
          {availableDestinations.length === 0 ? (
            <p className="px-2 py-1 text-xs text-text-muted">No other destinations available.</p>
          ) : (
            availableDestinations.map((dest) => (
              <button
                key={dest.id ?? "uncategorized"}
                type="button"
                onClick={() => onSubmitMove(dest.id)}
                disabled={busy}
                className="block w-full truncate rounded-[--radius-sm] px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-primary-bg hover:text-primary disabled:opacity-50"
              >
                {dest.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NewUnitModal({
  courseId,
  parentId,
  onClose,
  onCreated,
}: {
  courseId: string;
  parentId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-sm rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}

function FolderRenameForm({
  initialName,
  isSub,
  busy,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  isSub?: boolean;
  busy: boolean;
  onSubmit: (next: string) => void;
  onCancel: () => void;
}) {
  // Mounted fresh each time the user enters rename mode (controlled by the
  // parent's `isRenaming` boolean), so draft state is seeded once at mount.
  const [draft, setDraft] = useState(initialName);
  return (
    <form
      className="flex items-center gap-1 rounded-[--radius-sm] bg-primary-bg/40 px-2 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <span>{isSub ? "📂" : "📁"}</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        maxLength={200}
        className="flex-1 rounded-[--radius-sm] border border-border-light bg-bg-base px-1.5 py-0.5 text-sm text-text-primary focus:border-primary focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded px-1.5 py-0.5 text-xs font-bold text-primary hover:bg-surface disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-surface"
      >
        ✕
      </button>
    </form>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:...;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
