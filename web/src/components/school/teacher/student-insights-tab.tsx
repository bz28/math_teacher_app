"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  teacher,
  type SectionStudentInsightsResponse,
  type StudentInsight,
  type StudentInsightStatus,
  type StudentInsightTrend,
  type TeacherSection,
} from "@/lib/api";
import { formatRelativeDate } from "@/lib/utils";
import { MeasuredKey } from "./_pieces/measured-key";

/**
 * Student Insights — a roster of formative engagement signal, one row
 * per enrolled student. Coarse practice/learn rollups (problems
 * practiced, walkthroughs, last-active, first-try rate) plus a derived
 * status + trend. Insight, NOT a grade: no scores, no raw answers.
 *
 * The read is per-section (GET /teacher/.../student-insights), so a
 * course with multiple sections gets a quiet section pivot; a single
 * section skips it. Clicking a row opens that student's per-student
 * practice-engagement detail under /grades/[sectionId]/students/[id].
 */

type SortKey = "attention" | "last_active" | "name";
type StatusFilter = "all" | "attention";

// Sort weight for "needs attention first": worst-first, then the calm
// middle, then thriving last. Used only by the default sort.
const ATTENTION_RANK: Record<StudentInsightStatus, number> = {
  struggling: 0,
  needs_nudge: 1,
  no_activity: 2,
  on_track: 3,
  thriving: 4,
};

// Restrained, editorial status palette — tokens only, calm not stoplight.
// thriving = deep green · on_track = neutral · needs_nudge = warm amber ·
// struggling = soft terracotta · no_activity = faint grey.
const STATUS_META: Record<
  StudentInsightStatus,
  { label: string; className: string }
> = {
  thriving: {
    label: "Thriving",
    className:
      "border-[color:var(--color-primary)]/25 bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]",
  },
  on_track: {
    label: "On track",
    className:
      "border-border-light bg-[color:var(--color-surface-alt-2)] text-text-secondary",
  },
  needs_nudge: {
    label: "Needs a nudge",
    className:
      "border-[color:var(--color-warning)]/25 bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning-dark)]",
  },
  struggling: {
    label: "Struggling",
    className:
      "border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] text-[color:var(--color-error)]",
  },
  no_activity: {
    label: "No activity",
    className:
      "border-border-light bg-[color:var(--color-surface-alt)] text-text-muted",
  },
};

const ATTENTION_STATUSES: ReadonlySet<StudentInsightStatus> = new Set([
  "struggling",
  "needs_nudge",
]);

