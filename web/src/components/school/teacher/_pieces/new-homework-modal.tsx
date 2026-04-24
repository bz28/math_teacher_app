"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherDocument } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import {
  AssignmentDetailsStep,
  AssignmentProblemsStep,
} from "./assignment-wizard-steps";

/**
 * Two-step wizard for creating a draft homework.
 *
 *   Step 1 — Details:  title, unit(s), due date, late policy, sections
 *   Step 2 — Problems: count, source material (optional), topic hint.
 *                      Two buttons:
 *                        - Create & generate  → kicks off a bank gen
 *                          job for the HW's first unit, then opens the
 *                          HW detail page.
 *                        - Skip for now       → creates an empty draft
 *                          and opens the HW detail page.
 *
 * Generation kicks off as a fire-and-forget background job. The resume-
 * queue banner + per-HW generation UX lands in Feature 6 on the HW
 * detail page.
 */

type Step = 1 | 2;

export function NewHomeworkModal({
  courseId,
  defaultUnitIds = [],
  onClose,
  onCreated,
}: {
  courseId: string;
  /** Pre-select these units (e.g. the unit currently filtered in the
   *  HW list). Teacher can change the selection. */
  defaultUnitIds?: string[];
  onClose: () => void;
  /** Fired with the newly-created HW id after a successful create.
   *  `startedGeneration` lets the parent route "Create & generate"
   *  straight to the review queue (its skeleton state handles the
   *  wait) and "Skip for now" to the HW detail page. */
  onCreated: (
    newAssignmentId: string,
    opts: { startedGeneration: boolean },
  ) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const { busy, error, setError, run } = useAsyncAction();

  // ── Step 1 state ──
  const [title, setTitle] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>(defaultUnitIds);
  const [dueAt, setDueAt] = useState<string>(""); // datetime-local
  const [latePolicy, setLatePolicy] = useState<string>("none");
  const [sectionIds, setSectionIds] = useState<string[]>([]);

  // ── Step 2 state ──
  const [count, setCount] = useState<number>(10);
  const [topicHint, setTopicHint] = useState("");
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (step !== 2 || docsLoaded) return;
    teacher
      .documents(courseId)
      .then((r) => setDocs(r.documents))
      .catch(() => {
        // Non-fatal — docs are optional context for generation.
      })
      .finally(() => setDocsLoaded(true));
  }, [step, docsLoaded, courseId]);

  const validateStep1 = (): string | null => {
    if (!title.trim()) return "Title is required";
    if (unitIds.length === 0) return "Pick at least one unit";
    return null;
  };

  const onContinue = () => {
    const v = validateStep1();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setStep(2);
  };

  const createDraft = async (): Promise<string> => {
    const created = await teacher.createAssignment(courseId, {
      title: title.trim(),
      type: "homework",
      unit_ids: unitIds,
      late_policy: latePolicy,
      ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
    });
    // Section assignment is a separate call. Once the HW itself
    // exists, a section failure shouldn't block the teacher from
    // landing on the detail page — otherwise a retry would double-
    // create the HW. Sections are editable inline from the detail
    // view so the teacher has a clean recovery path either way.
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
      // Fire-and-forget: the job runs server-side regardless of the
      // client. The teacher routes straight to the review queue —
      // its skeleton state covers the wait, and items appear as soon
      // as they land.
      let startedGeneration = true;
      try {
        const job = await teacher.generateBank(courseId, {
          count,
          assignment_id: id,
          unit_id: unitIds[0],
          document_ids: Array.from(selectedDocs),
          constraint: topicHint.trim() || null,
        });
        // Stash the job id so the HW detail page can show a "still
        // generating" indicator if the teacher navigates there from
        // /review while the job's in flight. Keyed by HW id so
        // concurrent creates don't clobber.
        sessionStorage.setItem(`hw-gen-${id}`, job.id);
      } catch {
        // If the kickoff failed, route the teacher to the HW detail
        // page where they can retry via "Generate more" — otherwise
        // they'd stare at an empty review queue that never fills.
        startedGeneration = false;
      }
      onCreated(id, { startedGeneration });
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        // Ignore backdrop clicks while a create is in-flight —
        // otherwise the modal unmounts mid-request and we orphan
        // whatever the server already persisted.
        if (!busy) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with step pill */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-text-primary">New Homework</h2>
            <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] font-semibold text-text-muted">
              Step {step} of 2 · {step === 1 ? "Details" : "Problems"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 ? (
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
              sectionsHint="You can add these later. Publishing requires at least one section."
            />
          ) : (
            <AssignmentProblemsStep
              count={count}
              onCountChange={setCount}
              topicHint={topicHint}
              onTopicHintChange={setTopicHint}
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
              disabled={busy}
              helperText="Tell the AI how many problems and any context from your uploaded materials. Skip to create an empty draft you can fill in later."
            />
          )}

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3">
          {step === 1 ? (
            <>
              <span className="text-xs text-text-muted">Step 1 of 2</span>
              <button
                type="button"
                onClick={onContinue}
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
                  setStep(1);
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

