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
import { GenerateSimilarDialog } from "@/components/school/teacher/_pieces/generate-similar-dialog";

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
  /** True when the parent primary was edited after some variation was
   *  created — existing pool may no longer match the question. */
  stale: boolean;
}

const DISMISS_INTRO_KEY = "dismissed_practice_intro";

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
  // Per-row expand + per-variation preview-open + per-action pending.
  // `actionBusyId` covers approve/reject/regen/restore on a single
  // variation so we can disable its buttons while the request runs.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({});
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [generateForId, setGenerateForId] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState<Record<string, boolean>>({});
  const [showIntro, setShowIntro] = useState(false);
  // `pollingUntil` is a timestamp; while now < it, we refetch every
  // 3s so newly-generated variations land in the UI without a manual
  // reload. Set by generate actions; cleared when time runs out or
  // the teacher navigates.
  const [pollingUntil, setPollingUntil] = useState<number>(0);

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

  // One-time intro banner on the first Practice page visit ever.
  // localStorage-gated so teachers aren't re-introduced on every HW.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(DISMISS_INTRO_KEY);
    if (!dismissed) setShowIntro(true);
  }, []);

  const dismissIntro = () => {
    setShowIntro(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_INTRO_KEY, "1");
    }
  };

  // Simple poll: after a generate action sets pollingUntil, refetch
  // every 3s until that timestamp passes. Keeps the pool rendering
  // fresh without a full job-polling hook (that can come later with
  // a dedicated stream endpoint).
  useEffect(() => {
    if (pollingUntil <= Date.now()) return;
    const interval = setInterval(() => {
      if (Date.now() > pollingUntil) {
        clearInterval(interval);
        return;
      }
      void reload();
    }, 3000);
    return () => clearInterval(interval);
  }, [pollingUntil, reload]);

  // Group bank items by parent (= HW primary). Variations have a
  // parent_question_id; anything without one is a primary itself and
  // not a "practice problem" for this view.
  const pools = useMemo<PerProblemPool[]>(() => {
    if (!hw) return [];
    const problems = extractProblems(hw.content);
    const byParent = new Map<string, BankItem[]>();
    const primaryById = new Map<string, BankItem>();
    for (const it of items) {
      if (it.parent_question_id) {
        const arr = byParent.get(it.parent_question_id) ?? [];
        arr.push(it);
        byParent.set(it.parent_question_id, arr);
      } else {
        primaryById.set(it.id, it);
      }
    }
    return problems.map((p) => {
      const all = byParent.get(p.bank_item_id) ?? [];
      const primary = primaryById.get(p.bank_item_id);
      // Staleness: any variation created before the primary's last
      // update means the primary was edited after that variation was
      // written — existing practice may not match the current question.
      // 1-second tolerance guards against server clock skew at insert.
      const stale =
        !!primary &&
        all.some(
          (v) =>
            new Date(v.created_at).getTime() <
            new Date(primary.updated_at).getTime() - 1000,
        );
      return {
        problem: p,
        approved: all.filter((v) => v.status === "approved"),
        pending: all.filter((v) => v.status === "pending"),
        rejected: all.filter((v) => v.status === "rejected"),
        stale,
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
        // Poll for 60s — most jobs finish within 10–20s. Initial
        // refetch after a short beat surfaces the queued-state rows.
        setPollingUntil(Date.now() + 60_000);
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

  const approveVariation = async (id: string) => {
    setActionBusyId(id);
    try {
      await teacher.approveBankItem(id);
      await reload();
    } catch {
      toast.error("Couldn't approve");
    } finally {
      setActionBusyId(null);
    }
  };

  const rejectVariation = async (id: string) => {
    setActionBusyId(id);
    try {
      await teacher.rejectBankItem(id);
      await reload();
    } catch {
      toast.error("Couldn't reject");
    } finally {
      setActionBusyId(null);
    }
  };

  const restoreVariation = async (id: string) => {
    setActionBusyId(id);
    try {
      await teacher.restoreBankItem(id);
      await reload();
    } catch {
      toast.error("Couldn't restore");
    } finally {
      setActionBusyId(null);
    }
  };

  const regenerateVariation = async (id: string) => {
    setActionBusyId(id);
    try {
      await teacher.regenerateBankItem(id);
      await reload();
      toast.success("Regenerated");
    } catch {
      toast.error("Couldn't regenerate");
    } finally {
      setActionBusyId(null);
    }
  };

  const jumpToFirstPending = () => {
    const firstPending = pools.find((p) => p.pending.length > 0);
    if (!firstPending) return;
    setExpanded((e) => ({
      ...e,
      [firstPending.problem.bank_item_id]: true,
    }));
    // Scroll after a tick so the expanded row is in the DOM.
    setTimeout(() => {
      const el = document.getElementById(
        `prow-${firstPending.problem.bank_item_id}`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
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

      {showIntro && (
        <div className="mt-4 flex items-start gap-3 rounded-[--radius-xl] border border-primary/30 bg-primary-bg/30 px-4 py-3 dark:bg-primary/10">
          <span aria-hidden="true" className="mt-0.5 text-lg">
            ✨
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-text-primary">
              Practice problems, generated for you
            </div>
            <div className="mt-0.5 text-xs text-text-secondary">
              When you publish a homework, we auto-generate a pool of
              similar problems for each question. Review them here,
              approve what you like, reject what you don&apos;t. Change
              the default in{" "}
              <Link
                href="/school/teacher/preferences"
                className="font-bold text-primary hover:underline"
              >
                Preferences
              </Link>
              .
            </div>
          </div>
          <button
            type="button"
            onClick={dismissIntro}
            aria-label="Dismiss"
            className="shrink-0 text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      )}

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
            onReviewPending={jumpToFirstPending}
            toppingUp={toppingUp}
          />

          {pollingUntil > Date.now() && (
            <div className="mt-3 flex items-center gap-2 rounded-[--radius-md] border border-primary/30 bg-primary-bg/30 px-3 py-2 text-xs text-text-primary dark:border-primary/40 dark:bg-primary/10">
              <span
                className="relative flex h-2.5 w-2.5 shrink-0"
                aria-hidden="true"
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              <span>
                <span className="font-semibold">Generating…</span>{" "}
                <span className="text-text-secondary">
                  new practice problems land here as they&apos;re ready.
                </span>
              </span>
            </div>
          )}

          {totals.approved + totals.pending === 0 ? (
            <EmptyNoPractice
              onGenerate={generateMissing}
              target={effectiveTarget}
              busy={toppingUp}
            />
          ) : (
            <section className="mt-5 space-y-2">
              {pools.map((pool) => {
                const pid = pool.problem.bank_item_id;
                return (
                  <ProblemRow
                    key={pid}
                    pool={pool}
                    target={effectiveTarget}
                    expanded={!!expanded[pid]}
                    onToggleExpand={() =>
                      setExpanded((e) => ({ ...e, [pid]: !e[pid] }))
                    }
                    previewOpen={previewOpen}
                    onTogglePreview={(vid) =>
                      setPreviewOpen((p) => ({ ...p, [vid]: !p[vid] }))
                    }
                    showRejected={!!showRejected[pid]}
                    onToggleRejected={() =>
                      setShowRejected((s) => ({ ...s, [pid]: !s[pid] }))
                    }
                    actionBusyId={actionBusyId}
                    onApprove={approveVariation}
                    onReject={rejectVariation}
                    onRestore={restoreVariation}
                    onRegenerate={regenerateVariation}
                    onGenerateMore={() => setGenerateForId(pid)}
                  />
                );
              })}
            </section>
          )}

          {generateForId && (
            <GenerateSimilarDialog
              itemId={generateForId}
              onClose={() => setGenerateForId(null)}
              onStarted={() => {
                setGenerateForId(null);
                toast.info("Generation started");
                setPollingUntil(Date.now() + 60_000);
                setTimeout(() => void reload(), 1500);
              }}
            />
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
  onReviewPending,
  toppingUp,
}: {
  anyBelowTarget: boolean;
  pendingCount: number;
  target: number;
  onGenerateMissing: () => void;
  onReviewPending: () => void;
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
        <button
          type="button"
          onClick={onReviewPending}
          className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          Review pending ({pendingCount})
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Per-problem row — collapsed header + optional expanded pool view
// ────────────────────────────────────────────────────────────────────

function ProblemRow({
  pool,
  target,
  expanded,
  onToggleExpand,
  previewOpen,
  onTogglePreview,
  showRejected,
  onToggleRejected,
  actionBusyId,
  onApprove,
  onReject,
  onRestore,
  onRegenerate,
  onGenerateMore,
}: {
  pool: PerProblemPool;
  target: number;
  expanded: boolean;
  onToggleExpand: () => void;
  previewOpen: Record<string, boolean>;
  onTogglePreview: (id: string) => void;
  showRejected: boolean;
  onToggleRejected: () => void;
  actionBusyId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRestore: (id: string) => void;
  onRegenerate: (id: string) => void;
  onGenerateMore: () => void;
}) {
  const ready = pool.approved.length;
  const pending = pool.pending.length;
  const rejected = pool.rejected.length;
  const total = ready + pending;
  const isEmpty = total === 0;
  const atTarget = total >= target;
  const pid = pool.problem.bank_item_id;

  const statusBits: { text: string; cls: string }[] = [
    {
      text: `${ready} ready`,
      cls: ready > 0 ? "text-success" : "text-text-muted",
    },
  ];
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
      id={`prow-${pid}`}
      className={`rounded-[--radius-md] border bg-surface transition-colors ${
        isEmpty
          ? "border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/5"
          : "border-border-light"
      }`}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
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
          {pool.stale && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-[--radius-pill] border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              ⚠ Edited — existing practice may not match
            </div>
          )}
        </div>
        <span className="shrink-0 text-text-muted">
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border-light px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Practice pool
            </span>
            <button
              type="button"
              onClick={onGenerateMore}
              className="rounded-[--radius-pill] border border-primary/40 bg-primary-bg/30 px-3 py-1 text-[11px] font-bold text-primary hover:bg-primary-bg/60"
            >
              ✨ Generate more
            </button>
          </div>

          {/* Pending first — most urgent review surface */}
          {pool.pending.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                Pending review · {pool.pending.length}
              </div>
              <div className="mt-1.5 space-y-1.5">
                {pool.pending.map((v) => (
                  <VariationCard
                    key={v.id}
                    variation={v}
                    bucket="pending"
                    expanded={!!previewOpen[v.id]}
                    onTogglePreview={() => onTogglePreview(v.id)}
                    busy={actionBusyId === v.id}
                    onApprove={() => onApprove(v.id)}
                    onReject={() => onReject(v.id)}
                    onRegenerate={() => onRegenerate(v.id)}
                    onRestore={() => onRestore(v.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Approved */}
          {pool.approved.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-success">
                Approved · {pool.approved.length}
              </div>
              <div className="mt-1.5 space-y-1.5">
                {pool.approved.map((v) => (
                  <VariationCard
                    key={v.id}
                    variation={v}
                    bucket="approved"
                    expanded={!!previewOpen[v.id]}
                    onTogglePreview={() => onTogglePreview(v.id)}
                    busy={actionBusyId === v.id}
                    onApprove={() => onApprove(v.id)}
                    onReject={() => onReject(v.id)}
                    onRegenerate={() => onRegenerate(v.id)}
                    onRestore={() => onRestore(v.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Rejected — collapsed by default so the teacher isn't
              staring at every historical no. */}
          {pool.rejected.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onToggleRejected}
                className="text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
              >
                {showRejected ? "Hide" : "Show"} rejected ·{" "}
                {pool.rejected.length}
              </button>
              {showRejected && (
                <div className="mt-1.5 space-y-1.5">
                  {pool.rejected.map((v) => (
                    <VariationCard
                      key={v.id}
                      variation={v}
                      bucket="rejected"
                      expanded={!!previewOpen[v.id]}
                      onTogglePreview={() => onTogglePreview(v.id)}
                      busy={actionBusyId === v.id}
                      onApprove={() => onApprove(v.id)}
                      onReject={() => onReject(v.id)}
                      onRegenerate={() => onRegenerate(v.id)}
                      onRestore={() => onRestore(v.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {pool.approved.length === 0 &&
            pool.pending.length === 0 &&
            pool.rejected.length === 0 && (
              <div className="mt-3 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle/40 px-4 py-6 text-center">
                <p className="text-xs text-text-muted">
                  No practice generated for this question yet.
                </p>
                <button
                  type="button"
                  onClick={onGenerateMore}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark"
                >
                  ✨ Generate {target}
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function VariationCard({
  variation,
  bucket,
  expanded,
  onTogglePreview,
  busy,
  onApprove,
  onReject,
  onRegenerate,
  onRestore,
}: {
  variation: BankItem;
  bucket: "approved" | "pending" | "rejected";
  expanded: boolean;
  onTogglePreview: () => void;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  onRestore: () => void;
}) {
  const dotCls =
    bucket === "approved"
      ? "bg-success"
      : bucket === "pending"
        ? "bg-amber-500"
        : "bg-bg-subtle";

  return (
    <div
      className={`rounded-[--radius-md] border bg-bg-base/40 px-3 py-2 ${
        bucket === "rejected" ? "opacity-70" : ""
      } border-border-light`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={`mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`}
        />
        <button
          type="button"
          onClick={onTogglePreview}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <div
            className={`line-clamp-${expanded ? "none" : "1"} text-[13px] text-text-primary`}
          >
            <MathText text={variation.question} />
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {bucket === "pending" && (
            <>
              <ActionButton
                label="Approve"
                variant="primary"
                onClick={onApprove}
                busy={busy}
              />
              <ActionButton
                label="Regenerate"
                onClick={onRegenerate}
                busy={busy}
              />
              <ActionButton
                label="Reject"
                variant="danger"
                onClick={onReject}
                busy={busy}
              />
            </>
          )}
          {bucket === "approved" && (
            <>
              <ActionButton
                label="Regenerate"
                onClick={onRegenerate}
                busy={busy}
              />
              <ActionButton
                label="Reject"
                variant="danger"
                onClick={onReject}
                busy={busy}
              />
            </>
          )}
          {bucket === "rejected" && (
            <ActionButton label="Restore" onClick={onRestore} busy={busy} />
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 border-t border-border-light pt-2 text-[12px] text-text-secondary">
          {variation.final_answer && (
            <div className="mb-1.5">
              <span className="font-bold">Answer: </span>
              <MathText text={variation.final_answer} />
            </div>
          )}
          {variation.solution_steps && variation.solution_steps.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5">
              {variation.solution_steps.map((s, i) => (
                <li key={i}>
                  <span className="font-semibold">{s.title}: </span>
                  <MathText text={s.description} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  variant = "neutral",
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  variant?: "primary" | "danger" | "neutral";
}) {
  const base =
    "rounded-[--radius-pill] px-2.5 py-0.5 text-[10px] font-bold disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-primary text-white hover:bg-primary-dark"
      : variant === "danger"
        ? "border border-border-light bg-surface text-text-secondary hover:border-red-300 hover:text-red-600"
        : "border border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`${base} ${styles}`}
    >
      {busy ? "…" : label}
    </button>
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
