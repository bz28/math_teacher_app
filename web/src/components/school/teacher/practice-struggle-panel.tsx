"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  teacher,
  type PracticeInsightItem,
  type PracticeInsightsResponse,
  type TeacherSection,
} from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { NewPracticeModal } from "./_pieces/new-practice-modal";

/**
 * Class struggle-insights — "Where the class is struggling." A re-teach
 * priority list drawn from UNGRADED practice: per concept, how many of
 * the students who practiced it ended up retrying or revealing the
 * solution. Anonymous and aggregate — it names what to revisit, never
 * who got what wrong.
 *
 * Lives as the class-level band atop the Student Insights tab, above the
 * per-student roster — the aggregate "where to re-teach" read before the
 * per-student drilldown. The insights read is per-section
 * (GET /teacher/.../practice-insights), so a course with multiple
 * sections gets a quiet section pivot; a single-section course skips it.
 * The "How this is measured" key lives once on the tab header (which
 * already defines "Struggled"), so this band carries no key of its own.
 */
export function PracticeStrugglePanel({ courseId }: { courseId: string }) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const [sections, setSections] = useState<TeacherSection[] | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [insights, setInsights] = useState<PracticeInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The concept the teacher chose to re-teach — opens the new-practice
  // modal pre-seeded on that concept. Null = modal closed.
  const [reteach, setReteach] = useState<string | null>(null);

  // Load the section list once — drives the pivot and gives us a
  // section_id to scope the (per-section) insights read.
  useEffect(() => {
    let cancelled = false;
    teacher
      .sections(courseId)
      .then((res) => {
        if (cancelled) return;
        setSections(res.sections);
        setActiveSection(res.sections[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load sections");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // (Re)load insights whenever the active section changes. The fetch
  // runs inside a nested async fn (not the effect body) so the initial
  // setLoading isn't a synchronous-setState-in-effect.
  useEffect(() => {
    if (!activeSection) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await teacher.practiceInsights(courseId, activeSection);
        if (!cancelled) setInsights(res);
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

  // The re-teach list = items the class actually struggled on, worst
  // first (the read already sorts this way). Items practiced cleanly
  // are intentionally dropped — this is a "what to revisit" list, not
  // a full item inventory.
  const struggleItems = useMemo(
    () => (insights?.items ?? []).filter((i) => i.students_struggled > 0),
    [insights],
  );

  // A course with no sections at all has nothing to scope — say nothing.
  if (sections !== null && sections.length === 0) return null;

  const showSectionPivot = (sections?.length ?? 0) > 1;

  return (
    <section className="mt-10">
      <header className="max-w-2xl">
        <h3 className="font-serif text-[20px] leading-tight tracking-[-0.01em] text-text-primary">
          Where the class is struggling
        </h3>
        <p className="mt-1 font-serif italic text-[14px] leading-snug text-text-muted">
          Formative signal from ungraded practice — a nudge on what to revisit, not a gradebook.
        </p>
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
        <p className="mt-5 text-sm text-[color:var(--color-error)]">{error}</p>
      ) : loading || insights === null ? (
        <StruggleSkeleton />
      ) : insights.students_active === 0 ? (
        <EmptyState />
      ) : struggleItems.length === 0 ? (
        <CleanState activeCount={insights.students_active} />
      ) : (
        <div className="mt-6">
          <p className="font-mono text-[11px] text-text-muted">
            {insights.students_active}{" "}
            {insights.students_active === 1 ? "student" : "students"} active in practice
          </p>
          <ol className="mt-3 divide-y divide-border-light border-t border-border-light">
            {struggleItems.map((item, i) => (
              <StruggleRow
                key={item.bank_item_id}
                item={item}
                rank={i + 1}
                reduce={!!reduce}
                onReteach={() => setReteach(item.concept)}
              />
            ))}
          </ol>
        </div>
      )}

      {/* Re-teach → pre-seeded practice generation. Closes the
          insight→action loop: the chosen concept seeds the new-practice
          modal's title and generation focus so the teacher lands ready to
          generate a targeted set on exactly what the class struggled on. */}
      {reteach !== null && (
        <NewPracticeModal
          courseId={courseId}
          seed={{ title: `Re-teach: ${reteach}`, focus: reteach }}
          onClose={() => setReteach(null)}
          onCreated={(newId) => {
            setReteach(null);
            // Mirror the practice tab: the new set opens in the editor,
            // whose generating hero covers the wait while items land.
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

function StruggleRow({
  item,
  rank,
  reduce,
  onReteach,
}: {
  item: PracticeInsightItem;
  rank: number;
  reduce: boolean;
  onReteach: () => void;
}) {
  // Proportion of the students who practiced this item that ended up
  // struggling on it. Guard the denominator — students_struggled is
  // counted independently of students_practiced server-side, so in a
  // rare race it could exceed it; clamp to keep the bar ≤ 100%.
  const denom = Math.max(item.students_practiced, item.students_struggled, 1);
  const ratio = item.students_struggled / denom;
  return (
    <li className="group py-3.5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 font-mono text-[11px] text-text-muted tabular-nums">
            {String(rank).padStart(2, "0")}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-text-primary">
            {item.concept}
          </span>
        </div>
        <span className="shrink-0 text-[12px] text-text-secondary tabular-nums">
          <span className="font-semibold text-text-primary">
            {item.students_struggled}
          </span>{" "}
          of {item.students_practiced} struggled
        </span>
      </div>

      {/* Proportion bar with a quiet trailing action — the bar names the
          struggle, the "Re-teach" link is the natural next step on it. */}
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
        <button
          type="button"
          onClick={onReteach}
          aria-label={`Re-teach ${item.concept} — start a targeted practice set`}
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

/**
 * Initial-load placeholder for the class struggle band. Mirrors the real
 * silhouette — an active-count line over a divided list of ranked concept
 * rows, each with its proportion bar — so the panel settles in place
 * rather than blanking to "Loading…".
 */
function StruggleSkeleton() {
  return (
    <div className="mt-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-3 w-44 rounded-[--radius-sm]" />
      <ol className="mt-3 divide-y divide-border-light border-t border-border-light">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="py-3.5">
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <Skeleton className="h-3 w-5" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-5 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle px-6 py-8 text-center">
      <p className="text-sm text-text-secondary">
        No practice activity in this section yet.
      </p>
      <p className="mt-1 text-xs text-text-muted">
        Once students work through a practice set, the concepts they revisit most will surface here.
      </p>
    </div>
  );
}

function CleanState({ activeCount }: { activeCount: number }) {
  return (
    <div className="mt-5 rounded-[--radius-lg] border border-border-light bg-surface px-6 py-8 text-center">
      <p className="text-sm text-text-secondary">
        Nothing to re-teach right now.
      </p>
      <p className="mt-1 text-xs text-text-muted">
        {activeCount} {activeCount === 1 ? "student is" : "students are"} practicing and moving through it cleanly — no struggle signal yet.
      </p>
    </div>
  );
}
