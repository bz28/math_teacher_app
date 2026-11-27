import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { teacher, type TeacherSubmissionDetail } from "@/lib/api";
import type { RosterEntry } from "../_lib/types";
import { releases, type PublishScope } from "../_lib/publish-scope";

type Setter<T> = Dispatch<SetStateAction<T>>;

/**
 * Publishing from the section review page: this section (the class she
 * is reviewing), every section of the homework ("Publish all"), or one
 * student. The server releases approved grades only; the local roster
 * and open detail mirror exactly that, so the markers flip without a
 * refetch. Other sections' counters are snapshots: "all" takes their
 * approved part off; the others leave them alone.
 */
export function usePublishGrades({
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
}: {
  assignmentId: string;
  sectionId: string;
  setRoster: Setter<RosterEntry[] | null>;
  setDetail: Setter<TeacherSubmissionDetail | null>;
  pendingReviewedOtherSections: number;
  dirtyReviewedOtherSections: number;
  setPendingOtherSections: Setter<number>;
  setDirtyOtherSections: Setter<number>;
  setPendingReviewedOtherSections: Setter<number>;
  setDirtyReviewedOtherSections: Setter<number>;
}) {
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publish = useCallback(
    async (scope: PublishScope): Promise<boolean> => {
      setPublishing(true);
      setPublishError(null);
      try {
        await teacher.publishGrades(
          assignmentId,
          scope.kind === "section"
            ? { sectionId }
            : scope.kind === "student"
              ? { submissionId: scope.submissionId }
              : {},
        );
        const nowIso = new Date().toISOString();
        setRoster((prev) =>
          prev
            ? prev.map((e) => {
                const s = e.submission;
                if (!s || !releases(s, s.id, scope)) return e;
                return {
                  ...e,
                  submission: { ...s, grade_published_at: nowIso, grade_dirty: false },
                };
              })
            : prev,
        );
        if (scope.kind === "all") {
          setPendingOtherSections((n) => n - pendingReviewedOtherSections);
          setDirtyOtherSections((n) => n - dirtyReviewedOtherSections);
          setPendingReviewedOtherSections(0);
          setDirtyReviewedOtherSections(0);
        }
        setDetail((d) =>
          d && releases(d, d.submission_id, scope)
            ? { ...d, grade_published_at: nowIso, grade_dirty: false }
            : d,
        );
        return true;
      } catch (e) {
        setPublishError(e instanceof Error ? e.message : "Failed to publish grades");
        return false;
      } finally {
        setPublishing(false);
      }
    },
    [
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
    ],
  );

  return { publish, publishing, publishError, setPublishError };
}
