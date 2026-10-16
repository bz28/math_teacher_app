"use client";

import { useEffect, useMemo, useState } from "react";
import {
  teacher,
  EntitlementError,
  type TeacherAssignment,
  type TeacherDocument,
} from "@/lib/api";
import { Select } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { useDialogDismiss } from "@/hooks/use-dialog-dismiss";
import {
  AssignmentDetailsStep,
  AssignmentProblemsStep,
} from "./assignment-wizard-steps";

/**
 * Wizard for creating a new Practice assignment.
 *
 * Step 1 — Source:
 *   - "Clone from a homework" (default) → pick an existing HW, the
 *     problems to practice and how many versions of each, submit, go
 *     straight to the set's page. The clone endpoint fans out one
 *     generation job per picked problem.
 *   - "Start from scratch" → fall through to the standard Details +
 *     Problems flow (reusing AssignmentDetailsStep/ProblemsStep).
 *
 * Step 2 (scratch only) — Details:  title, units, sections (practice
 *   has no due date or late policy)
 * Step 3 (scratch only) — Problems: count, focus hint, source docs
 *
 * Creating either way calls the existing create-assignment + generate
 * infrastructure; only the source step is new.
 */

type SourceMode = "clone" | "scratch";
type Step = 1 | 2 | 3;
type HwProblem = { bank_item_id: string; position: number; question: string };

/** Versions written per cloned problem; each waits on the teacher's approval. */
const VERSION_CHOICES = [1, 3, 5] as const;

