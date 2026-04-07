"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { teacher, type TeacherDocument, type TeacherUnit } from "@/lib/api";
import { MATERIAL_UPLOAD_MAX_BYTES } from "@/lib/constants";
import { subfoldersOf, topUnits } from "@/lib/units";
import { EmptyState } from "@/components/school/shared/empty-state";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchIcon, UploadIcon, XIcon } from "@/components/ui/icons";
import { FolderTree } from "./materials/folder-tree";
import { FileGrid } from "./materials/file-grid";
import { UploadDropzone } from "./materials/upload-dropzone";
import { MoveDialog } from "./materials/move-dialog";
import { DeleteFolderDialog } from "./materials/delete-folder-dialog";
import { NewUnitModal } from "./materials/new-unit-modal";
import {
  fileToBase64,
  type Destination,
  type RowState,
  type SortMode,
} from "./materials/types";

export function MaterialsTab({ courseId, onChanged }: { courseId: string; onChanged: () => void }) {
  const toast = useToast();
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNewUnit, setShowNewUnit] = useState<{ parentId: string | null } | null>(null);
  const [rowState, setRowState] = useState<RowState>({ kind: "idle" });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const lastClickedDocIdRef = useRef<string | null>(null);
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

  // Clear multi-selection on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedDocIds.size > 0) setSelectedDocIds(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedDocIds.size]);

  // Switching folders clears selection — selected doc ids are scoped to a folder.
  useEffect(() => {
    setSelectedDocIds(new Set());
    lastClickedDocIdRef.current = null;
  }, [selected]);

  const tops = topUnits(units);
  const docsIn = (unitId: string | null) => docs.filter((d) => d.unit_id === unitId);

  const selectedUnit = selected ? units.find((u) => u.id === selected) ?? null : null;
  const folderDocs = docsIn(selected);

  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? folderDocs.filter((d) => d.filename.toLowerCase().includes(q))
      : folderDocs;
    const sorted = [...filtered];
    if (sort === "name") {
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
    } else if (sort === "size") {
      sorted.sort((a, b) => b.file_size - a.file_size);
    } else {
      sorted.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    }
    return sorted;
  }, [folderDocs, search, sort]);

  const destinations: Destination[] = useMemo(() => {
    const out: Destination[] = [{ id: null, label: "Uncategorized" }];
    for (const top of tops) {
      out.push({ id: top.id, label: top.name });
      for (const sub of subfoldersOf(units, top.id)) {
        out.push({ id: sub.id, label: `${top.name} / ${sub.name}` });
      }
    }
    return out;
  }, [tops, units]);

  /* ── upload ── */

  const handleUpload = (files: File[]) =>
    run(async () => {
      if (files.length === 0) return;
      let ok = 0;
      const failures: string[] = [];
      for (const file of files) {
        try {
          if (file.size > MATERIAL_UPLOAD_MAX_BYTES) {
            throw new Error("exceeds 25MB");
          }
          const base64 = await fileToBase64(file);
          await teacher.uploadDocument(courseId, {
            image_base64: base64,
            filename: file.name,
            unit_id: selected,
          });
          ok += 1;
        } catch (e) {
          failures.push(`${file.name}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
      await reload();
      onChanged();
      if (ok > 0) toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"}`);
      if (failures.length > 0) toast.error(`Failed: ${failures.join("; ")}`);
    });

  /* ── folder mutations ── */

  const renameUnit = (unit: TeacherUnit, nextName: string) =>
    run(async () => {
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === unit.name) {
        setRowState({ kind: "idle" });
        return;
      }
      await teacher.updateUnit(courseId, unit.id, { name: trimmed });
      setRowState({ kind: "idle" });
      await reload();
    });

  const deleteFolder = (unitId: string) =>
    run(async () => {
      await teacher.deleteUnit(courseId, unitId);
      if (selected === unitId) setSelected(null);
      setRowState({ kind: "idle" });
      await reload();
      onChanged();
    });

  /* ── document mutations ── */

  const moveDocuments = (ids: string[], targetUnitId: string | null) =>
    run(async () => {
      let ok = 0;
      const failures: string[] = [];
      for (const id of ids) {
        try {
          await teacher.updateDocument(courseId, id, { unit_id: targetUnitId });
          ok += 1;
        } catch (e) {
          failures.push(e instanceof Error ? e.message : "failed");
        }
      }
      setBulkMoveOpen(false);
      setSelectedDocIds(new Set());
      await reload();
      onChanged();
      if (ok > 0) toast.success(`Moved ${ok} file${ok === 1 ? "" : "s"}`);
      if (failures.length > 0) toast.error(`Failed to move ${failures.length} file(s)`);
    });

  const deleteDocuments = (ids: string[]) =>
    run(async () => {
      let ok = 0;
      const failures: string[] = [];
      for (const id of ids) {
        try {
          await teacher.deleteDocument(courseId, id);
          ok += 1;
        } catch (e) {
          failures.push(e instanceof Error ? e.message : "failed");
        }
      }
      setSelectedDocIds(new Set());
      await reload();
      onChanged();
      if (ok > 0) toast.success(`Deleted ${ok} file${ok === 1 ? "" : "s"}`);
      if (failures.length > 0) toast.error(`Failed to delete ${failures.length} file(s)`);
    });

  /* ── selection handling ── */

  const handleCardClick = (doc: TeacherDocument, e: MouseEvent) => {
    const isMulti = e.metaKey || e.ctrlKey;
    const isRange = e.shiftKey;
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (isRange && lastClickedDocIdRef.current) {
        const ids = visibleDocs.map((d) => d.id);
        const a = ids.indexOf(lastClickedDocIdRef.current);
        const b = ids.indexOf(doc.id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i += 1) next.add(ids[i]);
        }
      } else if (isMulti) {
        if (next.has(doc.id)) next.delete(doc.id);
        else next.add(doc.id);
      } else {
        if (next.size === 1 && next.has(doc.id)) next.clear();
        else {
          next.clear();
          next.add(doc.id);
        }
      }
      return next;
    });
    lastClickedDocIdRef.current = doc.id;
  };

  /* ── derived for delete-folder dialog ── */

  const folderBeingDeleted =
    rowState.kind === "deletingFolder"
      ? units.find((u) => u.id === rowState.id) ?? null
      : null;
  const folderDeleteFileCount = folderBeingDeleted
    ? docs.filter((d) => {
        if (d.unit_id === folderBeingDeleted.id) return true;
        // Include files inside subfolders.
        const sub = units.find((u) => u.id === d.unit_id);
        return sub?.parent_id === folderBeingDeleted.id;
      }).length
    : 0;

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
            <span className="inline-flex items-center gap-1.5">
              <UploadIcon className="h-4 w-4" /> Upload Files
            </span>
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                if (files.length > 0) handleUpload(files);
              }}
              className="hidden"
              disabled={busy}
            />
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div aria-busy={busy || loading} aria-live="polite" className="sr-only">
        {busy ? "Working…" : ""}
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : units.length === 0 && docs.length === 0 ? (
        <EmptyState text="No materials yet. Create a unit or upload files to get started." />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[280px_1fr]">
          <FolderTree
            units={units}
            selected={selected}
            docCountFor={(id) => docsIn(id).length}
            uncategorizedCount={docsIn(null).length}
            rowState={rowState}
            busy={busy}
            onSelect={setSelected}
            onStartRename={(id) => setRowState({ kind: "renaming", id })}
            onSubmitRename={renameUnit}
            onCancelRow={() => setRowState({ kind: "idle" })}
            onStartDeleteFolder={(id) => setRowState({ kind: "deletingFolder", id })}
            onAddSub={(parentId) => setShowNewUnit({ parentId })}
          />

          <UploadDropzone busy={busy} onFiles={handleUpload}>
            <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-text-primary">
                  {selectedUnit ? selectedUnit.name : "Uncategorized"}
                </h3>
                <span className="text-xs text-text-muted">
                  {visibleDocs.length} of {folderDocs.length} file
                  {folderDocs.length === 1 ? "" : "s"}
                </span>
              </div>

              <Toolbar
                search={search}
                onSearchChange={setSearch}
                sort={sort}
                onSortChange={setSort}
              />

              {folderDocs.length === 0 ? (
                <div className="mt-4 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
                  No files in this folder yet. Drop files here or use{" "}
                  <span className="font-semibold">Upload Files</span> above.
                </div>
              ) : visibleDocs.length === 0 ? (
                <p className="mt-4 text-sm text-text-muted">
                  No files match &ldquo;{search}&rdquo;.
                </p>
              ) : (
                <div className="mt-4">
                  <FileGrid
                    docs={visibleDocs}
                    selectedIds={selectedDocIds}
                    onCardClick={handleCardClick}
                  />
                </div>
              )}
            </div>
          </UploadDropzone>
        </div>
      )}

      {selectedDocIds.size > 0 && (
        <BulkActionBar
          count={selectedDocIds.size}
          busy={busy}
          onClear={() => setSelectedDocIds(new Set())}
          onMove={() => setBulkMoveOpen(true)}
          onDelete={() => deleteDocuments([...selectedDocIds])}
        />
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

      <DeleteFolderDialog
        open={rowState.kind === "deletingFolder"}
        folderName={folderBeingDeleted?.name ?? ""}
        fileCount={folderDeleteFileCount}
        busy={busy}
        onClose={() => setRowState({ kind: "idle" })}
        onConfirm={() => {
          if (rowState.kind === "deletingFolder") deleteFolder(rowState.id);
        }}
      />

      <MoveDialog
        open={bulkMoveOpen}
        title={`Move ${selectedDocIds.size} file${selectedDocIds.size === 1 ? "" : "s"}`}
        currentUnitId={selected}
        destinations={destinations}
        busy={busy}
        onClose={() => setBulkMoveOpen(false)}
        onConfirm={(target) => moveDocuments([...selectedDocIds], target)}
      />
    </div>
  );
}

