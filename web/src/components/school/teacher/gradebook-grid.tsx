"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import type {
  GradebookAssignment,
  GradebookCell,
  GradebookResponse,
  GradebookStudent,
} from "@/lib/api";
import {
  percentTone,
  STRONG_THRESHOLD,
  STRUGGLING_THRESHOLD,
} from "@/components/school/shared/percent-badge";
import {
  averageBreakdown,
  changedFromAi,
  sectionAverage,
  shown,
  sortRows,
  type SortDir,
  type SortKey,
} from "@/lib/gradebook";

/**
 * The section gradebook: students down the side, homework across the
 * top (newest first), the published score in each cell.
 *
 * Everything on it is auditable without leaving the page. Hovering (or
 * focusing) a score shows when it was published, whether it was late,
 * and the AI's suggestion beside the teacher's grade; hovering an
 * average lists exactly which grades it is built from. Every score
 * links to that submission on the grading page.
 *
 * It is the final record, so only published grades show a number;
 * everything else is a word. Missing work is shown, never averaged
 * as a zero — the same rule as the roster and the CSV export.
 */

// Pinned column widths — narrower on phones so homework columns still
// show beside them. The Avg column's sticky offset IS the Student
// column's width, so the two classes below must move together.
const STUDENT_COL = "w-[120px] min-w-[120px] sm:w-[184px] sm:min-w-[184px]";
const AVG_COL = "left-[120px] sm:left-[184px] w-[72px] min-w-[72px] sm:w-[88px] sm:min-w-[88px]";

