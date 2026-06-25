"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { teacher, type TeacherCourse } from "@/lib/api";
import { Field } from "@/components/school/shared/field";
import { Select } from "@/components/ui";

export function SettingsTab({ course, onChanged }: { course: TeacherCourse; onChanged: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(course.name);
  const [subject, setSubject] = useState(course.subject);
  const [gradeLevel, setGradeLevel] = useState(course.grade_level?.toString() ?? "");
  const [description, setDescription] = useState(course.description ?? "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    setDeleting(true);
    setError(null);
    try {
      await teacher.deleteCourse(course.id);
      router.push("/school/teacher");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete course");
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">Course settings</h2>

      <div className="mt-4 space-y-4 rounded-[--radius-md] border border-border-light bg-surface p-5">
        <Field label="Course name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Subject">
          <Select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full"
          >
            <option value="math">Math</option>
            <option value="physics">Physics</option>
            <option value="chemistry">Chemistry</option>
          </Select>
        </Field>
        <Field label="Grade level">
          <input
            type="number"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            min={1}
            max={12}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </Field>

        {error && <p className="text-xs text-[color:var(--color-error)]">{error}</p>}

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

      <div className="mt-6 rounded-[--radius-md] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-error)]">Danger zone</h3>
        <p className="mt-2 text-xs text-[color:var(--color-error)]">
          Permanently delete &ldquo;{course.name}&rdquo; and everything inside it. This affects all
          sections, materials, and student data and cannot be undone.
        </p>
        {confirmingDelete ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[color:var(--color-error)]">Are you sure?</span>
            <button
              onClick={deleteCourse}
              disabled={deleting}
              className="rounded-[--radius-sm] bg-[color:var(--color-error)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[color:var(--color-error)]/85 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Yes, delete forever"}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="rounded-[--radius-sm] border border-[color:var(--color-error-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[color:var(--color-error)] hover:bg-[color:var(--color-error-light)] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="mt-3 rounded-[--radius-sm] bg-[color:var(--color-error)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[color:var(--color-error)]/85"
          >
            Delete course
          </button>
        )}
      </div>
    </div>
  );
}
