"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  schoolStudent,
  type StudentPracticeDetail,
  type StudentPracticeProblem,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { SkeletonStep } from "@/components/ui/skeleton";
import { isLearnable, isMCQ } from "./_components/practice-shared";
import { PracticeRunner } from "./_components/practice-runner";
import { LearnRunner } from "./_components/learn-runner";

/**
 * Student practice detail — a single-surface, ungraded, stateless
 * experience built on the teacher-authored bank items
 * (schoolStudent.practiceDetail). No LLM problem generation: the
 * problems ARE the bank items. A preview screen pivots into two modes —
 * Practice (one-at-a-time MCQ, retry-once-then-reveal, scored
 * locally) and Learn (paced worked steps with a tutor chat) — and each
 * ends with a celebration that pivots into the other.
 *
 * Nothing here is reported to the teacher.
 */

type View = "preview" | "practice" | "learn";

export default function PracticeDetailPage() {
  const { courseId, assignmentId } = useParams<{
    courseId: string;
    assignmentId: string;
  }>();
  const [detail, setDetail] = useState<StudentPracticeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("preview");

  useEffect(() => {
    if (!assignmentId) return;
    schoolStudent
      .practiceDetail(assignmentId)
      .then(setDetail)
      .catch(() => setError("Couldn't load this practice set. Please try again."));
  }, [assignmentId]);

  const problems = useMemo(() => detail?.problems ?? [], [detail]);
  const mcqProblems = useMemo(() => problems.filter(isMCQ), [problems]);
  const learnProblems = useMemo(() => problems.filter(isLearnable), [problems]);

  const backHref = `/school/student/courses/${courseId}?tab=practice`;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-4">
        <SkeletonStep />
        <SkeletonStep />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-primary"
      >
        &larr; Back to practice
      </Link>

      <div className="mt-5">
        {view === "preview" && (
          <Preview
            detail={detail}
            mcqCount={mcqProblems.length}
            learnCount={learnProblems.length}
            onPractice={() => setView("practice")}
            onLearn={() => setView("learn")}
          />
        )}

        {view === "practice" && mcqProblems.length > 0 && (
          <PracticeRunner
            key="practice"
            problems={mcqProblems}
            canLearn={learnProblems.length > 0}
            onLearn={() => setView("learn")}
            onExit={() => setView("preview")}
          />
        )}

        {view === "learn" && learnProblems.length > 0 && (
          <LearnRunner
            key="learn"
            problems={learnProblems}
            canPractice={mcqProblems.length > 0}
            onPractice={() => setView("practice")}
            onExit={() => setView("preview")}
          />
        )}
      </div>
    </div>
  );
}

// ── Preview ──

function Preview({
  detail,
  mcqCount,
  learnCount,
  onPractice,
  onLearn,
}: {
  detail: StudentPracticeDetail;
  mcqCount: number;
  learnCount: number;
  onPractice: () => void;
  onLearn: () => void;
}) {
  const count = detail.problems.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <header>
        <p className="eyebrow">Practice · Ungraded</p>
        <h1 className="mt-2 font-serif text-[2.5rem] leading-[1.05] text-text-primary">
          {detail.title}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {count} {count === 1 ? "problem" : "problems"} · Nothing here is sent
          to your teacher
        </p>
        {detail.source_homework_title && (
          <p className="mt-1 text-xs text-text-muted">
            Cloned from{" "}
            <span className="font-medium text-text-secondary">
              {detail.source_homework_title}
            </span>
          </p>
        )}
      </header>

      {count === 0 ? (
        <div className="rounded-[--radius-lg] border border-dashed border-border bg-surface-alt px-6 py-12 text-center">
          <p className="font-serif text-xl text-text-primary">
            Still being prepared
          </p>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-text-muted">
            Your teacher is generating the problems for this set. Check back in
            a minute.
          </p>
        </div>
      ) : (
        <>
          {/* Mode picker */}
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              kind="practice"
              title="Practice"
              description="Answer one at a time. We keep score — and let you try again before showing the answer."
              meta={`${mcqCount} ${mcqCount === 1 ? "question" : "questions"}`}
              disabled={mcqCount === 0}
              disabledHint="No multiple-choice questions are ready yet."
              onClick={onPractice}
            />
            <ModeCard
              kind="learn"
              title="Learn"
              description="Walk the worked solution one step at a time, and ask the tutor anything along the way."
              meta={`${learnCount} ${learnCount === 1 ? "walkthrough" : "walkthroughs"}`}
              disabled={learnCount === 0}
              disabledHint="No worked solutions are ready yet."
              onClick={onLearn}
            />
          </div>

          {/* Problem preview list */}
          <div>
            <p className="eyebrow mb-3">In this set</p>
            <ul className="space-y-2">
              {detail.problems.map((p, i) => (
                <ProblemPreviewRow key={p.bank_item_id} position={i + 1} problem={p} />
              ))}
            </ul>
          </div>
        </>
      )}
    </motion.div>
  );
}

function ModeCard({
  kind,
  title,
  description,
  meta,
  disabled,
  disabledHint,
  onClick,
}: {
  kind: "practice" | "learn";
  title: string;
  description: string;
  meta: string;
  disabled: boolean;
  disabledHint: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      title={disabled ? disabledHint : undefined}
      className={[
        "group flex flex-col rounded-[--radius-lg] border bg-surface p-5 text-left transition-colors",
        disabled
          ? "cursor-not-allowed border-border-light opacity-55"
          : "border-border hover:border-primary",
      ].join(" ")}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
        {kind === "practice" ? <TargetIcon /> : <BookIcon />}
      </span>
      <span className="mt-4 font-serif text-xl text-text-primary">{title}</span>
      <span className="mt-1 flex-1 text-sm leading-relaxed text-text-secondary">
        {description}
      </span>
      <span className="mt-4 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
        {meta}
        {!disabled && (
          <span className="text-primary transition-transform group-hover:translate-x-0.5">
            &rarr;
          </span>
        )}
      </span>
    </motion.button>
  );
}

function ProblemPreviewRow({
  position,
  problem,
}: {
  position: number;
  problem: StudentPracticeProblem;
}) {
  return (
    <li className="flex items-start gap-3 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3">
      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
        {position}
      </span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-medium text-text-primary">
          <MathText text={problem.question} />
        </div>
        {problem.figure_svg && (
          <span className="mt-1 inline-block text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted">
            Includes a figure
          </span>
        )}
      </div>
    </li>
  );
}

function TargetIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 5a2 2 0 012-2h11a1 1 0 011 1v14a1 1 0 01-1 1H6a2 2 0 01-2-2z" />
      <path d="M4 17a2 2 0 012-2h12" />
    </svg>
  );
}
