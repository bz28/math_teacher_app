"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { teacher, type GradesRosterResponse, type GradesRosterRow } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { PercentBadge } from "@/components/school/shared/percent-badge";
import { SearchIcon } from "@/components/ui/icons";

/**
 * Grades tab — the read-only final-record view.
 *
 * Mental model: audit layer. Teachers open this to answer "how is
 * student X doing?" or "who's failing?" It never shows drafts —
 * grades appear only after the teacher clicks "Publish grades" on
 * the HW itself. Drafts live in the Submissions tab.
 *
 * Boundary discipline: any "still being graded / not graded yet"
 * affordance lives in Submissions, NOT here. Filters on this page
 * surface accumulated gradebook state (struggling, missing-work),
 * never grading-queue state.
 *
 * Default sort: last name. Click a column header to sort by it; click
 * the active header again to flip direction. Section selector is
 * tab-style at the top since the page is fundamentally a per-section
 * gradebook view.
 *
 * Clicking a row opens /grades/[sectionId]/students/[studentId] —
 * the student's full published-HW record.
 */

type SortKey = "name" | "graded" | "avg";
type SortDir = "asc" | "desc";
type FilterMode = "all" | "needs_attention" | "missing";

// Buckets align with PercentBadge thresholds (>=85 strong, 70-84 ok,
// <70 struggling). One source of truth for "what counts as struggling"
// — see web/src/components/school/shared/percent-badge.tsx.
const STRUGGLING_THRESHOLD = 70;
const STRONG_THRESHOLD = 85;

