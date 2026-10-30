import type { HomeworkDetail } from "../services/api";

export type StudentNextStep = NonNullable<HomeworkDetail["next_step"]>;

/** The student's "one more step" nudge on turned-in homework. Calm on
 *  purpose: the work is already in and nothing waits on this — no
 *  warning colors, no deadline, no claim that it counts toward the
 *  grade. Mirrors web/src/components/school/student/next-step.ts. */
export const NEXT_STEP_COPY: Record<StudentNextStep, { label: string; hint: string }> = {
  confirm_reading: {
    label: "Confirm your reading",
    hint: "Your work is in. Check we read it right — it takes a minute.",
  },
  finish_check: {
    label: "Finish the quick check",
    hint: "Your work is in. A few questions about it — pick up where you left off.",
  },
};
