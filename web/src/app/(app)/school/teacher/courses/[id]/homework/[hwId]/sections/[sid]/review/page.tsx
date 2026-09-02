"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MathText, mathPlainText } from "@/components/shared/math-text";
import { Modal } from "@/components/ui/modal";
import {
  ActivityDigest,
  ActivityPill,
  ActivityTurnMarker,
  integrityNeedsResolution,
  ResolveIntegrityControl,
  RowDispositionPill,
  type IntegrityActivityNotableTurnLite,
} from "@/components/school/teacher/_pieces/submissions-panel";
import { Skeleton } from "@/components/ui";
import { PdfView } from "@/components/ui/pdf-view";
import { WorkGalleryModal } from "@/components/school/teacher/_pieces/work-gallery";
import {
  teacher,
  type AiGradeEntry,
  type GradeBreakdownEntry,
  type GradeDeduction,
  type IntegrityDisposition,
  type IntegrityResolutionOutcome,
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

// ── Keyboard grading — focus-safety helpers ─────────────────────────
//
// The grading shortcuts (1/2/3, j/k, Enter…) live on a document-level
// listener so they work no matter where focus sits in the problems
// pane. That power makes guarding against accidental hijacks the whole
// game: a teacher typing "2/3" in a feedback box, or a percent into the
// partial input, must NEVER trip a grade shortcut.
//
// `isTypingTarget` is the gate — when the active element is any text
// surface (input, textarea, select, or contenteditable) the global
// handler bails entirely. We read `document.activeElement` rather than
// the event target because the listener is global and we care about
// where focus actually *is*, not where the key originated.
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

// Any open modal on this page renders a `[role="dialog"]` (the shared
// Modal — publish/regrade confirms — plus the verdict-legend, integrity
// conversation, and image lightbox). They're all conditionally rendered,
// so a match means a dialog is genuinely open. While one is, the grading
// shortcuts must NOT fire — otherwise 1/2/3 would grade the problem
// *behind* the dialog and Enter/→ would switch students underneath a
// publish/regrade confirm. The dialog owns the keyboard until it closes.
function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

// `isActionableTarget` distinguishes a focused button/link (which
// handles its own Enter/Space activation) from a focused problem row
// (an inert tabIndex=-1 div). We only treat Enter as "next student"
// when focus is NOT on an actionable control, so pressing Enter on a
// focused grade button activates that button instead of double-firing
// a student advance.
function isActionableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "BUTTON" || tag === "A") return true;
  return el.getAttribute("role") === "button";
}

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

type RosterFilter = "all" | "needs_me" | "flagged" | "low_confidence";

// AI grader confidence bands. The pipeline reports a calibrated 0-1
// score per problem; we read it, never compute it. <0.6 is the
// long-standing "alarm" threshold (amber low-confidence emphasis);
// 0.6-0.85 is medium; >=0.85 is high. Surfacing all three — instead of
// only the alarm — lets a teacher triage toward the calls the model was
// least sure of, the safety rail a future bulk-accept feature needs.
const CONFIDENCE_LOW = 0.6;
const CONFIDENCE_HIGH = 0.85;

// Shared empty set for the "this state belongs to a different submission"
// derivation — avoids allocating a new Set on every render while a
// student's confirm/expand selections are scoped to their submission id.
const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

function confidenceBand(c: number): "high" | "medium" | "low" {
  if (c >= CONFIDENCE_HIGH) return "high";
  if (c >= CONFIDENCE_LOW) return "medium";
  return "low";
}

// A problem the AI is confident about — high band (>=0.85) on a present
// AI grade. These COLLAPSE to a one-line confirm row in the triage detail
// pane; everything else (medium / low / no AI grade) stays fully
// expanded. A teacher override re-expands the row (handled at the call
// site via the override check) so the teacher is never editing inside a
// collapsed summary.
function isConfidentAi(ai: AiGradeEntry | null): boolean {
  return ai !== null && ai.confidence !== null && ai.confidence >= CONFIDENCE_HIGH;
}

// The grading key that re-affirms the AI's suggestion in place. Quarter
// scale: 1=full, 5=zero, partial→nearest quarter key (2=75, 3=50, 4=25).
// Pressing this key on a collapsed confident row CONFIRMS it; pressing
// any other grade key is an override that expands + re-grades.
function aiConfirmKey(ai: AiGradeEntry | null): "1" | "2" | "3" | "4" | "5" | null {
  if (!ai) return null;
  if (ai.score_status === "full") return "1";
  if (ai.score_status === "zero") return "5";
  if (ai.percent >= 62.5) return "2";
  if (ai.percent >= 37.5) return "3";
  return "4";
}

// Has the teacher moved a problem off the AI's call? Compares the live
// grade entry to the AI suggestion (status, and percent for partials).
// Used both to draw the "revert" breadcrumb and to force a confident
// row back open — a teacher mid-edit must never be editing inside a
// collapsed one-liner.
function teacherOverrodeAi(
  entry: GradeBreakdownEntry | null,
  ai: AiGradeEntry | null,
): boolean {
  if (!ai || !entry) return false;
  if (entry.score_status !== ai.score_status) return true;
  return (
    entry.score_status === "partial" &&
    Math.round(entry.percent) !== Math.round(ai.percent)
  );
}

