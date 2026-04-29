"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type TeacherDocument, type TeacherUnit } from "@/lib/api";
import { topUnits } from "@/lib/units";
import { fileToBase64, formatFileSize } from "@/lib/utils";
import { ImageResizeError, resizeImageForUpload } from "@/lib/image-resize";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import { FileTextIcon, ImageIcon, UploadIcon, XIcon } from "@/components/ui/icons";
import { SelectableChip } from "./selectable-chip";
import { SourceMaterialPicker } from "./source-material-picker";

/**
 * Single-screen creation modal for a draft homework.
 *
 * Mode toggle at the top swaps the form between two creation paths:
 *   - Generate: AI invents `count` problems for the unit, optionally
 *     scoped by a focus hint and reference materials. Kicks off a bank
 *     gen job and routes to the review queue.
 *   - Upload: teacher drops photos or a PDF of an existing worksheet;
 *     Vision extracts the problems verbatim, optionally scoped by a
 *     natural-language hint ("Q1-13 odd"). Same bank-job pipeline,
 *     same review queue — items just land with source="imported".
 *
 * Title + Unit are shared by both modes. Due date, late policy, and
 * section assignment are intentionally absent; they aren't read by
 * generation and are editable on the HW detail page where the
 * teacher lands next, so asking here is double work.
 *
 * Footer text-link "Create empty draft" is the escape hatch: stub HW,
 * straight to detail page, no AI involvement either way.
 */

const QUANTITY_CHIPS = [5, 10, 15, 20] as const;

// Backend caps mirrored client-side so we can reject oversized files
// before encoding+POSTing 25MB of base64. Magic-byte detection still
// happens server-side; this is just an early bail for the obvious case.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const ACCEPT = "image/jpeg,image/png,application/pdf";

type Mode = "generate" | "upload";

interface StagedFile {
  id: string;
  filename: string;
  size: number;
  mediaType: "image/jpeg" | "image/png" | "application/pdf";
  /** Raw base64 (no data: prefix) — what the API expects. */
  base64: string;
  /** data: URL preview for image thumbnails; null for PDFs. */
  previewUrl: string | null;
  /** Per-row error if validation failed. Kept on a row so the teacher
   *  sees what was rejected, with valid files staged alongside. */
  error?: string;
}

