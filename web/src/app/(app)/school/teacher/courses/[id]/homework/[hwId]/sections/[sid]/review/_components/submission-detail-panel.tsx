import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { READING_TRUST_COPY, needsReadingCheck } from "@/components/school/teacher/reading-trust";
import {
  useReportPageContext,
  type ReportProblemContext,
} from "@/components/school/teacher/report-problem";
import { MathText } from "@/components/shared/math-text";
import { WorkGalleryModal } from "@/components/school/teacher/_pieces/work-gallery";
import {
  teacher,
  type AiGradeEntry,
  type GradeBreakdownEntry,
  type IntegrityResolutionOutcome,
  type SubmissionAttempt,
  type SubmissionFile,
  type TeacherIntegrityDetail,
  type TeacherRubric,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";
import { openGraphItems } from "@/components/school/teacher/_pieces/graph-check-review";
import { rubricChanged, rubricFields } from "@/lib/rubric";
import { PHOTO_URLS_EXPIRED } from "@/lib/submission-photos";
import { earnedPoints, formatPoints } from "@/lib/points";
import type { GradeStatus, RosterEntry } from "../_lib/types";
import { isTypingTarget, isDialogOpen, isActionableTarget } from "../_lib/focus";
import { approvesOnKey } from "../_lib/next-student";
import {
  EMPTY_ID_SET,
  isConfidentAi,
  aiConfirmKey,
  teacherOverrodeAi,
  withGraphCalls,
  aiSkipReason,
  AI_SKIP_COPY,
  chipGradeLabel,
  canAiGrade,
  lateLabel,
  formatPercent,
} from "../_lib/grading";
import { KeyboardShortcutsModal } from "./reference-modals";
import { ProblemGradeRow } from "./problem-grade-row";
import { OtherWorkDisclosure } from "./student-work";
import { IntegrityCard } from "./integrity-card";
import { StudentWorkThumbButton } from "./pinned-work";
import { ReviewActions } from "./review-actions";

/**
 * The late policy's cut on this turn-in, as its own line under the
 * score: how late, the percent of the score the policy takes, the score
 * before and after it, and the control to waive it for this student. Never folded silently
 * into the number — she approves the score with the cut in view.
 */
function LatePenaltyLine({
  detail,
  busy,
  onWaivedChange,
}: {
  detail: TeacherSubmissionDetail;
  busy: boolean;
  onWaivedChange: (waived: boolean) => void;
}) {
  const waived = detail.late_penalty_waived;
  const before =
    detail.final_score !== null ? detail.final_score + detail.late_penalty : null;
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
      <span
        className={
          waived
            ? "text-text-muted line-through decoration-text-muted/60"
            : "font-semibold text-[color:var(--color-warning-dark)]"
        }
      >
        {lateLabel(detail.days_late).replace(/^./, (c) => c.toUpperCase())}: −
        {formatPercent(detail.late_penalty_percent)}% of the score
      </span>
      {waived ? (
        <span className="text-text-muted">Waived for this student</span>
      ) : before !== null ? (
        <span className="text-text-muted">
          {formatPercent(before)}% before the penalty →{" "}
          <span className="font-semibold text-text-primary">
            {formatPercent(detail.final_score!)}%
          </span>
        </span>
      ) : (
        <span className="text-text-muted">Comes off the score once it&rsquo;s graded</span>
      )}
      <button
        type="button"
        onClick={() => onWaivedChange(!waived)}
        disabled={busy}
        className="rounded-[--radius-sm] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
      >
        {busy ? "Saving…" : waived ? "Restore penalty" : "Waive penalty"}
      </button>
    </div>
  );
}

