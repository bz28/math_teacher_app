"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { teacher, type TeacherAssignment, type TeacherUnit } from "@/lib/api";
import { TOUR_IDS } from "@/components/tour";
import { topUnits } from "@/lib/units";
import { Select } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/school/shared/empty-state";
import { NewHomeworkModal } from "./_pieces/new-homework-modal";
import { HomeworkTimeline } from "./_pieces/homework-timeline";
import { bucketHomeworks, isHomeworkCompleted } from "./_pieces/homework-buckets";

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
export function HomeworkTab({
  courseId,
  onGoToMaterials,
}: {
  courseId: string;
  /** Switches the parent course view to the Materials tab so a teacher
   *  with no units can create one before generating homework. */
  onGoToMaterials?: () => void;
}) {
  const router = useRouter();
  const [homeworks, setHomeworks] = useState<TeacherAssignment[]>([]);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<HwFilters>(EMPTY_FILTERS);

  const openDetail = (hwId: string) =>
    router.push(`/school/teacher/courses/${courseId}/homework/${hwId}`);

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
      // Same "Completed = all grades published" definition as the timeline
      // Completed bucket (shared predicate keeps the two in sync).
      out = out.filter((hw) => isHomeworkCompleted(hw));
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
          <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">Homework</h2>
          {homeworks.length > 0 && (
            <p className="font-mono text-[12px] text-text-muted">
              {publishedCount} published · {draftCount}{" "}
              {draftCount === 1 ? "draft" : "drafts"}
            </p>
          )}
        </div>
        <button
          type="button"
          data-tour-id={TOUR_IDS.teacherNewHomework}
          className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-primary-dark"
          onClick={() => setShowNew(true)}
        >
          New homework
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-[color:var(--color-error)]">{error}</p>}

      {/* Search bar */}
      <div className="mt-4">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search homework"
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
          <AssignmentListSkeleton />
        ) : homeworks.length === 0 ? (
          <EmptyState
            title="No homework yet"
            description="First, create a unit and upload materials, then generate homework from it."
            action={
              onGoToMaterials ? (
                <button
                  type="button"
                  onClick={onGoToMaterials}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Go to Materials →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowNew(true)}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  New homework →
                </button>
              )
            }
          />
        ) : totalBucketed === 0 ? (
          <EmptyState
            title="No homeworks match your filters"
            action={
              <button
                type="button"
                onClick={clearAll}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <HomeworkTimeline
            buckets={buckets}
            units={units}
            onOpen={openDetail}
          />
        )}
      </div>

      {showNew && (
        <NewHomeworkModal
          courseId={courseId}
          defaultUnitIds={filters.unit ? [filters.unit] : []}
          onClose={() => setShowNew(false)}
          onCreated={(newId, { startedGeneration }) => {
            setShowNew(false);
            if (startedGeneration) {
              // Route to the homework editor — its generating hero
              // shows the live problem count while gen runs, and the
              // pending banner takes the teacher into the review
              // queue once items land. /review handles approval only.
              router.push(
                `/school/teacher/courses/${courseId}/homework/${newId}`,
              );
            } else {
              openDetail(newId);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Initial-load placeholder for the homework timeline. Mirrors the real
 * silhouette — a couple of bucket eyebrows each over a stack of
 * assignment-row cards — so the list settles in place rather than
 * blanking to "Loading…".
 */
function AssignmentListSkeleton() {
  return (
    <div className="mt-4 space-y-8" aria-busy="true" aria-live="polite">
      {[2, 3].map((rows, b) => (
        <div key={b}>
          <Skeleton className="h-3 w-32 rounded-[--radius-sm]" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: rows }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-[--radius-lg] border border-border-light bg-surface p-4 shadow-sm"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-20 rounded-[--radius-pill]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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
    <Select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
