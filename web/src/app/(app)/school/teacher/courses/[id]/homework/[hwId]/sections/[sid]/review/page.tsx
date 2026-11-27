"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseProblemFocus, withSelectedStudent } from "@/lib/review-deep-link";
import {
  useClassRubric,
  useDetailSlots,
  useOtherSectionCounts,
  useSubmissionDetailFetch,
} from "./_hooks/use-review-data";
import { useRosterLoad } from "./_hooks/use-roster-load";
import { ReviewStoreProvider, useReviewStore } from "./_store/review-store";
import { ReopenControl } from "@/components/school/teacher/_pieces/reopen-control";
import {
  teacher,
  type GradeBreakdownEntry,
  type IntegrityResolutionOutcome,
  type TeacherRubric,
  type TeacherSubmissionRow,
} from "@/lib/api";
import { openGraphItems } from "@/components/school/teacher/_pieces/graph-check-review";
import type { GradeStatus, RosterEntry, GraphCall, GraphCallResult } from "./_lib/types";
import {
  EMPTY_ID_SET,
  isFlagged,
  isAwaitingGrade,
  canAiGrade,
  isAiGrading,
  AI_GRADE_POLL_TIMEOUT_MS,
  sameRow,
  aiGradePollDelay,
  hasGraphToCheck,
  hasLowConfidence,
  classOnly,
  applyRosterFilter,
} from "./_lib/grading";
import { awaitsApproval, needsTeacher, nextMatching } from "./_lib/next-student";
import { DetailSkeleton, ReviewLoadingSkeleton } from "./_components/skeletons";
import { VerdictLegendTrigger } from "./_components/reference-modals";
import { RosterFilterBar, TriageRoster, NotSubmittedCard } from "./_components/roster";
import { SubmissionDetailPanel } from "./_components/submission-detail-panel";
import { usePublishGrades } from "./_hooks/use-publish-grades";
import { IntegrityCard } from "./_components/integrity-card";
import { PinnedWorkRail } from "./_components/pinned-work";
import { GradeAllButton, RegradeConfirmDialog } from "./_components/header-actions";
import { PublishButton, PublishConfirmDialog } from "./_components/publish-controls";

// Suspense boundary required because the inner component reads
// useSearchParams (the ?student= deep-link focus), which opts the page
// into dynamic rendering and must be wrapped to satisfy Next.js.
export default function HomeworkSectionReviewPage(props: {
  params: Promise<{ id: string; hwId: string; sid: string }>;
}) {
  return (
    <Suspense>
      <ReviewStoreProvider>
        <HomeworkSectionReview {...props} />
      </ReviewStoreProvider>
    </Suspense>
  );
}

