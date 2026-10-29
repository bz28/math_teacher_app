import type { StudentNextStep } from "@/lib/api";

/** The student's "one more step" nudge on turned-in homework. Calm on
 *  purpose: the homework is already in, nothing is late, and nothing
 *  waits on this — so no warning colors, no deadline, and no claim that
 *  it counts toward the grade. Mirrored in mobile/src/utils/nextStep.ts. */
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
