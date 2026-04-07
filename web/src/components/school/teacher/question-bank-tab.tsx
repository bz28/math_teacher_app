"use client";

import { useEffect, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankCounts,
  type BankItem,
  type BankJob,
  type TeacherDocument,
  type TeacherUnit,
} from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { QuestionDetailModal } from "./question-detail-modal";
import { ReviewModeModal } from "./review-mode-modal";
import { STATUS_BADGE, STATUS_FILTERS } from "./bank-styles";

const POLL_LIMIT_MS = 5 * 60 * 1000;

export function QuestionBankTab({ courseId }: { courseId: string }) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [counts, setCounts] = useState<BankCounts>({
    pending: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
  });
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [activeJob, setActiveJob] = useState<BankJob | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<BankItem[] | null>(null);

  // Open review mode with all currently-pending items in the bank as the
  // frozen queue. Hits a fresh fetch so we don't accidentally review stale
  // items if the current filter is hiding pending ones.
  const startReview = async () => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      setReviewQueue(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pending");
    }
  };

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = statusFilter === "all" ? undefined : { status: statusFilter };
      const res = await teacher.bank(courseId, filters);
      setItems(res.items);
      setCounts(res.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bank");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, statusFilter]);

  // Poll active job until done/failed, then refresh the bank.
  // Hard cap at POLL_LIMIT_MS — if the backend process died after the row was
  // created but before the asyncio task ran, the job stays "queued" forever.
  useEffect(() => {
    if (!activeJob || activeJob.status === "done" || activeJob.status === "failed") return;
    const startedAt = Date.now();
    const jobId = activeJob.id;
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        setActiveJob((prev) =>
          prev && prev.id === jobId
            ? { ...prev, status: "failed", error_message: "Generation timed out — try again or refresh the page." }
            : prev,
        );
        return;
      }
      try {
        const updated = await teacher.bankJob(courseId, jobId);
        setActiveJob((prev) => (prev && prev.id === jobId ? updated : prev));
        if (updated.status === "done") {
          reload();
        }
      } catch {
        // keep polling, transient errors are fine
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id, activeJob?.status, courseId]);

  // Auto-clear a finished job banner after a few seconds
  useEffect(() => {
    if (activeJob?.status === "done") {
      const t = setTimeout(() => setActiveJob(null), 4000);
      return () => clearTimeout(t);
    }
  }, [activeJob?.status]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Question Bank</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {counts.approved} approved · {counts.pending} pending · {counts.rejected} rejected
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counts.pending > 0 && (
            <button
              type="button"
              className="rounded-[--radius-md] border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
              onClick={startReview}
            >
              Review pending ({counts.pending}) →
            </button>
          )}
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
      {activeJob && (
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
            <div className="flex items-center justify-between gap-3">
              <span>
                ✅ Generated {activeJob.produced_count}/{activeJob.requested_count} questions
              </span>
              <button
                type="button"
                onClick={startReview}
                className="rounded-[--radius-sm] bg-green-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-800"
              >
                Review now →
              </button>
            </div>
          )}
          {activeJob.status === "failed" &&
            `❌ Generation failed: ${activeJob.error_message ?? "unknown error"}`}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {/* Status filter chips */}
      <div className="mt-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`rounded-[--radius-pill] px-3 py-1 text-xs font-semibold transition-colors ${
              statusFilter === f.key
                ? "bg-primary text-white"
                : "border border-border-light text-text-secondary hover:bg-bg-subtle"
            }`}
          >
            {f.label}
            {f.key !== "all" && <span className="ml-1 opacity-70">({counts[f.key] ?? 0})</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            text={
              counts.pending + counts.approved + counts.rejected === 0
                ? "No questions yet. Hit \u201cGenerate Questions\u201d to create some."
                : "No questions match this filter."
            }
          />
        ) : (
          items.map((item) => (
            <BankItemCard
              key={item.id}
              item={item}
              onOpen={() => setOpenItemId(item.id)}
              onChanged={reload}
            />
          ))
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

      {openItemId && (() => {
        const openItem = items.find((i) => i.id === openItemId);
        if (!openItem) return null;
        return (
          <QuestionDetailModal
            item={openItem}
            onClose={() => setOpenItemId(null)}
            onChanged={reload}
          />
        );
      })()}

      {reviewQueue && (
        <ReviewModeModal
          initialQueue={reviewQueue}
          onClose={() => {
            setReviewQueue(null);
            reload();
          }}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function BankItemCard({
  item,
  onOpen,
  onChanged,
}: {
  item: BankItem;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { busy, error, run } = useAsyncAction();

  // Status-driven left-border accent so the teacher can scan the bank
  // and immediately spot which questions still need attention.
  const statusBorder =
    item.status === "pending"
      ? "border-l-4 border-l-amber-400"
      : item.status === "approved"
        ? "border-l-4 border-l-green-500"
        : "opacity-60";

  const approve = () =>
    run(async () => {
      await teacher.approveBankItem(item.id);
      onChanged();
    });

  const reject = () =>
    run(async () => {
      await teacher.rejectBankItem(item.id);
      onChanged();
    });

  const remove = () =>
    run(async () => {
      await teacher.deleteBankItem(item.id);
      setConfirmingDelete(false);
      onChanged();
    });

  return (
    <div className={`rounded-[--radius-lg] border border-border-light bg-surface p-4 transition-shadow hover:shadow-sm ${statusBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 cursor-pointer text-left text-sm text-text-primary hover:text-primary"
          title="Open question"
        >
          <MathText text={item.question} />
        </button>
        <span
          className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
            STATUS_BADGE[item.status] ?? ""
          }`}
        >
          {item.status}
        </span>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirmingDelete ? (
          <>
            <span className="text-xs font-semibold text-red-700">Delete this question?</span>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-[--radius-sm] bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Yes, delete
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
              className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {item.status === "pending" && (
              <>
                <button
                  onClick={approve}
                  disabled={busy}
                  className="rounded-[--radius-sm] bg-green-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                  title="Approve for use in homework, tests, and student practice"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={reject}
                  disabled={busy}
                  className="rounded-[--radius-sm] bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                  title="Hide from students. Kept in your records."
                >
                  ✕ Reject
                </button>
              </>
            )}
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="ml-auto rounded-[--radius-sm] border border-red-300 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              🗑
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const QUANTITY_CHIPS = [5, 10, 20, 50] as const;

function GenerateQuestionsModal({
  courseId,
  onClose,
  onStarted,
}: {
  courseId: string;
  onClose: () => void;
  onStarted: (job: BankJob) => void;
}) {
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  // Manual override of the auto-defaulted unit. Null until the teacher
  // explicitly picks. The actual `unitId` value is derived during render
  // — see `effectiveUnitId` below.
  const [overrideUnitId, setOverrideUnitId] = useState<string | null | undefined>(undefined);
  const [count, setCount] = useState<number>(20);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [constraint, setConstraint] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([teacher.units(courseId), teacher.documents(courseId)])
      .then(([u, d]) => {
        setUnits(u.units);
        setDocs(d.documents);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load materials"))
      .finally(() => setLoading(false));
  }, [courseId]);

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const topUnits = units.filter((u) => u.parent_id === null);
  const subfoldersOf = (parentId: string) => units.filter((u) => u.parent_id === parentId);
  const docsIn = (uid: string | null) => docs.filter((d) => d.unit_id === uid);

  // Smart "Save to" default, derived during render. If the teacher hasn't
  // explicitly picked a target yet AND all selected docs share a unit, use
  // that unit. Otherwise fall back to the override (or null/Uncategorized).
  const autoUnitId: string | null = (() => {
    if (selectedDocs.size === 0) return null;
    const selected = docs.filter((d) => selectedDocs.has(d.id));
    const shared = selected[0]?.unit_id ?? null;
    return selected.every((d) => d.unit_id === shared) ? shared : null;
  })();
  const unitId = overrideUnitId === undefined ? autoUnitId : overrideUnitId;

  const readableSelectedCount = Array.from(selectedDocs).filter((id) => {
    const d = docs.find((x) => x.id === id);
    return d && d.file_type !== "application/pdf";
  }).length;
  const onlyPdfsSelected = selectedDocs.size > 0 && readableSelectedCount === 0;

  const submit = async () => {
    if (count < 1 || count > 50) {
      setError("Pick a quantity");
      return;
    }
    if (onlyPdfsSelected) {
      setError(
        "Selected documents are all PDFs (skipped). Pick at least one image, or unselect all to generate from the unit name only.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const job = await teacher.generateBank(courseId, {
        count,
        unit_id: unitId,
        document_ids: Array.from(selectedDocs),
        constraint: constraint.trim() || null,
      });
      onStarted(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
      setSubmitting(false);
    }
  };

  // Build all the doc-display groups upfront. Each group is a unit (or
  // "Uncategorized") with its docs. Subfolders are flattened with a
  // breadcrumb in the header.
  const docGroups = (() => {
    const groups: { id: string; label: string; docs: TeacherDocument[] }[] = [];
    const uncategorized = docsIn(null);
    if (uncategorized.length > 0) {
      groups.push({ id: "uncategorized", label: "Uncategorized", docs: uncategorized });
    }
    for (const top of topUnits) {
      const topDocs = docsIn(top.id);
      if (topDocs.length > 0) {
        groups.push({ id: top.id, label: top.name, docs: topDocs });
      }
      for (const sub of subfoldersOf(top.id)) {
        const subDocs = docsIn(sub.id);
        if (subDocs.length > 0) {
          groups.push({ id: sub.id, label: `${top.name} / ${sub.name}`, docs: subDocs });
        }
      }
    }
    return groups;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">Generate Questions</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Constraint — the hero */}
          <label className="block text-sm font-bold text-text-primary">
            What kind of questions do you want?
          </label>
          <textarea
            value={constraint}
            onChange={(e) => setConstraint(e.target.value)}
            rows={4}
            maxLength={500}
            autoFocus
            placeholder='e.g. "Only word problems with friendly numbers, match the textbook style, mostly medium difficulty"'
            className="mt-2 w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />

          {/* Source materials — visual grid */}
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-bold text-text-primary">Source materials</label>
              <span className="text-[11px] text-text-muted">
                optional but recommended
              </span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              Pick the materials Claude should read. Without sources, generation falls back to
              the topic name only. PDFs aren&rsquo;t AI-readable yet.
            </p>

            {loading ? (
              <p className="mt-4 text-sm text-text-muted">Loading materials…</p>
            ) : docGroups.length === 0 ? (
              <div className="mt-3 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-6 text-center text-xs text-text-muted">
                No materials uploaded yet. Add some in the Materials tab, or just leave this
                blank and use instructions only.
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {docGroups.map((group) => (
                  <div key={group.id}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      📁 {group.label}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {group.docs.map((d) => (
                        <DocCard
                          key={d.id}
                          doc={d}
                          selected={selectedDocs.has(d.id)}
                          onToggle={() => toggleDoc(d.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quantity + Save-to footer row */}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border-light pt-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
                How many?
              </label>
              <div className="flex gap-1">
                {QUANTITY_CHIPS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`rounded-[--radius-pill] px-3 py-1 text-xs font-bold transition-colors ${
                      count === n
                        ? "bg-primary text-white"
                        : "border border-border-light text-text-secondary hover:bg-bg-subtle"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
                Save to
              </label>
              <select
                value={unitId ?? ""}
                onChange={(e) => setOverrideUnitId(e.target.value || null)}
                className="rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-1.5 text-xs text-text-primary focus:border-primary focus:outline-none"
              >
                <option value="">Uncategorized</option>
                {topUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                {topUnits.flatMap((u) =>
                  subfoldersOf(u.id).map((sf) => (
                    <option key={sf.id} value={sf.id}>
                      {u.name} / {sf.name}
                    </option>
                  )),
                )}
              </select>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          {onlyPdfsSelected && (
            <p className="mt-3 text-[11px] text-amber-600">
              Heads up: every selected doc is a PDF, which Claude can&rsquo;t read yet. Pick at
              least one image or unselect everything.
            </p>
          )}
        </div>

        {/* Footer — single primary action */}
        <div className="flex items-center justify-end border-t border-border-light px-6 py-3">
          <button
            type="submit"
            disabled={submitting || loading || onlyPdfsSelected}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Starting…" : "✨ Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DocCard({
  doc,
  selected,
  onToggle,
}: {
  doc: TeacherDocument;
  selected: boolean;
  onToggle: () => void;
}) {
  const isPdf = doc.file_type === "application/pdf";
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isPdf}
      title={isPdf ? "PDFs are not yet AI-readable" : doc.filename}
      className={`relative flex items-center gap-2 rounded-[--radius-md] border p-3 text-left text-xs transition-colors ${
        isPdf
          ? "cursor-not-allowed border-border-light bg-bg-subtle opacity-50"
          : selected
            ? "border-primary bg-primary-bg/40 text-primary"
            : "border-border-light bg-surface hover:border-primary/40 hover:bg-primary-bg/10"
      }`}
    >
      <span className="text-base">📄</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-text-primary">
        {doc.filename}
      </span>
      {selected && !isPdf && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
          ✓
        </span>
      )}
      {isPdf && (
        <span className="absolute right-1.5 top-1.5 rounded-[--radius-pill] bg-text-muted/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
          skip
        </span>
      )}
    </button>
  );
}
