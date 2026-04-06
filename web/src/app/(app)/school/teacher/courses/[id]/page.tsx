"use client";

import { use, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  getCourse,
  getSections,
  getUnits,
  getBankQuestions,
  getAssignments,
  type MockUnit,
  type MockBankQuestion,
  type MockAssignment,
} from "@/lib/school/mock-data";

type TabKey = "sections" | "materials" | "bank" | "homework" | "tests" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "sections", label: "Sections" },
  { key: "materials", label: "Materials" },
  { key: "bank", label: "Question Bank" },
  { key: "homework", label: "Homework" },
  { key: "tests", label: "Tests" },
  { key: "settings", label: "Settings" },
];

export default function CourseWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const course = getCourse(id);
  const [tab, setTab] = useState<TabKey>("sections");

  if (!course) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-text-muted">Course not found.</p>
        <Link href="/school/teacher" className="mt-4 inline-block text-sm font-semibold text-primary">
          ← Back to courses
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Breadcrumb + header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Link
          href="/school/teacher"
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← My Courses
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">{course.name}</h1>
            <p className="mt-1 text-sm text-text-secondary">
              {course.grade_level} · {course.section_count} sections · {course.student_count} students
            </p>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border-light">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.key ? "text-primary" : "text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === "sections" && <SectionsTab courseId={course.id} />}
        {tab === "materials" && <MaterialsTab courseId={course.id} />}
        {tab === "bank" && <QuestionBankTab courseId={course.id} />}
        {tab === "homework" && <AssignmentsTab courseId={course.id} type="homework" />}
        {tab === "tests" && <AssignmentsTab courseId={course.id} type="test" />}
        {tab === "settings" && <SettingsTab course={course} />}
      </div>

      <p className="mt-12 text-center text-xs text-text-muted">
        🚧 Phase 1 mock — no real data. Buttons don&rsquo;t save anything yet.
      </p>
    </div>
  );
}

// ───────── Sections tab ─────────