export function NewHomeworkModal({
  courseId,
  defaultUnitIds = [],
  onClose,
  onCreated,
}: {
  courseId: string;
  /** Pre-select this unit (e.g. the unit currently filtered in the
   *  HW list). Single-select — only the first id is honored. */
  defaultUnitIds?: string[];
  onClose: () => void;
  /** Fired with the newly-created HW id after a successful create.
   *  `startedGeneration` lets the parent route a generating HW
   *  straight to the review queue and an empty draft to detail. */
  onCreated: (
    newAssignmentId: string,
    opts: { startedGeneration: boolean },
  ) => void;
}) {
  const { busy, error, run } = useAsyncAction();

  const [mode, setMode] = useState<Mode>("generate");

  const [title, setTitle] = useState("");
  const [unitId, setUnitId] = useState<string | null>(
    defaultUnitIds[0] ?? null,
  );
  const [count, setCount] = useState<number>(10);
  // Empty by default because the matching preset chip already shows
  // the value — we only put text in the input when the teacher picks
  // a non-preset.
  const [countDraft, setCountDraft] = useState("");
  const [topicHint, setTopicHint] = useState("");

  // Upload-mode state. Files stay staged across mode switches so a
  // teacher who clicks Generate by accident doesn't lose their photos.
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [scopeHint, setScopeHint] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [units, setUnits] = useState<TeacherUnit[] | null>(null);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  // Inline document uploads. Owned at the modal so the pending rows
  // survive the picker remounting when the unit switches. Uploads
  // land in the currently-picked unit; the picker only renders
  // after a unit is picked, so unitId is non-null whenever Upload
  // is reachable. Upload-during-unit-switch race is closed by
  // disabling the unit chips while `hasInflightUploads` is true.
  const uploads = useDocumentUploads({
    courseId,
    getUnitId: () => unitId ?? "",
    setDocs,
    setSelectedDocs,
  });

  // Load units + docs eagerly on mount. Both are tiny lists scoped to
  // the course; pre-loading avoids a flash of empty UI when the
  // teacher picks a unit and expects materials to appear instantly.
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
    teacher
      .documents(courseId)
      .then((r) => {
        if (cancelled) return;
        setDocs(r.documents);
      })
      .catch(() => {
        // Non-fatal — docs are optional context for generation.
      })
      .finally(() => {
        if (!cancelled) setDocsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const onPickUnit = (id: string) => {
    if (id === unitId) return;
    setUnitId(id);
    // Switching unit invalidates any selected reference files —
    // forwarding files from another unit to the AI generator would
    // ignore the unit the teacher just picked. Cheaper than a confirm
    // dialog and matches the picker's filter-mode default view.
    setSelectedDocs(new Set());
  };

  const clamp = (v: number) => Math.min(50, Math.max(1, Math.round(v)));

  const handleCountChange = (raw: string) => {
    setCountDraft(raw);
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) setCount(clamp(v));
  };

  const handleCountBlur = () => {
    const v = parseInt(countDraft, 10);
    if (Number.isNaN(v)) {
      // Empty/invalid — fall back to the current count, but leave
      // the input blank when that count is one of the chips (the
      // chip is already showing it).
      setCountDraft(
        (QUANTITY_CHIPS as readonly number[]).includes(count) ? "" : String(count),
      );
      return;
    }
    setCountDraft(String(clamp(v)));
  };

  const createDraft = async (): Promise<string> => {
    // Both submit buttons are `disabled` until title + unitId are
    // present (see button props below), so unitId is non-null here.
    if (!unitId) throw new Error("Pick a unit");
    const created = await teacher.createAssignment(courseId, {
      title: title.trim(),
      type: "homework",
      unit_ids: [unitId],
      late_policy: "none",
    });
    return created.id;
  };

  const onCreateEmpty = () =>
    run(async () => {
      const id = await createDraft();
      onCreated(id, { startedGeneration: false });
    });

  const onGenerate = () =>
    run(async () => {
      const id = await createDraft();
      // Fire-and-forget: the job runs server-side regardless of the
      // client. The teacher routes straight to the review queue —
      // its skeleton state covers the wait, items appear as they land.
      let startedGeneration = true;
      try {
        const job = await teacher.generateBank(courseId, {
          count,
          assignment_id: id,
          unit_id: unitId!,
          document_ids: Array.from(selectedDocs),
          constraint: topicHint.trim() || null,
        });
        sessionStorage.setItem(`hw-gen-${id}`, job.id);
      } catch {
        startedGeneration = false;
      }
      onCreated(id, { startedGeneration });
    });

  // ── Upload mode ──

  const ACCEPTED_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "application/pdf",
  ]);

  const newRowId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const errorRow = (file: File, message: string): StagedFile => ({
    id: newRowId(),
    filename: file.name,
    size: file.size,
    mediaType: "image/jpeg", // unused on error rows
    base64: "",
    previewUrl: null,
    error: message,
  });

  const stageOne = async (file: File): Promise<StagedFile> => {
    if (!ACCEPTED_TYPES.has(file.type)) {
      return errorRow(file, "Only JPEG, PNG, and PDF are accepted");
    }
    const isPdf = file.type === "application/pdf";

    // PDFs go through untouched — resizeImageForUpload is image-only.
    // Cap the raw file size up front to avoid a 50MB base64 round-trip
    // for an obviously-too-big upload.
    if (isPdf) {
      if (file.size > MAX_PDF_BYTES) {
        return errorRow(file, "Too large (max 25MB)");
      }
      try {
        const base64 = await fileToBase64(file);
        return {
          id: newRowId(),
          filename: file.name,
          size: file.size,
          mediaType: "application/pdf",
          base64,
          previewUrl: null,
        };
      } catch {
        return errorRow(file, "Could not read file");
      }
    }

    // Images: resize before staging so a phone photo lands well under
    // the 5 MB server cap. resizeImageForUpload returns the original
    // File untouched if it's already small enough; otherwise a smaller
    // JPEG Blob. Encoding the result of that gives us the same bytes
    // the server will validate.
    try {
      const blob = await resizeImageForUpload(file);
      // Defense in depth — resize should produce ≤5MB, but a future
      // change to the util shouldn't silently bypass the server cap.
      if (blob.size > MAX_IMAGE_BYTES) {
        return errorRow(file, "Too large (max 5MB)");
      }
      const base64 = await fileToBase64(blob as File);
      // Resize re-encodes as JPEG; preview the actual bytes the server
      // will see (not the original file's media type).
      const mediaType: StagedFile["mediaType"] =
        blob === file ? (file.type as StagedFile["mediaType"]) : "image/jpeg";
      return {
        id: newRowId(),
        filename: file.name,
        size: blob.size,
        mediaType,
        base64,
        previewUrl: `data:${mediaType};base64,${base64}`,
      };
    } catch (err) {
      // resize-only error — surface the friendly message. Anything
      // else bubbles (it's an unexpected programmer error, not a
      // user-actionable case).
      if (err instanceof ImageResizeError) {
        return errorRow(file, err.message);
      }
      throw err;
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    // Cap total files at MAX_FILES — silently drop the overflow.
    const remaining = Math.max(0, MAX_FILES - stagedFiles.length);
    const next = list.slice(0, remaining);
    const staged = await Promise.all(next.map(stageOne));
    setStagedFiles((prev) => [...prev, ...staged]);
  };

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const onUpload = () =>
    run(async () => {
      const valid = stagedFiles.filter((f) => !f.error && f.base64);
      if (valid.length === 0) throw new Error("Add at least one file");
      const id = await createDraft();
      let startedGeneration = true;
      try {
        const job = await teacher.uploadWorksheet(courseId, {
          images: valid.map((f) => f.base64),
          assignment_id: id,
          unit_id: unitId!,
          constraint: scopeHint.trim() || null,
        });
        sessionStorage.setItem(`hw-gen-${id}`, job.id);
      } catch {
        startedGeneration = false;
      }
      onCreated(id, { startedGeneration });
    });

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (busy) return;
    if (e.dataTransfer.files?.length) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const tops = units ? topUnits(units) : [];
  const validStagedCount = stagedFiles.filter((f) => !f.error && f.base64).length;
  const canGenerate = !busy && title.trim().length > 0 && unitId !== null;
  const canExtract = canGenerate && validStagedCount > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        // Block backdrop close while a create or upload is in flight —
        // unmounting mid-request orphans whatever the server already
        // persisted (failed-upload rows are inert so don't block).
        if (!busy && !uploads.hasInflightUploads) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">
            New Homework
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy || uploads.hasInflightUploads}
            aria-label="Close"
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <ModeTabs mode={mode} onChange={setMode} disabled={busy} />

          <div>
            <label
              htmlFor="hw-title"
              className="block text-sm font-bold text-text-primary"
            >
              Title
            </label>
            <input
              id="hw-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={300}
              placeholder="e.g. Quadratics HW #1"
              disabled={busy}
              className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-text-primary">
              Unit
            </label>
            {units === null ? (
              <p className="mt-2 text-xs text-text-muted">Loading units…</p>
            ) : tops.length === 0 ? (
              <p className="mt-2 text-xs italic text-text-muted">
                No units yet. Create one in the Materials tab first.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tops.map((u) => (
                  <SelectableChip
                    key={u.id}
                    label={u.name}
                    selected={unitId === u.id}
                    // Block unit switches while uploads are in flight.
                    // Otherwise an in-flight upload's auto-select can land
                    // AFTER our switch's selectedDocs clear, leaving a
                    // freshly-uploaded doc id selected under a different
                    // unit and silently forwarded on submit.
                    disabled={busy || uploads.hasInflightUploads}
                    onToggle={() => onPickUnit(u.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {mode === "generate" && (
            <>
              <div>
                <label className="block text-sm font-bold text-text-primary">
                  How many problems?
                </label>
                <div className="mt-2 flex items-center gap-2">
                  {QUANTITY_CHIPS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setCount(n);
                        // Clear the input so a preset chip and the custom
                        // field don't both display the same number.
                        setCountDraft("");
                      }}
                      disabled={busy}
                      aria-pressed={count === n}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        count === n
                          ? "bg-primary text-white"
                          : "bg-bg-subtle text-text-primary hover:bg-bg-base"
                      } disabled:opacity-50`}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="text-[11px] text-text-muted">or</span>
                  <input
                    type="number"
                    value={countDraft}
                    min={1}
                    max={50}
                    placeholder="custom"
                    aria-label="Custom problem count"
                    onChange={(e) => handleCountChange(e.target.value)}
                    onBlur={handleCountBlur}
                    disabled={busy}
                    className="w-20 rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="hw-focus"
                  className="block text-sm font-bold text-text-primary"
                >
                  Focus{" "}
                  <span className="font-normal text-text-muted">· optional</span>
                </label>
                <p className="mt-1 text-[11px] text-text-muted">
                  Tell the AI what to emphasize.
                </p>
                <input
                  id="hw-focus"
                  type="text"
                  value={topicHint}
                  onChange={(e) => setTopicHint(e.target.value)}
                  placeholder="e.g. word problems, real-world contexts, no calculators"
                  disabled={busy}
                  className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
                />
              </div>

              {unitId && (
                <SourceMaterialPicker
                  courseId={courseId}
                  docs={docs}
                  docsLoaded={docsLoaded}
                  selectedDocs={selectedDocs}
                  unitIds={[unitId]}
                  units={units}
                  onToggleDoc={(id) =>
                    setSelectedDocs((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  pending={uploads.pending}
                  onFilesSelected={uploads.handleFiles}
                  onRetryPending={uploads.retryPending}
                  onDismissPending={uploads.dismissPending}
                  disabled={busy}
                  filterToSelectedUnits
                />
              )}
            </>
          )}

          {mode === "upload" && (
            <UploadSection
              fileInputRef={fileInputRef}
              dragActive={dragActive}
              stagedFiles={stagedFiles}
              scopeHint={scopeHint}
              onScopeHintChange={setScopeHint}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onFilesSelected={(files) => void handleFiles(files)}
              onRemoveStaged={removeStagedFile}
              disabled={busy}
            />
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3">
          <button
            type="button"
            onClick={onCreateEmpty}
            disabled={busy || !title.trim() || !unitId}
            className="-mx-2 inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            Create empty draft
          </button>
          {mode === "generate" ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? "Creating…" : "Generate problems →"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onUpload}
              disabled={!canExtract}
              className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? "Creating…" : "Extract problems →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──

function ModeTabs({
  mode,
  onChange,
  disabled,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  disabled: boolean;
}) {
  const tabs: { key: Mode; label: string }[] = [
    { key: "generate", label: "Generate" },
    { key: "upload", label: "Upload" },
  ];
  // Arrow-key navigation between pills — keeps the toggle accessible
  // for keyboard users while staying out of the way for mouse/touch.
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + tabs.length) % tabs.length;
    onChange(tabs[next].key);
  };
  return (
    <div role="tablist" aria-label="Homework creation mode" className="flex gap-1.5">
      {tabs.map((t, i) => {
        const selected = mode === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              selected
                ? "bg-primary text-white"
                : "bg-bg-subtle text-text-primary hover:bg-bg-base"
            } disabled:opacity-50`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function UploadSection({
  fileInputRef,
  dragActive,
  stagedFiles,
  scopeHint,
  onScopeHintChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onFilesSelected,
  onRemoveStaged,
  disabled,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dragActive: boolean;
  stagedFiles: StagedFile[];
  scopeHint: string;
  onScopeHintChange: (v: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFilesSelected: (files: FileList) => void;
  onRemoveStaged: (id: string) => void;
  disabled: boolean;
}) {
  const fullCount = stagedFiles.length;
  const atCap = fullCount >= MAX_FILES;
  return (
    <div className="space-y-3" role="tabpanel" aria-label="Upload">
      <div>
        <label className="block text-sm font-bold text-text-primary">
          Upload pages
        </label>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          disabled={disabled || atCap}
          aria-label="Add files"
          className={`mt-2 flex w-full flex-col items-center justify-center gap-1.5 rounded-[--radius-md] border border-dashed px-4 py-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border-light bg-bg-subtle hover:border-primary"
          }`}
        >
          <UploadIcon className="h-5 w-5 text-text-muted" />
          <span className="text-xs font-semibold text-text-primary">
            Drop photos or a PDF, or click to browse
          </span>
          <span className="text-[11px] text-text-muted">
            up to {MAX_FILES} files · JPEG, PNG, PDF
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          // Mobile: the OS picker offers a camera shortcut when this
          // hint is set, letting teachers snap a textbook page directly.
          // Desktop ignores the hint and shows the regular file dialog.
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesSelected(e.target.files);
            // Reset so re-picking the same file fires onChange again.
            e.target.value = "";
          }}
        />
      </div>

      {fullCount > 0 && (
        <ul className="space-y-1.5" aria-label="Staged files">
          {stagedFiles.map((f) => (
            <li
              key={f.id}
              className="flex min-h-[44px] items-center gap-3 rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2"
            >
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.previewUrl}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded object-cover"
                />
              ) : f.mediaType === "application/pdf" ? (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-bg-subtle text-text-muted">
                  <FileTextIcon className="h-5 w-5" />
                </div>
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-bg-subtle text-text-muted">
                  <ImageIcon className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-text-primary">
                  {f.filename}
                </p>
                <p className="text-[11px] text-text-muted">
                  {formatFileSize(f.size)}
                  {f.mediaType === "application/pdf" ? " · PDF" : ""}
                </p>
                {f.error && (
                  <p className="mt-0.5 text-[11px] text-red-600">{f.error}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemoveStaged(f.id)}
                disabled={disabled}
                aria-label={`Remove ${f.filename}`}
                className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {fullCount > 0 && (
        <p className="text-[11px] text-text-muted">
          {fullCount} of {MAX_FILES}
        </p>
      )}

      <div>
        <label
          htmlFor="hw-scope"
          className="block text-sm font-bold text-text-primary"
        >
          Which problems?{" "}
          <span className="font-normal text-text-muted">· optional</span>
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          Tell the AI which problems to pull. Leave blank to extract everything.
        </p>
        <input
          id="hw-scope"
          type="text"
          value={scopeHint}
          onChange={(e) => onScopeHintChange(e.target.value)}
          placeholder="e.g. Q1-13 odd, skip word problems"
          disabled={disabled}
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}
