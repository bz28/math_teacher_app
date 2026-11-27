import type { CourseSetupStatus } from "@/lib/api";

export type SetupStepKey = "sections" | "codes" | "homework";

export type SetupStep = { key: SetupStepKey; done: boolean };

/** The three things a new course needs before students can hand in
 *  work, in order: sections, students joining by code, a first
 *  homework. Null once all three are done: the checklist goes away. */
export function setupSteps(status: CourseSetupStatus): SetupStep[] | null {
  const steps: SetupStep[] = [
    { key: "sections", done: status.has_section },
    { key: "codes", done: status.has_student },
    { key: "homework", done: status.has_homework },
  ];
  return steps.every((s) => s.done) ? null : steps;
}
