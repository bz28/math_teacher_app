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
    footnote: "~2 min · we'll create your first course together",
    cta: "Take the tour",
    skip: "Skip for now",
  },
  steps: [
    {
      id: "course",
      target: TOUR_IDS.teacherNewCourse,
      eyebrow: "Foundation",
      title: "Create your first course",
      body: "Start with a course — your subject or class period. We'll set it up together.",
      // The New-course button lives top-right; tuck the card beside it
      // (short leader) rather than below, where it would overhang.
      placement: "left",
      // Live handoff: opens the real New course dialog. Creating a course
      // navigates into its workspace, where the tour resumes at step two.
      handoff: {
        open: TOUR_ACTIONS.openNewCourse,
        close: TOUR_ACTIONS.closeNewCourse,
        hint: "This is the real New course dialog — create your first course to continue, or skip the tour.",
        // Create-or-skip gate: steps two onward live inside the new
        // course's workspace, so there is no plain advance from the
        // courses list. Creating a course navigates in and resumes at
        // step two; cancelling the dialog returns here; Skip exits.
        gate: true,
      },
    },
    {
      id: "section",
      target: TOUR_IDS.teacherNewSection,
      eyebrow: "Roster",
      title: "Create a section",
      body: "A section is one class period. Add one to start inviting students.",
      // New-section button is top-right too — tuck the card beside it.
      placement: "left",
      onEnter: TOUR_ACTIONS.gotoSections,
      // Pre-warm step three: expand the first section's roster the moment
      // this step advances, so the invite textarea (behind a slow chain
      // of roster-expand → async section fetch → mount) already exists
      // when step three opens — no late landing on empty space.
      onLeave: TOUR_ACTIONS.expandFirstSection,
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
      eyebrow: "Invitations",
      title: "Invite your students",
      body: "Share a join code or email invites — students land straight in your class.",
      placement: "bottom",
      // Primary pre-warm is step two's onLeave (fires on its Continue).
      // Keep onEnter as a fallback for back-navigation INTO this step,
      // where the prior step's onLeave doesn't run. Re-firing is a
      // no-op — the roster expand is one-shot and idempotent.
      onEnter: TOUR_ACTIONS.expandFirstSection,
    },
    {
      id: "materials",
      target: TOUR_IDS.teacherMaterials,
      eyebrow: "Your materials",
      title: "Add course materials",
      body: "Drop in your textbook pages — generated homework matches their style and level.",
      // Target is the New-Unit control (left edge of the actions row);
      // pin the card's left edge to it so the cut-out reads as a tight
      // pill, not a full-width banner.
      placement: "bottom-start",
      onEnter: TOUR_ACTIONS.gotoMaterials,
    },
    {
      id: "homework",
      target: TOUR_IDS.teacherNewHomework,
      eyebrow: "Homework",
      title: "Create homework",
      body: "Generate problems from your materials in seconds, then review before assigning.",
      // New-homework button is top-right — tuck the card beside it.
      placement: "left",
      onEnter: TOUR_ACTIONS.gotoHomework,
    },
    {
      id: "grade",
      target: TOUR_IDS.teacherSubmissions,
      eyebrow: "The grade",
      title: "Where the real work pays off",
      body: "AI pre-grades every submission and can quietly interview a student to confirm the work is their own. You stay the judge — review, adjust, and publish when it's right.",
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
