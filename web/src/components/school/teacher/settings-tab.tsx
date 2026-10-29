"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { teacher, type TeacherCourse } from "@/lib/api";
import { ClassRubricSection } from "@/components/school/teacher/_pieces/class-rubric-section";

export function SettingsTab({ course }: { course: TeacherCourse }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

      <ClassRubricSection key={course.id} courseId={course.id} courseName={course.name} />

      <div className="mt-8 rounded-[--radius-md] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-error)]">Danger zone</h3>
        <p className="mt-2 text-xs text-[color:var(--color-error)]">
          Permanently delete &ldquo;{course.name}&rdquo; and everything inside it. This affects all
          sections, materials, and student data and cannot be undone.
        </p>
        {error && <p className="mt-2 text-xs font-bold text-[color:var(--color-error)]">{error}</p>}
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