export function NewPracticeModal({
  courseId,
  defaultUnitIds = [],
  onClose,
  onCreated,
}: {
  courseId: string;
  defaultUnitIds?: string[];
  onClose: () => void;
  /** Fired after a successful create. `startedGeneration=true` routes
   *  the teacher into the review queue (skeleton state covers the
   *  wait); false routes to the practice detail page. */
  onCreated: (
    newAssignmentId: string,
    opts: { startedGeneration: boolean },
  ) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [sourceMode, setSourceMode] = useState<SourceMode>("clone");
  const { busy, error, setError, run } = useAsyncAction();
  const { showUpgrade, UpgradeModal, isUpgradeOpen } = useUpgradePrompt();

  // ── Step 1 state (clone-mode only) ──
  const [hws, setHws] = useState<TeacherAssignment[]>([]);
  const [hwsLoaded, setHwsLoaded] = useState(false);
  const [selectedHwId, setSelectedHwId] = useState<string>("");
  // The picked homework's problems (null while loading) and which of
  // them to practice — every one by default.
  const [hwProblems, setHwProblems] = useState<HwProblem[] | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [versions, setVersions] = useState<number>(VERSION_CHOICES[0]);

  // ── Step 2 state (scratch mode) ──
  const [title, setTitle] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>(defaultUnitIds);
  const [sectionIds, setSectionIds] = useState<string[]>([]);

  // ── Step 3 state (scratch mode) ──
  const [count, setCount] = useState<number>(10);
  const [topicHint, setTopicHint] = useState("");
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  // Inline document uploads. Same lifted-state rationale as the HW
  // modal. Uploads land in the first picked unit (Step 1 requires ≥1).
  const uploads = useDocumentUploads({
    courseId,
    getUnitId: () => unitIds[0] ?? "",
    setDocs,
    setSelectedDocs,
  });

  // Load available HWs for the clone dropdown on first step-1 mount.
  // Preselect within the *cloneable* subset (problem_count > 0) so the
  // dropdown's visible options can't diverge from state.
  useEffect(() => {
    if (hwsLoaded) return;
    teacher
      .assignments(courseId)
      .then((r) => {
        const onlyHw = r.assignments.filter((a) => a.type === "homework");
        setHws(onlyHw);
        const pickable = onlyHw.filter((h) => (h.problem_count ?? 0) > 0);
        const firstPublished = pickable.find((a) => a.status === "published");
        const first = firstPublished ?? pickable[0] ?? null;
        if (first) {
          setSelectedHwId(first.id);
        } else {
          // No cloneable HW exists — flip to scratch so the modal
          // isn't stuck in a disabled clone step on open.
          setSourceMode("scratch");
        }
      })
      .catch(() => {
        // Non-fatal — teacher can switch to scratch mode.
      })
      .finally(() => setHwsLoaded(true));
  }, [courseId, hwsLoaded]);

  // Load the picked homework's problems for the checklist.
  useEffect(() => {
    if (!selectedHwId) return;
    let cancelled = false;
    teacher
      .assignment(selectedHwId)
      .then((a) => {
        if (cancelled) return;
        const content = a.content as { problems?: HwProblem[] } | null;
        const problems = content?.problems ?? [];
        setHwProblems(problems);
        setPickedIds(new Set(problems.map((p) => p.bank_item_id)));
      })
      .catch(() => {
        if (!cancelled) setHwProblems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHwId]);

  // Load docs only when the teacher enters the scratch-problems step.
  useEffect(() => {
    if (step !== 3 || docsLoaded) return;
    teacher
      .documents(courseId)
      .then((r) => setDocs(r.documents))
      .catch(() => {
        // Non-fatal — docs are optional context for generation.
      })
      .finally(() => setDocsLoaded(true));
  }, [step, docsLoaded, courseId]);

  const cloneable = useMemo(
    () => hws.filter((h) => (h.problem_count ?? 0) > 0),
    [hws],
  );

  const validateDetails = (): string | null => {
    if (!title.trim()) return "Title is required";
    if (unitIds.length === 0) return "Pick at least one unit";
    return null;
  };

  // ── Flow control ──

  const onStep1Continue = () => {
    if (sourceMode === "clone") {
      if (!selectedHwId) {
        setError("Pick a homework to clone");
        return;
      }
      setError(null);
      // Clone path is terminal on step 1 — submit now.
      void runClone();
      return;
    }
    setError(null);
    setStep(2);
  };

  const onStep2Continue = () => {
    const v = validateDetails();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setStep(3);
  };

  const runClone = () =>
    run(async () => {
      const resp = await teacher.cloneHomeworkAsPractice(
        courseId,
        selectedHwId,
        { item_ids: [...pickedIds], count: versions },
      );
      // Stash every job id so the editor's hero count reflects the
      // full clone fan-out (one job per source problem) rather than
      // just the first job's count. Keyed by the new practice
      // assignment id so concurrent clones don't clobber.
      if (resp.job_ids.length > 0) {
        sessionStorage.setItem(
          `hw-gen-${resp.id}`,
          JSON.stringify(resp.job_ids),
        );
      }
      onCreated(resp.id, { startedGeneration: resp.job_ids.length > 0 });
    });

  const createDraft = async (): Promise<string> => {
    const created = await teacher.createAssignment(courseId, {
      title: title.trim(),
      type: "practice",
      unit_ids: unitIds,
    });
    if (sectionIds.length > 0) {
      try {
        await teacher.assignToSections(created.id, sectionIds);
      } catch {
        // Non-fatal — teacher adds sections manually on detail page.
      }
    }
    return created.id;
  };

  const onSkip = () =>
    run(async () => {
      const id = await createDraft();
      onCreated(id, { startedGeneration: false });
    });

  const onCreateAndGenerate = () =>
    run(async () => {
      const id = await createDraft();
      let startedGeneration = true;
      try {
        const job = await teacher.generateBank(courseId, {
          count,
          assignment_id: id,
          unit_id: unitIds[0],
          document_ids: Array.from(selectedDocs),
          constraint: topicHint.trim() || null,
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
            // Non-fatal.
          }
          showUpgrade(e.entitlement, e.message);
          return;
        }
        startedGeneration = false;
      }
      onCreated(id, { startedGeneration });
    });

  // ── Header label for the current step ──
  const stepLabel =
    step === 1
      ? "Source"
      : step === 2
        ? "Details"
        : "Problems";
  const totalSteps = sourceMode === "clone" ? 1 : 3;

  // Backdrop / Escape suppressed together while a request or upload is
  // mid-flight so a stray dismiss can't orphan an in-flight create.
  const dismissible = !busy && !uploads.hasInflightUploads;
  // Suppress Escape-to-close while the upgrade prompt is stacked on top,
  // so Escape dismisses only the prompt — not the whole wizard.
  const { panelRef, requestClose } = useDialogDismiss({
    onClose,
    dismissible: dismissible && !isUpgradeOpen,
  });

  // Why the step-1 clone action is disabled, surfaced inline beside it.
  // Steps 2–3 validate on click (so their buttons aren't pre-disabled),
  // and a still-loading list isn't worth a line.
  const blockReason =
    busy || step !== 1 || sourceMode !== "clone" || !hwsLoaded
      ? null
      : !selectedHwId
        ? "Pick a homework to clone"
        : hwProblems && pickedIds.size === 0
          ? "Pick at least one problem"
          : null;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--color-overlay)] p-4 backdrop-blur-sm"
      onClick={() => {
        // Same close-guard as the HW modal — `requestClose` no-ops while
        // an upload is in flight (failed rows are inert so they don't block).
        requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="New practice"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-text-primary">
              New Practice
            </h2>
            {/* Wizard chrome only makes sense for the multi-step path —
                clone is single-screen, so the counter would always read
                "Step 1 of 1" and look broken. */}
            {totalSteps > 1 && (
              <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] font-semibold text-text-muted">
                Step {step} of {totalSteps} · {stepLabel}
              </span>
            )}
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

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <SourceStep
              sourceMode={sourceMode}
              onSourceModeChange={setSourceMode}
              hws={cloneable}
              hwsLoaded={hwsLoaded}
              selectedHwId={selectedHwId}
              onSelectedHwIdChange={(id) => {
                // Skeleton until the new homework's problems load.
                setHwProblems(null);
                setSelectedHwId(id);
              }}
              hwProblems={hwProblems}
              pickedIds={pickedIds}
              onTogglePicked={(id) =>
                setPickedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              versions={versions}
              onVersionsChange={setVersions}
              disabled={busy}
            />
          )}
          {step === 2 && (
            <AssignmentDetailsStep
              title={title}
              onTitleChange={setTitle}
              courseId={courseId}
              unitIds={unitIds}
              onUnitIdsChange={setUnitIds}
              sectionIds={sectionIds}
              onSectionIdsChange={setSectionIds}
              disabled={busy}
              titlePlaceholder="e.g. Quadratics Practice"
              sectionsHint="Leave empty to share with every section when you publish."
            />
          )}
          {step === 3 && (
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
              helperText="Tell the AI how many problems and any context from your uploaded materials. Skip to create an empty draft you can fill in later."
            />
          )}

        </div>

        {/* Pinned message row — keeps the submit error (which used to
            render at the bottom of the scrollable body, below the fold)
            and the why-disabled reason in view above the actions. */}
        {(error || blockReason) && (
          <div
            id="practice-wizard-msg"
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
          {step === 1 ? (
            <>
              {/* Step counter only when there's more than one step.
                  Empty span keeps justify-between alignment so the
                  primary action stays right-anchored. */}
              {totalSteps > 1 ? (
                <span className="text-xs text-text-muted">
                  Step 1 of {totalSteps}
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={onStep1Continue}
                disabled={
                  busy ||
                  (sourceMode === "clone" &&
                    (!hwsLoaded ||
                      !selectedHwId ||
                      hwProblems === null ||
                      pickedIds.size === 0))
                }
                aria-describedby={blockReason ? "practice-wizard-msg" : undefined}
                className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted disabled:opacity-100"
              >
                {busy
                  ? "Creating…"
                  : sourceMode === "clone"
                    ? "Clone & generate"
                    : "Continue →"}
              </button>
            </>
          ) : step === 2 ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep(1);
                }}
                disabled={busy}
                className="text-xs font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={onStep2Continue}
                disabled={busy}
                className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted disabled:opacity-100"
              >
                Continue →
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep(2);
                }}
                disabled={busy}
                className="text-xs font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                ← Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onSkip}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-border-light bg-bg-base px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={onCreateAndGenerate}
                  disabled={busy}
                  className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted disabled:opacity-100"
                >
                  {busy ? "Creating…" : "Create & generate"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    {UpgradeModal}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Step 1 — Source (clone vs scratch)
// ────────────────────────────────────────────────────────────────────

function SourceStep({
  sourceMode,
  onSourceModeChange,
  hws,
  hwsLoaded,
  selectedHwId,
  onSelectedHwIdChange,
  hwProblems,
  pickedIds,
  onTogglePicked,
  versions,
  onVersionsChange,
  disabled,
}: {
  sourceMode: SourceMode;
  onSourceModeChange: (v: SourceMode) => void;
  hws: TeacherAssignment[];
  hwsLoaded: boolean;
  selectedHwId: string;
  onSelectedHwIdChange: (v: string) => void;
  hwProblems: HwProblem[] | null;
  pickedIds: Set<string>;
  onTogglePicked: (id: string) => void;
  versions: number;
  onVersionsChange: (n: number) => void;
  disabled: boolean;
}) {
  const noClonableHw = hwsLoaded && hws.length === 0;
  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Practice sets are ungraded — students use them to study. You can
        write new versions of a homework&rsquo;s problems or start from a
        blank set.
      </p>

      <SourceOption
        active={sourceMode === "clone"}
        disabled={disabled || noClonableHw}
        onSelect={() => onSourceModeChange("clone")}
        label="Clone from a homework"
        description="Pick the problems to practice; the AI writes new versions of each for you to approve."
      >
        {sourceMode === "clone" && (
          <>
            {!hwsLoaded ? (
              <Skeleton className="mt-3 h-9 w-full rounded-[--radius-md]" />
            ) : noClonableHw ? (
              <p className="mt-3 text-[11px] text-text-muted">
                No homework with problems yet. Create one first, or start
                this practice from scratch.
              </p>
            ) : (
              <>
                <Select
                  value={selectedHwId}
                  onChange={(e) => onSelectedHwIdChange(e.target.value)}
                  disabled={disabled}
                  aria-label="Source homework"
                  className="mt-3 w-full"
                >
                  {hws.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.title} · {h.problem_count}{" "}
                      {h.problem_count === 1 ? "problem" : "problems"}
                      {h.status !== "published" ? " (draft)" : ""}
                    </option>
                  ))}
                </Select>
                <ProblemPicker
                  problems={hwProblems}
                  pickedIds={pickedIds}
                  onToggle={onTogglePicked}
                  versions={versions}
                  onVersionsChange={onVersionsChange}
                  disabled={disabled}
                />
              </>
            )}
          </>
        )}
      </SourceOption>

      <SourceOption
        active={sourceMode === "scratch"}
        disabled={disabled}
        onSelect={() => onSourceModeChange("scratch")}
        label="Start from scratch"
        description="Author a new practice set with your own title, units, and generated problems."
      />
    </div>
  );
}

