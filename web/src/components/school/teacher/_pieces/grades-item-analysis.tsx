"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  teacher,
  type ItemAnalysisItem,
  type ItemAnalysisResponse,
  type TeacherAssignment,
} from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { MathText } from "@/components/shared/math-text";
import { percentTone } from "@/components/school/shared/percent-badge";
import { NewPracticeModal } from "./new-practice-modal";

/**
 * Per-assignment item analysis — "Where the class struggled on this
 * assignment." For a chosen graded homework, every problem is ranked
 * hardest-first by full-credit rate, so a teacher can glance and see
 * "everyone missed #4" without opening a single submission.
 *
 * Complements the class-wide PracticeStrugglePanel (drawn from ungraded
 * practice): this band reads GRADED work, one assignment at a time. The
 * computation is reused, not re-derived — it rides the same
 * `teacher.itemAnalysis(assignmentId)` endpoint the grading-review page
 * uses (per-problem full/partial/zero counts + avg, all sections of the
 * HW). This surface only renders + re-ranks it for the gradebook.
 *
 * Read-only analytics; it never writes a grade. Lives at the foot of the
 * Grades tab, below the roster (the audit view stays first), styled to
 * the struggle-panel grammar — ranked rows, a deep-green proportion bar,
 * a serif header — so the eye learns the pattern once.
 */
