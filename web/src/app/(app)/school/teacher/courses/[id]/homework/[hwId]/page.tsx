"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  teacher,
  type BankItem,
  type SubmissionsInboxRow,
} from "@/lib/api";
import { pointsRange } from "@/lib/points";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { GenerateQuestionsModal } from "@/components/school/teacher/question-bank/generate-questions-modal";
import { WorkshopModal } from "@/components/school/teacher/workshop-modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssignmentProblem, HomeworkDetail } from "./_lib/types";
import { useGenerationJobs } from "./_lib/use-generation-jobs";
import { useInlineConfig } from "./_lib/use-inline-config";
import {
  useCourseSections,
  useHomeworkInbox,
  usePendingProblems,
} from "./_lib/use-homework-loads";
import { usePreviewAsStudent } from "./_lib/use-preview-as-student";
import { useSetPracticed } from "./_lib/use-set-practiced";
import { ActionBar } from "./_components/action-bar";
import { CollapsibleSection, ConfigBlock, configSummary } from "./_components/config-block";
import { DeleteHomework } from "./_components/delete-homework";
import { HomeworkHeader } from "./_components/homework-header";
import { InstructionsBlock } from "./_components/instructions-block";
import { GenerationStalledBanner, PendingReviewLink } from "./_components/problems-heroes";
import { ProblemsSection } from "./_components/problems-section";
import { RemoveProblemsView } from "./_components/remove-problems-view";
import { WhoPracticed } from "./_components/who-practiced";

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

  const [hw, setHw] = useState<HomeworkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Back link points at whichever tab the assignment came from — HW
  // for type=homework, Practice for type=practice. Falls back to HW
  // while the assignment is still loading (matches prior behavior).
  const backHref =
    `/school/teacher/courses/${courseId}?tab=${
      hw?.type === "practice" ? "practice" : "homework"
    }`;
  const goBack = () => router.push(backHref);
  const [editingProblems, setEditingProblems] = useState(false);
  // Soft confirm on Publish, for things that are usually mistakes but
  // can be meant: no due date (in-class, untimed work), or graph
  // checklists the teacher hasn't checked. It warns; it never blocks.
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  // Set to open one problem's Grading ▾ and bring it into view ("Review
  // them" on the publish confirm); `n` makes a repeat request fire again.
  const [reveal, setReveal] = useState<{ bankItemId: string; n: number } | null>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAsyncAction();
  const { pending, reloadPending } = usePendingProblems(courseId, assignmentId);
  const inboxRows = useHomeworkInbox(hw?.status, courseId, assignmentId);
  const setPracticed = useSetPracticed(assignmentId, hw?.type, hw?.status);
  const courseSections = useCourseSections(courseId);
  const {
    setActiveJobs,
    activeGenerating,
    aggregateRequested,
    aggregateProduced,
    readingUpload,
    stalledShortfall,
    generationStalled,
    notices,
  } = useGenerationJobs(courseId, assignmentId, reloadPending);
  const { previewLoading, onPreviewAsStudent } = usePreviewAsStudent(
    courseId,
    assignmentId,
    run,
  );

  const [showGenerate, setShowGenerate] = useState(false);
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

  const reload = async () => {
    setLoading(true);
    try {
      const a = await teacher.assignment(assignmentId);
      setHw(a);
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

  // A checklist changed (saved, rewritten, written in the background
  // since approving, or resized by a points or rules change): re-read
  // only the checklists, so a refetch can't undo another field's
  // optimistic edit that is still saving. Throws when the read fails.
  const refreshChecklists = useCallback(async () => {
    const fresh = await teacher.assignment(assignmentId);
    setHw((h) => (h ? { ...h, graph_checklists: fresh.graph_checklists } : h));
  }, [assignmentId]);

  // Just approved: a checklist is written in the background in a few
  // seconds. Look once more for the whole page (not once per problem)
  // before the panels offer to write one by hand.
  const [checklistsLookedAgain, setChecklistsLookedAgain] = useState(false);
  const checklistPending = Object.values(hw?.graph_checklists ?? {}).some(
    (e) => !e.checklist && e.can_write,
  );
  useEffect(() => {
    if (!checklistPending || checklistsLookedAgain) return;
    const t = setTimeout(() => {
      setChecklistsLookedAgain(true);
      refreshChecklists().catch(() => undefined);
    }, 8000);
    return () => clearTimeout(t);
  }, [checklistPending, checklistsLookedAgain, refreshChecklists]);

  const problems: AssignmentProblem[] =
    hw?.content && typeof hw.content === "object" && "problems" in hw.content
      ? ((hw.content as { problems: AssignmentProblem[] }).problems ?? [])
      : [];

  const isPublished = hw?.status === "published";
  // Homework is graded; practice isn't, so it has no points or rubric.
  const graded = hw !== null && hw.type !== "practice";

  const {
    saveStates,
    saveErrors,
    onChangeUnits,
    onChangeDueAt,
    onChangeLatePolicy,
    onChangeSections,
    onChangeDescription,
    onChangeRubric,
    onChangePoints,
    onChangeProblemPoints,
  } = useInlineConfig({ hw, setHw, assignmentId, courseSections, problems, refreshChecklists });

  const saveTitle = (draft: string, done: () => void) =>
    run(async () => {
      const t = draft.trim();
      if (!t) {
        setError("Title cannot be empty");
        return;
      }
      if (t === hw?.title) {
        done();
        return;
      }
      await teacher.updateAssignment(assignmentId, { title: t });
      done();
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
      setConfirmingPublish(false);
      await reload();
    });

  // Click handler for the Publish button. If the HW has no due date, or
  // graph checklists the teacher hasn't checked, intercept and show a
  // soft confirm — both are usually mistakes, but publishing anyway IS
  // a valid choice. Practice has no due date and no checklists, so it
  // publishes directly.
  const noDueDate = !!hw && hw.type !== "practice" && hw.due_at === null;
  const uncheckedChecklists = problems.filter((p) => {
    const c = hw?.graph_checklists?.[p.bank_item_id]?.checklist;
    return !!c && c.asks_for_drawing && !c.checked;
  });
  // Graph problems that can have a checklist but don't yet: being
  // written in the background right after Approve, or that write failed.
  const missingChecklists = problems.filter((p) => {
    const e = hw?.graph_checklists?.[p.bank_item_id];
    return !!e && !e.checklist && e.can_write;
  });
  const publishWarnings = {
    noDueDate,
    uncheckedChecklists: uncheckedChecklists.length,
    missingChecklists: missingChecklists.length,
    checklistsLookedAgain,
  };
  const anyPublishWarning =
    noDueDate || uncheckedChecklists.length > 0 || missingChecklists.length > 0;
  // The confirm reads the warnings live; once the teacher has dealt with
  // every one (checked the last checklist from the open bar), close it
  // rather than fall through to a warning that doesn't apply.
  if (confirmingPublish && !anyPublishWarning) setConfirmingPublish(false);
  const handlePublishClick = () => {
    if (anyPublishWarning) {
      setConfirmingPublish(true);
      return;
    }
    publish();
  };

  const unpublish = () =>
    run(async () => {
      await teacher.unpublishAssignment(assignmentId);
      await reload();
    });

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
          // Append rather than replace — a teacher could in
          // principle queue multiple "Generate more" calls, and we
          // already track multi-job for clone-as-practice. Drop
          // any prior terminal jobs so they don't keep inflating
          // the aggregate count after they finished.
          setActiveJobs((prev) => [
            ...prev.filter((j) => j.status !== "done" && j.status !== "failed"),
            job,
          ]);
          setShowGenerate(false);
        }}
      />
    )}
    <div className="mx-auto max-w-4xl px-4 pb-32">
      <HomeworkHeader
        hw={hw}
        backHref={backHref}
        problemCount={problems.length}
        courseSections={courseSections}
        loading={loading}
        busy={busy}
        onSaveTitle={saveTitle}
      />

      {/* Instructions students will see (e.g. "Show all work, no
          calculators"). Editable inline; lives just below the title so
          teachers see it as a first-class part of the HW, not buried in
          a settings page. Editable while published — instructions
          don't change which problems students see. Practice has no
          student-visible page yet, so we hide the field there. */}
      {!editingProblems && hw && hw.type !== "practice" && (
        <InstructionsBlock
          value={hw.description}
          saveState={saveStates.description}
          saveError={saveErrors.description}
          onChange={onChangeDescription}
        />
      )}


      {/* Loading / editing-problems states short-circuit the page */}
      {(loading || !hw) ? (
        <div
          className="mt-6 space-y-3 rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-sm"
          aria-busy="true"
          aria-live="polite"
        >
          {/* Mirror the problem-list silhouette so the editor settles in
              place rather than blanking to "Loading…". */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 border-b border-border-light pb-4 last:border-0 last:pb-0"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
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
            <div className="mt-4 rounded-[--radius-md] border border-primary/20 bg-primary-bg/30 p-3 text-xs text-text-secondary">
              {graded
                ? "Published — students can see this. Points, grading rules and instructions stay editable; unpublish to change the problem list, title, due date, or sections."
                : `Live for ${hw.section_names.join(", ") || "its periods"}. Unpublish to change the problems or the periods.`}
            </div>
          )}

          {setPracticed && <WhoPracticed sections={setPracticed.sections} />}

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

          {/* Generation-stalled banner — persistent surfacing of a
              failed gen job so a zero-produced (or short) run doesn't
              vanish into the empty hero. Sits above the pending banner
              so its "safe in Pending review" note points right at it. */}
          {notices.map((n) => (
            <p
              key={n.id}
              role="status"
              className="mt-4 rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-sm text-text-secondary"
            >
              {n.text}
            </p>
          ))}

          {generationStalled && (
            <GenerationStalledBanner
              shortfall={stalledShortfall}
              savedCount={pending.length}
              disabled={isPublished}
              onRetry={() => setShowGenerate(true)}
            />
          )}

          {pending.length > 0 && <PendingReviewLink count={pending.length} href={reviewHref} />}

          <ProblemsSection
            hw={hw}
            problems={problems}
            courseId={courseId}
            assignmentId={assignmentId}
            graded={graded}
            isPublished={isPublished}
            practiced={setPracticed?.problems}
            generation={{
              active: activeGenerating,
              requested: aggregateRequested,
              produced: aggregateProduced,
              reading: readingUpload,
            }}
            saveStates={saveStates}
            saveErrors={saveErrors}
            onChangePoints={onChangePoints}
            onChangeProblemPoints={onChangeProblemPoints}
            onChangeRubric={onChangeRubric}
            onGenerate={() => setShowGenerate(true)}
            onRemoveProblems={() => {
              // Drop any in-flight publish soft-confirm so the
              // teacher doesn't return from removal mode to a
              // stale "Publish anyway?" bar from before.
              setConfirmingPublish(false);
              setEditingProblems(true);
            }}
            onEditProblem={(id) => void openWorkshopForProblem(id)}
            checklistsLookedAgain={checklistsLookedAgain}
            onChecklistChanged={refreshChecklists}
            reveal={reveal}
          />

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
              summary={configSummary(hw, courseSections?.length ?? null)}
              defaultOpen={problems.length === 0 || hw.unit_ids.length === 0}
            >
              <ConfigBlock
                hw={hw}
                courseId={courseId}
                courseSections={courseSections}
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

          {error && <p className="mt-4 text-xs text-[color:var(--color-error)]">{error}</p>}
          {workshopError && (
            <p className="mt-4 text-xs text-[color:var(--color-error)]">{workshopError}</p>
          )}

          <DeleteHomework
            noun={graded ? "homework" : "practice set"}
            disabled={isPublished}
            busy={busy}
            onDelete={remove}
          />
        </>
      )}
    </div>
    {/* Sticky action bar — pins Publish + Preview-as-student to the
        viewport bottom so they're always reachable, no matter how far
        the teacher has scrolled. Hidden during the in-place "edit
        problems" sub-view because that mode has its own footer. */}
    {hw && !editingProblems && !loading && (
      <ActionBar
        isPublished={isPublished}
        canPublish={canPublish}
        missingForPublish={missingForPublish}
        pointsSummary={
          graded && problems.length > 0
            ? `${hw.points.total} points · ${problems.length} problem${problems.length === 1 ? "" : "s"}, ${pointsRange(Object.values(hw.points.by_problem))}`
            : null
        }
        busy={busy}
        previewLoading={previewLoading}
        onPublish={handlePublishClick}
        onUnpublish={unpublish}
        onPreviewAsStudent={onPreviewAsStudent}
        confirming={
          confirmingPublish && anyPublishWarning
            ? {
                warning: publishWarning(publishWarnings),
                checklists: publishWarnings.uncheckedChecklists + publishWarnings.missingChecklists,
                noDueDate,
              }
            : null
        }
        onReviewChecklists={() => {
          setConfirmingPublish(false);
          const first = uncheckedChecklists[0] ?? missingChecklists[0];
          if (first) setReveal((r) => ({ bankItemId: first.bank_item_id, n: (r?.n ?? 0) + 1 }));
        }}
        onAddDueDate={() => {
          setConfirmingPublish(false);
          // Best-effort scroll to the due-date input if it's currently
          // mounted (i.e. the Configuration accordion is expanded).
          // When collapsed, the ref is null — the teacher needs to
          // expand Configuration manually. Documenting that here so a
          // future PR can auto-expand on this path.
          setTimeout(() => {
            dueDateInputRef.current?.focus();
            dueDateInputRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 0);
        }}
        onConfirmPublish={publish}
      />
    )}
    </>
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
  // "To review" = submissions whose grade isn't out yet OR has been
  // edited since publish. `to_grade` counts only graded-but-unpublished
  // (per teacher_assignments.py:985-994), so the truly-ungraded would
  // be silently dropped if we used it directly. `submitted - published`
  // captures both ungraded + to_grade in one expression; `+ dirty`
  // adds back the published-but-edited subset that needs a republish
  // click before students see the latest. Flagged is reported
  // separately as an integrity signal, not a grading-pipeline state.
  const totalToReview = rows.reduce(
    (s, r) => s + (r.submitted - r.published) + r.dirty,
    0,
  );
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
        className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-4 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:bg-[color:var(--color-surface-alt-2)]"
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
    <div className="mt-4 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
      >
        <span>{summary}</span>
        <span className="shrink-0 text-primary">
          {open ? "Hide sections ▴" : "View submissions →"}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border-light border-t border-border-light bg-surface">
          {rows.map((r) => {
            const toReview = (r.submitted - r.published) + r.dirty;
            return (
              <Link
                key={r.section_id}
                href={reviewHref(r.section_id)}
                className="flex items-center justify-between gap-3 px-4 py-2 text-xs hover:bg-[color:var(--color-surface-alt-2)]"
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
                      <span className="font-semibold text-[color:var(--color-error)]">
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

type PublishWarnings = {
  noDueDate: boolean;
  uncheckedChecklists: number;
  /** Graph problems whose checklist isn't written yet. */
  missingChecklists: number;
  /** The page has looked again for checklists being written; one still
   *  missing has failed to write, not just not landed yet. */
  checklistsLookedAgain: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The publish soft-confirm's warning. The no-due-date wording alone is
 *  unchanged from before checklists were checked. */
function publishWarning(w: PublishWarnings) {
  const parts = [
    w.uncheckedChecklists > 0 &&
      `${plural(w.uncheckedChecklists, "graph checklist hasn\u2019t", "graph checklists haven\u2019t")} been checked`,
    w.missingChecklists > 0 &&
      (w.checklistsLookedAgain
        ? `${plural(w.missingChecklists, "graph problem has", "graph problems have")} no checklist yet`
        : `${plural(w.missingChecklists, "graph checklist is", "graph checklists are")} still being written`),
  ].filter((p): p is string => !!p);
  if (parts.length === 0) return "Publish without a due date? Students will see \u201cno due date\u201d.";
  if (w.noDueDate) parts.push("there\u2019s no due date");
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}` : parts[0];
  return `${sentence}. Publish anyway?`;
}