function HomeworkSectionReview({
  params,
}: {
  params: Promise<{ id: string; hwId: string; sid: string }>;
}) {
  const { id: courseId, hwId: assignmentId, sid: sectionId } = use(params);
  const backHref = `/school/teacher/courses/${courseId}?tab=submissions`;
  // Deep-link focus — the "Needs you today" triage queue routes here with
  // ?student=<id> so a clicked queue row lands directly on that student
  // instead of the default auto-pick. Falls through to the auto-pick when
  // absent or stale (student not on this roster).
  //
  // Read ONCE, on arrival. After that the page owns the URL: selecting a
  // student writes ?student= back (see the sync effect below), so a
  // "Report a problem" sent from here carries the exact student, and a
  // reload or a Back from another page lands on the same one. Reading the
  // param reactively would turn every click into a roster refetch, since
  // the write changes the param the roster load depends on.
  const searchParams = useSearchParams();
  const [focusStudentId] = useState(() => searchParams.get("student"));
  // ?problem=<n> — open that problem on the deep-linked student (a report
  // link, or a teacher sharing where they are). Consumed on first use and
  // dropped the moment the teacher moves to another student.
  const [problemFocus, setProblemFocus] = useState<
    { studentId: string; position: number } | null
  >(() => parseProblemFocus(searchParams.get("student"), searchParams.get("problem")));

  const [hwTitle, setHwTitle] = useState<string>("");
  // The class due date — a reopen's personal date can't be before it.
  const [hwDueAt, setHwDueAt] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState<string>("");
  // Teacher's rubric for this HW — rendered as an expandable panel at
  // the top of the Problems card so the teacher can sanity-check the
  // AI's grades against their own stated criteria. Null when no rubric
  // was authored (all rubric fields empty or the HW predates rubrics).
  const [hwRubric, setHwRubric] = useState<TeacherRubric | null>(null);
  const rubric = useClassRubric(courseId, hwRubric);
  // Rubric visibility is a session preference, not a per-student one.
  // Lifting it here means expanding the rubric on student A keeps it
  // expanded when the teacher hits "Next student" — otherwise
  // SubmissionDetailPanel unmounts during the switch and local state
  // inside RubricSection would reset to collapsed every time.
  const rubricOpen = useReviewStore((s) => s.rubricOpen);
  const setRubricOpen = useReviewStore((s) => s.setRubricOpen);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  // Roster filter — narrows the left pane by verdict / status. The
  // most useful default is "needs me" (anything flagged or ungraded);
  // we keep it on "all" for now so teachers don't lose context on
  // first land, but the filter chip is the fastest path from "show
  // me everyone" to "show me only the cheaters".
  const rosterFilter = useReviewStore((s) => s.rosterFilter);
  const setRosterFilter = useReviewStore((s) => s.setRosterFilter);
  // Which confident rows the teacher has ticked, per submission.
  //
  // This lives here rather than in the detail panel because the panel is
  // remounted on every student switch, and switching students is the
  // page's primary action — owning it there meant a teacher could leave a
  // student to check something, come back, and find every tick gone
  // (including a "Confirm all N" they had just clicked). Keyed by
  // submission id, so returning to a student restores exactly their own
  // ticks and nobody else's.
  //
  // Session-scoped on purpose: a reload clears it, which is honest,
  // because nothing about it is persisted server-side. The durable trust
  // signal is `reviewed_at` — the explicit Approve on an AI grade, or a
  // hand grade with every problem scored.
  const confirmedBySubmission = useReviewStore((s) => s.confirmedBySubmission);
  const setConfirmedBySubmission = useReviewStore((s) => s.setConfirmedBySubmission);

  // What the last grade action did, announced politely. Grading is a
  // keyboard-first flow — 1-5 grades the focused problem and advances —
  // and it did both silently, so a screen-reader user pressing a key got
  // no confirmation that anything had happened.
  //
  // Owned here, not by the detail panel: that panel unmounts whenever
  // `detail` goes stale during a post-save refetch, which is exactly
  // when a grade has just been recorded. The announcement was being
  // wiped before it could be read.
  const gradeAnnouncement = useReviewStore((s) => s.gradeAnnouncement);
  const setGradeAnnouncement = useReviewStore((s) => s.setGradeAnnouncement);
  const announce = useCallback((message: string) => {
    // Re-announce an identical action by appending an invisible marker:
    // a live region only speaks when its text CHANGES, and grading three
    // problems "full credit" in a row is the normal case, not an edge
    // one.
    setGradeAnnouncement((prev) =>
      prev === message ? `${message}\u200B` : message,
    );
  }, [setGradeAnnouncement]);
  const announceGrade = useCallback(
    (position: number, label: string) => announce(`Problem ${position}: ${label}.`),
    [announce],
  );

  const handleConfirmProblems = useCallback(
    (submissionId: string, bankItemIds: string[]) => {
      if (bankItemIds.length === 0) return;
      setConfirmedBySubmission((prev) => {
        const next = new Map(prev);
        const merged = new Set(prev.get(submissionId) ?? []);
        for (const id of bankItemIds) merged.add(id);
        next.set(submissionId, merged);
        return next;
      });
    },
    [setConfirmedBySubmission],
  );
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  // The teacher picking a student (roster click, "Next student", the
  // keyboard). A pending ?problem= focus belongs to the deep-linked
  // student only, so any move retires it.
  const selectStudent = useCallback((studentId: string) => {
    setProblemFocus(null);
    setSelectedStudentId(studentId);
  }, []);
  const clearProblemFocus = useCallback(() => setProblemFocus(null), []);

  // Mirror the selection into ?student=. `history.replaceState`, not a
  // router navigation: Next keeps useSearchParams in sync with it without
  // re-running the route, and replacing (never pushing) means switching
  // students adds no Back-button entries — Back still leaves the page.
  // ?problem= is kept only while it still describes what's on screen.
  useEffect(() => {
    if (!selectedStudentId) return;
    const next = withSelectedStudent(
      window.location.href,
      selectedStudentId,
      problemFocus?.studentId === selectedStudentId,
    );
    if (next) window.history.replaceState(null, "", next);
  }, [selectedStudentId, problemFocus]);
  const { detail, setDetail, integrity, setIntegrity, detailCache, integrityCache } = useDetailSlots();
  const [fetchError, setFetchError] = useState<
    { forSubmissionId: string; message: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<
    { forSubmissionId: string; message: string } | null
  >(null);
  const {
    pendingOtherSections,
    setPendingOtherSections,
    dirtyOtherSections,
    setDirtyOtherSections,
    setGradedOtherSections,
    pendingReviewedOtherSections,
    setPendingReviewedOtherSections,
    dirtyReviewedOtherSections,
    setDirtyReviewedOtherSections,
    flaggedOtherSections,
    setFlaggedOtherSections,
    graphOtherSections,
    setGraphOtherSections,
  } = useOtherSectionCounts();
  // Submission currently being marked reviewed via the explicit no-edit
  // affordance. Single slot — only one student is open at a time.
  const [markingReviewedId, setMarkingReviewedId] = useState<string | null>(null);
  // Submissions with a grade-save PATCH in flight. The save response
  // carries the authoritative reviewed_at and is mirrored onto the row,
  // so we must NOT let the teacher click Approve (or Undo) mid-save — a
  // response from before the click would land after it and overwrite
  // the fresh stamp in the UI. Disabling those controls while the save
  // is in flight closes that window. A Set so concurrent per-submission
  // saves are tracked independently.
  const [savingGradeIds, setSavingGradeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Whether the pinned work rail (wide layout) shows the photo inline.
  // A session preference — lifted here so it persists across students.
  const photoPinned = useReviewStore((s) => s.photoPinned);
  const setPhotoPinned = useReviewStore((s) => s.setPhotoPinned);
  // Whether the integrity card shows its Details (summary + activity
  // digest). Collapsed by default; a session preference like photoPinned,
  // shared by the rail card (xl) and the grade-column card (below xl).
  const integrityDetailsOpen = useReviewStore((s) => s.integrityDetailsOpen);
  const setIntegrityDetailsOpen = useReviewStore((s) => s.setIntegrityDetailsOpen);
  const toggleIntegrityDetails = useCallback(
    () => setIntegrityDetailsOpen((v) => !v),
    [setIntegrityDetailsOpen],
  );
  const publishConfirmOpen = useReviewStore((s) => s.publishConfirmOpen);
  const setPublishConfirmOpen = useReviewStore((s) => s.setPublishConfirmOpen);
  // Regrade state — a single slot because only one submission is open
  // in the detail pane at a time. When populated, the detail panel
  // shows a spinner on the regrade button and disables grading inputs.
  // Error is scoped to a submissionId so a failure on student A's
  // regrade doesn't render on student B's banner.
  const [regradingSubmissionId, setRegradingSubmissionId] = useState<string | null>(null);
  const [regradeError, setRegradeError] = useState<
    { forSubmissionId: string; message: string } | null
  >(null);
  const regradeConfirmOpenFor = useReviewStore((s) => s.regradeConfirmOpenFor);
  const setRegradeConfirmOpenFor = useReviewStore((s) => s.setRegradeConfirmOpenFor);
  // Submissions the teacher sent to the AI grader ("Grade with AI" or
  // "Grade all") whose grade hasn't landed yet. Grading runs on the
  // server's queue after the request returns, so the page polls these
  // until each one settles — see the polling effect below.
  const [aiPendingIds, setAiPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [aiGradeError, setAiGradeError] = useState<
    { forSubmissionId: string; message: string } | null
  >(null);
  // When the page last started watching a grade. The poll's back-off and
  // its give-up deadline both run from here, so a second click mid-poll
  // gets the full window and a fast first look instead of inheriting
  // the tail of the first one's.
  const watchSinceRef = useRef(0);
  // Bumped on every new watch so the polling effect restarts: the timer
  // already scheduled at the old, slower back-off is cleared and the
  // next look happens at the fast interval.
  const [pollKick, setPollKick] = useState(0);
  // The poll gave up (timeout) while a grade was still running on the
  // server. Such rows say "still grading — refresh to check" rather
  // than spinning forever with nobody watching.
  const [aiPollGaveUp, setAiPollGaveUp] = useState(false);
  const watchGrades = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    watchSinceRef.current = Date.now();
    setAiPollGaveUp(false);
    setPollKick((n) => n + 1);
    setAiPendingIds((prev) => new Set([...prev, ...ids]));
  }, []);

  useRosterLoad({
    assignmentId,
    courseId,
    sectionId,
    focusStudentId,
    watchGrades,
    setError,
    setHwTitle,
    setHwDueAt,
    setSectionName,
    setHwRubric,
    setPendingOtherSections,
    setDirtyOtherSections,
    setGradedOtherSections,
    setPendingReviewedOtherSections,
    setDirtyReviewedOtherSections,
    setFlaggedOtherSections,
    setGraphOtherSections,
    setRoster,
    setSelectedStudentId,
  });

  const selectedEntry = useMemo(
    () =>
      roster
        ? (roster.find((e) => e.student_id === selectedStudentId) ?? null)
        : null,
    [roster, selectedStudentId],
  );
  const selectedRow = selectedEntry?.submission ?? null;
  const selectedSubmissionId = selectedRow?.id ?? null;

  // Detail staleness is derived, not managed: a match on submission_id
  // means the single-slot `detail` belongs to the current selection.
  // Any mismatch (different student, just switched, not yet fetched)
  // shows the loading state — no reset-on-switch setState required.
  // Errors are derived from their scoping keys for the same reason.
  const detailIsCurrent =
    !!selectedSubmissionId && detail?.submission_id === selectedSubmissionId;
  const currentFetchError =
    fetchError && fetchError.forSubmissionId === selectedSubmissionId
      ? fetchError.message
      : null;
  const currentSaveError =
    saveError && saveError.forSubmissionId === selectedSubmissionId
      ? saveError.message
      : null;
  const detailLoading =
    !!selectedSubmissionId && !detailIsCurrent && currentFetchError === null;

  useSubmissionDetailFetch({
    selectedRow,
    selectedSubmissionId,
    detail,
    setDetail,
    setFetchError,
    integrity,
    setIntegrity,
    detailCache,
    integrityCache,
  });

  const pageTitle = useMemo(() => {
    if (!hwTitle && !sectionName) return "Reviewing…";
    const parts = [hwTitle, sectionName].filter(Boolean);
    return parts.join(" · ");
  }, [hwTitle, sectionName]);

  // Two populations, and which one a number belongs to is decided by
  // what the number is FOR:
  //
  //   classRoster — her students. Anything describing the class reads
  //       this: "1 of 1 submitted" must not become true because she
  //       tested her own homework, and a triage chip counting her would
  //       send her looking for a pupil who doesn't exist.
  //   roster — what the left list shows, her own rehearsal included so
  //       she can open it. Anything describing what a BUTTON WILL DO
  //       reads this, because the actions genuinely act on her too:
  //       publishing grades releases her rehearsal's grade (it has to,
  //       or she can never see the score on the student view she was
  //       checking), and grading pending work grades it.
  //
  // So "Students · 0/3 submitted" beside "Publish 1 grade" is not a
  // contradiction — the first describes her class, the second describes
  // the click. Keep new counts on the right side of that line.
  const classRoster = useMemo(
    () => (roster ? classOnly(roster) : null),
    [roster],
  );

  const submittedCount = classRoster?.filter((e) => e.submission).length ?? 0;
  const totalRoster = classRoster?.length ?? 0;
  // Submitters the triage roster surfaces as "needs your eyes" — flagged
  // or low-confidence. Drives the header's editorial subhead.
  const needsEyesCount =
    classRoster?.filter(
      (e) => e.submission && (isFlagged(e) || hasLowConfidence(e)),
    ).length ?? 0;
  // Ungraded MINUS anything already reported as needing eyes. The two
  // sets overlap (integrity runs at confirm time, grading waits for the
  // due date), so counting both raw reported one student twice — and
  // disagreed with the triage list, which files them under "Needs your
  // eyes". Header and roster must partition the class the same way.
  const awaitingOnlyCount =
    classRoster?.filter(
      (e) => isAwaitingGrade(e) && !isFlagged(e) && !hasLowConfidence(e),
    ).length ?? 0;

  // Mirror the server's recomputed grade back onto the roster row so
  // the left-list status/score updates the moment a save returns.
  // `grade_dirty` comes from the server (content-diff against the
  // published snapshot) so flipping Full → Zero → Full doesn't stick
  // the row in a dirty state when the net change is zero.
  const applyGradeToRoster = useCallback(
    (
      submissionId: string,
      patch: Pick<
        TeacherSubmissionRow,
        "final_score" | "late_penalty" | "breakdown" | "grade_dirty" | "reviewed_at"
      >,
    ) => {
      setRoster((prev) =>
        prev
          ? prev.map((e) =>
              e.submission?.id === submissionId
                ? { ...e, submission: { ...e.submission, ...patch } }
                : e,
            )
          : prev,
      );
    },
    [],
  );

  // A teacher marked the integrity check reviewed. Mirror the new
  // resolution onto the roster row's overview so the flagged filter +
  // "needs your eyes" subhead update instantly, then refetch the detail
  // so the resolved-by name + timestamp on the banner are authoritative.
  const handleIntegrityResolved = useCallback(
    (submissionId: string, resolution: IntegrityResolutionOutcome) => {
      setRoster((prev) =>
        prev
          ? prev.map((e) =>
              e.submission?.id === submissionId &&
              e.submission.integrity_overview
                ? {
                    ...e,
                    submission: {
                      ...e.submission,
                      integrity_overview: {
                        ...e.submission.integrity_overview,
                        resolution,
                      },
                    },
                  }
                : e,
            )
          : prev,
      );
      teacher
        .integrityDetail(submissionId)
        .then((d) =>
          setIntegrity((prev) =>
            prev?.submission_id === submissionId ? d : prev,
          ),
        )
        .catch(() => {});
    },
    [setIntegrity],
  );

  // Persist the current breakdown. Full-replacement semantics: we
  // send every graded entry on every call, the backend writes the
  // row, recomputes `final_score`, and returns the authoritative
  // `grade_dirty` (content-diff). If the save fails we leave local
  // state as-is and surface an error — teacher can click again.
  // Error is scoped to a submissionId so a prior failure on student
  // A can't bleed onto student B's grade summary card. Also mirrors
  // the server's dirty flag back onto the detail slot so the strip
  // reflects it without a separate refetch.
  // Per-submission save serialization. Each grade save sends the FULL
  // breakdown snapshot with last-write-wins semantics, so two overlapping
  // requests can finish out of order — an earlier (smaller) snapshot landing
  // after a later (larger) one silently drops a grade on the server. Rapid
  // keyboard grading (1,1,3,1,5 straight down) is exactly what triggers it.
  // Fix: at most one save in flight per submission; while one runs, newer
  // grades just update `latest`, and the drain loop saves only that latest
  // snapshot when the in-flight save returns. Ordered + coalesced → no race.
  //
  // A teacher's ✓ / ✗ on a graph checklist item rides the same queue, so
  // it never crosses a grade save in flight: the server re-scores the
  // problem on a call, and a save racing it would put the old score back
  // (and read as her re-scoring the problem by hand).
  const saveStateRef = useRef<
    Map<
      string,
      { inFlight: boolean; latest: GradeBreakdownEntry[] | null; graphCalls: GraphCall[] }
    >
  >(new Map());
  // Graph items with a call queued or saving, as `${problemId}:${n}`.
  const [graphBusy, setGraphBusy] = useState<ReadonlySet<string>>(() => new Set());

  // A graph call's result, merged into the page as it is now — not as it
  // was when she clicked, since other edits may have landed meanwhile.
  // Her feedback on the problem stays as the page holds it.
  const applyGraphCall = useCallback(
    (submissionId: string, call: GraphCall, res: GraphCallResult) => {
      const merge = (b: GradeBreakdownEntry[]) =>
        b.map((e) => (e.problem_id === call.problemId ? { ...res.entry, feedback: e.feedback } : e));
      setDetail((cur) =>
        cur && cur.submission_id === submissionId
          ? {
              ...cur,
              breakdown: merge(cur.breakdown ?? []),
              problems: cur.problems.map((p) =>
                p.bank_item_id === call.problemId ? { ...p, graph: res.graph } : p,
              ),
              final_score: res.final_score,
              late_penalty: res.late_penalty,
              grade_dirty: res.grade_dirty,
            }
          : cur,
      );
      setRoster((prev) =>
        prev
          ? prev.map((e) =>
              e.submission?.id === submissionId
                ? {
                    ...e,
                    submission: {
                      ...e.submission,
                      final_score: res.final_score,
                      late_penalty: res.late_penalty,
                      grade_dirty: res.grade_dirty,
                      ...(e.submission.breakdown ? { breakdown: merge(e.submission.breakdown) } : {}),
                      graph_items_open: res.graph_items_open,
                    },
                  }
                : e,
            )
          : prev,
      );
    },
    [setDetail],
  );

  const saveState = (submissionId: string) => {
    const map = saveStateRef.current;
    let s = map.get(submissionId);
    if (!s) {
      s = { inFlight: false, latest: null, graphCalls: [] };
      map.set(submissionId, s);
    }
    return s;
  };

  // Drains a submission's queue, one request at a time: graph calls
  // first, then the latest grade snapshot. A failed request reports and
  // the drain moves on, so nothing queued behind it is stranded.
  const drainSaves = useCallback(
    async (submissionId: string) => {
      const s = saveStateRef.current.get(submissionId);
      if (!s || s.inFlight) return;

      setSaveError((prev) =>
        prev?.forSubmissionId === submissionId ? null : prev,
      );
      s.inFlight = true;
      setSavingGradeIds((prev) => {
        if (prev.has(submissionId)) return prev;
        const next = new Set(prev);
        next.add(submissionId);
        return next;
      });
      try {
        while (s.graphCalls.length > 0 || s.latest) {
          const call = s.graphCalls[0];
          if (call) {
            try {
              const res = await teacher.setGraphItemVerdict(submissionId, {
                problem_id: call.problemId,
                n: call.n,
                verdict: call.verdict,
              });
              applyGraphCall(submissionId, call, res);
              // A snapshot queued meanwhile was taken before this call
              // landed: carry the server's re-score of the problem into
              // it. Its grade buttons are held while a call is pending
              // (setProblemGrade), so there's no newer score of hers to lose.
              if (s.latest) {
                s.latest = s.latest.map((e) =>
                  e.problem_id === call.problemId ? { ...res.entry, feedback: e.feedback } : e,
                );
              }
            } catch (e) {
              setSaveError({
                forSubmissionId: submissionId,
                message: e instanceof Error ? e.message : "Failed to save your call on the graph",
              });
            } finally {
              s.graphCalls.shift();
              setGraphBusy((prev) => {
                const next = new Set(prev);
                next.delete(`${call.problemId}:${call.n}`);
                return next;
              });
            }
            continue;
          }
          const toSave = s.latest;
          if (!toSave) break;
          s.latest = null;
          try {
            const res = await teacher.gradeSubmission(submissionId, {
              breakdown: toSave,
            });
            // The save response's reviewed_at is authoritative: a hand
            // grade (no AI score) self-approves on the save that grades
            // its last problem and un-approves if one is cleared, while an
            // AI grade's stamp is untouched by a save. Mirror it onto the
            // roster row and the open detail. This can't clobber a fresh
            // Approve click — the Approve/Undo buttons are disabled while
            // a save is in flight.
            applyGradeToRoster(submissionId, {
              final_score: res.final_score,
              late_penalty: res.late_penalty,
              breakdown: toSave,
              grade_dirty: res.grade_dirty,
              reviewed_at: res.reviewed_at,
            });
            setDetail((d) =>
              d && d.submission_id === submissionId
                ? {
                    ...d,
                    final_score: res.final_score,
                    late_penalty: res.late_penalty,
                    grade_dirty: res.grade_dirty,
                    reviewed_at: res.reviewed_at,
                  }
                : d,
            );
          } catch (e) {
            setSaveError({
              forSubmissionId: submissionId,
              message: e instanceof Error ? e.message : "Failed to save grade",
            });
            // Drop the snapshot — the optimistic UI still shows the grade
            // and the teacher can re-click to retry; avoids a hot retry loop.
            s.latest = null;
          }
        }
      } finally {
        s.inFlight = false;
        setSavingGradeIds((prev) => {
          if (!prev.has(submissionId)) return prev;
          const next = new Set(prev);
          next.delete(submissionId);
          return next;
        });
      }
    },
    [applyGradeToRoster, applyGraphCall, setDetail],
  );

  const persistBreakdown = useCallback(
    (submissionId: string, breakdown: GradeBreakdownEntry[]) => {
      // Always remember the most recent snapshot to be saved; a drain
      // already running picks it up.
      saveState(submissionId).latest = breakdown;
      return drainSaves(submissionId);
    },
    [drainSaves],
  );

  // The teacher's ✓ / ✗ on a graph checklist item the drawing check
  // couldn't decide. The server re-scores the problem (applyGraphCall).
  const queueGraphCall = useCallback(
    (submissionId: string, call: GraphCall) => {
      const key = `${call.problemId}:${call.n}`;
      const s = saveState(submissionId);
      if (s.graphCalls.some((c) => `${c.problemId}:${c.n}` === key)) return;
      s.graphCalls.push(call);
      setGraphBusy((prev) => new Set(prev).add(key));
      return drainSaves(submissionId);
    },
    [drainSaves],
  );

  // Optimistic writer — mutates `detail.breakdown` in place so the
  // UI reacts instantly, then fires the save. `feedback` is kept if
  // it was already there (future AI feedback stays alongside a
  // teacher-overridden score).
  const setProblemGrade = useCallback(
    (problemId: string, status: GradeStatus, partialPercent?: number) => {
      if (!detail) return;
      // Held while a graph call on this problem is pending: the server is
      // re-scoring it, and the queued save is rebased onto that score.
      if (saveStateRef.current.get(detail.submission_id)?.graphCalls.some((c) => c.problemId === problemId)) return;
      const percent =
        status === "full" ? 100 : status === "zero" ? 0 : (partialPercent ?? 50);
      const prior = detail.breakdown ?? [];
      const existing = prior.find((b) => b.problem_id === problemId);
      // The AI's itemized ledger justifies the AI's number. Carry it
      // forward only when this write leaves the score untouched — i.e.
      // confirming the AI grade (same status + percent). The moment the
      // teacher overrides to a different grade, drop the ledger: it no
      // longer reconciles to the new number, and showing it would imply
      // the AI justified the teacher's call. The immutable ai_breakdown
      // keeps the AI's record regardless. The backend re-checks this same
      // reconciliation as a safety net.
      const keepDeductions =
        existing?.deductions != null &&
        existing.score_status === status &&
        Math.round(existing.percent) === Math.round(percent);
      const nextEntry: GradeBreakdownEntry = {
        problem_id: problemId,
        score_status: status,
        percent,
        // Confidence describes the AI's call; a teacher click never
        // updates it. Preserve whatever was previously stored — the
        // original AI value if the row came from the pipeline, or
        // null on a purely-teacher-authored grade. This keeps the row
        // from going "dirty" post-publish when the teacher re-clicks
        // a grade that already matches the published snapshot.
        confidence: existing?.confidence ?? null,
        feedback: existing?.feedback ?? null,
        deductions: keepDeductions ? existing!.deductions : null,
      };
      const nextBreakdown = existing
        ? prior.map((b) => (b.problem_id === problemId ? nextEntry : b))
        : [...prior, nextEntry];
      // A hand re-score of a graph problem takes it off the checklist
      // (the server's note_hand_edits does the same on this save): mirror
      // that now so the checklist and the roster stop asking for calls.
      const reScored = existing != null && Math.abs(existing.percent - percent) > 1e-6;
      const problems = reScored
        ? detail.problems.map((p) =>
            p.bank_item_id === problemId && p.graph && !p.graph.overridden
              ? { ...p, graph: { ...p.graph, overridden: true, open_items: 0 } }
              : p,
          )
        : detail.problems;
      setDetail({ ...detail, breakdown: nextBreakdown, problems });
      if (problems.some((p, i) => p !== detail.problems[i])) {
        setRoster((prev) =>
          prev
            ? prev.map((e) =>
                e.submission?.id === detail.submission_id
                  ? { ...e, submission: { ...e.submission, graph_items_open: openGraphItems(problems) } }
                  : e,
              )
            : prev,
        );
      }
      void persistBreakdown(detail.submission_id, nextBreakdown);
    },
    [detail, persistBreakdown, setDetail],
  );

  // Feedback writer — updates the per-problem student-facing feedback
  // without touching the grade. No-op when the problem has no breakdown
  // entry yet (textarea is disabled in that case). No-op when the text
  // equals what's already stored — prevents false-dirty saves from a
  // teacher just re-focusing the field. When the stored feedback is
  // null but the text matches the AI's reasoning default, we DO persist
  // on first save so students see the AI-generated text even if the
  // teacher didn't edit (plan locks this decision).
  const setProblemFeedback = useCallback(
    (problemId: string, text: string) => {
      if (!detail) return;
      const prior = detail.breakdown ?? [];
      const existing = prior.find((b) => b.problem_id === problemId);
      if (!existing) return;
      const nextFeedback = text.length === 0 ? null : text;
      if ((existing.feedback ?? null) === nextFeedback) return;
      const nextEntry: GradeBreakdownEntry = { ...existing, feedback: nextFeedback };
      const nextBreakdown = prior.map((b) =>
        b.problem_id === problemId ? nextEntry : b,
      );
      setDetail({ ...detail, breakdown: nextBreakdown });
      void persistBreakdown(detail.submission_id, nextBreakdown);
    },
    [detail, persistBreakdown, setDetail],
  );

  // Derived counts for the publish button state machine.
  //   pending = graded but never published
  //   dirty   = published, but edited since — republish to update
  //   graded  = union of the above plus already-clean-published
  // In-section counts are live via roster; other-section counts are
  // snapshotted at fetch time.
  const {
    pendingInSection,
    dirtyInSection,
    gradedInSection,
    reviewedToPublishInSection,
    reviewedDirtyInSection,
    flaggedToPublishInSection,
    graphToPublishInSection,
  } = useMemo(() => {
    let pending = 0;
    let dirty = 0;
    let graded = 0;
    let reviewedToPublish = 0;
    let reviewedDirty = 0;
    let flaggedToPublish = 0;
    let graphToPublish = 0;
    for (const e of roster ?? []) {
      const s = e.submission;
      if (!s || s.final_score === null) continue;
      // Class-side on purpose: `graded`'s only consumer is the
      // pill choosing between "No grades to publish" and a green "All
      // grades published". Those are claims ABOUT THE CLASS, not
      // labels on a click, so her rehearsal must not be what flips a
      // section to "all published" when none of her students' work
      // has been.
      if (!s.is_preview) graded += 1;
      const isPending = s.grade_published_at === null;
      const isDirty = !isPending && s.grade_dirty;
      if (isPending) pending += 1;
      else if (isDirty) dirty += 1;
      // A grade is "to publish" if pending or dirty; count the vetted
      // ones so the dialog can split reviewed vs unopened.
      if ((isPending || isDirty) && s.reviewed_at) reviewedToPublish += 1;
      if (isDirty && s.reviewed_at) reviewedDirty += 1;
      // Soft publish-confirm: a grade about to go out whose integrity
      // check landed on flag_for_review and the teacher hasn't resolved
      // it yet. Only flag_for_review (not the other dispositions) and
      // only while unresolved — a teacher who marked it reviewed has
      // already made the call. This is the in-section portion; the
      // cross-section portion (flaggedOtherSections) is added in below
      // so the count matches what the HW-wide publish actually releases.
      const ov = s.integrity_overview;
      // Only approved grades publish, so only they can go out flagged.
      if (
        (isPending || isDirty) &&
        s.reviewed_at &&
        ov?.disposition === "flag_for_review" &&
        ov.resolution === "unresolved"
      ) {
        flaggedToPublish += 1;
      }
      // Soft publish-confirm: a grade about to go out with graph items
      // still waiting on her ✓/✗. Those items keep their points until
      // she marks them, so the score can still drop.
      if ((isPending || isDirty) && s.reviewed_at && hasGraphToCheck(e)) {
        graphToPublish += 1;
      }
    }
    return {
      pendingInSection: pending,
      dirtyInSection: dirty,
      gradedInSection: graded,
      reviewedToPublishInSection: reviewedToPublish,
      reviewedDirtyInSection: reviewedDirty,
      flaggedToPublishInSection: flaggedToPublish,
      graphToPublishInSection: graphToPublish,
    };
  }, [roster]);
  const pendingTotal = pendingInSection + pendingOtherSections;
  const dirtyTotal = dirtyInSection + dirtyOtherSections;
  // Turned in, but no AI grade yet. AI grading is queued and runs when
  // the due date passes; a HW with no due date never grades on its own
  // (there's no moment that means "the class is in"), so for those this
  // count only ever falls when the teacher asks. Section-scoped: the
  // button acts on this HW, and showing a HW-wide number next to a
  // section-scoped action would misdescribe what pressing it does.
  //
  // Counts only what the button will actually send to the grader — the
  // server's `ai_grade_block` rule, minus anything already in flight.
  // It used to count every score-less row, including work the student
  // hadn't confirmed (no grading job existed, so the click moved zero
  // jobs and the count never went down). Ungraded work the AI won't
  // take is counted separately so it's explained, not hidden: waiting
  // on the student, no readable work, or too long to grade in one pass.
  // Work still being read is in neither — it becomes one or the other in
  // a minute.
  const {
    ungradedInSection,
    awaitingStudentInSection,
    flaggedInSection,
    cantAiGradeInSection,
    tooLongInSection,
  } =
    useMemo(() => {
      let gradeable = 0;
      let awaiting = 0;
      let flagged = 0;
      let cant = 0;
      let tooLong = 0;
      // Action counts — "Grade N ungraded" does grade her rehearsal too.
      for (const e of roster ?? []) {
        const sub = e.submission;
        if (!sub) continue;
        if (canAiGrade(sub) && !isAiGrading(sub, aiPendingIds)) gradeable += 1;
        if (sub.ai_grade_block === "awaiting_confirmation") awaiting += 1;
        if (sub.ai_grade_block === "flagged") flagged += 1;
        if (
          sub.ai_grade_block === "unreadable" ||
          sub.ai_grade_block === "no_extraction"
        ) {
          cant += 1;
        }
        if (sub.ai_grade_block === "too_long") tooLong += 1;
      }
      return {
        ungradedInSection: gradeable,
        awaitingStudentInSection: awaiting,
        flaggedInSection: flagged,
        cantAiGradeInSection: cant,
        tooLongInSection: tooLong,
      };
    }, [roster, aiPendingIds]);
  // Publishing releases approved grades only. The header button and its
  // confirm act on this section, the class she's reviewing; "Publish
  // all" in the confirm reaches every section of the homework.
  const toReleaseTotal = pendingTotal + dirtyTotal;
  const unreviewedToPublishInSection =
    pendingInSection + dirtyInSection - reviewedToPublishInSection;
  const reviewedToPublishTotal =
    reviewedToPublishInSection +
    pendingReviewedOtherSections +
    dirtyReviewedOtherSections;
  const unreviewedToPublishTotal = toReleaseTotal - reviewedToPublishTotal;

  const { publish, publishing, publishError, setPublishError } = usePublishGrades({
    assignmentId,
    sectionId,
    setRoster,
    setDetail,
    pendingReviewedOtherSections,
    dirtyReviewedOtherSections,
    setPendingOtherSections,
    setDirtyOtherSections,
    setPendingReviewedOtherSections,
    setDirtyReviewedOtherSections,
  });
  const publishFromConfirm = useCallback(
    (scope: "section" | "all") => {
      void publish({ kind: scope }).then((ok) => {
        if (ok) setPublishConfirmOpen(false);
      });
    },
    [publish, setPublishConfirmOpen],
  );
  // One student, from their panel: only once approved, and only when
  // there's something new to release (never published, or edited since).
  // A failure shows on that student's panel, not in the section confirm.
  const [studentPublishFailedFor, setStudentPublishFailedFor] = useState<string | null>(null);
  const selectedSub = selectedEntry?.submission ?? null;
  const publishStudent = useMemo(() => {
    const s = selectedSub;
    if (!s || s.final_score === null || !s.reviewed_at) return null;
    if (s.grade_published_at !== null && !s.grade_dirty) return null;
    return {
      update: s.grade_published_at !== null,
      failed: studentPublishFailedFor === s.id,
      run: () => {
        setStudentPublishFailedFor(null);
        void publish({ kind: "student", submissionId: s.id }).then((ok) => {
          if (!ok) setStudentPublishFailedFor(s.id);
        });
      },
    };
  }, [selectedSub, publish, studentPublishFailedFor]);

  // "Grade all". AI grading is queued and normally runs when the due
  // date passes; a HW with no due date never grades on its own, so for
  // those this is the only path. Grading happens server-side after the
  // request returns, so we poll rather than patching state
  // optimistically — the grades genuinely aren't ready yet, and showing
  // scores that don't exist would be worse than showing a spinner.
  const [gradingAll, setGradingAll] = useState(false);
  const [gradeAllError, setGradeAllError] = useState<string | null>(null);
  const onGradeAllClick = useCallback(async () => {
    setGradingAll(true);
    setGradeAllError(null);
    // Exactly the rows the server will act on (same rule, same scope).
    const sent = (roster ?? [])
      .map((e) => e.submission)
      .filter(
        (s): s is TeacherSubmissionRow =>
          !!s && canAiGrade(s) && !isAiGrading(s, aiPendingIds),
      )
      .map((s) => s.id);
    try {
      await teacher.gradePendingSubmissions(assignmentId, sectionId);
      watchGrades(sent);
    } catch (e) {
      setGradeAllError(
        e instanceof Error ? e.message : "Couldn't start grading",
      );
    } finally {
      setGradingAll(false);
    }
  }, [assignmentId, sectionId, roster, aiPendingIds, watchGrades]);

  // "Grade with AI" on the open submission. First grading only — the
  // server refuses anything with grade data, and the button is only
  // offered when `ai_grade_block` is null.
  const onGradeWithAi = useCallback(async (submissionId: string) => {
    setAiGradeError((prev) =>
      prev?.forSubmissionId === submissionId ? null : prev,
    );
    watchGrades([submissionId]);
    try {
      await teacher.gradeSubmissionNow(submissionId);
    } catch (e) {
      // A refusal usually means this page is behind the server — most
      // often the grade already landed. Reload the row (and the open
      // pane) so the teacher sees why, instead of an error sitting
      // next to a button the fresh state wouldn't offer. The button
      // stays in its busy state until then, so a second click can't
      // fire another refused request.
      const fresh = await teacher
        .submissions(assignmentId)
        .then((res) => res.submissions.find((r) => r.id === submissionId))
        .catch(() => undefined);
      if (fresh) {
        if (fresh.final_score !== null) {
          const d = await teacher.submissionDetail(submissionId).catch(() => null);
          if (d) setDetail((cur) => (cur?.submission_id === d.submission_id ? d : cur));
        }
        setRoster((prev) =>
          prev
            ? prev.map((entry) =>
                entry.submission?.id === submissionId
                  ? { ...entry, submission: fresh }
                  : entry,
              )
            : prev,
        );
      }
      setAiPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(submissionId);
        return next;
      });
      // The grade is on screen now — that is the answer.
      if (fresh && fresh.final_score !== null) return;
      setAiGradeError({
        forSubmissionId: submissionId,
        message: e instanceof Error ? e.message : "Couldn't start AI grading",
      });
    }
  }, [assignmentId, watchGrades, setDetail]);

  // Poll until every submission sent to the grader settles. A grade
  // lands in seconds to a minute; the old single refetch right after
  // "Grade all" almost always ran before any grade existed, so the page
  // showed the same ungraded state it started from. Only the watched
  // rows are merged back, so an in-flight grade edit elsewhere on the
  // roster can't be overwritten by a poll.
  const aiPendingRef = useRef(aiPendingIds);
  const selectedSubmissionIdRef = useRef(selectedSubmissionId);
  useEffect(() => {
    aiPendingRef.current = aiPendingIds;
    selectedSubmissionIdRef.current = selectedSubmissionId;
  }, [aiPendingIds, selectedSubmissionId]);
  const polling = aiPendingIds.size > 0;
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await teacher.submissions(assignmentId);
        if (cancelled) return;
        const watched = aiPendingRef.current;
        const fresh = new Map(
          res.submissions
            .filter((r) => watched.has(r.id))
            .map((r) => [r.id, r] as const),
        );
        const settled: TeacherSubmissionRow[] = [];
        for (const r of fresh.values()) {
          const inFlight =
            r.final_score === null &&
            (r.grading_job_status === "queued" ||
              r.grading_job_status === "running");
          if (!inFlight) settled.push(r);
        }
        // The open detail pane caches its own copy — reload it so the
        // AI's per-problem grades appear without a click away and back.
        // Fetched BEFORE the pending set shrinks: emptying it ends this
        // effect, and a fetch still awaiting then would be discarded.
        const openId = selectedSubmissionIdRef.current;
        const openLanded = settled.find(
          (r) => r.id === openId && r.final_score !== null,
        );
        if (openLanded) {
          const d = await teacher.submissionDetail(openLanded.id);
          if (cancelled) return;
          setDetail((cur) => (cur?.submission_id === d.submission_id ? d : cur));
        }
        // Row and pane update in the same render, so the header never
        // flashes "Not graded yet" between the two. A row the server
        // reports unchanged keeps its object: no re-render of a roster
        // that hasn't moved, and its cached detail stays valid.
        setRoster((prev) => {
          if (!prev) return prev;
          let changed = false;
          const next = prev.map((e) => {
            const r = e.submission && fresh.get(e.submission.id);
            if (!r || !e.submission || sameRow(r, e.submission)) return e;
            changed = true;
            return { ...e, submission: r };
          });
          return changed ? next : prev;
        });
        for (const r of settled) {
          if (r.grading_job_status === "failed" && r.final_score === null) {
            setAiGradeError({
              forSubmissionId: r.id,
              message: "The AI couldn't grade this one. Try again, or grade it by hand.",
            });
          }
        }
        if (settled.length > 0) {
          setAiPendingIds((prev) => {
            const next = new Set(prev);
            for (const r of settled) next.delete(r.id);
            return next;
          });
        }
      } catch {
        // A failed poll is not a failed grade — try again next tick.
      }
      // Outside the try on purpose: a poll that keeps failing must still
      // give up. A successful last tick has just refetched the watched
      // rows, so anything still `running` on the server keeps its
      // in-progress state from that fresh read, labelled as unwatched.
      if (cancelled) return;
      if (Date.now() - watchSinceRef.current > AI_GRADE_POLL_TIMEOUT_MS) {
        setAiPollGaveUp(true);
        setAiPendingIds(new Set());
        return;
      }
      if (!cancelled) {
        timer = setTimeout(run, aiGradePollDelay(Date.now() - watchSinceRef.current));
      }
    };
    // Nobody is looking at a hidden tab, so don't spend requests on it:
    // park the next look until the tab is visible again, then look at
    // once. Still one request at a time — a parked poll has no timer
    // and no tick in flight, and only the listener restarts it.
    let parked = false;
    const run = () => {
      if (cancelled) return;
      if (document.hidden) {
        parked = true;
        return;
      }
      void tick();
    };
    const onVisibility = () => {
      if (document.hidden || !parked) return;
      parked = false;
      run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    timer = setTimeout(run, aiGradePollDelay(0));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [polling, assignmentId, pollKick, setDetail]);

  // Publish-button click gate. Straight through only when there's
  // nothing to say: every grade to release in this section is approved,
  // none is flagged or has graph items open, and no other section has
  // approved grades she might want to publish with them. Otherwise the
  // confirm says what goes and what stays hidden. A direct publish that
  // errors falls back to the confirm so its error and retry show.
  const onPublishClick = useCallback(() => {
    const quiet =
      reviewedToPublishInSection > 0 &&
      unreviewedToPublishInSection === 0 &&
      flaggedToPublishInSection === 0 &&
      graphToPublishInSection === 0 &&
      reviewedToPublishTotal === reviewedToPublishInSection;
    // A failed student publish shares the error slot; it belongs on
    // that student's panel, never in this confirm.
    setPublishError(null);
    if (!quiet) {
      setPublishConfirmOpen(true);
      return;
    }
    void publish({ kind: "section" }).then((ok) => {
      if (!ok) setPublishConfirmOpen(true);
    });
  }, [
    reviewedToPublishInSection,
    unreviewedToPublishInSection,
    flaggedToPublishInSection,
    graphToPublishInSection,
    reviewedToPublishTotal,
    publish,
    setPublishError,
    setPublishConfirmOpen,
  ]);

  // Explicit approval — the teacher's deliberate "I've vouched for this"
  // click on the Approve button of an AI grade (hand grades self-approve
  // on save; see persistBreakdown).
  // Mirrors reviewed_at onto the roster row + open detail so the markers
  // flip without a refetch. Errors surface on the saveError channel
  // (scoped by id).
  const handleMarkReviewed = useCallback(
    async (submissionId: string): Promise<boolean> => {
      setMarkingReviewedId(submissionId);
      setSaveError((prev) =>
        prev?.forSubmissionId === submissionId ? null : prev,
      );
      try {
        const res = await teacher.markReviewed(submissionId);
        setRoster((prev) =>
          prev
            ? prev.map((e) =>
                e.submission?.id === submissionId
                  ? {
                      ...e,
                      submission: { ...e.submission, reviewed_at: res.reviewed_at },
                    }
                  : e,
              )
            : prev,
        );
        setDetail((d) =>
          d && d.submission_id === submissionId
            ? { ...d, reviewed_at: res.reviewed_at }
            : d,
        );
        return true;
      } catch (e) {
        setSaveError({
          forSubmissionId: submissionId,
          message: e instanceof Error ? e.message : "Failed to approve",
        });
        return false;
      } finally {
        setMarkingReviewedId(null);
      }
    },
    [setDetail],
  );


  // Undo an approval — clears reviewed_at server-side, then mirrors it
  // back to null on the roster row + open detail so the submission drops
  // to "not reviewed" without a refetch. Reuses markingReviewedId as the
  // shared per-submission busy flag; errors share the saveError channel.
  const handleUnmarkReviewed = useCallback(
    async (submissionId: string) => {
      setMarkingReviewedId(submissionId);
      setSaveError((prev) =>
        prev?.forSubmissionId === submissionId ? null : prev,
      );
      try {
        await teacher.unmarkReviewed(submissionId);
        setRoster((prev) =>
          prev
            ? prev.map((e) =>
                e.submission?.id === submissionId
                  ? {
                      ...e,
                      submission: { ...e.submission, reviewed_at: null },
                    }
                  : e,
              )
            : prev,
        );
        setDetail((d) =>
          d && d.submission_id === submissionId
            ? { ...d, reviewed_at: null }
            : d,
        );
      } catch (e) {
        setSaveError({
          forSubmissionId: submissionId,
          message: e instanceof Error ? e.message : "Failed to undo approval",
        });
      } finally {
        setMarkingReviewedId(null);
      }
    },
    [setDetail],
  );

  // Waive or restore one student's late penalty. The server re-scores
  // and returns the lateness fields; mirror them onto the open detail
  // and the roster row so the score and the "late" marker agree.
  const [waivingLateId, setWaivingLateId] = useState<string | null>(null);
  const handleLatePenaltyWaived = useCallback(async (submissionId: string, waived: boolean) => {
    setWaivingLateId(submissionId);
    try {
      const res = await teacher.setLatePenaltyWaived(submissionId, waived);
      const patch = {
        final_score: res.final_score,
        grade_dirty: res.grade_dirty,
        days_late: res.days_late,
        late_penalty_percent: res.late_penalty_percent,
        late_penalty: res.late_penalty,
        late_penalty_waived: res.late_penalty_waived,
      };
      setDetail((d) => (d && d.submission_id === submissionId ? { ...d, ...patch } : d));
      setRoster((prev) =>
        prev
          ? prev.map((e) =>
              e.submission?.id === submissionId
                ? { ...e, submission: { ...e.submission, ...patch } }
                : e,
            )
          : prev,
      );
    } catch (e) {
      setSaveError({
        forSubmissionId: submissionId,
        message: e instanceof Error ? e.message : "Couldn't change the late penalty",
      });
    } finally {
      setWaivingLateId(null);
    }
  }, [setDetail]);

  // A reopen (or its undo) moves this student's due date, which re-prices
  // their lateness and possibly their score on the server. Refetch their
  // row and, if it's open, their detail, rather than guessing the result.
  const handleReopenChanged = useCallback(
    async (studentId: string) => {
      try {
        const res = await teacher.submissions(assignmentId);
        const row = res.submissions.find((r) => r.student_id === studentId) ?? null;
        setRoster((prev) =>
          prev
            ? prev.map((e) =>
                e.student_id === studentId
                  ? {
                      ...e,
                      submission: row ?? e.submission,
                      personal_due_at: res.personal_due_dates[studentId] ?? null,
                    }
                  : e,
              )
            : prev,
        );
        if (row) {
          const d = await teacher.submissionDetail(row.id);
          setDetail((cur) => (cur?.submission_id === d.submission_id ? d : cur));
        }
      } catch {
        // The reopen itself landed; a stale row corrects on the next load.
      }
    },
    [assignmentId, setDetail],
  );

  // Re-run AI grading with the assignment's current rubric. Overrides
  // any manual edits (this is the teacher's explicit ask) and leaves
  // the published snapshot untouched so students keep seeing the old
  // grade until the teacher republishes. Closes the confirm dialog,
  // mirrors the fresh grade back onto roster + detail so the UI flips
  // out of the drifted state immediately.
  //
  // A regrade REVOKES any prior approval — same rationale as an edit: the
  // approval vouched for the grade that just got replaced. The server does
  // this unconditionally on force regrade (grading_ai.run_ai_grading_for_
  // submission clears reviewed_by/reviewed_at), so we mirror reviewed_at →
  // null optimistically here — otherwise a stale "Approved ✓" pill would sit
  // over a freshly-changed grade until a refetch. Approve/Undo are disabled
  // for this row while `regrading` is set (see SubmissionDetailPanel), which
  // closes the TOCTOU window where a teacher could approve mid-regrade.
  // Flip a question's "requires a drawing" flag from the review page —
  // where a teacher sees the drawing and can regrade. Allowed on
  // published homework: it changes what future grading requires, never
  // a published grade.
  const setRequiresDrawing = useCallback(async (bankItemId: string, next: boolean) => {
    await teacher.updateBankItem(bankItemId, { requires_drawing: next });
    // The flag is the question's, so every cached student carries it.
    detailCache.clear();
    setDetail((d) =>
      d
        ? {
            ...d,
            problems: d.problems.map((p) =>
              p.bank_item_id === bankItemId ? { ...p, requires_drawing: next } : p,
            ),
          }
        : d,
    );
  }, [detailCache, setDetail]);

  const handleRegrade = useCallback(
    async (submissionId: string) => {
      setRegradingSubmissionId(submissionId);
      setRegradeError((prev) =>
        prev?.forSubmissionId === submissionId ? null : prev,
      );
      try {
        const res = await teacher.regradeSubmission(submissionId);
        setRoster((prev) =>
          prev
            ? prev.map((e) =>
                e.submission?.id === submissionId
                  ? {
                      ...e,
                      submission: {
                        ...e.submission,
                        final_score: res.final_score,
                        late_penalty: res.late_penalty,
                        breakdown: res.breakdown,
                        rubric_snapshot: res.rubric_snapshot,
                        grade_dirty: res.grade_dirty,
                        // Regrade replaced the grade — the server cleared the
                        // approval, so drop it locally too.
                        reviewed_at: null,
                      },
                    }
                  : e,
              )
            : prev,
        );
        setDetail((d) =>
          d && d.submission_id === submissionId
            ? {
                ...d,
                breakdown: res.breakdown,
                ai_breakdown: res.ai_breakdown,
                final_score: res.final_score,
                late_penalty: res.late_penalty,
                grade_dirty: res.grade_dirty,
                reviewed_at: null,
              }
            : d,
        );
        setRegradeConfirmOpenFor(null);
      } catch (e) {
        setRegradeError({
          forSubmissionId: submissionId,
          message: e instanceof Error ? e.message : "Failed to regrade",
        });
      } finally {
        setRegradingSubmissionId(null);
      }
    },
    [setDetail, setRegradeConfirmOpenFor],
  );

  // Next submitter whose grade isn't released to students yet —
  // either never published or dirty-since-edit — and the next one still
  // waiting on her Approve, where Approve & next goes. Both wrap, and are
  // null when no other student qualifies.
  const nextStudent = useMemo<RosterEntry | null>(
    () =>
      roster && selectedEntry
        ? nextMatching(roster, selectedEntry.student_id, needsTeacher)
        : null,
    [roster, selectedEntry],
  );
  const nextToApprove = useMemo<RosterEntry | null>(
    () =>
      roster && selectedEntry
        ? nextMatching(roster, selectedEntry.student_id, awaitsApproval)
        : null,
    [roster, selectedEntry],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10">
      <div className="pt-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted transition-colors hover:text-text-primary"
        >
          ← Back to submissions
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-[34px] leading-tight tracking-[-0.015em] text-text-primary">
            {pageTitle}
          </h1>
          {roster !== null && submittedCount > 0 && (
            <p className="mt-1.5 text-[12.5px] text-text-secondary">
              Reviewing{" "}
              <b className="font-bold text-text-primary">
                {submittedCount} of {totalRoster}
              </b>{" "}
              submitted ·{" "}
              {/* Ungraded is checked FIRST and stated plainly. An ungraded
                  submission is neither flagged nor low-confidence, so it
                  falls out of `needsEyesCount` — which used to be
                  harmless, because grading ran seconds after a student
                  confirmed and nobody saw the gap. Now grading waits for
                  the due date, so "the AI is confident on every
                  submission" would be shown routinely about work the AI
                  has not looked at. Never claim confidence in a verdict
                  that doesn't exist. */}
              {awaitingOnlyCount > 0 ? (
                <>
                  <b className="font-bold text-text-primary">
                    {awaitingOnlyCount}
                  </b>{" "}
                  not graded yet
                  {needsEyesCount > 0 ? (
                    <>
                      {" · "}
                      <b className="font-bold text-text-primary">
                        {needsEyesCount}
                      </b>{" "}
                      {needsEyesCount === 1 ? "needs" : "need"} your eyes.
                    </>
                  ) : (
                    <>.</>
                  )}
                </>
              ) : needsEyesCount > 0 ? (
                <>
                  <b className="font-bold text-text-primary">{needsEyesCount}</b>{" "}
                  {needsEyesCount === 1 ? "needs" : "need"} your eyes · the AI is
                  confident on the rest.
                </>
              ) : (
                <>the AI is confident on every submission.</>
              )}{" "}
              <span className="font-serif italic text-text-secondary">
                You stay the judge — confirm every grade.
              </span>
            </p>
          )}
          {roster !== null && totalRoster > 0 && submittedCount === 0 && (
            <p className="mt-1.5 text-[12.5px] text-text-secondary">
              <b className="font-bold text-text-primary">
                0 of {totalRoster}
              </b>{" "}
              submitted · No submissions yet — waiting on{" "}
              {totalRoster === 1 ? "this student" : "these students"} to turn in
              work.
            </p>
          )}
        </div>
        {roster !== null && (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <GradeAllButton
                ungradedCount={ungradedInSection}
                busy={gradingAll}
                onClick={onGradeAllClick}
              />
              <PublishButton
                approved={reviewedToPublishInSection}
                approvedEdits={reviewedDirtyInSection}
                unapproved={unreviewedToPublishInSection}
                graded={gradedInSection}
                approvedOtherSections={reviewedToPublishTotal - reviewedToPublishInSection}
                onOpen={onPublishClick}
              />
            </div>
            {gradeAllError && (
              // Inline rather than a toast: the failed action is right
              // here, and a teacher who missed a disappearing toast
              // would reasonably think grading had started.
              <p role="alert" className="text-[11.5px] font-semibold text-red-600">
                {gradeAllError}
              </p>
            )}
            {(awaitingStudentInSection > 0 ||
              flaggedInSection > 0 ||
              cantAiGradeInSection > 0 ||
              tooLongInSection > 0) && (
              // Ungraded work the button won't touch — said once, here,
              // so the count beside it reads as complete rather than
              // quietly short. Each row names its own reason.
              <p className="text-[11.5px] text-text-muted">
                {[
                  awaitingStudentInSection > 0 &&
                    `${awaitingStudentInSection} waiting on ${
                      awaitingStudentInSection === 1 ? "the student" : "students"
                    } to confirm`,
                  flaggedInSection > 0 &&
                    `${flaggedInSection} flagged as misread — grade from the photo`,
                  cantAiGradeInSection > 0 &&
                    `${cantAiGradeInSection} can’t be AI-graded — no readable work`,
                  tooLongInSection > 0 &&
                    `${tooLongInSection} too long for AI — grade by hand`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 text-sm text-[color:var(--color-error)]">{error}</p>
      )}

      {roster === null && !error && <ReviewLoadingSkeleton />}

      {/* Class-side: her rehearsal being the only row must not suppress
          the onboarding card. This is exactly the state it exists for —
          she previews before anyone has joined. */}
      {classRoster !== null && classRoster.length === 0 && (
        <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-[color:var(--color-surface-alt-2)] p-10 text-center">
          <p className="text-sm font-bold text-text-primary">
            No students in this section yet
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Invite students from the Sections tab, then publish homework.
          </p>
        </div>
      )}

      {roster !== null && roster.length > 0 && (
        // 3-column split: roster | grade column | pinned photo. The photo
        // rail is the 3rd track only on the wide (xl, >=1280px) layout;
        // below that it's display:none and the strip thumbnail in the grade
        // column takes over, so roster + grade never get crushed. xl (a
        // named breakpoint) is used over an arbitrary min-[1100px] because
        // arbitrary min-[] variants don't sort with the breakpoint scale —
        // md:grid-cols would cascade after and override it.
        <div className="mt-5 grid items-start gap-5 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_372px]">
          {/* Student list — uncertainty-first triage groups */}
          <aside className="self-start rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                Students · {submittedCount}/{totalRoster} submitted
              </span>
              <VerdictLegendTrigger />
            </div>
            <RosterFilterBar
              roster={roster}
              value={rosterFilter}
              onChange={setRosterFilter}
            />
            <div className="max-h-[78vh] overflow-y-auto">
              <TriageRoster
                roster={applyRosterFilter(roster, rosterFilter)}
                filter={rosterFilter}
                selectedStudentId={selectedStudentId}
                onSelect={selectStudent}
                aiPendingIds={aiPendingIds}
                aiPollGaveUp={aiPollGaveUp}
              />
            </div>
          </aside>

          {/* Detail / grade column */}
          <section className="min-w-0">
            {!selectedEntry && (
              <div className="rounded-[--radius-xl] border border-border-light bg-[color:var(--color-surface-alt-2)] p-10 text-center text-sm text-text-muted">
                Pick a student on the left to see their work.
              </div>
            )}
            {selectedEntry && !selectedEntry.submission && (
              <NotSubmittedCard
                entry={selectedEntry}
                reopen={
                  <ReopenControl
                    assignmentId={assignmentId}
                    studentId={selectedEntry.student_id}
                    studentName={selectedEntry.student_name}
                    submitted={false}
                    classDueAt={hwDueAt}
                    personalDueAt={selectedEntry.personal_due_at}
                    reopenedAt={null}
                    onChanged={() => void handleReopenChanged(selectedEntry.student_id)}
                  />
                }
              />
            )}
            {selectedEntry?.submission && detailLoading && (
              <DetailSkeleton />
            )}
            {selectedEntry?.submission && currentFetchError && (
              <p className="text-sm text-[color:var(--color-error)]">{currentFetchError}</p>
            )}
            {detailIsCurrent && detail && selectedEntry?.submission && (
              <SubmissionDetailPanel
                detail={detail}
                reportBase={{
                  submission_id: detail.submission_id,
                  assignment_id: detail.assignment_id,
                  course_id: courseId,
                  section_id: sectionId,
                  student_id: detail.student_id,
                }}
                integrity={
                  integrity?.submission_id === selectedSubmissionId
                    ? integrity
                    : null
                }
                rubric={rubric}
                rubricOpen={rubricOpen}
                onToggleRubric={setRubricOpen}
                row={selectedEntry.submission}
                saveError={currentSaveError}
                nextStudent={nextStudent}
                onSelectNext={() => {
                  if (nextStudent) selectStudent(nextStudent.student_id);
                }}
                focusProblem={
                  problemFocus?.studentId === detail.student_id
                    ? problemFocus.position
                    : null
                }
                onProblemFocused={clearProblemFocus}
                toReleaseTotal={reviewedToPublishInSection}
                onPublish={onPublishClick}
                onPublishStudent={publishStudent}
                publishingStudent={publishing}
                onGradeProblem={setProblemGrade}
                onFeedbackChange={setProblemFeedback}
                onIntegrityResolved={handleIntegrityResolved}
                integrityDetailsOpen={integrityDetailsOpen}
                onToggleIntegrityDetails={toggleIntegrityDetails}
                onMarkReviewed={() =>
                  void handleMarkReviewed(selectedEntry.submission!.id)
                }
                onApproveAndNext={
                  nextToApprove
                    ? () => {
                        // Approve, then open the next student still
                        // waiting on her — unless she's already moved
                        // to someone else while it saved.
                        const approvedId = selectedEntry.submission!.id;
                        const target = nextToApprove.student_id;
                        void handleMarkReviewed(approvedId).then((ok) => {
                          if (ok && selectedSubmissionIdRef.current === approvedId) {
                            selectStudent(target);
                          }
                        });
                      }
                    : null
                }
                onUnmarkReviewed={() =>
                  void handleUnmarkReviewed(selectedEntry.submission!.id)
                }
                onGraphVerdict={(problemId, n, verdict) =>
                  void queueGraphCall(selectedEntry.submission!.id, { problemId, n, verdict })
                }
                graphBusy={graphBusy}
                onLatePenaltyWaivedChange={(waived) =>
                  void handleLatePenaltyWaived(selectedEntry.submission!.id, waived)
                }
                waivingLate={waivingLateId === selectedEntry.submission.id}
                reopen={
                  selectedEntry.submission.is_preview ? null : (
                    <ReopenControl
                      assignmentId={assignmentId}
                      studentId={selectedEntry.student_id}
                      studentName={selectedEntry.student_name}
                      submitted
                      classDueAt={hwDueAt}
                      personalDueAt={selectedEntry.personal_due_at}
                      reopenedAt={detail.reopened_at}
                      onChanged={() => void handleReopenChanged(selectedEntry.student_id)}
                    />
                  )
                }
                marking={markingReviewedId === selectedEntry.submission.id}
                savingGrade={savingGradeIds.has(selectedEntry.submission.id)}
                regrading={regradingSubmissionId === selectedEntry.submission.id}
                regradeError={
                  regradeError?.forSubmissionId === selectedEntry.submission.id
                    ? regradeError.message
                    : null
                }
                onRequiresDrawingChange={setRequiresDrawing}
                onRegradeRequest={() =>
                  setRegradeConfirmOpenFor(selectedEntry.submission!.id)
                }
                aiGrading={isAiGrading(selectedEntry.submission, aiPendingIds)}
                aiGradingUnwatched={
                  aiPollGaveUp &&
                  !aiPendingIds.has(selectedEntry.submission.id)
                }
                aiGradeError={
                  aiGradeError?.forSubmissionId === selectedEntry.submission.id
                    ? aiGradeError.message
                    : null
                }
                onGradeWithAi={() =>
                  void onGradeWithAi(selectedEntry.submission!.id)
                }
                confirmedIds={
                  confirmedBySubmission.get(selectedEntry.submission.id) ??
                  EMPTY_ID_SET
                }
                onConfirmProblems={handleConfirmProblems}
                announceGrade={announceGrade}
                announce={announce}
              />
            )}
          </section>

          {/* Pinned rail — wide (xl) layout only: the compact integrity
              card over the student's work, in one sticky column sized to
              the viewport. Below xl the card sits in the grade column and
              the strip thumbnail stands in for the photo. self-stretch
              overrides the grid's items-start so the aside spans the whole
              row — sticky needs a taller parent to travel in. */}
          <aside className="hidden self-stretch xl:block">
            <div className="sticky top-3 flex max-h-[calc(100vh-4rem)] flex-col gap-3">
              {detailIsCurrent && detail && selectedEntry?.submission && (
                // Never squeezed by the photo; capped so a long expanded
                // summary scrolls inside the card instead of pushing the
                // photo off-screen. The photo takes the rest of the column.
                <div className="max-h-[60vh] shrink-0 overflow-y-auto empty:hidden">
                  <IntegrityCard
                    integrity={
                      integrity?.submission_id === selectedSubmissionId
                        ? integrity
                        : null
                    }
                    overviewFallback={selectedEntry.submission.integrity_overview}
                    unfinished={selectedEntry.submission.unfinished_check}
                    onResolved={handleIntegrityResolved}
                    detailsOpen={integrityDetailsOpen}
                    onToggleDetails={toggleIntegrityDetails}
                  />
                </div>
              )}
              <PinnedWorkRail
                files={
                  detailIsCurrent && detail && selectedEntry?.submission
                    ? detail.files
                    : null
                }
                studentName={
                  detailIsCurrent && detail ? detail.student_name : null
                }
                pinned={photoPinned}
                onTogglePinned={() => setPhotoPinned((v) => !v)}
              />
            </div>
          </aside>
        </div>
      )}

      {/* One polite live region for the whole grading flow, mounted for
          the life of the page so assistive tech can keep watching the
          same node. `aria-live` rather than `role="alert"`: a grade is a
          confirmation, not an interruption, and assertive would talk
          over the row the teacher just moved to. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {gradeAnnouncement}
      </span>

      <PublishConfirmDialog
        open={publishConfirmOpen}
        onClose={() => {
          if (!publishing) {
            setPublishConfirmOpen(false);
            setPublishError(null);
          }
        }}
        sectionName={sectionName}
        approved={reviewedToPublishInSection}
        approvedEdits={reviewedDirtyInSection}
        unapproved={unreviewedToPublishInSection}
        flagged={flaggedToPublishInSection}
        graph={graphToPublishInSection}
        approvedAll={reviewedToPublishTotal}
        unapprovedAll={unreviewedToPublishTotal}
        flaggedOther={flaggedOtherSections}
        graphOther={graphOtherSections}
        publishing={publishing}
        error={publishError}
        onPublish={publishFromConfirm}
      />

      <RegradeConfirmDialog
        submissionId={regradeConfirmOpenFor}
        // Scope annotations for the confirm body — only read when the
        // dialog is open, so lazy-lookup is fine.
        row={
          regradeConfirmOpenFor
            ? (roster?.find((e) => e.submission?.id === regradeConfirmOpenFor)
                ?.submission ?? null)
            : null
        }
        regrading={regradingSubmissionId !== null}
        // A failed regrade leaves the modal open so the teacher can
        // retry or cancel. Error is scoped by submissionId so a stale
        // failure from a different row doesn't leak in when the dialog
        // opens on a new student.
        error={
          regradeConfirmOpenFor &&
          regradeError?.forSubmissionId === regradeConfirmOpenFor
            ? regradeError.message
            : null
        }
        onClose={() => {
          if (regradingSubmissionId === null) setRegradeConfirmOpenFor(null);
        }}
        onConfirm={() => {
          if (regradeConfirmOpenFor) void handleRegrade(regradeConfirmOpenFor);
        }}
      />
    </div>
  );
}
