import { useEffect, type Dispatch, type SetStateAction } from "react";
import { teacher, type TeacherRubric, type TeacherSubmissionRow } from "@/lib/api";
import type { RosterEntry } from "../_lib/types";

type Setter<T> = Dispatch<SetStateAction<T>>;

/**
 * Load the homework, the section roster and every submission, merge them
 * into the page's roster, snapshot the other-section counters, and pick
 * the student to open. Lifted verbatim from the review page and called
 * where the effect used to sit, so hook order is unchanged.
 */
export function useRosterLoad({
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
}: {
  assignmentId: string;
  courseId: string;
  sectionId: string;
  focusStudentId: string | null;
  watchGrades: (ids: readonly string[]) => void;
  setError: Setter<string | null>;
  setHwTitle: Setter<string>;
  setHwDueAt: Setter<string | null>;
  setSectionName: Setter<string>;
  setHwRubric: Setter<TeacherRubric | null>;
  setPendingOtherSections: Setter<number>;
  setDirtyOtherSections: Setter<number>;
  setGradedOtherSections: Setter<number>;
  setPendingReviewedOtherSections: Setter<number>;
  setDirtyReviewedOtherSections: Setter<number>;
  setFlaggedOtherSections: Setter<number>;
  setGraphOtherSections: Setter<number>;
  setRoster: Setter<RosterEntry[] | null>;
  setSelectedStudentId: Setter<string | null>;
}) {
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
        // This section's date: what a reopen extends, and what the
        // page's due line shows.
        setHwDueAt(
          a.section_due_dates.find((d) => d.section_id === sectionId)?.due_at ?? a.due_at,
        );
        setSectionName(s.name);
        setHwRubric(a.rubric);
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
        let otherGraph = 0;
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
                personal_due_at: null,
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
            if ((r.graph_items_open ?? 0) > 0) otherGraph += 1;
          } else if (r.grade_dirty) {
            otherDirty += 1;
            if (r.reviewed_at) otherDirtyReviewed += 1;
            if (isFlaggedUnresolved) otherFlagged += 1;
            if ((r.graph_items_open ?? 0) > 0) otherGraph += 1;
          }
        }
        setPendingOtherSections(otherPending);
        setDirtyOtherSections(otherDirty);
        setGradedOtherSections(otherGraded);
        setPendingReviewedOtherSections(otherPendingReviewed);
        setDirtyReviewedOtherSections(otherDirtyReviewed);
        setFlaggedOtherSections(otherFlagged);
        setGraphOtherSections(otherGraph);
        const merged: RosterEntry[] = s.students
          .map((st) => ({
            student_id: st.id,
            student_name: st.name || st.email,
            student_email: st.email,
            submission: submissionByStudent.get(st.id) ?? null,
            personal_due_at: subs.personal_due_dates[st.id] ?? null,
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
        // Keep a selection the teacher already made if this effect
        // re-runs; auto-pick only when there is none.
        setSelectedStudentId((current) => {
          if (current && merged.some((e) => e.student_id === current)) {
            return current;
          }
          const pick = focused ?? firstUnreleased ?? firstSubmitter;
          return pick ? pick.student_id : current;
        });
        // A grade already mid-flight when the page opened (a drain
        // running, or a click from another tab) — watch it like one
        // sent from here, so the row resolves without a reload.
        const inFlight = merged
          .map((e) => e.submission)
          .filter(
            (s): s is TeacherSubmissionRow =>
              !!s && s.final_score === null && s.grading_job_status === "running",
          )
          .map((s) => s.id);
        watchGrades(inFlight);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load submissions");
      });
    return () => {
      cancelled = true;
    };
  }, [
    assignmentId,
    courseId,
    sectionId,
    focusStudentId,
    watchGrades,
    setDirtyOtherSections,
    setDirtyReviewedOtherSections,
    setFlaggedOtherSections,
    setGradedOtherSections,
    setGraphOtherSections,
    setPendingOtherSections,
    setPendingReviewedOtherSections,
    setError,
    setHwDueAt,
    setHwRubric,
    setHwTitle,
    setRoster,
    setSectionName,
    setSelectedStudentId,
  ]);
}
