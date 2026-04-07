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
import { Field } from "@/components/school/shared/field";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { QuestionDetailModal } from "./question-detail-modal";
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
      <div className="flex items-center justify-between">
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
          {activeJob.status === "done" &&
            `✅ Generated ${activeJob.produced_count}/${activeJob.requested_count} questions. Refreshing…`}
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
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4 transition-shadow hover:shadow-sm">
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
  const [unitId, setUnitId] = useState<string>("");
  const [count, setCount] = useState(20);
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

  const readableSelectedCount = Array.from(selectedDocs).filter((id) => {
    const d = docs.find((x) => x.id === id);
    return d && d.file_type !== "application/pdf";
  }).length;

  const submit = async () => {
    if (count < 1 || count > 50) {
      setError("Count must be between 1 and 50");
      return;
    }
    if (selectedDocs.size > 0 && readableSelectedCount === 0) {
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
        unit_id: unitId || null,
        document_ids: Array.from(selectedDocs),
        constraint: constraint.trim() || null,
      });
      onStarted(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="text-lg font-bold text-text-primary">Generate Questions</h2>
        <p className="mt-1 text-xs text-text-muted">
          Pick the source materials, how many questions, and any extra instructions
          (style, difficulty, what to skip — anything in plain English).
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-text-muted">Loading materials…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">
                Source documents
              </label>
              <p className="mt-1 text-[11px] text-text-muted">
                Pick the materials Claude should read when writing questions. Recommended for
                grounded, on-curriculum questions — leave empty to generate purely from the
                unit name. PDFs aren&rsquo;t AI-readable yet.
              </p>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-[--radius-md] border border-border-light bg-bg-base p-2">
                {docs.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-text-muted">
                    No materials uploaded yet. Add some in the Materials tab.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {docsIn(null).map((d) => (
                      <DocCheckbox
                        key={d.id}
                        doc={d}
                        checked={selectedDocs.has(d.id)}
                        onToggle={() => toggleDoc(d.id)}
                      />
                    ))}
                    {topUnits.map((u) => (
                      <li key={u.id}>
                        <div className="mt-2 px-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                          📁 {u.name}
                        </div>
                        {docsIn(u.id).map((d) => (
                          <DocCheckbox
                            key={d.id}
                            doc={d}
                            checked={selectedDocs.has(d.id)}
                            onToggle={() => toggleDoc(d.id)}
                          />
                        ))}
                        {subfoldersOf(u.id).map((sf) => (
                          <div key={sf.id}>
                            <div className="ml-3 mt-1 px-1 text-[10px] font-semibold text-text-muted">
                              📂 {sf.name}
                            </div>
                            {docsIn(sf.id).map((d) => (
                              <div key={d.id} className="ml-3">
                                <DocCheckbox
                                  doc={d}
                                  checked={selectedDocs.has(d.id)}
                                  onToggle={() => toggleDoc(d.id)}
                                />
                              </div>
                            ))}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                {selectedDocs.size} selected
                {selectedDocs.size > 0 && selectedDocs.size !== readableSelectedCount && (
                  <span className="text-amber-600"> · {readableSelectedCount} AI-readable</span>
                )}
              </p>
            </div>

            <Field label="How many questions">
              <input
                type="number"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                min={1}
                max={50}
                className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
              />
            </Field>

            <Field label="Save to">
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
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
            </Field>

            <Field label="Extra instructions (optional)">
              <textarea
                value={constraint}
                onChange={(e) => setConstraint(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. only word problems, skip anything with trig, match the textbook style"
                className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
              />
            </Field>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || loading}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DocCheckbox({
  doc,
  checked,
  onToggle,
}: {
  doc: TeacherDocument;
  checked: boolean;
  onToggle: () => void;
}) {
  const isPdf = doc.file_type === "application/pdf";
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-[--radius-sm] px-2 py-1 text-xs ${
        isPdf ? "opacity-50" : "hover:bg-bg-subtle"
      }`}
      title={isPdf ? "PDFs are not yet AI-readable" : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={isPdf}
        onChange={onToggle}
        className="h-3.5 w-3.5"
      />
      <span className="truncate text-text-primary">📄 {doc.filename}</span>
      {isPdf && <span className="ml-auto text-[10px] text-text-muted">PDF (skipped)</span>}
    </label>
  );
}