export function SubmissionDetailPanel({
  detail,
  integrity,
  rubric,
  rubricOpen,
  onToggleRubric,
  row,
  saveError,
  nextStudent,
  onSelectNext,
  toReleaseTotal,
  onPublish,
  onPublishStudent,
  publishingStudent,
  onGradeProblem,
  onFeedbackChange,
  onIntegrityResolved,
  integrityDetailsOpen,
  onToggleIntegrityDetails,
  onMarkReviewed,
  onApproveAndNext,
  onUnmarkReviewed,
  onGraphVerdict,
  graphBusy,
  onLatePenaltyWaivedChange,
  waivingLate,
  reopen,
  marking,
  savingGrade,
  regrading,
  regradeError,
  onRegradeRequest,
  onRequiresDrawingChange,
  aiGrading,
  aiGradingUnwatched,
  aiGradeError,
  onGradeWithAi,
  confirmedIds,
  onConfirmProblems,
  announceGrade,
  announce,
  reportBase,
  focusProblem,
  onProblemFocused,
}: {
  detail: TeacherSubmissionDetail;
  /** Position a ?problem= deep link asked for: opened, focused and
   *  scrolled to once, on mount. */
  focusProblem: number | null;
  /** Called once that's done, so a later remount doesn't jump again. */
  onProblemFocused: () => void;
  integrity: TeacherIntegrityDetail | null;
  /** Ids identifying this submission for "Report a problem" — the panel
   *  and each grade row extend it with what they're pointing at. */
  reportBase: ReportProblemContext;
  rubric: TeacherRubric | null;
  rubricOpen: boolean;
  onToggleRubric: (open: boolean) => void;
  row: TeacherSubmissionRow | null;
  saveError: string | null;
  nextStudent: RosterEntry | null;
  onSelectNext: () => void;
  // Grades still awaiting release across the whole HW (pending + dirty).
  // Drives the end-of-stack publish CTA below.
  toReleaseTotal: number;
  onPublish: () => void;
  /** Publish just this student's approved grade; null when there's
   *  nothing of theirs to release. */
  onPublishStudent: { run: () => void; update: boolean; failed: boolean } | null;
  publishingStudent: boolean;
  onGradeProblem: (problemId: string, status: GradeStatus, partialPercent?: number) => void;
  onFeedbackChange: (problemId: string, text: string) => void;
  onIntegrityResolved: (
    submissionId: string,
    resolution: IntegrityResolutionOutcome,
  ) => void;
  /** Session-level open/closed for the integrity card's Details. */
  integrityDetailsOpen: boolean;
  onToggleIntegrityDetails: () => void;
  onMarkReviewed: () => void;
  /** Approve, then open the next student still waiting on her Approve.
   *  Null when nobody else is — Approve then stays put. */
  onApproveAndNext: (() => void) | null;
  onUnmarkReviewed: () => void;
  /** The teacher's ✓ / ✗ on an unclear graph checklist item. */
  onGraphVerdict: (problemId: string, n: number, verdict: "yes" | "no") => void;
  /** The graph item whose call is saving, if any. */
  /** Graph items with a call queued or saving, as `${problemId}:${n}`. */
  graphBusy: ReadonlySet<string>;
  /** Waive (true) or restore (false) this turn-in's late penalty. */
  onLatePenaltyWaivedChange: (waived: boolean) => void;
  waivingLate: boolean;
  /** The reopen control for this student; null on her own rehearsal. */
  reopen: React.ReactNode;
  marking: boolean;
  savingGrade: boolean;
  regrading: boolean;
  regradeError: string | null;
  onRegradeRequest: () => void;
  onRequiresDrawingChange: (bankItemId: string, next: boolean) => Promise<void>;
  /** Sent to the AI grader and the grade hasn't landed yet. */
  aiGrading: boolean;
  /** Still running on the server after the page stopped polling. */
  aiGradingUnwatched: boolean;
  aiGradeError: string | null;
  /** "Grade with AI" — only offered when the server says the AI can
   *  take this submission (`ai_grade_block` null). */
  onGradeWithAi: () => void;
  /** Bank-item ids the teacher has ticked on THIS submission. Owned by
   *  the page so it survives this panel being remounted on a switch. */
  confirmedIds: ReadonlySet<string>;
  onConfirmProblems: (submissionId: string, bankItemIds: string[]) => void;
  /** Announce a grade action on the page's live region. Owned by the
   *  page because this panel unmounts during a post-save refetch, and a
   *  live region that is destroyed and recreated announces nothing. */
  announceGrade: (position: number, label: string) => void;
  /** Announce something that isn't about one problem — the bulk confirm.
   *  Same region, same repeat handling. */
  announce: (message: string) => void;
}) {
  const breakdownByProblem = useMemo(() => {
    const map = new Map<string, GradeBreakdownEntry>();
    for (const b of detail.breakdown ?? []) map.set(b.problem_id, b);
    return map;
  }, [detail.breakdown]);
  // The class rules this grade was made under, by id — names the rule a
  // deduction applied.
  const snapshotRules = row?.rubric_snapshot?.rules;
  const ruleText = useMemo(
    () => Object.fromEntries((snapshotRules ?? []).map((r) => [r.id, r.text])),
    [snapshotRules],
  );
  // AI grades keyed by position → problem. Used to show "AI" badges
  // and reasoning tooltips on grades the AI pre-filled.
  const aiByPosition = useMemo(() => {
    const map = new Map<number, AiGradeEntry>();
    for (const a of detail.ai_breakdown ?? []) map.set(a.problem_position, a);
    return map;
  }, [detail.ai_breakdown]);
  const gradedCount = breakdownByProblem.size;
  const totalProblems = detail.problems.length;
  const published = !!row?.grade_published_at;

  // The sidebar "Report a problem" reports on this student while they're
  // open, with each problem offered in its picker — so a report sent from
  // there arrives with the work attached, not just a URL.
  const { submission_id, assignment_id, course_id, section_id, student_id } = reportBase;
  const sidebarReport = useMemo<ReportProblemContext>(
    () => ({
      submission_id,
      assignment_id,
      course_id,
      section_id,
      student_id,
      labels: [detail.student_name, detail.assignment_title],
      problem_options: detail.problems.map((p) => {
        const ai = aiByPosition.get(p.position) ?? null;
        const entry = breakdownByProblem.get(p.bank_item_id) ?? null;
        const question = p.question.replace(/\$/g, "").replace(/\s+/g, " ").trim();
        return {
          problem_id: p.bank_item_id,
          problem_position: p.position,
          title: `Problem ${p.position} · ${question.length > 60 ? `${question.slice(0, 57)}…` : question}`,
          ai_grade: ai && {
            score_status: ai.score_status,
            percent: ai.percent,
            confidence: ai.confidence,
            reasoning: ai.reasoning ?? "",
          },
          teacher_grade: entry && {
            score_status: entry.score_status,
            percent: entry.percent,
          },
          labels: [
            `Problem ${p.position}`,
            ...(ai ? [`AI: ${chipGradeLabel(ai.score_status, ai.percent)}`] : []),
            ...(entry ? [`Your grade: ${chipGradeLabel(entry.score_status, entry.percent)}`] : []),
          ],
        };
      }),
    }),
    [submission_id, assignment_id, course_id, section_id, student_id, detail, aiByPosition, breakdownByProblem],
  );
  useReportPageContext(sidebarReport);
  // The AI skipped it (unreadable photo, or too long), not yet hand-
  // graded — surface the callout that explains why there's no AI
  // suggestion. Drops away once the teacher has put a grade on it
  // (final_score set).
  const aiSkip = aiSkipReason(
    detail.ai_grading_status,
    row?.ai_grade_block,
    detail.final_score,
  );
  const offerAiGrade = !!row && canAiGrade(row) && !aiGrading;

  // ── Triage: collapse the confident grades, keep the uncertain open ──
  //
  // Per-problem metadata that drives the collapsed/expanded split. A
  // problem the AI is confident about (high band, not overridden)
  // COLLAPSES to a one-line confirm row; uncertain ones stay fully
  // expanded with the answer/key, work, receipt, and grade buttons.
  // Nothing is auto-confirmed — `confirmedIds` is a checklist the teacher
  // fills by pressing the AI's key (or the Confirm chip). It's a
  // grading-workflow aid (collapse/expand the confident rows), NOT the
  // review stamp: the durable, server-side trust signal is `reviewed_at`
  // (the explicit Approve on an AI grade; self-stamped on a complete hand
  // grade).
  //
  // It lives on the PAGE, not here, because this panel is remounted on
  // every student switch — and switching students is the page's primary
  // action. Owning it here meant leaving a student to check something and
  // coming back to find every tick gone, including a "Confirm all N" the
  // teacher had just clicked. Session-scoped: a reload still clears it,
  // which is honest, since nothing about it is persisted server-side.
  //
  // Expansion deliberately does NOT get the same treatment. Reopening a
  // confident row is one click and costs nothing to redo, and coming back
  // to a student with the rows collapsed again is arguably the right
  // default — a fresh look. Confirmations represent work done; expansions
  // don't.
  // A ?problem= deep link lands on its row, so that row starts open even
  // when the AI was confident enough to collapse it.
  // Mount-time only: the deep link is consumed once it has been applied.
  const [focusIndex] = useState(() =>
    focusProblem === null
      ? -1
      : detail.problems.findIndex((p) => p.position === focusProblem),
  );
  const [expandState, setExpandState] = useState<{ sid: string; ids: Set<string> }>(
    () => ({
      sid: detail.submission_id,
      ids: new Set(focusIndex >= 0 ? [detail.problems[focusIndex].bank_item_id] : []),
    }),
  );
  const manuallyExpandedIds =
    expandState.sid === detail.submission_id ? expandState.ids : EMPTY_ID_SET;

  const problemMeta = useMemo(
    () =>
      detail.problems.map((p) => {
        const ai = withGraphCalls(aiByPosition.get(p.position) ?? null, p.graph);
        const entry = breakdownByProblem.get(p.bank_item_id) ?? null;
        const overridden = teacherOverrodeAi(entry, ai);
        // Confident = high-band AI grade that the teacher hasn't moved.
        // A graph item the check couldn't decide is never folded away —
        // not while it waits on her, nor the moment she decides it.
        const confident =
          isConfidentAi(ai) &&
          !overridden &&
          entry !== null &&
          !p.graph?.items.some((it) => it.verdict === "unclear");
        const collapsed = confident && !manuallyExpandedIds.has(p.bank_item_id);
        return {
          id: p.bank_item_id,
          ai,
          confident,
          collapsed,
          confirmed: confirmedIds.has(p.bank_item_id),
          confirmKey: aiConfirmKey(ai),
        };
      }),
    [
      detail.problems,
      aiByPosition,
      breakdownByProblem,
      manuallyExpandedIds,
      confirmedIds,
    ],
  );
  const confidentCount = problemMeta.filter((m) => m.confident).length;
  const uncertainCount = totalProblems - confidentCount;
  // Confident rows still collapsed AND not yet confirmed — the target of
  // the bulk "Confirm all" action and its count.
  const pendingConfirmIds = problemMeta
    .filter((m) => m.collapsed && !m.confirmed)
    .map((m) => m.id);

  const confirmProblems = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      // Confirming is the teacher vouching for the AI's grade. The grade
      // itself is already persisted (the AI wrote breakdown + final_score),
      // so confirming only records the checklist — it never re-saves or
      // mutates a grade, and it does NOT stamp the submission reviewed.
      // Approval is an explicit, deliberate act (the Approve button
      // below), never a side effect of confirming or finishing.
      onConfirmProblems(detail.submission_id, ids);
    },
    [detail.submission_id, onConfirmProblems],
  );

  // ── Explicit approval gate ────────────────────────────────────────
  //
  // Approval (stamping reviewed_at) is a deliberate teacher action, not
  // an automatic side effect of grading. The "Approve" button is enabled
  // only once EVERY problem on the submission carries a grade — you can't
  // vouch for a half-graded submission. We check per-problem coverage
  // (each current problem has a breakdown entry) rather than a raw count,
  // so a stale/extra breakdown row can't let the count match while a real
  // problem is still ungraded. It's server-backed and live via optimistic
  // grade saves, so the gate survives a reload — unlike the old
  // session-only "addressed" tracking. A confident AI submission arrives
  // fully graded, so Approve is immediately available; the teacher still
  // chooses to click it, which IS the vouch.
  const gradedProblemCount = detail.problems.filter((p) =>
    breakdownByProblem.has(p.bank_item_id),
  ).length;
  const allGraded =
    totalProblems > 0 && gradedProblemCount === totalProblems;
  // No AI grade ever landed (unreadable photo, AI grading off, or the
  // teacher got there first) — every score is the teacher's own typing.
  // There's no AI number to vouch for, so these never show an Approve
  // button: the server stamps reviewed_at itself on the save that
  // grades the last problem. `approved` anticipates that stamp so the
  // pill doesn't flash "n/n graded" for the round trip.
  const handGraded = (detail.ai_breakdown?.length ?? 0) === 0;
  const approved = !!detail.reviewed_at || (handGraded && allGraded);
  // Graph checklist items the drawing check couldn't decide. Their
  // points are kept until she calls each one; Approve waits on them.
  const graphItemsOpen = openGraphItems(detail.problems);
  const graphGate =
    graphItemsOpen > 0
      ? `Check ${graphItemsOpen === 1 ? "1 graph item" : `${graphItemsOpen} graph items`} first`
      : null;
  // Mirrors the Approve button's enabled state, so A does exactly what a
  // click would and nothing when the button is disabled or hidden.
  const canApprove =
    !handGraded &&
    !approved &&
    allGraded &&
    graphGate === null &&
    !marking &&
    !savingGrade &&
    !regrading;
  const approve = onApproveAndNext ?? onMarkReviewed;
  const toggleExpand = useCallback(
    (id: string) => {
      setExpandState((s) => {
        const base =
          s.sid === detail.submission_id ? new Set(s.ids) : new Set<string>();
        if (base.has(id)) base.delete(id);
        else base.add(id);
        return { sid: detail.submission_id, ids: base };
      });
    },
    [detail.submission_id],
  );

  // ── Keyboard grading ──────────────────────────────────────────────
  //
  // The single biggest speed multiplier for grinding through a stack of
  // papers: 1/2/3 grade the *focused* problem (driving the same
  // setProblemGrade the buttons call), then advance to the next
  // ungraded one so a teacher can rip 1,1,2,1,3 straight down. j/k (or
  // ↑/↓) move focus; Enter/→ jumps to the next student. The focus model
  // is keyboard-real — each row is a tabIndex=-1 div that we actually
  // `.focus()`, so screen readers track it and Tab order stays sane.
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  // Page the work gallery is open on, or null when closed. Lives here
  // rather than in each row so every page marker opens the ONE gallery —
  // the same one the header strip and pinned rail use — instead of each
  // row growing its own modal.
  const [galleryPage, setGalleryPage] = useState<number | null>(null);
  // The photos of an earlier turn-in (a retake's original, or the one a
  // reopen replaced), opened from its callout. Fetched on first open
  // (not with the detail, which reloads often) and kept per attempt so
  // opening it again is instant.
  const [originalPage, setOriginalPage] = useState<number | null>(null);
  const [originals, setOriginals] = useState<
    { key: string; files: SubmissionFile[] } | null
  >(null);
  const [originalsState, setOriginalsState] = useState<
    { key: string; status: "loading" | "error" } | null
  >(null);
  const openOriginals = useCallback(async (attemptNumber: number) => {
    const sid = detail.submission_id;
    const key = `${sid}:${attemptNumber}`;
    if (originals?.key === key) {
      setOriginalPage(0);
      return;
    }
    setOriginalsState({ key, status: "loading" });
    try {
      const { files } = await teacher.attemptFiles(sid, attemptNumber);
      setOriginals({ key, files });
      setOriginalsState(null);
      setOriginalPage(0);
    } catch {
      setOriginalsState({ key, status: "error" });
    }
  }, [detail.submission_id, originals]);
  const attemptState = useCallback(
    (n: number) =>
      originalsState?.key === `${detail.submission_id}:${n}` ? originalsState.status : null,
    [originalsState, detail.submission_id],
  );
  // Their URLs expire like the live photos': re-sign the loaded attempt
  // in place, so an open gallery keeps showing it instead of closing.
  const originalsKey = originals?.key;
  useEffect(() => {
    if (!originalsKey) return;
    const [sid, n] = originalsKey.split(":");
    const refresh = () => {
      teacher
        .attemptFiles(sid, Number(n))
        .then(({ files }) =>
          setOriginals((cur) => (cur?.key === originalsKey ? { key: originalsKey, files } : cur)),
        )
        .catch(() => {});
    };
    window.addEventListener(PHOTO_URLS_EXPIRED, refresh);
    return () => window.removeEventListener(PHOTO_URLS_EXPIRED, refresh);
  }, [originalsKey]);
  // A retake replaced this turn-in's first photos: the newest attempt.
  // Every attempt before it came before a reopen — the earlier turn-ins,
  // and any photos a retake replaced on one of them.
  const { retakeOriginal, earlierAttempts } = useMemo(() => {
    const last = detail.attempts.at(-1);
    const retake = detail.retaken_at && last?.reason === "retake" ? last : null;
    return {
      retakeOriginal: retake,
      earlierAttempts: detail.attempts.filter((a) => a !== retake),
    };
  }, [detail.attempts, detail.retaken_at]);
  const onOpenWork = useCallback(() => setGalleryPage(0), []);
  // Live DOM handles to each problem row, indexed by position in
  // detail.problems, so keyboard nav can move real focus.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // The default focus lands on the first ungraded problem (or the first
  // problem when all are graded / there are none). Derived — not stored
  // via an effect — so it stays correct as the student changes without
  // tripping the set-state-in-effect rule.
  const defaultFocusIndex = useMemo(() => {
    const i = detail.problems.findIndex(
      (p) => !breakdownByProblem.has(p.bank_item_id),
    );
    return i === -1 ? 0 : i;
  }, [detail.problems, breakdownByProblem]);

  // Explicit focus is keyed by submission_id so it auto-resets when the
  // teacher moves to the next student (the stored sid no longer matches,
  // so we fall back to that student's first-ungraded default) — again
  // without an effect.
  const [focusState, setFocusState] = useState<{ sid: string; index: number } | null>(
    () => (focusIndex >= 0 ? { sid: detail.submission_id, index: focusIndex } : null),
  );

  // Bring the deep-linked problem into view once its row exists. Centred
  // rather than 'nearest' — arriving from a link, the reader needs the
  // row in context, not pinned to the viewport edge. Focus follows so the
  // grading keys act on it straight away.
  // A position this submission doesn't have is consumed all the same, so
  // a stale ?problem= never lingers in the URL.
  const [hadFocusRequest] = useState(() => focusProblem !== null);
  useEffect(() => {
    if (!hadFocusRequest) return;
    const el = focusIndex >= 0 ? rowRefs.current[focusIndex] : null;
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center" });
    }
    onProblemFocused();
  }, [hadFocusRequest, focusIndex, onProblemFocused]);
  const focusedIndex =
    focusState && focusState.sid === detail.submission_id
      ? Math.min(focusState.index, Math.max(0, detail.problems.length - 1))
      : defaultFocusIndex;

  // Move the focus highlight AND real DOM focus to a row. preventScroll
  // on .focus() then a single smooth scrollIntoView avoids a double
  // jump; reduced-motion users get an instant scroll.
  const moveFocus = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, detail.problems.length - 1));
      setFocusState({ sid: detail.submission_id, index: clamped });
      const el = rowRefs.current[clamped];
      if (!el) return;
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    },
    [detail.problems.length, detail.submission_id],
  );

  // After grading the focused problem, advance to the next *ungraded*
  // problem below it; wrap to an earlier ungraded one if the tail is
  // done; else just step down one (or hold at the last row). The
  // just-graded row at `from` is skipped because we start the scan at
  // from+1 — breakdownByProblem hasn't optimistically updated yet at
  // call time, so we can't rely on it reflecting the grade we just set.
  const nextUngradedAfter = useCallback(
    (from: number) => {
      const probs = detail.problems;
      for (let i = from + 1; i < probs.length; i++) {
        if (!breakdownByProblem.has(probs[i].bank_item_id)) return i;
      }
      for (let i = 0; i < from; i++) {
        if (!breakdownByProblem.has(probs[i].bank_item_id)) return i;
      }
      return Math.min(from + 1, probs.length - 1);
    },
    [detail.problems, breakdownByProblem],
  );

  // Grade the focused problem via the SAME path the buttons use. For
  // partial we preserve an existing partial percent (so re-pressing 2
  // doesn't clobber a deliberate value) and otherwise default to 50,
  // exactly like the Partial button's pickPartial.
  const gradeLabel = (status: GradeStatus, percent?: number) =>
    status === "full"
      ? "full credit"
      : status === "zero"
        ? "no credit"
        : `partial credit, ${percent ?? 50} percent`;

  const gradeFocused = useCallback(
    (status: GradeStatus, explicitPercent?: number) => {
      const p = detail.problems[focusedIndex];
      if (!p) return;
      let pct: number | undefined;
      if (status === "partial") {
        if (explicitPercent !== undefined) {
          // A keyboard quarter-grade (75 / 50 / 25) — use it directly.
          pct = explicitPercent;
        } else {
          const existing = breakdownByProblem.get(p.bank_item_id);
          pct =
            existing?.score_status === "partial"
              ? Math.round(existing.percent)
              : 50;
        }
      }
      onGradeProblem(p.bank_item_id, status, pct);
      announceGrade(p.position, gradeLabel(status, pct));
      moveFocus(nextUngradedAfter(focusedIndex));
    },
    [
      announceGrade,
      detail.problems,
      focusedIndex,
      breakdownByProblem,
      onGradeProblem,
      moveFocus,
      nextUngradedAfter,
    ],
  );

  // Confirm the focused collapsed row in place, then advance — the
  // keyboard twin of the Confirm chip. Re-affirms the AI's grade (no
  // mutation; just stamps the local checklist + reviewed_at) so a teacher
  // can rip "1,1,5" straight down a stack of confident grades.
  const confirmFocused = useCallback(() => {
    const p = detail.problems[focusedIndex];
    if (!p) return;
    confirmProblems([p.bank_item_id]);
    // Announce this path too. On a stack of confident rows it is the
    // path most keystrokes actually take — pressing the key that matches
    // the AI confirms rather than re-grades — so leaving it silent would
    // have meant the common case stayed the silent one.
    announceGrade(p.position, "confirmed the AI's grade");
    moveFocus(nextUngradedAfter(focusedIndex));
  }, [
    announceGrade,
    detail.problems,
    focusedIndex,
    confirmProblems,
    moveFocus,
    nextUngradedAfter,
  ]);

  // Dispatch a grade key (1–5). On a COLLAPSED confident row, the key
  // that matches the AI's suggestion confirms in place; any other grade
  // key is a deliberate override that re-grades (which re-expands the row
  // via the override check) and advances. Expanded rows always grade
  // directly — the existing behaviour.
  const pressGradeKey = useCallback(
    (key: "1" | "2" | "3" | "4" | "5", status: GradeStatus, pct?: number) => {
      const meta = problemMeta[focusedIndex];
      if (meta?.collapsed && meta.confirmKey === key) {
        confirmFocused();
      } else {
        gradeFocused(status, pct);
      }
    },
    [problemMeta, focusedIndex, confirmFocused, gradeFocused],
  );

  // The document-level grading listener. Memoized over the current
  // focus/handlers; the effect re-subscribes when that identity changes.
  const handleGradingKey = useCallback(
    (e: KeyboardEvent) => {
      // While the cheatsheet — or ANY other modal (publish/regrade
      // confirm, verdict legend, integrity conversation, image lightbox)
      // — is open, that dialog owns the keyboard. Don't grade or navigate
      // the submission underneath it. The cheatsheet flag is explicit;
      // isDialogOpen() catches every other [role="dialog"].
      if (cheatsheetOpen || isDialogOpen()) return;

      // "?" toggles the shortcut cheatsheet — but only when not typing
      // (a "?" inside feedback must reach the textarea).
      if (e.key === "?") {
        if (isTypingTarget(document.activeElement)) return;
        e.preventDefault();
        setCheatsheetOpen(true);
        return;
      }

      // Escape blurs a focused text field (percent / feedback) so the
      // grading shortcuts resume. Handled before the typing-gate so it
      // can act *on* the typing target.
      if (e.key === "Escape") {
        const a = document.activeElement;
        if (isTypingTarget(a)) (a as HTMLElement).blur();
        return;
      }

      // The critical gate: never hijack typing.
      if (isTypingTarget(document.activeElement)) return;
      // Leave browser/OS chords alone (Cmd+1 tab switch, etc.).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        // Quarter-scale grading: 1=100, 2=75, 3=50, 4=25, 5=0. The common
        // partial grades sit on dedicated keys, so the teacher rarely needs
        // the % field — each press grades the focused problem and advances.
        case "1":
          e.preventDefault();
          pressGradeKey("1", "full");
          break;
        case "2":
          e.preventDefault();
          pressGradeKey("2", "partial", 75);
          break;
        case "3":
          e.preventDefault();
          pressGradeKey("3", "partial", 50);
          break;
        case "4":
          e.preventDefault();
          pressGradeKey("4", "partial", 25);
          break;
        case "5":
          e.preventDefault();
          pressGradeKey("5", "zero");
          break;
        case "w":
        case "W":
          // The student's work is what a teacher looks at most and was
          // the only major affordance without a key.
          e.preventDefault();
          onOpenWork();
          break;
        case "j":
        case "J":
        case "ArrowDown":
          e.preventDefault();
          moveFocus(focusedIndex + 1);
          break;
        case "k":
        case "K":
        case "ArrowUp":
          e.preventDefault();
          moveFocus(focusedIndex - 1);
          break;
        case "Enter":
          // Let a focused button/link handle its own Enter; only Enter
          // from an inert focus (a row / body) means "next student".
          if (isActionableTarget(document.activeElement)) break;
          if (nextStudent) {
            e.preventDefault();
            onSelectNext();
          }
          break;
        case "a":
        case "A":
          // Approve (& next) — the same act as the button, never more.
          if (approvesOnKey(e, canApprove)) {
            e.preventDefault();
            approve();
          }
          break;
        case "ArrowRight":
        case "]":
          if (nextStudent) {
            e.preventDefault();
            onSelectNext();
          }
          break;
        default:
          break;
      }
    },
    [
      cheatsheetOpen,
      pressGradeKey,
      moveFocus,
      focusedIndex,
      nextStudent,
      onSelectNext,
      onOpenWork,
      canApprove,
      approve,
    ],
  );

  useEffect(() => {
    // Capture phase, deliberately: it runs before React's bubble-phase
    // synthetic handlers, so when Enter is pressed inside the partial %
    // input the field still holds focus (isTypingTarget → true) and we
    // bail — before the input's own onKeyDown blurs it. A bubble-phase
    // listener would see focus already gone and mis-fire "next student".
    document.addEventListener("keydown", handleGradingKey, true);
    return () => document.removeEventListener("keydown", handleGradingKey, true);
  }, [handleGradingKey]);

  const showReadingCheck = needsReadingCheck(detail);
  const homeworkPoints = detail.problems.reduce((s, p) => s + p.points, 0);
  // final_score weighs only the problems graded so far, so it reads as
  // the homework's score only once every problem has a grade.
  const fullyGraded = gradedCount === totalProblems;

  return (
    <div className="space-y-4">
      {/* Compact student strip — name on the left, progress + next on
          the right. Replaces the old profile card + grade-progress card;
          the roster already shows the student name, so this strip is
          just "what context am I in right now?", not a profile. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-surface px-4 py-2.5 shadow-sm">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="font-bold text-text-primary">
              {detail.student_name}
            </span>
            <span className="text-xs text-text-muted">{detail.student_email}</span>
            {detail.final_score !== null && homeworkPoints > 0 && !fullyGraded && (
              <span className="text-xs text-text-muted">
                {gradedCount} of {totalProblems} graded
              </span>
            )}
            {detail.final_score !== null && homeworkPoints > 0 && fullyGraded && (
              <span className="text-sm" title="Points earned out of what the homework is worth">
                <span className="font-mono font-bold tabular-nums text-text-primary">
                  {formatPoints(earnedPoints(detail.final_score, homeworkPoints))}/{homeworkPoints}
                </span>
                <span className="text-xs text-text-muted"> · {Math.round(detail.final_score)}%</span>
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Submitted{" "}
            {new Date(detail.submitted_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {detail.is_late && detail.late_penalty_percent === 0 && (
              <span className="ml-1.5 font-semibold text-[color:var(--color-error)]">
                · {lateLabel(detail.days_late)}
              </span>
            )}
            {detail.extraction_flagged_at && (
              <span
                className="ml-1.5 font-semibold text-[color:var(--color-error)] "
                title="The student said most of the reading was wrong — the AI doesn't grade a reading the student disputes, so grade from the photo"
              >
                · student-flagged reading ·{" "}
                {detail.ai_breakdown ? "check the AI grade against the photo" : "grade manually"}
              </span>
            )}
            <span className="mx-1.5 text-text-muted/60" aria-hidden>·</span>
            {published && row?.grade_published_at ? (
              detail.grade_dirty ? (
                <span className="font-semibold text-[color:var(--color-warning-dark)] ">
                  Edited since publish · republish to update students
                </span>
              ) : (
                <span className="font-semibold text-success">
                  Published{" "}
                  {new Date(row.grade_published_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              )
            ) : gradedCount > 0 ? (
              <span className="font-semibold text-text-primary">
                AI graded · not yet published
              </span>
            ) : aiGrading && aiGradingUnwatched ? (
              <span className="font-semibold text-primary">
                Still grading — refresh to check
              </span>
            ) : aiGrading ? (
              <span className="font-semibold text-primary">
                AI grading — the grade appears here for you to review
              </span>
            ) : row?.ai_grade_block === "awaiting_confirmation" ? (
              <span className="text-text-muted">
                Not graded yet · waiting for the student to confirm their work
              </span>
            ) : row?.ai_grade_block === "extracting" ? (
              <span className="text-text-muted">
                Not graded yet · reading the work…
              </span>
            ) : row?.ai_grade_block === "no_extraction" ? (
              <span className="text-text-muted">
                Not graded yet · work not read, so grade by hand
              </span>
            ) : (
              <span className="text-text-muted">Not graded yet</span>
            )}
          </p>
          {detail.late_penalty_percent > 0 && (
            <LatePenaltyLine
              detail={detail}
              busy={waivingLate}
              onWaivedChange={onLatePenaltyWaivedChange}
            />
          )}
          {reopen}
          {aiGradeError && (
            <p
              role="alert"
              className="mt-1 text-[11px] font-semibold text-[color:var(--color-error)]"
            >
              {aiGradeError}
            </p>
          )}
          {saveError && (
            <p className="mt-1 text-[11px] font-semibold text-[color:var(--color-error)]">
              {saveError}
            </p>
          )}
        </div>
        <ReviewActions
          detail={detail}
          reportBase={reportBase}
          offerAiGrade={offerAiGrade}
          aiGrading={aiGrading}
          onGradeWithAi={onGradeWithAi}
          savingGrade={savingGrade}
          regrading={regrading}
          marking={marking}
          handGraded={handGraded}
          approved={approved}
          allGraded={allGraded}
          gradedProblemCount={gradedProblemCount}
          totalProblems={totalProblems}
          graphGate={graphGate}
          onMarkReviewed={onMarkReviewed}
          onApproveAndNext={onApproveAndNext}
          onUnmarkReviewed={onUnmarkReviewed}
          nextStudent={nextStudent}
          onSelectNext={onSelectNext}
          toReleaseTotal={toReleaseTotal}
          onPublish={onPublish}
          published={published}
          onPublishStudent={onPublishStudent}
          publishingStudent={publishingStudent}
        />
      </div>

      {/* Unvouched-reading callout. The page a teacher grades from is a
          machine transcript, and until now one nobody had checked
          rendered identically to one the student had confirmed — the
          worst row on the page looked like the best. A real misread in
          prod (a student's `y = x` transcribed as the worksheet's
          `y = √x`, never confirmed) is what surfaced it; the teacher
          hand-graded from the transcript and saw a correct answer.
          Amber, not red: this is "check the photo", not "something is
          wrong". Suppressed when the student explicitly flagged the
          reading — that gets the louder red callout directly below. */}
      {showReadingCheck && (
          <div
            className="rounded-[--radius-xl] border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-bg)]/60 p-3"
            role="status"
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-warning-dark)] text-sm font-bold text-white"
                aria-hidden
              >
                ?
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary">
                  {READING_TRUST_COPY.title}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                  {READING_TRUST_COPY.body}
                </p>
              </div>
            </div>
          </div>
        )}

      {/* Reader-misread callout — the student declined the OCR reading
          ("the reader got my work wrong") on the confirm screen, so the
          submission skipped AI grading + integrity entirely. There's no
          integrity check to render below, which is exactly why this
          needs its own loud signal: without it the row would look like
          an ordinary ungraded submission and the dodge (or the genuine
          misread) would slip by. Honor-code by design — no interview is
          forced — so the teacher is the backstop. */}
      {detail.extraction_flagged_at && (
        <div
          className="rounded-[--radius-xl] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] p-3"
          role="status"
        >
          <div className="flex items-start gap-3">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-error)] text-sm font-bold text-white"
              aria-hidden
            >
              ⚠
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary">
                Student said the reader got their work wrong — review
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                {detail.ai_breakdown
                  ? "They declined the scanned reading on the confirm screen, so no understanding check ran — and the AI grade below was made from that disputed reading. Check it against the photo; if it looks like a dodge, follow up with the student."
                  : "They declined the scanned reading on the confirm screen, so no AI grading or understanding check ran. If the photo really was misread, grade from the original work; if it looks like a dodge, follow up with the student."}
              </p>
              {/* What the student told us when they flagged — the
                  pointer to where the misread is. Older flags carry
                  neither, and then nothing renders. */}
              {detail.extraction_flag_note && (
                <figure className="mt-2.5 border-l-2 border-[color:var(--color-error)]/50 pl-3">
                  <figcaption className="text-[11px] font-semibold text-text-muted">
                    What the student said was wrong
                  </figcaption>
                  <blockquote className="mt-0.5 whitespace-pre-line break-words text-sm text-text-primary">
                    &ldquo;{detail.extraction_flag_note}&rdquo;
                  </blockquote>
                </figure>
              )}
              {detail.extraction_edit_count > 0 && (
                <p className="mt-2 text-xs text-text-secondary">
                  They fixed{" "}
                  <span className="font-semibold text-text-primary">
                    {detail.extraction_edit_count}{" "}
                    {detail.extraction_edit_count === 1 ? "line" : "lines"}
                  </span>{" "}
                  before sending it — marked{" "}
                  <span className="font-semibold text-primary">✎ edited by student</span>{" "}
                  below, with what was originally read.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Retake callout — the student flagged the first reading and
          replaced their photos for a fresh one, before anything was
          graded. Everything on this page is the NEW turn-in; the photos
          it replaced stay one click away, with what the student said was
          wrong with that reading. Calm primary tint, not red: a retake is
          the student fixing their own photos, not a problem — but the
          teacher should know the work she's grading isn't the first
          thing that came in. */}
      {detail.retaken_at && retakeOriginal && (
        <RetakeCallout
          retakenAt={detail.retaken_at}
          original={retakeOriginal}
          onViewOriginal={() => void openOriginals(retakeOriginal.number)}
          state={attemptState(retakeOriginal.number)}
        />
      )}

      {/* Earlier turn-ins a reopen replaced — this page grades the new
          one; what came before, and the grade it had, stay in view. */}
      {earlierAttempts.length > 0 && (
        <EarlierTurnInsCallout
          attempts={earlierAttempts}
          onView={(n) => void openOriginals(n)}
          stateFor={attemptState}
        />
      )}

      {/* Integrity verdict — the #1 trust signal. Below xl (no rail)
          the compact card sits here, ahead of grading; on xl it moves
          to the top of the pinned rail instead. Hides when HW had
          integrity disabled / no check. */}
      <div className="xl:hidden">
        <IntegrityCard
          integrity={integrity}
          overviewFallback={row?.integrity_overview ?? null}
          unfinished={row?.unfinished_check ?? null}
          onResolved={onIntegrityResolved}
          detailsOpen={integrityDetailsOpen}
          onToggleDetails={onToggleIntegrityDetails}
        />
      </div>

      {/* Rubric drift banner — only renders when the assignment's live
          rubric differs from the one this submission was graded against.
          Triggers a regrade confirm dialog managed by the page. Not on
          work the student flagged as misread — the server won't AI-grade
          a disputed reading. */}
      {!detail.extraction_flagged_at && (
        <RubricDriftBanner
          current={rubric}
          snapshot={row?.rubric_snapshot ?? null}
          regrading={regrading}
          error={regradeError}
          onRegrade={onRegradeRequest}
        />
      )}

      {/* AI-skip callout — when the photo was too low-confidence to
          auto-grade, or the homework too long to grade in one pass, the
          AI suggestion is silently absent and the per-problem pickers
          below sit empty. Explain why, and put the student's work one
          click away, so the empty state reads as "grade this by hand"
          not "something's broken". Manual grading stays fully enabled
          below. */}
      {aiSkip && (
        <div className="rounded-[--radius-xl] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] p-4  dark:bg-[color:var(--color-warning)]/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-bold text-[color:var(--color-warning-dark)] ">
                <span aria-hidden>⚠</span>
                {AI_SKIP_COPY[aiSkip].title}
              </p>
              {/* Names only what the teacher can actually do from here.
                  The previous copy offered "ask them to resubmit a clearer
                  photo", which the product cannot do: submission is
                  one-shot (a second attempt gets 409 Already submitted)
                  and no endpoint reopens one. It also has to say what
                  "by hand" means, because there is no button for it —
                  `record_grading_skip` leaves breakdown and
                  final_score null precisely so the grading controls
                  below this callout work normally, just with nothing
                  pre-filled. */}
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--color-warning-dark)]/80">
                {AI_SKIP_COPY[aiSkip].body}
              </p>
            </div>
            {detail.files && detail.files.length > 0 && (
              <div className="shrink-0">
                <StudentWorkThumbButton
                files={detail.files}
                studentName={detail.student_name}
              />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-problem grading — the main scan-unit. The student-work
          lightbox lives in the page header (one click away from any
          problem). */}
      <div className="rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Problems · {totalProblems}
          </p>
          {/* Quiet, discoverable entry point to the keyboard cheatsheet.
              Mirrors the integrity "Guide" affordance so the page has one
              consistent "press for help" vocabulary. */}
          <button
            type="button"
            onClick={() => setCheatsheetOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-[--radius-sm] px-1.5 py-0.5 text-[11px] font-semibold text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Show keyboard shortcuts"
            aria-haspopup="dialog"
          >
            Press{" "}
            <kbd className="rounded border border-border-light bg-[color:var(--color-surface-alt-2)] px-1 font-sans text-[11px] font-bold text-text-secondary">
              ?
            </kbd>{" "}
            for shortcuts
          </button>
        </div>
        <div className="mt-3">
          <RubricSection
            rubric={rubric}
            open={rubricOpen}
            onToggle={onToggleRubric}
          />
        </div>

        {/* Triage note — explains the collapse, and makes the "nothing is
            auto-accepted" contract explicit. Only shown when the AI was
            confident on at least one problem (so there's something to
            collapse). */}
        {confidentCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[--radius-md] bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-[11px] text-text-secondary">
            <span className="flex items-start gap-2">
              <span aria-hidden>🤖</span>
              <span>
                <b className="font-bold text-text-primary">
                  {confidentCount} of {totalProblems}
                </b>{" "}
                the AI is confident about — collapsed for a one-glance
                confirm.{" "}
                {uncertainCount > 0 && (
                  <>
                    <b className="font-bold text-text-primary">
                      {uncertainCount}
                    </b>{" "}
                    stayed open because the AI was unsure.{" "}
                  </>
                )}
                <b className="font-bold text-text-primary">
                  Nothing is auto-accepted
                </b>{" "}
                — each row needs your key.
              </span>
            </span>
            {pendingConfirmIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  confirmProblems(pendingConfirmIds);
                  // The fastest path to a fully graded submission, and
                  // the one that changes the most state at once — say
                  // how many, because nothing on screen announces it and
                  // the rows all collapse to confirmed at the same time.
                  announce(
                    `Confirmed ${pendingConfirmIds.length} AI ${
                      pendingConfirmIds.length === 1 ? "grade" : "grades"
                    }.`,
                  );
                }}
                className="shrink-0 rounded-[--radius-md] border border-primary/35 bg-primary-bg px-3 py-1.5 text-[11px] font-bold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
              >
                ✓ Confirm all {pendingConfirmIds.length} confident{" "}
                {pendingConfirmIds.length === 1 ? "grade" : "grades"}
              </button>
            )}
          </div>
        )}

        <div className="mt-3 space-y-3">
          {detail.problems.map((p, i) => {
            const meta = problemMeta[i];
            return (
              <ProblemGradeRow
                // Compose the key with submission_id so the row remounts
                // per student. Without this, React reuses the same
                // ProblemGradeRow instance across students that share
                // bank items, and local UI state (e.g. the question
                // expand toggle) leaks from one student into the next.
                key={`${detail.submission_id}-${p.bank_item_id}`}
                problem={p}
                entry={breakdownByProblem.get(p.bank_item_id) ?? null}
                aiGrade={meta?.ai ?? null}
                focused={i === focusedIndex}
                collapsed={meta?.collapsed ?? false}
                collapsible={meta?.confident ?? false}
                confirmed={meta?.confirmed ?? false}
                confirmKey={meta?.confirmKey ?? null}
                onConfirm={() => {
                  confirmProblems([p.bank_item_id]);
                  announceGrade(p.position, "confirmed the AI's grade");
                }}
                onToggleExpand={() => toggleExpand(p.bank_item_id)}
                onRequiresDrawingChange={(next) => onRequiresDrawingChange(p.bank_item_id, next)}
                drawingsInventoried={detail.drawings_inventoried}
                reportBase={reportBase}
                ruleText={ruleText}
                rowRef={(el) => {
                  rowRefs.current[i] = el;
                }}
                onChange={(status, partialPercent) => {
                  onGradeProblem(p.bank_item_id, status, partialPercent);
                  announceGrade(p.position, gradeLabel(status, partialPercent));
                }}
                onFeedbackChange={(text) =>
                  onFeedbackChange(p.bank_item_id, text)
                }
                onGraphVerdict={(n, verdict) => onGraphVerdict(p.bank_item_id, n, verdict)}
                graphBusyItems={p.graph ? p.graph.items.filter((it) => graphBusy.has(`${p.bank_item_id}:${it.n}`)).map((it) => it.n) : []}
                onOpenPage={() =>
                  setGalleryPage(p.pages.length > 0 ? p.pages[0]! - 1 : 0)
                }
              />
            );
          })}
        </div>

        {(detail.other_work.length > 0 || detail.other_drawings.length > 0) && (
          <OtherWorkDisclosure
            steps={detail.other_work}
            drawings={detail.other_drawings}
            anyRequired={detail.problems.some((p) => p.requires_drawing)}
          />
        )}
      </div>

      {cheatsheetOpen && (
        <KeyboardShortcutsModal onClose={() => setCheatsheetOpen(false)} />
      )}

      <WorkGalleryModal
        files={detail.files ?? []}
        studentName={detail.student_name}
        openAt={galleryPage}
        onClose={() => setGalleryPage(null)}
      />
      <WorkGalleryModal
        files={
          originals?.key.startsWith(`${detail.submission_id}:`) ? originals.files : []
        }
        studentName={detail.student_name}
        note="earlier photos"
        openAt={originalPage}
        onClose={() => setOriginalPage(null)}
      />
    </div>
  );
}

