"use client";

import { useEffect, useMemo, useState } from "react";
import { teacher, type TeacherAssignment, type TeacherUnit } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { HomeworkDetailModal } from "./_pieces/homework-detail-modal";
import { NewHomeworkModal } from "./_pieces/new-homework-modal";
import { HomeworkList } from "./_pieces/homework-list";
import { UnitRail, type UnitSelection } from "./_pieces/unit-rail";

// Re-export the detail modal so existing import sites in
// question-bank-tab keep working without churning their import paths.
export { HomeworkDetailModal };

/**
 * Homework tab v2. Lists existing homework as state-rich cards
 * grouped by unit (mirrors the question-bank Approved view), with a
 * search bar and slim unit-filter rail. Opens a detail modal for
 * editing config / picking problems / publishing / unpublishing /
 * deleting. The bank picker (in _pieces/) is reused by both the new
 * homework modal and the edit-problems flow inside the detail modal.
 */
export function HomeworkTab({ courseId }: { courseId: string }) {
  const [homeworks, setHomeworks] = useState<TeacherAssignment[]>([]);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [unitSelection, setUnitSelection] = useState<UnitSelection>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignmentsRes, unitsRes] = await Promise.all([
        teacher.assignments(courseId),
        teacher.units(courseId),
      ]);
      // Filter to homework type only — tests get their own tab.
      setHomeworks(assignmentsRes.assignments.filter((a) => a.type === "homework"));
      setUnits(unitsRes.units);
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

  // Client-side unit + search filter. The unit selection from the
  // rail filters by `assignment.unit_ids` (HW's own units), not the
  // questions' units — that's the v2 mental model.
  const filteredHomeworks = useMemo(() => {
    let out = homeworks;
    if (unitSelection === "uncategorized") {
      out = out.filter((hw) => hw.unit_ids.length === 0);
    } else if (unitSelection !== "all") {
      out = out.filter((hw) => hw.unit_ids.includes(unitSelection));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter((hw) => hw.title.toLowerCase().includes(q));
    }
    return out;
  }, [homeworks, unitSelection, searchQuery]);

  // Counts for the rail. "All units" = total. "Uncategorized" = HWs
  // with empty unit_ids (shouldn't happen with the new validation
  // but defensive). Per-unit = HWs whose unit_ids include the unit.
  const countFor = (unitId: string | null) => {
    if (unitId === null) {
      return homeworks.filter((hw) => hw.unit_ids.length === 0).length;
    }
    return homeworks.filter((hw) => hw.unit_ids.includes(unitId)).length;
  };

  const publishedCount = homeworks.filter((hw) => hw.status === "published").length;
  const draftCount = homeworks.length - publishedCount;

  return (
    <div>
      {/* Header row: title + summary + New */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-bold text-text-primary">Homework</h2>
          {homeworks.length > 0 && (
            <p className="text-xs text-text-muted">
              {publishedCount} published · {draftCount}{" "}
              {draftCount === 1 ? "draft" : "drafts"}
            </p>
          )}
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

      {/* Search bar */}
      <div className="mt-4">
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
            aria-hidden
          >
            🔍
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${homeworks.length} ${
              homeworks.length === 1 ? "homework" : "homeworks"
            }…`}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Two-pane: slim unit rail on the left, list on the right. */}
      <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-start">
        <aside className="md:w-52 md:shrink-0">
          <UnitRail
            units={units}
            totalCount={homeworks.length}
            countFor={countFor}
            selected={unitSelection}
            onSelect={setUnitSelection}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {loading ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : filteredHomeworks.length === 0 ? (
            <EmptyState
              text={
                searchQuery.trim()
                  ? `No homeworks match "${searchQuery.trim()}".`
                  : homeworks.length === 0
                    ? "No homework yet. Click + New Homework to create one from your approved questions."
                    : unitSelection === "uncategorized"
                      ? "No homeworks without a unit."
                      : "No homeworks in this unit yet."
              }
            />
          ) : (
            <HomeworkList
              homeworks={filteredHomeworks}
              units={units}
              onOpen={setOpenId}
            />
          )}
        </div>
      </div>

      {showNew && (
        <NewHomeworkModal
          courseId={courseId}
          defaultUnitIds={
            unitSelection !== "all" && unitSelection !== "uncategorized"
              ? [unitSelection]
              : []
          }
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
