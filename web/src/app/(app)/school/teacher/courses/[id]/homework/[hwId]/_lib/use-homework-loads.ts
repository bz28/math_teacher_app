"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type BankItem,
  type SubmissionsInboxRow,
  type TeacherSection,
} from "@/lib/api";

/**
 * The homework page's side loads, each degrading quietly on failure:
 * the problems waiting for review, the submissions inbox rows once it's
 * published, and the course's sections.
 */

export function usePendingProblems(courseId: string, assignmentId: string) {
  // Resume-queue state: pending bank items for this HW. Powers the
  // "N pending problems" banner + the "Resume queue ▸" CTA that
  // navigates into the full-page approval queue.
  const [pending, setPending] = useState<BankItem[]>([]);

  // Fetch pending bank items for THIS HW specifically. The backend
  // filter on originating_assignment_id keeps the pool scoped so two
  // HWs in the same unit don't share their pending items.
  const reloadPending = async () => {
    try {
      const res = await teacher.bank(courseId, {
        status: "pending",
        assignment_id: assignmentId,
      });
      setPending(res.items);
    } catch {
      // Non-fatal — the banner just won't appear if this fails.
    }
  };

  useEffect(() => {
    reloadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  return { pending, reloadPending };
}

export function useHomeworkInbox(
  status: string | undefined,
  courseId: string,
  assignmentId: string,
) {
  // Submissions inbox rows for THIS HW only — populated when the HW is
  // published so the detail page can show "X of Y submitted · Z to
  // grade →". One row per section the HW reaches; null while loading
  // or when the HW is still a draft. The strip degrades silently if
  // the request fails — it's a convenience link, not core info.
  const [inboxRows, setInboxRows] = useState<SubmissionsInboxRow[] | null>(
    null,
  );

  // Load submission inbox rows once the HW is published so the strip
  // can show submission counts. Fetches the course-level inbox and
  // filters client-side — there are typically only a few sections per
  // course so the extra rows don't matter, and we save a backend
  // endpoint just for this view. Re-fetched whenever the HW (un)pub
  // status flips; unpublishing clears them (the effect's cleanup).
  useEffect(() => {
    if (status !== "published") return;
    let cancelled = false;
    teacher
      .submissionsInbox(courseId)
      .then((res) => {
        if (cancelled) return;
        setInboxRows(
          res.rows.filter((r) => r.assignment_id === assignmentId),
        );
      })
      .catch(() => {
        // Non-fatal — strip will simply not render.
      });
    return () => {
      cancelled = true;
      setInboxRows(null);
    };
  }, [status, courseId, assignmentId]);

  return inboxRows;
}

export function useCourseSections(courseId: string) {
  // The course's sections, loaded once here rather than inside the
  // picker. The header has to name them (section_names off the server
  // goes stale the moment the picker is touched) and has to know
  // whether the course has any at all, so parent-owned is the only
  // version where the two halves of this page can't disagree.
  const [courseSections, setCourseSections] = useState<TeacherSection[] | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    teacher
      .sections(courseId)
      .then((res) => {
        if (!cancelled) setCourseSections(res.sections);
      })
      .catch(() => {
        // Non-fatal: the header falls back to the ordinary draft copy
        // and the picker renders its own error.
        if (!cancelled) setCourseSections(null);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  return courseSections;
}
