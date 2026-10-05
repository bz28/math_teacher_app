"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { TOUR_IDS } from "@/components/tour";
import {
  teacher,
  type InsightsHomework,
  type InsightsProblem,
  type InsightsStudentRef,
  type InsightsWatchStudent,
  type SectionInsightsResponse,
  type TeacherSection,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { Skeleton } from "@/components/ui/skeleton";
import { PageErrorState } from "@/components/ui/page-error-state";

/**
 * Student Insights — "what do I reteach tomorrow, and who needs me?"
 *
 * Reads GET /teacher/.../sections/{sid}/insights: graded homework only,
 * counted from grades the teacher approved or published (an AI draft
 * never counts). Organised by homework, then by problem, most-missed
 * first. A serif lead sentence answers the question up top; the
 * students-to-watch strip names the few people who need the teacher;
 * each problem expands to who missed it, why (when the understanding
 * check recorded a reason), and a link to their work.
 */

const DIAGNOSIS_LABEL: Record<string, string> = {
  conceptual_gap: "Conceptual gap",
  procedural_slip: "Slip",
  blank: "Left blank",
  unreadable: "Couldn't read",
};

export function StudentInsightsTab({ courseId }: { courseId: string }) {
  const [sections, setSections] = useState<TeacherSection[] | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [homeworkId, setHomeworkId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<SectionInsightsResponse | null>(null);
  const [error, setError] = useState(false);
  // One retry counter per fetch, so Retry re-fires only the read that
  // failed and never resets the section the teacher is on.
  const [sectionsReload, setSectionsReload] = useState(0);
  const [insightsReload, setInsightsReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    teacher
      .sections(courseId)
      .then((res) => {
        if (cancelled) return;
        setSections(res.sections);
        setSectionId((current) =>
          current && res.sections.some((s) => s.id === current)
            ? current
            : (res.sections[0]?.id ?? null),
        );
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [courseId, sectionsReload]);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    teacher
      .sectionInsights(courseId, sectionId, homeworkId)
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [courseId, sectionId, homeworkId, insightsReload]);

  // Resets live in the handlers (not the fetch effect) so the skeleton
  // shows from the click that triggers the reload.
  const pickSection = (id: string) => {
    setError(false);
    setData(null);
    setHomeworkId(undefined);
    setSectionId(id);
  };
  const pickHomework = (id: string) => {
    setError(false);
    setData(null);
    setHomeworkId(id);
  };
  const retry = () => {
    setError(false);
    setData(null);
    if (sections === null) setSectionsReload((k) => k + 1);
    else setInsightsReload((k) => k + 1);
  };

  return (
    <section>
      <header className="max-w-2xl">
        <h2
          data-tour-id={TOUR_IDS.teacherInsights}
          className="font-serif text-[26px] leading-tight tracking-[-0.015em] text-text-primary"
        >
          Student Insights
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          What the class missed on each homework, and who needs you. Counts
          only grades you&rsquo;ve approved or published.
        </p>
      </header>

      {sections && sections.length > 1 && (
        <div role="group" aria-label="Choose a section" className="mt-5 flex flex-wrap gap-1.5">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sectionId === s.id}
              onClick={() => pickSection(s.id)}
              className={`rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                sectionId === s.id
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
        <PageErrorState message="Student Insights didn't load." onRetry={retry} />
      ) : sections && sections.length === 0 ? (
        <Empty title="No sections yet" body="Create a section and enroll students. Their homework results show up here once you grade." />
      ) : !data ? (
        <InsightsSkeleton />
      ) : data.homeworks.length === 0 ? (
        <Empty title="No homework yet" body={`Publish homework to ${data.section.name}. Results show up here once you approve or publish grades.`} />
      ) : (
        <Body
          key={`${data.section.id}:${data.selected_homework_id}`}
          courseId={courseId}
          data={data}
          onPickHomework={pickHomework}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────

function Body({
  courseId,
  data,
  onPickHomework,
}: {
  courseId: string;
  data: SectionInsightsResponse;
  onPickHomework: (id: string) => void;
}) {
  const hw = data.homeworks.find((h) => h.id === data.selected_homework_id) ?? data.homeworks[0];
  const worst = data.problems[0];
  const [open, setOpen] = useState<string | null>(worst && worst.zero > 0 ? worst.bank_item_id : null);
  const reviewHref = (studentId: string, position: number) =>
    `/school/teacher/courses/${courseId}/homework/${hw.id}/sections/${data.section.id}/review?student=${studentId}&problem=${position}`;

  return (
    <>
      <Lead problems={data.problems} homework={hw} sectionName={data.section.name} />

      {data.watch.length > 0 && (
        <WatchStrip courseId={courseId} sectionId={data.section.id} watch={data.watch} total={data.watch_total} />
      )}

      <div className="mt-10 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-border-light pb-3">
        <label className="sr-only" htmlFor="insights-homework">
          Homework
        </label>
        <select
          id="insights-homework"
          value={hw.id}
          onChange={(e) => onPickHomework(e.target.value)}
          className="max-w-full rounded-[--radius-sm] border border-border-light bg-surface px-2.5 py-1.5 text-sm font-semibold text-text-primary focus:border-primary focus:outline-none"
        >
          {data.homeworks.map((h) => (
            <option key={h.id} value={h.id}>
              {h.title}
            </option>
          ))}
        </select>
        <p className="text-[12px] text-text-muted">{coverageSentence(hw)}</p>
      </div>

      {hw.counted === 0 ? (
        <Empty
          title="No grades counted yet"
          body="Approve or publish this homework's grades in Submissions and the class results appear here."
        />
      ) : (
        <ul className="divide-y divide-border-light">
          {data.problems.map((p) => (
            <ProblemRow
              key={p.bank_item_id}
              problem={p}
              open={open === p.bank_item_id}
              onToggle={() => setOpen(open === p.bank_item_id ? null : p.bank_item_id)}
              reviewHref={reviewHref}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** The one bold element: a sentence that answers "what do I reteach?" */
function Lead({
  problems,
  homework,
  sectionName,
}: {
  problems: InsightsProblem[];
  homework: InsightsHomework;
  sectionName: string;
}) {
  if (homework.counted === 0) return null;
  const worst = problems[0];
  const graded = worst ? worst.full + worst.partial + worst.zero : 0;
  return (
    <p className="mt-8 max-w-2xl font-serif text-[22px] leading-snug text-text-primary">
      {worst && worst.zero > 0 ? (
        <>
          Problem {worst.position} is where {sectionName} lost the most: {worst.zero} of {graded}{" "}
          missed it.
        </>
      ) : (
        <>Nobody in {sectionName} missed a problem outright on {homework.title}.</>
      )}
    </p>
  );
}

function coverageSentence(h: InsightsHomework): string {
  const parts = [`${h.counted} of ${h.students} counted`];
  if (h.to_approve) parts.push(`${h.to_approve} to approve`);
  if (h.to_hand_grade) parts.push(`${h.to_hand_grade} to grade by hand`);
  if (h.grading) parts.push(`${h.grading} still grading`);
  if (h.not_submitted) parts.push(`${h.not_submitted} not turned in`);
  return parts.join(", ") + ".";
}

function watchReason(w: InsightsWatchStudent): string {
  if (w.reason === "missing_work") return `Didn't turn in ${w.missed} of the last ${w.window} homeworks`;
  if (w.reason === "missing_most") return `Missed ${w.zero} of ${w.problems} problems on the last two homeworks`;
  return `Average fell from ${Math.round(w.previous ?? 0)}% to ${Math.round(w.latest ?? 0)}%`;
}

function WatchStrip({
  courseId,
  sectionId,
  watch,
  total,
}: {
  courseId: string;
  sectionId: string;
  watch: InsightsWatchStudent[];
  total: number;
}) {
  return (
    <div className="mt-6 rounded-[--radius-lg] border border-border-light bg-[color:var(--color-surface-alt)] px-5 py-4">
      <h3 className="text-sm font-semibold text-text-primary">Students to watch</h3>
      <ul className="mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
        {watch.map((w) => (
          <li key={w.student_id} className="min-w-0 text-[13px] leading-snug">
            <Link
              href={`/school/teacher/courses/${courseId}/grades/${sectionId}/students/${w.student_id}`}
              className="font-semibold text-text-primary hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {w.name}
            </Link>
            <span className="text-text-muted"> {watchReason(w).toLowerCase()}</span>
          </li>
        ))}
      </ul>
      {total > watch.length && (
        <p className="mt-2 text-[12px] text-text-muted">And {total - watch.length} more.</p>
      )}
    </div>
  );
}

function ProblemRow({
  problem: p,
  open,
  onToggle,
  reviewHref,
}: {
  problem: InsightsProblem;
  open: boolean;
  onToggle: () => void;
  reviewHref: (studentId: string, position: number) => string;
}) {
  const reduce = useReducedMotion();
  const graded = p.full + p.partial + p.zero;
  const expandable = p.zero + p.partial > 0;
  const panelId = `insights-problem-${p.bank_item_id}`;

  return (
    <li className="py-4">
      <button
        type="button"
        onClick={onToggle}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? panelId : undefined}
        className="grid w-full grid-cols-[2.25rem_1fr] items-start gap-x-3 gap-y-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 enabled:cursor-pointer sm:grid-cols-[2.25rem_1fr_15rem_9rem]"
      >
        <span className="font-serif text-[20px] leading-none text-text-primary">{p.position}</span>
        <span className="min-w-0 text-sm leading-relaxed text-text-primary">
          <MathText text={p.question} />
        </span>
        <span className="col-start-2 sm:col-start-auto">
          <ResultBar full={p.full} partial={p.partial} zero={p.zero} />
          <span className="mt-1.5 block text-[12px] tabular-nums text-text-muted">
            {graded === 0
              ? "No grades counted"
              : `${p.zero} missed, ${p.partial} partial, ${p.full} got it`}
          </span>
        </span>
        <span className="col-start-2 flex items-center justify-between gap-2 text-[12px] text-text-muted sm:col-start-auto sm:justify-end">
          {p.to_review > 0 && (
            <span
              className="text-text-secondary"
              title="Understanding checks on this problem the AI didn't clear and you haven't reviewed yet"
            >
              {p.to_review} {p.to_review === 1 ? "check" : "checks"} to review
            </span>
          )}
          {expandable && (
            <svg
              aria-hidden
              className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
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
          )}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div
            id={panelId}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="ml-[3rem] mt-4 grid gap-6 sm:grid-cols-2">
              <WhoList title="Missed it" refs={p.students.zero} position={p.position} reviewHref={reviewHref} />
              <WhoList title="Partial credit" refs={p.students.partial} position={p.position} reviewHref={reviewHref} />
            </div>
            <ReasonsLine missed={p.students.zero} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ResultBar({ full, partial, zero }: { full: number; partial: number; zero: number }) {
  const total = full + partial + zero;
  if (total === 0) return <span className="block h-1.5 rounded-full bg-[color:var(--color-surface-alt-2)]" />;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <span
      role="img"
      aria-label={`${zero} missed, ${partial} partial, ${full} got it`}
      className="flex h-1.5 overflow-hidden rounded-full bg-[color:var(--color-surface-alt-2)]"
    >
      <span style={{ width: pct(zero) }} className="bg-[color:var(--color-error)]" />
      <span style={{ width: pct(partial) }} className="bg-[color:var(--color-warning)]" />
      <span style={{ width: pct(full) }} className="bg-[color:var(--color-primary)]" />
    </span>
  );
}

function WhoList({
  title,
  refs,
  position,
  reviewHref,
}: {
  title: string;
  refs: InsightsStudentRef[];
  position: number;
  reviewHref: (studentId: string, position: number) => string;
}) {
  if (refs.length === 0) return null;
  return (
    <div>
      <h4 className="text-[12px] font-semibold text-text-secondary">
        {title} <span className="font-normal tabular-nums text-text-muted">({refs.length})</span>
      </h4>
      <ul className="mt-1.5 space-y-1">
        {refs.map((r) => (
          <li key={r.student_id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-text-primary">
              {r.name}
              {r.diagnosis_kind && DIAGNOSIS_LABEL[r.diagnosis_kind] && (
                <span className="ml-2 text-[12px] text-text-muted">{DIAGNOSIS_LABEL[r.diagnosis_kind]}</span>
              )}
            </span>
            <Link
              href={reviewHref(r.student_id, position)}
              className="shrink-0 text-[12px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              View work
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reasons come from the understanding check and cover only some misses
 *  (never partial credit), so the line always says how many it covers. */
function ReasonsLine({ missed }: { missed: InsightsStudentRef[] }) {
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of missed) {
      const label = r.diagnosis_kind ? DIAGNOSIS_LABEL[r.diagnosis_kind] : undefined;
      if (label) c.set(label, (c.get(label) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [missed]);
  const covered = counts.reduce((n, [, k]) => n + k, 0);
  if (covered === 0) return null;
  return (
    <p className="ml-[3rem] mt-4 text-[12px] text-text-muted">
      Reasons from the understanding check, for {covered} of the {missed.length} who missed it:{" "}
      {counts.map(([label, n]) => `${label.toLowerCase()} ${n}`).join(", ")}.
    </p>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 rounded-[--radius-lg] border border-dashed border-border-light bg-bg-subtle px-6 py-10 text-center">
      <p className="font-serif text-[18px] text-text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-text-muted">{body}</p>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="mt-8" aria-busy="true" aria-live="polite">
      <Skeleton className="h-6 w-3/4 max-w-xl" />
      <Skeleton className="mt-6 h-20 w-full rounded-[--radius-lg]" />
      <Skeleton className="mt-10 h-8 w-64" />
      <ul className="mt-2 divide-y divide-border-light">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 py-4">
            <Skeleton className="h-5 w-6" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-2 w-60 sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}
