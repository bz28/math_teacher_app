"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { teacher, type GradesRosterResponse, type GradesRosterRow } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { PercentBadge } from "@/components/school/teacher/percent-badge";

/**
 * Grades tab — the read-only final-record view.
 *
 * Mental model: audit layer. Teachers open this to answer "how is
 * student X doing?" or "who's failing?" It never shows drafts —
 * grades appear only after the teacher clicks "Publish grades" on
 * the HW itself. Drafts live in the Submissions tab.
 *
 * Default sort: last name. Toggle to avg ascending surfaces the
 * struggling students first. Search and section filter are
 * client-side; the roster is bounded by class size.
 *
 * Clicking a row opens /grades/[sectionId]/students/[studentId] —
 * the student's full published-HW record.
 */
type SortKey = "name" | "avg";

export function GradesTab({ courseId }: { courseId: string }) {
  const [data, setData] = useState<GradesRosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

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

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let out = data.students;
    if (sectionFilter !== "all") {
      out = out.filter((r) => r.section_id === sectionFilter);
    }
    if (q) {
      out = out.filter((r) => r.name.toLowerCase().includes(q));
    }
    const sorted = out.slice();
    if (sort === "name") {
      sorted.sort((a, b) => lastNameKey(a.name).localeCompare(lastNameKey(b.name)));
    } else {
      // Students with no avg yet sink to the bottom — they're not
      // "doing badly," they just have nothing to show.
      sorted.sort((a, b) => avgSortKey(a) - avgSortKey(b));
    }
    return sorted;
  }, [data, sectionFilter, search, sort]);

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

  return (
    <div className="mt-2">
      {/* Filter + search + sort row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          >
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students"
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base py-2 pl-9 pr-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <select
          value={sectionFilter}
          onChange={(e) => setSectionFilter(e.target.value)}
          aria-label="Filter by section"
          className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-semibold text-text-secondary hover:border-primary/40 focus:border-primary focus:outline-none"
        >
          <option value="all">All sections</option>
          {data.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSort(sort === "name" ? "avg" : "name")}
          title="Toggle sort"
          className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary"
        >
          {sort === "name" ? "Sort: Name ↑" : "Sort: Avg ↑ (low first)"}
        </button>
      </div>

      {/* Roster table */}
      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-xs text-text-muted">
          No students match those filters.
        </p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-[--radius-md] border border-border-light bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-bg-subtle text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">
                <th className="px-4 py-2">Name</th>
                {sectionFilter === "all" && <th className="px-4 py-2">Section</th>}
                <th className="px-4 py-2">Progress</th>
                <th className="px-4 py-2 text-right">Avg</th>
                <th className="px-4 py-2" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <RosterRow
                  key={`${r.student_id}-${r.section_id}`}
                  row={r}
                  courseId={courseId}
                  showSection={sectionFilter === "all"}
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

function RosterRow({
  row,
  courseId,
  showSection,
}: {
  row: GradesRosterRow;
  courseId: string;
  showSection: boolean;
}) {
  const href = `/school/teacher/courses/${courseId}/grades/${row.section_id}/students/${row.student_id}`;
  return (
    <tr className="border-t border-border-light transition-colors hover:bg-bg-subtle/60">
      <td className="px-4 py-3">
        <Link href={href} className="block font-semibold text-text-primary hover:text-primary">
          {row.name}
        </Link>
      </td>
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
      <td className="px-4 py-3 text-right">
        <Link
          href={href}
          className="text-xs font-bold text-primary hover:underline"
          aria-label={`View ${row.name}'s grades`}
        >
          →
        </Link>
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────────

/** "Last, First" or best-effort last-name first for sort. Users have
 *  a single `name` field — split on last space and take the tail. */
function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.toLowerCase();
  return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
}

/** Sort key for "Avg ascending (low first)." Null avgs sort last so
 *  students with no data don't appear to be failing. */
function avgSortKey(r: GradesRosterRow): number {
  return r.avg_percent ?? Number.POSITIVE_INFINITY;
}
