"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { teacher, type GradesRosterResponse, type GradesRosterRow } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import {
  PercentBadge,
  percentTone,
  STRONG_THRESHOLD,
  STRUGGLING_THRESHOLD,
} from "@/components/school/shared/percent-badge";
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

// Buckets align with PercentBadge thresholds — STRONG_THRESHOLD and
// STRUGGLING_THRESHOLD are imported from percent-badge so "what counts
// as struggling" stays one knob across the codebase.

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

  // Per-section averages, used inline on the section tabs so the
  // teacher can spot a lagging period at a glance without flipping
  // the filter. Computed against the FULL roster (not the
  // section-scoped subset) so each tab always reports its own
  // section's avg regardless of which tab is currently active.
  const sectionAverages = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!data) return m;
    for (const s of data.sections) {
      const rows = data.students.filter((r) => r.section_id === s.id);
      m.set(s.id, avgOf(rows));
    }
    return m;
  }, [data]);

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
        : // Picking a new column starts at "asc". For avg this means
          // low-first (struggling first), which is the more useful
          // default for teachers clicking avg to find who needs help.
          // For name and graded, asc is the conventional default too.
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
          deserves prominence. Each section tab includes its avg
          inline so the teacher can compare periods at a glance,
          collapsing the old separate "Sections: P1 82% · P2 78%"
          row that listed the same labels twice. Hidden when there's
          only one section. */}
      {showSectionTabs && (
        <SectionTabs
          sections={data.sections}
          sectionAverages={sectionAverages}
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
      {/* No headline avg here. The active section's avg is already
          inline on its tab below, and pooling across sections in
          "All sections" mode produces a "course avg" — not the
          "class avg" teachers actually mean (one class = one
          period in K-12 lingo), so a single labeled number would be
          misleading. Distribution bar carries the visual gestalt;
          per-section comparisons live on the tabs. Also deliberately
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
      aria-label="Filter by section"
      className="flex flex-wrap items-center gap-1.5"
    >
      {/* The "All sections" tab deliberately does NOT show an avg —
          the class summary at the top already shows it, and putting
          it on the tab would triplicate the same number. Per-section
          tabs include their avg since that data isn't exposed
          anywhere else. */}
      <SectionTab label="All sections" active={value === "all"} onClick={() => onChange("all")} />
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
  /** Per-section avg shown inline. Undefined for the "All" tab
   *  (where the class summary already reports it); null for sections
   *  with no graded HWs yet (rendered as em-dash). */
  avg?: number | null;
  active: boolean;
  onClick: () => void;
}) {
  const showAvg = avg !== undefined;
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
      {showAvg && (
        <span
          className={`text-[10px] tabular-nums ${
            active
              ? "text-white/80"
              : avg === null
                ? "text-text-muted"
                : percentTone(avg)
          }`}
          aria-hidden
        >
          {avg === null ? "—" : `${Math.round(avg)}%`}
        </span>
      )}
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
      onClick={() => {
        // Don't navigate when the user was text-selecting (drag to
        // copy a name, e.g.). The mouseup at the end of a drag fires
        // a click event on the tr, which without this guard would
        // yank the user out of their selection mid-copy. Common
        // gradebook pattern is "select cell content, copy, paste."
        if ((window.getSelection()?.toString().length ?? 0) > 0) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        // Activate on both Enter and Space — Space is the standard
        // activation key for elements with link semantics, and we
        // expose this row as a link via aria-label below.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(href);
        }
      }}
      tabIndex={0}
      // Deliberately NOT setting role="link" on the <tr>. ARIA's link
      // role isn't a great fit for a table row (a row inside a table
      // should keep its row semantics for screen readers parsing the
      // gradebook structure), and several screen readers handle the
      // override poorly. The `aria-label` + `cursor-pointer` +
      // focus-visible ring + Enter/Space handlers are enough to
      // communicate "this row is actionable."
      aria-label={`View ${row.name}'s grades`}
      className="cursor-pointer border-t border-border-light transition-colors hover:bg-bg-subtle/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
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
   *  — the bar shows the spread of *graded* students. */
  withAvg: number;
  strong: number;
  ok: number;
  struggling: number;
}

function computeSummary(rows: GradesRosterRow[]): SummaryStats {
  let strong = 0;
  let ok = 0;
  let struggling = 0;
  let withAvg = 0;
  for (const r of rows) {
    if (r.avg_percent === null) continue;
    withAvg += 1;
    if (r.avg_percent >= STRONG_THRESHOLD) strong += 1;
    else if (r.avg_percent >= STRUGGLING_THRESHOLD) ok += 1;
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

/** "Last, First" or best-effort last-name first for sort. Users have
 *  a single `name` field — split on last space and take the tail. */
function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toLowerCase();
  return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
}
