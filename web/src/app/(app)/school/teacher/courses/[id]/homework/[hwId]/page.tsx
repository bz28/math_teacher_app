"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankItem,
  type BankJob,
  type SubmissionsInboxRow,
  type TeacherAssignment,
  type TeacherRubric,
} from "@/lib/api";
import {
  BANK_JOB_POLL_INTERVAL_MS,
  BANK_JOB_POLL_LIMIT_MS,
} from "@/lib/constants";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { UnitMultiSelect } from "@/components/school/teacher/_pieces/unit-multi-select";
import { SectionMultiSelect } from "@/components/school/teacher/_pieces/section-multi-select";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";
import { GenerateQuestionsModal } from "@/components/school/teacher/question-bank/generate-questions-modal";
import { GradingSetupCard } from "@/components/school/teacher/_pieces/grading-setup-card";
import { WorkshopModal } from "@/components/school/teacher/workshop-modal";

interface AssignmentProblem {
  bank_item_id: string;
  position: number;
  question: string;
  solution_steps: { title: string; description: string }[] | null;
  final_answer: string | null;
  difficulty: string;
}

const LATE_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "penalty_per_day", label: "10% per day" },
  { value: "no_credit", label: "No credit after due" },
];

// The five inline-editable config fields. Each has its own SaveState
// so a saving units field doesn't block a separate due-date edit.
type ConfigField = "units" | "dueAt" | "latePolicy" | "sections" | "rubric";

/** Collapse a partial rubric into a normalized dict. Drops empty-string
 *  and whitespace-only values so the stored shape stays tight. */
function normalizeRubric(r: TeacherRubric): TeacherRubric {
  const out: TeacherRubric = {};
  const s = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  if (s(r.full_credit)) out.full_credit = s(r.full_credit);
  if (s(r.partial_credit)) out.partial_credit = s(r.partial_credit);
  if (s(r.common_mistakes)) out.common_mistakes = s(r.common_mistakes);
  if (s(r.notes)) out.notes = s(r.notes);
  return out;
}

/**
 * Full-page detail for a single homework. Handles all lifecycle
 * config (units, due date, late policy, sections, rubric) inline
 * with optimistic save, plus the problems list, publish/unpublish,
 * and Submissions drawer.
 *
 * Route: /school/teacher/courses/[id]/homework/[hwId]
 *
 * Navigating away (back link, delete) returns to the course HW tab.
 * The list over there self-refreshes on mount via its useEffect, so
 * edits made here are reflected when the teacher returns.
 */
