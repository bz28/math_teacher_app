/**
 * Field Guide tour engine — shared types.
 *
 * A tour is pure data: a persona, a welcome cover, an ordered list of
 * spotlight steps, and finish copy. The engine (TourProvider +
 * TourOverlay) renders any TourDefinition, so adding the school-student
 * or personal-learner tour is just authoring another entry in
 * `tours.ts` — no engine changes.
 */

export type TourPersona = "teacher" | "school-student" | "personal-learner";

/** Preferred side for the caption card relative to its target. "auto"
 *  lets the engine pick whichever side fits without covering the
 *  target. */
export type TourPlacement = "auto" | "top" | "bottom" | "left" | "right";

/**
 * Stable `data-tour-id` values. Real on-screen controls carry these
 * attributes; a step locates its target by querying the DOM for the
 * matching id (the DOM is the registry). Keeping them here means the
 * step-list and the controls can't drift apart silently.
 */
export const TOUR_IDS = {
  teacherNewCourse: "teacher-new-course",
  teacherNewSection: "teacher-new-section",
  teacherInvite: "teacher-invite",
  teacherMaterials: "teacher-materials",
  teacherNewHomework: "teacher-new-homework",
  teacherSubmissions: "teacher-submissions",
} as const;

/**
 * Named imperative handoffs a step can request. The host page registers
 * a handler for each via `useTourAction(name, fn)`; the engine invokes
 * them by name so the data-only step-list never imports page state.
 */
export const TOUR_ACTIONS = {
  // Live handoff into the real New-course dialog on the courses list —
  // the from-zero tour's first step, owned by the courses-list page.
  openNewCourse: "teacher.open-new-course",
  closeNewCourse: "teacher.close-new-course",
  gotoSections: "teacher.goto-sections",
  openNewSection: "teacher.open-new-section",
  closeNewSection: "teacher.close-new-section",
  // Switch to the Sections tab AND expand the first section's roster so
  // the invite control (TOUR_IDS.teacherInvite, inside the roster) is
  // mounted before step two spotlights it.
  expandFirstSection: "teacher.expand-first-section",
  gotoMaterials: "teacher.goto-materials",
  gotoHomework: "teacher.goto-homework",
  gotoSubmissions: "teacher.goto-submissions",
} as const;

export interface TourCover {
  /** Letterspaced green eyebrow above the headline. */
  eyebrow: string;
  /** Big serif headline. Wrap the single Fraunces-italic word in
   *  *asterisks* — e.g. "Your classroom, *quietly* intelligent." */
  title: string;
  subtitle: string;
  /** Small reassurance line, e.g. "~30s · revisit anytime". */
  footnote: string;
  /** Primary button label. */
  cta: string;
  /** Ghost dismiss label. */
  skip: string;
}

export interface TourStep {
  id: string;
  /** `data-tour-id` of the element to spotlight. If it can't be found
   *  (e.g. a control that only exists once data is present), the card
   *  centers itself with no cut-out rather than breaking. */
  target: string;
  eyebrow?: string;
  /** Serif action headline. */
  title: string;
  /** One-line plain body. */
  body: string;
  placement?: TourPlacement;
  /** Action run when the step becomes active — typically switching the
   *  workspace to the tab that hosts the target. */
  onEnter?: string;
  /**
   * Optional live handoff into real UI. Pressing Next opens the real
   * surface (`open`) and pauses the overlay so the user can use it;
   * pressing Continue runs `close` and resumes to the next step.
   *
   * `gate: true` makes the handoff a create-or-skip gate: there is no
   * plain "Continue" that advances the tour. The only way forward is
   * completing the real action (the host page advances on success);
   * cancelling the surface returns to this step, and Skip exits. Used
   * by step one, whose later steps live on a different page — advancing
   * without creating a course would strand them on the courses list.
   */
  handoff?: { open: string; close: string; hint: string; gate?: boolean };
}

export interface TourDefinition {
  persona: TourPersona;
  cover: TourCover;
  steps: TourStep[];
  finish: { title: string; body: string };
}
