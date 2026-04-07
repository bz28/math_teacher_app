"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankCounts,
  type BankItem,
  type BankJob,
  type TeacherCourse,
  type TeacherDocument,
  type TeacherSection,
  type TeacherSectionDetail,
  type TeacherUnit,
} from "@/lib/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const POLL_LIMIT_MS = 5 * 60 * 1000;

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
        {tab === "materials" && <MaterialsTab courseId={course.id} onChanged={reloadCourse} />}
        {tab === "bank" && <QuestionBankTab courseId={course.id} />}
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
              onDeleted={() => {
                setOpenRoster(null);
                reload();
                onChanged();
              }}
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
  onDeleted,
}: {
  courseId: string;
  section: TeacherSection;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<TeacherSectionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [studentEmail, setStudentEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const wrap = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const addStudent = () =>
    wrap(async () => {
      const email = studentEmail.trim();
      if (!email) return;
      if (!EMAIL_RE.test(email)) {
        setError("Please enter a valid email address");
        return;
      }
      await teacher.addStudent(courseId, section.id, email);
      setStudentEmail("");
      await reloadDetail();
      onChanged();
    }, "Failed to add student");

  const removeStudent = (studentId: string) =>
    wrap(async () => {
      if (!confirm("Remove this student from the section?")) return;
      await teacher.removeStudent(courseId, section.id, studentId);
      await reloadDetail();
      onChanged();
    }, "Failed to remove student");

  const regenerateCode = () =>
    wrap(async () => {
      if (!confirm("Generate a new join code? The old one will stop working.")) return;
      await teacher.generateJoinCode(courseId, section.id);
      await reloadDetail();
      onChanged();
    }, "Failed to regenerate join code");

  const deleteSection = () =>
    wrap(async () => {
      if (!confirm(`Delete section "${section.name}"? Students will be unenrolled.`)) return;
      await teacher.deleteSection(courseId, section.id);
      onDeleted();
    }, "Failed to delete section");

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy to clipboard");
    }
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
              onClick={() => copyCode(code)}
              title="Click to copy"
              className={`rounded-[--radius-pill] px-2 py-0.5 font-mono text-xs font-bold transition-colors ${
                copied
                  ? "bg-green-100 text-green-700 dark:bg-green-500/20"
                  : "bg-primary-bg text-primary hover:bg-primary/20"
              }`}
            >
              {copied ? "Copied!" : code}
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
                  disabled={busy}
                  className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
                >
                  Regenerate join code
                </button>
                <button
                  onClick={deleteSection}
                  disabled={busy}
                  className="rounded-[--radius-sm] border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
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

                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addStudent();
                  }}
                >
                  <input
                    type="email"
                    value={studentEmail}
                    onChange={(e) => setStudentEmail(e.target.value)}
                    maxLength={255}
                    placeholder="student@email.com"
                    className="flex-1 rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    Add
                  </button>
                </form>
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
      <form
        className="w-full max-w-sm rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="text-lg font-bold text-text-primary">New Section</h2>
        <p className="mt-1 text-xs text-text-muted">e.g. &ldquo;Period 1&rdquo; or &ldquo;Block A&rdquo;</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={100}
          placeholder="Section name"
          className="mt-4 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
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
            disabled={submitting}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ───────── Settings tab ─────────

