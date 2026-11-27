"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { teacher, type TeacherCourse, type TeacherSection } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { DueDateChips } from "./due-date-chips";
import { SelectableChip } from "./selectable-chip";

export interface DuplicateSource {
  id: string;
  title: string;
  course_id: string;
  problem_count: number;
}

/**
 * Duplicate a homework into a new draft: pick the course it goes into,
 * when it's due and for which sections. Problems, grading rules, points
 * and instructions come with it; nothing is generated or re-reviewed.
 * Opens the new draft when done.
 */
export function DuplicateHomeworkDialog({
  source,
  intoCourseId,
  onClose,
  layered,
}: {
  source: DuplicateSource;
  /** Where the copy goes unless the teacher picks another course: the
   *  course she's working in. */
  intoCourseId: string;
  onClose: () => void;
  /** Open above another dialog (the New homework wizard). */
  layered?: boolean;
}) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [courses, setCourses] = useState<TeacherCourse[] | null>(null);
  const [courseId, setCourseId] = useState(intoCourseId);
  const [sections, setSections] = useState<TeacherSection[] | null>(null);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState("");
  const titleId = useId();
  const intoId = useId();

  useEffect(() => {
    let cancelled = false;
    teacher
      .courses()
      .then((r) => !cancelled && setCourses(r.courses))
      .catch(() => !cancelled && setCourses([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    teacher
      .sections(courseId)
      .then((r) => !cancelled && setSections(r.sections))
      .catch(() => !cancelled && setSections([]));
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const pickCourse = (id: string) => {
    // Sections belong to a course: picking another starts them over.
    setCourseId(id);
    setSections(null);
    setSectionIds([]);
  };
  const toggleSection = (id: string) =>
    setSectionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const courseName = (id: string) => courses?.find((c) => c.id === id)?.name ?? "";
  const crossCourse = courseId !== source.course_id;
  const n = source.problem_count;

  const onDuplicate = () =>
    run(async () => {
      const made = await teacher.duplicateAssignment(source.id, {
        ...(courseId !== source.course_id ? { course_id: courseId } : {}),
        ...(dueAt ? { due_at: new Date(dueAt).toISOString() } : {}),
        section_ids: sectionIds,
      });
      router.push(`/school/teacher/courses/${made.course_id}/homework/${made.id}`);
    }, "Couldn’t duplicate this homework");

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      labelledById={titleId}
      className="max-w-xl p-0"
      outerClassName={layered ? "z-[60]" : undefined}
      portal={layered}
    >
      <div className="border-b border-border-light px-6 py-4">
        <h2 id={titleId} className="font-serif text-xl leading-tight text-text-primary">
          Duplicate “{source.title}”
        </h2>
      </div>

      <div className="space-y-5 px-6 py-5">
        <div>
          <label htmlFor={intoId} className="block text-sm font-semibold text-text-primary">
            Into
          </label>
          <select
            id={intoId}
            value={courseId}
            onChange={(e) => pickCourse(e.target.value)}
            disabled={busy || !courses}
            className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-subtle px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none"
          >
            {!courses && <option value={courseId}>Loading your courses…</option>}
            {courses?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.id === intoCourseId ? " (this course)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="block text-sm font-semibold text-text-primary">
            Due <span className="font-normal text-text-muted">· 11:59 PM unless you change it</span>
          </span>
          <div className="mt-2">
            <DueDateChips
              value={dueAt}
              onChange={setDueAt}
              disabled={busy}
              noneHint="No due date yet. You can set one before you publish."
            />
          </div>
        </div>

        <div>
          <span className="block text-sm font-semibold text-text-primary">Sections</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {sections === null ? (
              <span className="text-xs text-text-muted">Loading sections…</span>
            ) : sections.length === 0 ? (
              <span className="text-xs text-text-muted">
                This course has no sections yet. Add one before you publish.
              </span>
            ) : (
              sections.map((s) => (
                <SelectableChip
                  key={s.id}
                  label={s.name}
                  selected={sectionIds.includes(s.id)}
                  onToggle={() => toggleSection(s.id)}
                  disabled={busy}
                />
              ))
            )}
          </div>
          {sections && sections.length > 0 && sectionIds.length === 0 && (
            <p className="mt-1.5 text-xs text-text-muted">
              Leave empty to assign to every section in this course.
            </p>
          )}
        </div>

        <p className="rounded-[--radius-md] bg-bg-subtle px-4 py-3 text-sm text-text-secondary">
          Copies {n} problem{n === 1 ? "" : "s"}, grading rules, points and instructions.
          {crossCourse && courseName(courseId)
            ? ` Its questions are copied into ${courseName(courseId)}, still approved.`
            : ""}{" "}
          Lands as a draft.
        </p>
        {error && (
          <p role="alert" className="text-sm font-semibold text-[color:var(--color-error)]">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3.5">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={busy || sections === null}
          className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Duplicating…" : "Duplicate as draft"}
        </button>
      </div>
    </Modal>
  );
}
