"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
}

interface ReportProblemApi {
  /** Open the dialog for the given context. */
  openReport: (ctx: ReportProblemContext) => void;
  /** Keys of things already reported this session — mount points swap
   *  their trigger for a "Reported" state so the teacher knows it landed.
   *  Keyed by `reportKey(ctx)`. */
  reported: ReadonlySet<string>;
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

  const openReport = useCallback((ctx: ReportProblemContext) => setActive(ctx), []);
  const close = useCallback(() => setActive(null), []);
  const markReported = useCallback((ctx: ReportProblemContext) => {
    setReported((prev) => new Set(prev).add(reportKey(ctx)));
  }, []);

  const value = useMemo(() => ({ openReport, reported }), [openReport, reported]);

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