const RETAKE_TIME: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function RetakeCallout({
  retakenAt,
  original,
  onViewOriginal,
  state,
}: {
  retakenAt: string;
  original: SubmissionAttempt;
  onViewOriginal: () => void;
  /** Fetching the original photos, or that fetch failed. */
  state: "loading" | "error" | null;
}) {
  const pages = original.file_count;
  return (
    <div
      className="rounded-[--radius-xl] border border-primary/25 bg-primary-bg/50 p-3"
      role="status"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white"
          aria-hidden
        >
          ↻
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            Student retook their photos
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            They sent the first reading to you as misread
            {` (turned in ${new Date(original.submitted_at).toLocaleString(undefined, RETAKE_TIME)}${original.is_late ? ", late" : ""})`}
            , then replaced the photos on{" "}
            {new Date(retakenAt).toLocaleString(undefined, RETAKE_TIME)}, before
            anything was graded. This page shows the new photos and their
            reading.
          </p>
          {original.extraction_flag_note && (
            <figure className="mt-2.5 border-l-2 border-primary/40 pl-3">
              <figcaption className="text-[11px] font-semibold text-text-muted">
                What they said was wrong the first time
              </figcaption>
              <blockquote className="mt-0.5 whitespace-pre-line break-words text-sm text-text-primary">
                &ldquo;{original.extraction_flag_note}&rdquo;
              </blockquote>
            </figure>
          )}
        </div>
        {pages > 0 && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              onClick={onViewOriginal}
              disabled={state === "loading"}
              className="rounded-[--radius-md] border border-primary/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10 disabled:opacity-60"
            >
              {state === "loading"
                ? "Opening original photos…"
                : `View original photos (${pages})`}
            </button>
            {state === "error" && (
              <p role="alert" className="text-[11px] text-error">
                Couldn&apos;t load them. Try again.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What came before a reopen, oldest first: each earlier turn-in — when it
 * came in, the grade it had (and whether the student had seen it) — and
 * any photos a retake replaced, each with its photos one click away. Calm, like the retake callout — the student turning it in
 * again is what she asked for.
 */
function EarlierTurnInsCallout({
  attempts,
  onView,
  stateFor,
}: {
  attempts: SubmissionAttempt[];
  onView: (attemptNumber: number) => void;
  stateFor: (attemptNumber: number) => "loading" | "error" | null;
}) {
  return (
    <div className="rounded-[--radius-xl] border border-primary/25 bg-primary-bg/50 p-3" role="status">
      <div className="flex items-start gap-3">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white"
          aria-hidden
        >
          ↺
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            Turned in again after you reopened it
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            This page shows the new work, read and graded fresh. The earlier{" "}
            {attempts.length === 1 ? "turn-in is kept as it was" : "turn-ins are kept as they were"}, below.
          </p>
          <ul className="mt-2 space-y-1.5">
            {attempts.map((a) => {
              const state = stateFor(a.number);
              return (
                <li key={a.number} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                  <span className="font-semibold text-text-primary">
                    Turned in {new Date(a.submitted_at).toLocaleString(undefined, RETAKE_TIME)}
                    {a.is_late ? ", late" : ""}
                  </span>
                  <span className="text-text-secondary">
                    {a.reason === "retake"
                      ? "· photos the student replaced with a retake"
                      : a.final_score === null
                      ? "· not graded"
                      : `· graded ${formatPercent(a.final_score)}%${a.grade_published ? ", shown to the student" : ", not published"}`}
                  </span>
                  {a.file_count > 0 && (
                    <button
                      type="button"
                      onClick={() => onView(a.number)}
                      disabled={state === "loading"}
                      className="rounded-[--radius-sm] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
                    >
                      {state === "loading" ? "Opening…" : `View photos (${a.file_count})`}
                    </button>
                  )}
                  {state === "error" && (
                    <span role="alert" className="text-[11px] text-error">
                      Couldn&apos;t load them. Try again.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Rubric expandable section — the teacher's own authored criteria,
// surfaced at the top of the Problems card so they can sanity-check
// the AI's grades against what they said full/partial credit means.
// Collapsed by default (the AI is the first line of grading; rubric is
// a reference consulted when the teacher disagrees). Hides entirely
// when no rubric was authored.
// ────────────────────────────────────────────────────────────────────

function RubricSection({
  rubric,
  open,
  onToggle,
}: {
  rubric: TeacherRubric | null;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const fields = rubricFields(rubric);
  if (fields.length === 0) return null;
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}
      className="rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-secondary hover:text-text-primary">
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        Rubric
      </summary>
      <div className="space-y-2 border-t border-border-light px-3 py-2.5">
        {fields.map((f) => (
          <div key={f.label}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              {f.label}
            </p>
            <div className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-text-primary">
              <MathText text={f.text} />
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────
// Rubric drift banner — surfaces when the assignment's live rubric
// differs from what the AI grader applied to this submission. Gives
// the teacher a one-click path to re-run grading with the updated
// criteria. Collapsible "Rubric at grading time" exposes the old
// text verbatim so the teacher can eyeball what changed.
//
// Hides entirely when the two rubrics match — no noise on unchanged
// submissions. Also hides when there's no prior snapshot (historical
// rows or AI grading never ran), since there's nothing to regrade.
// ────────────────────────────────────────────────────────────────────

function RubricDriftBanner({
  current,
  snapshot,
  regrading,
  error,
  onRegrade,
}: {
  current: TeacherRubric | null;
  snapshot: TeacherRubric | null;
  regrading: boolean;
  error: string | null;
  onRegrade: () => void;
}) {
  const [showSnapshot, setShowSnapshot] = useState(false);
  // No snapshot → nothing to regrade against. No drift → no CTA needed.
  if (snapshot === null) return null;
  if (!rubricChanged(current, snapshot)) return null;

  const snapshotFields = rubricFields(snapshot);

  return (
    <div className="rounded-[--radius-xl] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] p-4  dark:bg-[color:var(--color-warning)]/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[color:var(--color-warning-dark)] ">
            Rubric edited since this was graded
          </p>
          <p className="mt-1 text-xs text-[color:var(--color-warning-dark)]/80">
            The AI graded against an earlier version of this homework&apos;s
            rubric. Regrade to apply the current one — your edits on this
            submission will be replaced.
          </p>
        </div>
        <button
          type="button"
          onClick={onRegrade}
          disabled={regrading}
          className="shrink-0 rounded-[--radius-md] bg-[color:var(--color-warning-dark)] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[color:var(--color-warning)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[color:var(--color-warning)]  "
        >
          {regrading ? "Regrading…" : "Regrade"}
        </button>
      </div>
      {snapshotFields.length > 0 && (
        <details
          open={showSnapshot}
          onToggle={(e) =>
            setShowSnapshot((e.target as HTMLDetailsElement).open)
          }
          className="mt-3 text-xs"
        >
          <summary className="cursor-pointer font-semibold text-[color:var(--color-warning-dark)] hover:text-[color:var(--color-warning-dark)]  ">
            {showSnapshot ? "Hide" : "View"} rubric at grading time
          </summary>
          <div className="mt-2 space-y-2 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-white/60 p-3 dark:border-[color:var(--color-warning)]/20 ">
            {snapshotFields.map((f) => (
              <div key={f.label}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-warning-dark)]/70">
                  {f.label}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-[color:var(--color-warning-dark)]">
                  {f.text}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
      {error && (
        <p className="mt-2 text-xs font-semibold text-[color:var(--color-error)] ">
          {error}
        </p>
      )}
    </div>
  );
}