export function GradesTab({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [data, setData] = useState<GradesRosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "name",
    dir: "asc",
  });
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  useEffect(() => {
    let cancelled = false;
    teacher
      .gradesRoster(courseId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load grades");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // Section-filtered roster — the canonical "what the teacher's
  // looking at right now" subset. Drives both the table and every
  // summary stat (class avg, distribution, attention/missing counts)
  // so chips and the table stay in agreement.
  const sectionScoped = useMemo(() => {
    if (!data) return [];
    if (sectionFilter === "all") return data.students;
    return data.students.filter((r) => r.section_id === sectionFilter);
  }, [data, sectionFilter]);

  const summary = useMemo(() => computeSummary(sectionScoped), [sectionScoped]);

  // Per-section comparison chips, only meaningful when "All sections"
  // is selected. Each section gets its own avg so the teacher can spot
  // a lagging period without flipping the filter.
  const sectionAverages = useMemo(() => {
    if (!data || sectionFilter !== "all") return [];
    return data.sections.map((s) => {
      const rows = data.students.filter((r) => r.section_id === s.id);
      return { id: s.id, name: s.name, avg: avgOf(rows) };
    });
  }, [data, sectionFilter]);

  const needsAttentionCount = useMemo(
    () =>
      sectionScoped.filter(
        (r) => r.avg_percent !== null && r.avg_percent < STRUGGLING_THRESHOLD,
      ).length,
    [sectionScoped],
  );
  const missingWorkCount = useMemo(
    () => sectionScoped.filter((r) => r.missing_count > 0).length,
    [sectionScoped],
  );

  const filtered = useMemo(() => {
    let out = sectionScoped;
    if (filterMode === "needs_attention") {
      out = out.filter(
        (r) => r.avg_percent !== null && r.avg_percent < STRUGGLING_THRESHOLD,
      );
    } else if (filterMode === "missing") {
      out = out.filter((r) => r.missing_count > 0);
    }
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    const sorted = out.slice();
    const dirMul = sort.dir === "asc" ? 1 : -1;
    if (sort.key === "name") {
      sorted.sort(
        (a, b) => lastNameKey(a.name).localeCompare(lastNameKey(b.name)) * dirMul,
      );
    } else if (sort.key === "graded") {
      sorted.sort((a, b) => (a.graded_count - b.graded_count) * dirMul);
    } else {
      // Students with no avg yet sink to the bottom regardless of
      // direction — they're not "doing badly," they just have nothing
      // to show, and surfacing them in either tail of the avg sort is
      // misleading.
      sorted.sort((a, b) => {
        const av = a.avg_percent;
        const bv = b.avg_percent;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dirMul;
      });
    }
    return sorted;
  }, [sectionScoped, search, sort, filterMode]);

  if (error) {
    return <p className="mt-6 text-sm text-red-600">{error}</p>;
  }

  if (data === null) {
    return <p className="mt-6 text-sm text-text-muted">Loading grades…</p>;
  }

  if (data.students.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState text="No enrolled students yet. Once students join a section, their grades will show up here." />
      </div>
    );
  }

  const showSectionTabs = data.sections.length > 1;

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : // Picking a new column starts at "asc" for name/graded, but
          // "asc" for avg means low-first (struggling first) — that's
          // the more useful default since teachers click avg to find
          // who needs help.
          { key, dir: "asc" },
    );
  }

  return (
    <div className="mt-2 space-y-4">
      {/* Class-summary strip — vibe check before the table. Distribution
          bar uses the same thresholds as PercentBadge so what counts
          as struggling is one knob, not two. */}
      <ClassSummary summary={summary} />

      {/* Section selector as tabs (vs the old dropdown) — the page is
          fundamentally a per-section gradebook, so the section pivot
          deserves prominence. Hidden when there's only one section. */}
      {showSectionTabs && (
        <SectionTabs
          sections={data.sections}
          value={sectionFilter}
          onChange={(v) => {
            setSectionFilter(v);
            // Filter mode is calibrated against the section-scoped
            // subset; resetting to "all" on section change avoids
            // landing in a 0-row state from a non-matching filter.
            setFilterMode("all");
          }}
        />
      )}

      {/* Per-section comparison chips — only meaningful in the "All"
          state where pooled stats can mask period-to-period gaps. */}
      {sectionFilter === "all" && sectionAverages.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
          <span className="font-bold uppercase tracking-wider">Sections</span>
          {sectionAverages.map((s) => (
            <span
              key={s.id}
              className="rounded-[--radius-pill] border border-border-light bg-surface px-2 py-0.5 font-semibold text-text-secondary"
              title={s.avg === null ? "No graded HWs yet" : `${s.name} class average`}
            >
              {s.name}{" "}
              <span className={avgChipTone(s.avg)}>
                {s.avg === null ? "—" : `${Math.round(s.avg)}%`}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Search + filter chips — chips replace the old single sort
          toggle and turn "find strugglers" into one click. Counts on
          the chips are scoped to the active section so chip count and
          table length agree. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students"
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base py-2 pl-9 pr-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          label="All"
          active={filterMode === "all"}
          onClick={() => setFilterMode("all")}
        />
        <FilterChip
          label="Needs attention"
          count={needsAttentionCount}
          active={filterMode === "needs_attention"}
          onClick={() => setFilterMode("needs_attention")}
          disabled={needsAttentionCount === 0}
        />
        <FilterChip
          label="Missing work"
          count={missingWorkCount}
          active={filterMode === "missing"}
          onClick={() => setFilterMode("missing")}
          disabled={missingWorkCount === 0}
        />
      </div>

      {/* Roster table */}
      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-xs text-text-muted">
          No students match those filters.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[--radius-md] border border-border-light bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-bg-subtle text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">
                <SortableHeader
                  label="Name"
                  active={sort.key === "name"}
                  dir={sort.dir}
                  onClick={() => toggleSort("name")}
                />
                {sectionFilter === "all" && <th className="px-4 py-2">Section</th>}
                <SortableHeader
                  label="Graded"
                  active={sort.key === "graded"}
                  dir={sort.dir}
                  onClick={() => toggleSort("graded")}
                />
                <SortableHeader
                  label="Avg"
                  align="right"
                  active={sort.key === "avg"}
                  dir={sort.dir}
                  onClick={() => toggleSort("avg")}
                />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <RosterRow
                  key={`${r.student_id}-${r.section_id}`}
                  row={r}
                  courseId={courseId}
                  showSection={sectionFilter === "all"}
                  router={router}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

function ClassSummary({ summary }: { summary: SummaryStats }) {
  const { total, withAvg, classAvg, strong, ok, struggling } = summary;
  if (total === 0) {
    return null;
  }
  const ungraded = total - withAvg;
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-text-primary">
          Class avg{" "}
          {classAvg === null ? (
            <span className="text-text-muted">—</span>
          ) : (
            <span className={percentTone(classAvg)}>{Math.round(classAvg)}%</span>
          )}
        </span>
        <span className="text-xs text-text-muted">
          {total} student{total === 1 ? "" : "s"}
          {ungraded > 0 && (
            <>
              {" · "}
              <span title="Students with no graded HWs yet">
                {ungraded} not yet graded
              </span>
            </>
          )}
        </span>
      </div>
      {/* Distribution bar — segmented horizontal bar showing how
          students fall into strong / ok / struggling buckets. Hidden
          when no student has a published average yet. */}
      {withAvg > 0 && (
        <div className="mt-2.5">
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-bg-subtle"
            role="img"
            aria-label={`Grade distribution: ${strong} students at or above ${STRONG_THRESHOLD} percent, ${ok} between ${STRUGGLING_THRESHOLD} and ${STRONG_THRESHOLD - 1} percent, ${struggling} below ${STRUGGLING_THRESHOLD} percent`}
          >
            {strong > 0 && (
              <div
                className="bg-green-500"
                style={{ width: `${(strong / withAvg) * 100}%` }}
                title={`${strong} student${strong === 1 ? "" : "s"} at ≥${STRONG_THRESHOLD}%`}
              />
            )}
            {ok > 0 && (
              <div
                className="bg-amber-400"
                style={{ width: `${(ok / withAvg) * 100}%` }}
                title={`${ok} student${ok === 1 ? "" : "s"} ${STRUGGLING_THRESHOLD}-${STRONG_THRESHOLD - 1}%`}
              />
            )}
            {struggling > 0 && (
              <div
                className="bg-red-500"
                style={{ width: `${(struggling / withAvg) * 100}%` }}
                title={`${struggling} student${struggling === 1 ? "" : "s"} below ${STRUGGLING_THRESHOLD}%`}
              />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
            <DistributionLegend dot="bg-green-500" label={`≥${STRONG_THRESHOLD}%`} count={strong} />
            <DistributionLegend dot="bg-amber-400" label={`${STRUGGLING_THRESHOLD}-${STRONG_THRESHOLD - 1}%`} count={ok} />
            <DistributionLegend dot="bg-red-500" label={`<${STRUGGLING_THRESHOLD}%`} count={struggling} />
          </div>
        </div>
      )}
    </div>
  );
}

function DistributionLegend({ dot, label, count }: { dot: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span className="font-semibold text-text-secondary">{count}</span> {label}
    </span>
  );
}

function SectionTabs({
  sections,
  value,
  onChange,
}: {
  sections: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter by section"
      className="flex flex-wrap items-center gap-1.5"
    >
      <SectionTab label="All sections" active={value === "all"} onClick={() => onChange("all")} />
      {sections.map((s) => (
        <SectionTab
          key={s.id}
          label={s.name}
          active={value === s.id}
          onClick={() => onChange(s.id)}
        />
      ))}
    </div>
  );
}

function SectionTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? "border-primary bg-primary text-white"
          : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary"
      }`}
    >
      {label}
    </button>
  );
}

function FilterChip({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-[--radius-pill] border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? "border-primary bg-primary-bg text-primary"
          : disabled
            ? "border-border-light bg-bg-subtle text-text-muted/60 cursor-not-allowed"
            : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={`rounded-[--radius-pill] px-1.5 text-[10px] tabular-nums ${
            active ? "bg-primary text-white" : "bg-bg-subtle text-text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function SortableHeader({
  label,
  active,
  dir,
  align = "left",
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onClick: () => void;
}) {
  const indicator = active ? (dir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-2 ${align === "right" ? "text-right" : ""}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:text-text-primary ${
          active ? "text-text-primary" : ""
        }`}
      >
        {label}
        <span aria-hidden className="text-[9px]">
          {indicator || "↕"}
        </span>
      </button>
    </th>
  );
}

function RosterRow({
  row,
  courseId,
  showSection,
  router,
}: {
  row: GradesRosterRow;
  courseId: string;
  showSection: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const href = `/school/teacher/courses/${courseId}/grades/${row.section_id}/students/${row.student_id}`;
  return (
    <tr
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          router.push(href);
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`View ${row.name}'s grades`}
      className="cursor-pointer border-t border-border-light transition-colors hover:bg-bg-subtle/60 focus:bg-bg-subtle/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
    >
      <td className="px-4 py-3 font-semibold text-text-primary">{row.name}</td>
      {showSection && (
        <td className="px-4 py-3 text-xs text-text-secondary">{row.section_name}</td>
      )}
      <td className="px-4 py-3 text-xs text-text-muted">
        <span className="font-semibold text-text-primary">{row.graded_count}</span>
        {" / "}
        {row.assigned_count}
        {row.missing_count > 0 && (
          <span className="ml-2 rounded-[--radius-pill] border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {row.missing_count} missing
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <PercentBadge percent={row.avg_percent} />
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers

interface SummaryStats {
  total: number;
  /** Number of students with at least one published grade (i.e.
   *  avg_percent !== null). Drives the distribution-bar denominator
   *  and the "X not yet graded" callout. */
  withAvg: number;
  classAvg: number | null;
  strong: number;
  ok: number;
  struggling: number;
}

function computeSummary(rows: GradesRosterRow[]): SummaryStats {
  let strong = 0;
  let ok = 0;
  let struggling = 0;
  let sum = 0;
  let withAvg = 0;
  for (const r of rows) {
    if (r.avg_percent === null) continue;
    withAvg += 1;
    sum += r.avg_percent;
    if (r.avg_percent >= STRONG_THRESHOLD) strong += 1;
    else if (r.avg_percent >= STRUGGLING_THRESHOLD) ok += 1;
    else struggling += 1;
  }
  return {
    total: rows.length,
    withAvg,
    classAvg: withAvg > 0 ? sum / withAvg : null,
    strong,
    ok,
    struggling,
  };
}

function avgOf(rows: GradesRosterRow[]): number | null {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (r.avg_percent === null) continue;
    sum += r.avg_percent;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

function percentTone(percent: number): string {
  if (percent >= STRONG_THRESHOLD) return "text-green-700 dark:text-green-400";
  if (percent >= STRUGGLING_THRESHOLD) return "text-text-primary";
  return "text-red-700 dark:text-red-400";
}

function avgChipTone(avg: number | null): string {
  if (avg === null) return "text-text-muted";
  return percentTone(avg);
}

/** "Last, First" or best-effort last-name first for sort. Users have
 *  a single `name` field — split on last space and take the tail. */
function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toLowerCase();
  return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
}
