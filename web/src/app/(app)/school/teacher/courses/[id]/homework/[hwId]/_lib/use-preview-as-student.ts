"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { teacher, enterPreviewMode, exitPreviewMode } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

// Token-swap preview: hands the teacher a shadow-student session and
// navigates to the same HW on the student app. Same-tab navigation
// because preview tokens live in localStorage which is shared across
// tabs (a per-tab preview would require reworking auth storage).
//
// loadUser() is critical — without it the auth store still says
// role=teacher and the /school/student layout's role guard redirects
// back to /home before the page renders. loadUser swallows its own
// errors and resolves with user=null (auth.ts:53-62), so we can't
// rely on a throw to detect failure — we read the post-call user
// state and treat null as failure: restore teacher tokens so the
// teacher isn't stranded with student auth, then throw so run()
// surfaces the error. Independent local busy flag so the button can
// show "Switching…" without conflating with other saves.
export function usePreviewAsStudent(
  courseId: string,
  assignmentId: string,
  run: (fn: () => Promise<void>) => unknown,
) {
  const router = useRouter();
  const { loadUser } = useAuthStore();
  const [previewLoading, setPreviewLoading] = useState(false);
  const onPreviewAsStudent = () =>
    run(async () => {
      if (previewLoading) return;
      setPreviewLoading(true);
      try {
        const tokens = await teacher.previewAsStudent(assignmentId);
        enterPreviewMode(tokens);
        await loadUser();
        const previewUser = useAuthStore.getState().user;
        if (!previewUser) {
          exitPreviewMode();
          throw new Error(
            "Couldn't enter preview mode. Please try again.",
          );
        }
        router.push(
          `/school/student/courses/${courseId}/homework/${assignmentId}`,
        );
      } finally {
        setPreviewLoading(false);
      }
    });

  return { previewLoading, onPreviewAsStudent };
}
