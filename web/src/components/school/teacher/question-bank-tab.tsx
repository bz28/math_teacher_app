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
import { ApprovedUnitGroup, SimpleUnitList } from "./question-bank/unit-groups";
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
  // Data fetching extracted to a custom hook — items/units/counts/
  // loading/error/reload all live there. The hook now fetches all
  // items for the current status; unit filtering is client-side so
  // the rail can show accurate per-unit counts.
  const { items, units, counts, loading, error, reload, setError } = useBankData(
    courseId, statusFilter,
  );

  // Client-side unit filter applied to the loaded items.
  const filteredItems = useMemo(() => {
    if (unitSelection === "all") return items;
    if (unitSelection === "uncategorized")
      return items.filter((i) => i.unit_id === null);
    return items.filter((i) => i.unit_id === unitSelection);
  }, [items, unitSelection]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [openItem, setOpenItem] = useState<BankItem | null>(null);
  const [openHomeworkId, setOpenHomeworkId] = useState<string | null>(null);
  // Flow A: full-screen review for fresh primary problems. Captured at
  // open time so mid-review generations don't splice in.
  const [primaryReviewQueue, setPrimaryReviewQueue] = useState<BankItem[] | null>(null);
  // Flow B (variations) still uses the existing WorkshopModal queue
  // mode until a follow-up commit replaces it.
  const [reviewQueue, setReviewQueue] = useState<BankItem[] | null>(null);
  // When a make-similar review queue completes, we want to drop the
  // teacher back at the parent question. We stash the full BankItem
  // (not just an id) so restoration works regardless of which status
  // tab the teacher is currently on — the bank list might not contain
  // the parent if it's in a different status bucket.
  const [reviewQueueParent, setReviewQueueParent] = useState<BankItem | null>(null);

  // Open a focused review queue containing only the just-generated
  // pending children of `parent`. Replaces the global pending pool
  // with the variations the teacher just made.
  const openVariationReview = async (parent: BankItem) => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      const children = res.items.filter((i) => i.parent_question_id === parent.id);
      if (children.length === 0) return;
      setActiveJob(null); // dismiss the strip — its job is done
      setOpenItem(null); // close the single-mode workshop
      setReviewQueueParent(parent);
      setReviewQueue(children);
    } catch (e) {
      // Close the modal so the bank tab's error message is visible —
      // otherwise the workshop modal keeps the green CTA on screen
      // hiding the error and the teacher thinks nothing happened.
      setOpenItem(null);
      setError(e instanceof Error ? e.message : "Failed to load variations");
    }
  };

  // Open Flow A review with all currently-pending PRIMARY items
  // (no parent_question_id) as the frozen queue. Hits a fresh fetch so
  // we don't accidentally review stale items if the current status
  // filter is hiding pending ones.
  const startReview = async () => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      const primaries = res.items.filter((i) => !i.parent_question_id);
      if (primaries.length === 0) return;
      setPrimaryReviewQueue(primaries);
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Question Bank</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {counts.approved} approved · {counts.pending} pending · {counts.rejected} rejected
          </p>
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

      {/* Two-pane: unit rail on the left, content on the right. */}
      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start">
        <aside className="md:w-60 md:shrink-0">
          <UnitRail
            units={units}
            items={items}
            selected={unitSelection}
            onSelect={(s) => {
              setUnitSelection(s);
              // Dismiss any open workshop modal so switching units
              // feels like a navigation, not a sticky overlay.
              setOpenItem(null);
            }}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {/* Status chips */}
          <div className="flex gap-2">
            {STATUS_FILTERS.map((f) => (
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

          {/* List — Approved gets unit grouping + per-unit tabs.
              Pending and Rejected get a flat dense list. */}
          <div className="mt-4 space-y-5">
            {loading ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : filteredItems.length === 0 ? (
              <EmptyState
                text={
                  counts.pending + counts.approved + counts.rejected === 0
                    ? "No questions yet. Hit \u201cGenerate Questions\u201d to create some."
                    : statusFilter === "pending"
                      ? "No pending review. New generations land here."
                      : statusFilter === "rejected"
                        ? "No rejected questions."
                        : "No questions match this filter."
                }
              />
            ) : statusFilter === "pending" || statusFilter === "rejected" ? (
              <SimpleUnitList
                items={filteredItems}
                units={units}
                onOpenItem={setOpenItem}
                onOpenHomework={setOpenHomeworkId}
                onChanged={reload}
              />
            ) : (
              buildUnitGroups(filteredItems, units).map((group) => (
                <ApprovedUnitGroup
                  key={group.id}
                  label={group.label}
                  items={group.items}
                  units={units}
                  onOpenItem={setOpenItem}
                  onOpenHomework={setOpenHomeworkId}
                  onChanged={reload}
                />
              ))
            )}
          </div>
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

      {reviewQueue && (
        <WorkshopModal
          queue={reviewQueue}
          onClose={() => {
            setReviewQueue(null);
            // If this queue was a focused variation review, drop the
            // teacher back on the parent question instead of the bare
            // bank — keeps the mental thread intact. We rely on the
            // stashed reviewQueueParent (full BankItem) so restoration
            // works regardless of the current status tab.
            if (reviewQueueParent) {
              setOpenItem(reviewQueueParent);
              // reviewQueueParent stays set; cleared when the modal closes.
            }
            reload();
          }}
          onChanged={reload}
          onJobStarted={setActiveJob}
        />
      )}

      {primaryReviewQueue && (
        <ReviewModal
          courseId={courseId}
          queue={primaryReviewQueue}
          onClose={() => {
            setPrimaryReviewQueue(null);
            reload();
          }}
          onChanged={reload}
          onEditItem={(item) => setOpenItem(item)}
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
