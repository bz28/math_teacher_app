"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MOCK_SUBMISSIONS, type MockSubmission, type MockAssignment } from "./assignments-data";

interface GradingViewProps {
  assignment: MockAssignment;
  onBack: () => void;
}

export function GradingView({ assignment, onBack }: GradingViewProps) {
  const [submissions, setSubmissions] = useState<MockSubmission[]>(
    MOCK_SUBMISSIONS.filter((s) => s.assignmentId === assignment.id)
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    submissions.find((s) => s.status === "ai_graded")?.id ?? submissions[0]?.id ?? null
  );
  const [filter, setFilter] = useState<"all" | "pending" | "reviewed" | "missing">("all");
  const [showOverride, setShowOverride] = useState(false);
  const [overrideScore, setOverrideScore] = useState("");

  const selected = submissions.find((s) => s.id === selectedId) ?? null;
  const gradedCount = submissions.filter((s) => s.status === "teacher_reviewed").length;
  const pendingCount = submissions.filter((s) => s.status === "ai_graded").length;

  const filtered = submissions.filter((s) => {
    if (filter === "pending") return s.status === "ai_graded";
    if (filter === "reviewed") return s.status === "teacher_reviewed";
    if (filter === "missing") return s.status === "missing";
    return true;
  });

  function handleApprove(subId: string) {
    const updated = submissions.map((s) =>
      s.id === subId ? { ...s, status: "teacher_reviewed" as const, finalScore: s.aiScore } : s
    );
    setSubmissions(updated);
    // Auto-advance to next pending (use updated array, not stale state)
    const nextPending = updated.find((s) => s.id !== subId && s.status === "ai_graded");
    if (nextPending) setSelectedId(nextPending.id);
  }

  function handleOverride(subId: string, newScore: number) {
    setSubmissions(submissions.map((s) =>
      s.id === subId ? { ...s, status: "teacher_reviewed" as const, teacherScore: newScore, finalScore: newScore } : s
    ));
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-text-muted hover:text-primary">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-extrabold tracking-tight text-text-primary">{assignment.title}</h1>
          <p className="text-xs text-text-muted">
            {assignment.courseName} · {gradedCount}/{submissions.length} graded
            {pendingCount > 0 && <span className="ml-1 font-semibold text-amber-600">· {pendingCount} pending</span>}
          </p>
        </div>
      </div>

      {/* Split view */}
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
            <option value="missing">Missing ({submissions.filter((s) => s.status === "missing").length})</option>
          </select>

          <div className="space-y-1">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`flex w-full items-center justify-between rounded-[--radius-md] px-3 py-2 text-left transition-colors ${
                  selectedId === s.id
                    ? "bg-primary-bg border border-primary/30"
                    : "hover:bg-primary-bg/30 border border-transparent"
                }`}
              >
                <div>
                  <div className="text-xs font-semibold text-text-primary">{s.studentName}</div>
                  <div className="text-[10px] text-text-muted">
                    {s.status === "missing" ? "Not submitted" :
                     s.status === "teacher_reviewed" ? "Reviewed" : "Needs review"}
                  </div>
                </div>
                <div className="text-right">
                  {s.finalScore !== null ? (
                    <span className="text-xs font-bold text-text-primary">{s.finalScore}</span>
                  ) : s.aiScore !== null ? (
                    <span className="text-xs font-semibold text-amber-600">{s.aiScore}</span>
                  ) : null}
                  <div className="mt-0.5">
                    {s.status === "teacher_reviewed" && <span className="text-[10px] text-green-600">✓</span>}
                    {s.status === "ai_graded" && <span className="text-[10px] text-amber-600">●</span>}
                    {s.status === "missing" && <span className="text-[10px] text-red-500">✗</span>}
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
          ) : selected.status === "missing" ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-3xl">📭</div>
              <p className="mt-3 text-sm font-semibold text-text-primary">{selected.studentName}</p>
              <p className="mt-1 text-xs text-text-muted">Has not submitted this assignment.</p>
            </div>
          ) : (
            <motion.div key={selected.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {/* Student header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-text-primary">{selected.studentName}</h2>
                  <p className="text-xs text-text-muted">
                    Submitted {selected.submittedAt ? new Date(selected.submittedAt).toLocaleDateString() : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">AI Score</div>
                  <div className="text-2xl font-extrabold text-text-primary">{selected.aiScore}</div>
                </div>
              </div>

              {/* Mock student work image */}
              <div className="mt-4 flex h-32 items-center justify-center rounded-[--radius-lg] border border-dashed border-border bg-primary-bg/10">
                <div className="text-center text-xs text-text-muted">
                  <span className="text-2xl">📷</span>
                  <p className="mt-1">Student work photo would appear here</p>
                </div>
              </div>

              {/* Problem-by-problem breakdown */}
              <div className="mt-5">
                <h3 className="text-sm font-bold text-text-primary">AI Assessment</h3>
                <div className="mt-3 space-y-3">
                  {selected.aiBreakdown.map((p, i) => (
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
                        <span className={`text-xs font-bold ${p.score === p.maxScore ? "text-green-600" : p.score === 0 ? "text-red-500" : "text-amber-600"}`}>
                          {p.score}/{p.maxScore}
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

              {/* Teacher note */}
              <div className="mt-5">
                <label className="text-xs font-semibold text-text-secondary">Note to student (optional)</label>
                <textarea
                  placeholder="Add feedback for the student..."
                  className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-primary"
                  rows={2}
                />
              </div>

              {/* Actions */}
              <div className="mt-5 flex items-center justify-between border-t border-border-light pt-4">
                <div className="text-sm">
                  <span className="text-text-muted">Total: </span>
                  <span className="text-lg font-extrabold text-text-primary">{selected.aiScore}/100</span>
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
                          onClick={() => { setShowOverride(true); setOverrideScore(String(selected.aiScore)); }}
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
                            min={0}
                            max={100}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && overrideScore) {
                                handleOverride(selected.id, Number(overrideScore));
                                setShowOverride(false);
                              }
                              if (e.key === "Escape") setShowOverride(false);
                            }}
                            className="w-16 rounded-[--radius-sm] border border-primary bg-input-bg px-2 py-1.5 text-xs text-text-primary outline-none"
                            placeholder="0-100"
                          />
                          <button
                            onClick={() => { if (overrideScore) { handleOverride(selected.id, Number(overrideScore)); setShowOverride(false); } }}
                            className="rounded-[--radius-sm] bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setShowOverride(false)}
                            className="text-xs font-semibold text-text-muted hover:text-text-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {selected.status === "teacher_reviewed" && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
                      ✓ Reviewed · Score: {selected.finalScore}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
