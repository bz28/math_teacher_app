"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  teacher,
  EntitlementError,
  DEFAULT_GENERATION_PARAMS,
  type GenerationParams,
  type TeacherDocument,
  type TeacherRubric,
  type TeacherUnit,
} from "@/lib/api";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { useDialogDismiss } from "@/hooks/use-dialog-dismiss";
import { topUnits } from "@/lib/units";
import { formatDue, fileToBase64, formatFileSize } from "@/lib/utils";
import { ImageResizeError, resizeImageForUpload } from "@/lib/image-resize";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import { FileTextIcon, ImageIcon, UploadIcon, XIcon } from "@/components/ui/icons";
import {
  AssignmentDetailsStep,
  AssignmentProblemsStep,
  LATE_POLICY_OPTIONS,
} from "./assignment-wizard-steps";
import { GradingSetupCard } from "./grading-setup-card";
import {
  GenerationParamsCustomize,
  persistGenerationParams,
} from "./generation-params-customize";

/**
 * One-sitting create-homework wizard.
 *
 * Replaces the old "make a draft, then reopen the detail page to set
 * due date / late policy / sections / rubric / publish" two-trip flow.
 * The teacher now sets EVERYTHING up front across four steps:
 *
 *   1 — Details   title, units, due date, late policy, sections
 *                 (shared AssignmentDetailsStep)
 *   2 — Problems  Generate from materials OR Upload a worksheet
 *                 (shared AssignmentProblemsStep + the upload pane)
 *   3 — Grading   the AI rubric (shared GradingSetupCard)
 *   4 — Review    summary + finish: "Create & generate" / "Create &
 *                 extract", with "Save as draft" as an escape on every
 *                 step.
 *
 * On finish we create the draft, assign the picked sections, persist
 * the rubric, then kick the generate/upload job and route the teacher
 * to the homework page — where the generated problems land in the
 * review queue. Publishing stays a deliberate one-click on that page
 * AFTER the teacher has reviewed the AI's problems (we never publish
 * un-reviewed AI output); everything else publish needs — due date,
 * sections, late policy, rubric — is already set here, so it's a
 * single click instead of a configuration trip.
 */

// Backend caps mirrored client-side so we can reject oversized files
// before encoding+POSTing 25MB of base64. Magic-byte detection still
// happens server-side; this is just an early bail for the obvious case.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const ACCEPT = "image/jpeg,image/png,application/pdf";

type Mode = "generate" | "upload";
type Step = 1 | 2 | 3 | 4;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Details" },
  { n: 2, label: "Problems" },
  { n: 3, label: "Grading" },
  { n: 4, label: "Review" },
];

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

/** Collapse a partial rubric into a normalized dict, dropping empty /
 *  whitespace-only values. Mirrors normalizeRubric on the HW detail
 *  page so what the teacher authors here stores identically. */
function normalizeRubric(r: TeacherRubric | null): TeacherRubric {
  const out: TeacherRubric = {};
  if (!r) return out;
  const s = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  if (s(r.full_credit)) out.full_credit = s(r.full_credit);
  if (s(r.partial_credit)) out.partial_credit = s(r.partial_credit);
  if (s(r.common_mistakes)) out.common_mistakes = s(r.common_mistakes);
  if (s(r.notes)) out.notes = s(r.notes);
  return out;
}

