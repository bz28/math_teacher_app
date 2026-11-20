/**
 * Field Guide tour engine — shared types.
 *
 * A tour is pure data: a key, an optional welcome cover, an ordered list
 * of spotlight steps, and finish copy. The engine (TourProvider +
 * TourOverlay) renders any TourDefinition, so adding a tour is just
 * authoring another entry in `tours.ts` — no engine changes.
 *
 * One family uses the engine today: persona overviews (login-time) —
 * a big WelcomeCover then a guided walk, for "student" and "personal".
 * Teachers onboard with the video walkthrough (components/walkthrough)
 * instead; their "teacher" `tours_seen` key now records that they've
 * seen the walkthrough. The `compact` flag and live `handoff` steps the
 * engine still honors are unused by the current tours.
 */

/**
 * The key a tour is registered + persisted under (`tours_seen`). Named
 * `TourPersona` for continuity with the original persona-only engine.
 * The backend `MarkTourSeenRequest` Literal also accepts "teacher"
 * (the walkthrough-seen key), which is not a tour.
 */
export type TourPersona = "student" | "personal";

/** Preferred side for the caption card relative to its target. "auto"
 *  lets the engine pick whichever side fits without covering the
 *  target. The `bottom-start` / `bottom-end` variants pin the card's
 *  left / right edge to the target's edge (instead of centering it
 *  under the target) so a card beside an edge-hugging control stays a
 *  tight pill rather than overhanging the viewport. */
export type TourPlacement =
  | "auto"
  | "top"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "right";

/**
 * Stable `data-tour-id` values. Real on-screen controls carry these
 * attributes; a step locates its target by querying the DOM for the
 * matching id (the DOM is the registry). Keeping them here means the
 * step-list and the controls can't drift apart silently.
 */
export const TOUR_IDS = {
  // ── School-student dashboard (/school/student) ──
  studentJoin: "student-join",
  studentHomework: "student-homework",
  studentTurnIn: "student-turn-in",
  studentGetUnstuck: "student-get-unstuck",

  // ── Personal learner home (/home) ──
  personalStart: "personal-start",
  personalModes: "personal-modes",
  personalJoin: "personal-join",
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
  /** Optional one-line framing shown above the eyebrow, used on the
   *  first card of a compact feature walkthrough to set context (e.g.
   *  "First time creating homework") since there's no welcome cover. */
  intro?: string;
  eyebrow?: string;
  /** Serif action headline. */
  title: string;
  /** One-line plain body. */
  body: string;
  placement?: TourPlacement;
  /** Action run when the step becomes active — typically switching the
   *  workspace to the tab that hosts the target. */
  onEnter?: string;
  /** Action run when the tour ADVANCES off this step (forward only).
   *  Used to pre-warm the next step's target: e.g. step two fires the
   *  roster expand on its Continue so step three's invite control is
   *  already mounted when that step opens, instead of landing on empty
   *  space and jumping in a second later. */
  onLeave?: string;
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
  /** Registration + persistence key (persona overview or feature
   *  walkthrough). Kept named `persona` for engine continuity. */
  persona: TourPersona;
  /**
   * When true this is a compact feature walkthrough: the engine SKIPS
   * the WelcomeCover phase and starts directly at spotlight step 0.
   * Such tours carry no `cover`/`finish` and may set a step `intro`.
   */
  compact?: boolean;
  /** Editorial welcome cover (persona overviews only). Omitted by
   *  compact feature walkthroughs, which open straight on a spotlight. */
  cover?: TourCover;
  steps: TourStep[];
  /** Finish copy (persona overviews). Optional — currently unused by the
   *  renderer (the last step's button just dismisses) and omitted by
   *  compact walkthroughs. */
  finish?: { title: string; body: string };
}
