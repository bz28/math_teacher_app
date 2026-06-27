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
import { TOUR_ACTIONS, TOUR_IDS, type TourDefinition } from "./types";

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

/**
 * School-student tour. Unlike the teacher's from-zero journey, a
 * school student lands on a dashboard that already exists (they got
 * here by joining a class, which is what stamps their school_id), so
 * this is a pure spotlight walk over controls that are already mounted
 * — no live handoffs, no cross-page carry. Four warm beats: find more
 * classes, see what's due, turn work in, and get unstuck.
 */
const STUDENT_TOUR: TourDefinition = {
  persona: "student",
  cover: {
    eyebrow: "Welcome to Veradic",
    title: "Welcome to class, *reimagined*.",
    subtitle: "A quick look at where your homework, practice, and grades live — so nothing slips.",
    footnote: "~1 min · revisit anytime from the menu",
    cta: "Show me around",
    skip: "Skip for now",
  },
  steps: [
    {
      id: "join",
      target: TOUR_IDS.studentJoin,
      eyebrow: "Your classes",
      title: "Join a class",
      body: "Got a code from a teacher? Tap here anytime to join another class — it'll show up in your sidebar.",
      placement: "right",
    },
    {
      id: "homework",
      target: TOUR_IDS.studentHomework,
      eyebrow: "What's due",
      title: "Your homework, at a glance",
      body: "Everything due this week lives here — anything overdue floats to the top in red so it's never a surprise.",
      placement: "bottom",
    },
    {
      id: "turn-in",
      target: TOUR_IDS.studentTurnIn,
      eyebrow: "Hand it in",
      title: "Open it to turn it in",
      body: "When your teacher posts homework it shows up here — tap any assignment to work through it step by step and submit when you're ready. Your teacher sees it the moment you do.",
      placement: "bottom",
    },
    {
      id: "get-unstuck",
      target: TOUR_IDS.studentGetUnstuck,
      eyebrow: "Get unstuck",
      title: "Miss one? Practice it",
      body: "Graded work lands here. Got something wrong? Jump straight into practice on that exact idea until it clicks.",
      placement: "top",
    },
  ],
  finish: {
    title: "You're all set.",
    body: "That's the whole map. Revisit this tour anytime from the menu.",
  },
};

/**
 * Personal-learner tour. The non-school learner lands on /home, a
 * launchpad of subject cards. /home offers two real entry modes per
 * subject — Learn (a guided, step-by-step walkthrough) and Mock Test
 * (a timed exam sim); Practice is a follow-on inside a Learn session,
 * not a /home control, so this walk grounds itself in what's actually
 * on the page: pick a subject and bring a problem, see how you'll work
 * it, and join a class if you have a code.
 */
const PERSONAL_TOUR: TourDefinition = {
  persona: "personal",
  cover: {
    eyebrow: "Welcome to Veradic",
    title: "Let's make hard problems *click*.",
    subtitle: "Bring any problem — typed or photographed — and we take it one step at a time.",
    footnote: "~1 min · revisit anytime",
    cta: "Take the tour",
    skip: "Skip for now",
  },
  steps: [
    {
      id: "start",
      target: TOUR_IDS.personalStart,
      eyebrow: "Where you begin",
      title: "Start with a problem",
      body: "Pick a subject, then type a problem or snap a photo of it. That's all it takes to get going.",
      placement: "bottom",
    },
    {
      id: "modes",
      target: TOUR_IDS.personalModes,
      eyebrow: "Two ways to work",
      title: "Learn it, then prove it",
      body: "Learn walks you through a problem step by step; Mock Test sits you down for a timed, no-hints run to see what stuck.",
      placement: "right",
    },
    {
      id: "join",
      target: TOUR_IDS.personalJoin,
      eyebrow: "In a class?",
      title: "Join with a code",
      body: "If a teacher gave you a class code, drop it in here to pull their assignments and grades into your account.",
      placement: "top",
    },
  ],
  finish: {
    title: "Go solve something.",
    body: "That's the tour. You can replay it anytime.",
  },
};

// ────────────────────────────────────────────────────────────────────
// Feature first-use walkthroughs.
//
// Unlike the persona overviews above, these are SHORT contextual
// coachmarks (`compact: true` → no welcome cover, straight into 2-3
// spotlights) that fire the first time a teacher actually uses a
// feature. Every step is grounded to a real mounted control; the host
// surface auto-starts the tour while the key is absent from
// `tours_seen` and marks it seen on finish/skip.
// ────────────────────────────────────────────────────────────────────

/**
 * hw-create — first open of the New Homework modal. Two beats grounded
 * on always-mounted modal controls: the Generate/Upload mode toggle and
 * the primary submit button. "Review before assigning" and "assign to a
 * section" happen downstream (review queue → HW detail), so they live in
 * the copy rather than spotlighting controls absent from the modal.
 */
