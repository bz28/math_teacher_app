"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankChatMessage,
  type BankChatProposal,
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
  const [renamingUnitId, setRenamingUnitId] = useState<string | null>(null);
  const [confirmingDeleteUnit, setConfirmingDeleteUnit] = useState<string | null>(null);
  const [movingDocId, setMovingDocId] = useState<string | null>(null);
  const [confirmingDeleteDoc, setConfirmingDeleteDoc] = useState<string | null>(null);

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

  const deleteUnit = (unitId: string) =>
    wrap(async () => {
      await teacher.deleteUnit(courseId, unitId);
      if (selected === unitId) setSelected(null);
      setConfirmingDeleteUnit(null);
      await reload();
      onChanged();
    });

  const renameUnit = (unit: TeacherUnit, nextName: string) =>
    wrap(async () => {
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === unit.name) {
        setRenamingUnitId(null);
        return;
      }
      await teacher.updateUnit(courseId, unit.id, { name: trimmed });
      setRenamingUnitId(null);
      await reload();
    });

  // Build a flat label list of every folder destination, used by the move popover
  const destinations = (() => {
    const out: { id: string | null; label: string }[] = [{ id: null, label: "Uncategorized" }];
    for (const top of topUnits) {
      out.push({ id: top.id, label: top.name });
      for (const sub of subfoldersOf(top.id)) {
        out.push({ id: sub.id, label: `${top.name} / ${sub.name}` });
      }
    }
    return out;
  })();

  const moveDocument = (doc: TeacherDocument, targetUnitId: string | null) =>
    wrap(async () => {
      await teacher.updateDocument(courseId, doc.id, { unit_id: targetUnitId });
      setMovingDocId(null);
      await reload();
      onChanged();
    });

  const deleteDocument = (docId: string) =>
    wrap(async () => {
      await teacher.deleteDocument(courseId, docId);
      setConfirmingDeleteDoc(null);
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
                    isRenaming={renamingUnitId === u.id}
                    isConfirmingDelete={confirmingDeleteUnit === u.id}
                    busy={busy}
                    onSelect={() => setSelected(u.id)}
                    onStartRename={() => setRenamingUnitId(u.id)}
                    onSubmitRename={(name) => renameUnit(u, name)}
                    onCancelRename={() => setRenamingUnitId(null)}
                    onStartDelete={() => setConfirmingDeleteUnit(u.id)}
                    onConfirmDelete={() => deleteUnit(u.id)}
                    onCancelDelete={() => setConfirmingDeleteUnit(null)}
                    onAddSub={() => setShowNewUnit({ parentId: u.id })}
                  />
                  {subfoldersOf(u.id).length > 0 && (
                    <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-border-light pl-2">
                      {subfoldersOf(u.id).map((sub) => (
                        <li key={sub.id}>
                          <FolderRow
                            unit={sub}
                            selected={selected === sub.id}
                            docCount={docsIn(sub.id).length}
                            isRenaming={renamingUnitId === sub.id}
                            isConfirmingDelete={confirmingDeleteUnit === sub.id}
                            busy={busy}
                            onSelect={() => setSelected(sub.id)}
                            onStartRename={() => setRenamingUnitId(sub.id)}
                            onSubmitRename={(name) => renameUnit(sub, name)}
                            onCancelRename={() => setRenamingUnitId(null)}
                            onStartDelete={() => setConfirmingDeleteUnit(sub.id)}
                            onConfirmDelete={() => deleteUnit(sub.id)}
                            onCancelDelete={() => setConfirmingDeleteUnit(null)}
                            isSub
                          />
                        </li>
                      ))}
                    </ul>
                  )}
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
              <div className="mt-6 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
                No files in this folder yet. Use <span className="font-semibold">+ Upload Files</span> above to add some.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {selectedDocs.map((d) => (
                  <DocumentCard
                    key={d.id}
                    doc={d}
                    isMoving={movingDocId === d.id}
                    isConfirmingDelete={confirmingDeleteDoc === d.id}
                    destinations={destinations}
                    busy={busy}
                    onStartMove={() => setMovingDocId(d.id)}
                    onSubmitMove={(target) => moveDocument(d, target)}
                    onCancelMove={() => setMovingDocId(null)}
                    onStartDelete={() => setConfirmingDeleteDoc(d.id)}
                    onConfirmDelete={() => deleteDocument(d.id)}
                    onCancelDelete={() => setConfirmingDeleteDoc(null)}
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
  isRenaming,
  isConfirmingDelete,
  busy,
  onSelect,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  onAddSub,
  isSub,
}: {
  unit: TeacherUnit;
  selected: boolean;
  docCount: number;
  isRenaming: boolean;
  isConfirmingDelete: boolean;
  busy: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onAddSub?: () => void;
  isSub?: boolean;
}) {
  const [draft, setDraft] = useState(unit.name);

  // Reset draft whenever we enter rename mode
  useEffect(() => {
    if (isRenaming) setDraft(unit.name);
  }, [isRenaming, unit.name]);

  if (isRenaming) {
    return (
      <form
        className="flex items-center gap-1 rounded-[--radius-sm] bg-primary-bg/40 px-2 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmitRename(draft);
        }}
      >
        <span>{isSub ? "📂" : "📁"}</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          maxLength={200}
          className="flex-1 rounded-[--radius-sm] border border-border-light bg-bg-base px-1.5 py-0.5 text-sm text-text-primary focus:border-primary focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancelRename();
          }}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded px-1.5 py-0.5 text-xs font-bold text-primary hover:bg-surface disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancelRename}
          className="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-surface"
        >
          ✕
        </button>
      </form>
    );
  }

  if (isConfirmingDelete) {
    return (
      <div className="flex items-center justify-between rounded-[--radius-sm] bg-red-50 px-2 py-1.5 text-xs dark:bg-red-500/10">
        <span className="truncate font-semibold text-red-800 dark:text-red-300">
          Delete &ldquo;{unit.name}&rdquo;?
        </span>
        <div className="ml-2 flex shrink-0 gap-1">
          <button
            onClick={onConfirmDelete}
            disabled={busy}
            className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            onClick={onCancelDelete}
            className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between rounded-[--radius-sm] px-2 py-1.5 transition-colors ${
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
      <div className="flex shrink-0 items-center gap-0.5">
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
          onClick={onStartRename}
          title="Rename"
          className="rounded p-1 text-xs text-text-muted hover:bg-surface hover:text-text-primary"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onStartDelete}
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
  isMoving,
  isConfirmingDelete,
  destinations,
  busy,
  onStartMove,
  onSubmitMove,
  onCancelMove,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  doc: TeacherDocument;
  isMoving: boolean;
  isConfirmingDelete: boolean;
  destinations: { id: string | null; label: string }[];
  busy: boolean;
  onStartMove: () => void;
  onSubmitMove: (target: string | null) => void;
  onCancelMove: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const sizeKb = Math.max(1, Math.round(doc.file_size / 1024));
  const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
  const currentLocation = destinations.find((dest) => dest.id === doc.unit_id)?.label ?? "Uncategorized";
  const availableDestinations = destinations.filter((dest) => dest.id !== doc.unit_id);
  const canMove = availableDestinations.length > 0;

  return (
    <div className="relative rounded-[--radius-md] border border-border-light bg-bg-subtle p-3 text-xs">
      <div className="flex items-start gap-2">
        <span className="text-base">📄</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-text-primary" title={doc.filename}>
            {doc.filename}
          </div>
          <div className="mt-0.5 text-text-muted">{sizeLabel}</div>
        </div>
      </div>

      {isConfirmingDelete ? (
        <div className="mt-2 flex flex-col gap-1 rounded-[--radius-sm] bg-red-50 p-2 dark:bg-red-500/10">
          <span className="text-[11px] font-semibold text-red-800 dark:text-red-300">
            Delete this file?
          </span>
          <div className="flex gap-1">
            <button
              onClick={onConfirmDelete}
              disabled={busy}
              className="flex-1 rounded-[--radius-sm] bg-red-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={onCancelDelete}
              className="rounded-[--radius-sm] border border-red-300 bg-white px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={onStartMove}
            disabled={!canMove || busy}
            className="flex-1 rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-base"
          >
            Move
          </button>
          <button
            type="button"
            onClick={onStartDelete}
            className="rounded-[--radius-sm] border border-red-300 bg-surface px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
          >
            ×
          </button>
        </div>
      )}

      {isMoving && (
        <div
          className="absolute inset-x-2 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-[--radius-md] border border-border-light bg-surface p-1 shadow-lg"
          onMouseLeave={onCancelMove}
        >
          <div className="px-2 pb-1 pt-0.5 text-[10px] text-text-muted">
            Current location: <span className="font-semibold text-text-secondary">{currentLocation}</span>
          </div>
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Move to
          </div>
          {availableDestinations.length === 0 ? (
            <p className="px-2 py-1 text-xs text-text-muted">No other destinations available.</p>
          ) : (
            availableDestinations.map((dest) => (
              <button
                key={dest.id ?? "uncategorized"}
                type="button"
                onClick={() => onSubmitMove(dest.id)}
                disabled={busy}
                className="block w-full truncate rounded-[--radius-sm] px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-primary-bg hover:text-primary disabled:opacity-50"
              >
                {dest.label}
              </button>
            ))
          )}
        </div>
      )}
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
  // Item currently open in the detail modal
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

// ───────── Question Detail Modal ─────────
//
// The "workshop" — opens when the teacher clicks a question text on the
// card. Click-to-edit pattern: question text, each solution step, and
// final answer all become editable in place when clicked. The persistent
// "Revise with AI" textarea is the primary affordance for changes you
// don't want to type by hand. After any change, an Undo link appears
// for 30 seconds (backed by previous_* DB columns).

// QuestionDetailModal — the workshop. Two panels:
//   left: the artifact (question + solution + final answer, click-to-edit)
//   right: persistent chat sidebar with Claude
//
// Key invariants:
// - Local `liveItem` state owns the latest version of the item (the parent's
//   item prop is only used as the initial value). Every API response from
//   chat / accept / discard / clear / manual edit / approve / reject /
//   revert returns the full item; we replace liveItem and call onChanged
//   so the list refreshes too.
// - The "preview" in the artifact is derived from the latest unresolved
//   AI proposal in chat_messages. Accepting it applies the diff via the
//   /chat/accept endpoint; discarding marks it discarded.

function QuestionDetailModal({
  item: initialItem,
  onClose,
  onChanged,
}: {
  item: BankItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [liveItem, setLiveItem] = useState<BankItem>(initialItem);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUndo, setShowUndo] = useState(initialItem.has_previous_version);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [solutionOpen, setSolutionOpen] = useState(true);

  // If the parent reloads the bank list and a fresher version of this item
  // arrives, prefer the fresher updated_at. We don't blindly replace because
  // mid-chat we may have a more recent local copy than the parent list.
  useEffect(() => {
    if (initialItem.id !== liveItem.id) {
      setLiveItem(initialItem);
    } else if (
      new Date(initialItem.updated_at).getTime() >
      new Date(liveItem.updated_at).getTime()
    ) {
      setLiveItem(initialItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem]);

  useEffect(() => {
    setShowUndo(liveItem.has_previous_version);
  }, [liveItem.id, liveItem.has_previous_version, liveItem.updated_at]);

  // Auto-hide undo after 30s
  useEffect(() => {
    if (!showUndo) return;
    const t = setTimeout(() => setShowUndo(false), 30000);
    return () => clearTimeout(t);
  }, [showUndo]);

  const acceptUpdated = (next: BankItem) => {
    setLiveItem(next);
    onChanged();
  };

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

  // Pending proposal: latest AI message with a proposal that isn't
  // accepted/discarded/superseded.
  const pendingIdx = (() => {
    for (let i = liveItem.chat_messages.length - 1; i >= 0; i--) {
      const m = liveItem.chat_messages[i];
      if (
        m.role === "ai" &&
        m.proposal &&
        !m.accepted &&
        !m.discarded &&
        !m.superseded
      ) {
        return i;
      }
    }
    return -1;
  })();
  const pendingProposal: BankChatProposal | null =
    pendingIdx >= 0 ? liveItem.chat_messages[pendingIdx].proposal! : null;

  // Manual edits — refetch via PATCH; if a proposal is pending we discard
  // it first (the manual edit invalidates it).
  const saveQuestion = (next: string) =>
    wrap(async () => {
      const q = next.trim();
      if (!q || q === liveItem.question) return;
      if (pendingIdx >= 0) {
        await teacher.discardBankChatProposal(liveItem.id, pendingIdx);
      }
      await teacher.updateBankItem(liveItem.id, { question: q });
      // Re-pull the item via the bank list refresh
      setLiveItem({ ...liveItem, question: q, has_previous_version: true });
      setShowUndo(true);
      onChanged();
    });

  const saveStep = (idx: number, field: "title" | "description", next: string) =>
    wrap(async () => {
      if (!liveItem.solution_steps) return;
      const updated = liveItem.solution_steps.map((s, i) =>
        i === idx ? { ...s, [field]: next } : s,
      );
      if (pendingIdx >= 0) {
        await teacher.discardBankChatProposal(liveItem.id, pendingIdx);
      }
      await teacher.updateBankItem(liveItem.id, { solution_steps: updated });
      setLiveItem({ ...liveItem, solution_steps: updated, has_previous_version: true });
      setShowUndo(true);
      onChanged();
    });

  const saveFinalAnswer = (next: string) =>
    wrap(async () => {
      if (next === (liveItem.final_answer ?? "")) return;
      if (pendingIdx >= 0) {
        await teacher.discardBankChatProposal(liveItem.id, pendingIdx);
      }
      await teacher.updateBankItem(liveItem.id, { final_answer: next });
      setLiveItem({ ...liveItem, final_answer: next, has_previous_version: true });
      setShowUndo(true);
      onChanged();
    });

  const sendChat = (message: string) =>
    wrap(async () => {
      const next = await teacher.sendBankChat(liveItem.id, message);
      acceptUpdated(next);
    });

  const acceptProposal = () =>
    wrap(async () => {
      if (pendingIdx < 0) return;
      const next = await teacher.acceptBankChatProposal(liveItem.id, pendingIdx);
      acceptUpdated(next);
      setShowUndo(true);
    });

  const discardProposal = () =>
    wrap(async () => {
      if (pendingIdx < 0) return;
      const next = await teacher.discardBankChatProposal(liveItem.id, pendingIdx);
      acceptUpdated(next);
    });

  const clearChat = () =>
    wrap(async () => {
      if (!confirm("Clear the chat history? Question and solution stay unchanged.")) return;
      const next = await teacher.clearBankChat(liveItem.id);
      acceptUpdated(next);
    });

  const undo = () =>
    wrap(async () => {
      const next = await teacher.revertBankItem(liveItem.id);
      acceptUpdated(next);
      setShowUndo(false);
    });

  const approve = () =>
    wrap(async () => {
      await teacher.approveBankItem(liveItem.id);
      setLiveItem({ ...liveItem, status: "approved" });
      onChanged();
    });

  const reject = () =>
    wrap(async () => {
      await teacher.rejectBankItem(liveItem.id);
      setLiveItem({ ...liveItem, status: "rejected" });
      onChanged();
    });

  const remove = () =>
    wrap(async () => {
      await teacher.deleteBankItem(liveItem.id);
      onClose();
      onChanged();
    });

  // Compute the artifact view: if a proposal is pending, show the
  // proposed values for the changed fields (but mark them as preview).
  const previewQuestion = pendingProposal?.question ?? liveItem.question;
  const previewSteps = pendingProposal?.solution_steps ?? liveItem.solution_steps;
  const previewAnswer = pendingProposal?.final_answer ?? liveItem.final_answer;
  const questionChanged = pendingProposal?.question != null;
  const stepsChanged = pendingProposal?.solution_steps != null;
  const answerChanged = pendingProposal?.final_answer != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-text-primary">Question</h2>
            <span
              className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
                STATUS_BADGE[liveItem.status] ?? ""
              }`}
            >
              {liveItem.status}
            </span>
            {showUndo && (
              <button
                onClick={undo}
                disabled={busy}
                className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
              >
                ↶ Undo last change
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {/* Two-panel body */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* LEFT — artifact */}
          <div className="flex-1 overflow-y-auto border-r border-border-light px-6 py-5">
            {/* Question */}
            <div
              className={`rounded-[--radius-lg] border p-4 transition-colors ${
                questionChanged
                  ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10"
                  : "border-border-light bg-surface"
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-text-muted">
                <span>Question</span>
                {questionChanged && (
                  <span className="text-blue-700 dark:text-blue-300">Preview</span>
                )}
              </div>
              <div className="mt-2 text-sm">
                {questionChanged ? (
                  <MathText text={previewQuestion} />
                ) : (
                  <ClickToEditText
                    value={liveItem.question}
                    multiline
                    onSave={saveQuestion}
                    busy={busy}
                  />
                )}
              </div>
            </div>

            {/* Solution */}
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setSolutionOpen(!solutionOpen)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
              >
                <span>{solutionOpen ? "▾" : "▸"}</span>
                Solution {previewSteps && `(${previewSteps.length} steps)`}
                {stepsChanged && (
                  <span className="ml-2 rounded-[--radius-pill] bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    Preview
                  </span>
                )}
              </button>

              {solutionOpen && (
                <div className="mt-3 space-y-2">
                  {previewSteps && previewSteps.length > 0 ? (
                    previewSteps.map((s, i) => (
                      <div
                        key={i}
                        className={`rounded-[--radius-lg] border p-4 ${
                          stepsChanged
                            ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10"
                            : "border-border-light bg-surface"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                            {i + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-text-primary">
                              {stepsChanged ? (
                                <MathText text={s.title} />
                              ) : (
                                <ClickToEditText
                                  value={s.title}
                                  inline
                                  onSave={(next) => saveStep(i, "title", next)}
                                  busy={busy}
                                />
                              )}
                            </div>
                            <div className="mt-1.5 h-px bg-border-light" />
                            <div className="mt-2 text-xs text-text-secondary">
                              {stepsChanged ? (
                                <MathText text={s.description} />
                              ) : (
                                <ClickToEditText
                                  value={s.description}
                                  multiline
                                  onSave={(next) => saveStep(i, "description", next)}
                                  busy={busy}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[--radius-md] bg-bg-subtle p-4 text-xs italic text-text-muted">
                      No solution steps recorded.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Final answer */}
            {previewAnswer !== null && (
              <div
                className={`mt-6 rounded-[--radius-lg] border-2 p-4 ${
                  answerChanged
                    ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10"
                    : "border-primary/30 bg-primary-bg/30"
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-primary">
                  <span>Final answer</span>
                  {answerChanged && (
                    <span className="text-blue-700 dark:text-blue-300">Preview</span>
                  )}
                </div>
                <div className="mt-2 text-base font-semibold text-text-primary">
                  {answerChanged ? (
                    <MathText text={previewAnswer ?? ""} />
                  ) : (
                    <ClickToEditText
                      value={liveItem.final_answer ?? ""}
                      onSave={saveFinalAnswer}
                      busy={busy}
                    />
                  )}
                </div>
              </div>
            )}

            {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
          </div>

          {/* RIGHT — chat panel */}
          <ChatPanel
            item={liveItem}
            pendingIdx={pendingIdx}
            busy={busy}
            onSend={sendChat}
            onAccept={acceptProposal}
            onDiscard={discardProposal}
            onClear={clearChat}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border-light px-6 py-3">
          {liveItem.status === "pending" && (
            <>
              <button
                onClick={approve}
                disabled={busy}
                className="rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Approve
              </button>
              <button
                onClick={reject}
                disabled={busy}
                className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                ✕ Reject
              </button>
            </>
          )}
          {confirmingDelete ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-red-700">Delete?</span>
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="ml-auto rounded-[--radius-md] border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Chat sidebar inside the workshop modal. Renders the message thread,
// the input box, the soft-cap banner, and the clear-chat link. Proposals
// inside AI messages render with Accept/Discard buttons (only for the
// pending one — others are tagged as accepted/discarded/superseded).

const SUGGESTION_CHIPS = [
  "Make it harder",
  "Add a step to the solution",
  "Rewrite as a word problem",
];

function ChatPanel({
  item,
  pendingIdx,
  busy,
  onSend,
  onAccept,
  onDiscard,
  onClear,
}: {
  item: BankItem;
  pendingIdx: number;
  busy: boolean;
  onSend: (message: string) => void;
  onAccept: () => void;
  onDiscard: () => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState("");
  const messages = item.chat_messages;
  const teacherCount = messages.filter((m) => m.role === "teacher").length;
  const atSoftCap = teacherCount >= item.chat_soft_cap;

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = document.getElementById(`chat-scroll-${item.id}`);
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, item.id, busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="flex w-full flex-col md:max-w-sm md:flex-shrink-0">
      <div className="flex items-center justify-between border-b border-border-light px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base">💬</span>
          <span className="text-sm font-bold text-text-primary">Workshop</span>
        </div>
        <span className={`text-[10px] font-semibold ${atSoftCap ? "text-amber-600" : "text-text-muted"}`}>
          {teacherCount}/{item.chat_soft_cap}
        </span>
      </div>

      {/* Messages */}
      <div
        id={`chat-scroll-${item.id}`}
        className="flex-1 space-y-3 overflow-y-auto bg-bg-subtle/40 px-4 py-3"
      >
        {messages.length === 0 && <WelcomeMessage />}
        {messages.map((msg, i) => (
          <ChatMessageBubble
            key={i}
            msg={msg}
            isPending={i === pendingIdx}
            busy={busy}
            onAccept={onAccept}
            onDiscard={onDiscard}
          />
        ))}
        {busy && (
          <div className="text-xs italic text-text-muted">AI is thinking…</div>
        )}
      </div>

      {/* Suggestion chips on first open */}
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border-light px-4 py-2">
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => onSend(chip)}
              disabled={busy}
              className="rounded-[--radius-pill] border border-border-light bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {atSoftCap && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          You&rsquo;ve sent a lot of messages — consider clearing the chat or starting fresh.
        </div>
      )}

      {/* Input */}
      <form
        className="border-t border-border-light bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Ask for changes, ask a question, or just chat about this problem…"
          className="w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={onClear}
            disabled={busy || messages.length === 0}
            className="text-[11px] font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            Clear chat
          </button>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div className="rounded-[--radius-md] bg-surface p-3 text-xs text-text-secondary shadow-sm">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
        AI
      </div>
      Hi! Ask me anything about this question. I can rewrite it, redo the solution,
      change the difficulty, turn it into a word problem, or just answer questions
      about it. Try one of the suggestions below or type your own.
    </div>
  );
}

function ChatMessageBubble({
  msg,
  isPending,
  busy,
  onAccept,
  onDiscard,
}: {
  msg: BankChatMessage;
  isPending: boolean;
  busy: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  if (msg.role === "teacher") {
    return (
      <div className="ml-6 rounded-[--radius-md] bg-primary px-3 py-2 text-xs text-white shadow-sm">
        {msg.text}
      </div>
    );
  }

  // AI message
  const proposalState = msg.accepted
    ? "accepted"
    : msg.discarded
      ? "discarded"
      : msg.superseded
        ? "superseded"
        : msg.proposal
          ? "pending"
          : null;

  return (
    <div className="rounded-[--radius-md] bg-surface p-3 text-xs text-text-secondary shadow-sm">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
        AI
      </div>
      <div className="text-text-primary">{msg.text}</div>

      {proposalState && (
        <div className="mt-2">
          {proposalState === "pending" && isPending && (
            <div className="rounded-[--radius-sm] border border-blue-200 bg-blue-50 p-2 dark:border-blue-500/30 dark:bg-blue-500/10">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                Preview shown ←
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={onAccept}
                  disabled={busy}
                  className="flex-1 rounded-[--radius-sm] bg-green-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  ✓ Accept
                </button>
                <button
                  onClick={onDiscard}
                  disabled={busy}
                  className="flex-1 rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
                >
                  ✕ Discard
                </button>
              </div>
            </div>
          )}
          {proposalState === "accepted" && (
            <div className="mt-1 text-[10px] font-bold text-green-700 dark:text-green-400">
              ✓ Accepted
            </div>
          )}
          {proposalState === "discarded" && (
            <div className="mt-1 text-[10px] font-bold text-text-muted">✕ Discarded</div>
          )}
          {proposalState === "superseded" && (
            <div className="mt-1 text-[10px] font-bold text-text-muted">
              ↻ Superseded by a newer proposal
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Click-to-edit text: shows MathText by default, becomes a textarea/input
// when clicked. Saves on blur or Enter (single-line) or Cmd/Ctrl+Enter
// (multiline). Escape cancels.
function ClickToEditText({
  value,
  multiline,
  inline,
  onSave,
  busy,
}: {
  value: string;
  multiline?: boolean;
  inline?: boolean;
  onSave: (next: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`group ${inline ? "inline" : "block w-full"} cursor-text text-left text-text-primary hover:rounded-[--radius-sm] hover:bg-primary-bg/20 hover:px-1 hover:-mx-1`}
        title="Click to edit"
        disabled={busy}
      >
        <MathText text={value || " "} />
      </button>
    );
  }

  const commit = () => {
    onSave(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (multiline) {
    return (
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        rows={Math.max(2, Math.min(8, draft.split("\n").length + 1))}
        className="w-full rounded-[--radius-md] border border-primary bg-bg-base px-2 py-1 text-sm text-text-primary focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className="w-full rounded-[--radius-sm] border border-primary bg-bg-base px-2 py-0.5 text-sm text-text-primary focus:outline-none"
      autoFocus
    />
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
