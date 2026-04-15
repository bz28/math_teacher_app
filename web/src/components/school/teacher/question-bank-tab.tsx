"use client";

import { useEffect, useMemo, useState } from "react";
import { teacher, type BankItem, type BankJob } from "@/lib/api";
import { useBankData } from "./_hooks/use-bank-data";
import { EmptyState } from "@/components/school/shared/empty-state";
import { WorkshopModal } from "./workshop-modal";
import { HomeworkDetailModal } from "./homework-tab";
import { CourseSubjectContext } from "./question-bank/course-subject-context";
import { STATUS_FILTERS } from "./question-bank/constants";
import { BankSkeleton } from "./question-bank/skeleton";
import { GenerateQuestionsModal } from "./question-bank/generate-questions-modal";
import { UploadWorksheetModal } from "./question-bank/upload-worksheet-modal";
import { PendingSections } from "./question-bank/pending-sections";
import { ApprovedByHomework } from "./question-bank/approved-by-homework";
import { QuestionRow } from "./question-bank/question-row";
import { PracticeProblemsModal } from "./question-bank/practice-problems-modal";
import { GenerateSimilarDialog } from "./_pieces/generate-similar-dialog";

export function QuestionBankTab({
  courseId,
  courseSubject,
  activeJob,
  setActiveJob,
}: {
  courseId: string;
  courseSubject: string;
  activeJob: BankJob | null;
  setActiveJob: (job: BankJob | null) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const { items, units, counts, loading, error, reload, setError } = useBankData(
    courseId, statusFilter,
  );

  // Client-side search filter — applied across all status sub-tabs.
  // Unit filtering happens server-side via the bank() params already.
  const filteredItems = useMemo(() => {
    let out = items;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.question.toLowerCase().includes(q),
      );
    }
    return out;
  }, [items, searchQuery]);

  const [showGenerate, setShowGenerate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [openItem, setOpenItem] = useState<BankItem | null>(null);
  // Lift-up state for the practice-problems detail modal + generate-
  // similar dialog so they can be opened from any row in the approved
  // tab without going through the workshop modal first.
  const [practiceFor, setPracticeFor] = useState<BankItem | null>(null);
  const [generateMoreFor, setGenerateMoreFor] = useState<BankItem | null>(null);
  // When the teacher dives from the practice-problems modal into either
  // the workshop or the generate dialog, we stash the parent here so
  // closing the child surface restores the practice modal — keeping
  // their navigation context instead of dumping them back at the bank.
  const [returnToPracticeFor, setReturnToPracticeFor] = useState<BankItem | null>(null);
  const [openHomeworkId, setOpenHomeworkId] = useState<string | null>(null);
  const [variationReviewQueue, setVariationReviewQueue] = useState<BankItem[] | null>(null);
  const [reviewQueueParent, setReviewQueueParent] = useState<BankItem | null>(null);

  // Inline review queue state — opens WorkshopModal in queue mode
  const [inlineReviewQueue, setInlineReviewQueue] = useState<BankItem[] | null>(null);

  // Approved items cache used to look up parent titles for the
  // Pending tab's practice-problem groups (so they can show
  // "Practice for: X" + a snippet instead of an opaque ID), and to
  // restore the parent item when a variation review queue closes.
  //
  // Only the Pending tab consumes this cache. Skip the fetch on
  // Approved/Rejected — refetching every time counts.approved bumped
  // was wasteful when the data wasn't being read. counts.approved
  // stays in the deps so a new approval lands in the cache before
  // its variations show up in Pending.
  //
  // approvedCacheLoaded distinguishes "still fetching" from "fetched
  // and parent really isn't there" — drives the spinner / removed-
  // copy split in VariationGroupRow.
  const [approvedCache, setApprovedCache] = useState<BankItem[]>([]);
  const [approvedCacheLoaded, setApprovedCacheLoaded] = useState(false);
  useEffect(() => {
    if (statusFilter !== "pending") return;
    let cancelled = false;
    teacher.bank(courseId, { status: "approved" }).then((res) => {
      if (!cancelled) {
        setApprovedCache(res.items);
        setApprovedCacheLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setApprovedCacheLoaded(true);
    });
    return () => { cancelled = true; };
  }, [courseId, statusFilter, counts.approved]);

  const parentLookup = useMemo(
    () => new Map(approvedCache.map((i) => [i.id, i])),
    [approvedCache],
  );

  const openVariationReview = async (parent: BankItem) => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      const children = res.items.filter((i) => i.parent_question_id === parent.id);
      if (children.length === 0) {
        setActiveJob(null);
        setError("All variations for this question have already been reviewed.");
        return;
      }
      setActiveJob(null);
      setOpenItem(null);
      setReviewQueueParent(parent);
      setVariationReviewQueue(children);
    } catch (e) {
      setOpenItem(null);
      setError(e instanceof Error ? e.message : "Failed to load variations");
    }
  };

  // "Review all" on the Pending → New Questions section. Opens the
  // WorkshopModal in queue mode with only primary (non-variation)
  // questions. Variations are reviewed via openVariationReview from
  // the Practice Problems section, which scopes to one parent.
  const startNewQuestionsReview = async () => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      const primaries = res.items.filter((i) => !i.parent_question_id);
      if (primaries.length === 0) return;
      setInlineReviewQueue(primaries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pending");
    }
  };

  useEffect(() => {
    if (activeJob?.status === "done") {
      reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.status, activeJob?.id]);

  useEffect(() => {
    if (!activeJob || !activeJob.parent_question_id || activeJob.status !== "done") return;
    let cancelled = false;
    const parentId = activeJob.parent_question_id;
    teacher
      .bank(courseId, { status: "pending" })
      .then((res) => {
        if (!cancelled) {
          const stillPending = res.items.some(
            (i) => i.parent_question_id === parentId,
          );
          if (!stillPending) setActiveJob(null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeJob, items, courseId, setActiveJob]);

  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, activeJob?.id]);

  return (
    <CourseSubjectContext.Provider value={courseSubject}>
    <div>
      {/* Header row: title + status chips inline + Generate */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-lg font-bold text-text-primary">Question Bank</h2>
          <div className="flex gap-1">
            {STATUS_FILTERS.filter(
              (f) =>
                f.key !== "rejected" ||
                counts.rejected > 0 ||
                statusFilter === "rejected",
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  setStatusFilter(f.key);
                  setOpenItem(null);
                }}
                className={`rounded-[--radius-pill] px-3 py-1 text-xs font-semibold transition-colors ${
                  statusFilter === f.key
                    ? "bg-primary text-white"
                    : "border border-border-light text-text-secondary hover:bg-bg-subtle"
                }`}
              >
                {f.label}
                <span className="ml-1 opacity-70">({counts[f.key] ?? 0})</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-sm font-bold text-text-primary hover:bg-bg-subtle"
            onClick={() => setShowUpload(true)}
          >
            Upload Worksheet
          </button>
          <button
            type="button"
            className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
            onClick={() => setShowGenerate(true)}
          >
            + Generate Questions
          </button>
        </div>
      </div>


      {/* Active job banner */}
      {activeJob && !activeJob.parent_question_id && (
        <div
          className={`mt-4 rounded-[--radius-lg] border p-3 text-sm ${
            activeJob.status === "failed"
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10"
              : activeJob.status === "done"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10"
                : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10"
          }`}
        >
          {activeJob.status === "queued" &&
            (activeJob.mode === "upload"
              ? "Extracting problems from worksheet..."
              : "Generation queued...")}
          {activeJob.status === "running" &&
            (activeJob.mode === "upload"
              ? activeJob.produced_count > 0
                ? `Extracting & solving... ${activeJob.produced_count} questions so far`
                : "Extracting problems from worksheet..."
              : activeJob.produced_count > 0
                ? `Generating questions... ${activeJob.produced_count}/${activeJob.requested_count}`
                : `Generating ${activeJob.requested_count} questions...`)}
          {activeJob.status === "done" && (
            <span>
              {activeJob.mode === "upload" ? "Extracted" : "Generated"}{" "}
              {activeJob.produced_count} question{activeJob.produced_count !== 1 ? "s" : ""}
            </span>
          )}
          {activeJob.status === "failed" &&
            `${activeJob.mode === "upload" ? "Extraction" : "Generation"} failed: ${activeJob.error_message ?? "unknown error"}`}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {/* Search bar */}
      <div className="mt-4">
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
            aria-hidden
          >
            &#128269;
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${counts[statusFilter] ?? 0} ${statusFilter} questions...`}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Full-width content — no UnitRail sidebar */}
      <div className="mt-4">
        {loading ? (
          <BankSkeleton />
        ) : filteredItems.length === 0 ? (
          searchQuery.trim() ? (
            <EmptyState text={`No questions match "${searchQuery.trim()}".`} />
          ) : counts.pending + counts.approved + counts.rejected === 0 ? (
            <FirstVisitEmptyState
              hasUnits={units.some((u) => u.parent_id === null)}
              onGenerate={() => setShowGenerate(true)}
            />
          ) : (
            <EmptyState
              text={emptyStateFor(statusFilter, counts)}
            />
          )
        ) : statusFilter === "pending" ? (
          <PendingSections
            items={filteredItems}
            units={units}
            onOpenItem={setOpenItem}
            onReviewAllNew={startNewQuestionsReview}
            onReviewVariationsForParent={(parentId) => {
              const parent = parentLookup.get(parentId)
                ?? items.find((i) => i.id === parentId);
              if (parent) openVariationReview(parent);
            }}
            parentLookup={parentLookup}
            parentLookupLoaded={approvedCacheLoaded}
          />
        ) : statusFilter === "rejected" ? (
          <div className="space-y-2">
            {filteredItems.map((item) => (
              <QuestionRow
                key={item.id}
                item={item}
                units={units}
                emphasis="rejected"
                onClick={setOpenItem}
              />
            ))}
          </div>
        ) : (
          <ApprovedByHomework
            items={filteredItems}
            units={units}
            onOpenItem={setOpenItem}
            onReviewVariations={openVariationReview}
            onGenerateMore={setGenerateMoreFor}
            onViewPractice={setPracticeFor}
          />
        )}
      </div>

      {showGenerate && (
        <GenerateQuestionsModal
          courseId={courseId}
          onClose={() => setShowGenerate(false)}
          onStarted={(job) => {
            setShowGenerate(false);
            setActiveJob(job);
          }}
        />
      )}

      {showUpload && (
        <UploadWorksheetModal
          courseId={courseId}
          onClose={() => setShowUpload(false)}
          onStarted={(job) => {
            setShowUpload(false);
            setActiveJob(job);
          }}
        />
      )}

      {/* Unified review surface — WorkshopModal handles single-item
          editing AND queue walking. The queue prop flips it into
          scan-and-decide mode with sticky-homework destination, Prev/
          Skip, and auto-advance on Approve/Reject. */}
      {inlineReviewQueue && (
        <WorkshopModal
          queue={inlineReviewQueue}
          onClose={() => {
            setInlineReviewQueue(null);
            reload();
          }}
          onChanged={reload}
          onJobStarted={setActiveJob}
          activeJob={activeJob}
        />
      )}

      {variationReviewQueue && reviewQueueParent && (
        <WorkshopModal
          queue={variationReviewQueue}
          onClose={() => {
            setVariationReviewQueue(null);
            setOpenItem(reviewQueueParent);
            reload();
          }}
          onChanged={reload}
          onJobStarted={setActiveJob}
          activeJob={activeJob}
        />
      )}

      {openItem && (
        <WorkshopModal
          item={items.find((i) => i.id === openItem.id) ?? openItem}
          onClose={() => {
            setOpenItem(null);
            setReviewQueueParent(null);
            // Restore the practice-problems modal if we got here from
            // there. If not, returnToPracticeFor is null and this is
            // a no-op.
            if (returnToPracticeFor) {
              setPracticeFor(returnToPracticeFor);
              setReturnToPracticeFor(null);
            }
          }}
          onChanged={reload}
          onJobStarted={setActiveJob}
          activeJob={activeJob}
          onReviewVariations={openVariationReview}
          parentTitle={
            openItem.parent_question_id
              ? parentLookup.get(openItem.parent_question_id)?.title
              : undefined
          }
          onJumpToParent={
            openItem.parent_question_id
              ? () => {
                  const p = parentLookup.get(openItem.parent_question_id!);
                  if (p) setOpenItem(p);
                }
              : undefined
          }
        />
      )}

      {openHomeworkId && (
        <HomeworkDetailModal
          courseId={courseId}
          assignmentId={openHomeworkId}
          onClose={() => setOpenHomeworkId(null)}
          onChanged={reload}
        />
      )}

      {practiceFor && (
        <PracticeProblemsModal
          parent={practiceFor}
          units={units}
          onClose={() => setPracticeFor(null)}
          onOpenItem={(item) => {
            setReturnToPracticeFor(practiceFor);
            setPracticeFor(null);
            setOpenItem(item);
          }}
          onGenerateMore={() => {
            const target = practiceFor;
            setReturnToPracticeFor(target);
            setPracticeFor(null);
            setGenerateMoreFor(target);
          }}
        />
      )}

      {generateMoreFor && (
        <GenerateSimilarDialog
          itemId={generateMoreFor.id}
          onClose={() => {
            setGenerateMoreFor(null);
            if (returnToPracticeFor) {
              setPracticeFor(returnToPracticeFor);
              setReturnToPracticeFor(null);
            }
          }}
          onStarted={(job) => {
            setGenerateMoreFor(null);
            setActiveJob(job);
            if (returnToPracticeFor) {
              setPracticeFor(returnToPracticeFor);
              setReturnToPracticeFor(null);
            }
          }}
        />
      )}
    </div>
    </CourseSubjectContext.Provider>
  );
}

function emptyStateFor(
  statusFilter: "pending" | "approved" | "rejected",
  counts: { pending: number; approved: number; rejected: number },
): string {
  const total = counts.pending + counts.approved + counts.rejected;
  if (total === 0) {
    return "No questions yet. Generate or upload a worksheet to get started.";
  }
  if (statusFilter === "pending") {
    return "No pending review. New generations land here.";
  }
  if (statusFilter === "rejected") {
    return "No rejected questions.";
  }
  return "No approved questions yet. Review pending ones to add them to a homework.";
}

function FirstVisitEmptyState({
  hasUnits,
  onGenerate,
}: {
  hasUnits: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[--radius-lg] border border-dashed border-border-light bg-bg-base/30 px-6 py-16 text-center">
      <div className="text-5xl" aria-hidden>
        &#128218;
      </div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        Your question bank is empty
      </h3>
      {hasUnits ? (
        <>
          <p className="mt-2 max-w-md text-sm text-text-muted">
            Generate questions from your materials. They&rsquo;ll land here as
            pending — review and add each one to a homework when you&rsquo;re
            ready.
          </p>
          <button
            type="button"
            onClick={onGenerate}
            className="mt-5 rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark"
          >
            Generate your first questions
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-md text-sm text-text-muted">
            Before you can generate questions, you need at least one unit to
            organize them under. Create a unit (like &ldquo;Algebra&rdquo; or
            &ldquo;Quadratics&rdquo;) in the Materials tab, then come back to
            generate.
          </p>
          <p className="mt-3 text-[11px] italic text-text-muted">
            Open the Materials tab above to get started.
          </p>
        </>
      )}
    </div>
  );
}
