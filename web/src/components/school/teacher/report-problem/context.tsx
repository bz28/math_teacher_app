"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ReportProblemDialog } from "./dialog";

/** Snapshot of the AI's call at the moment the teacher reported it —
 *  what's on screen can be regraded later, so the report carries its
 *  own copy instead of a pointer. */
export interface ReportedAiGrade {
  score_status: string;
  percent: number;
  confidence: number | null;
  reasoning: string;
}

export interface ReportedTeacherGrade {
  score_status: string | null;
  percent: number | null;
}

/**
 * What the teacher was looking at when they hit "Report a problem".
 * Every field is optional so the same dialog serves a per-problem AI
 * verdict, a whole submission, and the global sidebar fallback — the
 * mount point passes whatever it has and the report arrives with that
 * evidence attached. `labels` are the chips shown in the dialog so the
 * teacher sees what's being attached without a wall of ids.
 */
export interface ReportProblemContext {
  submission_id?: string;
  assignment_id?: string;
  course_id?: string;
  section_id?: string;
  student_id?: string;
  problem_id?: string;
  problem_position?: number;
  ai_grade?: ReportedAiGrade | null;
  teacher_grade?: ReportedTeacherGrade | null;
  labels?: string[];
  /** Set only when the sidebar report opens while a page has a
   *  submission open: the problems the teacher may point it at. The
   *  dialog then offers an optional problem picker and lets her detach
   *  the submission for a report that isn't about it. */
  problem_options?: ReportProblemOption[];
}

/** One problem the sidebar report can point at — the same fields the
 *  per-problem report buttons attach. */
export interface ReportProblemOption {
  problem_id: string;
  problem_position: number;
  /** "Problem 3 · Prove m∠1 = m∠3…" — the picker's text. */
  title: string;
  ai_grade: ReportedAiGrade | null;
  teacher_grade: ReportedTeacherGrade | null;
  labels: string[];
}

interface ReportProblemApi {
  /** Open the dialog for the given context. */
  openReport: (ctx: ReportProblemContext) => void;
  /** Keys of things already reported this session — mount points swap
   *  their trigger for a "Reported" state so the teacher knows it landed.
   *  Keyed by `reportKey(ctx)`. */
  reported: ReadonlySet<string>;
  /** What the current page has open, for the sidebar report. Read at
   *  click time; setting it never re-renders anything. */
  pageContext: () => ReportProblemContext | null;
  setPageContext: (ctx: ReportProblemContext | null) => void;
}

const Ctx = createContext<ReportProblemApi | null>(null);

/** Stable identity for "this exact thing was reported" — a problem on a
 *  submission, a whole submission, or the page. */
export function reportKey(ctx: ReportProblemContext): string {
  return [ctx.submission_id ?? "-", ctx.problem_id ?? "-"].join(":");
}

export function ReportProblemProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ReportProblemContext | null>(null);
  const [reported, setReported] = useState<Set<string>>(() => new Set());
  const pageRef = useRef<ReportProblemContext | null>(null);
  const pageContext = useCallback(() => pageRef.current, []);
  const setPageContext = useCallback((ctx: ReportProblemContext | null) => {
    pageRef.current = ctx;
  }, []);

  const openReport = useCallback((ctx: ReportProblemContext) => setActive(ctx), []);
  const close = useCallback(() => setActive(null), []);
  const markReported = useCallback((ctx: ReportProblemContext) => {
    setReported((prev) => new Set(prev).add(reportKey(ctx)));
  }, []);

  const value = useMemo(
    () => ({ openReport, reported, pageContext, setPageContext }),
    [openReport, reported, pageContext, setPageContext],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {active && (
        <ReportProblemDialog context={active} onClose={close} onSent={markReported} />
      )}
    </Ctx.Provider>
  );
}

export function useReportProblem(): ReportProblemApi {
  const api = useContext(Ctx);
  if (!api) {
    throw new Error("useReportProblem must be used inside <ReportProblemProvider>");
  }
  return api;
}

/**
 * Tell the sidebar "Report a problem" what this page has open, so a
 * report sent from there arrives with the student attached instead of
 * just a URL. Pass null when nothing is open. Cleared on unmount, so
 * leaving the page (or the student) never leaves a stale attachment.
 */
export function useReportPageContext(ctx: ReportProblemContext | null): void {
  const { setPageContext } = useReportProblem();
  useEffect(() => {
    setPageContext(ctx);
    return () => setPageContext(null);
  }, [ctx, setPageContext]);
}