export function GradesItemAnalysis({ courseId }: { courseId: string }) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const [assignments, setAssignments] = useState<TeacherAssignment[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ItemAnalysisResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // The problem the teacher chose to re-teach — opens the new-practice
  // modal pre-seeded on that item's text. Null = modal closed. Seeded by
  // title + focus only; ItemAnalysisItem carries no bank_item_id, so the
  // generate-similar path isn't available here — this authors a fresh
  // targeted set from the problem's prompt.
  const [reteach, setReteach] = useState<{ title: string; focus: string } | null>(null);

  // Load the course's assignments once, then keep only the graded ones —
  // item analysis is meaningless until there's scored work to read.
  // Most-recently-created first so the default selection lands on the HW
  // the teacher most likely just finished grading.
  useEffect(() => {
    let cancelled = false;
    teacher
      .assignments(courseId)
      .then((res) => {
        if (cancelled) return;
        const graded = res.assignments
          .filter((a) => a.graded > 0)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        setAssignments(graded);
        setSelectedId((prev) => prev ?? graded[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) {
          setListError(e instanceof Error ? e.message : "Failed to load assignments");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // (Re)fetch the item analysis whenever the selected assignment changes.
  // Clearing `analysis` first shows the skeleton during the swap rather
  // than briefly painting the previous assignment's problems. The resets
  // live inside the nested async fn (not the effect body) so the initial
  // clear isn't a synchronous-setState-in-effect.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const load = async () => {
      setAnalysis(null);
      setAnalysisError(null);
      try {
        const res = await teacher.itemAnalysis(selectedId);
        if (!cancelled) setAnalysis(res);
      } catch (e) {
        if (!cancelled) {
          setAnalysisError(e instanceof Error ? e.message : "Failed to load item analysis");
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = useMemo(
    () => assignments?.find((a) => a.id === selectedId) ?? null,
    [assignments, selectedId],
  );

  // Re-rank hardest-first by full-credit rate so the row order agrees
  // with the headline metric (the endpoint sorts by avg percent, a
  // near-but-not-identical ordering). Tie-break on avg so two problems
  // with the same full-credit rate still settle deterministically.
  const rankedItems = useMemo(() => {
    if (!analysis) return [];
    return analysis.items
      .map((item) => ({ item, fullPct: fullCreditPct(item) }))
      .sort((a, b) => a.fullPct - b.fullPct || a.item.avg_percent - b.item.avg_percent)
      .map((r) => r.item);
  }, [analysis]);

  // Nothing graded anywhere in the course yet → a named empty state with
  // a forward action, not a blank band.
  if (assignments !== null && assignments.length === 0 && listError === null) {
    return (
      <section className="mt-10">
        <Header />
        <div className="mt-5 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle px-6 py-10 text-center">
          <p className="font-serif text-[18px] leading-snug text-text-primary">
            No graded assignments yet
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-text-muted">
            Once you grade and the scores are in, every problem on the assignment
            surfaces here — hardest first — so you can see what to re-teach.
          </p>
          <Link
            href={`/school/teacher/courses/${courseId}?tab=submissions`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-[--radius-md] border border-primary/40 bg-primary-bg px-3.5 py-2 text-xs font-bold text-primary transition-colors hover:border-primary/70 hover:bg-primary/10"
          >
            Go to Submissions →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Header />
        {assignments !== null && assignments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="item-analysis-hw">
              Choose an assignment
            </label>
            <select
              id="item-analysis-hw"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              className="max-w-[15rem] truncate rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-sm font-medium text-text-primary focus:border-primary focus:outline-none"
            >
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (analysis && selected) downloadItemAnalysisCsv(selected.title, rankedItems);
              }}
              disabled={!analysis || rankedItems.length === 0}
              title="Download this assignment's per-problem results as CSV"
              className="shrink-0 rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Export CSV ↓
            </button>
          </div>
        )}
      </div>

      {listError ? (
        <p className="mt-5 text-sm text-[color:var(--color-error)]">{listError}</p>
      ) : analysisError ? (
        <p className="mt-5 text-sm text-[color:var(--color-error)]">{analysisError}</p>
      ) : assignments === null || analysis === null ? (
        <ItemAnalysisSkeleton />
      ) : analysis.graded_count === 0 || rankedItems.length === 0 ? (
        <div className="mt-5 rounded-[--radius-lg] border border-border-light bg-surface px-6 py-8 text-center">
          <p className="text-sm text-text-secondary">
            No graded submissions on this assignment yet.
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Grade a few submissions and the per-problem breakdown will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <p className="font-mono text-[11px] text-text-muted">
            Across {analysis.graded_count}{" "}
            {analysis.graded_count === 1 ? "graded submission" : "graded submissions"} · all
            sections
          </p>
          <ol className="mt-3 divide-y divide-border-light border-t border-border-light">
            {rankedItems.map((item, i) => (
              <ItemRow
                key={item.problem_index}
                item={item}
                rank={i + 1}
                reduce={!!reduce}
                onReteach={() =>
                  setReteach({
                    title: `Re-teach: Problem ${item.problem_index + 1}`,
                    focus: item.problem_text,
                  })
                }
              />
            ))}
          </ol>
        </div>
      )}

      {/* Re-teach → pre-seeded practice generation, mirroring the class
          struggle panel. The chosen problem's text seeds the new-practice
          modal's title + generation focus so the teacher lands ready to
          generate a targeted set on exactly the item the class missed —
          closing the grade→re-teach loop right where they finished grading. */}
      {reteach !== null && (
        <NewPracticeModal
          courseId={courseId}
          seed={reteach}
          onClose={() => setReteach(null)}
          onCreated={(newId) => {
            setReteach(null);
            router.push(
              `/school/teacher/courses/${courseId}/homework/${newId}`,
            );
          }}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="max-w-2xl">
      <h3 className="font-serif text-[20px] leading-tight tracking-[-0.01em] text-text-primary">
        Where the class struggled
      </h3>
      <p className="mt-1 font-serif italic text-[14px] leading-snug text-text-muted">
        Per-problem results on a graded assignment — the items most worth re-teaching, hardest first.
      </p>
    </header>
  );
}

function ItemRow({
  item,
  rank,
  reduce,
  onReteach,
}: {
  item: ItemAnalysisItem;
  rank: number;
  reduce: boolean;
  onReteach: () => void;
}) {
  const total = item.full + item.partial + item.zero;
  // "Struggled" = anyone who didn't earn full credit (partial or zero) —
  // the same framing the practice struggle panel uses, so "N of M
  // struggled" reads identically across both surfaces.
  const struggled = item.partial + item.zero;
  const fullPct = fullCreditPct(item);
  const ratio = total > 0 ? struggled / total : 0;

  return (
    <li className="py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 font-mono text-[11px] text-text-muted tabular-nums">
            {String(rank).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Problem {item.problem_index + 1}
            </span>
            <div className="mt-0.5 text-sm leading-relaxed text-text-primary">
              <MathText text={item.problem_text} />
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className={`text-sm font-bold ${percentTone(Math.round(fullPct))}`}>
            {Math.round(fullPct)}%
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            full credit
          </div>
        </div>
      </div>

      {/* Struggle-proportion bar — fills with the share of the class that
          missed full credit (deep green, brand fill), mirroring the
          practice struggle panel so the two re-teach reads share a language. */}
      <div className="mt-2 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-surface-alt-2)]">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: "rgb(14, 82, 56)" }}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${ratio * 100}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        <span className="shrink-0 text-[12px] text-text-secondary tabular-nums">
          <span className="font-semibold text-text-primary">{struggled}</span> of {total}{" "}
          struggled
        </span>
        {/* Quiet trailing action — the bar names what the class missed, the
            "Re-teach" link is the natural next step on it. Mirrors the
            class struggle panel so the two re-teach reads share a language. */}
        <button
          type="button"
          onClick={onReteach}
          aria-label={`Re-teach Problem ${item.problem_index + 1} — start a targeted practice set`}
          className="group/reteach inline-flex shrink-0 items-center gap-1 rounded-[--radius-sm] text-[11px] font-medium text-text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Re-teach
          <svg
            aria-hidden
            width="11"
            height="11"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform group-hover/reteach:translate-x-0.5"
          >
            <path d="M5 3l4 4-4 4" />
          </svg>
        </button>
      </div>
    </li>
  );
}

function ItemAnalysisSkeleton() {
  return (
    <div className="mt-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-3 w-52 rounded-[--radius-sm]" />
      <ol className="mt-3 divide-y divide-border-light border-t border-border-light">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="py-3.5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <Skeleton className="h-3 w-5" />
                <div className="min-w-0 space-y-1.5">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-4 w-56" />
                </div>
              </div>
              <Skeleton className="h-6 w-12" />
            </div>
            <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
          </li>
        ))}
      </ol>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers

/** Share of graded submissions that earned full credit on this problem,
 *  0–100. Zero-safe — a problem with no scored submissions reads 0%. */
function fullCreditPct(item: ItemAnalysisItem): number {
  const total = item.full + item.partial + item.zero;
  return total > 0 ? (item.full / total) * 100 : 0;
}

/** Build + trigger a per-problem CSV for the selected assignment, drawn
 *  from the already-fetched analysis (no extra request). Columns mirror
 *  the on-screen read plus the raw counts a teacher would want in a
 *  spreadsheet: full-credit rate, the full/partial/zero split, and the
 *  per-problem average. Rows are in the same hardest-first order shown. */
function downloadItemAnalysisCsv(title: string, items: ItemAnalysisItem[]) {
  const header = [
    "Problem",
    "Problem text",
    "Full credit %",
    "Avg %",
    "Full",
    "Partial",
    "Zero",
    "Graded",
    "Struggled",
  ];
  const rows = items.map((item) => {
    const total = item.full + item.partial + item.zero;
    return [
      String(item.problem_index + 1),
      item.problem_text,
      String(Math.round(fullCreditPct(item))),
      String(Math.round(item.avg_percent)),
      String(item.full),
      String(item.partial),
      String(item.zero),
      String(total),
      String(item.partial + item.zero),
    ];
  });
  const csv = [header, ...rows]
    .map((cols) => cols.map(csvCell).join(","))
    .join("\r\n");
  // Prepend a BOM so Excel reads UTF-8 (math symbols) correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `item-analysis-${slug(title)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** RFC-4180 cell escaping — wrap in quotes and double any embedded quote
 *  whenever the value carries a comma, quote, or newline. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "assignment"
  );
}
