"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { teacher, type TeacherSubmission } from "@/lib/api";

interface GradingViewProps {
  assignmentId: string;
  assignmentTitle: string;
  onBack: () => void;
}

export function GradingView({ assignmentId, assignmentTitle, onBack }: GradingViewProps) {
  const [submissions, setSubmissions] = useState<TeacherSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "reviewed" | "missing">("all");
  const [showOverride, setShowOverride] = useState(false);
  const [overrideScore, setOverrideScore] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    teacher.submissions(assignmentId)
      .then((d) => {
        setSubmissions(d.submissions);
        // Auto-select first pending if nothing selected
        if (!selectedId) {
          const pending = d.submissions.find((s) => s.status === "ai_graded");
          setSelectedId(pending?.id ?? d.submissions[0]?.id ?? null);
        }
      })
      .finally(() => setLoading(false));
  }, [assignmentId, selectedId]);

  useEffect(() => { reload(); }, [reload]);

  const selected = submissions.find((s) => s.id === selectedId) ?? null;
  const gradedCount = submissions.filter((s) => s.status === "teacher_reviewed").length;
  const pendingCount = submissions.filter((s) => s.status === "ai_graded").length;

  const filtered = submissions.filter((s) => {
    if (filter === "pending") return s.status === "ai_graded";
    if (filter === "reviewed") return s.status === "teacher_reviewed";
    if (filter === "missing") return s.status === "missing";
    return true;
  });

  async function handleApprove(subId: string) {
    try {
      setError(null);
      await teacher.gradeSubmission(subId, { action: "approve" });
      reload();
      // Auto-advance to next pending
      const nextPending = submissions.find((s) => s.id !== subId && s.status === "ai_graded");
      if (nextPending) setSelectedId(nextPending.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleOverride(subId: string, newScore: number) {
    try {
      setError(null);
      await teacher.gradeSubmission(subId, { action: "override", teacher_score: newScore });
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-text-muted">Loading submissions...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-text-muted hover:text-primary">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-extrabold tracking-tight text-text-primary">{assignmentTitle}</h1>
          <p className="text-xs text-text-muted">
            {gradedCount}/{submissions.length} graded
            {pendingCount > 0 && <span className="ml-1 font-semibold text-amber-600">· {pendingCount} pending</span>}
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-[--radius-md] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {submissions.length === 0 ? (
        <div className="mt-8 rounded-[--radius-xl] border border-dashed border-border bg-surface p-12 text-center">
          <p className="text-sm font-semibold text-text-primary">No submissions yet</p>
          <p className="mt-1 text-xs text-text-muted">Students haven&apos;t submitted work for this assignment.</p>
        </div>
      ) : (
        /* Split view */
        <div className="mt-4 flex gap-4" style={{ minHeight: "calc(100vh - 200px)" }}>
          {/* Left: student list */}
          <div className="w-56 shrink-0">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="mb-3 w-full rounded-[--radius-sm] border border-border bg-input-bg px-2 py-1.5 text-xs text-text-primary outline-none focus:border-primary"
            >
              <option value="all">All ({submissions.length})</option>
              <option value="pending">Pending ({pendingCount})</option>
              <option value="reviewed">Reviewed ({gradedCount})</option>
            </select>

            <div className="space-y-1">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedId(s.id); setShowOverride(false); }}
                  className={`flex w-full items-center justify-between rounded-[--radius-md] px-3 py-2 text-left transition-colors ${
                    selectedId === s.id
                      ? "bg-primary-bg border border-primary/30"
                      : "hover:bg-primary-bg/30 border border-transparent"
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold text-text-primary">{s.student_name}</div>
                    <div className="text-[10px] text-text-muted">
                      {s.status === "teacher_reviewed" ? "Reviewed" : s.status === "ai_graded" ? "Needs review" : s.status}
                    </div>
                  </div>
                  <div className="text-right">
                    {s.final_score !== null ? (
                      <span className="text-xs font-bold text-text-primary">{s.final_score}</span>
                    ) : s.ai_score !== null ? (
                      <span className="text-xs font-semibold text-amber-600">{s.ai_score}</span>
                    ) : null}
                    <div className="mt-0.5">
                      {s.status === "teacher_reviewed" && <span className="text-[10px] text-green-600">✓</span>}
                      {s.status === "ai_graded" && <span className="text-[10px] text-amber-600">●</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: submission detail */}
          <div className="flex-1 rounded-[--radius-lg] border border-border-light bg-surface p-6">
            {!selected ? (
              <div className="flex h-full items-center justify-center text-sm text-text-muted">
                Select a student to view their submission
              </div>
            ) : (
              <motion.div key={selected.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {/* Student header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-text-primary">{selected.student_name}</h2>
                    <p className="text-xs text-text-muted">
                      {selected.submitted_at ? `Submitted ${new Date(selected.submitted_at).toLocaleDateString()}` : "Not submitted"}
                      {selected.is_late && <span className="ml-1 font-semibold text-red-500">Late</span>}
                    </p>
                  </div>
                  {selected.ai_score !== null && (
                    <div className="text-right">
                      <div className="text-xs text-text-muted">AI Score</div>
                      <div className="text-2xl font-extrabold text-text-primary">{selected.ai_score}</div>
                    </div>
                  )}
                </div>

                {/* Mock student work image */}
                <div className="mt-4 flex h-32 items-center justify-center rounded-[--radius-lg] border border-dashed border-border bg-primary-bg/10">
                  <div className="text-center text-xs text-text-muted">
                    <span className="text-2xl">📷</span>
                    <p className="mt-1">Student work photo would appear here</p>
                  </div>
                </div>

                {/* Problem-by-problem breakdown */}
                {selected.ai_breakdown && selected.ai_breakdown.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-sm font-bold text-text-primary">AI Assessment</h3>
                    <div className="mt-3 space-y-3">
                      {selected.ai_breakdown.map((p, i) => (
                        <div
                          key={i}
                          className={`rounded-[--radius-md] border p-3 ${
                            p.flagged
                              ? "border-amber-200 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/5"
                              : "border-border-light"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-text-primary">{p.problem}</span>
                            <span className={`text-xs font-bold ${p.score === p.max_score ? "text-green-600" : p.score === 0 ? "text-red-500" : "text-amber-600"}`}>
                              {p.score}/{p.max_score}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-text-secondary">{p.note}</p>
                          {p.flagged && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                              ⚠ Flagged for review
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-5 flex items-center justify-between border-t border-border-light pt-4">
                  <div className="text-sm">
                    <span className="text-text-muted">Score: </span>
                    <span className="text-lg font-extrabold text-text-primary">
                      {selected.final_score ?? selected.ai_score ?? "—"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {selected.status === "ai_graded" && (
                      <>
                        <button
                          onClick={() => handleApprove(selected.id)}
                          className="rounded-[--radius-sm] bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700"
                        >
                          Approve AI Grade
                        </button>
                        {!showOverride ? (
                          <button
                            onClick={() => { setShowOverride(true); setOverrideScore(String(selected.ai_score ?? "")); }}
                            className="rounded-[--radius-sm] border border-border px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-primary-bg/50"
                          >
                            Override
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={overrideScore}
                              onChange={(e) => setOverrideScore(e.target.value)}
                              min={0} max={100} autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && overrideScore) { handleOverride(selected.id, Number(overrideScore)); setShowOverride(false); }
                                if (e.key === "Escape") setShowOverride(false);
                              }}
                              className="w-16 rounded-[--radius-sm] border border-primary bg-input-bg px-2 py-1.5 text-xs text-text-primary outline-none"
                            />
                            <button
                              onClick={() => { if (overrideScore) { handleOverride(selected.id, Number(overrideScore)); setShowOverride(false); } }}
                              className="rounded-[--radius-sm] bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                            >
                              Save
                            </button>
                            <button onClick={() => setShowOverride(false)} className="text-xs font-semibold text-text-muted hover:text-text-secondary">
                              Cancel
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {selected.status === "teacher_reviewed" && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
                        ✓ Reviewed · Score: {selected.final_score}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