export function NewHomeworkModal({
  courseId,
  defaultUnitIds = [],
  onClose,
  onCreated,
}: {
  courseId: string;
  /** Pre-select this unit (e.g. the unit currently filtered in the
   *  HW list). */
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
  const { busy, error, setError, run } = useAsyncAction();
  const { showUpgrade, UpgradeModal, isUpgradeOpen } = useUpgradePrompt();
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>("generate");

  // ── Step 1 — Details ──
  const [title, setTitle] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>(defaultUnitIds);
  const [dueAt, setDueAt] = useState<string>("");
  const [latePolicy, setLatePolicy] = useState<string>("none");
  const [sectionIds, setSectionIds] = useState<string[]>([]);

  // ── Step 2 (generate) ──
  const [count, setCount] = useState<number>(10);
  const [topicHint, setTopicHint] = useState("");
  // Customize-section selections for generation. Same shape + storage
  // as the in-HW Generate-more modal; selection persists across both
  // entry points so AP teachers don't reselect.
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  // ── Step 2 (upload) ──
  // Files stay staged across mode switches so a teacher who clicks
  // Generate by accident doesn't lose their photos.
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [scopeHint, setScopeHint] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Step 3 — Grading ──
  const [rubric, setRubric] = useState<TeacherRubric | null>(null);

  // Units, loaded for the Review-step summary (names) + the unit guard.
  // The Details step's UnitMultiSelect loads its own copy; this is a
  // cheap parallel read so we can show "Quadratics, Linear" instead of
  // "2 units" on the final review.
  const [units, setUnits] = useState<TeacherUnit[]>([]);

  // Inline document uploads for the generate step's source-material
  // picker. Owned at the modal so the pending rows survive the picker
  // remounting when the step switches. Uploads land in the first picked
  // unit (Details requires ≥1 before Problems is reachable).
  const uploads = useDocumentUploads({
    courseId,
    getUnitId: () => unitIds[0] ?? "",
    setDocs,
    setSelectedDocs,
  });

  // Load units + docs eagerly on mount. Both are tiny lists scoped to
  // the course; pre-loading avoids a flash of empty UI when the teacher
  // reaches the generate picker or the review summary.
  useEffect(() => {
    let cancelled = false;
    teacher
      .units(courseId)
      .then((r) => {
        if (!cancelled) setUnits(r.units);
      })
      .catch(() => {
        // Non-fatal — the Details step loads units independently; this
        // copy only powers the review summary's unit names.
      });
    teacher
      .documents(courseId)
      .then((r) => {
        if (!cancelled) setDocs(r.documents);
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

  const detailsValid = title.trim().length > 0 && unitIds.length > 0;
  const validStagedCount = stagedFiles.filter((f) => !f.error && f.base64).length;

  // ── Rubric accumulation (mirrors the detail page, but buffered in
  //    memory until the draft exists rather than auto-saved). ──
  const onChangeRubric = (patch: Partial<TeacherRubric>) => {
    setRubric((prev) => {
      const merged = normalizeRubric({ ...(prev ?? {}), ...patch });
      return Object.keys(merged).length === 0 ? null : merged;
    });
  };

  const onToggleDoc = (id: string) =>
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── Flow control ──

  const goTo = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const onContinueFromDetails = () => {
    if (!detailsValid) {
      setError(
        !title.trim() ? "Title is required" : "Pick at least one unit",
      );
      return;
    }
    goTo(2);
  };

  // ── Create paths ──

  // Create the draft with the full configuration the wizard collected:
  // title, units, due date, late policy, then the picked sections and
  // the authored rubric. Sections + rubric are best-effort PATCHes
  // (both stay fully editable on the detail page), so a hiccup on
  // either doesn't strand the teacher with no homework at all.
  const createDraft = async (): Promise<string> => {
    const created = await teacher.createAssignment(courseId, {
      title: title.trim(),
      type: "homework",
      unit_ids: unitIds,
      late_policy: latePolicy,
      ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
    });
    if (sectionIds.length > 0) {
      try {
        await teacher.assignToSections(created.id, sectionIds);
      } catch {
        // Non-fatal — teacher adds sections on the detail page.
      }
    }
    const normalized = normalizeRubric(rubric);
    if (Object.keys(normalized).length > 0) {
      try {
        await teacher.updateAssignment(created.id, { rubric: normalized });
      } catch {
        // Non-fatal — rubric stays editable on the detail page.
      }
    }
    return created.id;
  };

  const onSaveDraft = () =>
    run(async () => {
      const id = await createDraft();
      onCreated(id, { startedGeneration: false });
    });

  const onGenerate = () =>
    run(async () => {
      const id = await createDraft();
      // Fire-and-forget: the job runs server-side regardless of the
      // client. The teacher routes straight to the review queue — its
      // skeleton state covers the wait, items appear as they land.
      let startedGeneration = true;
      try {
        const job = await teacher.generateBank(courseId, {
          count,
          assignment_id: id,
          unit_id: unitIds[0],
          document_ids: Array.from(selectedDocs),
          constraint: topicHint.trim() || null,
          // Writes to localStorage as a side-effect; returns null when
          // no customizations are active.
          params: persistGenerationParams(params),
        });
        sessionStorage.setItem(`hw-gen-${id}`, JSON.stringify([job.id]));
      } catch (e) {
        if (e instanceof EntitlementError && e.isLimit) {
          // Cap hit: roll back the draft we just created so the
          // teacher's course doesn't get littered with empty drafts.
          // Best-effort — orphan visible on next load if delete fails.
          try {
            await teacher.deleteAssignment(id);
          } catch {
            // Non-fatal — orphan persists, teacher can delete later.
          }
          showUpgrade(e.entitlement, e.message);
          return;
        }
        startedGeneration = false;
      }
      onCreated(id, { startedGeneration });
    });

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
          unit_id: unitIds[0],
          constraint: scopeHint.trim() || null,
        });
        sessionStorage.setItem(`hw-gen-${id}`, JSON.stringify([job.id]));
      } catch {
        startedGeneration = false;
      }
      onCreated(id, { startedGeneration });
    });

  // ── Upload-mode staging ──

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
    // the 5 MB server cap.
    try {
      const blob = await resizeImageForUpload(file);
      if (blob.size > MAX_IMAGE_BYTES) {
        return errorRow(file, "Too large (max 5MB)");
      }
      const base64 = await fileToBase64(blob as File);
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
      if (err instanceof ImageResizeError) {
        return errorRow(file, err.message);
      }
      throw err;
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const remaining = Math.max(0, MAX_FILES - stagedFiles.length);
    const next = list.slice(0, remaining);
    const staged = await Promise.all(next.map(stageOne));
    setStagedFiles((prev) => [...prev, ...staged]);
  };

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

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

  // ── Motion ──
  const variants = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, x: 16 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -16 },
      };

  const current = STEPS.find((s) => s.n === step)!;
  const unitNames = topUnits(units)
    .filter((u) => unitIds.includes(u.id))
    .map((u) => u.name);

  // Backdrop / Escape are suppressed together while a create or upload is
  // mid-flight so a stray dismiss can't orphan an in-flight request.
  const dismissible = !busy && !uploads.hasInflightUploads;
  // Suppress this wizard's Escape-to-close while the upgrade prompt is
  // stacked on top, so Escape dismisses only the prompt — not the whole
  // wizard (which would discard the teacher's entered title/units/files).
  const panelRef = useDialogDismiss({ onClose, dismissible: dismissible && !isUpgradeOpen });

  // Why the forward / finish button is disabled, surfaced inline next to
  // it (the old modal left the dim button reasonless). Only the
  // missing-prerequisite case earns a line — `busy` is self-evident.
  const blockReason = busy
    ? null
    : step === 1 && !detailsValid
      ? !title.trim() && unitIds.length === 0
        ? "Add a title and pick a unit to continue"
        : !title.trim()
          ? "Add a title to continue"
          : "Pick a unit to continue"
      : step === 4 && mode === "upload" && validStagedCount === 0
        ? "Add at least one worksheet page to extract"
        : null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--color-overlay)] p-4 backdrop-blur-sm"
        onClick={() => {
          // Block backdrop close while a create or upload is in flight.
          if (dismissible) onClose();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="New homework"
          className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — editorial: serif title + a quiet step counter. */}
          <div className="flex items-center justify-between gap-3 border-b border-border-light px-6 py-3.5">
            <div className="flex items-baseline gap-3">
              <h2 className="font-serif text-lg leading-none tracking-[-0.01em] text-text-primary">
                New homework
              </h2>
              <span className="rounded-[--radius-pill] bg-bg-subtle px-2 py-0.5 text-[11px] font-semibold text-text-muted">
                Step {step} of {STEPS.length} · {current.label}
              </span>
            </div>
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

          {/* Stepper progress indicator */}
          <div className="border-b border-border-light bg-bg-subtle/40 px-6 py-3">
            <WizardStepper step={step} onJump={(n) => goTo(n)} />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                variants={variants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: "easeOut" }}
              >
                {step === 1 && (
                  <AssignmentDetailsStep
                    title={title}
                    onTitleChange={setTitle}
                    courseId={courseId}
                    unitIds={unitIds}
                    onUnitIdsChange={setUnitIds}
                    dueAt={dueAt}
                    onDueAtChange={setDueAt}
                    latePolicy={latePolicy}
                    onLatePolicyChange={setLatePolicy}
                    sectionIds={sectionIds}
                    onSectionIdsChange={setSectionIds}
                    disabled={busy}
                    titlePlaceholder="e.g. Quadratics HW #1"
                    sectionsHint="Leave empty to assign to every section in this course."
                  />
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <ModeTabs mode={mode} onChange={setMode} disabled={busy} />
                    {mode === "generate" ? (
                      <AssignmentProblemsStep
                        count={count}
                        onCountChange={setCount}
                        topicHint={topicHint}
                        onTopicHintChange={setTopicHint}
                        courseId={courseId}
                        unitIds={unitIds}
                        docs={docs}
                        docsLoaded={docsLoaded}
                        selectedDocs={selectedDocs}
                        onToggleDoc={onToggleDoc}
                        pending={uploads.pending}
                        onFilesSelected={uploads.handleFiles}
                        onRetryPending={uploads.retryPending}
                        onDismissPending={uploads.dismissPending}
                        disabled={busy}
                        helperText="The AI writes fresh problems from your unit and any materials you point it at. They land in a review queue for your approval."
                        extraControls={
                          <GenerationParamsCustomize
                            params={params}
                            onChange={setParams}
                            disabled={busy}
                          />
                        }
                      />
                    ) : (
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
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-2">
                    <p className="text-xs text-text-muted">
                      How the AI grades student work on this homework. We&apos;ve
                      filled in sensible defaults — edit to match how you grade.
                    </p>
                    {/* GradingSetupCard owns its own card chrome; -mt
                        pulls it tight under the helper line. */}
                    <div className="-mt-2">
                      <GradingSetupCard
                        rubric={rubric}
                        saveState="idle"
                        saveError={null}
                        onChange={onChangeRubric}
                      />
                    </div>
                  </div>
                )}

                {step === 4 && (
                  <ReviewStep
                    title={title}
                    unitNames={unitNames}
                    unitCount={unitIds.length}
                    dueAt={dueAt}
                    latePolicy={latePolicy}
                    sectionCount={sectionIds.length}
                    mode={mode}
                    count={count}
                    fileCount={validStagedCount}
                    hasRubric={Object.keys(normalizeRubric(rubric)).length > 0}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer — Back + Save-as-draft escape on the left, the
              forward / finish action on the right. A pinned message row
              sits above the actions so the submit error (which used to
              render at the bottom of the scrollable body, below the
              fold) and the why-disabled reason are always in view. */}
          {(error || blockReason) && (
            <div
              id="hw-wizard-msg"
              className="border-t border-border-light px-6 pt-3 text-xs"
              role={error ? "alert" : undefined}
            >
              <span
                className={
                  error
                    ? "font-semibold text-[color:var(--color-error)]"
                    : "text-text-muted"
                }
              >
                {error ?? blockReason}
              </span>
            </div>
          )}
          <div
            className={`flex items-center justify-between gap-3 px-6 py-3 ${
              error || blockReason ? "" : "border-t border-border-light"
            }`}
          >
            <div className="flex items-center gap-1">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => goTo((step - 1) as Step)}
                  disabled={busy}
                  className="-mx-1 inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
                >
                  ← Back
                </button>
              )}
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={busy || !detailsValid}
                title={
                  detailsValid
                    ? "Create the draft and finish setup later"
                    : "Add a title and a unit first"
                }
                className="-mx-1 inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                Save as draft
              </button>
            </div>

            {step < 4 ? (
              <button
                type="button"
                onClick={() =>
                  step === 1 ? onContinueFromDetails() : goTo((step + 1) as Step)
                }
                disabled={busy || (step === 1 && !detailsValid)}
                aria-describedby={blockReason ? "hw-wizard-msg" : undefined}
                className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted disabled:opacity-100"
              >
                Continue →
              </button>
            ) : mode === "generate" ? (
              <button
                type="button"
                onClick={onGenerate}
                disabled={busy || !detailsValid}
                aria-describedby={blockReason ? "hw-wizard-msg" : undefined}
                className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted disabled:opacity-100"
              >
                {busy ? "Creating…" : "Create & generate →"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onUpload}
                disabled={busy || !detailsValid || validStagedCount === 0}
                title={
                  validStagedCount === 0
                    ? "Add at least one worksheet page first"
                    : undefined
                }
                aria-describedby={blockReason ? "hw-wizard-msg" : undefined}
                className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted disabled:opacity-100"
              >
                {busy ? "Creating…" : "Create & extract →"}
              </button>
            )}
          </div>
        </div>
      </div>
      {UpgradeModal}
    </>
  );
}

