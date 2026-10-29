"use client";

import type { TeacherGraphCheck, TeacherGraphCheckItem } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { formatPoints } from "@/lib/points";

type Verdict = "yes" | "no";

/** The item's call as it counts: the teacher's, else the check's. */
const effective = (i: TeacherGraphCheckItem) => i.teacher ?? i.verdict;

const MARK: Record<TeacherGraphCheckItem["verdict"], { glyph: string; label: string; cls: string }> = {
  yes: {
    glyph: "✓",
    label: "Shown",
    cls: "border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)] text-[color:var(--color-success)]",
  },
  no: {
    glyph: "✗",
    label: "Missing",
    cls: "border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] text-[color:var(--color-error)]",
  },
  unclear: {
    glyph: "?",
    label: "Couldn't tell",
    cls: "border-[color:var(--color-warning-dark)]/30 bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning-dark)]",
  },
};

function headline(graph: TeacherGraphCheck): string | null {
  if (graph.overridden) return "You re-scored this problem by hand, so the checklist no longer sets its score.";
  if (graph.note === "failed") return "The graph couldn't be checked automatically. Decide each item from the photo.";
  if (graph.note === "not_drawn") return "No drawing for this problem, so none of its graph points are earned.";
  if (graph.open_items > 0) {
    const n = graph.open_items;
    return `The photo didn't settle ${n === 1 ? "one item" : `${n} items`}. ${n === 1 ? "Its points are" : "Their points are"} kept until you decide.`;
  }
  return null;
}

/**
 * A graph problem's drawing, checked item by item against its checklist
 * (the checklist as the grade was charged, frozen at grading time). Each
 * item earns its points or loses them; one the check couldn't decide
 * keeps its points and waits for the teacher's call, which Approve waits
 * on too.
 */
export function GraphCheckReview({
  graph,
  busyItems,
  onVerdict,
}: {
  graph: TeacherGraphCheck;
  /** Items whose call is saving. */
  busyItems: readonly number[];
  onVerdict: (n: number, verdict: Verdict) => void;
}) {
  const earned = graph.items.reduce((sum, i) => sum + (effective(i) === "no" ? 0 : i.points), 0);
  const note = headline(graph);
  const decidable = !graph.overridden;

  return (
    <section
      aria-label="Graph checklist"
      className="mt-3 overflow-hidden rounded-[--radius-md] border border-border-light bg-surface"
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-border-light px-3 py-2">
        <h4 className="text-xs font-bold text-text-primary">Graph checklist</h4>
        <span className="font-mono text-[12px] font-semibold text-text-secondary tabular-nums">
          {formatPoints(earned)}/{formatPoints(graph.graph_points)}
          <span className="font-sans text-[11px] font-medium text-text-muted"> of {graph.points} pts</span>
        </span>
      </header>
      {note && (
        <p
          className={`px-3 py-2 text-[11px] leading-relaxed ${
            graph.open_items > 0 && !graph.overridden
              ? "bg-[color:var(--color-warning-bg)]/60 font-semibold text-[color:var(--color-warning-dark)]"
              : "text-text-secondary"
          }`}
        >
          {note}
        </p>
      )}
      <ol className="divide-y divide-border-light">
        {graph.items.map((item) => {
          const waiting = decidable && item.verdict === "unclear" && !item.teacher;
          const shown = MARK[effective(item)];
          const lost = effective(item) === "no";
          const busy = busyItems.includes(item.n);
          return (
            <li
              key={item.n}
              className={`flex gap-2.5 px-3 py-2.5 ${waiting ? "bg-[color:var(--color-warning-bg)]/40" : ""}`}
            >
              <span
                role="img"
                aria-label={shown.label}
                title={shown.label}
                className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border text-[11px] font-extrabold ${shown.cls}`}
              >
                {shown.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-text-primary">
                  <MathText text={item.text} />
                </p>
                {item.seen && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
                    <span className="font-semibold">The check saw:</span> <MathText text={item.seen} />
                  </p>
                )}
                {item.verdict === "unclear" && decidable && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div role="group" aria-label={`Is this on the drawing? (item ${item.n})`} className="inline-flex">
                      {(["yes", "no"] as const).map((v, k) => {
                        const pressed = item.teacher === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            aria-pressed={pressed}
                            // aria-disabled, not disabled: a disabled button
                            // drops keyboard focus mid-list while it saves.
                            aria-disabled={busy}
                            onClick={() => !pressed && !busy && onVerdict(item.n, v)}
                            className={`min-h-8 border px-3 text-xs font-bold transition-colors focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary aria-disabled:cursor-wait aria-disabled:opacity-60 ${
                              k === 0 ? "rounded-l-[--radius-md]" : "-ml-px rounded-r-[--radius-md]"
                            } ${
                              pressed
                                ? MARK[v].cls
                                : "border-border bg-surface text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
                            }`}
                          >
                            <span aria-hidden>{MARK[v].glyph}</span> {MARK[v].label}
                          </button>
                        );
                      })}
                    </div>
                    {busy ? (
                      <span className="text-[11px] text-text-muted">Saving…</span>
                    ) : (
                      item.teacher && <span className="text-[11px] font-semibold text-text-muted">Your call</span>
                    )}
                  </div>
                )}
              </div>
              <span
                className={`shrink-0 font-mono text-[12px] font-semibold tabular-nums ${
                  lost
                    ? "text-[color:var(--color-error)]"
                    : waiting
                      ? "text-[color:var(--color-warning-dark)]"
                      : "text-text-secondary"
                }`}
                title={waiting ? "Kept until you decide" : undefined}
              >
                {lost ? `−${formatPoints(item.points)}` : `${formatPoints(item.points)}`}
                <span className="font-sans text-[10px] font-medium text-text-muted"> pts</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Unclear graph items still waiting on the teacher, across a submission. */
export function openGraphItems(problems: { graph?: TeacherGraphCheck | null }[]): number {
  return problems.reduce((sum, p) => sum + (p.graph?.open_items ?? 0), 0);
}