/** Which of the homework's problems to practice, and versions of each. */
function ProblemPicker({
  problems,
  pickedIds,
  onToggle,
  versions,
  onVersionsChange,
  disabled,
}: {
  problems: HwProblem[] | null;
  pickedIds: Set<string>;
  onToggle: (id: string) => void;
  versions: number;
  onVersionsChange: (n: number) => void;
  disabled: boolean;
}) {
  if (problems === null) {
    return <Skeleton className="mt-3 h-24 w-full rounded-[--radius-md]" />;
  }
  return (
    <div className="mt-3">
      <ul className="max-h-56 divide-y divide-border-light overflow-y-auto rounded-[--radius-md] border border-border-light bg-bg-base">
        {problems.map((p) => (
          <li key={p.bank_item_id}>
            <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={pickedIds.has(p.bank_item_id)}
                onChange={() => onToggle(p.bank_item_id)}
                disabled={disabled}
                className="mt-0.5"
              />
              <span className="w-5 shrink-0 font-semibold tabular-nums text-text-muted">
                {p.position}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">
                <MathText text={p.question} />
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div
        role="group"
        aria-label="Versions of each problem"
        className="mt-3 flex items-center gap-1.5"
      >
        <span className="mr-1 text-xs text-text-muted">Versions of each</span>
        {VERSION_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={versions === n}
            onClick={() => onVersionsChange(n)}
            disabled={disabled}
            className={`h-7 w-7 rounded-[--radius-pill] border text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              versions === n
                ? "border-primary bg-primary text-white"
                : "border-border-light text-text-secondary hover:border-primary/40"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function SourceOption({
  active,
  disabled,
  onSelect,
  label,
  description,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  label: string;
  description: string;
  children?: React.ReactNode;
}) {
  // Only the radio row is a <label>: the picker below holds its own
  // checkboxes, and labels can't nest.
  return (
    <div
      className={`rounded-[--radius-md] border p-4 transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : "border-border-light hover:border-border"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <label
        className={`flex items-start gap-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <input
          type="radio"
          checked={active}
          onChange={onSelect}
          disabled={disabled}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-text-primary">{label}</div>
          <p className="mt-0.5 text-xs text-text-muted">{description}</p>
        </div>
      </label>
      {children && <div className="pl-7">{children}</div>}
    </div>
  );
}
