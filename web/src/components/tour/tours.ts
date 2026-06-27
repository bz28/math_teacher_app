/**
 * Field Guide tour definitions, one per persona.
 *
 * The teacher tour ships first and replaces the old setup checklist. It
 * is one linear from-zero journey for a brand-new teacher who has
 * nothing: step 1 creates their first course (on the courses list), the
 * tour carries across the navigation into that course, and steps 2-5
 * walk the rest of the setup path (section → students → materials →
 * homework) before step 6 explains grading + the integrity check.
 *
 * Adding a persona is purely additive: author a `TourDefinition` and
 * register it in `TOURS`. The engine renders it unchanged.
 */
import { TOUR_ACTIONS, TOUR_IDS, type TourDefinition, type TourPersona } from "./types";

const TEACHER_TOUR: TourDefinition = {
  persona: "teacher",
  cover: {
    eyebrow: "Welcome to Veradic",
    title: "Your classroom, *quietly* intelligent.",
    subtitle: "A short walk through the six things that get a class running — starting from scratch.",
    footnote: "~30s · revisit anytime from the menu",
    cta: "Take the tour",
    skip: "Skip for now",
  },
  steps: [
    {
      id: "course",
      target: TOUR_IDS.teacherNewCourse,
      eyebrow: "Step one",
      title: "Create your first course",
      body: "Start with a course — your subject or class period. We'll set it up together.",
      placement: "bottom",
      // Live handoff: opens the real New course dialog. Creating a course
      // navigates into its workspace, where the tour resumes at step two.
      handoff: {
        open: TOUR_ACTIONS.openNewCourse,
        close: TOUR_ACTIONS.closeNewCourse,
        hint: "This is the real dialog — name a course now, or continue the tour.",
      },
    },
    {
      id: "section",
      target: TOUR_IDS.teacherNewSection,
      eyebrow: "Step two",
      title: "Create a section",
      body: "A section is one class period. Add one to start inviting students.",
      placement: "bottom",
      onEnter: TOUR_ACTIONS.gotoSections,
      // Live handoff: opens the real New section dialog, then resumes.
      handoff: {
        open: TOUR_ACTIONS.openNewSection,
        close: TOUR_ACTIONS.closeNewSection,
        hint: "This is the real dialog — name a section now, or continue the tour.",
      },
    },
    {
      id: "invite",
      target: TOUR_IDS.teacherInvite,
      eyebrow: "Step three",
      title: "Invite your students",
      body: "Share a join code or email invites — students land straight in your class.",
      placement: "bottom",
      // Expanding the first section's roster mounts the invite control
      // this step targets. Falls back to the centered card when a
      // first-run teacher skipped creating a section in step one.
      onEnter: TOUR_ACTIONS.expandFirstSection,
    },
    {
      id: "materials",
      target: TOUR_IDS.teacherMaterials,
      eyebrow: "Step four",
      title: "Add course materials",
      body: "Drop in your textbook pages — generated homework matches their style and level.",
      placement: "bottom",
      onEnter: TOUR_ACTIONS.gotoMaterials,
    },
    {
      id: "homework",
      target: TOUR_IDS.teacherNewHomework,
      eyebrow: "Step five",
      title: "Create homework",
      body: "Generate problems from your materials in seconds, then review before assigning.",
      placement: "bottom",
      onEnter: TOUR_ACTIONS.gotoHomework,
    },
    {
      id: "grade",
      target: TOUR_IDS.teacherSubmissions,
      eyebrow: "Step six",
      title: "Grade & the integrity check",
      body: "AI pre-grades each submission and can interview a student to confirm they understand their own work. You review and publish.",
      placement: "bottom",
      onEnter: TOUR_ACTIONS.gotoSubmissions,
    },
  ],
  finish: {
    title: "You're set.",
    body: "No checklist to babysit. Revisit this tour anytime from the menu.",
  },
};

/** All tours, keyed by persona. School-student and personal-learner
 *  plug in here once authored — no engine changes required. */
export const TOURS: Partial<Record<TourPersona, TourDefinition>> = {
  teacher: TEACHER_TOUR,
};

export function getTour(persona: TourPersona): TourDefinition | null {
  return TOURS[persona] ?? null;
}
