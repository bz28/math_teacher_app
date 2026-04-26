"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { teacher, type TeacherDocument, type TeacherUnit } from "@/lib/api";
import { topUnitIdOf, topUnits } from "@/lib/units";
import { formatFileSize } from "@/lib/utils";
import type { PendingUpload } from "@/hooks/use-document-uploads";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  ImageIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from "@/components/ui/icons";
import { fileKind } from "../materials/types";
import { FilePreviewModal } from "../materials/file-preview-modal";

/**
 * Source-material picker for the New Homework / New Practice wizards.
 *
 * Replaces the flat chip-soup selector with a grouped, searchable list
 * that respects the units the teacher picked back in Step 1. Files
 * group under their top-level unit; Step-1 units auto-expand, others
 * stay collapsed but visible. Teachers can preview any file inline
 * (reuses FilePreviewModal) and upload new files without leaving the
 * wizard — uploads land in "Unsorted" and are auto-selected on success.
 */

interface Props {
  courseId: string;
  docs: TeacherDocument[];
  docsLoaded: boolean;
  selectedDocs: Set<string>;
  /** Step-1 unit selection — these groups auto-expand. */
  unitIds: string[];
  onToggleDoc: (id: string) => void;
  /** Inline-upload state owned by the parent modal so it survives the
   *  picker unmounting (e.g. teacher clicks Back mid-upload). */
  pending: PendingUpload[];
  onFilesSelected: (files: File[]) => void;
  onRetryPending: (item: PendingUpload) => void;
  onDismissPending: (id: string) => void;
  disabled: boolean;
}

