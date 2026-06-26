"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MathText } from "@/components/shared/math-text";
import { Modal } from "@/components/ui/modal";
import {
  ActivityDigest,
  ActivityPill,
  ActivityTurnMarker,
  RowDispositionPill,
  type IntegrityActivityNotableTurnLite,
} from "@/components/school/teacher/_pieces/submissions-panel";
import { Skeleton } from "@/components/ui";
import {
  teacher,
  type AiGradeEntry,
  type GradeBreakdownEntry,
  type IntegrityDisposition,
  type ItemAnalysisResponse,
  type SubmissionFile,
  type TeacherIntegrityDetail,
  type TeacherIntegrityTranscriptTurn,
  type TeacherRubric,
  type TeacherSubmissionDetail,
  type TeacherSubmissionDetailProblem,
  type TeacherSubmissionRow,
  type TeacherSubmissionStep,
} from "@/lib/api";

type GradeStatus = GradeBreakdownEntry["score_status"];

// Rubric drift — does the grade's frozen rubric snapshot differ from
// the assignment's current rubric? Normalizes both sides to the same
// four-field shape with missing fields treated as empty strings, so a
// null snapshot and a teacher who only set `full_credit` compare
// honestly. Returns false when both sides agree (no regrade needed)
// and true on any field-level difference.
const RUBRIC_FIELDS = ["full_credit", "partial_credit", "common_mistakes", "notes"] as const;
function rubricChanged(
  current: TeacherRubric | null,
  snapshot: TeacherRubric | null,
): boolean {
  const a = current ?? {};
  const b = snapshot ?? {};
  return RUBRIC_FIELDS.some((f) => (a[f] ?? "") !== (b[f] ?? ""));
}

/**
 * Grading review workspace: one HW × one section.
 *
 * Route: /school/teacher/courses/[id]/homework/[hwId]/sections/[sid]/review
 *
 * Two-pane layout — left is the full section roster (every enrolled
 * student, whether they've submitted or not), right is the selected
 * student's work. Students who haven't submitted are visible in the
 * list with a "Not submitted" marker so the teacher can spot missing
 * work at a glance.
 *
 * Grading model: per-problem Full/Partial/Zero picks auto-save on
 * every click (the backend accepts full-replacement breakdown writes).
 * The overall percent is the backend's average of the per-problem
 * percents; we show it live in the detail pane's summary card. A
 * "Next student →" button jumps to the next submitter that still
 * needs a published grade. Publishing is a one-click, HW-wide action
 * gated by a confirmation dialog (the backend publishes every graded
 * submission on the HW at once — the dialog discloses cross-section
 * scope when applicable).
 */
type RosterEntry = {
  student_id: string;
  student_name: string;
  student_email: string;
  /** Present if the student has submitted; null if they haven't. */
  submission: TeacherSubmissionRow | null;
};

type RosterFilter = "all" | "needs_me" | "flagged";