export function StudentInsightsTab({ courseId }: { courseId: string }) {
  const [sections, setSections] = useState<TeacherSection[] | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [data, setData] = useState<SectionStudentInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("attention");
  const [filter, setFilter] = useState<StatusFilter>("all");

  // Load the section list once — drives the pivot and scopes the read.
  useEffect(() => {
    let cancelled = false;
    teacher
      .sections(courseId)
      .then((res) => {
        if (cancelled) return;
        setSections(res.sections);
        setActiveSection(res.sections[0]?.id ?? null);
        if (res.sections.length === 0) setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load sections");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // (Re)load the roster whenever the active section changes.
  useEffect(() => {
    if (!activeSection) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await teacher.sectionStudentInsights(
          courseId,
          activeSection,
        );
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load insights");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [courseId, activeSection]);

  const students = data?.students ?? null;

  const needAttention = useMemo(
    () =>
      (students ?? []).filter((s) => ATTENTION_STATUSES.has(s.status)).length,
    [students],
  );

  const allQuiet = useMemo(
    () =>
      students !== null &&
      students.length > 0 &&
      students.every((s) => s.status === "no_activity"),
    [students],
  );

  const visible = useMemo(() => {
    let out = students ?? [];
    if (filter === "attention") {
      out = out.filter((s) => ATTENTION_STATUSES.has(s.status));
    }
    return [...out].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "last_active") {
        // Most-recent first; never-active sinks to the bottom.
        const at = a.last_active ? Date.parse(a.last_active) : -Infinity;
        const bt = b.last_active ? Date.parse(b.last_active) : -Infinity;
        if (at !== bt) return bt - at;
        return a.name.localeCompare(b.name);
      }
      // "attention": worst-first, ties broken by name.
      const ar = ATTENTION_RANK[a.status];
      const br = ATTENTION_RANK[b.status];
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
  }, [students, filter, sort]);

  // A course with no sections at all — nothing to scope.
  const noSections = sections !== null && sections.length === 0;
  const showSectionPivot = (sections?.length ?? 0) > 1;

  return (
    <section>
      <header className="max-w-2xl">
        <h2 className="font-serif text-[26px] leading-tight tracking-[-0.015em] text-text-primary">
          Student Insights
        </h2>
        <p className="mt-1 font-serif italic text-[15px] leading-snug text-text-muted">
          A formative read on each student&rsquo;s practice — who&rsquo;s
          thriving, who needs a nudge. Signal, not a grade.
        </p>
        <MeasuredKey className="mt-3" showStatus />
      </header>

      {showSectionPivot && sections && (
        <div
          role="tablist"
          aria-label="Choose a section"
          className="mt-5 flex flex-wrap items-center gap-1.5"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeSection === s.id}
              onClick={() => setActiveSection(s.id)}
              className={`rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                activeSection === s.id
                  ? "border-primary bg-primary text-white"
                  : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <p className="mt-6 text-sm text-[color:var(--color-error)]">{error}</p>
      ) : noSections ? (
        <RosterEmpty
          title="No sections yet"
          body="Create a section and enroll students to see their practice insights here."
        />
      ) : loading || students === null ? (
        <p className="mt-6 text-sm text-text-muted">Loading…</p>
      ) : students.length === 0 ? (
        <RosterEmpty
          title="No students enrolled"
          body="Once students join this section, each will appear here with their practice signal."
        />
      ) : allQuiet ? (
        <RosterEmpty
          title="No practice yet"
          body="Insights appear once students start practicing. Every enrolled student will show up here with their engagement and trend."
        />
      ) : (
        <>
          <Controls
            sort={sort}
            onSort={setSort}
            filter={filter}
            onFilter={setFilter}
            total={students.length}
            needAttention={needAttention}
          />
          {visible.length === 0 ? (
            <div className="mt-5 rounded-[--radius-lg] border border-border-light bg-surface px-6 py-8 text-center">
              <p className="text-sm text-text-secondary">
                No one needs attention right now.
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Nobody is struggling or going quiet.{" "}
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="font-medium text-primary hover:underline"
                >
                  Show everyone
                </button>
              </p>
            </div>
          ) : (
            <Roster
              courseId={courseId}
              sectionId={activeSection!}
              students={visible}
            />
          )}
        </>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────

function Controls({
  sort,
  onSort,
  filter,
  onFilter,
  total,
  needAttention,
}: {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  filter: StatusFilter;
  onFilter: (f: StatusFilter) => void;
  total: number;
  needAttention: number;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border-light pb-3">
      <div className="flex items-center gap-1.5">
        <SegChip
          active={filter === "attention"}
          onClick={() => onFilter("attention")}
        >
          Needs attention
          {needAttention > 0 && (
            <span className="ml-1.5 tabular-nums opacity-70">
              {needAttention}
            </span>
          )}
        </SegChip>
        <SegChip active={filter === "all"} onClick={() => onFilter("all")}>
          Everyone
          <span className="ml-1.5 tabular-nums opacity-70">{total}</span>
        </SegChip>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        Sort
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className="rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[12px] font-medium text-text-secondary focus:border-primary focus:outline-none"
        >
          <option value="attention">Needs attention first</option>
          <option value="last_active">Last active</option>
          <option value="name">Name</option>
        </select>
      </label>
    </div>
  );
}

function SegChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? "border-primary bg-primary text-white"
          : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function Roster({
  courseId,
  sectionId,
  students,
}: {
  courseId: string;
  sectionId: string;
  students: StudentInsight[];
}) {
  const reduce = useReducedMotion();
  return (
    <ul className="mt-1 divide-y divide-border-light">
      {students.map((s, i) => (
        <motion.li
          key={s.student_id}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduce ? 0 : 0.3,
            delay: reduce ? 0 : Math.min(i * 0.03, 0.3),
            ease: "easeOut",
          }}
        >
          <StudentRow courseId={courseId} sectionId={sectionId} student={s} />
        </motion.li>
      ))}
    </ul>
  );
}

function StudentRow({
  courseId,
  sectionId,
  student,
}: {
  courseId: string;
  sectionId: string;
  student: StudentInsight;
}) {
  const href = `/school/teacher/courses/${courseId}/grades/${sectionId}/students/${student.student_id}`;
  const meta = STATUS_META[student.status];
  const inactive = student.status === "no_activity";

  return (
    <Link
      href={href}
      className="group flex items-center gap-4 py-3.5 transition-colors hover:bg-[color:var(--color-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:gap-5"
    >
      {/* Name + status */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="truncate text-sm font-semibold text-text-primary group-hover:text-primary">
            {student.name}
          </span>
          <span
            className={`shrink-0 rounded-[--radius-pill] border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.05em] ${meta.className}`}
          >
            {meta.label}
          </span>
        </div>
        <p className="truncate text-[11px] text-text-muted">
          {inactive ? (
            "Hasn't practiced yet"
          ) : (
            <>
              <span className="tabular-nums text-text-secondary">
                {student.practiced_count}
              </span>{" "}
              {student.practiced_count === 1 ? "problem" : "problems"}
              {student.learn_walkthroughs > 0 && (
                <>
                  {" · "}
                  <span className="tabular-nums text-text-secondary">
                    {student.learn_walkthroughs}
                  </span>{" "}
                  {student.learn_walkthroughs === 1
                    ? "walkthrough"
                    : "walkthroughs"}
                </>
              )}
              {student.last_active && (
                <>
                  {" · "}
                  {formatRelativeDate(student.last_active)}
                </>
              )}
            </>
          )}
        </p>
      </div>

      {/* First-try rate */}
      <div className="hidden w-20 shrink-0 text-right sm:block">
        <div className="text-sm font-semibold tabular-nums text-text-primary">
          {student.first_try_rate === null
            ? "—"
            : `${Math.round(student.first_try_rate * 100)}%`}
        </div>
        <div className="text-[10px] uppercase tracking-[0.05em] text-text-muted">
          first try
        </div>
      </div>

      {/* Trend */}
      <div className="w-10 shrink-0 text-center">
        <TrendArrow trend={student.trend} />
      </div>

      <svg
        aria-hidden
        className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 3l4 4-4 4" />
      </svg>
    </Link>
  );
}

function TrendArrow({ trend }: { trend: StudentInsightTrend | null }) {
  if (trend === null) {
    return (
      <span className="text-text-muted/50" title="Not enough data yet">
        ·
      </span>
    );
  }
  const meta = {
    improving: { glyph: "↑", cls: "text-[color:var(--color-primary)]", label: "Improving" },
    slipping: { glyph: "↓", cls: "text-[color:var(--color-error)]", label: "Slipping" },
    steady: { glyph: "→", cls: "text-text-muted", label: "Steady" },
  }[trend];
  return (
    <span
      className={`text-[15px] font-semibold ${meta.cls}`}
      title={meta.label}
      aria-label={`Trend: ${meta.label}`}
    >
      {meta.glyph}
    </span>
  );
}

function RosterEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle px-6 py-10 text-center">
      <p className="font-serif text-[18px] text-text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-text-muted">{body}</p>
    </div>
  );
}
