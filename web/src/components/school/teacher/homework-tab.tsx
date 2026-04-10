"use client";

import { useEffect, useMemo, useState } from "react";
import { teacher, type TeacherAssignment, type TeacherUnit } from "@/lib/api";
import { topUnits } from "@/lib/units";
import { EmptyState } from "@/components/school/shared/empty-state";
import { HomeworkDetailModal } from "./_pieces/homework-detail-modal";
import { NewHomeworkModal } from "./_pieces/new-homework-modal";
import {
  HomeworkTimeline,
  type BucketedHomeworks,
} from "./_pieces/homework-timeline";

// Re-export the detail modal so existing import sites in
// question-bank-tab keep working without churning their import paths.
export { HomeworkDetailModal };

// ── Filter types ──

type StatusFilter = "all" | "draft" | "published" | "completed";

interface HwFilters {
  status: StatusFilter;
  section: string | null;
  unit: string | null;
}

const EMPTY_FILTERS: HwFilters = { status: "all", section: null, unit: null };

/**
 * Homework tab — timeline view. Groups homeworks into time-based
 * buckets (Needs Grading, Due This Week, Upcoming, Completed) with
 * inline dropdown filters for Status, Section, and Unit.
 */
export function HomeworkTab({ courseId }: { courseId: string }) {
  const [homeworks, setHomeworks] = useState<TeacherAssignment[]>([]);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<HwFilters>(EMPTY_FILTERS);

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

  // ── Derive filter options from all homeworks ──

  const allSections = useMemo(() => {
    const set = new Set<string>();
    for (const hw of homeworks) {
      for (const s of hw.section_names) set.add(s);
    }
    return Array.from(set).sort();
  }, [homeworks]);

  const allUnitOptions = useMemo(() => topUnits(units), [units]);

  // ── Apply filters + search, then bucket ──

  const filtered = useMemo(() => {
    let out = homeworks;

    // Search
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter((hw) => hw.title.toLowerCase().includes(q));
    }

    // Status filter
    if (filters.status === "draft") {
      out = out.filter((hw) => hw.status !== "published");
    } else if (filters.status === "published") {
      out = out.filter((hw) => hw.status === "published");
    } else if (filters.status === "completed") {
      out = out.filter(
        (hw) =>
          hw.status === "published" &&
          hw.due_at !== null &&
          new Date(hw.due_at).getTime() < Date.now() &&
          hw.graded > 0 &&
          hw.submitted === hw.graded,
      );
    }

    // Section filter
    if (filters.section) {
      const sec = filters.section;
      out = out.filter((hw) => hw.section_names.includes(sec));
    }

    // Unit filter
    if (filters.unit) {
      const uid = filters.unit;
      out = out.filter((hw) => hw.unit_ids.includes(uid));
    }

    return out;
  }, [homeworks, searchQuery, filters]);

  const buckets = useMemo(() => bucketHomeworks(filtered), [filtered]);

  const totalBucketed =
    buckets.needsGrading.length +
    buckets.dueThisWeek.length +
    buckets.upcoming.length +
    buckets.completed.length;

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.section !== null ||
    filters.unit !== null ||
    searchQuery.trim() !== "";

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setSearchQuery("");
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

      {/* Inline filters */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) =>
            setFilters((f) => ({ ...f, status: v as StatusFilter }))
          }
          options={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
            { value: "completed", label: "Completed" },
          ]}
        />
        {allSections.length > 0 && (
          <FilterSelect
            label="Section"
            value={filters.section ?? ""}
            onChange={(v) =>
              setFilters((f) => ({ ...f, section: v || null }))
            }
            options={[
              { value: "", label: "All sections" },
              ...allSections.map((s) => ({ value: s, label: s })),
            ]}
          />
        )}
        {allUnitOptions.length > 0 && (
          <FilterSelect
            label="Unit"
            value={filters.unit ?? ""}
            onChange={(v) =>
              setFilters((f) => ({ ...f, unit: v || null }))
            }
            options={[
              { value: "", label: "All units" },
              ...allUnitOptions.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        )}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Content — full width, no UnitRail sidebar */}
      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : homeworks.length === 0 ? (
          <EmptyState text="No homework yet. Click + New Homework to create one from your approved questions." />
        ) : totalBucketed === 0 ? (
          <div className="mt-4 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
            No homeworks match your filters.{" "}
            <button
              type="button"
              onClick={clearAll}
              className="font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <HomeworkTimeline
            buckets={buckets}
            units={units}
            onOpen={setOpenId}
          />
        )}
      </div>

      {showNew && (
        <NewHomeworkModal
          courseId={courseId}
          defaultUnitIds={filters.unit ? [filters.unit] : []}
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

// ── Bucketing logic ──

function bucketHomeworks(homeworks: TeacherAssignment[]): BucketedHomeworks {
  const now = Date.now();
  const weekFromNow = now + 7 * 24 * 60 * 60 * 1000;

  const needsGrading: TeacherAssignment[] = [];
  const dueThisWeek: TeacherAssignment[] = [];
  const upcoming: TeacherAssignment[] = [];
  const completed: TeacherAssignment[] = [];

  for (const hw of homeworks) {
    if (hw.status !== "published") {
      // Drafts always go to upcoming
      upcoming.push(hw);
      continue;
    }

    const dueTime = hw.due_at ? new Date(hw.due_at).getTime() : null;
    const isPastDue = dueTime !== null && dueTime < now;
    const hasUngraded = hw.submitted > hw.graded;
    const hasMissing = isPastDue && hw.submitted < hw.total_students;

    // Completed: past due + all submitted are graded + graded > 0 +
    // everyone submitted (no missing students)
    if (
      isPastDue &&
      hw.graded > 0 &&
      hw.submitted === hw.graded &&
      hw.submitted >= hw.total_students
    ) {
      completed.push(hw);
      continue;
    }

    // Needs grading: has ungraded submissions OR overdue with missing
    if (hasUngraded || hasMissing) {
      needsGrading.push(hw);
      continue;
    }

    // Due this week: due within 7 days
    if (dueTime !== null && dueTime >= now && dueTime <= weekFromNow) {
      dueThisWeek.push(hw);
      continue;
    }

    // Everything else → upcoming (due > 7 days, or no due date)
    upcoming.push(hw);
  }

  // Sort within buckets
  needsGrading.sort(sortByDueAsc);
  dueThisWeek.sort(sortByDueAsc);
  upcoming.sort(sortUpcoming);
  completed.sort(sortByDueDesc);

  return { needsGrading, dueThisWeek, upcoming, completed };
}

function sortByDueAsc(a: TeacherAssignment, b: TeacherAssignment): number {
  if (a.due_at && b.due_at) {
    const diff = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    if (diff !== 0) return diff;
  } else if (a.due_at) {
    return -1;
  } else if (b.due_at) {
    return 1;
  }
  return a.title.localeCompare(b.title);
}

function sortByDueDesc(a: TeacherAssignment, b: TeacherAssignment): number {
  if (a.due_at && b.due_at) {
    const diff = new Date(b.due_at).getTime() - new Date(a.due_at).getTime();
    if (diff !== 0) return diff;
  } else if (a.due_at) {
    return 1;
  } else if (b.due_at) {
    return -1;
  }
  return a.title.localeCompare(b.title);
}

/** Drafts first, then by due date ascending. */
function sortUpcoming(a: TeacherAssignment, b: TeacherAssignment): number {
  const aDraft = a.status !== "published" ? 0 : 1;
  const bDraft = b.status !== "published" ? 0 : 1;
  if (aDraft !== bDraft) return aDraft - bDraft;
  return sortByDueAsc(a, b);
}

// ── Filter dropdown ──

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[--radius-md] border border-border-light bg-surface px-2.5 py-1.5 text-xs text-text-secondary focus:border-primary focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