// Always-on AI confidence indicator for a single grade. Reads the
// pipeline's calibrated value — never computes or mutates it. Null
// (historical, pre-confidence rows) renders nothing so those stay
// neutral. Low keeps the loud amber pill it always had; high/medium are
// deliberately quiet (a hairline dot + muted label) so a teacher
// grading 30 papers is only pulled toward the uncertain calls.
function ConfidenceSignal({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const band = confidenceBand(confidence);
  const pct = Math.round(confidence * 100);

  if (band === "low") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-warning-dark)] dark:bg-[color:var(--color-warning)]/10"
        title={`AI reported low confidence (${pct}%) — review this one carefully`}
      >
        <span aria-hidden>⚠</span>
        Low confidence · {pct}%
      </span>
    );
  }

  const dotClass =
    band === "high"
      ? "bg-[color:var(--color-success)]"
      : "bg-[color:var(--color-warning)]";
  const label = band === "high" ? "High" : "Medium";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted"
      title={`AI grading confidence: ${label.toLowerCase()} (${pct}%)`}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`}
      />
      AI · {label} {pct}%
    </span>
  );
}

// Suspense boundary required because the inner component reads
// useSearchParams (the ?student= deep-link focus), which opts the page
// into dynamic rendering and must be wrapped to satisfy Next.js.
export default function HomeworkSectionReviewPage(props: {
  params: Promise<{ id: string; hwId: string; sid: string }>;
}) {
  return (
    <Suspense>
      <HomeworkSectionReview {...props} />
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
  const searchParams = useSearchParams();
  const focusStudentId = searchParams.get("student");

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
  // signal is `reviewed_at`, stamped only by the explicit Approve button.
  const [confirmedBySubmission, setConfirmedBySubmission] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());

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
    [],
  );
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
  // Other-section submissions about to be published (pending or dirty)
  // whose integrity check landed on an unresolved flag_for_review. The
  // publish action is HW-wide, so the soft publish-confirm must count
  // these too — snapshotted at fetch time like the counters above.
  const [flaggedOtherSections, setFlaggedOtherSections] = useState(0);
  // Submission currently being marked reviewed via the explicit no-edit
  // affordance. Single slot — only one student is open at a time.
  const [markingReviewedId, setMarkingReviewedId] = useState<string | null>(null);
  // Submissions with a grade-save PATCH in flight. A grade save revokes
  // approval server-side, so we must NOT let the teacher click Approve
  // (or Undo) mid-save — the stamp would land against a version the save
  // is about to change, leaving the row DB-unapproved while the UI reads
  // "Approved ✓". Disabling those controls while the save is in flight
  // closes that TOCTOU window. A Set so concurrent per-submission saves
  // are tracked independently.
  const [savingGradeIds, setSavingGradeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Whether the pinned work rail (wide layout) shows the photo inline.
  // A session preference — lifted here so it persists across students.
  const [photoPinned, setPhotoPinned] = useState(true);
  // Bumped to re-run the roster load effect. Grading happens
  // server-side after the request returns, so there is nothing to
  // patch optimistically — the grades genuinely don't exist yet, and
  // inventing them client-side would show a teacher scores that
  // aren't real. Refetch instead.
  const [reloadNonce, setReloadNonce] = useState(0);
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
        let otherFlagged = 0;
        // The teacher's own rehearsal, if she left one in this section.
        // Held aside rather than skipped: it belongs on the roster so
        // she can open it and see what grading her students' work will
        // look like. It stays out of the counts that describe a CLASS —
        // she is not in her own class — but not out of the counts that
        // label a BUTTON. See the two-populations note further down.
        let previewEntry: RosterEntry | null = null;
        for (const r of subs.submissions) {
          if (r.section_id === sectionId) {
            if (r.is_preview) {
              previewEntry = {
                student_id: r.student_id,
                student_name: r.student_name || r.student_email,
                student_email: r.student_email,
                submission: r,
              };
            } else {
              submissionByStudent.set(r.student_id, r);
            }
            continue;
          }
          // Another section's row — a classmate's, or her own rehearsal
          // left in a sibling section. Both are counted here, and the
          // ONLY difference between them is the class tally below. That
          // is deliberate: this used to be two branches, and each time a
          // counter was added to one and not the other the totals
          // disagreed depending on which section page you opened.
          if (r.final_score === null) continue;
          // Class tally. gradedTotal's only consumer is the pill
          // choosing between "No grades to publish" and "All grades
          // published" — a claim about the class, so her rehearsal must
          // not be what flips a section to "all published" when none of
          // her students' work has been.
          if (!r.is_preview) otherGraded += 1;
          // Everything below is an ACTION count. Publishing is
          // homework-wide, so the button releases her rehearsal from
          // here too, and every label and warning on that click has to
          // say so — including the reviewed/unopened split and the
          // flagged soft-confirm. This mirrors the in-section loop,
          // which guards only its `graded` tally the same way.
          //
          // Flagged rule (same as in-section): only flag_for_review,
          // only while unresolved, only when the grade is actually
          // about to go out.
          const ov = r.integrity_overview;
          const isFlaggedUnresolved =
            ov?.disposition === "flag_for_review" &&
            ov.resolution === "unresolved";
          if (r.grade_published_at === null) {
            otherPending += 1;
            if (r.reviewed_at) otherPendingReviewed += 1;
            if (isFlaggedUnresolved) otherFlagged += 1;
          } else if (r.grade_dirty) {
            otherDirty += 1;
            if (r.reviewed_at) otherDirtyReviewed += 1;
            if (isFlaggedUnresolved) otherFlagged += 1;
          }
        }
        setPendingOtherSections(otherPending);
        setDirtyOtherSections(otherDirty);
        setGradedOtherSections(otherGraded);
        setPendingReviewedOtherSections(otherPendingReviewed);
        setDirtyReviewedOtherSections(otherDirtyReviewed);
        setFlaggedOtherSections(otherFlagged);
        const merged: RosterEntry[] = s.students
          .map((st) => ({
            student_id: st.id,
            student_name: st.name || st.email,
            student_email: st.email,
            submission: submissionByStudent.get(st.id) ?? null,
          }))
          .sort((a, b) => a.student_name.localeCompare(b.student_name));
        // Appended last, and TriageRoster keeps it there: it is pulled
        // out of the status buckets and rendered under its own "Your
        // test run" header after them, so it can never sort above her
        // students.
        if (previewEntry) merged.push(previewEntry);
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
        // A deep-link from the triage queue pins the exact student, but
        // only if they actually submitted on this roster — otherwise the
        // stale param is ignored and we fall back to the auto-pick.
        const focused =
          focusStudentId !== null
            ? merged.find(
                (e) => e.student_id === focusStudentId && e.submission !== null,
              )
            : undefined;
        // Only auto-select on a FIRST load. This effect also re-runs on
        // a post-grading refetch, and re-picking there would throw a
        // teacher who was reading student #12 back to the first
        // unreleased submitter — they pressed "Grade all", they didn't
        // ask to be moved. Roster clicks don't write `?student=`, so
        // `focused` can't preserve their place either.
        setSelectedStudentId((current) => {
          if (current && merged.some((e) => e.student_id === current)) {
            return current;
          }
          const pick = focused ?? firstUnreleased ?? firstSubmitter;
          return pick ? pick.student_id : current;
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load submissions");
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, courseId, sectionId, focusStudentId, reloadNonce]);

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
        "final_score" | "breakdown" | "grade_dirty"
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
  // Per-submission save serialization. Each grade save sends the FULL
  // breakdown snapshot with last-write-wins semantics, so two overlapping
  // requests can finish out of order — an earlier (smaller) snapshot landing
  // after a later (larger) one silently drops a grade on the server. Rapid
  // keyboard grading (1,1,3,1,5 straight down) is exactly what triggers it.
  // Fix: at most one save in flight per submission; while one runs, newer
  // grades just update `latest`, and the drain loop saves only that latest
  // snapshot when the in-flight save returns. Ordered + coalesced → no race.
  const saveStateRef = useRef<
    Map<string, { inFlight: boolean; latest: GradeBreakdownEntry[] | null }>
  >(new Map());

  const persistBreakdown = useCallback(
    async (submissionId: string, breakdown: GradeBreakdownEntry[]) => {
      const map = saveStateRef.current;
      let s = map.get(submissionId);
      if (!s) {
        s = { inFlight: false, latest: null };
        map.set(submissionId, s);
      }
      // Always remember the most recent snapshot to be saved.
      s.latest = breakdown;

      // Editing an approved grade REVOKES the approval — approval means "I
      // vouched for THIS grade," so changing it invalidates the stamp. The
      // server does this unconditionally on every grade-save (revoke-if-set,
      // else no-op; an un-grade clears it too), so a grade-save always leaves
      // reviewed_at null. We mirror that optimistically here — the choke point
      // every edit path flows through — so the "Approved ✓" pill flips back to
      // "Not reviewed" instantly, without waiting on (or racing) the response.
      // Clearing a null is a no-op, so first-grade saves are unaffected. We
      // intentionally do NOT thread the save RESPONSE's reviewed_at back: a
      // stale null landing after a fresh Approve click could clobber it, and
      // this optimistic clear already matches the server exactly.
      setDetail((d) =>
        d && d.submission_id === submissionId && d.reviewed_at
          ? { ...d, reviewed_at: null }
          : d,
      );
      setRoster((prev) =>
        prev
          ? prev.map((e) =>
              e.submission?.id === submissionId && e.submission?.reviewed_at
                ? { ...e, submission: { ...e.submission, reviewed_at: null } }
                : e,
            )
          : prev,
      );

      // A save is already running — it will pick up `latest` when it drains.
      if (s.inFlight) return;

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
        while (s.latest) {
          const toSave = s.latest;
          s.latest = null;
          const res = await teacher.gradeSubmission(submissionId, {
            breakdown: toSave,
          });
          applyGradeToRoster(submissionId, {
            final_score: res.final_score,
            breakdown: toSave,
            grade_dirty: res.grade_dirty,
            // reviewed_at is handled by the optimistic clear above, NOT
            // threaded from `res` — a grade-save always revokes any approval
            // server-side, and mirroring that at edit time avoids a stale
            // response clobbering a fresh Approve. See the note at the top of
            // persistBreakdown.
          });
          setDetail((d) =>
            d && d.submission_id === submissionId
              ? { ...d, grade_dirty: res.grade_dirty }
              : d,
          );
        }
      } catch (e) {
        setSaveError({
          forSubmissionId: submissionId,
          message: e instanceof Error ? e.message : "Failed to save grade",
        });
        // Drop any queued snapshot — the optimistic UI still shows the grade
        // and the teacher can re-click to retry; avoids a hot retry loop.
        s.latest = null;
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
    flaggedToPublishInSection,
  } = useMemo(() => {
    let pending = 0;
    let dirty = 0;
    let graded = 0;
    let reviewedToPublish = 0;
    let flaggedToPublish = 0;
    for (const e of roster ?? []) {
      const s = e.submission;
      if (!s || s.final_score === null) continue;
      // Class-side on purpose: gradedTotal's only consumer is the
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
      // Soft publish-confirm: a grade about to go out whose integrity
      // check landed on flag_for_review and the teacher hasn't resolved
      // it yet. Only flag_for_review (not the other dispositions) and
      // only while unresolved — a teacher who marked it reviewed has
      // already made the call. This is the in-section portion; the
      // cross-section portion (flaggedOtherSections) is added in below
      // so the count matches what the HW-wide publish actually releases.
      const ov = s.integrity_overview;
      if (
        (isPending || isDirty) &&
        ov?.disposition === "flag_for_review" &&
        ov.resolution === "unresolved"
      ) {
        flaggedToPublish += 1;
      }
    }
    return {
      pendingInSection: pending,
      dirtyInSection: dirty,
      gradedInSection: graded,
      reviewedToPublishInSection: reviewedToPublish,
      flaggedToPublishInSection: flaggedToPublish,
    };
  }, [roster]);
  const pendingTotal = pendingInSection + pendingOtherSections;
  const dirtyTotal = dirtyInSection + dirtyOtherSections;
  const gradedTotal = gradedInSection + gradedOtherSections;
  // Turned in, but no AI grade yet. AI grading is queued and runs when
  // the due date passes; a HW with no due date never grades on its own
  // (there's no moment that means "the class is in"), so for those this
  // count only ever falls when the teacher asks. Section-scoped: the
  // button acts on this HW, and showing a HW-wide number next to a
  // section-scoped action would misdescribe what pressing it does.
  const ungradedInSection = useMemo(() => {
    if (!roster) return 0;
    // Action count — "Grade N now" does grade her rehearsal too.
    return roster.filter((e) => isAwaitingGrade(e)).length;
  }, [roster]);
  // Reviewed vs unopened split of the full to-release set (HW-wide).
  const toReleaseTotal = pendingTotal + dirtyTotal;
  const reviewedToPublishTotal =
    reviewedToPublishInSection +
    pendingReviewedOtherSections +
    dirtyReviewedOtherSections;
  const unreviewedToPublishTotal = toReleaseTotal - reviewedToPublishTotal;
  // Flagged-to-publish across the whole HW — the publish action is
  // HW-wide, so the soft confirm counts both the loaded section and the
  // snapshotted other-section flags.
  const flaggedToPublishTotal = flaggedToPublishInSection + flaggedOtherSections;

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
    async (reviewedOnly = false): Promise<boolean> => {
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
          // Full publish releases every other-section flag too. (A
          // reviewed-only run can leave unreviewed flags unpublished, and
          // we don't track the reviewed-flag split — that path keeps the
          // snapshot, refreshed on next open like the other counters.)
          setFlaggedOtherSections(0);
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
        return true;
      } catch (e) {
        setPublishError(
          e instanceof Error ? e.message : "Failed to publish grades",
        );
        return false;
      } finally {
        setPublishing(false);
      }
    },
    [assignmentId, pendingReviewedOtherSections, dirtyReviewedOtherSections],
  );

  // Publish-button click gate. If every grade about to go out is approved
  // and none are flagged-unresolved, there's nothing to warn about —
  // publish straight through (no interruption). Otherwise open the
  // confirm so the teacher decides on the unapproved / flagged grades
  // with eyes open. A direct publish that errors falls back to opening
  // the dialog so its error + retry are visible.
  // "Grade all". AI grading is queued and normally runs when the due
  // date passes; a HW with no due date never grades on its own, so for
  // those this is the only path. Grading happens server-side after the
  // request returns, so we refetch rather than patching state
  // optimistically — the grades genuinely aren't ready yet, and showing
  // scores that don't exist would be worse than showing a spinner.
  const [gradingAll, setGradingAll] = useState(false);
  const [gradeAllError, setGradeAllError] = useState<string | null>(null);
  const onGradeAllClick = useCallback(async () => {
    setGradingAll(true);
    setGradeAllError(null);
    try {
      await teacher.gradePendingSubmissions(assignmentId, sectionId);
      // The server kicks a drain immediately, but grading a class is
      // several seconds of LLM calls — so this refetch is a first look,
      // not a guarantee everything has landed. Anything still in flight
      // shows as ungraded and the button stays available.
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setGradeAllError(
        e instanceof Error ? e.message : "Couldn't start grading",
      );
    } finally {
      setGradingAll(false);
    }
  }, [assignmentId, sectionId]);

  const onPublishClick = useCallback(() => {
    if (unreviewedToPublishTotal === 0 && flaggedToPublishTotal === 0) {
      void handlePublish(false).then((ok) => {
        if (!ok) setPublishConfirmOpen(true);
      });
    } else {
      setPublishConfirmOpen(true);
    }
  }, [unreviewedToPublishTotal, flaggedToPublishTotal, handlePublish]);

  // Explicit approval — the teacher's deliberate "I've vouched for this"
  // click on the Approve button (a grade save never stamps review).
  // Mirrors reviewed_at onto the roster row + open detail so the markers
  // flip without a refetch. Errors surface on the saveError channel
  // (scoped by id).
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
          message: e instanceof Error ? e.message : "Failed to approve",
        });
      } finally {
        setMarkingReviewedId(null);
      }
    },
    [],
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
    [],
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
                pendingTotal={pendingTotal}
                dirtyTotal={dirtyTotal}
                gradedTotal={gradedTotal}
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

      {roster !== null && (
        <ItemAnalysisPanel
          data={itemAnalysis}
          error={itemAnalysisError}
          open={itemAnalysisOpen}
          onToggle={setItemAnalysisOpen}
        />
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
            <div className="max-h-[78vh] overflow-y-auto">
              <TriageRoster
                roster={applyRosterFilter(roster, rosterFilter)}
                filter={rosterFilter}
                selectedStudentId={selectedStudentId}
                onSelect={setSelectedStudentId}
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
              <NotSubmittedCard entry={selectedEntry} />
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
                toReleaseTotal={toReleaseTotal}
                onPublish={onPublishClick}
                onGradeProblem={setProblemGrade}
                onFeedbackChange={setProblemFeedback}
                onIntegrityResolved={handleIntegrityResolved}
                onMarkReviewed={() =>
                  void handleMarkReviewed(selectedEntry.submission!.id)
                }
                onUnmarkReviewed={() =>
                  void handleUnmarkReviewed(selectedEntry.submission!.id)
                }
                marking={markingReviewedId === selectedEntry.submission.id}
                savingGrade={savingGradeIds.has(selectedEntry.submission.id)}
                regrading={regradingSubmissionId === selectedEntry.submission.id}
                regradeError={
                  regradeError?.forSubmissionId === selectedEntry.submission.id
                    ? regradeError.message
                    : null
                }
                onRegradeRequest={() =>
                  setRegradeConfirmOpenFor(selectedEntry.submission!.id)
                }
                confirmedIds={
                  confirmedBySubmission.get(selectedEntry.submission.id) ??
                  EMPTY_ID_SET
                }
                onConfirmProblems={handleConfirmProblems}
              />
            )}
          </section>

          {/* Pinned student-work rail — wide (xl) layout only. Reads the
              current detail's files; unpins below xl (the strip thumbnail
              in the grade column handles it there). */}
          <aside className="hidden xl:block">
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
          </aside>
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
        flaggedToPublish={flaggedToPublishTotal}
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
// "Grade all" (page header). Sits BEFORE Publish because it's the
// earlier step: you can't publish what hasn't been graded.
//
// Only renders when there is ungraded submitted work. That makes it
// self-explaining — its presence means "there's something to grade",
// and it disappears once the class is done rather than sitting there
// inert inviting a pointless click.
//
// The count is the point of the label. "Grade all" alone doesn't tell
// a teacher whether they're about to spend on 2 submissions or 30.
// ────────────────────────────────────────────────────────────────────

function GradeAllButton({
  ungradedCount,
  busy,
  onClick,
}: {
  ungradedCount: number;
  busy: boolean;
  onClick: () => void;
}) {
  if (ungradedCount === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-[--radius-pill] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-[color:var(--color-surface-alt-2)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <>
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
          />
          Grading…
        </>
      ) : (
        <>
          Grade {ungradedCount} ungraded
        </>
      )}
    </button>
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
  flaggedToPublish,
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
  /** How many of the to-release grades the teacher has explicitly
   *  approved vs left unapproved. Sum === total. Drives the unapproved
   *  warning + whether "Publish only approved" is offered. */
  reviewedToPublish: number;
  unreviewedToPublish: number;
  /** Submissions about to be published whose integrity check flagged
   *  them for review and the teacher hasn't resolved yet. Drives the
   *  soft confirm — a warning, never a block. */
  flaggedToPublish: number;
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
  // Offer the safer path only when there's a meaningful split — some
  // approved AND some not. If everything's approved there's nothing to
  // hold back; if nothing's approved, "only approved" would publish
  // zero, so we don't show it.
  const offerReviewedOnly = reviewedToPublish > 0 && unreviewedToPublish > 0;
  return (
    <Modal open={open} onClose={onClose} dismissible={!publishing} label="Confirm grade publishing">
      <h2 className="text-lg font-bold text-text-primary">
        {verb} {total} {total === 1 ? "grade" : "grades"}?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">{body}</p>
      {/* Unapproved warning — make it explicit that grades the teacher
       *  hasn't approved are about to go out, so publishing them is an
       *  informed choice, not a blind one. */}
      {unreviewedToPublish > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
          <span className="font-semibold">{unreviewedToPublish}</span>{" "}
          {unreviewedToPublish === 1
            ? "grade you haven’t approved"
            : "grades you haven’t approved"}{" "}
          will be published
          {reviewedToPublish > 0 ? (
            <> ({reviewedToPublish} already approved)</>
          ) : null}
          . Publish anyway?
        </p>
      )}
      {dirtyTotal > 0 && pendingTotal > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
          <span className="font-semibold">{dirtyTotal}</span>{" "}
          {dirtyTotal === 1 ? "is an edit" : "are edits"} to already-published grades.
        </p>
      )}
      {/* Soft integrity confirm — a flagged-for-review submission is
       *  about to go out unresolved. Warn, don't block: the teacher can
       *  still publish (legit reasons exist), but they make the call
       *  with eyes open instead of by accident. */}
      {flaggedToPublish > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-error)]/30 bg-[color:var(--color-error-light)] px-3 py-2 text-xs text-[color:var(--color-error)]">
          <span aria-hidden>⚑ </span>
          <span className="font-semibold">{flaggedToPublish}</span>{" "}
          {flaggedToPublish === 1
            ? "submission is flagged for review"
            : "submissions are flagged for review"}{" "}
          and not yet resolved. Publish anyway, or close this and review
          {flaggedToPublish === 1 ? " it" : " them"} first?
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
            Publish only approved ({reviewedToPublish})
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
    <Modal open={open} onClose={onClose} dismissible={!regrading} label="Regrade submission">
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

// Dispositions the "flagged" filter and resolve control treat as
// needing teacher attention. Only `flag_for_review` — the integrity-
// concern verdict. `tutor_pivot` is deliberately NOT here: it means the
// student got the problem WRONG on paper and the AI tutored them through
// it (integrity_ai.py — "wrong work is a learning signal, not a cheating
// signal"). It surfaces as an informational disposition pill + via
// practice insights, not as a teacher-review flag. This mirrors the
// backend needs-attention aggregate, which also excludes tutor_pivot
// (teacher_courses.py / teacher_assignments.py).
const FLAGGED_DISPOSITIONS = new Set(["flag_for_review"]);

function isFlagged(entry: RosterEntry): boolean {
  const sub = entry.submission;
  if (!sub) return false;
  // Student-raised "reader got something wrong" routes straight to
  // manual grading and is the strongest "needs your eyes" signal.
  if (sub.extraction_flagged_at) return true;
  const overview = sub.integrity_overview;
  if (!overview) return false;
  // A teacher who marked the check reviewed has handled it — drop it
  // from the flagged filter (matches the backend flagged aggregate).
  if (overview.resolution !== "unresolved") return false;
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

// Pure read-only predicate over already-loaded roster data: true when
// any problem on the submission carries an AI grade the model flagged
// as low confidence. `breakdown` preserves the AI's per-problem
// confidence (a teacher click never rewrites it — see setProblemGrade),
// so this needs no extra fetch. Historical rows without a confidence
// value contribute nothing, matching the always-on signal's neutral
// treatment of null.
/** Turned in, no grade yet, and a grade is genuinely still coming.
 *
 *  Deliberately NOT just `final_score === null`. An unreadable
 *  submission also has no score, but the confirm path records the skip
 *  and never enqueues it (`school_student_practice`), so no grade is on
 *  its way and no `grading_jobs` row exists. Counting it as awaiting
 *  made "Grade N ungraded" a permanent no-op — it moved zero jobs,
 *  refetched to the identical state, and never disappeared. Its own
 *  status pill already says "Couldn't read · grade manually"; the
 *  grouping has to agree with the pill. */
function isAwaitingGrade(entry: RosterEntry): boolean {
  const sub = entry.submission;
  if (!sub) return false;
  if (sub.final_score !== null) return false;
  return sub.ai_grading_status !== "skipped_unreadable";
}

function hasLowConfidence(entry: RosterEntry): boolean {
  const breakdown = entry.submission?.breakdown;
  if (!breakdown) return false;
  return breakdown.some(
    (b) => b.confidence !== null && b.confidence < CONFIDENCE_LOW,
  );
}

/** Her students, without her own rehearsal. See the two-populations
 *  note in HomeworkSectionReview: class counts use this, action counts
 *  use the full roster. */
function classOnly(entries: RosterEntry[]): RosterEntry[] {
  return entries.filter((e) => !e.submission?.is_preview);
}

function applyRosterFilter(
  roster: RosterEntry[],
  filter: RosterFilter,
): RosterEntry[] {
  if (filter === "all") return roster;
  // Same population the chips count — see RosterFilterBar.
  if (filter === "needs_me") return classOnly(roster).filter(needsTeacher);
  if (filter === "low_confidence")
    return classOnly(roster).filter(hasLowConfidence);
  return classOnly(roster).filter(isFlagged);
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
  // Chips are class triage, so they count her students — and the list
  // they filter to must be the same population, or a chip reading 1
  // opens a list of 2.
  const forCounting = classOnly(roster);
  const flaggedCount = forCounting.filter(isFlagged).length;
  const needsMeCount = forCounting.filter(needsTeacher).length;
  const lowConfidenceCount = forCounting.filter(hasLowConfidence).length;

  // Auto-revert to "all" when the active filter's count drops to 0 —
  // otherwise a teacher who clears the last flagged submission gets
  // stranded on a disabled-yet-active chip with an empty roster and
  // no obvious recovery. Live grading frequently transitions a row
  // out of `needs_me` (publish a grade), so this guard fires often.
  // Low-confidence count is fixed by the AI's read and never moves on a
  // teacher action, but we guard it the same way for consistency.
  useEffect(() => {
    if (value === "needs_me" && needsMeCount === 0) onChange("all");
    if (value === "flagged" && flaggedCount === 0) onChange("all");
    if (value === "low_confidence" && lowConfidenceCount === 0) onChange("all");
  }, [value, needsMeCount, flaggedCount, lowConfidenceCount, onChange]);

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
      <RosterChip
        label="Low confidence"
        count={lowConfidenceCount}
        active={value === "low_confidence"}
        disabled={lowConfidenceCount === 0}
        onClick={() => onChange("low_confidence")}
        title="Problems the AI graded with low confidence (under 60%) — review the uncertain calls first"
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
  title,
}: {
  label: string;
  count?: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
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
// Loading skeletons — mirror the settled layout so the page redraws in
// place instead of blanking to bare text. The detail skeleton matters
// most: it fires on every student switch, the most frequent transition
// on this surface. Built from the shared `Skeleton` (a low-amplitude
// animate-pulse), matching the ItemAnalysisPanel pattern already on this
// page.
// ────────────────────────────────────────────────────────────────────

function RosterRowSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-light px-4 py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-7" />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-1.5 w-1.5 rounded-full" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Loading student work…</span>
      <div className="space-y-3 rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="space-y-3 rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm"
        >
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewLoadingSkeleton() {
  return (
    <div
      className="mt-5 grid gap-5 md:grid-cols-[280px_1fr]"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading roster…</span>
      <aside className="self-start rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
        <div className="border-b border-border-light px-4 py-2.5">
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <RosterRowSkeleton key={i} />
          ))}
        </div>
      </aside>
      <section className="min-w-0">
        <DetailSkeleton />
      </section>
    </div>
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
// Triage roster — groups the (already-filtered) roster into "Needs your
// eyes" (integrity-flagged OR low-confidence) above "AI confident", with
// non-submitters last. Within "Needs your eyes" the order is uncertainty-
// first: flagged before low-confidence, then lowest score first, so the
// calls most worth the teacher's attention float to the very top.
// ────────────────────────────────────────────────────────────────────

function TriageRoster({
  roster,
  filter,
  selectedStudentId,
  onSelect,
}: {
  roster: RosterEntry[];
  filter: RosterFilter;
  selectedStudentId: string | null;
  onSelect: (id: string) => void;
}) {
  const needsEyes: RosterEntry[] = [];
  const awaitingGrade: RosterEntry[] = [];
  const confident: RosterEntry[] = [];
  const notSubmitted: RosterEntry[] = [];
  // Her rehearsal is a row, not a member of any triage group. The group
  // headers count her class — a "Needs your eyes · 1" over her own test
  // run contradicts the subhead and the chips, which both read
  // classOnly. Rendered after the groups instead, where the badge is
  // the whole story.
  let rehearsal: RosterEntry | null = null;
  for (const e of roster) {
    if (e.submission?.is_preview) {
      rehearsal = e;
      continue;
    }
    if (!e.submission) notSubmitted.push(e);
    else if (isFlagged(e) || hasLowConfidence(e)) needsEyes.push(e);
    // Ungraded gets its own group. It used to fall into "AI confident"
    // — technically true (nothing was flagged) and substantively a lie,
    // because the AI hadn't looked at the work at all. That was almost
    // invisible while grading ran seconds after a student confirmed;
    // now that grading waits for the due date it would be the normal
    // state of a class all week. Never file work the AI hasn't seen
    // under a claim about the AI's confidence.
    else if (isAwaitingGrade(e)) awaitingGrade.push(e);
    else confident.push(e);
  }
  // Uncertainty-first: flagged (0) before low-confidence (1), then by
  // ascending score (a null score — ungraded — sorts to the very top).
  const prio = (e: RosterEntry) => (isFlagged(e) ? 0 : 1);
  needsEyes.sort((a, b) => {
    const p = prio(a) - prio(b);
    if (p !== 0) return p;
    const sa = a.submission?.final_score ?? -1;
    const sb = b.submission?.final_score ?? -1;
    return sa - sb;
  });

  if (roster.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-text-muted">
        {filter === "needs_me"
          ? "Nothing waiting on you here."
          : filter === "flagged"
            ? "No flagged submissions in this section."
            : filter === "low_confidence"
              ? "The AI was confident on every graded problem here."
              : "No students match this filter."}
      </p>
    );
  }

  const renderRows = (entries: RosterEntry[]) =>
    entries.map((e) => (
      <StudentRow
        key={e.student_id}
        entry={e}
        selected={e.student_id === selectedStudentId}
        onSelect={() => onSelect(e.student_id)}
      />
    ));

  return (
    <>
      {needsEyes.length > 0 && (
        <RosterGroupHeader
          label="Needs your eyes"
          count={needsEyes.length}
          tone="eyes"
        />
      )}
      {renderRows(needsEyes)}
      {awaitingGrade.length > 0 && (
        // Above "AI confident": work with no verdict yet is more
        // actionable than work the AI has already cleared.
        <RosterGroupHeader
          label="Awaiting grade"
          count={awaitingGrade.length}
          tone="calm"
        />
      )}
      {renderRows(awaitingGrade)}
      {confident.length > 0 && (
        <RosterGroupHeader
          label="AI confident"
          count={confident.length}
          tone="calm"
        />
      )}
      {renderRows(confident)}
      {notSubmitted.length > 0 && (
        <RosterGroupHeader
          label="Not submitted"
          count={notSubmitted.length}
          tone="calm"
        />
      )}
      {renderRows(notSubmitted)}
      {rehearsal && (
        <>
          <RosterGroupHeader label="Your test run" count={1} tone="calm" />
          {renderRows([rehearsal])}
        </>
      )}
    </>
  );
}

function RosterGroupHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "eyes" | "calm";
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-4 pb-1.5 pt-2.5">
      {tone === "eyes" && (
        <span aria-hidden className="text-[color:var(--color-warning-dark)]">
          ⚠
        </span>
      )}
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
          tone === "eyes"
            ? "text-[color:var(--color-warning-dark)]"
            : "text-text-muted"
        }`}
      >
        {label}
      </span>
      <span className="ml-auto text-[10px] font-bold text-text-muted tabular-nums">
        {count}
      </span>
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
          {/* Her own rehearsal sits at the end of the roster. Badged so
              a row that isn't a student can't be mistaken for one. */}
          {sub?.is_preview && (
            <span className="ml-1.5 rounded-full bg-[color:var(--color-info-light)] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-info)]">
              Preview
            </span>
          )}
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
      {/* Approval marker — separates a grade the teacher has explicitly
       * approved from one that's graded but not yet approved. Its own
       * line so it reads as a distinct dimension from the publish-state
       * status above. */}
      {review && (
        <div
          className={`flex min-w-0 items-center gap-1 text-[10px] font-semibold ${
            review.tone === "reviewed"
              ? "text-[color:var(--color-success)]"
              : "text-text-muted"
          }`}
        >
          <span aria-hidden>{review.tone === "reviewed" ? "✓" : "○"}</span>
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
  // Student said "the reader got my work wrong" on the confirm screen —
  // the submission skipped AI grading + integrity entirely and needs a
  // manual pass. Surface it loudly (red) until the teacher publishes a
  // clean grade, at which point the published branch below takes over.
  if (
    sub.extraction_flagged_at &&
    !(sub.grade_published_at && !sub.grade_dirty)
  ) {
    return {
      text: "Reader misread · review",
      dotClass: "bg-[color:var(--color-error)]",
    };
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

// Per-student approval marker for the roster: distinguishes a grade the
// teacher has explicitly approved from one that's graded but not yet
// approved, so the teacher sees review progress at a glance. Returns null
// when there's nothing to approve yet (no grade — ungraded /
// skipped-unreadable, where the status label already tells the story).
function reviewMarker(
  sub: TeacherSubmissionRow,
): { text: string; tone: "reviewed" | "unreviewed" } | null {
  if (sub.final_score === null) return null;
  if (sub.reviewed_at) return { text: "Approved", tone: "reviewed" };
  return { text: "Not reviewed", tone: "unreviewed" };
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
  toReleaseTotal,
  onPublish,
  onGradeProblem,
  onFeedbackChange,
  onIntegrityResolved,
  onMarkReviewed,
  onUnmarkReviewed,
  marking,
  savingGrade,
  regrading,
  regradeError,
  onRegradeRequest,
  confirmedIds,
  onConfirmProblems,
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
  // Grades still awaiting release across the whole HW (pending + dirty).
  // Drives the end-of-stack publish CTA below.
  toReleaseTotal: number;
  onPublish: () => void;
  onGradeProblem: (problemId: string, status: GradeStatus, partialPercent?: number) => void;
  onFeedbackChange: (problemId: string, text: string) => void;
  onIntegrityResolved: (
    submissionId: string,
    resolution: IntegrityResolutionOutcome,
  ) => void;
  onMarkReviewed: () => void;
  onUnmarkReviewed: () => void;
  marking: boolean;
  savingGrade: boolean;
  regrading: boolean;
  regradeError: string | null;
  onRegradeRequest: () => void;
  /** Bank-item ids the teacher has ticked on THIS submission. Owned by
   *  the page so it survives this panel being remounted on a switch. */
  confirmedIds: ReadonlySet<string>;
  onConfirmProblems: (submissionId: string, bankItemIds: string[]) => void;
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

  // ── Triage: collapse the confident grades, keep the uncertain open ──
  //
  // Per-problem metadata that drives the collapsed/expanded split. A
  // problem the AI is confident about (high band, not overridden)
  // COLLAPSES to a one-line confirm row; uncertain ones stay fully
  // expanded with the answer/key, work, receipt, and grade buttons.
  // Nothing is auto-confirmed — `confirmedIds` is a checklist the teacher
  // fills by pressing the AI's key (or the Confirm chip). It's a
  // grading-workflow aid (collapse/expand the confident rows), NOT the
  // review stamp: the durable, server-side trust signal is `reviewed_at`,
  // which is set only by the explicit Approve button.
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
  const [expandState, setExpandState] = useState<{ sid: string; ids: Set<string> }>(
    () => ({ sid: detail.submission_id, ids: new Set() }),
  );
  const manuallyExpandedIds =
    expandState.sid === detail.submission_id ? expandState.ids : EMPTY_ID_SET;

  const problemMeta = useMemo(
    () =>
      detail.problems.map((p) => {
        const ai = aiByPosition.get(p.position) ?? null;
        const entry = breakdownByProblem.get(p.bank_item_id) ?? null;
        const overridden = teacherOverrodeAi(entry, ai);
        // Confident = high-band AI grade that the teacher hasn't moved.
        const confident = isConfidentAi(ai) && !overridden && entry !== null;
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
    null,
  );
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
      moveFocus(nextUngradedAfter(focusedIndex));
    },
    [
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
    moveFocus(nextUngradedAfter(focusedIndex));
  }, [detail.problems, focusedIndex, confirmProblems, moveFocus, nextUngradedAfter]);

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
          {/* Hidden on the wide (xl) layout, where the pinned work rail
              keeps the photo glanceable; shown below xl where the rail
              unpins. */}
          {detail.files && detail.files.length > 0 && (
            <span className="xl:hidden">
              <StudentWorkThumbButton
                files={detail.files}
                studentName={detail.student_name}
              />
            </span>
          )}
          {/* Review state + explicit approval. Approval is a deliberate
              act — the Approve button stamps reviewed_at, enabled only
              once every problem carries a grade (you can't vouch for a
              half-graded submission). Not reviewed → Approved ✓, with an
              Undo path to walk an approval back. Nothing auto-approves. */}
          {!detail.reviewed_at && totalProblems > 0 && (
            <>
              <span
                className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-border-light bg-[color:var(--color-surface-alt-2)] px-2.5 py-1 text-[11px] font-bold text-text-muted tabular-nums"
                title={
                  allGraded
                    ? "Every problem is graded — approve when you're ready"
                    : "Grade every problem before you can approve this submission"
                }
              >
                {allGraded
                  ? "Not reviewed"
                  : `Not reviewed · ${gradedProblemCount}/${totalProblems} graded`}
              </span>
              <button
                type="button"
                onClick={onMarkReviewed}
                disabled={marking || savingGrade || regrading || !allGraded}
                title={
                  regrading
                    ? "Regrading — approve once the new grade lands"
                    : savingGrade
                      ? "Saving your grade edit — approve once it finishes"
                      : allGraded
                        ? "Approve — mark this submission reviewed"
                        : `Grade every problem first (${gradedProblemCount} of ${totalProblems} graded)`
                }
                className="rounded-[--radius-md] border border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10 px-3.5 py-1.5 text-xs font-bold text-[color:var(--color-success)] transition-colors hover:border-[color:var(--color-success)]/60 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {marking ? "Approving…" : "Approve ✓"}
              </button>
            </>
          )}
          {detail.reviewed_at && (
            <>
              <span className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-2.5 py-1 text-[11px] font-bold text-[color:var(--color-success)]">
                <span aria-hidden>✓</span>
                Approved
              </span>
              <button
                type="button"
                onClick={onUnmarkReviewed}
                disabled={marking || savingGrade || regrading}
                title={
                  regrading
                    ? "Regrading — the approval will clear when the new grade lands"
                    : savingGrade
                      ? "Saving your grade edit — the approval will clear when it finishes"
                      : "Undo approval — return this submission to not reviewed"
                }
                className="rounded-[--radius-md] border border-border-light bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {marking ? "Undoing…" : "Undo"}
              </button>
            </>
          )}
          {/* Advance-or-publish. While there's a next unreleased submitter,
              this is the rapid "Next student →" advance. On the LAST one —
              nextStudent null but grades still unreleased HW-wide — the dead
              "No more students" button was the exact moment the teacher wants
              to Publish, so we surface an affirmative publish CTA in the same
              slot (reuses the header's publish gate: straight-through when
              everything's approved + unflagged, else opens the confirm).
              When nothing's left to release, a quiet "all caught up" state —
              but only claim that when THIS submission is itself released; if
              it's the last one and still unpublished-because-ungraded (e.g. a
              skipped-unreadable that needs hand-grading), a neutral terminal
              label avoids contradicting the "grade this by hand" callout. */}
          {nextStudent ? (
            <button
              type="button"
              onClick={onSelectNext}
              className="rounded-[--radius-md] border border-primary/30 bg-primary-bg px-3.5 py-1.5 text-xs font-bold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
            >
              Next student →
            </button>
          ) : toReleaseTotal > 0 ? (
            <button
              type="button"
              onClick={onPublish}
              title={`You're on the last student — publish ${toReleaseTotal} ${toReleaseTotal === 1 ? "grade" : "grades"}`}
              className="inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
            >
              <span aria-hidden>✓</span>
              Last one — publish {toReleaseTotal}{" "}
              {toReleaseTotal === 1 ? "grade" : "grades"} →
            </button>
          ) : published ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-3.5 py-1.5 text-xs font-bold text-[color:var(--color-success)]"
              title="Every submission reviewed and published"
            >
              <span aria-hidden>✓</span>
              All caught up
            </span>
          ) : (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3.5 py-1.5 text-xs font-bold text-text-muted"
              title="No other students to review — grade this one to finish"
            >
              No more students
            </span>
          )}
        </div>
      </div>

      {/* Reader-misread callout — the student declined the OCR reading
          ("the reader got my work wrong") on the confirm screen, so the
          submission skipped AI grading + integrity entirely. There's no
          integrity check to render below, which is exactly why this
          needs its own loud signal: without it the row would look like
          an ordinary ungraded submission and the dodge (or the genuine
          misread) would slip by. Honor-code by design — no interview is
          forced — so the teacher is the backstop. */}
      {row?.extraction_flagged_at && (
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
                They declined the scanned reading on the confirm screen,
                so no AI grading or understanding check ran. If the photo
                really was misread, grade from the original work; if it
                looks like a dodge, follow up with the student.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Integrity verdict — the #1 trust signal. First full content
          block so the teacher sees the verdict before they start
          grading. Hides when HW had integrity disabled / no check. */}
      <IntegrityBanner
        integrity={integrity}
        overviewFallback={row?.integrity_overview ?? null}
        onResolved={onIntegrityResolved}
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
              {/* Names only what the teacher can actually do from here.
                  The previous copy offered "ask them to resubmit a clearer
                  photo", which the product cannot do: submission is
                  one-shot (a second attempt gets 409 Already submitted)
                  and no endpoint reopens one. It also has to say what
                  "by hand" means, because there is no button for it —
                  `record_unreadable_grading_skip` leaves breakdown and
                  final_score null precisely so the grading controls
                  below this callout work normally, just with nothing
                  pre-filled. */}
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--color-warning-dark)]/80">
                The work was too unclear to read, so nothing was
                auto-graded. Open the pages and grade it by hand — the
                grading controls work the same, there&rsquo;s just no AI
                suggestion to start from.
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Problems · {totalProblems}
          </p>
          {/* Quiet, discoverable entry point to the keyboard cheatsheet.
              Mirrors the integrity "Guide" affordance so the page has one
              consistent "press for help" vocabulary. */}
          <button
            type="button"
            onClick={() => setCheatsheetOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-[--radius-sm] px-1.5 py-0.5 text-[10px] font-semibold text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Show keyboard shortcuts"
            aria-haspopup="dialog"
          >
            Press{" "}
            <kbd className="rounded border border-border-light bg-[color:var(--color-surface-alt-2)] px-1 font-sans text-[10px] font-bold text-text-secondary">
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
                onClick={() => confirmProblems(pendingConfirmIds)}
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
                aiGrade={aiByPosition.get(p.position) ?? null}
                focused={i === focusedIndex}
                collapsed={meta?.collapsed ?? false}
                confirmed={meta?.confirmed ?? false}
                confirmKey={meta?.confirmKey ?? null}
                onConfirm={() => confirmProblems([p.bank_item_id])}
                onToggleExpand={() => toggleExpand(p.bank_item_id)}
                rowRef={(el) => {
                  rowRefs.current[i] = el;
                }}
                onChange={(status, partialPercent) =>
                  onGradeProblem(p.bank_item_id, status, partialPercent)
                }
                onFeedbackChange={(text) =>
                  onFeedbackChange(p.bank_item_id, text)
                }
                onOpenPage={() =>
                  setGalleryPage(p.pages.length > 0 ? p.pages[0]! - 1 : 0)
                }
              />
            );
          })}
        </div>

        {detail.other_work.length > 0 && (
          <OtherWorkDisclosure steps={detail.other_work} />
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

// Anchor highlight for a student-work step that a receipt deduction
// points at — a color-matched tint + numbered badge so the eye links the
// "−20% sign error" ledger line to the exact step it happened on. Two
// tones (amber / info) cycle across a problem's deductions so multiple
// anchors stay visually distinct, matching the receipt's badge colors.
type StepAnchor = { tone: "amber" | "info" };
const ANCHOR_TONES = ["amber", "info"] as const;
const ANCHOR_STYLE: Record<
  "amber" | "info",
  { wrap: string; badge: string; idRef: (id: string) => string }
> = {
  amber: {
    wrap: "border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-bg)]/60",
    // White on `--color-warning` is 4.43:1; the -dark token is 6.08:1.
    badge: "bg-[color:var(--color-warning-dark)] text-white",
    idRef: (id) => `${id}-amber`,
  },
  info: {
    wrap: "border-[color:var(--color-info)]/45 bg-[color:var(--color-info-light)]/60",
    badge: "bg-[color:var(--color-info)] text-white",
    idRef: (id) => `${id}-info`,
  },
};

function StudentStepRow({
  step,
  index,
  anchor,
  anchorId,
}: {
  step: TeacherSubmissionStep;
  index: number;
  /** Set when a receipt deduction anchors to this step (1-based
   *  step_ref === index + 1). Tints the row + shows the badge. */
  anchor?: StepAnchor;
  /** DOM id for the receipt's "↳ step N" link to scroll to. */
  anchorId?: string;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const originalLatex = step.original_latex ?? "";
  const originalPlain = step.original_plain_english ?? "";
  const hasOriginal =
    !!step.edited && (originalLatex.length > 0 || originalPlain.length > 0);
  const a = anchor ? ANCHOR_STYLE[anchor.tone] : null;
  return (
    <div
      id={anchorId}
      className={`flex gap-2 scroll-mt-4 ${
        a ? `-mx-1.5 rounded-[--radius-sm] border px-1.5 py-1 ${a.wrap}` : ""
      }`}
    >
      {a ? (
        <span
          aria-hidden
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-extrabold tabular-nums ${a.badge}`}
        >
          {index + 1}
        </span>
      ) : (
        <span
          aria-hidden
          className="shrink-0 pt-0.5 text-xs font-semibold text-text-muted tabular-nums"
        >
          {index + 1}.
        </span>
      )}
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

/**
 * Work the extractor couldn't tie to any problem on this assignment.
 *
 * This exists because the grader already sees it. `_build_user_message`
 * hands the model these exact lines under "Other work" and tells it to
 * use them as context, so without this block a teacher could read a
 * verdict shaped by evidence that wasn't on their screen. It is also how
 * a stale `problem_position` becomes visible instead of silent: after an
 * unpublish -> edit problems -> republish cycle shifts positions, real
 * work slides in here rather than vanishing.
 *
 * Collapsed by default: a clean submission has none of this, and the
 * ones that do shouldn't push the grade controls down the page.
 */
function OtherWorkDisclosure({ steps }: { steps: TeacherSubmissionStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-[--radius-md] border border-dashed border-border bg-[color:var(--color-surface-alt-2)]/50 px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        Other work
        <span className="font-normal normal-case tracking-normal text-text-muted">
          · {steps.length} {steps.length === 1 ? "line" : "lines"}
        </span>
      </button>
      {open && (
        <>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
            Couldn&rsquo;t be tied to one problem — scratch work, setup, or
            work that spans problems. The AI saw these as context when it
            graded; they don&rsquo;t carry a grade of their own.
          </p>
          <div className="mt-2 space-y-2 text-sm text-text-primary">
            {steps.map((step, i) => (
              <StudentStepRow key={i} step={step} index={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The page marker's label. "p. 3" for one page, "p. 3-5" for work that
// runs across a break, and an explicit list when the set has gaps —
// a student who flipped back leaves pages 1 and 4, and rendering that as
// "p. 1-4" would claim work on 2 and 3 that isn't there.
// Null when the extraction didn't tag a page, so the row shows no marker
// rather than a guess: a wrong page number costs the teacher more than
// no page number does.
function pageLabelFor(pages: number[]): string | null {
  if (pages.length === 0) return null;
  const first = pages[0]!;
  const last = pages[pages.length - 1]!;
  if (first === last) return `p. ${first}`;
  const contiguous = last - first + 1 === pages.length;
  return contiguous ? `p. ${first}-${last}` : `p. ${pages.join(", ")}`;
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
  focused,
  collapsed,
  confirmed,
  confirmKey,
  onConfirm,
  onToggleExpand,
  rowRef,
  onChange,
  onFeedbackChange,
  onOpenPage,
}: {
  problem: TeacherSubmissionDetailProblem;
  entry: GradeBreakdownEntry | null;
  aiGrade: AiGradeEntry | null;
  /** This row is the keyboard-focused problem — draws the left accent
   *  bar + ring and receives real DOM focus via `rowRef`. */
  focused: boolean;
  /** The AI was confident — render the one-line confirm summary instead
   *  of the full grading body. The teacher can expand to inspect. */
  collapsed: boolean;
  /** The teacher has confirmed the AI's grade on this row (local
   *  checklist — the server trust signal is the submission's
   *  reviewed_at, stamped by onConfirm). */
  confirmed: boolean;
  /** The grading key that re-affirms the AI suggestion (shown on the
   *  Confirm chip). Null when there's no AI grade. */
  confirmKey: "1" | "2" | "3" | "4" | "5" | null;
  onConfirm: () => void;
  onToggleExpand: () => void;
  /** Registers the row's root element with the parent so keyboard nav
   *  can move actual focus (the model is focus-real, not aria-only). */
  rowRef: (el: HTMLDivElement | null) => void;
  onChange: (status: GradeStatus, partialPercent?: number) => void;
  onFeedbackChange: (text: string) => void;
  /** Opens the work gallery on this problem's first tagged page. */
  onOpenPage: () => void;
}) {
  const pageLabel = pageLabelFor(problem.pages);
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
    // A bare focus→blur (the teacher clicked in and out without typing)
    // leaves `feedbackBuffer` null — committing then would persist the
    // displayed default as a phantom "edit" and, on an approved row,
    // silently revoke the approval server-side. So only commit a value
    // the teacher actually typed, and only when it differs from the
    // effective current value shown in the field (the stored feedback,
    // or "" when none is stored). Re-committing the unchanged value is a
    // no-op — no PATCH, no revoke. Genuine edits (buffer differs from the
    // effective value) still persist and revoke.
    if (feedbackBuffer === null) return;
    const committed = feedbackBuffer;
    setFeedbackBuffer(null);
    if (committed === externalFeedback) return;
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

  // Receipt deductions that anchor to a specific student-work step. Each
  // gets a tone (amber/info, cycling) shared by the ledger line and the
  // tinted step in the work list, so the eye links "−20% sign error" to
  // the exact step it happened on. `anchorBaseId` namespaces the step
  // DOM ids the receipt's "↳ step N" links scroll to.
  const deductions = entry?.deductions ?? null;
  const anchorBaseId = `work-${problem.bank_item_id}`;
  const stepAnchors = new Map<number, StepAnchor>();
  (deductions ?? [])
    .filter(
      (d) =>
        d.points_off > 0 &&
        d.step_ref != null &&
        d.step_ref >= 1 &&
        d.step_ref <= stepCount,
    )
    .forEach((d, i) => {
      if (d.step_ref != null && !stepAnchors.has(d.step_ref)) {
        stepAnchors.set(d.step_ref, {
          tone: ANCHOR_TONES[i % ANCHOR_TONES.length],
        });
      }
    });
  const scrollToStep = (stepRef: number) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`${anchorBaseId}-step-${stepRef}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  };

  // ── Collapsed confident row ───────────────────────────────────────
  // A one-line summary the teacher confirms with a single key/click.
  // Same rowRef + focus model as the expanded row so keyboard nav, the
  // focus ring, and screen-reader tracking are identical.
  if (collapsed && aiGrade) {
    const verdict =
      aiGrade.score_status === "full"
        // Was a hard-coded #22a06b that sat outside the palette and put
        // white on it at 3.3:1 — under AA for a 10px bold label.
        ? { cls: "bg-[color:var(--color-success)] text-white", label: "Full" }
        : aiGrade.score_status === "zero"
          ? {
              cls: "border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] text-[color:var(--color-error)]",
              label: "No credit",
            }
          : {
              // `-dark` for the same reason as the Partial grade button:
              // white on `--color-warning` is 4.43:1, just under AA, and
              // this label is 10px bold — nowhere near large text.
              cls: "bg-[color:var(--color-warning-dark)] text-white",
              label: `Partial ${Math.round(aiGrade.percent)}%`,
            };
    return (
      <div
        ref={rowRef}
        tabIndex={-1}
        aria-current={focused ? "true" : undefined}
        className={`flex items-center gap-3 rounded-[--radius-md] border px-3.5 py-2.5 outline-none transition-[box-shadow,border-color] ${
          focused
            ? "border-primary/40 shadow-[inset_3px_0_0_0_var(--color-primary)] ring-1 ring-primary/20"
            : confirmed
              ? "border-[color:var(--color-success-border)] bg-[color:var(--color-success)]/[0.06]"
              : "border-border-light bg-surface/40 hover:bg-[color:var(--color-surface-alt-2)]"
        }`}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-[--radius-sm]"
          // Spell the comparison out for screen readers rather than
          // leaving them the bare position. Delimiters stripped: these
          // values are LaTeX source, not plain text — the API wraps the
          // extractor's read as `$…$` precisely so it renders as math.
          aria-label={
            problem.student_answer
              ? `Expand problem ${problem.position} to inspect. Student answered ${mathPlainText(problem.student_answer)}; answer key is ${problem.final_answer ? mathPlainText(problem.final_answer) : "not set"}.`
              : `Expand problem ${problem.position} to inspect. No answer extracted. Answer key is ${problem.final_answer ? mathPlainText(problem.final_answer) : "not set"}.`
          }
          aria-expanded={false}
        >
          <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-text-muted">
            {problem.position}
          </span>
          {/* The comparison the one-second confirm actually rests on.
              This row used to show a truncated copy of the QUESTION —
              which the teacher wrote, and which tells them nothing about
              whether the AI's call is right. What decides it is the
              student's answer against the key, so that is what the row
              carries. The question is one click away on expand. */}
          {/* Two overrides, both load-bearing, both about keeping this a
              scannable column of equal-height one-liners:
                - `[&_span]:!whitespace-nowrap` — MathText sets
                  `white-space: pre-wrap` as an INLINE style on its text
                  segments, and an inline style beats `truncate`'s class.
                - `[&_div]:!my-0 [&_div]:!inline` — an answer in display
                  math ($$…$$, or a bare \begin{…} environment, which is
                  exactly the shape the AI grader returns for a matrix)
                  makes MathText emit a BLOCK div with vertical margins,
                  dropped into a truncating flex item. That grows the row
                  well past one line. Inlining keeps the row honest, and
                  `max-h` hard-caps anything still too tall. */}
          <span className="flex max-h-6 min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden text-[13px] [&_div]:!my-0 [&_div]:!inline [&_span]:!whitespace-nowrap">
            {problem.student_answer ? (
              <span
                className="min-w-0 max-w-[50%] truncate font-semibold text-text-primary"
                title={mathPlainText(problem.student_answer)}
              >
                <MathText text={problem.student_answer} />
              </span>
            ) : (
              <span className="shrink-0 text-xs font-semibold text-[color:var(--color-warning-dark)]">
                <span aria-hidden>⚠</span> No answer extracted
              </span>
            )}
            <span aria-hidden className="shrink-0 text-[11px] text-text-muted">
              →
            </span>
            {/* Long values truncate rather than wrap. `title` keeps the
                full text reachable on hover without expanding the row,
                and the button's aria-label carries both in full for
                screen readers. */}
            <span
              className="min-w-0 flex-1 truncate text-text-secondary"
              title={problem.final_answer ? mathPlainText(problem.final_answer) : undefined}
            >
              {problem.final_answer ? (
                <MathText text={problem.final_answer} />
              ) : (
                <span className="italic text-text-muted">no key</span>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold tracking-[0.04em] text-text-muted">
            <span aria-hidden>🤖</span>
            <span
              className={`rounded-[--radius-pill] px-1.5 py-0.5 text-[10px] font-extrabold ${verdict.cls}`}
            >
              {verdict.label}
            </span>
            {/* Reuse ConfidenceSignal instead of a bare dot + percent.
                "96%" sitting next to a "Full" badge reads as a score;
                "AI · High 96%" reads as certainty, which is what it is. */}
            <ConfidenceSignal confidence={aiGrade.confidence} />
          </span>
        </button>
        {confirmed ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[--radius-md] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-2.5 py-1.5 text-[11px] font-bold text-[color:var(--color-success)]">
            <span aria-hidden>✓</span> Confirmed
          </span>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[--radius-md] border border-primary/35 bg-primary-bg px-2.5 py-1.5 text-[11px] font-bold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
          >
            Confirm
            {confirmKey && (
              <kbd className="rounded-[--radius-sm] border border-border-light bg-surface px-1 font-sans text-[10px] font-bold text-text-secondary shadow-sm">
                {confirmKey}
              </kbd>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      // Inert focus target: a tabIndex=-1 div the parent .focus()es so
      // keyboard grading has a real focus anchor. aria-current marks it
      // as the active row for assistive tech.
      aria-current={focused ? "true" : undefined}
      className={`rounded-[--radius-md] border bg-surface/40 p-4 outline-none transition-[box-shadow,border-color] ${
        focused
          ? // Editorial focus affordance: a quiet left accent bar (inset
            // shadow so it hugs the rounded corner) plus a faint ring —
            // present, not loud.
            "border-primary/40 shadow-[inset_3px_0_0_0_var(--color-primary)] ring-1 ring-primary/20"
          : "border-border-light"
      }`}
    >
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
        {/* After the question in the DOM, not before it: tab order and
            screen-reader order follow the DOM, and a teacher shouldn't
            reach "open page 3" before reading the problem it belongs to.
            Visually it still sits at the right end of the header row. */}
        {pageLabel && (
          <button
            type="button"
            onClick={onOpenPage}
            className="shrink-0 rounded-[--radius-sm] border border-border-light bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={`Open page ${problem.pages[0]} of the student's work`}
          >
            {pageLabel} <span aria-hidden>↗</span>
          </button>
        )}
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
            // Never clamp when a deduction anchors to a step — the
            // highlighted step must be visible (and scroll-targetable) for
            // the receipt's "↳ step N" link to land on it.
            className={`mt-2 space-y-2 text-sm text-text-primary ${
              stepsExpanded || stepAnchors.size > 0 ? "" : "max-h-40 overflow-hidden"
            }`}
            style={
              stepsOverflow && !stepsExpanded && stepAnchors.size === 0
                ? {
                    maskImage:
                      "linear-gradient(to bottom, black 75%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black 75%, transparent 100%)",
                  }
                : undefined
            }
          >
            {problem.student_steps.map((step, i) => {
              const anchor = stepAnchors.get(i + 1);
              return (
                <StudentStepRow
                  key={i}
                  step={step}
                  index={i}
                  anchor={anchor}
                  anchorId={
                    anchor ? `${anchorBaseId}-step-${i + 1}` : undefined
                  }
                />
              );
            })}
          </div>
          {stepsOverflow && stepAnchors.size === 0 && (
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
          block simply doesn't render. Every AI grade now carries an
          always-on confidence band (high/medium/low) so a 0.62 and a
          0.98 no longer read identically — low (<0.6) keeps its amber
          alarm emphasis, while high/medium stay quiet so the eye is
          only pulled to uncertain calls. Historical rows without a
          confidence value stay neutral. */}
      {aiGrade && aiGradeLabel && (
        <div className="mt-3 rounded-[--radius-md] border border-primary/25 bg-primary-bg px-3 py-2">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-bold text-text-primary">
            <span className="text-primary" aria-hidden>🤖</span>
            <span className="text-primary">Suggestion:</span>
            <span>{aiGradeLabel}</span>
            <ConfidenceSignal confidence={aiGrade.confidence} />
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

      {/* Itemized receipt — the AI's per-problem ledger. Renders only
          when the AI supplied a `deductions` breakdown (additive: rows
          without it keep showing just the reasoning hero above). Anchors
          each deduction to the matching student-work step. */}
      {deductions !== null && (
        <GradeReceipt
          deductions={deductions}
          status={current ?? "partial"}
          percent={entry?.percent ?? 0}
          aiConfidence={aiGrade?.confidence ?? null}
          stepCount={stepCount}
          onAnchorClick={scrollToStep}
        />
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

// ────────────────────────────────────────────────────────────────────
// Itemized grade receipt — renders the AI's per-problem `deductions`
// ledger as a "why this score" breakdown: credit lines (things done
// right, ✓) and debit lines (−X% with the reason), summing to
// SCORE = 100 − Σ points_off = percent. Each debit that anchors to a
// student-work step gets a color-matched [N] badge + "↳ step N" link
// that highlights + scrolls to that step in the work list above. Full
// credit (no debits) collapses to "✓ Full credit"; an itemized zero to
// "✗ No credit · <reason>".
// ────────────────────────────────────────────────────────────────────

function GradeReceipt({
  deductions,
  status,
  percent,
  aiConfidence,
  stepCount,
  onAnchorClick,
}: {
  deductions: GradeDeduction[];
  status: GradeStatus;
  percent: number;
  aiConfidence: number | null;
  stepCount: number;
  onAnchorClick: (stepRef: number) => void;
}) {
  const credits = deductions.filter((d) => d.points_off <= 0);
  const debits = deductions.filter((d) => d.points_off > 0);
  const score = Math.round(percent);
  const confPct = aiConfidence != null ? Math.round(aiConfidence * 100) : null;
  const confLow = aiConfidence != null && aiConfidence < CONFIDENCE_LOW;

  // Short-forms when there's nothing itemized to subtract.
  if (debits.length === 0) {
    if (status === "full") {
      return (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[--radius-md] border border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)]/60 px-3 py-2 text-xs font-bold text-[color:var(--color-success)]">
          <span aria-hidden>✓</span> Full credit
        </div>
      );
    }
    if (status === "zero") {
      const reason = deductions[0]?.reason ?? null;
      return (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[--radius-md] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)]/60 px-3 py-2 text-xs font-bold text-[color:var(--color-error)]">
          <span aria-hidden>✗</span> No credit
          {reason && (
            <span className="font-semibold">
              · <MathText text={reason} />
            </span>
          )}
        </div>
      );
    }
    // Partial with no itemized debits (shouldn't normally occur — the grader
    // synthesizes a reconciling entry) — show the score plainly rather than
    // an empty itemized box.
    return (
      <div className="mt-3 inline-flex items-center gap-2 rounded-[--radius-md] border border-[color:var(--color-warning-dark)]/30 bg-[color:var(--color-warning-bg)]/60 px-3 py-2 text-xs font-bold text-[color:var(--color-warning-dark)]">
        Partial · {score}%
      </div>
    );
  }

  // Tone per anchored debit — cycles amber/info in document order, the
  // same basis ProblemGradeRow uses to tint the matching step, so the
  // badge colors line up across the receipt and the work list.
  let anchorN = 0;
  const scoreColor =
    status === "zero"
      ? "text-[color:var(--color-error)]"
      : status === "full"
        ? "text-[color:var(--color-success)]"
        : "text-[color:var(--color-warning-dark)]";

  return (
    <div className="mt-3 overflow-hidden rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--color-text-secondary)]">
          Why {score}% — itemized
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold">
          <span aria-hidden>🤖</span>
          <span className="text-text-muted">AI breakdown</span>
          {confPct != null && (
            <>
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  confLow
                    ? "bg-[color:var(--color-warning)]"
                    : "bg-[color:var(--color-success)]"
                }`}
              />
              <span
                className={
                  confLow
                    ? "text-[color:var(--color-warning-dark)]"
                    : "text-text-muted"
                }
              >
                {confPct}% confidence
              </span>
            </>
          )}
        </span>
      </div>
      <div className="py-1">
        {credits.map((d, i) => (
          <div
            key={`c${i}`}
            className="flex items-center gap-2.5 px-3 py-1.5 text-[12.5px]"
          >
            <span
              aria-hidden
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)] text-[10px] font-extrabold text-[color:var(--color-success)]"
            >
              ✓
            </span>
            <span className="min-w-0 flex-1 text-text-primary">
              <MathText text={d.reason} />
            </span>
            <span className="shrink-0 font-mono text-[12px] font-semibold text-[color:var(--color-success)]">
              full
            </span>
          </div>
        ))}
        {debits.map((d, i) => {
          // Belt-and-suspenders: the backend nulls out-of-range step_refs,
          // but guard here too so a stale/dead anchor never renders a "↳ step
          // N" link that scrolls to a step that doesn't exist. Source of
          // truth is the backend clamp.
          const anchored =
            d.step_ref != null && d.step_ref >= 1 && d.step_ref <= stepCount;
          const tone = anchored ? ANCHOR_TONES[anchorN++ % ANCHOR_TONES.length] : null;
          const a = tone ? ANCHOR_STYLE[tone] : null;
          return (
            <div
              key={`d${i}`}
              className={`flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] ${
                a
                  ? `mx-1.5 my-px rounded-[--radius-sm] ${
                      tone === "amber"
                        ? "bg-[color:var(--color-warning-bg)]/50"
                        : "bg-[color:var(--color-info-light)]/50"
                    }`
                  : ""
              }`}
            >
              {a ? (
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-extrabold ${a.badge}`}
                >
                  {d.step_ref}
                </span>
              ) : (
                <span
                  aria-hidden
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] text-[10px] font-extrabold text-[color:var(--color-error)]"
                >
                  −
                </span>
              )}
              <span className="min-w-0 flex-1 text-text-primary">
                <MathText text={d.reason} />
                {anchored && (
                  <button
                    type="button"
                    onClick={() => onAnchorClick(d.step_ref as number)}
                    className={`ml-1.5 inline-flex items-center gap-0.5 align-baseline text-[10px] font-bold hover:underline ${
                      tone === "amber"
                        ? "text-[color:var(--color-warning-dark)]"
                        : "text-[color:var(--color-info)]"
                    }`}
                  >
                    ↳ step {d.step_ref} in work
                  </button>
                )}
              </span>
              <span className="shrink-0 font-mono text-[12px] font-semibold text-[color:var(--color-error)]">
                −{Math.round(d.points_off)}%
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-border bg-surface px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          Score
        </span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-text-muted">
            100{debits.map((d, i) => <span key={i}> − {Math.round(d.points_off)}</span>)}
          </span>
          <span className={`font-mono text-lg font-bold ${scoreColor}`}>
            {score}%
          </span>
        </span>
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
  // Selected fills carry a white label, so each one is picked to clear
  // 4.5:1 under white. None of the three did:
  //   red   → `--color-error-light` (#F0D7D1, a pale pink) at 1.37:1 —
  //           the label all but vanished the moment a teacher picked it
  //   green → Tailwind's green-500, outside the palette, at 2.2:1
  //   amber → `--color-warning` (#A66B15) at 4.43:1, just under
  // Amber is why this list is `-dark` for one tone and not the others:
  // `--color-warning` is the lightest of the three status tokens and
  // misses on its own, so the filled-with-white use takes
  // `--color-warning-dark` (6.08:1). Red and green clear it at full
  // strength (9.00:1 and 6.08:1). Check the ratio before adding a tone.
  //
  // These are LIGHT-theme ratios, which is what ships: nothing in the app
  // sets `data-theme`, and there is no `prefers-color-scheme` block, so
  // the dark token block in globals.css is currently unreachable. Under
  // those tokens white would sit at 4.19 (error), 3.15 (success) and 3.14
  // (warning) — all under AA. Fixing that is not a token swap: it needs a
  // dark-theme foreground decision (dark ink on the lighter fills) taken
  // across the app rather than guessed at here, so it is deliberately not
  // done in this file. Whoever turns dark mode on owns it.
  const activeCls = {
    green: "border-[color:var(--color-success)] bg-[color:var(--color-success)] text-white",
    amber: "border-[color:var(--color-warning-dark)] bg-[color:var(--color-warning-dark)] text-white",
    red: "border-[color:var(--color-error)] bg-[color:var(--color-error)] text-white",
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

// ── Keyboard shortcuts cheatsheet ───────────────────────────────────
//
// A small, dismissible reference for the grading keys, opened by "?"
// or the quiet "Press ? for shortcuts" hint. Same modal vocabulary as
// the integrity verdict legend above (Escape-closes, click-outside,
// focus moved into the dialog) so the page has one consistent dialog
// behaviour.

const SHORTCUT_GROUPS: { heading: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    heading: "Grade the focused problem",
    rows: [
      { keys: ["1"], label: "Full credit — 100%" },
      { keys: ["2"], label: "Partial — 75%" },
      { keys: ["3"], label: "Partial — 50%" },
      { keys: ["4"], label: "Partial — 25%" },
      { keys: ["5"], label: "No credit — 0%" },
    ],
  },
  {
    heading: "Confident (collapsed) rows",
    rows: [
      { keys: ["1", "5"], label: "The AI's own key confirms in place + advances" },
    ],
  },
  {
    heading: "Move",
    rows: [
      { keys: ["J", "↓"], label: "Next problem" },
      { keys: ["K", "↑"], label: "Previous problem" },
    ],
  },
  {
    heading: "Students",
    rows: [{ keys: ["Enter", "→"], label: "Next student" }],
  },
  {
    heading: "Help",
    rows: [
      { keys: ["?"], label: "Toggle this cheatsheet" },
      { keys: ["Esc"], label: "Close, or leave a text field" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-[--radius-sm] border border-border-light bg-[color:var(--color-surface-alt-2)] px-1.5 py-0.5 font-sans text-[11px] font-bold text-text-secondary shadow-sm">
      {children}
    </kbd>
  );
}

function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Escape closes — bubble phase, matching the verdict legend. The
  // panel's grading listener bails while this modal is open, so the
  // two never fight over a keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog so SR announces the title and Tab cycles
  // inside; the wrapper has tabIndex={-1} purely to be focusable.
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
        aria-labelledby="kbd-shortcuts-title"
        className="w-full max-w-md rounded-[--radius-xl] bg-surface p-6 shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="kbd-shortcuts-title"
              className="text-lg font-bold text-text-primary"
            >
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Grade without leaving the keyboard — press a number to score the
              highlighted problem, then it advances to the next ungraded one.
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
        <div className="mt-4 space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                {group.heading}
              </p>
              <ul className="mt-2 space-y-1.5">
                {group.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-text-primary">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-[10px] text-text-muted">or</span>
                          )}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
  onResolved,
}: {
  integrity: TeacherIntegrityDetail | null;
  overviewFallback: TeacherSubmissionRow["integrity_overview"] | null;
  onResolved: (
    submissionId: string,
    resolution: IntegrityResolutionOutcome,
  ) => void;
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
  // A teacher who marked the check reviewed has handled it — drop the
  // loud verdict color to a neutral tint (keep the icon/label) so a
  // resolved flag no longer reads as an open alarm.
  const resolved =
    !!integrity && integrity.resolution !== "unresolved";
  const style = resolved
    ? { ...INTEGRITY_STYLE[key], ...NEUTRAL_STYLE }
    : INTEGRITY_STYLE[key];
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
                {/* "Mark reviewed" — only on checks that need attention
                    (or already resolved). Clearing one drops it from the
                    roster flagged filter. Needs full detail (resolution
                    + resolved-by); hidden during the overview-only gap. */}
                {integrity &&
                  (integrityNeedsResolution(integrity) ||
                    integrity.resolution !== "unresolved") && (
                    <div className="mt-2.5">
                      <ResolveIntegrityControl
                        submissionId={integrity.submission_id}
                        resolution={integrity.resolution}
                        resolvedByName={integrity.resolved_by_name}
                        resolvedAt={integrity.resolved_at}
                        onResolved={(r) =>
                          onResolved(integrity.submission_id, r)
                        }
                      />
                    </div>
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
    <Modal open={open} onClose={onClose} className="max-w-3xl bg-surface p-0" label="AI and student conversation">
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
 * rather than as its own scan-path block. On the wide (3-column)
 * layout the PinnedWorkRail makes the work glanceable and this strip
 * affordance hides; below ~1100px the rail unpins and this takes over.
 */
function StudentWorkThumbButton({
  files,
  studentName,
}: {
  files: SubmissionFile[];
  studentName: string;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const first = files[0];
  if (!first) return null;
  const firstSrc = `data:${first.media_type};base64,${first.data}`;
  const firstIsPdf = first.media_type === "application/pdf";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpenAt(0)}
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
      <WorkGalleryModal
        files={files}
        studentName={studentName}
        openAt={openAt}
        onClose={() => setOpenAt(null)}
      />
    </>
  );
}

/**
 * Pinned student-work rail (wide layout, 3rd column). Promotes the
 * student's submitted pages out of the modal so they're glanceable while
 * grading — the split view. A sticky panel that keeps the first page in
 * view as the teacher scrolls the grade column; "⤢ Full" opens the same
 * lightbox for a zoom, and "📌 Pinned" collapses the inline photo to
 * reclaim vertical space (a session preference lifted to the page so it
 * persists across students). Hidden below ~1100px, where the header-strip
 * thumbnail takes over so the roster + grade column never get crushed.
 */
function PinnedWorkRail({
  files,
  studentName,
  pinned,
  onTogglePinned,
}: {
  files: SubmissionFile[] | null;
  studentName: string | null;
  pinned: boolean;
  onTogglePinned: () => void;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const firstName = studentName ? studentName.split(" ")[0] : null;
  const hasFiles = !!files && files.length > 0;
  return (
    <div className="sticky top-3 overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-border-light px-3 py-2.5">
        <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--color-text-secondary)]">
          {firstName ? `${firstName}'s work` : "Student's work"}
          {hasFiles && files!.length > 1 ? ` · ${files!.length} pages` : ""}
        </span>
        {hasFiles && (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={onTogglePinned}
              aria-pressed={pinned}
              className={`rounded-[--radius-sm] border px-2 py-1 text-[11px] font-semibold transition-colors ${
                pinned
                  ? "border-primary/30 bg-primary-bg text-primary"
                  : "border-border-light bg-surface text-text-muted hover:text-text-primary"
              }`}
            >
              📌 {pinned ? "Pinned" : "Pin"}
            </button>
            <button
              type="button"
              onClick={() => setOpenAt(0)}
              className="rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
            >
              ⤢ Full
            </button>
          </div>
        )}
      </div>
      {!hasFiles ? (
        <div className="px-3 py-10 text-center text-[11px] text-text-muted">
          No photo on this submission.
        </div>
      ) : pinned ? (
        <div className="max-h-[calc(100vh-7rem)] overflow-y-auto bg-[color:var(--color-surface-alt-2)]/40 p-2">
          <div className="flex flex-col gap-2">
            {files!.map((f, i) => {
              const src = `data:${f.media_type};base64,${f.data}`;
              if (f.media_type === "application/pdf") {
                return (
                  <PdfView
                    key={i}
                    data={f.data}
                    className="h-[420px] w-full rounded-[--radius-sm] border border-border-light bg-white"
                  />
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setOpenAt(i)}
                  className="block w-full overflow-hidden rounded-[--radius-sm] border border-border-light"
                  aria-label={`Open page ${i + 1} full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Student handwritten submission, page ${i + 1}`}
                    className="w-full object-contain"
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onTogglePinned}
          className="w-full px-3 py-4 text-center text-[11px] font-semibold text-text-muted hover:text-primary"
        >
          Photo collapsed — click to pin it back
        </button>
      )}
      <WorkGalleryModal
        files={files ?? []}
        studentName={studentName ?? "Student"}
        openAt={openAt}
        onClose={() => setOpenAt(null)}
      />
    </div>
  );
}