function Toolbar({
  search,
  onSearchChange,
  sort,
  onSortChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  sort: SortMode;
  onSortChange: (s: SortMode) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files in this folder"
          aria-label="Search files in folder"
          className="w-full rounded-[--radius-md] border border-border-light bg-bg-base py-1.5 pl-8 pr-8 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <label className="text-xs text-text-muted">
        Sort
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          className="ml-1 rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1 text-sm text-text-primary focus:border-primary focus:outline-none"
        >
          <option value="name">Name (A–Z)</option>
          <option value="size">Size (largest)</option>
          <option value="added">Added (newest)</option>
        </select>
      </label>
    </div>
  );
}

function BulkActionBar({
  count,
  busy,
  onClear,
  onMove,
  onDelete,
}: {
  count: number;
  busy: boolean;
  onClear: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Bulk file actions"
      className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit items-center gap-3 rounded-[--radius-xl] border border-border-light bg-surface px-4 py-2 shadow-lg"
    >
      <span className="text-sm font-semibold text-text-primary">
        {count} file{count === 1 ? "" : "s"} selected
      </span>
      <div className="h-5 w-px bg-border-light" />
      <button
        type="button"
        onClick={onMove}
        disabled={busy}
        className="rounded-[--radius-md] border border-border-light px-3 py-1 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
      >
        Move
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="rounded-[--radius-md] bg-red-600 px-3 py-1 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[280px_1fr]" aria-hidden>
      <div className="rounded-[--radius-lg] border border-border-light bg-surface p-3 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
        <Skeleton className="h-5 w-32" />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