// ── Stepper ──

function WizardStepper({
  step,
  onJump,
}: {
  step: Step;
  onJump: (n: Step) => void;
}) {
  return (
    <ol className="flex items-center">
      {STEPS.map((s, i) => {
        const state =
          s.n < step ? "done" : s.n === step ? "current" : "upcoming";
        // Only completed steps are clickable — forward jumps must pass
        // the Details validation gate.
        const clickable = s.n < step;
        return (
          <li key={s.n} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => clickable && onJump(s.n)}
              disabled={!clickable}
              aria-current={state === "current" ? "step" : undefined}
              className={`group flex items-center gap-2 ${
                clickable ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  state === "current"
                    ? "bg-primary text-white"
                    : state === "done"
                      ? "border border-primary/40 bg-primary/10 text-primary group-hover:bg-primary/20"
                      : "border border-border-light bg-surface text-text-muted"
                }`}
              >
                {state === "done" ? "✓" : s.n}
              </span>
              <span
                className={`hidden text-[11px] font-semibold uppercase tracking-[0.12em] sm:inline ${
                  state === "upcoming" ? "text-text-muted" : "text-text-primary"
                }`}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={`mx-2 h-px flex-1 ${
                  s.n < step ? "bg-primary/40" : "bg-border-light"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Generate / Upload mode toggle ──

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
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + tabs.length) % tabs.length;
    onChange(tabs[next].key);
  };
  return (
    <div role="tablist" aria-label="Homework problem source" className="flex gap-1.5">
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

// ── Review step ──

function ReviewStep({
  title,
  unitNames,
  unitCount,
  dueAt,
  latePolicy,
  sectionCount,
  mode,
  count,
  fileCount,
  hasRubric,
}: {
  title: string;
  unitNames: string[];
  unitCount: number;
  dueAt: string;
  latePolicy: string;
  sectionCount: number;
  mode: Mode;
  count: number;
  fileCount: number;
  hasRubric: boolean;
}) {
  const lateLabel =
    LATE_POLICY_OPTIONS.find((o) => o.value === latePolicy)?.label ?? latePolicy;
  const unitsText =
    unitNames.length > 0
      ? unitNames.join(", ")
      : `${unitCount} unit${unitCount === 1 ? "" : "s"}`;
  const problemsText =
    mode === "generate"
      ? `Generate ${count} problem${count === 1 ? "" : "s"} with AI`
      : fileCount > 0
        ? `Extract from ${fileCount} uploaded page${fileCount === 1 ? "" : "s"}`
        : "No pages added yet";

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        One last look. Creating sets the due date, sections, late policy and
        grading rubric in one go — then the AI&apos;s problems land in a review
        queue, where you approve them and publish.
      </p>

      <dl className="overflow-hidden rounded-[--radius-md] border border-border-light">
        <SummaryRow label="Title" value={title.trim() || "Untitled"} />
        <SummaryRow label="Units" value={unitsText} />
        <SummaryRow
          label="Due"
          value={dueAt ? formatDue(new Date(dueAt).toISOString()) : "No due date"}
          muted={!dueAt}
        />
        <SummaryRow label="Late policy" value={lateLabel} />
        <SummaryRow
          label="Sections"
          value={
            sectionCount === 0
              ? "All sections in this course"
              : `${sectionCount} section${sectionCount === 1 ? "" : "s"}`
          }
          muted={sectionCount === 0}
        />
        <SummaryRow label="Problems" value={problemsText} muted={mode === "upload" && fileCount === 0} />
        <SummaryRow
          label="Grading"
          value={hasRubric ? "Custom rubric" : "Default rubric"}
          muted={!hasRubric}
          last
        />
      </dl>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
  last,
}: {
  label: string;
  value: string;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-4 px-4 py-2.5 ${
        last ? "" : "border-b border-border-light"
      }`}
    >
      <dt className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
        {label}
      </dt>
      <dd
        className={`min-w-0 flex-1 text-sm ${
          muted ? "italic text-text-muted" : "text-text-primary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

// ── Upload pane (worksheet photos / PDF → Vision extraction) ──

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
        <p className="mt-1 text-[11px] text-text-muted">
          Snap or drop a worksheet — the AI transcribes the problems verbatim
          into the review queue.
        </p>
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
            Up to {MAX_FILES} files · JPEG/PNG up to 5MB · PDF up to 25MB
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesSelected(e.target.files);
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
                  <p className="mt-0.5 text-[11px] text-[color:var(--color-error)]">{f.error}</p>
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
