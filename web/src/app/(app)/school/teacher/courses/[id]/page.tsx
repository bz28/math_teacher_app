"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  teacher,
  type TeacherCourse,
  type TeacherSection,
  type TeacherSectionDetail,
} from "@/lib/api";

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
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("sections");

  const reloadCourse = async () => {
    setLoading(true);
    try {
      setCourse(await teacher.course(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load course");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <div className="mx-auto max-w-6xl text-sm text-text-muted">Loading…</div>;
  }
  if (error || !course) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-red-600">{error ?? "Course not found."}</p>
        <Link href="/school/teacher" className="mt-4 inline-block text-sm font-semibold text-primary">
          ← Back to courses
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
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
              {course.grade_level ? `Grade ${course.grade_level} · ` : ""}
              {course.section_count} section{course.section_count === 1 ? "" : "s"} ·{" "}
              {course.doc_count} document{course.doc_count === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </motion.div>

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

      <div className="mt-6">
        {tab === "sections" && <SectionsTab courseId={course.id} onChanged={reloadCourse} />}
        {tab === "materials" && <ComingSoon name="Materials" phase="Phase 3" />}
        {tab === "bank" && <ComingSoon name="Question Bank" phase="Phase 4" />}
        {tab === "homework" && <ComingSoon name="Homework" phase="Phase 5" />}
        {tab === "tests" && <ComingSoon name="Tests" phase="Phase 5" />}
        {tab === "settings" && <SettingsTab course={course} onChanged={reloadCourse} />}
      </div>
    </div>
  );
}

// ───────── Sections tab ─────────

function SectionsTab({ courseId, onChanged }: { courseId: string; onChanged: () => void }) {
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openRoster, setOpenRoster] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setSections((await teacher.sections(courseId)).sections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Class Sections</h2>
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => setShowNew(true)}
        >
          + New Section
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      {!loading && sections.length === 0 ? (
        <EmptyState text="No sections yet. Add a class period to get started." />
      ) : (
        <div className="mt-4 space-y-3">
          {sections.map((s) => (
            <SectionCard
              key={s.id}
              courseId={courseId}
              section={s}
              expanded={openRoster === s.id}
              onToggle={() => setOpenRoster(openRoster === s.id ? null : s.id)}
              onChanged={() => {
                reload();
                onChanged();
              }}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewSectionModal
          courseId={courseId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SectionCard({
  courseId,
  section,
  expanded,
  onToggle,
  onChanged,
}: {
  courseId: string;
  section: TeacherSection;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TeacherSectionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [studentEmail, setStudentEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    teacher
      .section(courseId, section.id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [expanded, courseId, section.id]);

  const reloadDetail = async () => {
    setDetail(await teacher.section(courseId, section.id));
  };

  const addStudent = async () => {
    if (!studentEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await teacher.addStudent(courseId, section.id, studentEmail.trim());
      setStudentEmail("");
      await reloadDetail();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add student");
    } finally {
      setBusy(false);
    }
  };

  const removeStudent = async (studentId: string) => {
    if (!confirm("Remove this student from the section?")) return;
    await teacher.removeStudent(courseId, section.id, studentId);
    await reloadDetail();
    onChanged();
  };

  const regenerateCode = async () => {
    if (!confirm("Generate a new join code? The old one will stop working.")) return;
    await teacher.generateJoinCode(courseId, section.id);
    await reloadDetail();
    onChanged();
  };

  const deleteSection = async () => {
    if (!confirm(`Delete section "${section.name}"? Students will be unenrolled.`)) return;
    await teacher.deleteSection(courseId, section.id);
    onChanged();
  };

  const code = detail?.join_code ?? section.join_code;

  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface">
      <div className="flex items-center justify-between p-4">
        <div>
          <h3 className="font-bold text-text-primary">{section.name}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {section.student_count} student{section.student_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {code && (
            <button
              onClick={() => navigator.clipboard.writeText(code)}
              title="Click to copy"
              className="rounded-[--radius-pill] bg-primary-bg px-2 py-0.5 font-mono text-xs font-bold text-primary hover:bg-primary/20"
            >
              {code}
            </button>
          )}
          <button
            onClick={onToggle}
            className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
          >
            {expanded ? "Close" : "Manage"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-light p-4">
          {loading && <p className="text-xs text-text-muted">Loading roster…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {detail && (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  onClick={regenerateCode}
                  className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
                >
                  Regenerate join code
                </button>
                <button
                  onClick={deleteSection}
                  className="rounded-[--radius-sm] border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                >
                  Delete section
                </button>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  Roster ({detail.students.length})
                </div>
                <div className="mt-2 space-y-1.5">
                  {detail.students.length === 0 && (
                    <p className="text-xs text-text-muted">No students enrolled yet.</p>
                  )}
                  {detail.students.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-[--radius-sm] bg-bg-subtle px-3 py-2 text-sm"
                    >
                      <div>
                        <div className="font-semibold text-text-primary">{s.name}</div>
                        <div className="text-xs text-text-muted">{s.email}</div>
                      </div>
                      <button
                        onClick={() => removeStudent(s.id)}
                        className="text-xs font-bold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <input
                    type="email"
                    value={studentEmail}
                    onChange={(e) => setStudentEmail(e.target.value)}
                    placeholder="student@email.com"
                    className="flex-1 rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                  <button
                    onClick={addStudent}
                    disabled={busy}
                    className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NewSectionModal({
  courseId,
  onClose,
  onCreated,
}: {
  courseId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await teacher.createSection(courseId, name.trim());
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create section");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">New Section</h2>
        <p className="mt-1 text-xs text-text-muted">e.g. &ldquo;Period 1&rdquo; or &ldquo;Block A&rdquo;</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Section name"
          className="mt-4 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────── Settings tab ─────────

function SettingsTab({ course, onChanged }: { course: TeacherCourse; onChanged: () => void }) {
  const [name, setName] = useState(course.name);
  const [subject, setSubject] = useState(course.subject);
  const [gradeLevel, setGradeLevel] = useState(course.grade_level?.toString() ?? "");
  const [description, setDescription] = useState(course.description ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== course.name ||
    subject !== course.subject ||
    gradeLevel !== (course.grade_level?.toString() ?? "") ||
    description !== (course.description ?? "");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await teacher.updateCourse(course.id, {
        name: name.trim(),
        subject,
        grade_level: gradeLevel ? Number(gradeLevel) : null,
        description: description.trim() || null,
      });
      setSavedAt(Date.now());
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deleteCourse = async () => {
    if (!confirm(`Delete "${course.name}"? This deletes all sections, materials, and student data.`)) return;
    await teacher.deleteCourse(course.id);
    window.location.href = "/school/teacher";
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold text-text-primary">Course Settings</h2>

      <div className="mt-4 space-y-4 rounded-[--radius-lg] border border-border-light bg-surface p-5">
        <Field label="Course name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Subject">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          >
            <option value="math">Math</option>
            <option value="physics">Physics</option>
            <option value="chemistry">Chemistry</option>
          </select>
        </Field>
        <Field label="Grade level">
          <input
            type="number"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            min={1}
            max={12}
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </Field>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {savedAt && !dirty ? "Saved" : dirty ? "Unsaved changes" : ""}
          </span>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-[--radius-lg] border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <h3 className="text-sm font-bold text-red-800 dark:text-red-300">Danger zone</h3>
        <p className="mt-1 text-xs text-red-700 dark:text-red-300/80">
          Permanently delete this course and everything inside it.
        </p>
        <button
          onClick={deleteCourse}
          className="mt-3 rounded-[--radius-sm] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
        >
          Delete course
        </button>
      </div>
    </div>
  );
}

// ───────── Coming soon placeholder ─────────

function ComingSoon({ name, phase }: { name: string; phase: string }) {
  return (
    <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-12 text-center">
      <p className="text-sm font-bold text-text-primary">{name}</p>
      <p className="mt-1 text-xs text-text-muted">Coming in {phase}.</p>
    </div>
  );
}

// ───────── Shared bits ─────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
      {text}
    </div>
  );
}
