"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { teacher, type TeacherAssignment, type TeacherUnit } from "@/lib/api";
import { topUnits, unitLabel as labelForUnit } from "@/lib/units";
import { EmptyState } from "@/components/school/shared/empty-state";
import { NewPracticeModal } from "./_pieces/new-practice-modal";

/**
 * Practice tab — ungraded practice sets for a course. Parallel to
 * Homework, but without grading/submission state, so the timeline
 * bucketing (Needs Grading / Due This Week / Completed) doesn't
 * apply. Keep it simple: search + status filter + unit filter, flat
 * list grouped by draft vs published.
 */

type StatusFilter = "all" | "draft" | "published";

interface PracticeFilters {
  status: StatusFilter;
  unit: string | null;
}

const EMPTY_FILTERS: PracticeFilters = { status: "all", unit: null };

export function PracticeTab({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [practices, setPractices] = useState<TeacherAssignment[]>([]);
  const [hwById, setHwById] = useState<Map<string, TeacherAssignment>>(
    new Map(),
  );
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<PracticeFilters>(EMPTY_FILTERS);

  const openDetail = (pid: string) =>
    router.push(`/school/teacher/courses/${courseId}/homework/${pid}`);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignmentsRes, unitsRes] = await Promise.all([
        teacher.assignments(courseId),
        teacher.units(courseId),
      ]);
      const all = assignmentsRes.assignments;
      setPractices(all.filter((a) => a.type === "practice"));
      // Keep HWs around in a lookup so "Cloned from <HW title>" can
      // render on each practice card without a second fetch.
      setHwById(
        new Map(all.filter((a) => a.type === "homework").map((a) => [a.id, a])),
      );
      setUnits(unitsRes.units);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load practice");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const allUnitOptions = useMemo(() => topUnits(units), [units]);

  const filtered = useMemo(() => {
    let out = practices;

    const q = searchQuery.trim().toLowerCase();
    if (q) out = out.filter((p) => p.title.toLowerCase().includes(q));

    if (filters.status === "draft") {
      out = out.filter((p) => p.status !== "published");
    } else if (filters.status === "published") {
      out = out.filter((p) => p.status === "published");
    }

    if (filters.unit) {
      const uid = filters.unit;
      out = out.filter((p) => p.unit_ids.includes(uid));
    }

    // Drafts first, then alphabetical within each group.
    return [...out].sort((a, b) => {
      const aDraft = a.status !== "published" ? 0 : 1;
      const bDraft = b.status !== "published" ? 0 : 1;
      if (aDraft !== bDraft) return aDraft - bDraft;
      return a.title.localeCompare(b.title);
    });
  }, [practices, searchQuery, filters]);

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.unit !== null ||
    searchQuery.trim() !== "";

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setSearchQuery("");
  };

  const publishedCount = practices.filter((p) => p.status === "published").length;
  const draftCount = practices.length - publishedCount;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-lg font-bold text-text-primary">Practice</h2>
          {practices.length > 0 && (
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
          + New Practice
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

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
            placeholder={`Search ${practices.length} practice ${
              practices.length === 1 ? "set" : "sets"
            }…`}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
          />
        </div>
      </div>

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
          ]}
        />
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

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : practices.length === 0 ? (
          <EmptyState text="No practice sets yet. Click + New Practice to create one — you can clone from a homework or start from scratch." />
        ) : filtered.length === 0 ? (
          <div className="mt-4 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle p-8 text-center text-sm text-text-muted">
            No practice sets match your filters.{" "}
            <button
              type="button"
              onClick={clearAll}
              className="font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((p) => (
              <PracticeCard
                key={p.id}
                practice={p}
                unitLabel={resolveUnitLabel(p, units)}
                sourceHw={
                  p.source_homework_id
                    ? hwById.get(p.source_homework_id) ?? null
                    : null
                }
                onOpen={() => openDetail(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewPracticeModal
          courseId={courseId}
          defaultUnitIds={filters.unit ? [filters.unit] : []}
          onClose={() => setShowNew(false)}
          onCreated={(newId, { startedGeneration }) => {
            setShowNew(false);
            if (startedGeneration) {
              // Route straight into the review queue — the skeleton
              // state carries the teacher through the ~30s wait while
              // clone jobs land items.
              router.push(
                `/school/teacher/courses/${courseId}/homework/${newId}/review`,
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

function PracticeCard({
  practice,
  unitLabel,
  sourceHw,
  onOpen,
}: {
  practice: TeacherAssignment;
  /** Pre-resolved unit label string. Empty string when the practice
   *  has no units yet — the meta row hides that segment. */
  unitLabel: string;
  sourceHw: TeacherAssignment | null;
  onOpen: () => void;
}) {
  const isDraft = practice.status !== "published";
  const sectionLabel =
    practice.section_names.length > 0
      ? practice.section_names.join(", ")
      : "No sections";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-[--radius-md] border border-border bg-surface p-4 text-left transition-colors hover:border-primary"
    >
      {/* Title row — pill is inline with the title, matching the HW
          card's pattern so the two list pages feel like siblings. */}
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary group-hover:text-primary">
          {practice.title}
        </h3>
        {isDraft ? (
          <span className="shrink-0 rounded-full border border-text-muted/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
            draft
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-800 dark:bg-green-500/20 dark:text-green-300">
            published
          </span>
        )}
      </div>

      {/* Meta row: unit · sections — mirrors HomeworkCard's meta. No
          due date because practice is ungraded. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
        {unitLabel && (
          <>
            <span className="font-medium text-text-secondary">{unitLabel}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className={practice.section_names.length === 0 ? "italic" : ""}>
          {sectionLabel}
        </span>
      </div>

      <div className="mt-1 text-[11px] text-text-muted">
        {practice.problem_count}{" "}
        {practice.problem_count === 1 ? "problem" : "problems"}
        {practice.pending_review > 0 && (
          <>
            {" · "}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              {practice.pending_review} pending review
            </span>
          </>
        )}
      </div>

      {sourceHw && (
        <div className="mt-1.5 text-[11px] text-text-muted">
          Cloned from{" "}
          <span className="font-medium text-text-secondary">
            {sourceHw.title}
          </span>
        </div>
      )}
    </button>
  );
}

/** Resolve a single unit label from the practice's unit_ids. Practice
 *  is single-unit in current product UX, so we honor the first id. */
function resolveUnitLabel(
  practice: TeacherAssignment,
  units: TeacherUnit[],
): string {
  if (practice.unit_ids.length === 0) return "";
  return labelForUnit(units, practice.unit_ids[0]);
}

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
