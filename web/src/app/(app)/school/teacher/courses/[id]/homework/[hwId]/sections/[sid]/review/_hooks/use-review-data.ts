import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { createDetailCache } from "@/lib/detail-cache";
import { effectiveRubric } from "@/lib/rubric";
import { PHOTO_URLS_EXPIRED } from "@/lib/submission-photos";
import {
  teacher,
  type ClassRubricRule,
  type TeacherIntegrityDetail,
  type TeacherRubric,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";

// The review page's data slots and the effects that fill them, lifted
// out of the page verbatim. Each hook is called at the exact spot its
// code used to sit, so the page's hook order is unchanged.

/** What the grader applies now: the homework's rubric plus the class rules. */
export function useClassRubric(courseId: string, hwRubric: TeacherRubric | null) {
  // The class's rules — null until loaded (or if loading failed). Fetched
  // on their own so a failure only hides them from the rubric panel.
  const [classRules, setClassRules] = useState<ClassRubricRule[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    teacher
      .courseRubric(courseId)
      .then((res) => !cancelled && setClassRules(res.rules))
      .catch(() => {
        /* drift banner stays hidden; the homework rubric still shows */
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);
  // What the grader applies now: this homework's rubric plus the class
  // rules it hasn't skipped. Until the rules are known, only the
  // homework's own. (The regrade banner compares only the homework's
  // fields — see `rubricChanged`.)
  const rubric = useMemo(
    () => (classRules ? effectiveRubric(classRules, hwRubric) : hwRubric),
    [classRules, hwRubric],
  );
  return rubric;
}

/** The open student's detail + integrity slots and their caches. */
export function useDetailSlots() {
  // The open student's detail, kept as-is across switches. Staleness
  // for the current selection is detected at render via a
  // submission_id comparison, avoiding a setState-in-effect on every
  // switch. Fetch/save errors are scoped to a submissionId so a failure
  // on one student's grade doesn't render on another student's card.
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  // Full integrity detail (overall verdict + reasoning + transcript)
  // is a separate endpoint from submission detail. Single slot keyed
  // off submission_id, same staleness-by-derivation pattern as
  // `detail`. Null on: HW has integrity disabled, or no check ran.
  const [integrity, setIntegrity] = useState<TeacherIntegrityDetail | null>(null);
  // The last few students' fetched details, so clicking back to one
  // (A → B → A) doesn't re-download their work. Each entry is pinned
  // to the roster row object it was fetched under: every change made
  // from this page replaces that row, so a changed submission is a
  // miss and refetches — a cached grade can't outlive an edit. See
  // lib/detail-cache. Integrity is pinned to the row's integrity
  // overview instead, and cached only once the check has finished; one
  // still running is refetched like before.
  const [detailCache] = useState(() => createDetailCache<TeacherSubmissionDetail>());
  const [integrityCache] = useState(() =>
    createDetailCache<TeacherIntegrityDetail>({
      keep: (d) => d.overall_status === "complete" || d.overall_status === "skipped_unreadable",
    }),
  );
  // Belt and braces for edits that change the open detail without
  // touching its row (an optimistic grade or feedback edit before the
  // save lands): once the slot no longer holds the object that came
  // from the server, that copy is no longer what the teacher last saw.
  useEffect(() => {
    if (detail && !detailCache.holds(detail.submission_id, detail)) {
      detailCache.invalidate(detail.submission_id);
    }
  }, [detail, detailCache]);
  useEffect(() => {
    if (integrity && !integrityCache.holds(integrity.submission_id, integrity)) {
      integrityCache.invalidate(integrity.submission_id);
    }
  }, [integrity, integrityCache]);
  return { detail, setDetail, integrity, setIntegrity, detailCache, integrityCache };
}

/** Snapshotted counters for grades in the homework's other sections. */
export function useOtherSectionCounts() {
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
  // Other-section submissions about to be published that still have
  // graph items waiting on the teacher's ✓/✗ — same snapshot rule.
  const [graphOtherSections, setGraphOtherSections] = useState(0);
  return {
    pendingOtherSections,
    setPendingOtherSections,
    dirtyOtherSections,
    setDirtyOtherSections,
    gradedOtherSections,
    setGradedOtherSections,
    pendingReviewedOtherSections,
    setPendingReviewedOtherSections,
    dirtyReviewedOtherSections,
    setDirtyReviewedOtherSections,
    flaggedOtherSections,
    setFlaggedOtherSections,
    graphOtherSections,
    setGraphOtherSections,
  };
}

type DetailCache<T> = ReturnType<typeof createDetailCache<T>>;

/** Fetch the selected student's detail and integrity, and re-sign expired photos. */
export function useSubmissionDetailFetch({
  selectedRow,
  selectedSubmissionId,
  detail,
  setDetail,
  setFetchError,
  integrity,
  setIntegrity,
  detailCache,
  integrityCache,
}: {
  selectedRow: TeacherSubmissionRow | null;
  selectedSubmissionId: string | null;
  detail: TeacherSubmissionDetail | null;
  setDetail: Dispatch<SetStateAction<TeacherSubmissionDetail | null>>;
  setFetchError: Dispatch<SetStateAction<{ forSubmissionId: string; message: string } | null>>;
  integrity: TeacherIntegrityDetail | null;
  setIntegrity: Dispatch<SetStateAction<TeacherIntegrityDetail | null>>;
  detailCache: DetailCache<TeacherSubmissionDetail>;
  integrityCache: DetailCache<TeacherIntegrityDetail>;
}) {
  // Fetch only when we don't already have the current selection — from
  // the cache when this row was fetched recently and hasn't changed.
  useEffect(() => {
    if (!selectedRow) return;
    if (detail?.submission_id === selectedRow.id) return;
    let cancelled = false;
    const id = selectedRow.id;
    detailCache
      .load(id, selectedRow, () => teacher.submissionDetail(id))
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
  }, [selectedRow, detail?.submission_id, detailCache, setDetail, setFetchError]);

  // A photo's presigned URL ran out (the tab sat open past the hour):
  // sign fresh ones. Only `files` is replaced — the rest of `detail`
  // can hold the teacher's unsaved edits.
  useEffect(() => {
    if (!selectedSubmissionId) return;
    const id = selectedSubmissionId;
    const refresh = () => {
      teacher
        .submissionDetail(id)
        .then((d) =>
          setDetail((cur) =>
            cur?.submission_id === d.submission_id ? { ...cur, files: d.files } : cur,
          ),
        )
        .catch(() => {});
    };
    window.addEventListener(PHOTO_URLS_EXPIRED, refresh);
    return () => window.removeEventListener(PHOTO_URLS_EXPIRED, refresh);
  }, [selectedSubmissionId, setDetail]);

  // Fetch the full integrity detail in parallel. Independent of
  // submissionDetail so a missing/404 integrity record (HW had the
  // check disabled, or the pipeline never ran) doesn't block the
  // grading UI — the banner just hides.
  //
  // Cached against the row's integrity overview rather than the whole
  // row: a grade save replaces the row but says nothing new about the
  // check, while a resolution or a poll's fresh read replaces the
  // overview. Depending on the row would refetch a 404 on every save.
  const selectedOverview = selectedRow?.integrity_overview ?? null;
  useEffect(() => {
    if (!selectedSubmissionId) return;
    if (integrity?.submission_id === selectedSubmissionId) return;
    let cancelled = false;
    const id = selectedSubmissionId;
    integrityCache
      .load(id, selectedOverview, () => teacher.integrityDetail(id))
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
  }, [selectedSubmissionId, selectedOverview, integrity?.submission_id, integrityCache, setIntegrity]);
}
