"use client";

import { useEffect, useMemo, useState } from "react";
import {
  teacher,
  type GradebookResponse,
  type GradesRosterResponse,
  type GradesRosterRow,
} from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { PageErrorState } from "@/components/ui/page-error-state";
import { GradebookGrid } from "./gradebook-grid";
import { shown } from "@/lib/gradebook";
import {
  percentTone,
  STRONG_THRESHOLD,
  STRUGGLING_THRESHOLD,
} from "@/components/school/shared/percent-badge";
import { SearchIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Grades tab — the read-only final-record view, as a gradebook.
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
 * One grid per section (the tabs pick the class): students down the
 * side, published homework across the top, newest first. Every score
 * is auditable in place and links to its submission — see
 * GradebookGrid. Clicking a name opens
 * /grades/[sectionId]/students/[studentId], the student's full record.
 */

type FilterMode = "all" | "needs_attention" | "missing";

// Buckets align with PercentBadge thresholds — STRONG_THRESHOLD and
// STRUGGLING_THRESHOLD are imported from percent-badge so "what counts
// as struggling" stays one knob across the codebase.

export function GradesTab({ courseId }: { courseId: string }) {
  const [data, setData] = useState<GradesRosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A gradebook is one class: the tabs pick which section's grid shows.
  // Null until the roster arrives, then the first section.
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [grid, setGrid] = useState<GradebookResponse | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  // CSV export state. Downloads the active section's grid, or — for a
  // teacher importing every period into her school's system at once —
  // the whole course.
  const [exporting, setExporting] = useState<"section" | "course" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Bump to re-fire the fetches (the retry affordance on the error
  // state). The retry handler clears data/error so the skeleton shows
  // while the refetch is in flight.
  const [reloadKey, setReloadKey] = useState(0);
  const retry = () => {
    setData(null);
    setError(null);
    setGrid(null);
    setGridError(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    let cancelled = false;
    teacher
      .gradesRoster(courseId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setSectionId((cur) =>
          cur && res.sections.some((s) => s.id === cur) ? cur : (res.sections[0]?.id ?? null),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load grades");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, reloadKey]);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    teacher
      .gradebook(courseId, sectionId)
      .then((res) => {
        if (!cancelled) setGrid(res);
      })
      .catch((e) => {
        if (!cancelled) {
          setGridError(e instanceof Error ? e.message : "Failed to load the gradebook");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, sectionId, reloadKey]);

  // The grid for the active section only — a stale grid from the
  // previous tab never renders under the new tab's name.
  const current = grid && grid.section.id === sectionId ? grid : null;
  const students = useMemo(() => current?.students ?? [], [current]);

  const summary = useMemo(() => computeSummary(students), [students]);

  // Per-section averages on the tabs so the teacher can spot a lagging
  // period without switching. From the roster (every section at once).
  const sectionAverages = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!data) return m;
    for (const s of data.sections) {
      m.set(s.id, avgOf(data.students.filter((r) => r.section_id === s.id)));
    }
    return m;
  }, [data]);

  const needsAttentionCount = useMemo(
    () => students.filter(isStruggling).length,
    [students],
  );
  const missingWorkCount = useMemo(
    () => students.filter((r) => r.missing_count > 0).length,
    [students],
  );

  const filtered = useMemo(() => {
    let out = students;
    if (filterMode === "needs_attention") {
      out = out.filter(isStruggling);
    } else if (filterMode === "missing") {
      out = out.filter((r) => r.missing_count > 0);
    }
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    return out;
  }, [students, search, filterMode]);

  if (error || gridError) {
    return (
      <PageErrorState
        message="We couldn't load this right now."
        onRetry={retry}
      />
    );
  }

  if (data === null) {
    return <GradesSkeleton />;
  }

  if (data.students.length === 0 || !sectionId) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No enrolled students yet"
          description="Once students join a section, their grades will show up here."
        />
      </div>
    );
  }

  const showSectionTabs = data.sections.length > 1;

  async function runExport(scope: "section" | "course") {
    setExportError(null);
    setExporting(scope);
    try {
      await teacher.exportGradesCSV(courseId, scope === "section" ? (sectionId ?? undefined) : undefined);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="mt-2 space-y-4">
      {/* Section summary — vibe check before the grid. Distribution
          bar uses the same thresholds as PercentBadge so what counts
          as struggling is one knob, not two. */}
      {current ? (
        <ClassSummary summary={summary} />
      ) : (
        // A section is loading — a placeholder, not "0 students".
        <div className="space-y-2.5" aria-busy="true">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      )}

      {/* One gradebook per section — a class is a period in K-12, and
          mixing periods in one grid isn't a gradebook anyone keeps.
          Each tab carries its section's average. Hidden when there's
          only one section. */}
      {showSectionTabs && (
        <SectionTabs
          sections={data.sections}
          sectionAverages={sectionAverages}
          value={sectionId}
          onChange={(v) => {
            setSectionId(v);
            // Filter mode is calibrated per section; reset so a switch
            // never lands on a 0-row filter.
            setFilterMode("all");
          }}
        />
      )}

      {/* Search + filter chips. Counts are the active section's, so a
          chip's count and the grid's rows agree. Export sits alongside
          and downloads exactly this section's grid. */}
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
            aria-label="Search students"
            className="w-full rounded-[--radius-md] border border-border-light bg-surface py-2 pl-9 pr-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <ExportButton
          label="Export CSV ↓"
          busyLabel="Exporting…"
          title="Download this section's grades as CSV (imports into Canvas, Schoology, PowerSchool)"
          busy={exporting === "section"}
          disabled={exporting !== null}
          onClick={() => runExport("section")}
        />
        {showSectionTabs && (
          <ExportButton
            label="All sections ↓"
            busyLabel="Exporting…"
            title="Download every section's grades in one CSV"
            busy={exporting === "course"}
            disabled={exporting !== null}
            onClick={() => runExport("course")}
          />
        )}
      </div>
      {exportError && (
        <p className="text-xs text-[color:var(--color-error)]">{exportError}</p>
      )}

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
          disabled={!current || needsAttentionCount === 0}
        />
        <FilterChip
          label="Missing work"
          count={missingWorkCount}
          active={filterMode === "missing"}
          onClick={() => setFilterMode("missing")}
          disabled={!current || missingWorkCount === 0}
        />
      </div>

      {current === null ? (
        <GridSkeleton />
      ) : current.students.length === 0 ? (
        <EmptyState
          title={`No students in ${current.section.name} yet`}
          description="Once students join this section, their grades will show up here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No students match those filters" />
      ) : (
        <GradebookGrid courseId={courseId} data={current} rows={filtered} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

/**
 * Initial-load placeholder for the gradebook. Mirrors the real
 * silhouette — summary strip, search + filter chips, and a roster
 * table — so the page settles in place rather than blanking to
 * "Loading…".
 */
function GradesSkeleton() {
  return (
    <div className="mt-2 space-y-4" aria-busy="true" aria-live="polite">
      <div className="space-y-2.5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 flex-1 min-w-[220px] rounded-[--radius-md]" />
        <Skeleton className="h-10 w-28 rounded-[--radius-md]" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["w-12", "w-32", "w-28"].map((w, i) => (
          <Skeleton key={i} className={`h-7 rounded-[--radius-pill] ${w}`} />
        ))}
      </div>
      <div className="overflow-hidden rounded-[--radius-md] border border-border-light bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 border-t border-border-light px-4 py-3 first:border-t-0"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-12 rounded-[--radius-pill]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Below the struggling line, judged on the number shown (see `shown`). */
function isStruggling(r: { avg_percent: number | null }): boolean {
  return r.avg_percent !== null && shown(r.avg_percent) < STRUGGLING_THRESHOLD;
}

function ExportButton({
  label,
  busyLabel,
  title,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busyLabel: string;
  title: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="shrink-0 rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? busyLabel : label}
    </button>
  );
}

/** Placeholder for the grid while a section's gradebook loads. */
function GridSkeleton() {
  return (
    <div className="space-y-2 rounded-[--radius-md] border border-border-light bg-surface p-4" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

function ClassSummary({ summary }: { summary: SummaryStats }) {
  const { total, withAvg, strong, ok, struggling } = summary;
  // Always render even at total === 0 — keeps the layout from
  // jumping when the teacher switches to an empty section, and the
  // "0 students" label gives explicit feedback ("yes, this section
  // is empty") instead of the strip silently disappearing.
  //
  // Deliberately NO card chrome (border/shadow) on the wrapper —
  // when there's no distribution bar to anchor (withAvg === 0) the
  // chrome wraps nothing but a sparse label and looks like an
  // empty placeholder. Inline text + optional bar reads cleaner in
  // both populated and empty states.
  return (
    <div>
      {/* No headline avg here. The section's avg is already on its
          tab and in the grid's "Section average" row. Distribution
          bar carries the visual gestalt; per-section comparisons
          live on the tabs. Also deliberately
          NOT showing an "X not yet graded" callout here — that's
          grading-queue framing and lives on the Submissions tab. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-text-primary">
          {total} student{total === 1 ? "" : "s"}
        </span>
      </div>
      {/* Distribution bar — segmented horizontal bar showing how
          students fall into strong / ok / struggling buckets. Hidden
          when no student has a published average yet. */}
      {withAvg > 0 && (
        <div className="mt-2.5">
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-[color:var(--color-surface-alt-2)]"
            role="img"
            aria-label={`Grade distribution: ${strong} students at or above ${STRONG_THRESHOLD} percent, ${ok} between ${STRUGGLING_THRESHOLD} and ${STRONG_THRESHOLD - 1} percent, ${struggling} below ${STRUGGLING_THRESHOLD} percent`}
          >
            {strong > 0 && (
              <div
                className="bg-[color:var(--color-success)]"
                style={{ width: `${(strong / withAvg) * 100}%` }}
                title={`${strong} student${strong === 1 ? "" : "s"} at ≥${STRONG_THRESHOLD}%`}
              />
            )}
            {ok > 0 && (
              <div
                className="bg-[color:var(--color-warning)]"
                style={{ width: `${(ok / withAvg) * 100}%` }}
                title={`${ok} student${ok === 1 ? "" : "s"} ${STRUGGLING_THRESHOLD}-${STRONG_THRESHOLD - 1}%`}
              />
            )}
            {struggling > 0 && (
              <div
                className="bg-[color:var(--color-error)]"
                style={{ width: `${(struggling / withAvg) * 100}%` }}
                title={`${struggling} student${struggling === 1 ? "" : "s"} below ${STRUGGLING_THRESHOLD}%`}
              />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
            <DistributionLegend dot="bg-[color:var(--color-success)]" label={`≥${STRONG_THRESHOLD}%`} count={strong} />
            <DistributionLegend dot="bg-[color:var(--color-warning)]" label={`${STRUGGLING_THRESHOLD}-${STRONG_THRESHOLD - 1}%`} count={ok} />
            <DistributionLegend dot="bg-[color:var(--color-error)]" label={`<${STRUGGLING_THRESHOLD}%`} count={struggling} />
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
  sectionAverages,
  value,
  onChange,
}: {
  sections: { id: string; name: string }[];
  sectionAverages: Map<string, number | null>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Section"
      className="flex flex-wrap items-center gap-1.5"
    >
      {sections.map((s) => (
        <SectionTab
          key={s.id}
          label={s.name}
          avg={sectionAverages.get(s.id) ?? null}
          active={value === s.id}
          onClick={() => onChange(s.id)}
        />
      ))}
    </div>
  );
}

function SectionTab({
  label,
  avg,
  active,
  onClick,
}: {
  label: string;
  /** Per-section avg shown inline; null for sections with no graded
   *  HWs yet (rendered as em-dash). */
  avg: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? "border-primary bg-primary text-white"
          : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary"
      }`}
    >
      <span>{label}</span>
      <span
        className={`text-[10px] tabular-nums ${
          active
            ? "text-white/80"
            : avg === null
              ? "text-text-muted"
              : percentTone(shown(avg))
        }`}
        aria-hidden
      >
        {avg === null ? "—" : `${shown(avg)}%`}
      </span>
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
            ? "border-border-light bg-[color:var(--color-surface-alt-2)] text-text-muted/60 cursor-not-allowed"
            : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={`rounded-[--radius-pill] px-1.5 text-[10px] tabular-nums ${
            active ? "bg-primary text-white" : "bg-[color:var(--color-surface-alt-2)] text-text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}



// ────────────────────────────────────────────────────────────────────
// Helpers

interface SummaryStats {
  total: number;
  /** Number of students with at least one published grade (i.e.
   *  avg_percent !== null). Drives the distribution-bar denominator
   *  — the bar shows the spread of *graded* students. */
  withAvg: number;
  strong: number;
  ok: number;
  struggling: number;
}

function computeSummary(rows: { avg_percent: number | null }[]): SummaryStats {
  let strong = 0;
  let ok = 0;
  let struggling = 0;
  let withAvg = 0;
  for (const r of rows) {
    if (r.avg_percent === null) continue;
    withAvg += 1;
    // Bucket the number the teacher sees, so a student shown at 70%
    // never lands in the under-70 bucket.
    const pct = shown(r.avg_percent);
    if (pct >= STRONG_THRESHOLD) strong += 1;
    else if (pct >= STRUGGLING_THRESHOLD) ok += 1;
    else struggling += 1;
  }
  return {
    total: rows.length,
    withAvg,
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