function SettingsTab({ course, onChanged }: { course: TeacherCourse; onChanged: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(course.name);
  const [subject, setSubject] = useState(course.subject);
  const [gradeLevel, setGradeLevel] = useState(course.grade_level?.toString() ?? "");
  const [description, setDescription] = useState(course.description ?? "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== course.name ||
    subject !== course.subject ||
    gradeLevel !== (course.grade_level?.toString() ?? "") ||
    description !== (course.description ?? "");

  const save = async () => {
    if (!name.trim()) {
      setError("Course name is required");
      return;
    }
    if (gradeLevel) {
      const g = Number(gradeLevel);
      if (!Number.isInteger(g) || g < 1 || g > 12) {
        setError("Grade level must be between 1 and 12");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await teacher.updateCourse(course.id, {
        name: name.trim(),
        subject,
        grade_level: gradeLevel ? Number(gradeLevel) : null,
        description: description.trim() || null,
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deleteCourse = async () => {
    if (!confirm(`Delete "${course.name}"? This deletes all sections, materials, and student data.`)) return;
    try {
      await teacher.deleteCourse(course.id);
      router.push("/school/teacher");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete course");
    }
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
            maxLength={200}
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
            maxLength={1000}
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </Field>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {dirty ? "Unsaved changes" : justSaved ? "Saved" : ""}
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

// ───────── Materials tab ─────────

function MaterialsTab({ courseId, onChanged }: { courseId: string; onChanged: () => void }) {
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // unit id, or null for "Uncategorized"
  const [showNewUnit, setShowNewUnit] = useState<{ parentId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, d] = await Promise.all([teacher.units(courseId), teacher.documents(courseId)]);
      setUnits(u.units);
      setDocs(d.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load materials");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const topUnits = units.filter((u) => u.parent_id === null);
  const subfoldersOf = (parentId: string) => units.filter((u) => u.parent_id === parentId);
  const docsIn = (unitId: string | null) => docs.filter((d) => d.unit_id === unitId);

  // The selected folder may be a top-level unit or a subfolder. null = uncategorized.
  const selectedUnit = selected ? units.find((u) => u.id === selected) ?? null : null;
  const selectedDocs = docsIn(selected);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = (files: FileList | null) =>
    wrap(async () => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(`${file.name} exceeds 25MB`);
        }
        const base64 = await fileToBase64(file);
        await teacher.uploadDocument(courseId, {
          image_base64: base64,
          filename: file.name,
          unit_id: selected,
        });
      }
      await reload();
      onChanged();
    });

  const deleteUnit = (unitId: string, name: string) =>
    wrap(async () => {
      if (!confirm(`Delete "${name}"? Documents inside move to Uncategorized.`)) return;
      await teacher.deleteUnit(courseId, unitId);
      if (selected === unitId) setSelected(null);
      await reload();
      onChanged();
    });

  const renameUnit = (unit: TeacherUnit) =>
    wrap(async () => {
      const next = prompt("Rename folder:", unit.name);
      if (!next || next.trim() === unit.name) return;
      await teacher.updateUnit(courseId, unit.id, { name: next.trim() });
      await reload();
    });

  const moveDocument = (doc: TeacherDocument) =>
    wrap(async () => {
      // Build a flat label list of every folder destination
      const destinations: { id: string | null; label: string }[] = [{ id: null, label: "Uncategorized" }];
      for (const top of topUnits) {
        destinations.push({ id: top.id, label: top.name });
        for (const sub of subfoldersOf(top.id)) {
          destinations.push({ id: sub.id, label: `${top.name} / ${sub.name}` });
        }
      }
      const labels = destinations.map((d, i) => `${i + 1}. ${d.label}`).join("\n");
      const choice = prompt(`Move "${doc.filename}" to:\n${labels}\n\nEnter number:`);
      if (!choice) return;
      const idx = Number(choice) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= destinations.length) {
        throw new Error("Invalid choice");
      }
      await teacher.updateDocument(courseId, doc.id, { unit_id: destinations[idx].id });
      await reload();
      onChanged();
    });

  const deleteDocument = (doc: TeacherDocument) =>
    wrap(async () => {
      if (!confirm(`Delete "${doc.filename}"?`)) return;
      await teacher.deleteDocument(courseId, doc.id);
      await reload();
      onChanged();
    });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Materials</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewUnit({ parentId: null })}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            + New Unit
          </button>
          <label className="cursor-pointer rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark">
            + Upload Files
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => handleUpload(e.target.files)}
              className="hidden"
              disabled={busy}
            />
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">Loading…</p>
      ) : units.length === 0 && docs.length === 0 ? (
        <EmptyState text="No materials yet. Create a unit or upload files to get started." />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Left: folder tree */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className={`w-full rounded-[--radius-sm] px-2 py-1.5 text-left text-sm transition-colors ${
                selected === null
                  ? "bg-primary-bg font-semibold text-primary"
                  : "text-text-secondary hover:bg-bg-subtle"
              }`}
            >
              📥 Uncategorized
              <span className="ml-1 text-xs text-text-muted">({docsIn(null).length})</span>
            </button>

            <div className="my-2 h-px bg-border-light" />

            {topUnits.length === 0 && (
              <p className="px-2 py-1 text-xs text-text-muted">No units yet.</p>
            )}
            <ul className="space-y-0.5">
              {topUnits.map((u) => (
                <li key={u.id}>
                  <FolderRow
                    unit={u}
                    selected={selected === u.id}
                    docCount={docsIn(u.id).length}
                    onSelect={() => setSelected(u.id)}
                    onRename={() => renameUnit(u)}
                    onDelete={() => deleteUnit(u.id, u.name)}
                    onAddSub={() => setShowNewUnit({ parentId: u.id })}
                  />
                  <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-border-light pl-2">
                    {subfoldersOf(u.id).map((sub) => (
                      <li key={sub.id}>
                        <FolderRow
                          unit={sub}
                          selected={selected === sub.id}
                          docCount={docsIn(sub.id).length}
                          onSelect={() => setSelected(sub.id)}
                          onRename={() => renameUnit(sub)}
                          onDelete={() => deleteUnit(sub.id, sub.name)}
                          isSub
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: contents */}
          <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-text-primary">
                {selectedUnit ? selectedUnit.name : "Uncategorized"}
              </h3>
              <span className="text-xs text-text-muted">
                {selectedDocs.length} file{selectedDocs.length === 1 ? "" : "s"}
              </span>
            </div>

            {selectedDocs.length === 0 ? (
              <p className="mt-6 text-center text-sm text-text-muted">
                No files in this folder yet.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {selectedDocs.map((d) => (
                  <DocumentCard
                    key={d.id}
                    doc={d}
                    onMove={() => moveDocument(d)}
                    onDelete={() => deleteDocument(d)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showNewUnit && (
        <NewUnitModal
          courseId={courseId}
          parentId={showNewUnit.parentId}
          onClose={() => setShowNewUnit(null)}
          onCreated={() => {
            setShowNewUnit(null);
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function FolderRow({
  unit,
  selected,
  docCount,
  onSelect,
  onRename,
  onDelete,
  onAddSub,
  isSub,
}: {
  unit: TeacherUnit;
  selected: boolean;
  docCount: number;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddSub?: () => void;
  isSub?: boolean;
}) {
  return (
    <div
      className={`group flex items-center justify-between rounded-[--radius-sm] px-2 py-1.5 transition-colors ${
        selected ? "bg-primary-bg" : "hover:bg-bg-subtle"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`flex flex-1 items-center gap-1 truncate text-left text-sm ${
          selected ? "font-semibold text-primary" : "text-text-secondary"
        }`}
      >
        <span>{isSub ? "📂" : "📁"}</span>
        <span className="truncate">{unit.name}</span>
        <span className="text-xs text-text-muted">({docCount})</span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {onAddSub && (
          <button
            type="button"
            onClick={onAddSub}
            title="New subfolder"
            className="rounded p-1 text-xs text-text-muted hover:bg-surface hover:text-text-primary"
          >
            +
          </button>
        )}
        <button
          type="button"
          onClick={onRename}
          title="Rename"
          className="rounded p-1 text-xs text-text-muted hover:bg-surface hover:text-text-primary"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          className="rounded p-1 text-xs text-text-muted hover:bg-surface hover:text-red-600"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function DocumentCard({
  doc,
  onMove,
  onDelete,
}: {
  doc: TeacherDocument;
  onMove: () => void;
  onDelete: () => void;
}) {
  const sizeKb = Math.max(1, Math.round(doc.file_size / 1024));
  const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
  return (
    <div className="group rounded-[--radius-md] border border-border-light bg-bg-subtle p-3 text-xs">
      <div className="flex items-start gap-2">
        <span className="text-base">📄</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-text-primary" title={doc.filename}>
            {doc.filename}
          </div>
          <div className="mt-0.5 text-text-muted">{sizeLabel}</div>
        </div>
      </div>
      <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onMove}
          className="flex-1 rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-base"
        >
          Move
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-[--radius-sm] border border-red-300 bg-surface px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function NewUnitModal({
  courseId,
  parentId,
  onClose,
  onCreated,
}: {
  courseId: string;
  parentId: string | null;
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
      await teacher.createUnit(courseId, { name: name.trim(), parent_id: parentId });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create unit");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-sm rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="text-lg font-bold text-text-primary">
          {parentId ? "New Subfolder" : "New Unit"}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          {parentId
            ? "Subfolders organize files inside a unit."
            : "e.g. \u201cUnit 1: Linear Equations\u201d"}
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={200}
          placeholder={parentId ? "Subfolder name" : "Unit name"}
          className="mt-4 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
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
            disabled={submitting}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:...;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ───────── Question Bank tab ─────────

const STATUS_FILTERS: { key: "all" | "pending" | "approved" | "rejected"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10",
  approved: "bg-green-50 text-green-700 dark:bg-green-500/10",
  rejected: "bg-gray-100 text-gray-500 dark:bg-gray-500/10",
  archived: "bg-gray-100 text-gray-500 dark:bg-gray-500/10",
};

function QuestionBankTab({ courseId }: { courseId: string }) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [counts, setCounts] = useState<BankCounts>({ pending: 0, approved: 0, rejected: 0, archived: 0 });
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [activeJob, setActiveJob] = useState<BankJob | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
  // The cap prevents the banner from polling indefinitely.
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
          {activeJob.status === "running" && (
            activeJob.produced_count > 0
              ? `🔄 Generating questions… ${activeJob.produced_count}/${activeJob.requested_count}`
              : `🔄 Generating ${activeJob.requested_count} questions…`
          )}
          {activeJob.status === "done" &&
            `✅ Generated ${activeJob.produced_count}/${activeJob.requested_count} questions. Refreshing…`}
          {activeJob.status === "failed" && `❌ Generation failed: ${activeJob.error_message ?? "unknown error"}`}
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
            {f.key !== "all" && (
              <span className="ml-1 opacity-70">({counts[f.key] ?? 0})</span>
            )}
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
              expanded={expanded === item.id}
              onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
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
    </div>
  );
}

function BankItemCard({
  item,
  expanded,
  onToggle,
  onChanged,
}: {
  item: BankItem;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRegen, setShowRegen] = useState(false);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    wrap(async () => {
      await teacher.approveBankItem(item.id);
      onChanged();
    });

  const reject = () =>
    wrap(async () => {
      await teacher.rejectBankItem(item.id);
      onChanged();
    });

  const remove = () =>
    wrap(async () => {
      if (!confirm("Delete this question permanently?")) return;
      await teacher.deleteBankItem(item.id);
      onChanged();
    });

  const editQuestion = () =>
    wrap(async () => {
      const next = prompt("Edit question text:", item.question);
      if (!next || next.trim() === item.question) return;
      await teacher.updateBankItem(item.id, { question: next.trim() });
      onChanged();
    });

  const regenerate = (instructions?: string) =>
    wrap(async () => {
      await teacher.regenerateBankItem(item.id, instructions);
      setShowRegen(false);
      onChanged();
    });

  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 text-sm text-text-primary">
          <MathText text={item.question} />
        </div>
        <span
          className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
            STATUS_BADGE[item.status] ?? ""
          }`}
        >
          {item.status}
        </span>
      </div>

      {expanded && (
        <div className="mt-3 rounded-[--radius-md] bg-bg-subtle p-3 text-xs text-text-secondary">
          {item.solution_steps && item.solution_steps.length > 0 ? (
            <ol className="space-y-2">
              {item.solution_steps.map((s, i) => (
                <li key={i}>
                  <div className="font-semibold text-text-primary">
                    {i + 1}. <MathText text={s.title} />
                  </div>
                  <div className="mt-0.5">
                    <MathText text={s.description} />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="italic text-text-muted">No solution steps recorded.</p>
          )}
          {item.final_answer && (
            <div className="mt-3 border-t border-border-light pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Final answer:
              </span>{" "}
              <span className="text-text-primary">
                <MathText text={item.final_answer} />
              </span>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.status === "pending" && (
          <>
            <button
              onClick={approve}
              disabled={busy}
              className="rounded-[--radius-sm] bg-green-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Approve
            </button>
            <button
              onClick={reject}
              disabled={busy}
              className="rounded-[--radius-sm] bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              ✕ Reject
            </button>
          </>
        )}
        <button
          onClick={onToggle}
          className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
        >
          {expanded ? "Hide solution" : "View solution"}
        </button>
        <button
          onClick={editQuestion}
          disabled={busy}
          className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
        >
          Edit
        </button>
        <button
          onClick={() => setShowRegen(true)}
          disabled={busy}
          className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
        >
          Regenerate
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="ml-auto rounded-[--radius-sm] border border-red-300 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {showRegen && (
        <RegenerateModal
          itemQuestion={item.question}
          onClose={() => setShowRegen(false)}
          onSubmit={regenerate}
          busy={busy}
        />
      )}
    </div>
  );
}

function RegenerateModal({
  itemQuestion,
  onClose,
  onSubmit,
  busy,
}: {
  itemQuestion: string;
  onClose: () => void;
  onSubmit: (instructions?: string) => void;
  busy: boolean;
}) {
  const [instructions, setInstructions] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(instructions.trim() || undefined);
        }}
      >
        <h2 className="text-lg font-bold text-text-primary">Regenerate Question</h2>
        <div className="mt-1 line-clamp-2 text-xs text-text-muted">
          <MathText text={itemQuestion} />
        </div>

        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-text-muted">
          Instructions (optional)
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          Tell the AI what to change. Leave blank for a fresh take on the same topic.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder="e.g. make the numbers smaller, redo the solution, change to a word problem"
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </form>
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

  // Group docs by unit (top-level), with subfolder docs nested under their parent
  const topUnits = units.filter((u) => u.parent_id === null);
  const subfoldersOf = (parentId: string) => units.filter((u) => u.parent_id === parentId);
  const docsIn = (uid: string | null) => docs.filter((d) => d.unit_id === uid);

  // A doc counts as "AI-readable" if it's not a PDF (Vision is image-only)
  const readableSelectedCount = Array.from(selectedDocs).filter((id) => {
    const d = docs.find((x) => x.id === id);
    return d && d.file_type !== "application/pdf";
  }).length;

  const submit = async () => {
    if (count < 1 || count > 50) {
      setError("Count must be between 1 and 50");
      return;
    }
    // If the teacher selected only PDFs, Claude has zero context — block.
    if (selectedDocs.size > 0 && readableSelectedCount === 0) {
      setError("Selected documents are all PDFs (skipped). Pick at least one image, or unselect all to generate from the unit name only.");
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
            {/* Document picker */}
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
                    {/* Uncategorized */}
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
                  <span className="text-amber-600">
                    {" "}
                    · {readableSelectedCount} AI-readable
                  </span>
                )}
              </p>
            </div>

            {/* Quantity */}
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

            {/* Target unit */}
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

            {/* NL constraint */}
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