export function GradebookGrid({
  courseId,
  data,
  rows,
}: {
  courseId: string;
  data: GradebookResponse;
  /** The students to show (already searched / filtered by the tab). */
  rows: GradebookStudent[];
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "name",
    dir: "asc",
  });
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  // The whole section, never the filtered rows — the footer is labelled
  // "Section average" and must match the section tab.
  const sectionAvg = useMemo(() => sectionAverage(data.students), [data.students]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );

  // One shared hover card, positioned against the viewport so the
  // grid's scroll container can't clip it. It owns its own state, so a
  // hover re-renders the card, not every cell in the grid.
  const cardApi = useRef<HoverCardApi | null>(null);
  const hide = useCallback(() => cardApi.current?.hide(), []);
  const hoverProps: HoverProps = useCallback((lines: string[]) => {
    const show = (e: MouseEvent | FocusEvent) =>
      cardApi.current?.show((e.currentTarget as HTMLElement).getBoundingClientRect(), lines);
    return { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide };
  }, [hide]);

  const reviewHref = (assignmentId: string, studentId: string) =>
    `/school/teacher/courses/${courseId}/homework/${assignmentId}/sections/${data.section.id}/review?student=${studentId}`;

  if (data.assignments.length === 0) {
    return (
      <p className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-6 text-sm text-text-secondary">
        No homework has been published to {data.section.name} yet. Once you publish
        some, each one becomes a column here.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[--radius-md] border border-border-light bg-surface">
      {/* Scrolls both ways inside its own frame so the header row and
          the name/average columns stay pinned on a long class. */}
      <div className="max-h-[75vh] overflow-auto" onScroll={hide}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-[11px] font-semibold text-[color:var(--color-text-secondary)]">
              <th
                scope="col"
                aria-sort={ariaSort(sort, "name")}
                className={`sticky left-0 top-0 z-30 border-b border-r border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-left align-bottom uppercase tracking-[0.18em] sm:px-4 ${STUDENT_COL}`}
              >
                <SortButton label="Student" sort={sort} sortKey="name" onSort={toggleSort} />
              </th>
              <th
                scope="col"
                aria-sort={ariaSort(sort, "avg")}
                className={`sticky top-0 z-30 border-b border-r border-border-light bg-[color:var(--color-surface-alt-2)] px-2 py-2 text-center align-bottom uppercase tracking-[0.18em] ${AVG_COL}`}
              >
                <SortButton label="Avg" sort={sort} sortKey="avg" onSort={toggleSort} />
              </th>
              {data.assignments.map((a) => (
                <th
                  key={a.id}
                  scope="col"
                  aria-sort={ariaSort(sort, a.id)}
                  className="sticky top-0 z-20 min-w-[112px] max-w-[148px] border-b border-border-light bg-[color:var(--color-surface-alt-2)] px-2 py-2 text-center align-bottom normal-case tracking-normal"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(a.id)}
                    title={a.title}
                    className="mx-auto block max-w-[136px] rounded-[--radius-sm] px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="block truncate text-xs font-bold text-text-primary">
                      {a.title}
                    </span>
                    <span className="block text-[10.5px] font-medium text-text-muted tabular-nums">
                      {a.due_at ? `Due ${shortDate(a.due_at)}` : "No due date"}
                      <span aria-hidden className="ml-1 text-[9px]">
                        {sort.key === a.id ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                      </span>
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.student_id} className="group">
                <th
                  scope="row"
                  className={`sticky left-0 z-10 border-b border-r border-border-light bg-surface px-3 py-2 text-left font-semibold text-text-primary group-hover:bg-[color:var(--color-surface-alt-2)] sm:px-4 ${STUDENT_COL}`}
                >
                  <Link
                    href={`/school/teacher/courses/${courseId}/grades/${data.section.id}/students/${s.student_id}`}
                    className="block truncate rounded-[--radius-sm] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {s.name}
                  </Link>
                </th>
                <td
                  className={`sticky z-10 border-b border-r border-border-light bg-surface px-2 py-1.5 text-center group-hover:bg-[color:var(--color-surface-alt-2)] ${AVG_COL}`}
                >
                  <AverageCell student={s} assignments={data.assignments} hoverProps={hoverProps} />
                </td>
                {data.assignments.map((a) => (
                  <td
                    key={a.id}
                    className="border-b border-border-light px-2 py-1.5 text-center group-hover:bg-[color:var(--color-surface-alt-2)]/60"
                  >
                    <ScoreCell
                      cell={s.cells[a.id]}
                      assignment={a}
                      studentName={s.name}
                      href={reviewHref(a.id, s.student_id)}
                      hoverProps={hoverProps}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-xs font-semibold text-text-secondary">
              <th
                scope="row"
                className={`sticky left-0 z-10 border-r border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-left sm:px-4 ${STUDENT_COL}`}
              >
                Section average
              </th>
              <td
                className={`sticky z-10 border-r border-border-light bg-[color:var(--color-surface-alt-2)] px-2 py-2 text-center tabular-nums ${AVG_COL}`}
              >
                {pct(sectionAvg)}
              </td>
              {data.assignments.map((a) => (
                <td
                  key={a.id}
                  className="bg-[color:var(--color-surface-alt-2)] px-2 py-2 text-center tabular-nums"
                  title={`Average of ${a.counted_count} published grade${a.counted_count === 1 ? "" : "s"}`}
                >
                  {pct(a.avg_percent)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <Legend />
      <HoverCard apiRef={cardApi} />
    </div>
  );
}

// ── Cells ──────────────────────────────────────────────────────────

type HoverProps = (lines: string[]) => {
  onMouseEnter: (e: MouseEvent) => void;
  onMouseLeave: () => void;
  onFocus: (e: FocusEvent) => void;
  onBlur: () => void;
};

interface HoverCardApi {
  show: (rect: DOMRect, lines: string[]) => void;
  hide: () => void;
}

const STATE_WORDS: Record<Exclude<GradebookCell["state"], "published">, string> = {
  not_published: "Not published",
  turned_in: "Turned in",
  missing: "Missing",
  not_turned_in: "Not turned in",
};

function ScoreCell({
  cell,
  assignment,
  studentName,
  href,
  hoverProps,
}: {
  cell: GradebookCell;
  assignment: GradebookAssignment;
  studentName: string;
  href: string;
  hoverProps: HoverProps;
}) {
  if (cell.state === "missing" || cell.state === "not_turned_in") {
    return (
      <span
        className={`text-[11.5px] font-semibold ${
          cell.state === "missing" ? "text-[color:var(--color-error)]" : "text-text-muted/70"
        }`}
      >
        {STATE_WORDS[cell.state]}
      </span>
    );
  }

  const lines = cellLines(cell, assignment, studentName);
  const linkCls =
    "inline-flex items-center justify-center rounded-[--radius-sm] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  if (cell.state !== "published") {
    return (
      <Link
        href={href}
        aria-label={lines.join(". ")}
        className={`${linkCls} px-1 text-[11.5px] font-semibold text-text-muted hover:text-primary`}
        {...hoverProps(lines)}
      >
        {STATE_WORDS[cell.state]}
        {cell.is_late && <LateMark />}
      </Link>
    );
  }

  const changedAi = changedFromAi(cell);
  return (
    <Link
      href={href}
      aria-label={lines.join(". ")}
      className={`${linkCls} relative`}
      {...hoverProps(lines)}
    >
      <span
        className={`min-w-[44px] rounded-[--radius-sm] px-1.5 py-0.5 text-[13px] font-bold tabular-nums ${chipTone(shown(cell.score))}`}
      >
        {shown(cell.score)}%
      </span>
      {/* Hung off the chip's corner so every score in a column stays
          centred on the same axis. */}
      {(cell.is_late || changedAi) && (
        <span className="absolute left-full top-0 ml-0.5 flex flex-col items-start gap-0.5">
          {cell.is_late && <LateMark />}
          {changedAi && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />}
        </span>
      )}
    </Link>
  );
}

function AverageCell({
  student,
  assignments,
  hoverProps,
}: {
  student: GradebookStudent;
  assignments: GradebookAssignment[];
  hoverProps: HoverProps;
}) {
  const lines = averageLines(student, assignments);
  // Focusable so keyboard users get the breakdown too, but not a
  // button — there is nothing to press.
  return (
    <span
      tabIndex={0}
      aria-label={lines.join(". ")}
      className="inline-flex flex-col items-center rounded-[--radius-sm] px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      {...hoverProps(lines)}
    >
      <span className={`text-[13px] font-bold tabular-nums ${student.avg_percent === null ? "text-text-muted" : percentTone(shown(student.avg_percent))}`}>
        {pct(student.avg_percent)}
      </span>
      <span className="text-[10px] font-semibold leading-none text-text-muted tabular-nums">
        {student.counted_count} of {student.assigned_count}
      </span>
    </span>
  );
}

function LateMark() {
  return (
    <span className="text-[9px] font-bold leading-none tracking-wide text-[color:var(--color-warning-dark)]">
      LATE
    </span>
  );
}

function HoverCard({ apiRef }: { apiRef: RefObject<HoverCardApi | null> }) {
  const [card, setCard] = useState<{ rect: DOMRect; lines: string[] } | null>(null);
  useEffect(() => {
    apiRef.current = {
      show: (rect, lines) => setCard({ rect, lines }),
      hide: () => setCard(null),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  // A fixed card tracks the cell only until the page moves.
  useEffect(() => {
    if (!card) return;
    const hide = () => setCard(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [card]);
  if (!card) return null;
  const { rect, lines } = card;
  // Below the cell, nudged left to stay on screen; flips above when
  // there's no room underneath.
  const width = 248;
  const below = rect.bottom + 120 < window.innerHeight;
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-[--radius-md] bg-text-primary px-3 py-2 text-xs leading-snug text-[color:var(--color-surface)] shadow-lg"
      style={{ width, left, ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }) }}
    >
      <p className="font-bold">{lines[0]}</p>
      {lines.slice(1).map((l) => (
        <p key={l} className="opacity-85">{l}</p>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border-light px-4 py-2.5 text-[11px] text-text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className={`rounded-[--radius-sm] px-1.5 font-bold ${chipTone(STRONG_THRESHOLD)}`}>{STRONG_THRESHOLD}%+</span>
        <span className={`rounded-[--radius-sm] px-1.5 font-bold ${chipTone(STRUGGLING_THRESHOLD)}`}>{STRUGGLING_THRESHOLD}–{STRONG_THRESHOLD - 1}%</span>
        <span className={`rounded-[--radius-sm] px-1.5 font-bold ${chipTone(0)}`}>under {STRUGGLING_THRESHOLD}%</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" /> You changed the AI&rsquo;s grade
      </span>
      <span>Only published grades show a score. Missing work isn&rsquo;t averaged as a zero.</span>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

/** Score chip tint, on the same thresholds as `percentTone`. */
function chipTone(score: number): string {
  if (score >= STRONG_THRESHOLD) return "bg-[color:var(--color-success-light)] text-green-700 dark:text-green-400";
  if (score >= STRUGGLING_THRESHOLD) return "bg-[color:var(--color-surface-alt-2)] text-text-primary";
  return "bg-[color:var(--color-error-light)] text-red-700 dark:text-red-400";
}

function pct(v: number | null): string {
  return v === null ? "—" : `${shown(v)}%`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function cellLines(
  cell: Exclude<GradebookCell, { state: "missing" | "not_turned_in" }>,
  assignment: GradebookAssignment,
  studentName: string,
): string[] {
  const head = `${assignment.title} · ${studentName}`;
  if (cell.state !== "published") {
    return [
      head,
      cell.state === "turned_in" ? "Turned in, not graded yet" : "Graded, not published yet",
      ...(cell.is_late ? ["Turned in late"] : []),
      "Open to grade it",
    ];
  }
  const lines = [
    head,
    `Published ${shortDate(cell.published_at)} · ${cell.is_late ? "turned in late" : "turned in on time"}`,
    cell.ai_score === null
      ? `Graded by hand: ${shown(cell.score)}%`
      : `AI suggested ${shown(cell.ai_score)}% · you gave ${shown(cell.score)}%`,
  ];
  if (cell.edited_since_publish) lines.push("Edited since publishing; students still see this score");
  lines.push("Open to see the work");
  return lines;
}

function averageLines(student: GradebookStudent, assignments: GradebookAssignment[]): string[] {
  const { scores, leftOut } = averageBreakdown(student, assignments);
  if (scores.length === 0) {
    return [student.name, "No published grades yet"];
  }
  const notCounted = (Object.keys(leftOut) as (keyof typeof STATE_WORDS)[]).map(
    (state) => `${leftOut[state]} ${STATE_WORDS[state].toLowerCase()}`,
  );
  return [
    `Average of ${scores.length} published grade${scores.length === 1 ? "" : "s"}`,
    `${scores.map(shown).join(" · ")} → ${pct(student.avg_percent)}`,
    ...(notCounted.length ? [`Not counted: ${notCounted.join(", ")}`] : []),
  ];
}


function ariaSort(sort: { key: SortKey; dir: SortDir }, key: SortKey) {
  if (sort.key !== key) return "none" as const;
  return sort.dir === "asc" ? ("ascending" as const) : ("descending" as const);
}

function SortButton({
  label,
  sort,
  sortKey,
  onSort,
}: {
  label: string;
  sort: { key: SortKey; dir: SortDir };
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:text-text-primary ${active ? "text-text-primary" : ""}`}
    >
      {label}
      <span aria-hidden className="text-[9px]">{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
    </button>
  );
}

