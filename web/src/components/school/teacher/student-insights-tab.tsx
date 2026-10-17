"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { TOUR_IDS } from "@/components/tour";
import {
  ApiError,
  EntitlementError,
  teacher,
  type InsightsHomework,
  type InsightsPractice,
  type InsightsProblem,
  type SectionInsightsResponse,
  type TeacherSection,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { Button } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { PageErrorState } from "@/components/ui/page-error-state";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";

/**
 * Student Insights — "which problems should I reteach?"
 *
 * Reads GET /teacher/.../sections/{sid}/insights: whole-class counts
 * from grades the teacher approved or published (an AI draft never
 * counts), one homework at a time. Problems more than half the period
 * got wrong (under 50% credit) lead, already in a practice basket; the
 * rest sit behind "Other problems" and can be added too. The tray at
 * the bottom turns the basket into one practice set per homework per
 * period, or adds to the set that already exists.
 */

/** Versions written per basketed problem — one by default, as in the
 *  Practice tab. Each one waits on the teacher's approval. */
const VERSION_CHOICES = [1, 3, 5] as const;

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
      .catch((e) => {
        if (cancelled) return;
        // The picked homework is gone (unpublished since the list
        // loaded): fall back to the default pick instead of a Retry
        // that would ask for the same missing homework forever.
        if (homeworkId && e instanceof ApiError && e.status === 404) {
          setHomeworkId(undefined);
          return;
        }
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, sectionId, homeworkId, insightsReload]);

  // Resets live in the handlers (not the fetch effect) so the skeleton
  // shows from the click that triggers the reload. Re-picking the current
  // one is a no-op: nothing would change, so the fetch effect wouldn't
  // re-run and the cleared data would leave the skeleton up for good.
  const pickSection = (id: string) => {
    if (id === sectionId) return;
    setError(false);
    setData(null);
    setHomeworkId(undefined);
    setSectionId(id);
  };
  const pickHomework = (id: string) => {
    if (id === (homeworkId ?? data?.selected_homework_id)) return;
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
          Problems most of the class got wrong on each homework, ready to turn
          into practice. Counts only grades you&rsquo;ve approved or published.
        </p>
      </header>

      {sections && sections.length > 1 && (
        <div
          role="group"
          aria-label="Choose a section"
          className="mt-5 flex flex-wrap gap-1.5"
        >
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
        <PageErrorState
          message="Student Insights didn't load."
          onRetry={retry}
        />
      ) : sections && sections.length === 0 ? (
        <Empty
          title="No sections yet"
          body="Create a section and enroll students. Their homework results show up here once you grade."
        />
      ) : !data ? (
        <InsightsSkeleton />
      ) : data.homeworks.length === 0 ? (
        <Empty
          title="No homework yet"
          body={`Publish homework to ${data.section.name}. Results show up here once you approve or publish grades.`}
        />
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
  const hw =
    data.homeworks.find((h) => h.id === data.selected_homework_id) ??
    data.homeworks[0];
  const covered = new Set(data.practice?.covered_item_ids ?? []);
  const flagged = data.problems.filter((p) => p.flagged);
  const others = data.problems.filter((p) => !p.flagged);
  // The basket starts with every flagged problem the practice set
  // doesn't already cover. Body is keyed on section + homework, so a
  // switch starts a fresh basket.
  const [basket, setBasket] = useState<Set<string>>(
    () =>
      new Set(
        flagged
          .filter((p) => !covered.has(p.bank_item_id))
          .map((p) => p.bank_item_id),
      ),
  );
  const [othersOpen, setOthersOpen] = useState(false);
  const toggle = (id: string) =>
    setBasket((b) => {
      const next = new Set(b);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowProps = (p: InsightsProblem) => ({
    problem: p,
    inPractice: covered.has(p.bank_item_id),
    added: basket.has(p.bank_item_id),
    onToggle: () => toggle(p.bank_item_id),
  });
  // Problems in homework order, so the tray reads "Problems 2 and 4".
  const basketed = data.problems.filter((p) => basket.has(p.bank_item_id));

  return (
    <>
      <Lead
        flagged={flagged.length}
        tooFew={data.problems.every((p) => p.counted < data.flag_min_counted)}
        minCounted={data.flag_min_counted}
        homework={hw}
        sectionName={data.section.name}
      />

      <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-border-light pb-3">
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
        <>
          {flagged.length > 0 && (
            <ul className="divide-y divide-border-light">
              {flagged.map((p) => (
                <ProblemRow key={p.bank_item_id} {...rowProps(p)} />
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <div className={flagged.length > 0 ? "mt-6" : "mt-2"}>
              <button
                type="button"
                onClick={() => setOthersOpen((o) => !o)}
                aria-expanded={othersOpen}
                aria-controls="insights-other-problems"
                className="flex items-center gap-2 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Chevron open={othersOpen} />
                {flagged.length > 0 ? "Other problems" : "All problems"} (
                {others.length})
              </button>
              <OtherProblems open={othersOpen}>
                <ul className="divide-y divide-border-light">
                  {others.map((p) => (
                    <ProblemRow key={p.bank_item_id} {...rowProps(p)} quiet />
                  ))}
                </ul>
              </OtherProblems>
            </div>
          )}
        </>
      )}

      {(basketed.length > 0 || data.practice) && (
        <PracticeTray
          courseId={courseId}
          homework={hw}
          sectionId={data.section.id}
          practice={data.practice}
          basketed={basketed}
        />
      )}
    </>
  );
}

/** The one bold element: a sentence that answers "what do I reteach?" */
function Lead({
  flagged,
  tooFew,
  minCounted,
  homework,
  sectionName,
}: {
  flagged: number;
  tooFew: boolean;
  minCounted: number;
  homework: InsightsHomework;
  sectionName: string;
}) {
  if (homework.counted === 0) return null;
  return (
    <p className="mt-8 max-w-2xl font-serif text-[22px] leading-snug text-text-primary">
      {tooFew
        ? `Too few grades counted on ${homework.title} to flag problems yet. It takes ${minCounted}.`
        : flagged === 0
          ? `No problem on ${homework.title} was missed by most of ${sectionName}.`
          : flagged === 1
            ? `Most of ${sectionName} got 1 problem wrong on ${homework.title}.`
            : `Most of ${sectionName} got ${flagged} problems wrong on ${homework.title}.`}
    </p>
  );
}

function coverageSentence(h: InsightsHomework): string {
  const parts = [`Based on ${h.counted} of ${h.students} graded`];
  if (h.to_approve) parts.push(`${h.to_approve} to approve`);
  if (h.to_grade) parts.push(`${h.to_grade} for you to grade`);
  if (h.grading) parts.push(`${h.grading} still grading`);
  if (h.awaiting_student)
    parts.push(
      h.awaiting_student === 1
        ? "1 waiting on the student"
        : `${h.awaiting_student} waiting on students`,
    );
  if (h.not_submitted) parts.push(`${h.not_submitted} not turned in`);
  return parts.join(", ") + ".";
}

function ProblemRow({
  problem: p,
  inPractice,
  added,
  onToggle,
  quiet = false,
}: {
  problem: InsightsProblem;
  inPractice: boolean;
  added: boolean;
  onToggle: () => void;
  quiet?: boolean;
}) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr] items-start gap-x-3 gap-y-2 py-4 sm:grid-cols-[2.25rem_1fr_13rem_8.5rem]">
      <span
        className={`font-serif text-[20px] leading-none ${quiet ? "text-text-muted" : "text-text-primary"}`}
      >
        {p.position}
      </span>
      <span
        className={`min-w-0 text-sm leading-relaxed ${quiet ? "text-text-secondary" : "text-text-primary"}`}
      >
        <MathText text={p.question} />
      </span>
      <span className="col-start-2 sm:col-start-auto">
        <WrongBar wrong={p.wrong} counted={p.counted} />
        <span className="mt-1.5 block text-[12px] tabular-nums text-text-muted">
          {p.counted === 0
            ? "No grades counted"
            : `${p.wrong} of ${p.counted} got it wrong`}
        </span>
      </span>
      <span className="col-start-2 sm:col-start-auto sm:justify-self-end">
        {inPractice ? (
          <span className="text-[12px] font-medium text-text-muted">
            In practice set
          </span>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={added}
            className={`rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              added
                ? "border-primary bg-primary/10 text-primary"
                : "border-border-light text-text-secondary hover:border-primary/40 hover:text-primary"
            }`}
          >
            {added ? "Added to practice" : "Add to practice"}
          </button>
        )}
      </span>
    </li>
  );
}

/** How much of the class got it wrong — red share against the rest. */
function WrongBar({ wrong, counted }: { wrong: number; counted: number }) {
  if (counted === 0)
    return (
      <span className="block h-1.5 rounded-full bg-[color:var(--color-surface-alt-2)]" />
    );
  return (
    <span
      role="img"
      aria-label={`${wrong} of ${counted} got it wrong`}
      className="flex h-1.5 overflow-hidden rounded-full bg-[color:var(--color-surface-alt-2)]"
    >
      <span
        style={{ width: `${(wrong / counted) * 100}%` }}
        className="bg-[color:var(--color-error)]"
      />
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
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
  );
}

function OtherProblems({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id="insights-other-problems"
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function problemList(problems: InsightsProblem[]): string {
  const nums = problems.map((p) => p.position);
  const label = nums.length === 1 ? "Problem" : "Problems";
  if (nums.length <= 2) return `${label} ${nums.join(" and ")}`;
  return `${label} ${nums.slice(0, -1).join(", ")} and ${nums.at(-1)}`;
}

function practiceStatus(p: InsightsPractice): string {
  const parts = [p.status === "published" ? "Live for students" : "Draft"];
  if (p.approved) parts.push(`${p.approved} approved`);
  if (p.to_review) parts.push(`${p.to_review} to review`);
  if (p.writing)
    parts.push(
      p.writing === 1 ? "writing 1 problem" : `writing ${p.writing} problems`,
    );
  if (p.failed)
    parts.push(
      p.failed === 1
        ? "couldn't write 1 problem"
        : `couldn't write ${p.failed} problems`,
    );
  return parts.join(", ");
}

/**
 * Sticky at the bottom of the tab. With a basket and no set: create one.
 * With a set: its status and a link, plus "add" when the basket has more.
 * Either action opens the set's page, whose hero covers the wait while
 * versions are written and links on to approving them.
 */
function PracticeTray({
  courseId,
  homework,
  sectionId,
  practice,
  basketed,
}: {
  courseId: string;
  homework: InsightsHomework;
  sectionId: string;
  practice: InsightsPractice | null;
  basketed: InsightsProblem[];
}) {
  const router = useRouter();
  const [versions, setVersions] = useState<number>(VERSION_CHOICES[0]);
  const { busy, error, run } = useAsyncAction();
  const { showUpgrade, UpgradeModal } = useUpgradePrompt();
  const setHref = (id: string) =>
    `/school/teacher/courses/${courseId}/homework/${id}`;

  const submit = () =>
    run(async () => {
      const body = {
        item_ids: basketed.map((p) => p.bank_item_id),
        count: versions,
      };
      try {
        const res = practice
          ? await teacher.addPracticeProblems(courseId, practice.id, body)
          : await teacher.cloneHomeworkAsPractice(courseId, homework.id, {
              ...body,
              section_ids: [sectionId],
            });
        // The set's page reads these to show the writing progress.
        sessionStorage.setItem(`hw-gen-${res.id}`, JSON.stringify(res.job_ids));
        router.push(setHref(res.id));
      } catch (e) {
        if (e instanceof EntitlementError && e.isLimit) {
          showUpgrade(e.entitlement, e.message);
          return;
        }
        throw e;
      }
    }, "Couldn't start the practice set. Try again.");

  // Sticks above the phone's fixed bottom nav (h-16); flush on desktop.
  return (
    <div className="sticky bottom-16 z-10 -mx-1 mt-8 pb-3 md:bottom-0">
      <div
        role="region"
        aria-label="Practice set"
        className="rounded-[--radius-lg] border border-border-light bg-surface px-4 py-3 shadow-[0_-1px_0_var(--color-border-light),0_8px_24px_-12px_rgba(20,30,25,0.25)] sm:px-5"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="min-w-0 flex-1 text-sm">
            {practice && (
              <p className="text-text-primary">
                <Link
                  href={setHref(practice.id)}
                  className="font-semibold hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {practice.title}
                </Link>
                <span className="text-text-muted">
                  : {practiceStatus(practice)}
                </span>
              </p>
            )}
            {basketed.length > 0 && (
              <p
                className={
                  practice
                    ? "mt-0.5 text-text-secondary"
                    : "font-semibold text-text-primary"
                }
              >
                {practice ? "Add " : "Practice on "}
                {problemList(basketed)}
              </p>
            )}
          </div>
          {basketed.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Versions of each problem"
                className="flex items-center gap-1.5"
              >
                <span className="whitespace-nowrap text-[12px] text-text-muted">
                  Versions of each
                </span>
                {VERSION_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={versions === n}
                    onClick={() => setVersions(n)}
                    className={`h-7 w-7 rounded-[--radius-pill] border text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      versions === n
                        ? "border-primary bg-primary text-white"
                        : "border-border-light text-text-secondary hover:border-primary/40"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                loading={busy}
                onClick={submit}
                className="whitespace-nowrap"
              >
                {practice ? "Add to set" : "Create practice set"}
              </Button>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-[12px] text-error">
            {error}
          </p>
        )}
      </div>
      {UpgradeModal}
    </div>
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
      <Skeleton className="mt-6 h-8 w-64" />
      <ul className="mt-2 divide-y divide-border-light">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 py-4">
            <Skeleton className="h-5 w-6" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-2 w-52 sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}
