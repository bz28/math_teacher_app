"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MOCK_ASSIGNMENTS, type MockAssignment } from "@/components/teacher/assignments-data";
import { CreateAssignmentModal } from "@/components/teacher/create-assignment-modal";

type FilterCourse = string | "all";
type FilterType = "all" | "homework" | "quiz" | "test";
type FilterStatus = "all" | "published" | "grading" | "completed" | "scheduled" | "draft";

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<MockAssignment[]>(MOCK_ASSIGNMENTS);
  const [filterCourse, setFilterCourse] = useState<FilterCourse>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  // Get unique course names for filter
  const courseNames = [...new Set(assignments.map((a) => a.courseName))];

  const filtered = assignments.filter((a) => {
    if (filterCourse !== "all" && a.courseName !== filterCourse) return false;
    if (filterType !== "all" && a.type !== filterType) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">Assignments</h1>
          <p className="mt-0.5 text-sm text-text-muted">Homework, quizzes, and tests across all courses.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark"
        >
          + New Assignment
        </button>
      </div>

      {/* Mock data notice */}
      <div className="mt-4 rounded-[--radius-md] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
        Preview mode — using sample data. Changes reset on refresh.
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        <select
          value={filterCourse}
          onChange={(e) => setFilterCourse(e.target.value)}
          className="rounded-[--radius-sm] border border-border bg-input-bg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-primary"
        >
          <option value="all">All Courses</option>
          {courseNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
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

      {/* Assignment list */}
      <div className="mt-5 space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-[--radius-xl] border border-dashed border-border bg-surface p-12 text-center">
            <p className="text-sm font-semibold text-text-primary">No assignments match your filters</p>
            <p className="mt-1 text-xs text-text-muted">Try changing the filters above.</p>
          </div>
        ) : (
          filtered.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <AssignmentCard assignment={a} />
            </motion.div>
          ))
        )}
      </div>

      {/* Create assignment modal */}
      {showCreate && (
        <CreateAssignmentModal
          onClose={() => setShowCreate(false)}
          onCreated={(data) => {
            const newAssignment: MockAssignment = {
              id: `a-new-${Date.now()}`,
              courseId: "c1",
              courseName: "Algebra I",
              title: data.title,
              type: data.type,
              status: "published",
              dueAt: data.dueDate || null,
              sectionNames: data.sections.length > 0 ? data.sections.map((_, i) => ["Period 3", "Period 5", "Block A"][i] || `Section ${i + 1}`) : ["Period 3"],
              totalStudents: data.sections.length * 20,
              submitted: 0,
              graded: 0,
              avgScore: null,
              createdAt: new Date().toISOString().split("T")[0],
            };
            setAssignments([newAssignment, ...assignments]);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function AssignmentCard({ assignment: a }: { assignment: MockAssignment }) {
  const typeIcon = a.type === "test" || a.type === "quiz" ? "📋" : "📝";

  const statusColors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600 dark:bg-gray-500/10",
    published: "bg-blue-50 text-blue-600 dark:bg-blue-500/10",
    grading: "bg-amber-50 text-amber-600 dark:bg-amber-500/10",
    completed: "bg-green-50 text-green-600 dark:bg-green-500/10",
    scheduled: "bg-purple-50 text-purple-600 dark:bg-purple-500/10",
  };

  const progressPct = a.totalStudents > 0 ? Math.round((a.submitted / a.totalStudents) * 100) : 0;
  const pendingReview = a.submitted - a.graded;

  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-5 transition-colors hover:border-primary/30">
      {/* Top row: title + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base">{typeIcon}</span>
            <h3 className="text-base font-bold text-text-primary">{a.title}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            <span>{a.courseName}</span>
            <span className="text-border">·</span>
            <span>{a.sectionNames.join(", ")}</span>
            <span className="text-border">·</span>
            <span className="capitalize">{a.type}</span>
            {a.dueAt && (
              <>
                <span className="text-border">·</span>
                <span>Due {a.dueAt}</span>
              </>
            )}
          </div>
        </div>
        <span className={`shrink-0 rounded-[--radius-pill] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusColors[a.status] ?? ""}`}>
          {a.status}
        </span>
      </div>

      {/* Progress bar (for non-scheduled/draft) */}
      {a.status !== "scheduled" && a.status !== "draft" && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{a.submitted}/{a.totalStudents} submitted</span>
            {a.avgScore !== null && <span>Avg: {a.avgScore}%</span>}
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-text-muted">
            <span>{a.graded} graded</span>
            {pendingReview > 0 && (
              <span className="font-semibold text-amber-600">{pendingReview} pending review</span>
            )}
          </div>
        </div>
      )}

      {/* Scheduled info */}
      {a.status === "scheduled" && (
        <div className="mt-3 text-xs text-text-muted">
          Opens {a.dueAt} · {a.totalStudents} students · {a.sectionNames.join(", ")}
        </div>
      )}
    </div>
  );
}
