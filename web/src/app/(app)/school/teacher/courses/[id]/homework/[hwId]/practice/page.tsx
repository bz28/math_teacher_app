"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankItem,
  type TeacherAssignment,
  type TeacherPreferences,
  type TeacherRubric,
} from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { HwNavStrip } from "@/components/school/teacher/_pieces/hw-nav-strip";

interface AssignmentProblem {
  bank_item_id: string;
  position: number;
  question: string;
  difficulty: string;
}

interface PerProblemPool {
  problem: AssignmentProblem;
  approved: BankItem[];
  pending: BankItem[];
  rejected: BankItem[];
}

type AssignmentWithExtras = TeacherAssignment & {
  content: unknown;
  rubric: TeacherRubric | null;
};

/**
 * Per-HW practice variation management. URL: /homework/:hwId/practice.
 *
 * Layout:
 *   [Back link]
 *   [HW title + section nav]
 *   [Coverage header — counts + auto-gen toggle]
 *   [Action row — Generate missing / Review pending / Preview as student]
 *   [Per-problem list — one collapsed row per HW question]
 *
 * The expanded-row pool view and inline variation actions land in
 * follow-up commits; this one is the shell with coverage + collapsed
 * rows + the Generate-missing action so teachers can immediately see
 * the state of their HW and top up empty pools.
 */
