/**
 * Field Guide tour definitions, one per persona.
 *
 * The teacher tour ships first and replaces the old setup checklist. It
 * is one comprehensive from-zero journey for a brand-new teacher who has
 * nothing: step 1 creates their first course (on the courses list), the
 * tour carries across the navigation into that course, then it walks
 * EVERY workspace tab left-to-right — section → invite → materials →
 * homework → practice → submissions → grades. Student Insights is
 * skipped while that tab is gated behind its coming-soon panel; there's
 * nothing to teach until it's rebuilt. The later tabs
 * (practice/submissions/grades) are empty for a
 * fresh teacher, so each step spotlights a stable anchor that exists in
 * the from-zero state (a header or a primary control, never a data row)
 * and the copy EXPLAINS what the tab is for and what will fill it in.
 *
 * This single tour replaced the old per-feature first-use coachmarks
 * (hw-create / review-flow / integrity / insights), which fired once,
 * invisibly, the first time a teacher touched a surface and confused
 * more than they helped.
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
    subtitle: "A short walk through every tab that gets a class running — starting from scratch.",
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
        hint: "This is the real dialog — name a section now to continue, or skip the tour.",
        // Create-or-skip gate, same as the course step: the invite step
        // (step three) needs a real section to point at, so creating a
        // section is what advances the tour. Cancelling returns here.
        gate: true,
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
      id: "practice",
      target: TOUR_IDS.teacherPractice,
      eyebrow: "Practice",
      title: "Low-stakes reps",
      body: "Spin up ungraded practice sets so students can drill a concept until it clicks — no grade on the line. Clone one from any homework or start fresh.",
      // New-practice button is top-right — tuck the card beside it. Always
      // mounted, so it anchors cleanly even with zero practice sets yet.
      placement: "left",
      onEnter: TOUR_ACTIONS.gotoPractice,
    },
    {
      id: "grade",
      target: TOUR_IDS.teacherSubmissions,
      eyebrow: "Submissions",
      title: "Where the real work pays off",
      body: "As students turn work in it lands here, AI pre-graded — and the AI can quietly interview a student to confirm the work is their own. You stay the judge: review, adjust, and publish when it's right.",
      placement: "bottom",
      onEnter: TOUR_ACTIONS.gotoSubmissions,
    },
    {
      id: "grades",
      target: TOUR_IDS.teacherGrades,
      eyebrow: "Grades",
      title: "Your gradebook of record",
      body: "Published grades collect here, by section — your at-a-glance read on who's strong and who's slipping, exportable to your SIS in a click. It populates as you publish.",
      // The Grades tab early-returns an empty state with no header for a
      // fresh class, so anchor the always-mounted tab button itself.
      placement: "bottom",
      onEnter: TOUR_ACTIONS.gotoGrades,
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

/** All tours, keyed by persona overview. Each plugs into the same
 *  engine — no engine changes required to add one. */
export const TOURS: Record<string, TourDefinition> = {
  teacher: TEACHER_TOUR,
  student: STUDENT_TOUR,
  personal: PERSONAL_TOUR,
};

export function getTour(key: string): TourDefinition | null {
  return TOURS[key] ?? null;
}
