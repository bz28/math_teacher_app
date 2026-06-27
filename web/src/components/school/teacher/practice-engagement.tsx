"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  teacher,
  type StudentPracticeActivityResponse,
  type StudentStruggleItem,
} from "@/lib/api";
import { formatRelativeDate } from "@/lib/utils";
import { MeasuredKey } from "./_pieces/measured-key";

/**
 * Per-student Practice & Learn engagement — the formative companion to
 * the graded-homework record, rendered BELOW it on the student-detail
 * page. Practice is ungraded by design, so this is deliberately a calm
 * ENGAGEMENT readout (did they show up, how did it go, what did they
 * wrestle with) — never a score.
 *
 * Sourced from GET /teacher/.../students/{id}/practice-activity. The
 * outcome mix is drawn as a single thin tonal bar (one green hue at
 * three weights), not a loud multi-color chart, to keep the reading
 * editorial and signal "insight" rather than "grade."
 */

// One deep-green hue at three weights — strongest for first-try,
// fading through retry to revealed. A tonal ramp reads as a refined
// chart, not a stoplight; revealed is the lightest, never alarmist red.
const OUTCOME_STYLE: Record<
  "first_try" | "retry" | "revealed",
  { fill: string; label: string }
> = {
  first_try: { fill: "rgb(14, 82, 56)", label: "First try" },
  retry: { fill: "rgba(14, 82, 56, 0.55)", label: "Retried" },
  revealed: { fill: "rgba(14, 82, 56, 0.24)", label: "Revealed solution" },
};
const OUTCOME_ORDER = ["first_try", "retry", "revealed"] as const;

export function PracticeEngagement({
  courseId,
  sectionId,
  studentId,
}: {
  courseId: string;
  sectionId: string;
  studentId: string;
}) {
  const reduce = useReducedMotion();
  const [data, setData] = useState<StudentPracticeActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .studentPracticeActivity(courseId, sectionId, studentId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load practice");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, sectionId, studentId]);

  // Stay quiet while loading / on error — this is a secondary,
  // additive section under the gradebook, not the page's reason for
  // being. A failed insight read shouldn't shout over the grades.
  if (error || data === null) return null;

  const hasPracticed = data.practiced_count > 0 || data.learn_walkthroughs > 0;

  return (
    <section className="mt-12 border-t border-border-light pt-8">
      <header>
        <h2 className="font-serif text-[26px] leading-tight tracking-[-0.015em] text-text-primary">
          Practice &amp; Learn
        </h2>
        <p className="mt-1 font-serif italic text-[15px] leading-snug text-text-muted">
          Practice is ungraded — this is how they&rsquo;re engaging, not a score.
        </p>
        <MeasuredKey className="mt-3" />
      </header>

      {!hasPracticed ? (
        <div className="mt-5 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle px-6 py-8 text-center">
          <p className="text-sm text-text-secondary">
            {data.student.name.split(" ")[0]} hasn&rsquo;t practiced yet.
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Engagement will appear here once they work through a practice set or a guided walkthrough.
          </p>
        </div>
      ) : (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="mt-6"
        >
          <StatRow data={data} />
          <OutcomeBar breakdown={data.outcome_breakdown} reduce={!!reduce} />
          <WorkedHardestOn items={data.struggle_items} />
        </motion.div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────

function StatRow({ data }: { data: StudentPracticeActivityResponse }) {
  const lastActive = data.last_active
    ? formatRelativeDate(data.last_active)
    : "—";
  return (
    <div className="flex flex-wrap items-stretch gap-px overflow-hidden rounded-[--radius-md] border border-border-light bg-border-light">
      <Stat label="Problems practiced" value={`${data.practiced_count}`} />
      <Stat label="Walkthroughs" value={`${data.learn_walkthroughs}`} />
      <Stat label="Last active" value={lastActive} small />
    </div>
  );
}

function Stat({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="min-w-[120px] flex-1 bg-surface px-5 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
        {label}
      </div>
      <div
        className={`mt-1.5 font-serif tracking-[-0.01em] text-text-primary ${
          small ? "text-[20px]" : "text-[28px] leading-none"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function OutcomeBar({
  breakdown,
  reduce,
}: {
  breakdown: StudentPracticeActivityResponse["outcome_breakdown"];
  reduce: boolean;
}) {
  const total =
    breakdown.first_try + breakdown.retry + breakdown.revealed;
  // No practice attempts (e.g. learn-only engagement) → nothing to
  // distribute. Skip the bar rather than render an empty track.
  if (total === 0) return null;

  return (
    <div className="mt-7">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
          How attempts went
        </h3>
        <span className="font-mono text-[11px] text-text-muted">
          {total} {total === 1 ? "attempt" : "attempts"}
        </span>
      </div>

      <div
        className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-alt-2)]"
        role="img"
        aria-label={`Outcome distribution across ${total} attempts: ${breakdown.first_try} first try, ${breakdown.retry} retried, ${breakdown.revealed} revealed the solution`}
      >
        {OUTCOME_ORDER.map((key) => {
          const count = breakdown[key];
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <motion.div
              key={key}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{ backgroundColor: OUTCOME_STYLE[key].fill }}
              title={`${OUTCOME_STYLE[key].label}: ${count}`}
            />
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
        {OUTCOME_ORDER.map((key) => (
          <LegendItem
            key={key}
            fill={OUTCOME_STYLE[key].fill}
            label={OUTCOME_STYLE[key].label}
            count={breakdown[key]}
          />
        ))}
      </div>
    </div>
  );
}

function LegendItem({
  fill,
  label,
  count,
}: {
  fill: string;
  label: string;
  count: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: fill }}
      />
      <span className="font-semibold tabular-nums text-text-secondary">
        {count}
      </span>
      {label}
    </span>
  );
}

function WorkedHardestOn({ items }: { items: StudentStruggleItem[] }) {
  if (items.length === 0) return null;
  // Cap the personal re-teach list to the few that matter — the read
  // already sorts worst-first and caps server-side, this just keeps the
  // section-detail page from growing a long tail.
  const top = items.slice(0, 5);
  return (
    <div className="mt-8">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
        Worked hardest on
      </h3>
      <ul className="mt-3 divide-y divide-border-light border-t border-border-light">
        {top.map((it) => (
          <li
            key={it.bank_item_id}
            className="flex items-center justify-between gap-4 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
              {it.concept}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-text-muted">
              {struggleSummary(it)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "retried 2× · revealed 1×" — omits a zero side so the meta stays
 *  tight. At least one is non-zero (it's a struggle item). */
function struggleSummary(it: StudentStruggleItem): string {
  const parts: string[] = [];
  if (it.retry_count > 0) parts.push(`retried ${it.retry_count}×`);
  if (it.revealed_count > 0) parts.push(`revealed ${it.revealed_count}×`);
  return parts.join(" · ");
}
