"use client";

import { useEffect, useMemo, useState } from "react";
import { teacher, type BankItem, type BankJob } from "@/lib/api";
import { useBankData } from "./_hooks/use-bank-data";
import { EmptyState } from "@/components/school/shared/empty-state";
import { WorkshopModal } from "./workshop-modal";
import { HomeworkDetailModal } from "./homework-tab";
import { CourseSubjectContext } from "./question-bank/course-subject-context";
import { STATUS_FILTERS } from "./question-bank/constants";
import { buildUnitGroups } from "./question-bank/tree";
import { SimpleUnitList } from "./question-bank/unit-groups";
import { ApprovedUnitFolder } from "./question-bank/approved-tree";
import { BankSkeleton } from "./question-bank/skeleton";
import { GenerateQuestionsModal } from "./question-bank/generate-questions-modal";
import { UnitRail, type UnitSelection } from "./question-bank/unit-rail";
import { PendingTray } from "./question-bank/pending-tray";
import { ReviewModal } from "./question-bank/review-modal";

export function QuestionBankTab({
  courseId,
  courseSubject,
  activeJob,
  setActiveJob,
}: {
  courseId: string;
  // Used by the concept emoji classifier to gate math/physics/chem
  // buckets so a chem course doesn't render 🚀 for "reagent" word
  // problems.
  courseSubject: string;
  // Lifted to the course page so the active job survives tab switches.
  // Polling + auto-clear also live there. This component just consumes
  // the state and triggers updates.
  activeJob: BankJob | null;
  setActiveJob: (job: BankJob | null) => void;
}) {
  // Default to Pending — the actionable view a teacher lands on most
  // often after generating. We used to auto-flip to Approved when
  // pending was empty, but that caused a visible flicker (render
  // Pending → fetch counts → flip to Approved). Now we just stay on
  // Pending and show an empty state if there's nothing to review.
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected">("pending");
  // Unit selection — "all" | "uncategorized" | unit id. Drives the
  // rail's active state and the client-side filter for the content
  // area. Decoupled from status filter so the teacher can narrow on
  // both axes.
  const [unitSelection, setUnitSelection] = useState<UnitSelection>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Data fetching extracted to a custom hook — items/units/counts/
  // loading/error/reload all live there. The hook now fetches all
  // items for the current status; unit filtering is client-side so
  // the rail can show accurate per-unit counts.
  const { items, units, counts, loading, error, reload, setError } = useBankData(
    courseId, statusFilter,
  );

  // Client-side unit + search filter applied to the loaded items.
  // Search matches title and question text, case-insensitive.
  const filteredItems = useMemo(() => {
    let out = items;
    if (unitSelection === "uncategorized") {
      out = out.filter((i) => i.unit_id === null);
    } else if (unitSelection !== "all") {
      out = out.filter((i) => i.unit_id === unitSelection);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.question.toLowerCase().includes(q),
      );
    }
    return out;
  }, [items, unitSelection, searchQuery]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [openItem, setOpenItem] = useState<BankItem | null>(null);
  // Separate state for "edit invoked from inside ReviewModal" so we
  // can force WorkshopModal into editOnly mode (Approve/Reject hidden)
  // — keeps the two surfaces from fighting over status changes.
  const [editFromReviewItem, setEditFromReviewItem] = useState<BankItem | null>(null);
  const [openHomeworkId, setOpenHomeworkId] = useState<string | null>(null);
  // Flow A: full-screen review for fresh primary problems. Captured at
  // open time so mid-review generations don't splice in.
  const [primaryReviewQueue, setPrimaryReviewQueue] = useState<BankItem[] | null>(null);
  // Flow B: full-screen review for variations of a single primary.
  // Carries the parent so the modal can label itself and the shell
  // can drop the teacher back at the parent's workshop on close.
  const [variationReviewQueue, setVariationReviewQueue] = useState<BankItem[] | null>(null);
  // When a make-similar review queue completes, we want to drop the
  // teacher back at the parent question. We stash the full BankItem
  // (not just an id) so restoration works regardless of which status
  // tab the teacher is currently on — the bank list might not contain
  // the parent if it's in a different status bucket.
  const [reviewQueueParent, setReviewQueueParent] = useState<BankItem | null>(null);

  // Open Flow B: focused review of the just-generated pending children
  // of `parent`. The modal labels itself with the parent's title and
  // collapses the action set to plain Approve / Edit / Reject (no
  // destination picker — variations are implicitly attached to their
  // parent via parent_question_id).
  const openVariationReview = async (parent: BankItem) => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      const children = res.items.filter((i) => i.parent_question_id === parent.id);
      if (children.length === 0) return;
      setActiveJob(null); // dismiss the strip — its job is done
      setOpenItem(null); // close the single-mode workshop
      setReviewQueueParent(parent);
      setVariationReviewQueue(children);
    } catch (e) {
      // Close the modal so the bank tab's error message is visible —
      // otherwise the workshop modal keeps the green CTA on screen
      // hiding the error and the teacher thinks nothing happened.
      setOpenItem(null);
      setError(e instanceof Error ? e.message : "Failed to load variations");
    }
  };

  // Open the right review flow given the current pending state.
  // Prefers Flow A (primaries) when any exist; otherwise falls back to
  // Flow B for the parent with the most pending variations. Avoids the
  // silent no-op the tray would otherwise hit when only variations are
  // pending.
  const startReview = async () => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      const primaries = res.items.filter((i) => !i.parent_question_id);
      if (primaries.length > 0) {
        setPrimaryReviewQueue(primaries);
        return;
      }
      const variations = res.items.filter((i) => i.parent_question_id);
      if (variations.length === 0) return;
      // Group variations by parent_question_id and pick the parent
      // with the most pending children — most efficient batch first.
      const byParent = new Map<string, BankItem[]>();
      for (const v of variations) {
        const pid = v.parent_question_id;
        if (!pid) continue;
        const arr = byParent.get(pid) ?? [];
        arr.push(v);
        byParent.set(pid, arr);
      }
      const sorted = Array.from(byParent.entries()).sort(
        (a, b) => b[1].length - a[1].length,
      );
      if (sorted.length === 0) return;
      const [parentId, children] = sorted[0];
      // Need the parent BankItem for the modal header. Generate-similar
      // requires the parent to be approved, so look there.
      let parentItem = items.find((i) => i.id === parentId);
      if (!parentItem) {
        const approvedRes = await teacher.bank(courseId, { status: "approved" });
        parentItem = approvedRes.items.find((i) => i.id === parentId);
      }
      if (!parentItem) {
        setError("Couldn't find the parent question for these pending variations.");
        return;
      }
      setReviewQueueParent(parentItem);
      setVariationReviewQueue(children);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pending");
    }
  };

  // Reload the bank list when the active job (lifted to the page,
  // polled there) flips to done — pulls in the freshly generated rows.
  useEffect(() => {
    if (activeJob?.status === "done") {
      reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.status, activeJob?.id]);

  return (
    <CourseSubjectContext.Provider value={courseSubject}>
    <div>
      {/* Header row: title + status chips inline + Generate. The chips
          are primary nav, not chrome — they belong up top. */}
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
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => setShowGenerate(true)}
        >
          + Generate Questions
        </button>
      </div>

      <PendingTray pendingCount={counts.pending} onReview={startReview} />

      {/* Active job banner — hidden for make-similar jobs since those
          have their own in-modal strip with the "Review them" CTA. */}
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
          {activeJob.status === "queued" && "🟡 Generation queued…"}
          {activeJob.status === "running" &&
            (activeJob.produced_count > 0
              ? `🔄 Generating questions… ${activeJob.produced_count}/${activeJob.requested_count}`
              : `🔄 Generating ${activeJob.requested_count} questions…`)}
          {activeJob.status === "done" && (
            <span>
              ✅ Generated {activeJob.produced_count}/{activeJob.requested_count} questions
            </span>
          )}
          {activeJob.status === "failed" &&
            `❌ Generation failed: ${activeJob.error_message ?? "unknown error"}`}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {/* Search bar — primary "find a question" affordance. */}
      <div className="mt-4">
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
            aria-hidden
          >
            🔍
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${counts[statusFilter] ?? 0} ${statusFilter} questions…`}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Two-pane: slim unit rail on the left, content on the right.
          The rail no longer has its own card chrome — it visually
          retreats so the content area is the focal point. */}
      <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-start">
        <aside className="md:w-52 md:shrink-0">
          <UnitRail
            units={units}
            items={items}
            selected={unitSelection}
            onSelect={(s) => {
              setUnitSelection(s);
              setOpenItem(null);
            }}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {loading ? (
            <BankSkeleton />
          ) : filteredItems.length === 0 ? (
            <EmptyState
              text={
                searchQuery.trim()
                  ? `No questions match "${searchQuery.trim()}".`
                  : emptyStateFor(statusFilter, unitSelection, counts)
              }
            />
          ) : statusFilter === "pending" || statusFilter === "rejected" ? (
            <div className="space-y-5">
              <SimpleUnitList
                items={filteredItems}
                units={units}
                onOpenItem={setOpenItem}
                onOpenHomework={setOpenHomeworkId}
                onChanged={reload}
              />
            </div>
          ) : (
            <div className="space-y-6">
              {buildUnitGroups(filteredItems, units).map((group) => (
                <ApprovedUnitFolder
                  key={group.id}
                  label={group.label}
                  items={group.items}
                  units={units}
                  onOpenItem={setOpenItem}
                  onOpenHomework={setOpenHomeworkId}
                  onChanged={reload}
                />
              ))}
            </div>
          )}
        </div>
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

      {/* ReviewModals render FIRST so that modals opened from inside
          them (Edit → WorkshopModal) stack visually on top via DOM
          order. Both share z-50; later siblings win. */}
      {primaryReviewQueue && (
        <ReviewModal
          courseId={courseId}
          queue={primaryReviewQueue}
          defaultUnitIds={
            unitSelection !== "all" && unitSelection !== "uncategorized"
              ? [unitSelection]
              : []
          }
          active={editFromReviewItem === null}
          onClose={() => {
            setPrimaryReviewQueue(null);
            reload();
          }}
          onChanged={reload}
          onEditItem={(item) => setEditFromReviewItem(item)}
        />
      )}

      {variationReviewQueue && reviewQueueParent && (
        <ReviewModal
          courseId={courseId}
          queue={variationReviewQueue}
          parent={reviewQueueParent}
          active={editFromReviewItem === null}
          onClose={() => {
            setVariationReviewQueue(null);
            // Drop the teacher back on the parent's workshop so the
            // mental thread (parent → its variations → back to parent)
            // stays intact.
            setOpenItem(reviewQueueParent);
            reload();
          }}
          onChanged={reload}
          onEditItem={(item) => setEditFromReviewItem(item)}
        />
      )}

      {openItem && (
        // Prefer the freshest copy from items (in case reload brought
        // updated content); fall back to the stashed openItem so the
        // modal stays open across status-tab switches and after
        // focused-review queue completion.
        <WorkshopModal
          item={items.find((i) => i.id === openItem.id) ?? openItem}
          onClose={() => {
            setOpenItem(null);
            setReviewQueueParent(null);
          }}
          onChanged={reload}
          onJobStarted={setActiveJob}
          activeJob={activeJob}
          onReviewVariations={openVariationReview}
        />
      )}

      {editFromReviewItem && (
        <WorkshopModal
          item={editFromReviewItem}
          editOnly
          onClose={() => setEditFromReviewItem(null)}
          onChanged={reload}
          onJobStarted={setActiveJob}
          activeJob={activeJob}
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
    </div>
    </CourseSubjectContext.Provider>
  );
}

function emptyStateFor(
  statusFilter: "pending" | "approved" | "rejected",
  unitSelection: UnitSelection,
  counts: { pending: number; approved: number; rejected: number },
): string {
  const total = counts.pending + counts.approved + counts.rejected;
  if (total === 0) {
    return "No questions yet. Hit \u201cGenerate Questions\u201d to create some.";
  }
  const where =
    unitSelection === "all"
      ? ""
      : unitSelection === "uncategorized"
        ? " in Uncategorized"
        : " in this unit";
  if (statusFilter === "pending") {
    return `No pending review${where}. New generations land here.`;
  }
  if (statusFilter === "rejected") {
    return `No rejected questions${where}.`;
  }
  return `No approved questions${where} yet. Review pending ones to add them to a homework.`;
}
