"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherDocument } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { UnitMultiSelect } from "./unit-multi-select";
import { SectionMultiSelect } from "./section-multi-select";

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

const LATE_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "penalty_per_day", label: "10% per day" },
  { value: "no_credit", label: "No credit after due" },
];

const QUANTITY_CHIPS = [5, 10, 15, 20] as const;

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
  /** Fired with the newly-created HW id after a successful create (+
   *  optional gen kickoff). Parent is expected to navigate into the
   *  HW detail page. */
  onCreated: (newAssignmentId: string) => void;
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
      onCreated(id);
    });

  const onCreateAndGenerate = () =>
    run(async () => {
      const id = await createDraft();
      // Fire-and-forget: the job runs server-side regardless of the
      // client. The resume-queue banner on the HW detail page surfaces
      // pending questions back to the teacher.
      try {
        const job = await teacher.generateBank(courseId, {
          count,
          assignment_id: id,
          unit_id: unitIds[0],
          document_ids: Array.from(selectedDocs),
          constraint: topicHint.trim() || null,
        });
        // One-shot handoff so the HW detail page can pick up the job
        // and poll it. Without this, the detail page has no idea
        // generation is in flight and can't auto-open the review
        // queue when it completes. Keyed by HW id so two concurrent
        // creates don't clobber each other.
        sessionStorage.setItem(`hw-gen-${id}`, job.id);
      } catch {
        // Swallow — the HW itself was created; a failed gen kickoff
        // shouldn't block the teacher from landing on the detail page.
        // They can retry from the HW page via "Generate more".
      }
      onCreated(id);
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
            <Step1
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
            />
          ) : (
            <Step2
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

// ────────────────────────────────────────────────────────────────────
// Step 1 — Details
// ────────────────────────────────────────────────────────────────────

function Step1({
  title,
  onTitleChange,
  courseId,
  unitIds,
  onUnitIdsChange,
  dueAt,
  onDueAtChange,
  latePolicy,
  onLatePolicyChange,
  sectionIds,
  onSectionIdsChange,
  disabled,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  courseId: string;
  unitIds: string[];
  onUnitIdsChange: (v: string[]) => void;
  dueAt: string;
  onDueAtChange: (v: string) => void;
  latePolicy: string;
  onLatePolicyChange: (v: string) => void;
  sectionIds: string[];
  onSectionIdsChange: (v: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-bold text-text-primary">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          autoFocus
          maxLength={300}
          placeholder="e.g. Quadratics HW #1"
          disabled={disabled}
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Units <span className="font-normal text-text-muted">· required</span>
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          Pick one. Multi-select for midterms or review HWs that span topics.
        </p>
        <div className="mt-2">
          <UnitMultiSelect
            courseId={courseId}
            selected={unitIds}
            onChange={onUnitIdsChange}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-bold text-text-primary">
            Due date <span className="font-normal text-text-muted">· optional</span>
          </label>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => onDueAtChange(e.target.value)}
            disabled={disabled}
            className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-text-primary">Late policy</label>
          <select
            value={latePolicy}
            onChange={(e) => onLatePolicyChange(e.target.value)}
            disabled={disabled}
            className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
          >
            {LATE_POLICY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Sections <span className="font-normal text-text-muted">· optional</span>
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          You can add these later. Publishing requires at least one section.
        </p>
        <div className="mt-2">
          <SectionMultiSelect
            courseId={courseId}
            selected={sectionIds}
            onChange={onSectionIdsChange}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Step 2 — Problems
// ────────────────────────────────────────────────────────────────────

function Step2({
  count,
  onCountChange,
  topicHint,
  onTopicHintChange,
  docs,
  docsLoaded,
  selectedDocs,
  onToggleDoc,
  disabled,
}: {
  count: number;
  onCountChange: (v: number) => void;
  topicHint: string;
  onTopicHintChange: (v: string) => void;
  docs: TeacherDocument[];
  docsLoaded: boolean;
  selectedDocs: Set<string>;
  onToggleDoc: (id: string) => void;
  disabled: boolean;
}) {
  // Local draft for the count input so the teacher can transiently
  // clear the field (e.g. to delete "5" and type "12") without the
  // controlled `value={count}` snapping back to 5 mid-edit. We commit
  // to the parent whenever the draft parses to a valid number, and
  // fall back to the last committed count on blur if the field is
  // left empty.
  const [countDraft, setCountDraft] = useState(String(count));
  useEffect(() => {
    setCountDraft(String(count));
  }, [count]);

  const clamp = (v: number) => Math.min(50, Math.max(1, Math.round(v)));

  const handleCountChange = (raw: string) => {
    setCountDraft(raw);
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) {
      onCountChange(clamp(v));
    }
  };

  const handleCountBlur = () => {
    const v = parseInt(countDraft, 10);
    if (Number.isNaN(v)) {
      setCountDraft(String(count));
    } else {
      setCountDraft(String(clamp(v)));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-text-muted">
          Tell the AI how many problems and any context from your uploaded
          materials. Skip to create an empty draft you can fill in later.
        </p>
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">How many problems?</label>
        <div className="mt-2 flex items-center gap-2">
          {QUANTITY_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onCountChange(n)}
              disabled={disabled}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                count === n
                  ? "bg-primary text-white"
                  : "bg-bg-subtle text-text-primary hover:bg-bg-base"
              } disabled:opacity-50`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            value={countDraft}
            min={1}
            max={50}
            onChange={(e) => handleCountChange(e.target.value)}
            onBlur={handleCountBlur}
            disabled={disabled}
            className="w-20 rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Topic hint <span className="font-normal text-text-muted">· optional</span>
        </label>
        <input
          type="text"
          value={topicHint}
          onChange={(e) => onTopicHintChange(e.target.value)}
          placeholder="e.g. Focus on word problems with real-world contexts"
          disabled={disabled}
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Source material <span className="font-normal text-text-muted">· optional</span>
        </label>
        {!docsLoaded ? (
          <p className="mt-2 text-[11px] text-text-muted">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="mt-2 text-[11px] text-text-muted">
            No documents in this course. Upload images in the Materials tab to
            ground generated problems in your own content.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {docs.map((d) => {
              const on = selectedDocs.has(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onToggleDoc(d.id)}
                  disabled={disabled}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    on
                      ? "bg-primary text-white"
                      : "bg-bg-subtle text-text-primary hover:bg-bg-base"
                  } disabled:opacity-50`}
                >
                  {d.filename}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
