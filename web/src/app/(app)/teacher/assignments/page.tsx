"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { teacher, type TeacherAssignment } from "@/lib/api";
import { GradingView } from "@/components/teacher/grading-view";

type FilterType = "all" | "homework" | "quiz" | "test";
type FilterStatus = "all" | "published" | "grading" | "completed" | "scheduled" | "draft";

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [gradingAssignment, setGradingAssignment] = useState<TeacherAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setError(null);
    setLoading(true);
    teacher.allAssignments()
      .then((d) => setAssignments(d.assignments))
      .catch((err) => setError((err as Error).message || "Failed to load assignments"))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const filtered = assignments.filter((a) => {
    if (filterType !== "all" && a.type !== filterType) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    return true;
  });

  // Grading view takes over the full page
  if (gradingAssignment) {
    return (
      <GradingView
        assignmentId={gradingAssignment.id}
        assignmentTitle={gradingAssignment.title}
        onBack={() => { setGradingAssignment(null); reload(); }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">Assignments</h1>
          <p className="mt-0.5 text-sm text-text-muted">Homework, quizzes, and tests across all courses.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as FilterType)}
          className="rounded-[--radius-sm] border border-border bg-input-bg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-primary"
        >
          <option value="all">All Types</option>
          <option value="homework">Homework</option>
          <option value="quiz">Quiz</option>
          <option value="test">Test</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
          className="rounded-[--radius-sm] border border-border bg-input-bg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-primary"
        >
          <option value="all">All Status</option>
          <option value="published">Published</option>
          <option value="grading">Grading</option>
          <option value="completed">Completed</option>
          <option value="scheduled">Scheduled</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-center justify-between rounded-[--radius-md] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          <span>{error}</span>
          <button onClick={() => reload()} className="ml-2 font-semibold hover:underline">Retry</button>
        </div>
      )}

      {/* Assignment list */}
      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="py-12 text-center text-sm text-text-muted">Loading assignments...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[--radius-xl] border border-dashed border-border bg-surface p-12 text-center">
            <p className="text-sm font-semibold text-text-primary">
              {assignments.length === 0 ? "No assignments yet" : "No assignments match your filters"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {assignments.length === 0
                ? "Create assignments from the course detail page."
                : "Try changing the filters above."}
            </p>
          </div>
        ) : (
          filtered.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <AssignmentCard assignment={a} onClick={() => setGradingAssignment(a)} />
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

function AssignmentCard({ assignment: a, onClick }: { assignment: TeacherAssignment; onClick?: () => void }) {
  const typeIcon = a.type === "test" || a.type === "quiz" ? "📋" : "📝";

  const statusColors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600 dark:bg-gray-500/10",
    published: "bg-blue-50 text-blue-600 dark:bg-blue-500/10",
    grading: "bg-amber-50 text-amber-600 dark:bg-amber-500/10",
    completed: "bg-green-50 text-green-600 dark:bg-green-500/10",
    scheduled: "bg-purple-50 text-purple-600 dark:bg-purple-500/10",
  };

  const progressPct = a.total_students > 0 ? Math.round((a.submitted / a.total_students) * 100) : 0;
  const pendingReview = a.submitted - a.graded;

  return (
    <div
      onClick={onClick}
      className={`rounded-[--radius-lg] border border-border-light bg-surface p-5 transition-colors hover:border-primary/30 ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base">{typeIcon}</span>
            <h3 className="text-base font-bold text-text-primary">{a.title}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            <span>{a.section_names.join(", ") || "No sections"}</span>
            <span className="text-border">·</span>
            <span className="capitalize">{a.type}</span>
            {a.due_at && (
              <>
                <span className="text-border">·</span>
                <span>Due {a.due_at.split("T")[0]}</span>
              </>
            )}
          </div>
        </div>
        <span className={`shrink-0 rounded-[--radius-pill] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusColors[a.status] ?? ""}`}>
          {a.status}
        </span>
      </div>

      {a.status !== "scheduled" && a.status !== "draft" && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{a.submitted}/{a.total_students} submitted</span>
            {a.avg_score !== null && <span>Avg: {a.avg_score}%</span>}
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-text-muted">
            <span>{a.graded} graded</span>
            {pendingReview > 0 && (
              <span className="font-semibold text-amber-600">{pendingReview} pending review</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
