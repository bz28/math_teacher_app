"use client";

import { useEffect, useMemo, useState } from "react";
import {
  teacher,
  type TeacherAssignment,
  type TeacherDocument,
} from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import {
  AssignmentDetailsStep,
  AssignmentProblemsStep,
} from "./assignment-wizard-steps";

/**
 * Wizard for creating a new Practice assignment.
 *
 * Step 1 — Source:
 *   - "Clone from a homework" (default) → pick an existing HW in the
 *     course, submit, go straight to the review queue. The clone
 *     endpoint fans out one 1:1 variation job per source problem.
 *   - "Start from scratch" → fall through to the standard Details +
 *     Problems flow (reusing AssignmentDetailsStep/ProblemsStep).
 *
 * Step 2 (scratch only) — Details:  title, units, due, late policy, sections
 * Step 3 (scratch only) — Problems: count, focus hint, source docs
 *
 * Creating either way calls the existing create-assignment + generate
 * infrastructure; only the source step is new.
 */

type SourceMode = "clone" | "scratch";
type Step = 1 | 2 | 3;

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

  // ── Step 1 state (clone-mode only) ──
  const [hws, setHws] = useState<TeacherAssignment[]>([]);
  const [hwsLoaded, setHwsLoaded] = useState(false);
  const [selectedHwId, setSelectedHwId] = useState<string>("");

  // ── Step 2 state (scratch mode) ──
  const [title, setTitle] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>(defaultUnitIds);
  const [dueAt, setDueAt] = useState<string>("");
  const [latePolicy, setLatePolicy] = useState<string>("none");
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
      late_policy: latePolicy,
      ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
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
      } catch {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        // Same close-guard as the HW modal — block while an upload is
        // in flight (failed rows are inert so they don't block).
        if (!busy && !uploads.hasInflightUploads) onClose();
      }}
    >
      <div
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
            onClick={onClose}
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
              onSelectedHwIdChange={setSelectedHwId}
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
              dueAt={dueAt}
              onDueAtChange={setDueAt}
              latePolicy={latePolicy}
              onLatePolicyChange={setLatePolicy}
              sectionIds={sectionIds}
              onSectionIdsChange={setSectionIds}
              disabled={busy}
              titlePlaceholder="e.g. Quadratics Practice"
              sectionsHint="You can add these later. Publishing requires at least one section."
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

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3">
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
                  (sourceMode === "clone" && (!hwsLoaded || !selectedHwId))
                }
                className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
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
                className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
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
                  className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create & generate"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
  disabled,
}: {
  sourceMode: SourceMode;
  onSourceModeChange: (v: SourceMode) => void;
  hws: TeacherAssignment[];
  hwsLoaded: boolean;
  selectedHwId: string;
  onSelectedHwIdChange: (v: string) => void;
  disabled: boolean;
}) {
  const noClonableHw = hwsLoaded && hws.length === 0;
  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Practice sets are ungraded — students use them to study. You can
        clone from an existing homework (one variation per problem) or
        start from a blank set.
      </p>

      <SourceOption
        active={sourceMode === "clone"}
        disabled={disabled || noClonableHw}
        onSelect={() => onSourceModeChange("clone")}
        label="Clone from a homework"
        description="Inherit the title and generate one similar problem for each HW question."
      >
        {sourceMode === "clone" && (
          <>
            {!hwsLoaded ? (
              <p className="mt-3 text-[11px] text-text-muted">Loading…</p>
            ) : noClonableHw ? (
              <p className="mt-3 text-[11px] text-text-muted">
                No homework with problems yet. Create one first, or start
                this practice from scratch.
              </p>
            ) : (
              <select
                value={selectedHwId}
                onChange={(e) => onSelectedHwIdChange(e.target.value)}
                disabled={disabled}
                aria-label="Source homework"
                className="mt-3 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
              >
                {hws.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title} · {h.problem_count}{" "}
                    {h.problem_count === 1 ? "problem" : "problems"}
                    {h.status !== "published" ? " (draft)" : ""}
                  </option>
                ))}
              </select>
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
  return (
    <label
      className={`block cursor-pointer rounded-[--radius-md] border p-4 transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : "border-border-light hover:border-border"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
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
          {children}
        </div>
      </div>
    </label>
  );
}