const HW_CREATE_TOUR: TourDefinition = {
  persona: "hw-create",
  compact: true,
  steps: [
    {
      id: "build",
      target: TOUR_IDS.hwCreateMode,
      intro: "First time creating homework",
      eyebrow: "Build it",
      title: "Two ways to start",
      body: "Generate fresh problems from this unit's materials, or Upload a worksheet to digitize — either way you choose the source.",
      placement: "bottom",
    },
    {
      id: "review",
      target: TOUR_IDS.hwCreateGenerate,
      eyebrow: "Then review",
      title: "You review before students do",
      body: "We draft the problems and drop you in a review queue — edit any of them, then assign to a section and publish when it's right.",
      placement: "top",
    },
  ],
};

/**
 * review-flow — first open of a section's submission review page. Three
 * beats along the trust path: the AI pre-grade, the reviewed checkpoint,
 * and publishing. Anchored to the Problems card, the "Mark reviewed"
 * button (present while a grade is unvetted), and the header Publish
 * button.
 */
const REVIEW_FLOW_TOUR: TourDefinition = {
  persona: "review-flow",
  compact: true,
  steps: [
    {
      id: "pre-grade",
      target: TOUR_IDS.reviewGrade,
      intro: "First time grading here",
      eyebrow: "The AI's first pass",
      title: "Every problem, pre-graded",
      body: "The AI grades each problem and flags low-confidence calls. Adjust any score — editing one auto-vouches that you reviewed it.",
      placement: "top",
    },
    {
      id: "reviewed",
      target: TOUR_IDS.reviewReviewed,
      eyebrow: "Your checkpoint",
      title: "Vouch with one click",
      body: "Agree with the AI as-is? Mark reviewed signs off without changing a thing — so students only ever see grades you stand behind.",
      placement: "bottom",
    },
    {
      id: "publish",
      target: TOUR_IDS.reviewPublish,
      eyebrow: "Release it",
      title: "Publish when you're ready",
      body: "Publishing releases every graded submission in this homework to students at once. Nothing is visible to them until you do.",
      placement: "bottom",
    },
  ],
};

/**
 * integrity — first time a flagged submission's understanding check is
 * shown. Two beats: what the check is, then the verdict. Only auto-fires
 * once the AI has reached a disposition, so both anchors are mounted.
 */
const INTEGRITY_TOUR: TourDefinition = {
  persona: "integrity",
  compact: true,
  steps: [
    {
      id: "check",
      target: TOUR_IDS.integrityCheck,
      intro: "This one was flagged",
      eyebrow: "Understanding check",
      title: "The AI quietly interviewed them",
      body: "When work looks unlike a student's own, the AI asks them to explain it — a short conversation you can read in full.",
      placement: "bottom",
    },
    {
      id: "verdict",
      target: TOUR_IDS.integrityVerdict,
      eyebrow: "The verdict",
      title: "A call, not a conviction",
      body: "It summarizes whether the explanation matched the work. It's a signal to look closer — you stay the judge of what happens next.",
      placement: "bottom",
    },
  ],
};

/**
 * insights — first open of the Student Insights tab with real activity.
 * Two beats: the per-student roster, then the framing that it's
 * formative signal rather than a grade.
 */
const INSIGHTS_TOUR: TourDefinition = {
  persona: "insights",
  compact: true,
  steps: [
    {
      id: "roster",
      target: TOUR_IDS.insightsRoster,
      intro: "Your class at a glance",
      eyebrow: "The roster",
      title: "Every student, one read",
      body: "Each row rolls up a student's practice — effort, first-try rate, trend — with a status chip surfacing who needs a nudge.",
      placement: "top",
    },
    {
      id: "signal",
      target: TOUR_IDS.insightsSignal,
      eyebrow: "Read it right",
      title: "Signal, not a grade",
      body: "These are formative cues to steer your attention — not scores. Nothing here is shown to students or counted against them.",
      placement: "bottom",
    },
  ],
};

/** All tours, keyed by persona overview or feature walkthrough. Each
 *  plugs into the same engine — no engine changes required to add one. */
export const TOURS: Record<string, TourDefinition> = {
  teacher: TEACHER_TOUR,
  student: STUDENT_TOUR,
  personal: PERSONAL_TOUR,
  "hw-create": HW_CREATE_TOUR,
  "review-flow": REVIEW_FLOW_TOUR,
  integrity: INTEGRITY_TOUR,
  insights: INSIGHTS_TOUR,
};

export function getTour(key: string): TourDefinition | null {
  return TOURS[key] ?? null;
}