export default function HomeworkDetailPage({
  params,
}: {
  params: Promise<{ id: string; hwId: string }>;
}) {
  const { id: courseId, hwId: assignmentId } = use(params);
  const router = useRouter();

  const [hw, setHw] = useState<
    (TeacherAssignment & { content: unknown; rubric: TeacherRubric | null }) | null
  >(null);
  const [loading, setLoading] = useState(true);
  // Back link points at whichever tab the assignment came from — HW
  // for type=homework, Practice for type=practice. Falls back to HW
  // while the assignment is still loading (matches prior behavior).
  const backHref =
    `/school/teacher/courses/${courseId}?tab=${
      hw?.type === "practice" ? "practice" : "homework"
    }`;
  const goBack = () => router.push(backHref);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingProblems, setEditingProblems] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Confirm dialog for "publish without due date" — common mistake we
  // catch with a soft confirm rather than blocking, because no-due-date
  // HWs are a real legitimate use case (in-class, untimed practice).
  const [confirmingNoDueDate, setConfirmingNoDueDate] = useState(false);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAsyncAction();

  // Resume-queue state: pending bank items for this HW. Powers the
  // "N pending problems" banner + the "Resume queue ▸" CTA that
  // navigates into the full-page approval queue.
  const [pending, setPending] = useState<BankItem[]>([]);
  // Submissions inbox rows for THIS HW only — populated when the HW is
  // published so the detail page can show "X of Y submitted · Z to
  // grade →". One row per section the HW reaches; null while loading
  // or when the HW is still a draft. The strip degrades silently if
  // the request fails — it's a convenience link, not core info.
  const [inboxRows, setInboxRows] = useState<SubmissionsInboxRow[] | null>(
    null,
  );
  const [showGenerate, setShowGenerate] = useState(false);
  // Polls bank jobs kicked off from the "Generate more" modal so the
  // pending-banner count updates live when generation completes.
  const [activeJob, setActiveJob] = useState<BankJob | null>(null);
  // Click-to-edit on an approved problem opens the workshop (single
  // mode) so the teacher can edit the question / chat with AI /
  // regenerate / make similar variations — all the affordances the
  // old Question Bank tab provided. Null = workshop closed.
  const [workshopItem, setWorkshopItem] = useState<BankItem | null>(null);
  const [workshopError, setWorkshopError] = useState<string | null>(null);

  const reviewHref = `/school/teacher/courses/${courseId}/homework/${assignmentId}/review`;

  const openWorkshopForProblem = async (bankItemId: string) => {
    setWorkshopError(null);
    try {
      // Pull the full BankItem from the per-HW pool so the workshop
      // has the chat thread, variations, etc. — the HW's content
      // snapshot only carries the visible fields.
      const res = await teacher.bank(courseId, { assignment_id: assignmentId });
      const item = res.items.find((i) => i.id === bankItemId);
      if (!item) {
        setWorkshopError("Couldn't load the problem. Try again.");
        return;
      }
      setWorkshopItem(item);
    } catch (e) {
      setWorkshopError(e instanceof Error ? e.message : "Failed to load problem");
    }
  };

  // Per-field save state for the inline-edited config block.
  const [saveStates, setSaveStates] = useState<Record<ConfigField, SaveState>>({
    units: "idle",
    dueAt: "idle",
    latePolicy: "idle",
    sections: "idle",
    rubric: "idle",
  });
  const [saveErrors, setSaveErrors] = useState<Record<ConfigField, string | null>>({
    units: null,
    dueAt: null,
    latePolicy: null,
    sections: null,
    rubric: null,
  });

  const reload = async () => {
    setLoading(true);
    try {
      const a = await teacher.assignment(assignmentId);
      setHw(a);
      setTitleDraft(a.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load homework");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  // Pick up any gen job the wizard kicked off for this HW. The wizard
  // stashes the job id in sessionStorage on "Create & generate"; if
  // the teacher navigates here from /review ("I'll wait on the
  // homework page"), we restore it so the existing polling effect
  // shows a generating indicator and refreshes pending on done.
  useEffect(() => {
    const key = `hw-gen-${assignmentId}`;
    const jobId = sessionStorage.getItem(key);
    if (!jobId) return;
    teacher
      .bankJob(courseId, jobId)
      .then((job) => {
        setActiveJob(job);
        // Done jobs: clear the key so a refresh after completion
        // doesn't re-trigger the lookup. In-flight jobs keep the
        // key around in case the teacher navigates away and back.
        if (job.status === "done" || job.status === "failed") {
          sessionStorage.removeItem(key);
        }
      })
      .catch(() => {
        // Stale key or deleted job — drop it and fall back to the
        // manual-banner UX.
        sessionStorage.removeItem(key);
      });
  }, [assignmentId, courseId]);

  // Fetch pending bank items for THIS HW specifically. The backend
  // filter on originating_assignment_id keeps the pool scoped so two
  // HWs in the same unit don't share their pending items.
  const reloadPending = async () => {
    try {
      const res = await teacher.bank(courseId, {
        status: "pending",
        assignment_id: assignmentId,
      });
      setPending(res.items);
    } catch {
      // Non-fatal — the banner just won't appear if this fails.
    }
  };

  useEffect(() => {
    reloadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  // Load submission inbox rows once the HW is published so the strip
  // can show submission counts. Fetches the course-level inbox and
  // filters client-side — there are typically only a few sections per
  // course so the extra rows don't matter, and we save a backend
  // endpoint just for this view. Re-fetched whenever the HW (un)pub
  // status flips.
  useEffect(() => {
    if (hw?.status !== "published") {
      setInboxRows(null);
      return;
    }
    let cancelled = false;
    teacher
      .submissionsInbox(courseId)
      .then((res) => {
        if (cancelled) return;
        setInboxRows(
          res.rows.filter((r) => r.assignment_id === assignmentId),
        );
      })
      .catch(() => {
        // Non-fatal — strip will simply not render.
      });
    return () => {
      cancelled = true;
    };
  }, [hw?.status, courseId, assignmentId]);

  // Poll any in-flight generation job so the banner updates when it
  // completes. Stops polling on done/failed or after a ceiling; same
  // pattern as the course workspace page's active-job polling.
  useEffect(() => {
    if (!activeJob || activeJob.status === "done" || activeJob.status === "failed") return;
    const startedAt = Date.now();
    const jobId = activeJob.id;
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > BANK_JOB_POLL_LIMIT_MS) {
        setActiveJob((j) => (j ? { ...j, status: "failed" } : j));
        return;
      }
      try {
        const updated = await teacher.bankJob(courseId, jobId);
        setActiveJob(updated);
        if (updated.status === "done") {
          await reloadPending();
        }
      } catch {
        // keep polling, transient errors are fine
      }
    }, BANK_JOB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, courseId]);

  const problems: AssignmentProblem[] =
    hw?.content && typeof hw.content === "object" && "problems" in hw.content
      ? ((hw.content as { problems: AssignmentProblem[] }).problems ?? [])
      : [];

  const isPublished = hw?.status === "published";

  const saveTitle = () =>
    run(async () => {
      const t = titleDraft.trim();
      if (!t) {
        setError("Title cannot be empty");
        return;
      }
      if (t === hw?.title) {
        setEditingTitle(false);
        return;
      }
      await teacher.updateAssignment(assignmentId, { title: t });
      setEditingTitle(false);
      await reload();
    });

  const saveProblems = (newPicked: string[]) =>
    run(async () => {
      if (newPicked.length === 0) {
        setError("Pick at least one question");
        return;
      }
      await teacher.updateAssignment(assignmentId, { bank_item_ids: newPicked });
      setEditingProblems(false);
      await reload();
    });

  const remove = () =>
    run(async () => {
      await teacher.deleteAssignment(assignmentId);
      goBack();
    });

  const publish = () =>
    run(async () => {
      await teacher.publishAssignment(assignmentId);
      setConfirmingNoDueDate(false);
      await reload();
    });

  // Click handler for the Publish button. If the HW has no due date,
  // intercept and show a soft confirm — most "no due date" publishes
  // are mistakes, but it IS a valid choice (in-class work, ongoing
  // practice). Click "Publish anyway" in the confirm to proceed.
  // Practice assignments have no due-date concept, so skip the
  // confirm and publish directly.
  const handlePublishClick = () => {
    if (hw && hw.type !== "practice" && hw.due_at === null) {
      setConfirmingNoDueDate(true);
      return;
    }
    publish();
  };

  const unpublish = () =>
    run(async () => {
      await teacher.unpublishAssignment(assignmentId);
      await reload();
    });

  // Inline auto-save runner. Optimistic — applies the change to the
  // local hw state immediately, fires the PATCH, and on failure
  // restores ONLY this field (via the caller-supplied applyRevert).
  //
  // Per-field revert (vs replacing the whole hw object) is important:
  // if two fields are edited concurrently and the second succeeds
  // before the first fails, a whole-hw revert would wipe out the
  // second's optimistic update. Field-scoped revert leaves the
  // unrelated success intact.
  //
  // Per-field lastCallRef gives last-write-wins for rapid-fire edits
  // to the same field (the date picker can fire many onChanges).
  const lastCallRef = useRef<Record<ConfigField, number>>({
    units: 0, dueAt: 0, latePolicy: 0, sections: 0, rubric: 0,
  });
  const patchField = async <K extends ConfigField>(
    field: K,
    applyOptimistic: () => void,
    applyRevert: () => void,
    request: () => Promise<void>,
  ) => {
    const callId = ++lastCallRef.current[field];
    applyOptimistic();
    setSaveStates((s) => ({ ...s, [field]: "saving" }));
    setSaveErrors((s) => ({ ...s, [field]: null }));
    try {
      await request();
      // If a newer call for this field superseded us, drop silently.
      if (lastCallRef.current[field] !== callId) return;
      setSaveStates((s) => ({ ...s, [field]: "saved" }));
    } catch (e) {
      if (lastCallRef.current[field] !== callId) return;
      applyRevert();
      setSaveStates((s) => ({ ...s, [field]: "error" }));
      setSaveErrors((s) => ({
        ...s,
        [field]: e instanceof Error ? e.message : "Save failed",
      }));
    }
  };

  const onChangeUnits = (next: string[]) => {
    if (!hw) return;
    if (next.length === 0) {
      setSaveStates((s) => ({ ...s, units: "error" }));
      setSaveErrors((s) => ({ ...s, units: "At least one unit is required" }));
      return;
    }
    const prev = hw.unit_ids;
    void patchField(
      "units",
      () => setHw((h) => (h ? { ...h, unit_ids: next } : h)),
      () => setHw((h) => (h ? { ...h, unit_ids: prev } : h)),
      () =>
        teacher.updateAssignment(assignmentId, { unit_ids: next }).then(() => undefined),
    );
  };

  const onChangeDueAt = (next: string | null) => {
    if (!hw) return;
    const prev = hw.due_at;
    void patchField(
      "dueAt",
      () => setHw((h) => (h ? { ...h, due_at: next } : h)),
      () => setHw((h) => (h ? { ...h, due_at: prev } : h)),
      () =>
        teacher
          .updateAssignment(
            assignmentId,
            next === null ? { clear_due_at: true } : { due_at: next },
          )
          .then(() => undefined),
    );
  };

  const onChangeLatePolicy = (next: string) => {
    if (!hw) return;
    const prev = hw.late_policy;
    void patchField(
      "latePolicy",
      () => setHw((h) => (h ? { ...h, late_policy: next } : h)),
      () => setHw((h) => (h ? { ...h, late_policy: prev } : h)),
      () =>
        teacher
          .updateAssignment(assignmentId, { late_policy: next })
          .then(() => undefined),
    );
  };

  const onChangeSections = (next: string[]) => {
    if (!hw) return;
    const prev = hw.section_ids;
    void patchField(
      "sections",
      () => setHw((h) => (h ? { ...h, section_ids: next } : h)),
      () => setHw((h) => (h ? { ...h, section_ids: prev } : h)),
      () => teacher.assignToSections(assignmentId, next).then(() => undefined),
    );
  };

  const onChangeRubric = (patch: Partial<TeacherRubric>) => {
    if (!hw) return;
    const prev = hw.rubric;
    const merged = normalizeRubric({ ...(prev ?? {}), ...patch });
    // No-op if nothing actually changed — prevents a save round-trip
    // when a textarea blurs with unchanged content.
    if (JSON.stringify(merged) === JSON.stringify(normalizeRubric(prev ?? {}))) return;
    // If the teacher cleared every field, null the server-side rubric
    // so it reflects "no rubric authored" rather than `{}` (which the
    // server happily persists but is semantically different).
    const empty = Object.keys(merged).length === 0;
    const next: TeacherRubric | null = empty ? null : merged;
    void patchField(
      "rubric",
      () => setHw((h) => (h ? { ...h, rubric: next } : h)),
      () => setHw((h) => (h ? { ...h, rubric: prev } : h)),
      () =>
        teacher
          .updateAssignment(
            assignmentId,
            empty ? { clear_rubric: true } : { rubric: merged },
          )
          .then(() => undefined),
    );
  };

  // Publish gating — list of missing requirements with concrete fixes.
  // Sections are NOT required: the backend fans out to every section
  // in the course when the teacher publishes with an empty list. The
  // picker is for exclusions ("Period 5 doesn't get this yet"), not
  // the happy path.
  const missingForPublish: string[] = [];
  if (hw) {
    if (problems.length === 0) missingForPublish.push("at least one problem");
    if (hw.unit_ids.length === 0) missingForPublish.push("a unit");
  }
  const canPublish = !isPublished && missingForPublish.length === 0;

  const activeGenerating =
    !!activeJob && activeJob.status !== "done" && activeJob.status !== "failed";

  return (
    <>
    {workshopItem && (
      <WorkshopModal
        item={workshopItem}
        onClose={() => setWorkshopItem(null)}
        onChanged={() => {
          // Live edits to a bank item propagate to the HW's rendered
          // content because the HW stores IDs and re-fetches the
          // item's text on load. Refetch the HW here so deletions
          // and status changes (unlikely but possible) are
          // reflected immediately.
          void reload();
        }}
      />
    )}
    {showGenerate && (
      <GenerateQuestionsModal
        courseId={courseId}
        assignmentId={assignmentId}
        onClose={() => setShowGenerate(false)}
        onStarted={(job) => {
          setActiveJob(job);
          setShowGenerate(false);
        }}
      />
    )}
    <div className="mx-auto max-w-4xl px-4 pb-10">
      {/* Breadcrumb */}
      <div className="pt-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← Back to {hw?.type === "practice" ? "practice" : "homework"}
        </Link>
      </div>

      {/* Hero header row: status + title + primary action (publish) */}
      <header className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          {hw && (
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  isPublished
                    ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-500/10 dark:text-gray-300"
                }`}
              >
                {hw.status}
              </span>
              {hw.type === "practice" && (
                <span className="inline-block rounded-[--radius-pill] bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  Practice
                </span>
              )}
            </div>
          )}
          <div className="mt-2">
            {editingTitle ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveTitle();
                }}
              >
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  autoFocus
                  maxLength={300}
                  className="flex-1 rounded-[--radius-md] border border-primary bg-bg-base px-3 py-2 text-xl font-extrabold text-text-primary focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTitle(false);
                    setTitleDraft(hw?.title ?? "");
                  }}
                  className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                disabled={loading || isPublished}
                title={isPublished ? "Unpublish to edit" : "Click to edit"}
                className="cursor-text text-left text-3xl font-extrabold tracking-tight text-text-primary hover:text-primary disabled:cursor-default disabled:hover:text-text-primary"
              >
                {hw?.title ?? "Loading…"}
              </button>
            )}
          </div>
        </div>

        {/* Publish / Unpublish lives alongside the title. Draft HWs
            show a disabled Publish with a tooltip listing what's still
            needed (e.g. "Missing: at least one problem"). */}
        {!editingProblems && hw && (
          <div className="flex shrink-0 items-center gap-2">
            {isPublished ? (
              <button
                type="button"
                onClick={unpublish}
                disabled={busy}
                className="rounded-[--radius-md] border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
              >
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePublishClick}
                disabled={busy || !canPublish}
                title={
                  canPublish
                    ? "Publish — locks the questions in the bank"
                    : `Missing: ${missingForPublish.join(", ")}`
                }
                className={`rounded-[--radius-md] px-5 py-2 text-sm font-bold text-white shadow-sm transition-all disabled:opacity-50 ${
                  canPublish
                    ? "bg-green-600 hover:bg-green-700 hover:shadow"
                    : "bg-gray-400 cursor-not-allowed dark:bg-gray-600"
                }`}
              >
                Publish ▸
              </button>
            )}
          </div>
        )}
      </header>

      {/* Soft confirm strip for "publish without a due date". Shown
          full-width below the header so it's hard to miss, and its
          CTAs pair with the already-noticed Publish button above.
          Never shows for practice — due dates don't apply there. */}
      {!editingProblems && hw && hw.type !== "practice" && confirmingNoDueDate && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[--radius-md] border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            ⚠ Publish without a due date? Students will see &ldquo;no due date&rdquo;.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingNoDueDate(false);
                setTimeout(() => {
                  dueDateInputRef.current?.focus();
                  dueDateInputRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }, 0);
              }}
              disabled={busy}
              className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              Add due date
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={busy}
              className="rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
            >
              Publish anyway
            </button>
          </div>
        </div>
      )}

      {/* Loading / editing-problems states short-circuit the page */}
      {(loading || !hw) ? (
        <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-sm">
          <p className="text-sm text-text-muted">Loading…</p>
        </div>
      ) : editingProblems ? (
        <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
          <RemoveProblemsView
            problems={problems}
            onCancel={() => setEditingProblems(false)}
            onSave={saveProblems}
            busy={busy}
          />
        </div>
      ) : (
        <>
          {isPublished && (
            <div className="mt-4 rounded-[--radius-md] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              🔒 Published — students can see this. Unpublish to edit the
              problem list or configuration.
            </div>
          )}

          {/* Submission summary — only shown for published HWs. Tells
              the teacher at a glance how many students have submitted
              and how many need grading, with a one-click jump to the
              grading queue. Multi-section HWs expand into an inline
              section picker rather than auto-pick a section. */}
          {isPublished && inboxRows && inboxRows.length > 0 && (
            <SubmissionStrip
              courseId={courseId}
              assignmentId={assignmentId}
              rows={inboxRows}
            />
          )}

          {/* Pending review is the primary CTA when generation produced
              anything. Solid amber-tinted card (no gradient — washes
              out the text) with high-contrast copy. */}
          {pending.length > 0 && (
            <Link
              href={reviewHref}
              className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-xl] border border-amber-300 bg-amber-50 px-5 py-4 shadow-sm transition-all hover:border-amber-400 hover:bg-amber-100 hover:shadow dark:border-amber-500/40 dark:bg-amber-500/10 dark:hover:bg-amber-500/20"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">🔔</span>
                <div>
                  <p className="text-sm font-bold text-text-primary">
                    {pending.length} {pending.length === 1 ? "problem" : "problems"} {pending.length === 1 ? "needs" : "need"} your review
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Approve to add them to this homework, reject to drop them.
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-[--radius-md] bg-amber-600 px-4 py-2 text-xs font-bold text-white">
                Review ▸
              </span>
            </Link>
          )}

          {/* Problems — the hero of the page */}
          <section className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-border-light pb-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
                  Problems
                </h2>
                <p className="mt-0.5 text-2xl font-extrabold text-text-primary">
                  {problems.length}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGenerate(true)}
                  disabled={isPublished}
                  title={isPublished ? "Unpublish to generate more" : "Generate with AI"}
                  className="rounded-[--radius-md] border border-primary/40 bg-primary-bg/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary-bg/60 disabled:opacity-50"
                >
                  ✨ Generate more
                </button>
                <button
                  type="button"
                  onClick={() => setEditingProblems(true)}
                  disabled={isPublished || problems.length === 0}
                  title={
                    isPublished
                      ? "Unpublish to remove problems"
                      : problems.length === 0
                        ? "Nothing to remove"
                        : "Remove problems from this homework in bulk"
                  }
                  className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-red-300 hover:text-red-600 disabled:opacity-50 disabled:hover:border-border-light disabled:hover:text-text-secondary"
                >
                  Remove problems
                </button>
              </div>
            </div>

            {/* State-driven body */}
            {activeGenerating && problems.length === 0 ? (
              <GeneratingSkeleton count={5} />
            ) : problems.length === 0 ? (
              <ProblemsEmptyHero
                disabled={isPublished}
                onGenerate={() => setShowGenerate(true)}
              />
            ) : (
              <>
                {/* Inline generating strip when we already have
                    problems but the teacher kicked off more */}
                {activeGenerating && (
                  <div className="mt-4 flex items-center gap-3 rounded-[--radius-md] border border-primary/30 bg-primary-bg/30 px-3 py-2 text-xs text-text-primary dark:border-primary/40 dark:bg-primary/10">
                    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                    </span>
                    <span>
                      <span className="font-semibold">Generating more…</span>{" "}
                      <span className="text-text-secondary">new ones land in the review queue when ready.</span>
                    </span>
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  {problems.map((p) => (
                    <ProblemRow
                      key={`${p.bank_item_id}-${p.position}`}
                      problem={p}
                      onClick={
                        isPublished
                          ? undefined
                          : () => void openWorkshopForProblem(p.bank_item_id)
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Grading setup — prominent card right below Problems so
              teachers see and use it. Placing it here (above
              Configuration) makes the rubric a first-class step in
              homework authoring rather than an optional footnote.
              Hidden for practice: practice is ungraded, no rubric
              feeds the (non-running) grader. */}
          {hw.type !== "practice" && (
            <GradingSetupCard
              rubric={hw.rubric}
              saveState={saveStates.rubric}
              saveError={saveErrors.rubric}
              onChange={onChangeRubric}
            />
          )}

          {/* Configuration — collapsed accordion. Auto-expands on a
              fresh HW with no problems OR when a required field is
              missing, so teachers can't accidentally collapse the only
              way to fix what's blocking publish. Collapses once
              everything's set. For practice we hide the due date + late
              policy inputs (neither applies) but keep units + sections
              since they still drive visibility. */}
          <div className="mt-4">
            <CollapsibleSection
              label="Configuration"
              summary={configSummary(hw)}
              defaultOpen={problems.length === 0 || hw.unit_ids.length === 0}
            >
              <ConfigBlock
                hw={hw}
                courseId={courseId}
                disabled={isPublished}
                saveStates={saveStates}
                saveErrors={saveErrors}
                dueDateInputRef={dueDateInputRef}
                onChangeUnits={onChangeUnits}
                onChangeDueAt={onChangeDueAt}
                onChangeLatePolicy={onChangeLatePolicy}
                onChangeSections={onChangeSections}
              />
            </CollapsibleSection>
          </div>

          {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
          {workshopError && (
            <p className="mt-4 text-xs text-red-600">{workshopError}</p>
          )}

          {/* Delete — subtle affordance at the bottom right. Red
              confirm inline to catch accidental clicks. */}
          <div className="mt-8 flex justify-end">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-700 dark:text-red-400">
                  Delete this homework?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Yes, delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={isPublished}
                title={isPublished ? "Unpublish before deleting" : "Delete this homework"}
                className="text-xs font-semibold text-text-muted hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🗑 Delete homework
              </button>
            )}
          </div>
        </>
      )}
    </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Compact one-line summary of the HW's configuration — shows in the
// collapsed Settings accordion so teachers can see the gist without
// expanding. Keep it dense; this is a scan line, not a form.
// ────────────────────────────────────────────────────────────────────
function configSummary(hw: TeacherAssignment): string {
  const parts: string[] = [];
  parts.push(`${hw.unit_ids.length} unit${hw.unit_ids.length === 1 ? "" : "s"}`);
  // Practice has no deadline concept — skip the due-date part
  // entirely rather than show "No due date" on every practice card.
  if (hw.type !== "practice") {
    if (hw.due_at) {
      const d = new Date(hw.due_at);
      parts.push(
        `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      );
    } else {
      parts.push("No due date");
    }
  }
  parts.push(
    hw.section_ids.length === 0
      ? "All sections"
      : `${hw.section_ids.length} section${hw.section_ids.length === 1 ? "" : "s"}`,
  );
  return parts.join(" · ");
}

// ────────────────────────────────────────────────────────────────────
// Collapsible — lightweight accordion wrapper for the Settings card.
// `defaultOpen` is captured into state at mount so it doesn't flip
// when the teacher toggles it manually.
// ────────────────────────────────────────────────────────────────────
function CollapsibleSection({
  label,
  summary,
  defaultOpen,
  children,
}: {
  label: string;
  summary?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            {label}
          </span>
          {summary && !open && (
            <span className="text-xs text-text-secondary">{summary}</span>
          )}
        </div>
        <span className="text-xs text-text-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-border-light p-5">{children}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty hero — shown in the Problems section when there are no
// problems AND nothing is generating. Turns the dead-end into a clear
// next action.
// ────────────────────────────────────────────────────────────────────
function ProblemsEmptyHero({
  disabled,
  onGenerate,
}: {
  disabled: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-5 rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle/50 px-8 py-12 text-center">
      <div className="text-5xl" aria-hidden="true">✨</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        Let&apos;s add some problems
      </h3>
      <p className="mt-1 text-xs text-text-muted">
        Generate with AI in ~30 seconds, grounded in your uploaded materials.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled}
        className="mt-5 inline-flex items-center gap-2 rounded-[--radius-md] bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark hover:shadow disabled:opacity-50"
      >
        ✨ Generate problems
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Skeleton rows — shown in the Problems section while a gen job is in
// flight and we have zero problems to display. Staggered pulse so the
// rows feel alive.
// ────────────────────────────────────────────────────────────────────
function GeneratingSkeleton({ count }: { count: number }) {
  return (
    <div className="mt-5 space-y-3">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <span>Generating problems…</span>
      </div>
      {Array.from({ length: count }).map((_, i) => {
        const style = { animationDelay: `${i * 120}ms` };
        return (
          <div
            key={i}
            className="rounded-[--radius-md] border border-border-light bg-bg-base/60 p-4"
          >
            <div className="flex items-start gap-3">
              <div
                className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-bg-subtle"
                style={style}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div
                  className="h-3 w-5/6 animate-pulse rounded bg-bg-subtle"
                  style={style}
                />
                <div
                  className="h-3 w-11/12 animate-pulse rounded bg-bg-subtle"
                  style={style}
                />
                <div
                  className="h-3 w-3/5 animate-pulse rounded bg-bg-subtle"
                  style={style}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Configuration block ──

function ConfigBlock({
  hw,
  courseId,
  disabled,
  saveStates,
  saveErrors,
  dueDateInputRef,
  onChangeUnits,
  onChangeDueAt,
  onChangeLatePolicy,
  onChangeSections,
}: {
  hw: TeacherAssignment;
  courseId: string;
  disabled: boolean;
  saveStates: Record<ConfigField, SaveState>;
  saveErrors: Record<ConfigField, string | null>;
  dueDateInputRef?: React.Ref<HTMLInputElement>;
  onChangeUnits: (next: string[]) => void;
  onChangeDueAt: (next: string | null) => void;
  onChangeLatePolicy: (next: string) => void;
  onChangeSections: (next: string[]) => void;
}) {
  return (
    <div className="space-y-5 rounded-[--radius-md] border border-border-light bg-bg-base/30 p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
        Configuration
      </div>

      {/* Units */}
      <Field
        label="Units"
        required
        hint={
          saveStates.units === "idle" && hw.unit_ids.length === 0
            ? "Required — at least one unit"
            : undefined
        }
        saveState={saveStates.units}
        saveError={saveErrors.units}
      >
        <UnitMultiSelect
          courseId={courseId}
          selected={hw.unit_ids}
          onChange={onChangeUnits}
          disabled={disabled}
        />
      </Field>

      {/* Due date — hidden for practice: practice is ungraded and
          has no deadline concept. */}
      {hw.type !== "practice" && (
        <Field
          label="Due date"
          saveState={saveStates.dueAt}
          saveError={saveErrors.dueAt}
        >
          <DueDatePicker
            value={hw.due_at}
            onChange={onChangeDueAt}
            disabled={disabled}
            inputRef={dueDateInputRef}
          />
        </Field>
      )}

      {/* Late policy — hidden for practice: nothing can be late
          when there's no due date. */}
      {hw.type !== "practice" && (
        <Field
          label="Late policy"
          saveState={saveStates.latePolicy}
          saveError={saveErrors.latePolicy}
        >
          <div className="flex flex-wrap gap-1.5">
            {LATE_POLICY_OPTIONS.map((opt) => {
              const active = hw.late_policy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeLatePolicy(opt.value)}
                  disabled={disabled}
                  className={`rounded-[--radius-pill] border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    active
                      ? "border-primary bg-primary text-white"
                      : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-bg-subtle"
                  }`}
                >
                  {active && <span className="mr-1">✓</span>}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {/* Sections */}
      <Field
        label="Sections"
        hint={
          hw.section_ids.length === 0
            ? "Leave empty to publish to every section in this course"
            : undefined
        }
        saveState={saveStates.sections}
        saveError={saveErrors.sections}
      >
        <SectionMultiSelect
          courseId={courseId}
          selected={hw.section_ids}
          onChange={onChangeSections}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  saveState,
  saveError,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  saveState: SaveState;
  saveError: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
          {label}
          {required && (
            <span className="ml-1 font-normal normal-case text-text-muted/70">· required</span>
          )}
        </span>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      {children}
      {hint && saveState === "idle" && (
        <p className="mt-1 text-[10px] text-text-muted">{hint}</p>
      )}
    </div>
  );
}

// Native datetime-local picker. The browser handles localization and
// the mobile experience. Returns null when cleared.
function DueDatePicker({
  value,
  onChange,
  disabled,
  inputRef,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  // Snapshot "now" once at mount so the render stays pure (Date.now()
  // in render trips react-hooks/purity). The modal is short-lived
  // enough that a stale snapshot is fine — the warning is informational
  // and the only edge case is "user picks a future date that becomes
  // past while the modal stays open for hours," which we don't care
  // about.
  const [now] = useState(() => Date.now());
  // datetime-local needs YYYY-MM-DDTHH:mm — drop the timezone suffix.
  const localValue = value ? toLocalDatetimeInputValue(value) : "";
  const isPast = value !== null && new Date(value).getTime() < now;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="datetime-local"
        value={localValue}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            onChange(null);
            return;
          }
          // Parse the local-time string back to an ISO with the
          // browser's local timezone offset baked in.
          const d = new Date(v);
          if (Number.isNaN(d.getTime())) return;
          onChange(d.toISOString());
        }}
        disabled={disabled}
        className="rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[11px] font-semibold text-text-muted hover:text-text-primary"
        >
          Clear
        </button>
      )}
      {isPast && !disabled && (
        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          ⚠ in the past
        </span>
      )}
    </div>
  );
}

function toLocalDatetimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Format YYYY-MM-DDTHH:mm in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ── Problem row ──
//
// Fat card with the math-rendered question as the focal element.
// Read-only — clicking does nothing; editing happens via the Edit
// problems button at the top of this modal.
function ProblemRow({
  problem,
  onClick,
}: {
  problem: AssignmentProblem;
  onClick?: () => void;
}) {
  const content = (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white">
        {problem.position}
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[15px] leading-snug text-text-primary">
          <MathText text={problem.question} />
        </div>
        <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
          {problem.difficulty}
        </div>
      </div>
    </div>
  );
  if (!onClick) {
    return (
      <div className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-3">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 text-left transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-sm"
      title="Click to edit"
    >
      {content}
    </button>
  );
}

// ── Remove problems sub-view ──
//
// Bulk-select UI for taking problems off a HW without going into each
// one individually. Uncheck the cards you want to drop, save. Editing
// the content of a single problem (question text, solution, chat with
// AI) happens by clicking the problem card itself — not here.

function RemoveProblemsView({
  problems,
  onCancel,
  onSave,
  busy,
}: {
  problems: AssignmentProblem[];
  onCancel: () => void;
  /** Called with the bank_item_ids the teacher wants to KEEP after
   *  the bulk remove. Parent's `saveProblems` writes that list as
   *  the new HW content. */
  onSave: (next: string[]) => void;
  busy: boolean;
}) {
  // Set of bank_item_ids currently marked for removal. Click × on a
  // row to add/remove from this set — nothing is committed until
  // Save. Cancel discards the marks and keeps the HW as-is.
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const kept = problems.filter((p) => !marked.has(p.bank_item_id));
  const wouldLeaveEmpty = kept.length === 0;
  const markCount = marked.size;

  const save = () => {
    if (markCount === 0) return;
    if (wouldLeaveEmpty) return;
    onSave(kept.map((p) => p.bank_item_id));
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Remove problems
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">
            Click × on a problem to mark it for removal. Nothing is removed
            until you Save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || markCount === 0 || wouldLeaveEmpty}
            title={
              wouldLeaveEmpty
                ? "Keep at least one problem — or delete the homework instead"
                : markCount === 0
                  ? "Click × on a problem to mark it for removal"
                  : `Remove ${markCount} problem${markCount === 1 ? "" : "s"}`
            }
            className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed dark:disabled:bg-gray-600"
          >
            {busy
              ? "Saving…"
              : markCount === 0
                ? "Remove"
                : `Remove ${markCount}`}
          </button>
        </div>
      </div>

      {wouldLeaveEmpty && markCount > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-text-primary dark:border-amber-500/30 dark:bg-amber-500/10">
          You&apos;ve marked every problem. Keep at least one, or{" "}
          <span className="font-semibold">delete the homework</span> instead if
          you want to start over.
        </p>
      )}

      <div className="mt-5 space-y-2">
        {problems.map((p) => {
          const isMarked = marked.has(p.bank_item_id);
          return (
            <RemovableProblemRow
              key={`${p.bank_item_id}-${p.position}`}
              problem={p}
              marked={isMarked}
              disabled={busy}
              onToggle={() => toggle(p.bank_item_id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function RemovableProblemRow({
  problem,
  marked,
  disabled,
  onToggle,
}: {
  problem: AssignmentProblem;
  marked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[--radius-md] border px-4 py-3 transition-all ${
        marked
          ? "border-red-200 bg-red-50/60 opacity-60 dark:border-red-500/30 dark:bg-red-500/10"
          : "border-border-light bg-surface"
      }`}
    >
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
          marked
            ? "bg-gray-400 dark:bg-gray-600"
            : "bg-gradient-to-br from-primary to-primary-dark"
        }`}
      >
        {problem.position}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`line-clamp-2 text-[15px] leading-snug text-text-primary ${
            marked ? "line-through" : ""
          }`}
        >
          <MathText text={problem.question} />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            {problem.difficulty}
          </span>
          {marked && (
            <span className="text-[10px] font-semibold text-red-700 dark:text-red-400">
              · marked for removal
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={marked ? "Undo remove" : "Mark for removal"}
        className={`shrink-0 rounded-full p-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
          marked
            ? "bg-surface text-primary hover:text-primary-dark"
            : "text-text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
        }`}
        title={marked ? "Undo" : "Mark for removal"}
      >
        {marked ? "Undo" : "✕"}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Submission strip — slim "X of Y submitted · Z to grade →" line that
// sits between the published-lock banner and the pending-review card.
// Single-section HWs deep-link directly to the grading queue; multi-
// section HWs expand inline into a section picker so the teacher
// chooses which queue to enter rather than us guessing.
// ────────────────────────────────────────────────────────────────────
function SubmissionStrip({
  courseId,
  assignmentId,
  rows,
}: {
  courseId: string;
  assignmentId: string;
  rows: SubmissionsInboxRow[];
}) {
  const [open, setOpen] = useState(false);

  const totalStudents = rows.reduce((s, r) => s + r.total_students, 0);
  const totalSubmitted = rows.reduce((s, r) => s + r.submitted, 0);
  // "to review" matches the inbox's wording (submissions-tab.tsx:142-145):
  // graded-but-not-released + edited-after-publish — both need a teacher
  // click before students see grades. Flagged is shown separately
  // because it's an integrity signal, not a grading-pipeline state.
  const totalToReview = rows.reduce((s, r) => s + r.to_grade + r.dirty, 0);
  const totalFlagged = rows.reduce((s, r) => s + r.flagged, 0);

  const parts: string[] =
    totalSubmitted === 0
      ? [`Waiting for first submission`]
      : [`${totalSubmitted} of ${totalStudents} submitted`];
  if (totalToReview > 0) parts.push(`${totalToReview} to review`);
  if (totalFlagged > 0) parts.push(`⚑ ${totalFlagged} flagged`);
  const summary = parts.join(" · ");

  const reviewHref = (sectionId: string) =>
    `/school/teacher/courses/${courseId}/homework/${assignmentId}/sections/${sectionId}/review`;

  // Single-section HW: one click goes straight to the grading queue.
  if (rows.length === 1) {
    return (
      <Link
        href={reviewHref(rows[0].section_id)}
        className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-bg-subtle/40 px-4 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:bg-bg-subtle"
      >
        <span>{summary}</span>
        <span className="shrink-0 text-primary">View submissions →</span>
      </Link>
    );
  }

  // Multi-section: expandable inline picker so the teacher picks the
  // section to grade rather than landing in a default they didn't ask
  // for. Counts live on each row so the choice is informed.
  return (
    <div className="mt-4 rounded-[--radius-md] border border-border-light bg-bg-subtle/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
      >
        <span>{summary}</span>
        <span className="shrink-0 text-primary">
          {open ? "Hide sections ▴" : "View submissions →"}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border-light border-t border-border-light bg-surface">
          {rows.map((r) => {
            const toReview = r.to_grade + r.dirty;
            return (
              <Link
                key={r.section_id}
                href={reviewHref(r.section_id)}
                className="flex items-center justify-between gap-3 px-4 py-2 text-xs hover:bg-bg-subtle"
              >
                <span className="font-semibold text-text-primary">
                  {r.section_name}
                </span>
                <span className="text-text-muted">
                  {r.submitted} of {r.total_students} submitted
                  {toReview > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-semibold text-primary">
                        {toReview} to review →
                      </span>
                    </>
                  )}
                  {r.flagged > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-semibold text-red-600 dark:text-red-400">
                        ⚑ {r.flagged}
                      </span>
                    </>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
