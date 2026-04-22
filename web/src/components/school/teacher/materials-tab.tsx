"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { teacher, type TeacherDocument, type TeacherUnit } from "@/lib/api";
import { MATERIAL_UPLOAD_MAX_BYTES } from "@/lib/constants";
import { subfoldersOf, topUnits } from "@/lib/units";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from "@/components/ui/icons";
import { FolderTree } from "./materials/folder-tree";
import { FileGrid } from "./materials/file-grid";
import { FilePreviewModal } from "./materials/file-preview-modal";
import { UploadDropzone } from "./materials/upload-dropzone";
import { MoveDialog } from "./materials/move-dialog";
import { DeleteFolderDialog } from "./materials/delete-folder-dialog";
import { NewUnitModal } from "./materials/new-unit-modal";
import { CollisionDialog } from "./materials/collision-dialog";
import {
  detectCollisions,
  fileCountInFolder,
  mapWithConcurrency,
  sanitizeFolderName,
  treeFromDirectoryPicker,
  uniqueName,
} from "./materials/walk-dropped-folder";
import {
  type Collision,
  type Destination,
  type DroppedTree,
  type ResolutionChoice,
  type RowState,
  type SortMode,
} from "./materials/types";
import { fileToBase64 } from "@/lib/utils";

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
  const [previewDoc, setPreviewDoc] = useState<TeacherDocument | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [pendingCollisions, setPendingCollisions] = useState<{
    collisions: Collision[];
    resolve: (choices: Map<string, ResolutionChoice> | null) => void;
  } | null>(null);
  const lastClickedDocIdRef = useRef<string | null>(null);
  const { busy, error, setError, run } = useAsyncAction();

  const reload = useCallback(
    async ({ showSkeleton = false }: { showSkeleton?: boolean } = {}): Promise<boolean> => {
      if (showSkeleton) setLoading(true);
      setError(null);
      try {
        const [u, d] = await Promise.all([
          teacher.units(courseId),
          teacher.documents(courseId),
        ]);
        setUnits(u.units);
        setDocs(d.documents);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load materials");
        return false;
      } finally {
        if (showSkeleton) setLoading(false);
      }
    },
    [courseId, setError],
  );

  useEffect(() => {
    reload({ showSkeleton: true });
  }, [reload]);

  // Clear multi-selection on Escape — but only when no modal is open,
  // so pressing Escape to close a dialog doesn't also wipe the selection
  // in the background.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (selectedDocIds.size > 0) setSelectedDocIds(new Set());
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

  /* ── upload pipeline ──
   * Both drag-drop and the file/folder pickers funnel into handleImport
   * with a DroppedTree. Loose files go into the selected folder; folders
   * become new top-level units (with optional 2-level subfolders). On
   * name collisions we await the user's per-folder decision via the
   * CollisionDialog before touching the backend.
   */

  const uploadOne = async (file: File, unitId: string | null) => {
    if (file.size > MATERIAL_UPLOAD_MAX_BYTES) throw new Error("exceeds 25MB");
    const base64 = await fileToBase64(file);
    await teacher.uploadDocument(courseId, {
      image_base64: base64,
      filename: file.name,
      unit_id: unitId,
    });
  };

  const handleImport = (tree: DroppedTree) =>
    run(async () => {
      if (tree.folders.length === 0 && tree.looseFiles.length === 0) {
        if (tree.skipped > 0) {
          toast.error(`Skipped ${tree.skipped} unsupported file${tree.skipped === 1 ? "" : "s"}`);
        }
        return;
      }

      // Resolve collisions before touching the backend.
      const topLevelNames = units
        .filter((u) => u.parent_id === null)
        .map((u) => ({ id: u.id, name: u.name }));
      const collisions = detectCollisions(tree.folders, topLevelNames);

      // On cancel, treat all conflicting folders as "skip" but still
      // import the non-conflicting folders and loose files.
      let resolutions: Map<string, ResolutionChoice> = new Map();
      if (collisions.length > 0) {
        const choices = await new Promise<Map<string, ResolutionChoice> | null>((resolve) => {
          setPendingCollisions({ collisions, resolve });
        });
        setPendingCollisions(null);
        if (choices === null) {
          for (const c of collisions) resolutions.set(c.folder.name, "skip");
        } else {
          resolutions = choices;
        }
      }

      // Track taken top-level names so "Create new" picks don't collide
      // with each other — covers both server-side and same-drop sibling
      // duplicates (e.g. two dropped "Misc" folders neither on server).
      const taken = new Set(topLevelNames.map((u) => u.name.toLowerCase()));
      const collisionByName = new Map(collisions.map((c) => [c.folder.name, c]));

      let okFiles = 0;
      let okUnits = 0;
      let failedFiles = 0;
      const UPLOAD_CONCURRENCY = 5;

      const uploadBatch = async (files: File[], unitId: string | null) => {
        const results = await mapWithConcurrency(files, UPLOAD_CONCURRENCY, (file) =>
          uploadOne(file, unitId),
        );
        for (const r of results) {
          if (r.ok) okFiles += 1;
          else failedFiles += 1;
        }
      };

      // ── folders ─────────────────────────────────────────────────
      // Unit creation stays sequential (order + name dedupe matters),
      // but files within each folder/subfolder upload in parallel.
      for (const folder of tree.folders) {
        const collision = collisionByName.get(folder.name);
        const choice = collision ? resolutions.get(folder.name) ?? "create" : "create";
        if (choice === "skip") continue;

        let targetUnitId: string;
        try {
          if (choice === "merge" && collision) {
            targetUnitId = collision.existingUnitId;
          } else {
            // Always run through uniqueName so sibling duplicates in the
            // same drop get numbered suffixes too, not just server ones.
            const name = sanitizeFolderName(uniqueName(folder.name, taken));
            const created = await teacher.createUnit(courseId, { name });
            targetUnitId = created.id;
            okUnits += 1;
          }
        } catch {
          failedFiles += fileCountInFolder(folder);
          continue;
        }

        await uploadBatch(folder.files, targetUnitId);

        // level-2 subfolders — on merge we still create them under the
        // existing unit so dropped structure is preserved.
        for (const sub of folder.subfolders) {
          let subUnitId: string;
          try {
            const created = await teacher.createUnit(courseId, {
              name: sanitizeFolderName(sub.name),
              parent_id: targetUnitId,
            });
            subUnitId = created.id;
          } catch {
            failedFiles += sub.files.length;
            continue;
          }
          await uploadBatch(sub.files, subUnitId);
        }
      }

      // ── loose files (go into currently-selected folder) ─────────
      await uploadBatch(tree.looseFiles, selected);

      if (await reload()) onChanged();

      // Summary toast + screen-reader announcement
      let summary = "";
      if (okFiles > 0 || okUnits > 0) {
        const parts: string[] = [];
        if (okUnits > 0) parts.push(`${okUnits} unit${okUnits === 1 ? "" : "s"}`);
        if (okFiles > 0) parts.push(`${okFiles} file${okFiles === 1 ? "" : "s"}`);
        const action = okUnits > 0 ? "Imported" : "Uploaded";
        const skipSuffix = tree.skipped > 0 ? ` · ${tree.skipped} skipped` : "";
        summary = `${action} ${parts.join(" · ")}${skipSuffix}`;
        toast.success(summary);
      } else if (tree.skipped > 0 && failedFiles === 0) {
        summary = `Skipped ${tree.skipped} unsupported file${tree.skipped === 1 ? "" : "s"}`;
        toast.error(summary);
      }
      if (failedFiles > 0) {
        const fail = `Failed to upload ${failedFiles} file${failedFiles === 1 ? "" : "s"}`;
        summary = summary ? `${summary}. ${fail}` : fail;
        toast.error(fail);
      }
      setLiveMessage(summary);
    });

  // Loose-file shim for the existing <input type="file"> click-picker
  // path — wraps plain files into a DroppedTree so they funnel through
  // the same pipeline.
  const handleLooseFiles = (files: File[]) => {
    if (files.length === 0) return;
    handleImport({ folders: [], looseFiles: files, skipped: 0 });
  };

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
      if (await reload()) onChanged();
    });

  /* ── document mutations ── */

  const moveDocuments = (ids: string[], targetUnitId: string | null) =>
    run(async () => {
      const results = await mapWithConcurrency(ids, 5, (id) =>
        teacher.updateDocument(courseId, id, { unit_id: targetUnitId }),
      );
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      setBulkMoveOpen(false);
      setSelectedDocIds(new Set());
      if (await reload()) onChanged();
      if (ok > 0) {
        const msg = `Moved ${ok} file${ok === 1 ? "" : "s"}`;
        toast.success(msg);
        setLiveMessage(msg);
      }
      if (failed > 0) toast.error(`Failed to move ${failed} file(s)`);
    });

  const deleteDocuments = (ids: string[]) =>
    run(async () => {
      const results = await mapWithConcurrency(ids, 5, (id) =>
        teacher.deleteDocument(courseId, id),
      );
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      setSelectedDocIds(new Set());
      if (await reload()) onChanged();
      if (ok > 0) {
        const msg = `Deleted ${ok} file${ok === 1 ? "" : "s"}`;
        toast.success(msg);
        setLiveMessage(msg);
      }
      if (failed > 0) toast.error(`Failed to delete ${failed} file(s)`);
    });

  /* ── selection handling ── */

  const handleCardClick = useCallback(
    (doc: TeacherDocument, e: MouseEvent) => {
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
    },
    [visibleDocs],
  );

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
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowNewUnit({ parentId: null })}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[--radius-md] border border-border-light bg-surface px-3.5 py-2 text-sm font-semibold text-text-secondary shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:bg-bg-subtle hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          New Unit
        </button>
        <SplitUploadButton
          busy={busy}
          onFiles={handleLooseFiles}
          onFolderTree={handleImport}
        />
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div aria-busy={busy || loading} aria-live="polite" className="sr-only">
        {busy ? "Working…" : liveMessage}
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : units.length === 0 && docs.length === 0 ? (
        <FirstTimeDropzone busy={busy} onDropTree={handleImport} />
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

          <UploadDropzone busy={busy} onDropTree={handleImport}>
            <div className="rounded-[--radius-lg] border border-border-light bg-surface p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-text-primary">
                    {selectedUnit ? (
                      <FolderOpenIcon className="h-5 w-5 shrink-0 text-primary" />
                    ) : (
                      <FolderIcon className="h-5 w-5 shrink-0 text-text-muted" />
                    )}
                    <span className="truncate">
                      {selectedUnit ? selectedUnit.name : "Uncategorized"}
                    </span>
                  </h3>
                  <p className="mt-1 text-xs font-medium text-text-muted">
                    {folderDocs.length === 0
                      ? "No files"
                      : `${visibleDocs.length} of ${folderDocs.length} file${
                          folderDocs.length === 1 ? "" : "s"
                        }`}
                  </p>
                </div>
              </div>

              <Toolbar
                search={search}
                onSearchChange={setSearch}
                sort={sort}
                onSortChange={setSort}
              />

              {folderDocs.length === 0 ? (
                <FilesEmptyState />
              ) : visibleDocs.length === 0 ? (
                <p className="mt-6 text-center text-sm text-text-muted">
                  No files match &ldquo;{search}&rdquo;.
                </p>
              ) : (
                <div className="mt-5">
                  <FileGrid
                    docs={visibleDocs}
                    selectedIds={selectedDocIds}
                    onCardClick={handleCardClick}
                    onPreview={setPreviewDoc}
                  />
                </div>
              )}

              {/* Hide the drag-drop tip on touch-only devices where it would lie. */}
              <p className="mt-4 hidden items-center justify-center gap-1.5 text-[11px] text-text-muted [@media(hover:hover)]:flex">
                <UploadIcon className="h-3 w-3" />
                Tip: drag files or folders here. Drop multiple folders to create
                several units at once.
              </p>
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

      {pendingCollisions && (
        <CollisionDialog
          key={pendingCollisions.collisions.map((c) => c.folder.name).join("|")}
          open
          collisions={pendingCollisions.collisions}
          busy={busy}
          onCancel={() => pendingCollisions.resolve(null)}
          onConfirm={(choices) => pendingCollisions.resolve(choices)}
        />
      )}

      <MoveDialog
        open={bulkMoveOpen}
        title={`Move ${selectedDocIds.size} file${selectedDocIds.size === 1 ? "" : "s"}`}
        currentUnitId={selected}
        destinations={destinations}
        busy={busy}
        onClose={() => setBulkMoveOpen(false)}
        onConfirm={(target) => moveDocuments([...selectedDocIds], target)}
      />

      {previewDoc && (
        <FilePreviewModal
          courseId={courseId}
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
}

/**
 * First-time experience for a brand-new course with zero units and
 * zero documents. Wraps the shared UploadDropzone so drag-and-drop
 * works here too, and leads with a large friendly CTA that tells
 * teachers they can drop a folder to create their first unit.
 */
function FirstTimeDropzone({
  busy,
  onDropTree,
}: {
  busy: boolean;
  onDropTree: (tree: DroppedTree) => void;
}) {
  return (
    <div className="mt-4">
      <UploadDropzone busy={busy} onDropTree={onDropTree}>
        <div className="flex flex-col items-center justify-center gap-4 rounded-[--radius-lg] border-2 border-dashed border-border-light bg-surface px-6 py-16 text-center shadow-sm">
          <span
            className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-bg text-primary shadow-sm ring-1 ring-primary/20"
            aria-hidden
          >
            <UploadIcon className="h-9 w-9" strokeWidth={2} />
          </span>
          <div className="max-w-md">
            <h3 className="text-xl font-bold tracking-tight text-text-primary">
              <span className="[@media(hover:none)]:hidden">
                Drop files or a folder to get started
              </span>
              <span className="hidden [@media(hover:none)]:inline">
                Upload files to get started
              </span>
            </h3>
            <p className="mt-2 text-sm text-text-muted">
              <span className="[@media(hover:none)]:hidden">
                Drag a whole folder from Finder to create a unit with all of
                its contents in one go — or drop individual PDFs and images.
              </span>
              <span className="hidden [@media(hover:none)]:inline">
                Tap Upload to add PDFs or images, or create a unit with the
                New Unit button.
              </span>
            </p>
          </div>
          <p className="text-[11px] font-medium text-text-muted">
            PDF, PNG, JPG up to 25 MB · Drop multiple folders to create several
            units at once
          </p>
        </div>
      </UploadDropzone>
    </div>
  );
}

/**
 * Primary action as a split button: the big pill opens the file picker
 * (current behavior); the right chevron reveals a small menu with
 * explicit "Files" / "Folder" entries. "Folder" triggers a second hidden
 * <input webkitdirectory>. The directory picker only accepts one folder
 * at a time (browser limitation) — multi-folder imports still require
 * drag-and-drop.
 */
function SplitUploadButton({
  busy,
  onFiles,
  onFolderTree,
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
  onFolderTree: (tree: DroppedTree) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // React doesn't render non-standard attributes reliably — set
  // webkitdirectory / directory imperatively so the browser actually
  // shows the folder picker instead of falling back to the file one.
  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.setAttribute("mozdirectory", "");
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: Event) => {
      if (!containerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <label
        className={`inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-l-[--radius-md] bg-primary pl-4 pr-3 py-2 text-sm font-bold text-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-md focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
          busy ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <UploadIcon className="h-4 w-4" strokeWidth={2.25} />
        Upload
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            onFiles(files);
          }}
          className="hidden"
          disabled={busy}
        />
      </label>
      <button
        type="button"
        aria-label="More upload options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={busy}
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex min-h-[44px] min-w-[36px] items-center justify-center rounded-r-[--radius-md] border-l border-primary-dark/30 bg-primary px-2 py-2 text-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        <ChevronDownIcon className="h-4 w-4" strokeWidth={2.5} />
      </button>

      <input
        ref={folderInputRef}
        type="file"
        multiple
        onChange={(e) => {
          const list = e.target.files;
          e.target.value = "";
          if (!list || list.length === 0) return;
          onFolderTree(treeFromDirectoryPicker(list));
        }}
        className="hidden"
      />

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-[--radius-md] border border-border-light bg-surface py-1 text-xs shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              fileInputRef.current?.click();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary transition-colors hover:bg-bg-subtle"
          >
            <UploadIcon className="h-3.5 w-3.5" />
            Files
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              folderInputRef.current?.click();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary transition-colors hover:bg-bg-subtle"
          >
            <FolderIcon className="h-3.5 w-3.5" />
            Folder
          </button>
        </div>
      )}
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
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted transition-colors" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files in this folder"
          aria-label="Search files in folder"
          className="h-9 w-full rounded-full border border-border-light bg-bg-subtle pl-9 pr-9 text-sm text-text-primary placeholder:text-text-muted transition-all duration-200 ease-out focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">
        Sort
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          className="h-9 rounded-full border border-border-light bg-bg-subtle px-3 text-sm font-medium text-text-primary transition-all duration-200 ease-out focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="name">Name (A–Z)</option>
          <option value="size">Size (largest)</option>
          <option value="added">Added (newest)</option>
        </select>
      </label>
    </div>
  );
}

function FilesEmptyState() {
  return (
    <div className="mt-6 flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-bg text-primary shadow-sm ring-1 ring-primary/10"
        aria-hidden
      >
        <FolderIcon className="h-7 w-7" strokeWidth={2} />
      </span>
      <div>
        <p className="text-sm font-bold text-text-primary">No files here yet</p>
        <p className="mt-1 text-xs text-text-muted">
          Drag files or folders in, or click <span className="font-semibold">Upload</span>
        </p>
        <p className="mt-0.5 text-[11px] text-text-muted">
          Folders become new units
        </p>
      </div>
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
      className="fixed inset-x-0 z-30 mx-auto flex w-fit items-center gap-2 rounded-full border border-border-light bg-surface/90 px-3 py-2 shadow-lg backdrop-blur-md materials-bulk-bar-enter"
      style={{ bottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
    >
      <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-primary-bg px-3 py-1 text-xs font-bold text-primary">
        <span className="tabular-nums">{count}</span>
        <span>selected</span>
      </span>
      <div className="mx-1 h-5 w-px bg-border-light" />
      <button
        type="button"
        onClick={onMove}
        disabled={busy}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
      >
        <FolderOpenIcon className="h-4 w-4" /> Move
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition-all duration-150 ease-out hover:bg-red-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        <XIcon className="h-3.5 w-3.5" /> Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-1 rounded-full p-1.5 text-text-muted transition-colors hover:bg-bg-subtle hover:text-text-primary"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-[280px_1fr]" aria-hidden>
      <div className="space-y-2 rounded-[--radius-lg] border border-border-light bg-surface p-3 shadow-sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-[--radius-sm]" />
        ))}
      </div>
      <div className="rounded-[--radius-lg] border border-border-light bg-surface p-5 shadow-sm">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3 w-24" />
        <Skeleton className="mt-4 h-9 w-full rounded-full" />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-[--radius-md] border border-border-light bg-bg-subtle p-3"
            >
              <Skeleton className="h-10 w-10 rounded-[--radius-sm]" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
