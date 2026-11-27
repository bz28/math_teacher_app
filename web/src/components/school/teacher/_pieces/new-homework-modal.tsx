"use client";

import { useEffect, useState } from "react";
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
import { hasRubricText, normalizeRubric } from "@/lib/rubric";
import { MAX_TOTAL_POINTS } from "@/lib/points";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { useDialogDismiss } from "@/hooks/use-dialog-dismiss";
import { topUnits } from "@/lib/units";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import {
  AssignmentDetailsStep,
  AssignmentProblemsStep,
} from "./assignment-wizard-steps";
import {
  DiscardConfirmDialog,
  ModeTabs,
  ReviewStep,
  WizardStepper,
  type Mode,
} from "./homework-wizard-chrome";
import {
  MAX_TOTAL_B64_BYTES,
  MAX_TOTAL_MB,
  UploadSection,
  useStagedFiles,
} from "./homework-wizard-upload";
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

type Step = 1 | 2 | 3 | 4;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Details" },
  { n: 2, label: "Problems" },
  { n: 3, label: "Grading" },
  { n: 4, label: "Review" },
];

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

  // Whether the "discard unsaved work?" prompt is stacked over the wizard.
  // While it's up the wizard itself is non-dismissible; the prompt owns
  // its own Escape / backdrop handling.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

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
  const {
    stagedFiles,
    dragActive,
    fileInputRef,
    handleFiles,
    removeStagedFile,
    onDragOver,
    onDragLeave,
    onDrop,
  } = useStagedFiles(busy);
  const [scopeHint, setScopeHint] = useState("");

  // ── Step 3 — Grading ──
  const [rubric, setRubric] = useState<TeacherRubric | null>(null);
  // What the homework is worth, split evenly once its problems exist.
  // Kept as typed so a half-typed number isn't snapped back mid-edit.
  const [totalPointsText, setTotalPointsText] = useState("100");
  const totalPoints = Number(totalPointsText.trim());
  const pointsValid =
    Number.isInteger(totalPoints) && totalPoints >= 1 && totalPoints <= MAX_TOTAL_POINTS;

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

  // Has the teacher put real work into this wizard? Measured against the
  // modal's *initial* state (units can arrive pre-selected via
  // defaultUnitIds), so a pristine open is never "dirty" — we only prompt
  // before discarding work the teacher would actually lose. `busy` is
  // excluded: a mid-flight create routes away via onCreated, not a close.
  const unitsChanged =
    unitIds.length !== defaultUnitIds.length ||
    unitIds.some((id) => !defaultUnitIds.includes(id));
  const isDirty =
    title.trim().length > 0 ||
    unitsChanged ||
    // Step-1 details a teacher can set before typing a title — each is
    // real work that would otherwise be discarded with no prompt.
    dueAt.length > 0 ||
    sectionIds.length > 0 ||
    latePolicy !== "none" ||
    stagedFiles.length > 0 ||
    selectedDocs.size > 0 ||
    topicHint.trim().length > 0 ||
    scopeHint.trim().length > 0 ||
    hasRubricText(rubric) ||
    Boolean(rubric?.skipped_rule_ids?.length) ||
    totalPointsText.trim() !== "100";

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
      total_points: totalPoints,
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
      const totalB64 = valid.reduce((n, f) => n + f.base64.length, 0);
      if (totalB64 > MAX_TOTAL_B64_BYTES) {
        throw new Error(
          `These files are over ${MAX_TOTAL_MB} MB together. Remove some, or split them across two uploads.`,
        );
      }
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
  // Suppress this wizard's Escape-to-close while the upgrade prompt OR the
  // discard-confirm is stacked on top, so a dismiss hits only the top
  // layer — not the whole wizard (which would discard the teacher's work).
  // When the form is dirty, a dismiss attempt raises the discard prompt
  // instead of closing outright.
  const { panelRef, requestClose } = useDialogDismiss({
    onClose,
    dismissible: dismissible && !isUpgradeOpen && !confirmingDiscard,
    confirmClose: () => isDirty,
    onConfirmClose: () => setConfirmingDiscard(true),
  });

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
      : step === 3 && !pointsValid
        ? `Points must be a whole number from 1 to ${MAX_TOTAL_POINTS}`
      : step === 4 && mode === "upload" && validStagedCount === 0
        ? "Add at least one worksheet page to extract"
        : null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--color-overlay)] p-4 backdrop-blur-sm"
        onClick={() => {
          // `requestClose` no-ops while a create/upload is in flight and
          // raises the discard prompt when the form is dirty.
          requestClose();
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
              onClick={requestClose}
              disabled={busy || uploads.hasInflightUploads}
              aria-label="Close"
              className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
            >
              ✕
            </button>
          </div>

          {/* Stepper progress indicator */}
          <div className="border-b border-border-light bg-bg-subtle/40 px-6 py-3">
            <WizardStepper steps={STEPS} step={step} onJump={(n) => goTo(n)} />
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
                    schedule={{
                      dueAt,
                      onDueAtChange: setDueAt,
                      latePolicy,
                      onLatePolicyChange: setLatePolicy,
                    }}
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
                    <div className="rounded-[--radius-md] border border-border-light bg-bg-subtle/40 px-4 py-3">
                      <label
                        htmlFor="hw-total-points"
                        className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary"
                      >
                        This homework is worth
                        <input
                          id="hw-total-points"
                          type="text"
                          inputMode="numeric"
                          value={totalPointsText}
                          onChange={(e) => setTotalPointsText(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          aria-invalid={!pointsValid || undefined}
                          className={`w-16 rounded-[--radius-sm] border bg-bg-base px-2 py-1 text-right font-mono text-sm font-semibold tabular-nums text-text-primary focus:border-primary focus:outline-none ${
                            pointsValid ? "border-border-light" : "border-[color:var(--color-error)]"
                          }`}
                        />
                        points
                      </label>
                      <p className="mt-1 text-xs text-text-muted">
                        Split evenly across its problems. You can change any
                        problem&apos;s points once they&apos;re made.
                      </p>
                    </div>
                    {/* GradingSetupCard owns its own card chrome; -mt
                        pulls it tight under the helper line. */}
                    <div className="-mt-2">
                      <GradingSetupCard
                        rubric={rubric}
                        saveState="idle"
                        saveError={null}
                        onChange={onChangeRubric}
                        courseId={courseId}
                        // Leaving for settings would discard this unsaved
                        // wizard — no link out from inside it.
                        linkToClassRubric={false}
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
                    hasRubric={hasRubricText(rubric)}
                    totalPoints={totalPoints}
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
                disabled={busy || !detailsValid || !pointsValid}
                title={
                  !detailsValid
                    ? "Add a title and a unit first"
                    : !pointsValid
                      ? `Set the points to a whole number from 1 to ${MAX_TOTAL_POINTS} first`
                      : "Create the draft and finish setup later"
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
                disabled={busy || (step === 1 && !detailsValid) || (step === 3 && !pointsValid)}
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
      {confirmingDiscard && (
        <DiscardConfirmDialog
          onKeepEditing={() => setConfirmingDiscard(false)}
          onDiscard={() => {
            setConfirmingDiscard(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