export function SourceMaterialPicker({
  courseId,
  docs,
  docsLoaded,
  selectedDocs,
  unitIds,
  onToggleDoc,
  pending,
  onFilesSelected,
  onRetryPending,
  onDismissPending,
  disabled,
}: Props) {
  const [units, setUnits] = useState<TeacherUnit[] | null>(null);
  const [search, setSearch] = useState("");
  // `overrides` tracks groups where the teacher explicitly flipped the
  // default state. For default-expanded groups the entry is `groupId`
  // (means: user collapsed it). For default-collapsed groups the entry
  // is `groupId:open` (means: user expanded it).
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<TeacherDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Units load independently of docs so we can label group headers
  // even before the doc list is ready. Failure is non-fatal — the
  // grouped view degrades to "Unknown unit" and search still works.
  useEffect(() => {
    let cancelled = false;
    teacher
      .units(courseId)
      .then((r) => {
        if (!cancelled) setUnits(r.units);
      })
      .catch(() => {
        if (!cancelled) setUnits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // Build groups: Step-1 units first (auto-expanded, even when empty
  // so a teacher who picked "Quadratics" doesn't wonder why no group
  // appears), then remaining top-level units in stored order, then
  // Unsorted last. Subfolder docs roll up to their top-level unit so
  // "Algebra / Practice" shows under "Algebra". Docs whose unit_id
  // points at a deleted/missing unit are bucketed into Unsorted so
  // they remain attachable instead of silently disappearing.
  const groups = useMemo(() => {
    if (!units) return [];
    const tops = topUnits(units);
    const topIds = new Set(tops.map((u) => u.id));
    // Defensive: if Step 1 somehow left unitIds empty (shouldn't happen
    // — wizard requires ≥1), expand everything so the teacher isn't
    // staring at all-collapsed groups with no obvious entry point.
    const fallbackExpand = unitIds.length === 0;
    const out: {
      id: string;
      label: string;
      defaultExpanded: boolean;
      docs: TeacherDocument[];
    }[] = [];
    const taken = new Set<string>();

    const docsForTop = (topId: string) =>
      docs.filter((d) => topUnitIdOf(units, d.unit_id) === topId);

    // 1. Step-1 units, in the order the teacher picked them. Empty
    //    groups are kept as a "we looked, nothing here yet" signal.
    for (const uid of unitIds) {
      if (taken.has(uid)) continue;
      const u = tops.find((t) => t.id === uid);
      if (!u) continue;
      out.push({
        id: u.id,
        label: u.name,
        defaultExpanded: true,
        docs: docsForTop(u.id),
      });
      taken.add(u.id);
    }

    // 2. Other top-level units in their natural order. Skip empty.
    for (const u of tops) {
      if (taken.has(u.id)) continue;
      const groupDocs = docsForTop(u.id);
      if (groupDocs.length === 0) continue;
      out.push({
        id: u.id,
        label: u.name,
        defaultExpanded: fallbackExpand,
        docs: groupDocs,
      });
    }

    // 3. Unsorted: real unsorted (unit_id === null) plus orphans
    //    (unit_id refers to a deleted/missing top-level unit). Without
    //    this bucket, orphans would be excluded from every group and
    //    invisible in the picker.
    const unsorted = docs.filter((d) => {
      if (d.unit_id === null) return true;
      const topId = topUnitIdOf(units, d.unit_id);
      return topId === null || !topIds.has(topId);
    });
    if (unsorted.length > 0) {
      out.push({
        id: "__unsorted__",
        label: "Unsorted",
        defaultExpanded: fallbackExpand,
        docs: unsorted,
      });
    }

    return out;
  }, [docs, units, unitIds]);

  const expandedFor = (groupId: string, defaultExpanded: boolean) => {
    if (defaultExpanded) return !overrides.has(groupId);
    return overrides.has(`${groupId}:open`);
  };

  const toggleGroup = (groupId: string, defaultExpanded: boolean) => {
    const key = defaultExpanded ? groupId : `${groupId}:open`;
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Search runs across all docs (including subfolder ones), case-
  // insensitive substring on filename. Hides group structure and shows
  // a flat list with a unit badge per row.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return docs
      .filter((d) => d.filename.toLowerCase().includes(q))
      .sort((a, b) => a.filename.localeCompare(b.filename));
  }, [docs, search]);

  const triggerPicker = () => fileInputRef.current?.click();

  // ── Render ──

  const totalDocs = docs.length;
  const selectedCount = selectedDocs.size;
  const hasContent = totalDocs > 0 || pending.length > 0;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <label className="block text-sm font-bold text-text-primary">
          Source material{" "}
          {/* The aria-live region wraps only the changing fragment so
              screen readers announce just "3 of 12 selected" on toggle,
              not the whole "Source material · ... · optional" label. */}
          <span
            className="font-normal text-text-muted"
            aria-live="polite"
          >
            {totalDocs > 0
              ? `· ${selectedCount} of ${totalDocs} selected · optional`
              : "· optional"}
          </span>
        </label>
        <button
          type="button"
          onClick={triggerPicker}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-border-light bg-bg-base px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:bg-bg-subtle disabled:opacity-50"
        >
          <UploadIcon className="h-3.5 w-3.5" />
          Upload new
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            onFilesSelected(files);
          }}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {!docsLoaded ? (
        <p className="mt-2 text-[11px] text-text-muted">Loading…</p>
      ) : !hasContent ? (
        <EmptyState onUpload={triggerPicker} disabled={disabled} />
      ) : (
        <div className="mt-2 rounded-[--radius-md] border border-border-light bg-bg-base">
          <div className="border-b border-border-light p-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search materials…"
                aria-label="Search materials"
                disabled={disabled}
                className="h-8 w-full rounded-[--radius-sm] border border-border-light bg-surface pl-8 pr-8 text-xs text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    // Return focus so keyboard users don't get stripped
                    // of their place when the X disappears with the term.
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {pending.length > 0 && (
              <div className="border-b border-border-light bg-bg-subtle/40 p-2">
                {pending.map((p) => (
                  <PendingRow
                    key={p.id}
                    item={p}
                    onRetry={() => onRetryPending(p)}
                    onDismiss={() => onDismissPending(p.id)}
                  />
                ))}
              </div>
            )}

            {searchResults ? (
              <SearchResults
                results={searchResults}
                query={search}
                units={units ?? []}
                selectedDocs={selectedDocs}
                onToggleDoc={onToggleDoc}
                onPreview={setPreviewDoc}
                disabled={disabled}
              />
            ) : (
              <div className="divide-y divide-border-light">
                {groups.length === 0 && pending.length === 0 ? (
                  <p className="p-4 text-center text-xs text-text-muted">
                    No materials yet.
                  </p>
                ) : (
                  groups.map((g) => {
                    const open = expandedFor(g.id, g.defaultExpanded);
                    return (
                      <GroupBlock
                        key={g.id}
                        groupId={g.id}
                        label={g.label}
                        count={g.docs.length}
                        open={open}
                        onToggle={() => toggleGroup(g.id, g.defaultExpanded)}
                        disabled={disabled}
                      >
                        {g.docs.length === 0 ? (
                          <p className="px-3 py-2 text-[11px] italic text-text-muted">
                            No materials in this unit yet — use Upload new
                            above to add one.
                          </p>
                        ) : (
                          g.docs.map((d) => (
                            <DocRow
                              key={d.id}
                              doc={d}
                              checked={selectedDocs.has(d.id)}
                              onToggle={() => onToggleDoc(d.id)}
                              onPreview={() => setPreviewDoc(d)}
                              disabled={disabled}
                            />
                          ))
                        )}
                      </GroupBlock>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

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

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function EmptyState({
  onUpload,
  disabled,
}: {
  onUpload: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 flex flex-col items-center justify-center gap-2 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle/30 px-4 py-6 text-center">
      <p className="text-xs text-text-muted">
        No materials in this course yet. Upload an image or PDF to ground
        generated problems in your own content — or skip and add later.
      </p>
      <button
        type="button"
        onClick={onUpload}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
      >
        <UploadIcon className="h-3.5 w-3.5" />
        Upload new
      </button>
    </div>
  );
}

function GroupBlock({
  groupId,
  label,
  count,
  open,
  onToggle,
  disabled,
  children,
}: {
  groupId: string;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  // aria-controls links the toggle button to the panel it expands so
  // screen readers can navigate between them with the standard
  // disclosure idiom.
  const panelId = `source-picker-group-${groupId}`;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
      >
        {open ? (
          <ChevronDownIcon className="h-3.5 w-3.5 text-text-muted" />
        ) : (
          <ChevronRightIcon className="h-3.5 w-3.5 text-text-muted" />
        )}
        <span className="flex-1 truncate">{label}</span>
        <span className="text-[11px] font-normal text-text-muted">({count})</span>
      </button>
      {open && (
        <div id={panelId} className="bg-surface">
          {children}
        </div>
      )}
    </div>
  );
}

function DocRow({
  doc,
  checked,
  onToggle,
  onPreview,
  disabled,
  unitBadge,
}: {
  doc: TeacherDocument;
  checked: boolean;
  onToggle: () => void;
  onPreview: () => void;
  disabled: boolean;
  unitBadge?: string;
}) {
  const kind = fileKind(doc);
  const Icon = kind === "pdf" ? FileTextIcon : ImageIcon;
  // The outer row is a plain <div> rather than a <label> so the
  // Preview button can sit beside the checkbox without being absorbed
  // into the checkbox's accessible name. The inner <label> still
  // delegates clicks on the icon/filename/size to the checkbox, so
  // the row feels like one tap target.
  return (
    <div
      className={`group flex items-center px-3 text-xs transition-colors hover:bg-bg-subtle ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      }`}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
        />
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${kind === "pdf" ? "text-red-500" : "text-blue-500"}`}
        />
        <span
          className="min-w-0 flex-1 truncate text-text-primary"
          title={doc.filename}
        >
          {doc.filename}
        </span>
        {unitBadge && (
          <span className="shrink-0 rounded-full bg-bg-subtle px-2 py-0.5 text-[10px] font-medium text-text-muted">
            {unitBadge}
          </span>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
          {formatFileSize(doc.file_size)}
        </span>
      </label>
      <button
        type="button"
        onClick={onPreview}
        disabled={disabled}
        aria-label={`Preview ${doc.filename}`}
        className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary-bg disabled:opacity-50"
      >
        Preview
      </button>
    </div>
  );
}

function PendingRow({
  item,
  onRetry,
  onDismiss,
}: {
  item: PendingUpload;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[--radius-sm] px-2 py-1.5 text-xs ${
        item.error ? "bg-red-50 text-red-700" : "text-text-secondary"
      }`}
    >
      {item.error ? (
        <XIcon className="h-3.5 w-3.5 shrink-0 text-red-600" />
      ) : (
        <span
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate" title={item.filename}>
        {item.filename}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
        {formatFileSize(item.size)}
      </span>
      {item.error ? (
        <>
          <span className="shrink-0 text-[11px]">{item.error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary-bg"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </>
      ) : (
        <span className="shrink-0 text-[11px] text-text-muted">Uploading…</span>
      )}
    </div>
  );
}

function SearchResults({
  results,
  query,
  units,
  selectedDocs,
  onToggleDoc,
  onPreview,
  disabled,
}: {
  results: TeacherDocument[];
  query: string;
  units: TeacherUnit[];
  selectedDocs: Set<string>;
  onToggleDoc: (id: string) => void;
  onPreview: (doc: TeacherDocument) => void;
  disabled: boolean;
}) {
  if (results.length === 0) {
    return (
      <p className="p-4 text-center text-xs text-text-muted">
        No matches for &ldquo;{query}&rdquo;.
      </p>
    );
  }
  return (
    <div className="divide-y divide-border-light">
      <p className="px-3 py-2 text-[11px] text-text-muted">
        {results.length} {results.length === 1 ? "result" : "results"}
      </p>
      {results.map((d) => {
        const topId = topUnitIdOf(units, d.unit_id);
        const top = topId ? units.find((u) => u.id === topId) : null;
        return (
          <DocRow
            key={d.id}
            doc={d}
            checked={selectedDocs.has(d.id)}
            onToggle={() => onToggleDoc(d.id)}
            onPreview={() => onPreview(d)}
            disabled={disabled}
            unitBadge={top ? top.name : "Unsorted"}
          />
        );
      })}
    </div>
  );
}
