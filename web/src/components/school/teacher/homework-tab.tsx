"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherAssignment } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { HomeworkDetailModal } from "./_pieces/homework-detail-modal";
import { NewHomeworkModal } from "./_pieces/new-homework-modal";

// Re-export the detail modal so existing import sites in
// question-bank-tab keep working without churning their import paths.
export { HomeworkDetailModal };

/**
 * Teacher's homework list for a course. Lists existing homework as
 * cards (with status pill), opens a detail modal for editing /
 * picking problems / publishing / unpublishing / deleting. The bank
 * picker (in _pieces/) is reused by both the new homework modal and
 * the edit-problems flow inside the detail modal.
 */
export function HomeworkTab({ courseId }: { courseId: string }) {
  const [homeworks, setHomeworks] = useState<TeacherAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await teacher.assignments(courseId);
      // Filter to homework type only — tests get their own tab
      setHomeworks(res.assignments.filter((a) => a.type === "homework"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load homework");
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
        <div>
          <h2 className="text-lg font-bold text-text-primary">Homework</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {homeworks.length} {homeworks.length === 1 ? "homework" : "homeworks"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => setShowNew(true)}
        >
          + New Homework
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : homeworks.length === 0 ? (
          <EmptyState text="No homework yet. Click + New Homework to create one from your approved questions." />
        ) : (
          homeworks.map((hw) => (
            <HomeworkCard key={hw.id} hw={hw} onOpen={() => setOpenId(hw.id)} />
          ))
        )}
      </div>

      {showNew && (
        <NewHomeworkModal
          courseId={courseId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}

      {openId && (
        <HomeworkDetailModal
          courseId={courseId}
          assignmentId={openId}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function HomeworkCard({
  hw,
  onOpen,
}: {
  hw: TeacherAssignment;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-[--radius-lg] border border-border-light bg-surface p-4 text-left transition-shadow hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-text-primary">{hw.title}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Created {new Date(hw.created_at).toLocaleDateString()}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
            hw.status === "published"
              ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
              : "bg-gray-100 text-gray-600 dark:bg-gray-500/10"
          }`}
        >
          {hw.status}
        </span>
      </div>
    </button>
  );
}