export default function HomeworkSectionReviewPage({
  params,
}: {
  params: Promise<{ id: string; hwId: string; sid: string }>;
}) {
  const { id: courseId, hwId: assignmentId, sid: sectionId } = use(params);
  const backHref = `/school/teacher/courses/${courseId}?tab=submissions`;

  const [hwTitle, setHwTitle] = useState<string>("");
  const [sectionName, setSectionName] = useState<string>("");
  // Teacher's rubric for this HW — rendered as an expandable panel at
  // the top of the Problems card so the teacher can sanity-check the
  // AI's grades against their own stated criteria. Null when no rubric
  // was authored (all rubric fields empty or the HW predates rubrics).
  const [rubric, setRubric] = useState<TeacherRubric | null>(null);
  // Rubric visibility is a session preference, not a per-student one.
  // Lifting it here means expanding the rubric on student A keeps it
  // expanded when the teacher hits "Next student" — otherwise
  // SubmissionDetailPanel unmounts during the switch and local state
  // inside RubricSection would reset to collapsed every time.
  const [rubricOpen, setRubricOpen] = useState(false);
  // Assignment-wide item analysis — per-problem score distribution
  // across every graded submission on this HW (all sections). Fetched
  // once on mount, independent of the roster/detail panels. Rendered as
  // a collapsible panel at the top of the review content. `null` while
  // loading; `error` carries a fetch failure so the panel can show it
  // inline without disturbing grading.
  const [itemAnalysisOpen, setItemAnalysisOpen] = useState(false);
  const [itemAnalysis, setItemAnalysis] = useState<ItemAnalysisResponse | null>(null);
  const [itemAnalysisError, setItemAnalysisError] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  // Roster filter — narrows the left pane by verdict / status. The
  // most useful default is "needs me" (anything flagged or ungraded);
  // we keep it on "all" for now so teachers don't lose context on
  // first land, but the filter chip is the fastest path from "show
  // me everyone" to "show me only the cheaters".
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("all");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  // Last-fetched detail, kept as-is across switches. Staleness for
  // the current selection is detected at render via a submission_id
  // comparison, avoiding a setState-in-effect on every switch. Not a
  // multi-student cache: `detail` is a single slot, so A→B→A re-fetches
  // A. Fetch/save errors are scoped to a submissionId so a failure on
  // one student's grade doesn't render on another student's card.
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  // Full integrity detail (overall verdict + reasoning + transcript)
  // is a separate endpoint from submission detail. Single-slot cache
  // keyed off submission_id, same staleness-by-derivation pattern as
  // `detail`. Null on: HW has integrity disabled, or no check ran.
  const [integrity, setIntegrity] = useState<TeacherIntegrityDetail | null>(null);
  const [fetchError, setFetchError] = useState<
    { forSubmissionId: string; message: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<
    { forSubmissionId: string; message: string } | null
  >(null);
  // Counters for grades in *other* sections of this HW. Snapshotted
  // from the initial fetch — the publish endpoint is HW-wide, so the
  // dialog must disclose cross-section scope, and the header pill needs
  // to distinguish "nothing to publish (nothing graded)" from "nothing
  // to publish (everything already published)". Per-section counts are
  // derived from roster and stay live as the teacher grades. `dirty`
  // counts already-published grades the teacher has edited since —
  // they're folded into the "to release" total alongside fresh ones.
  const [pendingOtherSections, setPendingOtherSections] = useState(0);
  const [dirtyOtherSections, setDirtyOtherSections] = useState(0);
  const [gradedOtherSections, setGradedOtherSections] = useState(0);
  // Reviewed (teacher-vetted) portions of the other-section pending /
  // dirty counters above. Needed so the publish dialog can disclose how
  // many of the to-release grades the teacher has actually checked, and
  // so a "Publish only reviewed" run can decrement the cross-section
  // counters by the right amount without a refetch.
  const [pendingReviewedOtherSections, setPendingReviewedOtherSections] = useState(0);
  const [dirtyReviewedOtherSections, setDirtyReviewedOtherSections] = useState(0);
  // Submission currently being marked reviewed via the explicit no-edit
  // affordance. Single slot — only one student is open at a time.
  const [markingReviewedId, setMarkingReviewedId] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Regrade state — a single slot because only one submission is open
  // in the detail pane at a time. When populated, the detail panel
  // shows a spinner on the regrade button and disables grading inputs.
  // Error is scoped to a submissionId so a failure on student A's
  // regrade doesn't render on student B's banner.
  const [regradingSubmissionId, setRegradingSubmissionId] = useState<string | null>(null);
  const [regradeError, setRegradeError] = useState<
    { forSubmissionId: string; message: string } | null
  >(null);
  const [regradeConfirmOpenFor, setRegradeConfirmOpenFor] = useState<string | null>(null);

  // Load HW + section roster + submissions and merge into one list:
  // every enrolled student in this section, with their submission if
  // they've turned one in.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      teacher.assignment(assignmentId),
      teacher.section(courseId, sectionId),
      teacher.submissions(assignmentId),
    ])
      .then(([a, s, subs]) => {
        if (cancelled) return;
        setError(null);
        setHwTitle(a.title);
        setSectionName(s.name);
        setRubric(a.rubric);
        // Join submissions to roster by student_id. Email would work
        // today but breaks silently if a student ever changes their
        // account email after submitting — the submission still
        // carries the old email and would vanish from the view.
        const submissionByStudent = new Map<string, TeacherSubmissionRow>();
        let otherPending = 0;
        let otherDirty = 0;
        let otherGraded = 0;
        let otherPendingReviewed = 0;
        let otherDirtyReviewed = 0;
        for (const r of subs.submissions) {
          if (r.is_preview) continue;
          if (r.section_id === sectionId) {
            submissionByStudent.set(r.student_id, r);
          } else if (r.final_score !== null) {
            otherGraded += 1;
            if (r.grade_published_at === null) {
              otherPending += 1;
              if (r.reviewed_at) otherPendingReviewed += 1;
            } else if (r.grade_dirty) {
              otherDirty += 1;
              if (r.reviewed_at) otherDirtyReviewed += 1;
            }
          }
        }
        setPendingOtherSections(otherPending);
        setDirtyOtherSections(otherDirty);
        setGradedOtherSections(otherGraded);
        setPendingReviewedOtherSections(otherPendingReviewed);
        setDirtyReviewedOtherSections(otherDirtyReviewed);
        const merged: RosterEntry[] = s.students
          .map((st) => ({
            student_id: st.id,
            student_name: st.name || st.email,
            student_email: st.email,
            submission: submissionByStudent.get(st.id) ?? null,
          }))
          .sort((a, b) => a.student_name.localeCompare(b.student_name));
        setRoster(merged);
        // Auto-select the first submitter that still needs release —
        // never published or dirty-since-edit. If everyone's clean-
        // published, fall back to the first submitter; if no one has
        // submitted, leave selection empty (the right pane shows a
        // tidy "nothing to review here" state).
        const firstUnreleased = merged.find(
          (e) =>
            e.submission !== null &&
            (e.submission.grade_published_at === null || e.submission.grade_dirty),
        );
        const firstSubmitter = merged.find((e) => e.submission !== null);
        const pick = firstUnreleased ?? firstSubmitter;
        if (pick) setSelectedStudentId(pick.student_id);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load submissions");
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, courseId, sectionId]);

  // Item analysis is HW-wide and read-only, so it loads independently
  // of the roster/detail panels — a failure here never blocks grading.
  useEffect(() => {
    let cancelled = false;
    teacher
      .itemAnalysis(assignmentId)
      .then((res) => {
        if (cancelled) return;
        setItemAnalysis(res);
        setItemAnalysisError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setItemAnalysisError(
          e instanceof Error ? e.message : "Failed to load item analysis",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const selectedEntry = useMemo(
    () =>
      roster
        ? (roster.find((e) => e.student_id === selectedStudentId) ?? null)
        : null,
    [roster, selectedStudentId],
  );
  const selectedSubmissionId = selectedEntry?.submission?.id ?? null;

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

  // Fetch only when we don't already have the current selection.
  useEffect(() => {
    if (!selectedSubmissionId) return;
    if (detail?.submission_id === selectedSubmissionId) return;
    let cancelled = false;
    const id = selectedSubmissionId;
    teacher
      .submissionDetail(id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        // Clear any prior fetch error for this submission — a later
        // retry that succeeds shouldn't leave the red banner showing
        // alongside the now-loaded panel.
        setFetchError((prev) => (prev?.forSubmissionId === id ? null : prev));
      })
      .catch((e) => {
        if (cancelled) return;
        setFetchError({
          forSubmissionId: id,
          message: e instanceof Error ? e.message : "Failed to load submission",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSubmissionId, detail?.submission_id]);

  // Fetch the full integrity detail in parallel. Independent of
  // submissionDetail so a missing/404 integrity record (HW had the
  // check disabled, or the pipeline never ran) doesn't block the
  // grading UI — the banner just hides.
  useEffect(() => {
    if (!selectedSubmissionId) return;
    if (integrity?.submission_id === selectedSubmissionId) return;
    let cancelled = false;
    const id = selectedSubmissionId;
    teacher
      .integrityDetail(id)
      .then((d) => {
        if (cancelled) return;
        setIntegrity(d);
      })
      .catch(() => {
        // 404 / disabled — clear any stale integrity for the prior
        // selection so we don't show another student's verdict.
        if (cancelled) return;
        setIntegrity((prev) => (prev?.submission_id === id ? prev : null));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSubmissionId, integrity?.submission_id]);

  const pageTitle = useMemo(() => {
    if (!hwTitle && !sectionName) return "Reviewing…";
    const parts = [hwTitle, sectionName].filter(Boolean);
    return parts.join(" · ");
  }, [hwTitle, sectionName]);

  const submittedCount = roster?.filter((e) => e.submission).length ?? 0;
  const totalRoster = roster?.length ?? 0;

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
        "final_score" | "breakdown" | "grade_dirty" | "reviewed_at"
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

  // Persist the current breakdown. Full-replacement semantics: we
  // send every graded entry on every call, the backend writes the
  // row, recomputes `final_score`, and returns the authoritative
  // `grade_dirty` (content-diff). If the save fails we leave local
  // state as-is and surface an error — teacher can click again.
  // Error is scoped to a submissionId so a prior failure on student
  // A can't bleed onto student B's grade summary card. Also mirrors
  // the server's dirty flag back onto the detail slot so the strip
  // reflects it without a separate refetch.
  const persistBreakdown = useCallback(
    async (submissionId: string, breakdown: GradeBreakdownEntry[]) => {
      setSaveError((prev) =>
        prev?.forSubmissionId === submissionId ? null : prev,
      );
      try {
        const res = await teacher.gradeSubmission(submissionId, { breakdown });
        applyGradeToRoster(submissionId, {
          final_score: res.final_score,
          breakdown,
          grade_dirty: res.grade_dirty,
          // Editing a grade *is* reviewing it — carry the server's
          // reviewed_at back so the roster's trust marker flips to
          // "Reviewed by you" immediately (null on an un-grade).
          reviewed_at: res.reviewed_at,
        });
        setDetail((d) =>
          d && d.submission_id === submissionId
            ? { ...d, grade_dirty: res.grade_dirty, reviewed_at: res.reviewed_at }
            : d,
        );
      } catch (e) {
        setSaveError({
          forSubmissionId: submissionId,
          message: e instanceof Error ? e.message : "Failed to save grade",
        });
      }
    },
    [applyGradeToRoster],
  );

  // Optimistic writer — mutates `detail.breakdown` in place so the
  // UI reacts instantly, then fires the save. `feedback` is kept if
  // it was already there (future AI feedback stays alongside a
  // teacher-overridden score).
  const setProblemGrade = useCallback(
    (problemId: string, status: GradeStatus, partialPercent?: number) => {
      if (!detail) return;
      const percent =
        status === "full" ? 100 : status === "zero" ? 0 : (partialPercent ?? 50);
      const prior = detail.breakdown ?? [];
      const existing = prior.find((b) => b.problem_id === problemId);
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
      };
      const nextBreakdown = existing
        ? prior.map((b) => (b.problem_id === problemId ? nextEntry : b))
        : [...prior, nextEntry];
      setDetail({ ...detail, breakdown: nextBreakdown });
      void persistBreakdown(detail.submission_id, nextBreakdown);
    },
    [detail, persistBreakdown],
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
    [detail, persistBreakdown],
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
  } = useMemo(() => {
    let pending = 0;
    let dirty = 0;
    let graded = 0;
    let reviewedToPublish = 0;
    for (const e of roster ?? []) {
      const s = e.submission;
      if (!s || s.final_score === null) continue;
      graded += 1;
      const isPending = s.grade_published_at === null;
      const isDirty = !isPending && s.grade_dirty;
      if (isPending) pending += 1;
      else if (isDirty) dirty += 1;
      // A grade is "to publish" if pending or dirty; count the vetted
      // ones so the dialog can split reviewed vs unopened.
      if ((isPending || isDirty) && s.reviewed_at) reviewedToPublish += 1;
    }
    return {
      pendingInSection: pending,
      dirtyInSection: dirty,
      gradedInSection: graded,
      reviewedToPublishInSection: reviewedToPublish,
    };
  }, [roster]);
  const pendingTotal = pendingInSection + pendingOtherSections;
  const dirtyTotal = dirtyInSection + dirtyOtherSections;
  const gradedTotal = gradedInSection + gradedOtherSections;
  // Reviewed vs unopened split of the full to-release set (HW-wide).
  const toReleaseTotal = pendingTotal + dirtyTotal;
  const reviewedToPublishTotal =
    reviewedToPublishInSection +
    pendingReviewedOtherSections +
    dirtyReviewedOtherSections;
  const unreviewedToPublishTotal = toReleaseTotal - reviewedToPublishTotal;

  // Publish every pending-or-dirty submission on the HW. Backend is
  // idempotent. On success we mirror the publish timestamp onto every
  // local roster entry that was in either bucket and flip grade_dirty
  // to false. Cross-section counters zero out; other sections refresh
  // on next open — acceptable for a one-shot action.
  //
  // `reviewedOnly` narrows the action to grades the teacher has vetted
  // (reviewed_at set) — the "publish what I've checked" path. The
  // optimistic update is scoped the same way: only reviewed rows flip,
  // and the cross-section counters drop by their reviewed portions
  // rather than zeroing.
  const handlePublish = useCallback(
    async (reviewedOnly = false) => {
      setPublishing(true);
      setPublishError(null);
      try {
        await teacher.publishGrades(assignmentId, reviewedOnly);
        const nowIso = new Date().toISOString();
        setRoster((prev) =>
          prev
            ? prev.map((e) => {
                const s = e.submission;
                if (!s || s.final_score === null) return e;
                const wasPending = s.grade_published_at === null;
                const wasDirty = !!s.grade_dirty;
                if (!wasPending && !wasDirty) return e;
                // Reviewed-only run leaves unvetted grades unpublished.
                if (reviewedOnly && !s.reviewed_at) return e;
                return {
                  ...e,
                  submission: {
                    ...s,
                    grade_published_at: nowIso,
                    grade_dirty: false,
                  },
                };
              })
            : prev,
        );
        if (reviewedOnly) {
          setPendingOtherSections((n) => n - pendingReviewedOtherSections);
          setDirtyOtherSections((n) => n - dirtyReviewedOtherSections);
          setPendingReviewedOtherSections(0);
          setDirtyReviewedOtherSections(0);
        } else {
          setPendingOtherSections(0);
          setDirtyOtherSections(0);
          setPendingReviewedOtherSections(0);
          setDirtyReviewedOtherSections(0);
        }
        // If the open student's grade was part of the publish, clear
        // the local dirty flag on detail too so the strip updates
        // without a refetch.
        setDetail((d) => {
          if (!d) return d;
          const wasToPublish = d.grade_published_at === null || d.grade_dirty;
          if (!wasToPublish) return d;
          if (reviewedOnly && !d.reviewed_at) return d;
          return { ...d, grade_published_at: nowIso, grade_dirty: false };
        });
        setPublishConfirmOpen(false);
      } catch (e) {
        setPublishError(
          e instanceof Error ? e.message : "Failed to publish grades",
        );
      } finally {
        setPublishing(false);
      }
    },
    [assignmentId, pendingReviewedOtherSections, dirtyReviewedOtherSections],
  );

  // Explicit "I looked, I agree" review for the no-edit case (editing a
  // score already auto-stamps review server-side). Mirrors reviewed_at
  // onto the roster row + open detail so the markers flip without a
  // refetch. Errors surface on the saveError channel (scoped by id).
  const handleMarkReviewed = useCallback(
    async (submissionId: string) => {
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
      } catch (e) {
        setSaveError({
          forSubmissionId: submissionId,
          message: e instanceof Error ? e.message : "Failed to mark reviewed",
        });
      } finally {
        setMarkingReviewedId(null);
      }
    },
    [],
  );

  // Re-run AI grading with the assignment's current rubric. Overrides
  // any manual edits (this is the teacher's explicit ask) and leaves
  // the published snapshot untouched so students keep seeing the old
  // grade until the teacher republishes. Closes the confirm dialog,
  // mirrors the fresh grade back onto roster + detail so the UI flips
  // out of the drifted state immediately.
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
                        breakdown: res.breakdown,
                        rubric_snapshot: res.rubric_snapshot,
                        grade_dirty: res.grade_dirty,
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
                grade_dirty: res.grade_dirty,
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
    [],
  );

  // Next submitter whose grade isn't released to students yet —
  // either never published or dirty-since-edit. Wraps to the start so
  // a teacher grading out of order still gets auto-advance. Returns
  // null if every submitter is clean-published (or the section has
  // no submitters at all).
  const nextStudent = useMemo<RosterEntry | null>(() => {
    if (!roster || !selectedEntry) return null;
    const idx = roster.findIndex((e) => e.student_id === selectedEntry.student_id);
    if (idx < 0) return null;
    for (let i = 1; i <= roster.length; i++) {
      const cand = roster[(idx + i) % roster.length];
      if (cand.student_id === selectedEntry.student_id) break;
      const sub = cand.submission;
      if (!sub) continue;
      if (sub.grade_published_at === null || sub.grade_dirty) {
        return cand;
      }
    }
    return null;
  }, [roster, selectedEntry]);

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
        <h1 className="font-serif text-[34px] leading-tight tracking-[-0.015em] text-text-primary">
          {pageTitle}
        </h1>
        {roster !== null && (
          <PublishButton
            pendingTotal={pendingTotal}
            dirtyTotal={dirtyTotal}
            gradedTotal={gradedTotal}
            onOpen={() => setPublishConfirmOpen(true)}
          />
        )}
      </div>

      {error && (
        <p className="mt-4 text-sm text-[color:var(--color-error)]">{error}</p>
      )}

      {roster === null && !error && (
        <p className="mt-6 text-sm text-text-muted">Loading…</p>
      )}

      {roster !== null && roster.length === 0 && (
        <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-[color:var(--color-surface-alt-2)] p-10 text-center">
          <p className="text-sm font-bold text-text-primary">
            No students in this section yet
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Invite students from the Sections tab, then publish homework.
          </p>
        </div>
      )}

      {roster !== null && (
        <ItemAnalysisPanel
          data={itemAnalysis}
          error={itemAnalysisError}
          open={itemAnalysisOpen}
          onToggle={setItemAnalysisOpen}
        />
      )}

      {roster !== null && roster.length > 0 && (
        <div className="mt-5 grid gap-5 md:grid-cols-[280px_1fr]">
          {/* Student list */}
          <aside className="self-start rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                Students · {submittedCount}/{totalRoster} submitted
              </span>
              <VerdictLegendTrigger />
            </div>
            <RosterFilterBar
              roster={roster}
              value={rosterFilter}
              onChange={setRosterFilter}
            />
            <div className="max-h-[70vh] overflow-y-auto">
              {applyRosterFilter(roster, rosterFilter).length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-text-muted">
                  {rosterFilter === "needs_me"
                    ? "Nothing waiting on you here."
                    : rosterFilter === "flagged"
                      ? "No flagged submissions in this section."
                      : "No students match this filter."}
                </p>
              ) : (
                applyRosterFilter(roster, rosterFilter).map((e) => (
                  <StudentRow
                    key={e.student_id}
                    entry={e}
                    selected={e.student_id === selectedStudentId}
                    onSelect={() => setSelectedStudentId(e.student_id)}
                  />
                ))
              )}
            </div>
          </aside>

          {/* Detail */}
          <section className="min-w-0">
            {!selectedEntry && (
              <div className="rounded-[--radius-xl] border border-border-light bg-[color:var(--color-surface-alt-2)] p-10 text-center text-sm text-text-muted">
                Pick a student on the left to see their work.
              </div>
            )}
            {selectedEntry && !selectedEntry.submission && (
              <NotSubmittedCard entry={selectedEntry} />
            )}
            {selectedEntry?.submission && detailLoading && (
              <p className="text-sm text-text-muted">Loading student work…</p>
            )}
            {selectedEntry?.submission && currentFetchError && (
              <p className="text-sm text-[color:var(--color-error)]">{currentFetchError}</p>
            )}
            {detailIsCurrent && detail && selectedEntry?.submission && (
              <SubmissionDetailPanel
                detail={detail}
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
                  if (nextStudent) setSelectedStudentId(nextStudent.student_id);
                }}
                onGradeProblem={setProblemGrade}
                onFeedbackChange={setProblemFeedback}
                onMarkReviewed={() =>
                  void handleMarkReviewed(selectedEntry.submission!.id)
                }
                marking={markingReviewedId === selectedEntry.submission.id}
                regrading={regradingSubmissionId === selectedEntry.submission.id}
                regradeError={
                  regradeError?.forSubmissionId === selectedEntry.submission.id
                    ? regradeError.message
                    : null
                }
                onRegradeRequest={() =>
                  setRegradeConfirmOpenFor(selectedEntry.submission!.id)
                }
              />
            )}
          </section>
        </div>
      )}

      <PublishConfirmDialog
        open={publishConfirmOpen}
        onClose={() => {
          if (!publishing) {
            setPublishConfirmOpen(false);
            setPublishError(null);
          }
        }}
        pendingInSection={pendingInSection}
        pendingOtherSections={pendingOtherSections}
        dirtyInSection={dirtyInSection}
        dirtyOtherSections={dirtyOtherSections}
        reviewedToPublish={reviewedToPublishTotal}
        unreviewedToPublish={unreviewedToPublishTotal}
        publishing={publishing}
        error={publishError}
        onConfirm={handlePublish}
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

// ────────────────────────────────────────────────────────────────────
// Publish button (page header). HW-wide counts. Four states:
//   • pending + dirty > 0              → primary CTA opens confirmation
//   • graded > 0, no pending, no dirty → "All grades published" pill
//   • nothing graded                   → "No grades to publish" pill
// The button label flips between "Publish" (fresh-only), "Republish"
// (dirty-only), and "Publish & republish" (mixed) so the teacher sees
// what the action will actually do.
// ────────────────────────────────────────────────────────────────────

function PublishButton({
  pendingTotal,
  dirtyTotal,
  gradedTotal,
  onOpen,
}: {
  pendingTotal: number;
  dirtyTotal: number;
  gradedTotal: number;
  onOpen: () => void;
}) {
  const toRelease = pendingTotal + dirtyTotal;
  if (toRelease === 0) {
    if (gradedTotal === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-[--radius-pill] bg-[color:var(--color-surface-alt-2)] px-3 py-1.5 text-xs font-semibold text-text-muted">
          No grades to publish
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[--radius-pill] bg-[color:var(--color-surface-alt-2)] px-3 py-1.5 text-xs font-semibold text-text-muted">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
        All grades published
      </span>
    );
  }
  const verb =
    pendingTotal === 0 ? "Republish" : dirtyTotal === 0 ? "Publish" : "Publish & republish";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
    >
      {verb} {toRelease} {toRelease === 1 ? "grade" : "grades"} →
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Confirmation dialog before publishing. Makes the HW-wide scope
// explicit when there are grades in other sections — the button was
// clicked from one section's view but the action affects all of them.
// ────────────────────────────────────────────────────────────────────

function PublishConfirmDialog({
  open,
  onClose,
  pendingInSection,
  pendingOtherSections,
  dirtyInSection,
  dirtyOtherSections,
  reviewedToPublish,
  unreviewedToPublish,
  publishing,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  pendingInSection: number;
  pendingOtherSections: number;
  dirtyInSection: number;
  dirtyOtherSections: number;
  /** How many of the to-release grades the teacher has vetted vs left
   *  as unopened AI suggestions. Sum === total. Drives the trust
   *  disclosure + whether "Publish only reviewed" is offered. */
  reviewedToPublish: number;
  unreviewedToPublish: number;
  publishing: boolean;
  error: string | null;
  onConfirm: (reviewedOnly?: boolean) => void;
}) {
  const pendingTotal = pendingInSection + pendingOtherSections;
  const dirtyTotal = dirtyInSection + dirtyOtherSections;
  const total = pendingTotal + dirtyTotal;
  const otherSections = pendingOtherSections + dirtyOtherSections;
  const verb =
    pendingTotal === 0 ? "Republish" : dirtyTotal === 0 ? "Publish" : "Publish & republish";
  const body =
    pendingTotal === 0
      ? "Students will see the updated scores immediately."
      : dirtyTotal === 0
        ? "Students will see their scores immediately. Ungraded submissions aren\u2019t affected."
        : "Students will see the new and updated scores immediately. Ungraded submissions aren\u2019t affected.";
  // Offer the safer path only when there's a meaningful split \u2014 some
  // reviewed AND some unopened. If everything's reviewed there's
  // nothing to hold back; if nothing's reviewed, "only reviewed" would
  // publish zero, so we don't show it.
  const offerReviewedOnly = reviewedToPublish > 0 && unreviewedToPublish > 0;
  return (
    <Modal open={open} onClose={onClose} dismissible={!publishing}>
      <h2 className="text-lg font-bold text-text-primary">
        {verb} {total} {total === 1 ? "grade" : "grades"}?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">{body}</p>
      {/* Trust disclosure \u2014 make the review state of the batch legible
       *  so fast-accept is an informed choice, not a blind one. */}
      {unreviewedToPublish > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
          <span className="font-semibold">{total}</span>{" "}
          {total === 1 ? "grade" : "grades"} \u2014{" "}
          <span className="font-semibold">{reviewedToPublish}</span>{" "}
          you&rsquo;ve reviewed,{" "}
          <span className="font-semibold">{unreviewedToPublish}</span>{" "}
          AI-suggested you haven&rsquo;t opened.
        </p>
      )}
      {dirtyTotal > 0 && pendingTotal > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
          <span className="font-semibold">{dirtyTotal}</span>{" "}
          {dirtyTotal === 1 ? "is an edit" : "are edits"} to already-published grades.
        </p>
      )}
      {otherSections > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-xs text-text-secondary">
          This includes <span className="font-semibold">{otherSections}</span>{" "}
          {otherSections === 1 ? "grade" : "grades"} from other sections
          of this homework.
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-[color:var(--color-error)]">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={publishing}
          className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        {offerReviewedOnly && (
          <button
            type="button"
            onClick={() => onConfirm(true)}
            disabled={publishing}
            className="rounded-[--radius-md] border border-primary/40 bg-primary-bg px-4 py-2 text-xs font-bold text-primary transition-colors hover:border-primary/70 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Publish only reviewed ({reviewedToPublish})
          </button>
        )}
        <button
          type="button"
          onClick={() => onConfirm(false)}
          disabled={publishing}
          className="rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {publishing
            ? "Publishing\u2026"
            : offerReviewedOnly
              ? "Publish all"
              : `${verb} grades`}
        </button>
      </div>
    </Modal>
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

  const snapshotFields: { label: string; text: string }[] = [];
  if (snapshot.full_credit)
    snapshotFields.push({ label: "Full credit", text: snapshot.full_credit });
  if (snapshot.partial_credit)
    snapshotFields.push({ label: "Partial credit", text: snapshot.partial_credit });
  if (snapshot.common_mistakes)
    snapshotFields.push({ label: "Common mistakes", text: snapshot.common_mistakes });
  if (snapshot.notes) snapshotFields.push({ label: "Notes", text: snapshot.notes });

  return (
    <div className="rounded-[--radius-xl] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] p-4  dark:bg-[color:var(--color-warning)]/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[color:var(--color-warning-dark)] ">
            Rubric edited since this was graded
          </p>
          <p className="mt-1 text-xs text-[color:var(--color-warning-dark)]/80 /80">
            The AI graded against an earlier version of your rubric.
            Regrade to apply your current criteria — your edits on this
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
                <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-warning-dark)]/70 /70">
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

// ────────────────────────────────────────────────────────────────────
// Regrade confirmation — the regrade is destructive to any manual
// edits on the submission (override semantics). Confirm dialog
// spells that out so the teacher doesn't lose work by accident.
// ────────────────────────────────────────────────────────────────────

function RegradeConfirmDialog({
  submissionId,
  row,
  regrading,
  error,
  onClose,
  onConfirm,
}: {
  submissionId: string | null;
  row: TeacherSubmissionRow | null;
  regrading: boolean;
  /** Failure message from the last regrade attempt. Rendered inline
   *  so the teacher sees it without having to dismiss the modal; the
   *  drift banner underneath would otherwise be covered by the overlay. */
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = submissionId !== null;
  const published = !!row?.grade_published_at;
  return (
    <Modal open={open} onClose={onClose} dismissible={!regrading}>
      <h2 className="text-lg font-bold text-text-primary">
        Regrade with current rubric?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        The AI will re-grade this submission using the rubric in your
        Grading setup. Any manual edits you made on this submission
        will be replaced.
      </p>
      {published && (
        <p className="mt-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-xs text-text-secondary">
          This grade is already published. The student will keep seeing
          the old grade until you republish.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] px-3 py-2 text-xs font-semibold text-[color:var(--color-error)]  dark:bg-[color:var(--color-error-light)] ">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={regrading}
          className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={regrading}
          className="rounded-[--radius-md] bg-[color:var(--color-warning-dark)] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[color:var(--color-warning)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[color:var(--color-warning)]  "
        >
          {regrading ? "Regrading…" : "Regrade"}
        </button>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────
// Roster filter — narrows the left pane to "anything that needs me"
// or "only the flagged ones". Default "all" keeps the section view.
// `needs_me` is the scan-mode for grading mode: hides students whose
// submissions are already published-and-clean. `flagged` is the
// scan-mode for the integrity check, hiding everything that isn't
// a verdict requiring teacher attention.
// ────────────────────────────────────────────────────────────────────

const FLAGGED_DISPOSITIONS = new Set([
  "flag_for_review",
  "tutor_pivot",
]);

function isFlagged(entry: RosterEntry): boolean {
  const sub = entry.submission;
  if (!sub) return false;
  // Student-raised "reader got something wrong" routes straight to
  // manual grading and is the strongest "needs your eyes" signal.
  if (sub.extraction_flagged_at) return true;
  const overview = sub.integrity_overview;
  if (!overview) return false;
  // `IntegrityOverview` exposes only `complete | in_progress`, so the
  // `skipped_unreadable` granular state isn't directly visible from
  // the row. The full `TeacherIntegrityDetail` (loaded only for the
  // selected student) carries that signal — for the roster filter,
  // we approximate via disposition + the extraction-flagged check
  // above. The Submissions inbox flagged count counts skipped at the
  // backend, so a `skipped_unreadable` student is still surfaced via
  // the per-row CTA there.
  if (!overview.disposition) return false;
  return FLAGGED_DISPOSITIONS.has(overview.disposition);
}

function needsTeacher(entry: RosterEntry): boolean {
  const sub = entry.submission;
  if (!sub) return false;
  // Settled state is a published-and-clean grade. Everything else —
  // ungraded, graded-but-not-published, dirty, integrity-flagged — is
  // work that wants the teacher's attention.
  if (sub.grade_published_at !== null && !sub.grade_dirty) return false;
  return true;
}

function applyRosterFilter(
  roster: RosterEntry[],
  filter: RosterFilter,
): RosterEntry[] {
  if (filter === "all") return roster;
  if (filter === "needs_me") return roster.filter(needsTeacher);
  return roster.filter(isFlagged);
}

function RosterFilterBar({
  roster,
  value,
  onChange,
}: {
  roster: RosterEntry[];
  value: RosterFilter;
  onChange: (v: RosterFilter) => void;
}) {
  const flaggedCount = roster.filter(isFlagged).length;
  const needsMeCount = roster.filter(needsTeacher).length;

  // Auto-revert to "all" when the active filter's count drops to 0 —
  // otherwise a teacher who clears the last flagged submission gets
  // stranded on a disabled-yet-active chip with an empty roster and
  // no obvious recovery. Live grading frequently transitions a row
  // out of `needs_me` (publish a grade), so this guard fires often.
  useEffect(() => {
    if (value === "needs_me" && needsMeCount === 0) onChange("all");
    if (value === "flagged" && flaggedCount === 0) onChange("all");
  }, [value, needsMeCount, flaggedCount, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border-light px-3 py-2">
      <RosterChip label="All" active={value === "all"} onClick={() => onChange("all")} />
      <RosterChip
        label="Needs me"
        count={needsMeCount}
        active={value === "needs_me"}
        disabled={needsMeCount === 0}
        onClick={() => onChange("needs_me")}
      />
      <RosterChip
        label="Flagged"
        count={flaggedCount}
        active={value === "flagged"}
        disabled={flaggedCount === 0}
        onClick={() => onChange("flagged")}
      />
    </div>
  );
}

function RosterChip({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-[--radius-pill] border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
        active
          ? "border-primary bg-primary-bg text-primary"
          : disabled
            ? "border-border-light bg-[color:var(--color-surface-alt-2)] text-text-muted/60 cursor-not-allowed"
            : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={`rounded-[--radius-pill] px-1 text-[9px] tabular-nums ${
            active ? "bg-primary text-white" : "bg-[color:var(--color-surface-alt-2)] text-text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty state for a student who hasn't turned in work. No grading
// path from here — we can't grade missing work.
// ────────────────────────────────────────────────────────────────────

function NotSubmittedCard({ entry }: { entry: RosterEntry }) {
  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-bold text-text-primary">{entry.student_name}</h2>
      <p className="text-xs text-text-muted">{entry.student_email}</p>
      <div className="mt-5 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/60 px-6 py-10 text-center">
        <p className="text-sm font-bold text-text-primary">Not submitted</p>
        <p className="mt-1 text-xs text-text-muted">
          This student hasn&apos;t turned in this homework yet.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Student list row — the clickable link to a specific submission.
// ────────────────────────────────────────────────────────────────────

function StudentRow({
  entry,
  selected,
  onSelect,
}: {
  entry: RosterEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const sub = entry.submission;
  const statusLabel = rowStatusLabel(entry);
  const review = sub ? reviewMarker(sub) : null;
  const mutedName = sub === null;
  const overview = sub?.integrity_overview ?? null;
  const showsDispositionPill =
    overview?.overall_status === "complete" &&
    (overview.disposition === "flag_for_review" ||
      overview.disposition === "tutor_pivot" ||
      !overview.disposition);
  const showsActivityPill = (overview?.notable_count ?? 0) > 0;
  const hasScore = sub?.final_score != null;
  const hasAnyPill = showsDispositionPill || showsActivityPill;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-1.5 border-b border-border-light px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 ${
        selected ? "bg-primary-bg/40" : "hover:bg-[color:var(--color-surface-alt-2)]"
      }`}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        {/* Score sits next to the name on the header row — it answers
         * "how did they do?", which is the natural pairing with
         * student identity. Pulling it out of the pill row keeps that
         * row exclusively for filled pills, so we don't have a plain
         * number sandwiched between two colored pills. */}
        <div
          className={`min-w-0 flex-1 truncate font-semibold ${
            mutedName ? "text-text-muted" : "text-text-primary"
          }`}
        >
          {entry.student_name}
        </div>
        {hasScore && (
          <span
            className={`shrink-0 text-xs font-bold ${
              sub!.grade_published_at && !sub!.grade_dirty
                ? "text-[color:var(--color-success)] "
                : "text-text-secondary"
            }`}
          >
            {Math.round(sub!.final_score!)}%
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusLabel.dotClass}`}
        />
        <span className="truncate">{statusLabel.text}</span>
        {sub?.is_late && (
          <span className="ml-1 shrink-0 font-semibold text-[color:var(--color-error)]">
            · late
          </span>
        )}
      </div>
      {/* Review-trust marker — separates a grade the teacher vouched for
       * from an unopened AI suggestion. Its own line so it reads as a
       * distinct dimension from the publish-state status above. */}
      {review && (
        <div
          className={`flex min-w-0 items-center gap-1 text-[10px] font-semibold ${
            review.tone === "reviewed"
              ? "text-[color:var(--color-success)]"
              : "text-text-muted"
          }`}
        >
          <span aria-hidden>{review.tone === "reviewed" ? "✓" : "🤖"}</span>
          <span className="truncate">{review.text}</span>
        </div>
      )}
      {/* Disposition + activity pills on their own row, right-aligned.
       * The 280px-wide side panel can fit them together in the common
       * case ("Review" + "Activity: N notable moments"); rare wide
       * combinations (e.g. "Inconclusive" + long activity copy) wrap,
       * but each wrapped line is then a single semantically-coherent
       * pill, which reads cleaner than mixing pills with bare text.
       *
       * Order: disposition first (most urgent — "should I look at this
       * row?"), then activity (supporting behavior context). Quiet
       * rows (pass / needs_practice / clean activity) render no pill
       * row at all so loud rows actually pop. */}
      {hasAnyPill && (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <RowDispositionPill overview={overview} />
          <ActivityPill count={overview?.notable_count ?? null} />
        </div>
      )}
    </button>
  );
}

function rowStatusLabel(entry: RosterEntry): {
  text: string;
  dotClass: string;
} {
  const sub = entry.submission;
  if (!sub) {
    return { text: "Not submitted", dotClass: "bg-gray-300" };
  }
  // Unreadable photo never got an AI grade — call it out distinctly so
  // the teacher knows this row needs a manual pass (or a resubmit),
  // not just an unopened suggestion. Warning dot, reusing the same
  // amber token the dirty/ungraded states use. Surfaces even after a
  // manual grade exists isn't a concern: once graded, the published /
  // graded branches above take over.
  if (sub.ai_grading_status === "skipped_unreadable" && sub.final_score === null) {
    return {
      text: "Couldn't read · grade manually",
      dotClass: "bg-[color:var(--color-warning)]",
    };
  }
  if (sub.grade_published_at) {
    if (sub.grade_dirty) {
      return { text: "Edited · not yet sent", dotClass: "bg-[color:var(--color-warning)]" };
    }
    return { text: "Published", dotClass: "bg-green-500" };
  }
  if (sub.final_score !== null) {
    return { text: "Graded, not published", dotClass: "bg-[color:var(--color-warning)]" };
  }
  return { text: "Needs review", dotClass: "bg-gray-400" };
}

// Per-student review-trust marker for the roster: distinguishes a grade
// the teacher has vouched for from one the AI suggested but the teacher
// never opened. Returns null when there's nothing to review yet (no
// grade — ungraded / skipped-unreadable, where the status label already
// tells the story).
function reviewMarker(
  sub: TeacherSubmissionRow,
): { text: string; tone: "reviewed" | "unreviewed" } | null {
  if (sub.final_score === null) return null;
  if (sub.reviewed_at) return { text: "Reviewed by you", tone: "reviewed" };
  return { text: "AI-suggested · unopened", tone: "unreviewed" };
}

// ────────────────────────────────────────────────────────────────────
// Submission detail — right pane. The student's submitted pages
// (images + PDFs) are the source of truth; typed answers sit
// alongside the answer key so the teacher can compare without
// switching contexts. Per-problem Full/Partial/Zero picks auto-save
// on click.
// ────────────────────────────────────────────────────────────────────

function SubmissionDetailPanel({
  detail,
  integrity,
  rubric,
  rubricOpen,
  onToggleRubric,
  row,
  saveError,
  nextStudent,
  onSelectNext,
  onGradeProblem,
  onFeedbackChange,
  onMarkReviewed,
  marking,
  regrading,
  regradeError,
  onRegradeRequest,
}: {
  detail: TeacherSubmissionDetail;
  integrity: TeacherIntegrityDetail | null;
  rubric: TeacherRubric | null;
  rubricOpen: boolean;
  onToggleRubric: (open: boolean) => void;
  row: TeacherSubmissionRow | null;
  saveError: string | null;
  nextStudent: RosterEntry | null;
  onSelectNext: () => void;
  onGradeProblem: (problemId: string, status: GradeStatus, partialPercent?: number) => void;
  onFeedbackChange: (problemId: string, text: string) => void;
  onMarkReviewed: () => void;
  marking: boolean;
  regrading: boolean;
  regradeError: string | null;
  onRegradeRequest: () => void;
}) {
  const breakdownByProblem = useMemo(() => {
    const map = new Map<string, GradeBreakdownEntry>();
    for (const b of detail.breakdown ?? []) map.set(b.problem_id, b);
    return map;
  }, [detail.breakdown]);
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
  // Unreadable photo, not yet hand-graded — surface the callout that
  // explains why there's no AI suggestion. Drops away once the teacher
  // has put a grade on it (final_score set).
  const skippedUnreadable =
    detail.ai_grading_status === "skipped_unreadable" &&
    detail.final_score === null;
  // A grade exists but the teacher hasn't vouched for it — offer the
  // explicit "Mark reviewed" affordance (the no-edit accept path).
  const canMarkReviewed = detail.final_score !== null && !detail.reviewed_at;

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
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Submitted{" "}
            {new Date(detail.submitted_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {detail.is_late && (
              <span className="ml-1.5 font-semibold text-[color:var(--color-error)]">
                · late
              </span>
            )}
            {row?.extraction_flagged_at && (
              <span
                className="ml-1.5 font-semibold text-[color:var(--color-error)] "
                title="Student flagged: 'Reader got something wrong' — no AI grading ran"
              >
                · student-flagged reading · grade manually
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
            ) : (
              <span className="text-text-muted">Not graded yet</span>
            )}
          </p>
          {saveError && (
            <p className="mt-1 text-[11px] font-semibold text-[color:var(--color-error)]">
              {saveError}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Submitted pages stay one click away — promoted to the
              page header so they're findable without scrolling to
              the problems card. Lightbox markup lives inside the
              button component. The gap-3 (vs the default gap-2
              elsewhere in the strip) buys breathing room between
              this modal-popping affordance and the adjacent "Next
              student →" navigation, since teachers click Next
              student rapidly and we don't want the View work button
              absorbing accidental hits. */}
          {detail.files && detail.files.length > 0 && (
            <StudentWorkThumbButton files={detail.files} />
          )}
          {/* Explicit "I looked, I agree" review for the no-edit case
              (editing any score auto-stamps review on its own). Only
              shown while a grade exists but is still unvetted; flips to
              a static "Reviewed by you" badge once stamped. */}
          {canMarkReviewed && (
            <button
              type="button"
              onClick={onMarkReviewed}
              disabled={marking}
              title="Vouch for the AI-suggested grade without changing it"
              className="rounded-[--radius-md] border border-border-light bg-surface px-3.5 py-1.5 text-xs font-bold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {marking ? "Marking…" : "Mark reviewed"}
            </button>
          )}
          {detail.reviewed_at && (
            <span className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-2.5 py-1 text-[11px] font-bold text-[color:var(--color-success)]">
              <span aria-hidden>✓</span>
              Reviewed by you
            </span>
          )}
          <button
            type="button"
            onClick={onSelectNext}
            disabled={!nextStudent}
            title={!nextStudent ? "No more students to review" : undefined}
            className="rounded-[--radius-md] border border-primary/30 bg-primary-bg px-3.5 py-1.5 text-xs font-bold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border-light disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted"
          >
            {nextStudent ? "Next student →" : "No more students"}
          </button>
        </div>
      </div>

      {/* Integrity verdict — the #1 trust signal. First full content
          block so the teacher sees the verdict before they start
          grading. Hides when HW had integrity disabled / no check. */}
      <IntegrityBanner
        integrity={integrity}
        overviewFallback={row?.integrity_overview ?? null}
      />

      {/* Rubric drift banner — only renders when the assignment's live
          rubric differs from the one this submission was graded against.
          Triggers a regrade confirm dialog managed by the page. */}
      <RubricDriftBanner
        current={rubric}
        snapshot={row?.rubric_snapshot ?? null}
        regrading={regrading}
        error={regradeError}
        onRegrade={onRegradeRequest}
      />

      {/* Unreadable callout — when the photo was too low-confidence to
          auto-grade, the AI suggestion is silently absent and the
          per-problem pickers below sit empty. Explain why, and put the
          student's work one click away, so the empty state reads as
          "grade this by hand" not "something's broken". Manual grading
          stays fully enabled below. */}
      {skippedUnreadable && (
        <div className="rounded-[--radius-xl] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] p-4  dark:bg-[color:var(--color-warning)]/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-bold text-[color:var(--color-warning-dark)] ">
                <span aria-hidden>⚠</span>
                Couldn&rsquo;t read this submission
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--color-warning-dark)]/80 /80">
                The AI couldn&rsquo;t read this submission clearly, so it
                wasn&rsquo;t auto-graded. Open the student&rsquo;s work to grade
                it by hand, or ask them to resubmit a clearer photo.
              </p>
            </div>
            {detail.files && detail.files.length > 0 && (
              <div className="shrink-0">
                <StudentWorkThumbButton files={detail.files} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-problem grading — the main scan-unit. The student-work
          lightbox lives in the page header (one click away from any
          problem). */}
      <div className="rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          Problems · {totalProblems}
        </p>
        <div className="mt-3">
          <RubricSection
            rubric={rubric}
            open={rubricOpen}
            onToggle={onToggleRubric}
          />
        </div>
        <div className="mt-3 space-y-3">
          {detail.problems.map((p) => (
            <ProblemGradeRow
              // Compose the key with submission_id so the row remounts
              // per student. Without this, React reuses the same
              // ProblemGradeRow instance across students that share
              // bank items, and local UI state (e.g. the question
              // expand toggle) leaks from one student into the next.
              key={`${detail.submission_id}-${p.bank_item_id}`}
              problem={p}
              entry={breakdownByProblem.get(p.bank_item_id) ?? null}
              aiGrade={aiByPosition.get(p.position) ?? null}
              onChange={(status, partialPercent) =>
                onGradeProblem(p.bank_item_id, status, partialPercent)
              }
              onFeedbackChange={(text) =>
                onFeedbackChange(p.bank_item_id, text)
              }
            />
          ))}
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
  const fields: { label: string; text: string }[] = [];
  if (rubric?.full_credit) fields.push({ label: "Full credit", text: rubric.full_credit });
  if (rubric?.partial_credit) fields.push({ label: "Partial credit", text: rubric.partial_credit });
  if (rubric?.common_mistakes) fields.push({ label: "Common mistakes", text: rubric.common_mistakes });
  if (rubric?.notes) fields.push({ label: "Notes", text: rubric.notes });
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              {f.label}
            </p>
            <div className="mt-0.5 text-xs leading-relaxed text-text-primary">
              <MathText text={f.text} />
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────
// Class item analysis — a collapsible panel at the top of the review
// content. Surfaces the per-problem score distribution across every
// graded submission on this HW (all sections, not just the one being
// reviewed). Problems render worst-first (the API sorts them ascending
// by avg_percent), so the items most worth a reteach sit at the top.
//
// Collapsed by default — grading is the primary task; this is the
// "where did the class struggle?" reference the teacher opens between
// students. Hidden entirely until the fetch resolves; shows a skeleton
// while loading, an inline error on failure, and a muted empty state
// when nothing's been graded yet.
// ────────────────────────────────────────────────────────────────────

function ItemAnalysisPanel({
  data,
  error,
  open,
  onToggle,
}: {
  data: ItemAnalysisResponse | null;
  error: string | null;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const gradedCount = data?.graded_count ?? 0;
  const sublabel = error
    ? "Couldn’t load item analysis"
    : data === null
      ? "Loading…"
      : gradedCount === 0
        ? "No graded submissions yet"
        : `Across ${gradedCount} graded ${gradedCount === 1 ? "submission" : "submissions"}`;

  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}
      className="mt-5 rounded-[--radius-xl] border border-border-light bg-surface shadow-sm"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3">
        <span className="flex items-baseline gap-2">
          <span aria-hidden className="text-text-muted">
            {open ? "▾" : "▸"}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Class item analysis
          </span>
          <span className="text-[11px] text-text-muted">{sublabel}</span>
        </span>
      </summary>
      <div className="border-t border-border-light px-5 py-4">
        {error ? (
          <p className="text-xs font-semibold text-[color:var(--color-error)]">
            {error}
          </p>
        ) : data === null ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-4/5" />
          </div>
        ) : gradedCount === 0 ? (
          <p className="text-xs text-text-muted">
            No graded submissions yet — item analysis appears once you grade.
          </p>
        ) : (
          <ol className="space-y-3">
            {data.items.map((item) => (
              <ItemAnalysisRow key={item.problem_index} item={item} />
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

// One problem's row in the item-analysis panel: number + text on the
// left, avg% on the right, then a full-width stacked distribution bar
// (green=full, amber=partial, red=zero) with the raw counts below it.
// The avg% is color-graded against fixed thresholds so the worst items
// read as worst at a glance without needing to parse the bar.
function ItemAnalysisRow({
  item,
}: {
  item: ItemAnalysisResponse["items"][number];
}) {
  const total = item.full + item.partial + item.zero;
  // Guard against a divide-by-zero if a graded HW somehow has a problem
  // with no scored submissions — render an empty (zero-width) bar.
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const avg = Math.round(item.avg_percent);
  const avgClass =
    avg >= 80
      ? "text-success"
      : avg >= 50
        ? "text-[color:var(--color-warning-dark)]"
        : "text-[color:var(--color-error)]";

  return (
    <li className="rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Problem {item.problem_index + 1}
          </span>
          <div className="mt-0.5 text-sm leading-relaxed text-text-primary">
            <MathText text={item.problem_text} />
          </div>
        </div>
        <span className={`shrink-0 text-sm font-bold tabular-nums ${avgClass}`}>
          {avg}% avg
        </span>
      </div>
      <div
        className="mt-2.5 flex h-2 w-full overflow-hidden rounded-[--radius-pill] bg-border-light"
        role="img"
        aria-label={`${item.full} full, ${item.partial} partial, ${item.zero} zero`}
      >
        {item.full > 0 && (
          <div className="h-full bg-success" style={{ width: `${pct(item.full)}%` }} />
        )}
        {item.partial > 0 && (
          <div
            className="h-full bg-[color:var(--color-warning)]"
            style={{ width: `${pct(item.partial)}%` }}
          />
        )}
        {item.zero > 0 && (
          <div className="h-full bg-error" style={{ width: `${pct(item.zero)}%` }} />
        )}
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-text-muted">
        <span className="font-semibold text-success">{item.full} full</span>
        <span className="mx-1 text-text-muted/60" aria-hidden>·</span>
        <span className="font-semibold text-[color:var(--color-warning-dark)]">
          {item.partial} partial
        </span>
        <span className="mx-1 text-text-muted/60" aria-hidden>·</span>
        <span className="font-semibold text-[color:var(--color-error)]">
          {item.zero} zero
        </span>
      </p>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────────
// One row of student work in the review panel. Renders the canonical
// (edited if the student corrected it on the confirm screen, else
// original Vision) text, plus an expandable disclosure exposing the
// original Vision read whenever the student edited the row. The
// teacher's daily flow stays clean — the badge is a quiet signal,
// not a diff — but verification against the original is one tap away.
// ────────────────────────────────────────────────────────────────────

function StudentStepRow({
  step,
  index,
}: {
  step: TeacherSubmissionStep;
  index: number;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const originalLatex = step.original_latex ?? "";
  const originalPlain = step.original_plain_english ?? "";
  const hasOriginal =
    !!step.edited && (originalLatex.length > 0 || originalPlain.length > 0);
  return (
    <div className="flex gap-2">
      <span
        aria-hidden
        className="shrink-0 pt-0.5 text-xs font-semibold text-text-muted tabular-nums"
      >
        {index + 1}.
      </span>
      <div className="min-w-0 flex-1">
        {step.latex ? (
          <MathText text={`$$${step.latex}$$`} />
        ) : (
          <span className="text-text-secondary">{step.plain_english}</span>
        )}
        {step.edited && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-bg px-1.5 py-0.5 font-semibold text-primary">
              <span aria-hidden>✎</span> edited by student
            </span>
            {hasOriginal && (
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                aria-expanded={showOriginal}
                className="text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
              >
                {showOriginal ? "Hide original" : "View what was originally read"}
              </button>
            )}
          </div>
        )}
        {step.edited && hasOriginal && showOriginal && (
          <div className="mt-1 rounded-[--radius-sm] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-2 py-1.5 text-xs">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              Originally read
            </div>
            <div className="mt-0.5 text-text-secondary">
              {originalLatex ? (
                <MathText text={`$$${originalLatex}$$`} />
              ) : (
                <span>{originalPlain}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Per-problem grading row: answer compare + Full/Partial/Zero picker.
// Partial opens an inline number input; Enter or blur commits with
// the typed value. Full/Zero clicks commit immediately.
// ────────────────────────────────────────────────────────────────────

function ProblemGradeRow({
  problem,
  entry,
  aiGrade,
  onChange,
  onFeedbackChange,
}: {
  problem: TeacherSubmissionDetailProblem;
  entry: GradeBreakdownEntry | null;
  aiGrade: AiGradeEntry | null;
  onChange: (status: GradeStatus, partialPercent?: number) => void;
  onFeedbackChange: (text: string) => void;
}) {
  const current = entry?.score_status ?? null;
  // Show "AI" badge when the active grade matches the AI suggestion
  // (i.e. teacher hasn't overridden it yet).
  const isAiMatch =
    aiGrade !== null &&
    current === aiGrade.score_status &&
    (current !== "partial" || Math.round(entry?.percent ?? 0) === Math.round(aiGrade.percent));
  // Local edit buffer for the inline partial input. `null` means
  // "show the current server-side value"; a string means "user is
  // typing". On commit we parse + fire onChange, then null the
  // buffer so the displayed value falls back to the external entry.
  // This avoids a sync-via-effect pattern (which is disallowed by
  // react-hooks/set-state-in-effect).
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const externalPartial =
    entry?.score_status === "partial" ? String(Math.round(entry.percent)) : "50";
  const partialDraft = editBuffer ?? externalPartial;

  // Focus + select the partial input on the next mount triggered by
  // a user clicking the Partial button. Using a callback ref (not an
  // effect) keeps this out of the render pipeline and avoids stealing
  // focus on the row's *initial* mount (e.g. when detail loads with a
  // pre-existing partial grade). Stable identity via useCallback so
  // React doesn't re-run it on every render.
  const focusOnMount = useRef(false);
  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el && focusOnMount.current) {
      focusOnMount.current = false;
      el.focus();
      el.select();
    }
  }, []);

  const commitPartial = () => {
    if (editBuffer === null) return; // user didn't actually edit
    const n = parseInt(editBuffer, 10);
    setEditBuffer(null); // always drop back to external after commit
    if (!Number.isFinite(n) || n <= 0 || n >= 100) return; // invalid: snap back
    if (entry?.score_status === "partial" && Math.round(entry.percent) === n) return;
    onChange("partial", n);
  };

  const pickPartial = () => {
    const n = parseInt(partialDraft, 10);
    const safe = Number.isFinite(n) && n > 0 && n < 100 ? n : 50;
    focusOnMount.current = true;
    onChange("partial", safe);
  };

  // Student-facing feedback. When an entry exists we honor its value
  // verbatim — including explicit null, which means "teacher cleared
  // this on purpose". We only fall back to the AI's draft when
  // there's no entry at all (disabled state, below). Same local-buffer
  // pattern as the partial input: `null` means "show the external
  // value", a string means "user is typing". Persisted on blur; the
  // parent's setProblemFeedback dedupes no-op saves.
  //
  // Prefer `aiGrade.student_feedback` (second-person, student-voice)
  // over `aiGrade.reasoning` (teacher-voice grading explanation) for
  // the fallback — the textarea is "shown to student when published"
  // so the draft should already read like teacher-to-student prose.
  // Older AI grades from before student_feedback shipped fall back
  // to reasoning so historical rows still pre-fill.
  const [feedbackBuffer, setFeedbackBuffer] = useState<string | null>(null);
  const externalFeedback =
    entry === null
      ? aiGrade?.student_feedback ?? aiGrade?.reasoning ?? ""
      : entry.feedback ?? "";
  const feedbackDraft = feedbackBuffer ?? externalFeedback;
  const feedbackDisabled = entry === null;

  const commitFeedback = () => {
    // Always commit the displayed value — that way an un-edited blur
    // still saves the AI-reasoning default when the stored feedback is
    // null. The parent's setProblemFeedback dedupes against what's
    // already persisted, so no-op blurs don't false-dirty the row.
    const committed = feedbackBuffer ?? externalFeedback;
    setFeedbackBuffer(null);
    onFeedbackChange(committed);
  };

  // The teacher has overridden the AI when a grade exists and doesn't
  // match the AI's pick. Surface this as a "⟲ AI had suggested X"
  // breadcrumb with one-click undo — the AI's call is preserved, not
  // thrown away.
  const teacherOverrode =
    aiGrade !== null && current !== null && !isAiMatch;

  // Question truncation. Long prompts (multi-paragraph word problems,
  // big LaTeX matrices) push the actually-useful content (student
  // work + answer key + AI verdict) below the fold and slow the
  // teacher's per-problem scan. Default to a 3-line clamp; surface a
  // "Show full prompt" toggle only when the rendered text actually
  // overflows so short questions stay frictionless.
  const [questionExpanded, setQuestionExpanded] = useState(false);
  const [questionOverflows, setQuestionOverflows] = useState(false);
  const questionRef = useRef<HTMLDivElement>(null);
  // Mirror the expanded flag into a ref so the ResizeObserver
  // callback (which closes over a stable element) can short-circuit
  // measurement while the user has the prompt expanded — otherwise
  // an unclamped element measures scrollHeight === clientHeight and
  // we'd erroneously hide the "Hide full prompt" toggle.
  const questionExpandedRef = useRef(questionExpanded);
  useEffect(() => {
    questionExpandedRef.current = questionExpanded;
  }, [questionExpanded]);
  useEffect(() => {
    const el = questionRef.current;
    if (!el) return;
    const measure = () => {
      if (questionExpandedRef.current) return;
      setQuestionOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    // ResizeObserver re-fires when MathText's lazy-loaded diagrams
    // (ChemDiagram, MathGraph via React.lazy + Suspense) mount and
    // bump the rendered height past the clamp. A single rAF would
    // miss them. Cross-student state leaks are handled by composing
    // submission_id into the row's React key (see SubmissionDetailPanel).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [problem.question]);

  // Student work step list. Same clamp-and-expand pattern as the
  // question — long extracted work (15+ steps from a verbose student)
  // would otherwise push the AI verdict and grade buttons way down
  // the page. Default to a max-h cap that fits ~4-5 steps; surface a
  // "Show all N steps" toggle when content overflows.
  const stepCount = problem.student_steps.length;
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [stepsOverflow, setStepsOverflow] = useState(false);
  const stepsRef = useRef<HTMLDivElement>(null);
  const stepsExpandedRef = useRef(stepsExpanded);
  useEffect(() => {
    stepsExpandedRef.current = stepsExpanded;
  }, [stepsExpanded]);
  useEffect(() => {
    const el = stepsRef.current;
    if (!el) return;
    const measure = () => {
      if (stepsExpandedRef.current) return;
      setStepsOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stepCount]);
  const aiGradeLabel = aiGrade
    ? aiGrade.score_status === "partial"
      ? `Partial ${Math.round(aiGrade.percent)}%`
      : aiGrade.score_status === "full"
        ? "Full"
        : "No credit"
    : null;

  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface/40 p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-bold text-text-muted">{problem.position}.</span>
        <div className="min-w-0 flex-1">
          <div
            ref={questionRef}
            // max-h + overflow-hidden (vs line-clamp-3) because the
            // -webkit-box layout that line-clamp relies on reports
            // scrollHeight unreliably when the prompt contains
            // block-level KaTeX (matrices, display equations) — the
            // visual clamp would happen but our scrollHeight ===
            // clientHeight check would miss the overflow and the
            // "Show full question" toggle wouldn't appear. Standard
            // overflow-hidden uses normal flow so scrollHeight
            // correctly accounts for math blocks.
            className={`text-sm text-text-primary ${
              questionExpanded ? "" : "max-h-[5rem] overflow-hidden"
            }`}
            style={
              questionOverflows && !questionExpanded
                ? {
                    // Soft fade at the bottom so a mid-row clamp on a
                    // matrix or display equation reads as "intentionally
                    // cut off" rather than broken. Gradient mask works
                    // in WebKit and modern Firefox.
                    maskImage:
                      "linear-gradient(to bottom, black 70%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black 70%, transparent 100%)",
                  }
                : undefined
            }
          >
            <MathText text={problem.question} />
          </div>
          {questionOverflows && (
            <button
              type="button"
              onClick={() => setQuestionExpanded((v) => !v)}
              aria-expanded={questionExpanded}
              className="mt-1 inline-flex items-center rounded-[--radius-sm] text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {questionExpanded ? (
                <>Hide full question <span aria-hidden>▴</span></>
              ) : (
                <>Show full question <span aria-hidden>▾</span></>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Student answer
          </p>
          <div className="mt-1 rounded-[--radius-sm] bg-surface px-2 py-1 text-sm text-text-primary">
            {problem.student_answer ? (
              <MathText text={problem.student_answer} />
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--color-warning-dark)] ">
                <span aria-hidden>⚠</span>
                No answer extracted — refer to submitted work
              </span>
            )}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Answer key
          </p>
          <div className="mt-1 rounded-[--radius-sm] bg-surface px-2 py-1 text-sm text-text-primary">
            {problem.final_answer ? (
              <MathText text={problem.final_answer} />
            ) : (
              <span className="italic text-text-muted">—</span>
            )}
          </div>
        </div>
      </div>

      {/* Student's work — full step-by-step extraction for this
          problem. Sits between the answer mini-grid and the AI hero
          so the natural eye flow is: compare final answers, scan the
          process, then check the AI's verdict. Hidden when the
          student left this problem blank or extraction never ran for
          this submission. */}
      {stepCount > 0 && (
        <div className="mt-3 rounded-[--radius-md] border border-border-light bg-surface px-3 py-2.5">
          <p className="flex items-baseline gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Student&apos;s work
            <span className="font-normal normal-case tracking-normal text-text-muted/80">
              · {stepCount} {stepCount === 1 ? "step" : "steps"}
            </span>
          </p>
          <div
            ref={stepsRef}
            className={`mt-2 space-y-2 text-sm text-text-primary ${
              stepsExpanded ? "" : "max-h-40 overflow-hidden"
            }`}
            style={
              stepsOverflow && !stepsExpanded
                ? {
                    maskImage:
                      "linear-gradient(to bottom, black 75%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black 75%, transparent 100%)",
                  }
                : undefined
            }
          >
            {problem.student_steps.map((step, i) => (
              <StudentStepRow key={i} step={step} index={i} />
            ))}
          </div>
          {stepsOverflow && (
            <button
              type="button"
              onClick={() => setStepsExpanded((v) => !v)}
              aria-expanded={stepsExpanded}
              className="mt-2 inline-flex items-center rounded-[--radius-sm] text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {stepsExpanded ? (
                <>Hide steps <span aria-hidden>▴</span></>
              ) : (
                <>
                  Show all {stepCount} steps <span aria-hidden>▾</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* AI grading hero — the AI's call is visible before the grade
          buttons, with reasoning inline instead of buried below. When
          no AI grade is present (pipeline failed / disabled), this
          block simply doesn't render. Low-confidence calls (<0.6) get
          an amber pill so the teacher knows where to focus attention;
          historical rows without a confidence value stay neutral. */}
      {aiGrade && aiGradeLabel && (
        <div className="mt-3 rounded-[--radius-md] border border-primary/25 bg-primary-bg px-3 py-2">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-bold text-text-primary">
            <span className="text-primary" aria-hidden>🤖</span>
            <span className="text-primary">Suggestion:</span>
            <span>{aiGradeLabel}</span>
            {aiGrade.confidence !== null && aiGrade.confidence < 0.6 && (
              <span
                className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 "
                title="AI reported low confidence — review this one carefully"
              >
                <span aria-hidden>⚠</span>
                Low confidence · {Math.round(aiGrade.confidence * 100)}%
              </span>
            )}
          </p>
          {aiGrade.reasoning && (
            // Grader reasoning regularly references math ($-17$,
            // $\begin{pmatrix}...$, etc.) — rendering through MathText
            // matches how the rest of the review page surfaces problem
            // text and student work.
            <div className="mt-1 text-[11px] leading-relaxed text-text-secondary">
              <MathText text={aiGrade.reasoning} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <GradeBtn
          active={current === "full"}
          tone="green"
          onClick={() => onChange("full")}
          aiPick={aiGrade?.score_status === "full"}
        >
          Full
        </GradeBtn>
        <GradeBtn
          active={current === "partial"}
          tone="amber"
          onClick={pickPartial}
          aiPick={aiGrade?.score_status === "partial"}
        >
          Partial
        </GradeBtn>
        {current === "partial" && (
          <div className="inline-flex items-center gap-1 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-1 text-xs font-semibold text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
            <input
              ref={setInputRef}
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={partialDraft}
              onChange={(e) => setEditBuffer(e.target.value)}
              onBlur={commitPartial}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Partial credit percent (1-99)"
              className="w-12 bg-transparent text-right tabular-nums focus:outline-none"
            />
            <span aria-hidden>%</span>
          </div>
        )}
        <GradeBtn
          active={current === "zero"}
          tone="red"
          onClick={() => onChange("zero")}
          aiPick={aiGrade?.score_status === "zero"}
        >
          No credit
        </GradeBtn>
      </div>

      {teacherOverrode && aiGrade && aiGradeLabel && (
        <button
          type="button"
          onClick={() =>
            onChange(
              aiGrade.score_status,
              aiGrade.score_status === "partial"
                ? Math.round(aiGrade.percent)
                : undefined,
            )
          }
          className="mt-2 inline-flex items-center gap-1 rounded-[--radius-pill] border border-primary/30 bg-primary-bg px-2.5 py-1 text-[11px] font-semibold text-primary hover:border-primary/60 hover:bg-primary/10"
          title="Revert to the AI's suggested grade"
        >
          <span aria-hidden>⟲</span>
          AI had suggested {aiGradeLabel} · revert
        </button>
      )}

      {/* Per-problem feedback, shown to the student once the grade is
          published. Pre-filled with the AI's reasoning when present so
          teachers can accept, edit, or clear — no UI fanfare either
          way. The published text is the teacher's voice to the student. */}
      <div className="mt-3">
        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          Feedback <span className="font-normal normal-case tracking-normal text-text-muted/80">· shown to student when published</span>
        </label>
        <textarea
          // When disabled (no grade yet), render empty so the
          // placeholder "Pick Full/Partial/Zero first..." is visible.
          // Otherwise the textarea would show AI reasoning as an
          // uneditable grey block, which hides the actual instruction.
          value={feedbackDisabled ? "" : feedbackDraft}
          onChange={(e) => setFeedbackBuffer(e.target.value)}
          onBlur={commitFeedback}
          disabled={feedbackDisabled}
          maxLength={2000}
          rows={3}
          placeholder={
            feedbackDisabled
              ? "Pick Full / Partial / No credit first — then you can leave feedback."
              : "Add a sentence the student will see…"
          }
          className="mt-1 w-full resize-y rounded-[--radius-sm] border border-border-light bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted"
        />
      </div>
    </div>
  );
}

function GradeBtn({
  active,
  tone,
  onClick,
  children,
  aiPick = false,
}: {
  active: boolean;
  tone: "green" | "amber" | "red";
  onClick: () => void;
  children: React.ReactNode;
  /** Mark this button as the AI's suggestion. When not the active
   *  choice, a subtle primary-tinted outline signals "the AI
   *  recommended this". Always pairs with an inline "AI" pill. */
  aiPick?: boolean;
}) {
  const activeCls = {
    green: "border-green-500 bg-green-500 text-white",
    amber: "border-[color:var(--color-warning)] bg-[color:var(--color-warning)] text-white",
    red: "border-[color:var(--color-error)] bg-[color:var(--color-error-light)] text-white",
  }[tone];
  const inactiveCls = aiPick
    ? "border-primary/40 bg-primary-bg text-text-primary hover:border-primary/60"
    : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-[--radius-md] border px-3 py-1.5 text-xs font-bold transition-colors ${
        active ? activeCls : inactiveCls
      }`}
    >
      {children}
      {aiPick && (
        <span
          className={`rounded-[--radius-pill] px-1.5 py-0.5 text-[9px] font-bold leading-none ${
            active ? "bg-white/30 text-white" : "bg-primary/15 text-primary"
          }`}
          aria-label="AI suggestion"
        >
          AI
        </span>
      )}
    </button>
  );
}

// Visual treatment for each disposition. Paired with both an icon
// and explicit copy so color-only signal is never the whole story
// (colorblind-safe by design).
// Icon badge color (`iconBg`) carries the disposition valence in a
// solid, high-contrast form. The surrounding card stays on a light
// tint (`bg`) as soft context, but the TITLE lives in neutral
// `text-text-primary` so it's always unambiguously readable — we
// learned from two prior passes that light colored text on tinted
// bg reads as washed-out regardless of contrast math.
type IntegrityBannerKey =
  | IntegrityDisposition
  | "extracting"
  | "awaiting_student"
  | "in_progress"
  | "skipped_unreadable"
  | "needs_review";

const NEUTRAL_STYLE = {
  bg: "bg-[color:var(--color-surface-alt-2)]",
  border: "border-border-light",
  iconBg: "bg-gray-400 text-white dark:bg-gray-500",
};

const INTEGRITY_STYLE: Record<
  IntegrityBannerKey,
  { bg: string; border: string; iconBg: string; icon: string; label: string }
> = {
  pass: {
    bg: "bg-green-50 dark:bg-green-900/20",
    border: "border-green-200 dark:border-green-900/40",
    iconBg: "bg-green-600 text-white",
    icon: "✓",
    label: "Student understood their own work",
  },
  needs_practice: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-200 dark:border-blue-900/40",
    iconBg: "bg-blue-600 text-white",
    icon: "↻",
    label: "Procedural knowledge — consider revisiting the concept",
  },
  tutor_pivot: {
    bg: "bg-[color:var(--color-warning-bg)]",
    border: "border-[color:var(--color-warning)]/30",
    iconBg: "bg-[color:var(--color-warning-dark)] text-white",
    icon: "?",
    label: "Student was lost — got tutored through it",
  },
  flag_for_review: {
    bg: "bg-[color:var(--color-error-light)] ",
    border: "border-[color:var(--color-error-border)] ",
    iconBg: "bg-[color:var(--color-error)] text-white",
    icon: "⚑",
    label: "Review — correct work but couldn't explain it",
  },
  needs_review: {
    ...NEUTRAL_STYLE,
    icon: "◌",
    label: "Inconclusive — teacher review",
  },
  extracting: {
    ...NEUTRAL_STYLE,
    icon: "…",
    label: "Preparing the integrity check…",
  },
  awaiting_student: {
    ...NEUTRAL_STYLE,
    icon: "·",
    label: "Integrity check hasn't been started yet",
  },
  in_progress: {
    ...NEUTRAL_STYLE,
    icon: "…",
    label: "Integrity check running",
  },
  skipped_unreadable: {
    ...NEUTRAL_STYLE,
    icon: "·",
    label: "Couldn't read student's work — review their submission",
  },
};

// ── Verdict legend ──────────────────────────────────────────────────
//
// Nine disposition / status states is a lot to learn from icons alone.
// First-time teachers consistently asked "what does ↻ mean vs ⚑?" so
// we surface a small affordance in the roster header that opens a
// keyed reference card. Same icons + colors as the live banner, so
// what the teacher learns here matches what they see on each row.
//
// The labels deliberately drop the implementation jargon (`pass` /
// `tutor_pivot` / `flag_for_review`) — teachers see the meaning, not
// the enum.

const VERDICT_LEGEND_ITEMS: { key: IntegrityBannerKey; description: string }[] = [
  { key: "pass", description: "Student explained their work clearly. Probably did the assignment themselves." },
  { key: "needs_practice", description: "Got the right answer mechanically but couldn't show why it works. Worth revisiting in class." },
  { key: "tutor_pivot", description: "Student got stuck and the AI walked them through it. Their submitted work doesn't reflect what they could do alone." },
  { key: "flag_for_review", description: "Submitted work is correct but the student couldn't explain it. Most likely cheating signal — open the conversation to decide." },
  { key: "needs_review", description: "Check ran but couldn't reach a verdict (e.g. ran out of turns). Manual review recommended." },
  { key: "skipped_unreadable", description: "Vision couldn't read the student's submission. Grade manually, or have them re-submit." },
  { key: "extracting", description: "Vision is still parsing the student's work. The verdict will arrive shortly." },
  { key: "in_progress", description: "Student is actively chatting with the AI. Verdict pending." },
  { key: "awaiting_student", description: "Student submitted but hasn't started the integrity conversation yet." },
];

function VerdictLegendTrigger() {
  const [open, setOpen] = useState(false);
  // Capture the trigger so we can restore focus on close — without
  // this, after closing the modal focus jumps to <body> and the
  // teacher loses their place in the page.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-[--radius-sm] px-1.5 py-0.5 text-[10px] font-semibold text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label="Show integrity verdict legend"
      >
        <span aria-hidden>ℹ</span>
        <span className="uppercase tracking-wider">Guide</span>
      </button>
      {open && (
        <VerdictLegendModal
          onClose={() => {
            setOpen(false);
            // Defer until after React unmounts the modal so the trigger
            // is back in the document and focusable.
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        />
      )}
    </>
  );
}

function VerdictLegendModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Escape closes — keyboard parity with the rest of the app's
  // dialogs. Listener lives on document so it fires regardless of
  // current focus inside the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog on open so screen readers announce
  // the title and Tab cycles within the legend's controls. The
  // wrapper has tabIndex={-1} purely to make it focusable.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verdict-legend-title"
        className="w-full max-w-lg rounded-[--radius-xl] bg-surface p-6 shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="verdict-legend-title"
              className="text-lg font-bold text-text-primary"
            >
              What the verdicts mean
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Veradic asks each student to explain a sample of their work after
              they submit. The verdict on each row is what the AI concluded
              from that conversation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        </div>
        <ul className="mt-4 space-y-3">
          {VERDICT_LEGEND_ITEMS.map(({ key, description }) => {
            const style = INTEGRITY_STYLE[key];
            return (
              <li key={key} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${style.iconBg}`}
                  aria-hidden
                >
                  {style.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">
                    {style.label}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {description}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Top-of-pane integrity verdict. Shows the overall badge + AI summary
 * inline, and exposes the full agent↔student conversation behind a
 * "View conversation" button. When the full `TeacherIntegrityDetail`
 * hasn't loaded yet, falls back to the overview on the submission row
 * so the teacher still sees the verdict/in-progress state during the
 * brief fetch gap. Hides entirely when there's no integrity signal.
 */
function IntegrityBanner({
  integrity,
  overviewFallback,
}: {
  integrity: TeacherIntegrityDetail | null;
  overviewFallback: TeacherSubmissionRow["integrity_overview"] | null;
}) {
  const [open, setOpen] = useState(false);

  // Prefer full detail. If it's missing (fetch pending / 404), use
  // the overview so the disposition signal still surfaces without
  // waiting for a second round-trip.
  const disposition =
    integrity?.disposition ?? overviewFallback?.disposition ?? null;
  const summary = integrity?.overall_summary ?? null;
  // Detail is the canonical source of the granular status (extracting
  // / awaiting_student / in_progress / complete / skipped_unreadable).
  // Overview only carries "in_progress" or "complete" — fine as a
  // fallback while detail is fetching, but detail wins when present.
  const status = integrity?.overall_status ?? overviewFallback?.overall_status ?? null;

  // Disposition wins when the AI reached a verdict. Otherwise route
  // each status to its own copy so a teacher gets actionable info,
  // not a generic "couldn't determine."
  const key = ((): IntegrityBannerKey | null => {
    if (disposition) return disposition;
    switch (status) {
      case "extracting":
      case "awaiting_student":
      case "in_progress":
      case "skipped_unreadable":
        return status;
      // Complete + no disposition = turn cap hit without conclusion.
      case "complete":
        return "needs_review";
      default:
        return null;
    }
  })();
  if (!key) return null;
  const style = INTEGRITY_STYLE[key];
  // Prefer the agent-emitted headline (chat-grounded verdict title) over
  // the generic per-disposition fallback. AI-emitted is only present
  // when the agent ran a finish_check; non-AI states (extracting,
  // awaiting_student, in_progress, skipped_unreadable) and force-finalize
  // turn-cap rows have a null headline and fall through to style.label.
  const title = integrity?.headline ?? style.label;
  // Hide "View conversation" until at least one student turn exists.
  // For awaiting_student the transcript may carry the AI opener alone;
  // there's nothing meaningful for the teacher to read yet.
  const hasMeaningfulTranscript =
    !!integrity && integrity.transcript.some((t) => t.role === "student");

  const activitySummary = integrity?.activity_summary ?? null;

  return (
    <>
      <div className="space-y-2">
        <div
          className={`rounded-[--radius-xl] border ${style.border} ${style.bg} p-3`}
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${style.iconBg}`}
                aria-hidden
              >
                {style.icon}
              </span>
              <div className="min-w-0 flex-1">
                {/* Activity pill lives only on the sidebar student row,
                 * where it carries unique scan-path signal (passing
                 * student with flagged activity vs clean). Inside the
                 * focused detail view the disposition label and the
                 * Activity panel below already convey understanding +
                 * behavior; an extra pill here was redundant. */}
                <p className="text-sm font-semibold text-text-primary">
                  {title}
                </p>
                {summary && (
                  <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                    {summary}
                  </p>
                )}
                {key === "in_progress" && overviewFallback && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    {overviewFallback.complete_count} of{" "}
                    {overviewFallback.problem_count} sampled problems graded.
                  </p>
                )}
              </div>
            </div>
            {hasMeaningfulTranscript && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="shrink-0 rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary focus:border-primary focus:outline-none"
              >
                View conversation →
              </button>
            )}
          </div>
        </div>
        {/* Session digest sits below the banner so the totals don't
         * crowd the disposition label. Hides itself on null.
         * Always neutral-styled — banner above carries the verdict
         * color; digest is supporting evidence, not a second alarm. */}
        <ActivityDigest summary={activitySummary} />
      </div>
      {integrity && (
        <ConversationModal
          open={open}
          onClose={() => setOpen(false)}
          integrity={integrity}
        />
      )}
    </>
  );
}

/**
 * Full agent↔student transcript + per-problem verdicts. This is the
 * "drill in" surface for a teacher who doesn't trust the banner's
 * one-line verdict. Turn-by-turn so the teacher can judge for
 * themselves whether the student's explanations actually matched
 * their written work.
 */
function ConversationModal({
  open,
  onClose,
  integrity,
}: {
  open: boolean;
  onClose: () => void;
  integrity: TeacherIntegrityDetail;
}) {
  // Index notable turns by ordinal so each TranscriptTurn can render
  // its inline marker in O(1).
  const notableByOrdinal = useMemo(() => {
    const out = new Map<number, IntegrityActivityNotableTurnLite>();
    for (const nt of integrity.activity_summary?.notable_turns ?? []) {
      out.set(nt.ordinal, nt);
    }
    return out;
  }, [integrity.activity_summary?.notable_turns]);

  // Tool calls and tool results are AI internals — filter before render
  // so the teacher sees only natural-language turns. Turn count in the
  // header reflects the visible count, not the raw transcript length.
  const visibleTurns = useMemo(
    () =>
      integrity.transcript.filter(
        (t) => t.role !== "tool_call" && t.role !== "tool_result",
      ),
    [integrity.transcript],
  );

  // Subtitle telegraphs scope before the teacher reads the dialogue:
  // "Discussing Problem 3" / "Discussing Problems 3, 5". Uses HW
  // position so the label matches what the student saw in chat.
  const discussedLabel = useMemo(() => {
    if (integrity.problems.length === 0) return null;
    const positions = integrity.problems
      .map((p) => p.hw_position)
      .sort((a, b) => a - b);
    const noun = positions.length === 1 ? "Problem" : "Problems";
    return `Discussing ${noun} ${positions.join(", ")}`;
  }, [integrity.problems]);

  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl bg-surface p-0">
      <div className="flex items-center justify-between border-b border-border-light px-5 py-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary">
            AI ↔ student conversation
          </h3>
          <p className="text-[11px] text-text-muted">
            {visibleTurns.length} turns
            {discussedLabel && <> · {discussedLabel}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[--radius-md] px-2 py-1 text-xs font-semibold text-text-muted hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary"
          aria-label="Close"
        >
          Close ✕
        </button>
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
        {visibleTurns.map((t) => (
          <TranscriptTurn
            key={t.ordinal}
            turn={t}
            notable={notableByOrdinal.get(t.ordinal)}
          />
        ))}
      </div>
    </Modal>
  );
}

function TranscriptTurn({
  turn,
  notable,
}: {
  turn: TeacherIntegrityTranscriptTurn;
  notable: IntegrityActivityNotableTurnLite | undefined;
}) {
  const isAgent = turn.role === "agent";
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex gap-2 ${isAgent ? "" : "flex-row-reverse"}`}>
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            isAgent
              ? "bg-primary text-white"
              : "bg-[color:var(--color-surface-alt-2)] text-text-secondary"
          }`}
          aria-hidden
        >
          {isAgent ? "AI" : "S"}
        </div>
        <div
          className={`max-w-[80%] rounded-[--radius-md] px-3 py-2 text-xs leading-relaxed ${
            isAgent
              ? "bg-primary-bg text-text-primary"
              : "bg-[color:var(--color-surface-alt-2)] text-text-primary"
          }`}
        >
          <MathText text={turn.content} />
          {turn.seconds_on_turn != null && !isAgent && (
            <span className="mt-1 block text-[10px] text-text-muted">
              · {Math.round(turn.seconds_on_turn)}s to reply
            </span>
          )}
        </div>
      </div>
      {/* Marker hangs under the right-aligned student bubble. ml-auto
        * on a flex-col child pushes it horizontally to the right. */}
      {!isAgent && (
        <div className="ml-auto">
          <ActivityTurnMarker turn={turn} notable={notable} />
        </div>
      )}
    </div>
  );
}

/**
 * Student's submitted pages (images + PDFs): compact thumbnail +
 * page count that opens every file in a modal. The work is a
 * reference the teacher consults WHILE grading, so it lives in the
 * page header strip — one click away from any scroll position —
 * rather than as its own scan-path block.
 */
function StudentWorkThumbButton({ files }: { files: SubmissionFile[] }) {
  // Header-strip affordance — small thumb (first page) + page count,
  // expands on click to a vertical scroll-stack of every submitted
  // file. The vertical stack is intentional: while grading, teachers
  // want to scan all pages at once, not click prev/next.
  const [open, setOpen] = useState(false);
  const first = files[0];
  if (!first) return null;
  const firstSrc = `data:${first.media_type};base64,${first.data}`;
  const firstIsPdf = first.media_type === "application/pdf";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-1.5 rounded-[--radius-md] border border-border-light bg-surface px-2 py-1 text-xs font-semibold text-text-secondary transition-all hover:border-primary/40 hover:text-primary focus:border-primary focus:outline-none"
        aria-label="View student's handwritten work full size"
      >
        <span className="relative block h-7 w-10 shrink-0 overflow-hidden rounded-[--radius-sm] border border-border-light bg-[color:var(--color-surface-alt-2)]">
          {firstIsPdf ? (
            <span className="flex h-full w-full items-center justify-center text-[9px] font-bold text-text-muted">
              PDF
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={firstSrc} alt="" className="h-full w-full object-cover" />
          )}
        </span>
        <span>
          View work{files.length > 1 ? ` · ${files.length} pages` : ""} ↗
        </span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} className="max-w-4xl bg-surface p-3">
        <div className="flex items-center justify-between pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Student&apos;s work
            {files.length > 1 ? ` · ${files.length} pages` : ""}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-[--radius-md] px-2 py-1 text-xs font-semibold text-text-muted hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary"
            aria-label="Close"
          >
            Close ✕
          </button>
        </div>
        <div className="mx-auto flex max-h-[80vh] flex-col gap-3 overflow-y-auto">
          {files.map((f, i) => {
            const src = `data:${f.media_type};base64,${f.data}`;
            if (f.media_type === "application/pdf") {
              return (
                <embed
                  key={i}
                  src={src}
                  type="application/pdf"
                  className="h-[70vh] w-full rounded-[--radius-md] border border-border-light bg-white"
                />
              );
            }
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`Student handwritten submission, page ${i + 1}`}
                className="rounded-[--radius-md] border border-border-light object-contain"
              />
            );
          })}
        </div>
      </Modal>
    </>
  );
}