function SectionsTab({ courseId }: { courseId: string }) {
  const sections = getSections(courseId);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Class Sections</h2>
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => alert("(mock) New Section modal")}
        >
          + New Section
        </button>
      </div>

      {sections.length === 0 ? (
        <EmptyState text="No sections yet. Add a class period to get started." />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <div
              key={s.id}
              className="rounded-[--radius-lg] border border-border-light bg-surface p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-text-primary">{s.name}</h3>
                  <p className="mt-0.5 text-xs text-text-muted">{s.student_count} students</p>
                </div>
                <span className="rounded-[--radius-pill] bg-primary-bg px-2 py-0.5 font-mono text-xs font-bold text-primary">
                  {s.join_code}
                </span>
              </div>
              <div className="mt-4 flex gap-2">
                <button className="flex-1 rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle">
                  View Roster
                </button>
                <button className="flex-1 rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle">
                  Copy Code
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── Materials tab ─────────

function MaterialsTab({ courseId }: { courseId: string }) {
  const units = getUnits(courseId);
  const topUnits = units.filter((u) => u.parent_id === null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(topUnits[0]?.id ?? null);

  const subfolders = units.filter((u) => u.parent_id === selectedUnit);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Materials</h2>
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => alert("(mock) Upload modal")}
        >
          + Upload Files
        </button>
      </div>

      {topUnits.length === 0 ? (
        <EmptyState text="No units yet. Create a unit to start organizing materials." />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[260px_1fr]">
          {/* Left: tree */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Units</span>
              <button
                className="text-[10px] font-bold text-primary hover:underline"
                onClick={() => alert("(mock) New Unit")}
              >
                + Unit
              </button>
            </div>
            <ul className="space-y-1">
              {topUnits.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedUnit(u.id)}
                    className={`w-full rounded-[--radius-sm] px-2 py-1.5 text-left text-sm transition-colors ${
                      selectedUnit === u.id
                        ? "bg-primary-bg font-semibold text-primary"
                        : "text-text-secondary hover:bg-bg-subtle"
                    }`}
                  >
                    📁 {u.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: contents */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
            {selectedUnit ? (
              <UnitContents unit={units.find((u) => u.id === selectedUnit)!} subfolders={subfolders} />
            ) : (
              <p className="text-sm text-text-muted">Select a unit to view contents.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UnitContents({ unit, subfolders }: { unit: MockUnit; subfolders: MockUnit[] }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-text-primary">{unit.name}</h3>
        <button
          className="text-xs font-bold text-primary hover:underline"
          onClick={() => alert("(mock) New Subfolder")}
        >
          + Subfolder
        </button>
      </div>
      <p className="mt-1 text-xs text-text-muted">{unit.doc_count} documents</p>

      {subfolders.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Subfolders</div>
          <ul className="mt-2 space-y-1">
            {subfolders.map((sf) => (
              <li
                key={sf.id}
                className="flex items-center justify-between rounded-[--radius-sm] px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle"
              >
                <span>📁 {sf.name}</span>
                <span className="text-xs text-text-muted">{sf.doc_count} files</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Files</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[--radius-md] border border-border-light bg-bg-subtle p-3 text-xs"
            >
              <div className="font-semibold text-text-primary">📄 sample-{i + 1}.pdf</div>
              <div className="mt-0.5 text-text-muted">2.4 MB</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────── Question Bank tab ─────────

const statusBadge: Record<MockBankQuestion["status"], string> = {
  approved: "bg-green-50 text-green-700 dark:bg-green-500/10",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10",
  rejected: "bg-gray-100 text-gray-500 dark:bg-gray-500/10",
};

const diffBadge: Record<MockBankQuestion["difficulty"], string> = {
  easy: "bg-blue-50 text-blue-700 dark:bg-blue-500/10",
  medium: "bg-purple-50 text-purple-700 dark:bg-purple-500/10",
  hard: "bg-red-50 text-red-700 dark:bg-red-500/10",
};

function QuestionBankTab({ courseId }: { courseId: string }) {
  const questions = getBankQuestions(courseId);
  const [statusFilter, setStatusFilter] = useState<"all" | MockBankQuestion["status"]>("all");

  const filtered = questions.filter((q) => statusFilter === "all" || q.status === statusFilter);
  const counts = {
    approved: questions.filter((q) => q.status === "approved").length,
    pending: questions.filter((q) => q.status === "pending").length,
    rejected: questions.filter((q) => q.status === "rejected").length,
  };

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
          onClick={() => alert("(mock) Generate Questions modal\n\n1. Pick source documents\n2. Quantity\n3. Difficulty mix\n4. Target unit\n5. Extra instructions (NL constraint)")}
        >
          + Generate Questions
        </button>
      </div>

      {/* Exhaustion warning */}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-lg] border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
        <span className="text-amber-800 dark:text-amber-300">
          ⚠ Period 1 has used 80% of Unit 5 questions
        </span>
        <button className="rounded-[--radius-sm] bg-amber-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-amber-700">
          Generate more
        </button>
      </div>

      {/* Filters */}
      <div className="mt-4 flex gap-2">
        {(["all", "pending", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-[--radius-pill] px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              statusFilter === s
                ? "bg-primary text-white"
                : "border border-border-light text-text-secondary hover:bg-bg-subtle"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Question cards */}
      <div className="mt-4 space-y-3">
        {filtered.length === 0 ? (
          <EmptyState text="No questions match this filter." />
        ) : (
          filtered.map((q) => (
            <div key={q.id} className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 text-sm text-text-primary">{q.question}</p>
                <div className="flex shrink-0 gap-1.5">
                  <span className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${diffBadge[q.difficulty]}`}>
                    {q.difficulty}
                  </span>
                  <span className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge[q.status]}`}>
                    {q.status}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-xs text-text-muted">Source: {q.source_doc}</div>
              <div className="mt-3 flex gap-2">
                {q.status === "pending" && (
                  <>
                    <button className="rounded-[--radius-sm] bg-green-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-700">
                      ✓ Approve
                    </button>
                    <button className="rounded-[--radius-sm] bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700">
                      ✕ Reject
                    </button>
                  </>
                )}
                <button className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle">
                  Edit
                </button>
                <button className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle">
                  Regenerate
                </button>
                <button className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle">
                  View solution
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ───────── Homework / Tests (shared) ─────────

const assignmentStatusBadge: Record<MockAssignment["status"], string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-500/10",
  published: "bg-blue-50 text-blue-700 dark:bg-blue-500/10",
  grading: "bg-amber-50 text-amber-700 dark:bg-amber-500/10",
  completed: "bg-green-50 text-green-700 dark:bg-green-500/10",
};

function AssignmentsTab({ courseId, type }: { courseId: string; type: "homework" | "test" }) {
  const items = getAssignments(courseId, type);
  const label = type === "homework" ? "Homework" : "Tests";
  const newLabel = type === "homework" ? "+ New Homework" : "+ New Test";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">{label}</h2>
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => alert(`(mock) ${newLabel} wizard:\n\n1. Basics\n2. Pick problems from bank\n3. Assign to sections + due date`)}
        >
          {newLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState text={`No ${label.toLowerCase()} yet.`} />
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((a) => (
            <div key={a.id} className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-bold text-text-primary">{a.title}</h3>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Due {a.due_at}
                    {a.section_names.length > 0 && ` · ${a.section_names.join(", ")}`}
                  </p>
                </div>
                <span className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${assignmentStatusBadge[a.status]}`}>
                  {a.status}
                </span>
              </div>
              {a.total > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{a.submitted}/{a.total} submitted</span>
                    {a.status === "grading" && (
                      <button className="font-bold text-primary hover:underline">Grade →</button>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(a.submitted / a.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── Settings tab ─────────

function SettingsTab({ course }: { course: ReturnType<typeof getCourse> }) {
  if (!course) return null;
  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary">Course Settings</h2>

      <div className="mt-4 space-y-4 rounded-[--radius-lg] border border-border-light bg-surface p-5">
        <Field label="Course name" value={course.name} />
        <Field label="Subject" value={course.subject} />
        <Field label="Grade level" value={course.grade_level} />
        <Field label="Description" value={course.description ?? "—"} />
        <Field label="Status" value={course.status} />
      </div>

      <div className="mt-6 rounded-[--radius-lg] border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <h3 className="text-sm font-bold text-red-800 dark:text-red-300">Danger zone</h3>
        <p className="mt-1 text-xs text-red-700 dark:text-red-300/80">
          Archive or delete this course. This affects all sections and student data.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="rounded-[--radius-sm] border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100">
            Archive
          </button>
          <button className="rounded-[--radius-sm] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-0.5 text-sm capitalize text-text-primary">{value}</div>
    </div>
  );
}

// ───────── Shared empty state ─────────

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
      {text}
    </div>
  );
}