export default function PracticePage({
  params,
}: {
  params: Promise<{ id: string; hwId: string }>;
}) {
  const { id: courseId, hwId: assignmentId } = use(params);
  const toast = useToast();

  const [hw, setHw] = useState<AssignmentWithExtras | null>(null);
  const [items, setItems] = useState<BankItem[]>([]);
  const [prefs, setPrefs] = useState<TeacherPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [toppingUp, setToppingUp] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [a, bank, p] = await Promise.all([
        teacher.assignment(assignmentId),
        teacher.bank(courseId, { assignment_id: assignmentId }),
        teacher.preferences().catch(() => null),
      ]);
      setHw(a);
      setItems(bank.items);
      if (p) setPrefs(p);
    } catch {
      toast.error("Couldn't load this homework");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, courseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Group bank items by parent (= HW primary). Variations have a
  // parent_question_id; anything without one is a primary itself and
  // not a "practice problem" for this view.
  const pools = useMemo<PerProblemPool[]>(() => {
    if (!hw) return [];
    const problems = extractProblems(hw.content);
    const byParent = new Map<string, BankItem[]>();
    for (const it of items) {
      if (!it.parent_question_id) continue;
      const arr = byParent.get(it.parent_question_id) ?? [];
      arr.push(it);
      byParent.set(it.parent_question_id, arr);
    }
    return problems.map((p) => {
      const all = byParent.get(p.bank_item_id) ?? [];
      return {
        problem: p,
        approved: all.filter((v) => v.status === "approved"),
        pending: all.filter((v) => v.status === "pending"),
        rejected: all.filter((v) => v.status === "rejected"),
      };
    });
  }, [hw, items]);

  const effectiveTarget =
    hw?.default_practice_count ?? prefs?.default_practice_count ?? 3;
  const effectiveAutoOn =
    hw?.auto_generate_practice_on_publish ??
    prefs?.auto_generate_practice_on_publish ??
    true;

  const totals = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let empty = 0;
    for (const pool of pools) {
      approved += pool.approved.length;
      pending += pool.pending.length;
      if (pool.approved.length + pool.pending.length === 0) empty += 1;
    }
    return { approved, pending, empty, questionCount: pools.length };
  }, [pools]);

  const anyBelowTarget = pools.some(
    (p) => p.approved.length + p.pending.length < effectiveTarget,
  );

  const generateMissing = async () => {
    if (!hw || toppingUp) return;
    setToppingUp(true);
    try {
      const resp = await teacher.topUpPractice(assignmentId, {
        target_count: effectiveTarget,
      });
      if (resp.scheduled.length > 0) {
        toast.info(
          `Generating practice for ${resp.scheduled.length} question${resp.scheduled.length === 1 ? "" : "s"}…`,
        );
        // Wait a beat, then reload so the spinners appear. A future
        // commit adds proper job polling for live updates.
        setTimeout(() => {
          void reload();
        }, 1500);
      } else {
        toast.info("All questions are already at target");
      }
    } catch {
      toast.error("Couldn't start generation");
    } finally {
      setToppingUp(false);
    }
  };

  const toggleAutoGenForHw = async () => {
    if (!hw) return;
    const currentOverride = hw.auto_generate_practice_on_publish;
    const effectiveNow = currentOverride ?? prefs?.auto_generate_practice_on_publish ?? true;
    const nextValue = !effectiveNow;
    // Write an explicit override. Teacher can always revert to the
    // default by toggling back (it just writes the other value).
    setHw({ ...hw, auto_generate_practice_on_publish: nextValue });
    try {
      await teacher.updateAssignment(assignmentId, {
        auto_generate_practice_on_publish: nextValue,
      });
      toast.success(nextValue ? "Auto-gen on for this HW" : "Auto-gen off for this HW");
    } catch {
      setHw({ ...hw, auto_generate_practice_on_publish: currentOverride });
      toast.error("Couldn't save");
    }
  };

  const backHref = `/school/teacher/courses/${courseId}/homework/${assignmentId}`;
  const pendingVariationCount = totals.pending;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10">
      {/* Breadcrumb */}
      <div className="pt-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← Back to homework
        </Link>
      </div>

      <HwNavStrip
        courseId={courseId}
        assignmentId={assignmentId}
        reviewEnabled={!!hw && hw.status === "published"}
        pendingCount={pendingVariationCount}
      />

      <header className="mt-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
          {hw?.title ?? "Loading…"}
        </h1>
        <p className="mt-0.5 text-sm text-text-secondary">Practice problems</p>
      </header>

      {loading ? (
        <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-sm">
          <p className="text-sm text-text-muted">Loading…</p>
        </div>
      ) : !hw || pools.length === 0 ? (
        <EmptyNoProblems backHref={backHref} />
      ) : (
        <>
          <CoverageCard
            totals={totals}
            effectiveAutoOn={effectiveAutoOn}
            effectiveTarget={effectiveTarget}
            override={hw.auto_generate_practice_on_publish}
            onToggle={toggleAutoGenForHw}
          />

          <ActionRow
            anyBelowTarget={anyBelowTarget}
            pendingCount={totals.pending}
            target={effectiveTarget}
            onGenerateMissing={generateMissing}
            toppingUp={toppingUp}
          />

          {totals.approved + totals.pending === 0 ? (
            <EmptyNoPractice
              onGenerate={generateMissing}
              target={effectiveTarget}
              busy={toppingUp}
            />
          ) : (
            <section className="mt-5 space-y-2">
              {pools.map((pool) => (
                <CollapsedRow
                  key={pool.problem.bank_item_id}
                  pool={pool}
                  target={effectiveTarget}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function extractProblems(content: unknown): AssignmentProblem[] {
  if (!content || typeof content !== "object") return [];
  const c = content as { problems?: AssignmentProblem[] };
  return c.problems ?? [];
}

// ────────────────────────────────────────────────────────────────────
// Coverage header
// ────────────────────────────────────────────────────────────────────

function CoverageCard({
  totals,
  effectiveAutoOn,
  effectiveTarget,
  override,
  onToggle,
}: {
  totals: {
    approved: number;
    pending: number;
    empty: number;
    questionCount: number;
  };
  effectiveAutoOn: boolean;
  effectiveTarget: number;
  override: boolean | null;
  onToggle: () => void;
}) {
  const summaryBits: string[] = [];
  if (totals.pending > 0) {
    summaryBits.push(
      `${totals.pending} pending your review`,
    );
  }
  if (totals.empty > 0) {
    summaryBits.push(
      `${totals.empty} question${totals.empty === 1 ? "" : "s"} with no practice yet`,
    );
  }

  return (
    <section className="mt-5 rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-extrabold tracking-tight text-text-primary">
            {totals.approved} practice problem{totals.approved === 1 ? "" : "s"} ready
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            across {totals.questionCount} question{totals.questionCount === 1 ? "" : "s"}
            {summaryBits.length > 0 && (
              <> · {summaryBits.join(" · ")}</>
            )}
          </div>
        </div>

        <div className="shrink-0 rounded-[--radius-md] border border-border-light bg-bg-base/40 px-3 py-2">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Auto-generate on publish
              </div>
              <div className="mt-0.5 text-[10px] text-text-muted">
                {override === null
                  ? "Using teacher default"
                  : "Overridden for this HW"}
                {" · "}
                target {effectiveTarget}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={effectiveAutoOn}
              onClick={onToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                effectiveAutoOn ? "bg-primary" : "bg-bg-subtle"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  effectiveAutoOn ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Action row
// ────────────────────────────────────────────────────────────────────

function ActionRow({
  anyBelowTarget,
  pendingCount,
  target,
  onGenerateMissing,
  toppingUp,
}: {
  anyBelowTarget: boolean;
  pendingCount: number;
  target: number;
  onGenerateMissing: () => void;
  toppingUp: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-stretch gap-2">
      <button
        type="button"
        onClick={onGenerateMissing}
        disabled={!anyBelowTarget || toppingUp}
        title={
          anyBelowTarget
            ? `Fill every question's pool up to ${target}`
            : `Every question is already at target (${target})`
        }
        className="inline-flex items-center gap-2 rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
      >
        <span>✨</span>
        {toppingUp
          ? "Starting…"
          : `Generate missing practice`}
      </button>
      <span className="hidden items-center text-[11px] text-text-muted sm:inline-flex">
        brings every question up to {target}
      </span>

      {pendingCount > 0 && (
        <a
          href="#first-pending"
          className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          Review pending ({pendingCount})
        </a>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Collapsed per-problem row
// ────────────────────────────────────────────────────────────────────

function CollapsedRow({
  pool,
  target,
}: {
  pool: PerProblemPool;
  target: number;
}) {
  const ready = pool.approved.length;
  const pending = pool.pending.length;
  const rejected = pool.rejected.length;
  const total = ready + pending;
  const isEmpty = total === 0;
  const atTarget = total >= target;

  const statusBits: { text: string; cls: string }[] = [];
  statusBits.push({
    text: `${ready} ready`,
    cls: ready > 0 ? "text-success" : "text-text-muted",
  });
  if (pending > 0) {
    statusBits.push({
      text: `${pending} pending`,
      cls: "text-amber-700 dark:text-amber-300",
    });
  }
  if (rejected > 0) {
    statusBits.push({
      text: `${rejected} rejected`,
      cls: "text-text-muted",
    });
  }

  return (
    <div
      id={pending > 0 ? "first-pending-anchor" : undefined}
      className={`rounded-[--radius-md] border bg-surface px-4 py-3 ${
        isEmpty
          ? "border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/5"
          : "border-border-light"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white">
          {pool.problem.position}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] leading-snug text-text-primary">
            <MathText text={pool.problem.question} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold">
            {isEmpty ? (
              <span className="text-amber-800 dark:text-amber-300">
                0 — no practice yet
              </span>
            ) : (
              statusBits.map((bit, i) => (
                <span key={i} className={bit.cls}>
                  {bit.text}
                </span>
              ))
            )}
            <span className="text-text-muted">
              · target {target}
              {atTarget && ready > 0 ? " ✓" : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty states
// ────────────────────────────────────────────────────────────────────

function EmptyNoProblems({ backHref }: { backHref: string }) {
  return (
    <div className="mt-6 rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle/50 px-8 py-12 text-center">
      <div className="text-4xl" aria-hidden="true">📝</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        Add problems first
      </h3>
      <p className="mt-1 text-xs text-text-muted">
        Practice problems are generated per homework question — you need
        at least one question before there&apos;s anything to practice.
      </p>
      <Link
        href={backHref}
        className="mt-5 inline-flex items-center gap-2 rounded-[--radius-md] bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark"
      >
        ← Back to homework
      </Link>
    </div>
  );
}

function EmptyNoPractice({
  onGenerate,
  target,
  busy,
}: {
  onGenerate: () => void;
  target: number;
  busy: boolean;
}) {
  return (
    <div className="mt-5 rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle/50 px-8 py-12 text-center">
      <div className="text-4xl" aria-hidden="true">✨</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        Your students don&apos;t have any practice yet
      </h3>
      <p className="mt-1 text-xs text-text-muted">
        Generate a pool of similar problems for each question —
        we&apos;ll walk through them with you for approval.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={busy}
        className="mt-5 inline-flex items-center gap-2 rounded-[--radius-md] bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark disabled:opacity-50"
      >
        {busy ? "Starting…" : `Generate ${target} per question`}
      </button>
    </div>
  );
}
