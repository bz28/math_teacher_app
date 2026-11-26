/**
 * Field Guide tour definitions, one per persona.
 *
 * Teachers no longer get a spotlight tour: their onboarding is the
 * chaptered video walkthrough (components/walkthrough), which shows every
 * tab working on a filled-in class instead of pointing at empty ones.
 * Students and personal learners keep their short tours here.
 *
 * Adding a persona is purely additive: author a `TourDefinition` and
 * register it in `TOURS`. The engine renders it unchanged.
 */
import { TOUR_IDS, type TourDefinition } from "./types";

/**
 * School-student tour. A school student lands on a dashboard that already exists (they got
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
  student: STUDENT_TOUR,
  personal: PERSONAL_TOUR,
};

export function getTour(key: string): TourDefinition | null {
  return TOURS[key] ?? null;
}
