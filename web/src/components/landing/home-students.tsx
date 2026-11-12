import Link from "next/link";

/**
 * The student side of the loop, in two sections, then the trust strip:
 *
 * 1. HomePractice — after each homework, students practice new versions of
 *    every problem, drawn only from siblings the teacher approved
 *    (api/routes/school_student_practice.py: "next unseen approved
 *    sibling"), ungraded. The understanding check's "Go to Practice" nudge
 *    points a student to the practice set linked to that homework; teachers
 *    see engagement and struggle per problem (teacher_practice_activity).
 *
 * 2. HomeCuriosity — the "use AI well" argument the hero sets up ("Your
 *    students already have AI"). Every claim maps to real behaviour: the
 *    Learn chat answers questions about a step and is bounded to
 *    teacher-approved problems (no open chat surface); the understanding
 *    check (optional per homework) asks students to explain their own
 *    work, and teachers can read those transcripts.
 *
 * Both demos are static. The integrity interview and the homework flow
 * above carry the page's motion; these only have to read at a glance.
 */

const SHEET =
  "rounded-[4px] bg-white shadow-[0_2px_0_rgba(0,0,0,0.04),0_30px_60px_-30px_rgba(29,38,51,0.4)]";

const OPTIONS = [
  { label: "(3, 2)", picked: false },
  { label: "(2, 3)", picked: true },
  { label: "(4, 3)", picked: false },
  { label: "(6, 0)", picked: false },
];

function PracticeDemo() {
  return (
    <div
      role="img"
      aria-label="Example: a student practicing a new version of a homework problem. They picked a wrong answer and can try again or walk through it a step at a time."
      className={`${SHEET} w-full max-w-[480px] -rotate-[0.6deg] p-6 sm:p-[26px_30px]`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="m-0 text-[13px] font-bold text-ink-soft">A new version of problem 4</p>
        <p className="m-0 text-[13px] font-bold text-ink-soft">Ungraded</p>
      </div>
      <p className="m-0 mt-3 text-[19px] font-bold leading-snug">
        Solve the system: 2x + 3y = 12 and x &minus; y = 1
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => (
          <span
            key={o.label}
            className={`rounded-[6px] border px-3 py-2.5 text-center text-[15px] ${
              o.picked ? "border-2 border-ink font-bold" : "border-hairline bg-paper"
            }`}
          >
            {o.label}
          </span>
        ))}
      </div>
      <p className="m-0 mt-4 border-l-[3px] border-veradic pl-3 text-[15px] leading-normal text-veradic">
        Not quite. Try again, or walk through it a step at a time.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <span className="rounded-[6px] border border-[#C9C3B3] px-3.5 py-2 text-sm font-bold">Walk me through it</span>
        <span className="rounded-[6px] bg-veradic px-3.5 py-2 text-sm font-bold text-white">Try again</span>
      </div>
    </div>
  );
}

const BODY = "text-lg leading-relaxed text-ink-soft md:text-[19px] md:leading-[1.6]";

export function HomePractice() {
  return (
    <section id="practice" className="mx-auto flex max-w-[1200px] flex-wrap-reverse items-center gap-x-[72px] gap-y-12 px-4 py-20 md:px-8 md:py-[104px]">
      <div className="flex min-w-0 flex-[1_1_440px] justify-center lg:justify-start">
        <PracticeDemo />
      </div>
      <div className="min-w-0 flex-[1_1_400px]">
        <h2 className="site-h2">More practice, on exactly what they missed.</h2>
        <p className={`mt-5 ${BODY}`}>
          After each homework, students can practice new versions of its
          problems. They come only from the ones you approved, and
          they&rsquo;re ungraded, so getting one wrong is safe.
        </p>
        <p className={`mt-4 ${BODY}`}>
          When the understanding check finds a gap, Veradic points the
          student to practice for that homework. You see who practiced and
          which problems they&rsquo;re still stuck on.
        </p>
      </div>
    </section>
  );
}

const PROMISES = [
  "Students can ask why at any step of a practice problem.",
  "It only talks about your class’s problems. There’s no open chat box to paste homework into.",
  "After homework, it can ask each student to explain their own thinking.",
  "You can read every understanding-check conversation.",
];

/**
 * A practice step with the student's questions in their handwriting and
 * Veradic's answers in its green margin note. It answers the "why" and
 * hands the next step back; it doesn't do the problem.
 */
function CuriosityPage() {
  return (
    <div
      role="img"
      aria-label="Example: on a practice problem, 3 times (x plus 2) equals 21, a student asks why they multiply the 3 by the 2. Veradic explains the 3 multiplies everything in the brackets and asks what 3 times 2 is. The student answers 6, so 3x plus 6 equals 21."
      className={`${SHEET} w-full max-w-[460px] rotate-[0.6deg] p-6 sm:p-[26px_30px]`}
    >
      <p className="m-0 text-[13px] font-bold text-ink-soft">Practice &mdash; a new version of problem 5</p>
      <p className="m-0 mt-2.5 text-[22px] font-bold">3(x + 2) = 21</p>
      <p className="m-0 mt-3.5 font-hand text-[22px] leading-snug text-pencil">why do I multiply the 3 by the 2?</p>
      <p className="m-0 mt-3 border-l-[3px] border-veradic pl-3 text-[15.5px] leading-normal text-veradic">
        The 3 multiplies everything in the brackets, so it reaches the 2 as
        well. What do you get for 3 &times; 2?
      </p>
      <p className="m-0 mt-3 font-hand text-[22px] leading-snug text-pencil">6! so 3x + 6 = 21</p>
    </div>
  );
}

export function HomeCuriosity() {
  return (
    <section id="curiosity" className="border-y border-hairline bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-[72px] gap-y-12 px-4 py-20 md:px-8 md:py-24">
        <div className="min-w-0 flex-[1_1_400px]">
          <h2 className="site-h2">They learn to ask AI why, not for the answer.</h2>
          <p className={`mt-5 ${BODY}`}>
            Your students will use AI for the rest of their lives. Veradic is
            where they learn to use it well: to get unstuck and understand,
            not to skip the thinking.
          </p>
          <ul className="m-0 mt-8 list-none space-y-3 border-t border-hairline p-0 pt-6">
            {PROMISES.map((p) => (
              <li key={p} className="flex gap-3 text-base leading-relaxed text-ink">
                <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-[6px] h-3.5 w-3.5 shrink-0 text-veradic" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-w-0 flex-[1_1_440px] justify-center lg:justify-end">
          <CuriosityPage />
        </div>
      </div>
    </section>
  );
}

/**
 * A short, plain answer to "is this safe for our students?" before the
 * final ask — the question every teacher has to clear with their school.
 * Facts only, each one stated on /trust and /for-districts.
 */
const TRUST = [
  { title: "Student work never trains AI", body: "Not ours, not anyone else’s." },
  { title: "FERPA and COPPA", body: "We work as a school official, under your district’s direction." },
  { title: "Your district’s paperwork", body: "We sign the standard data privacy agreement (NDPA)." },
  { title: "Hosted in the U.S.", body: "Encrypted, and your school can export or delete its data at any time." },
];

export function HomeTrust() {
  return (
    <section id="trust" className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 py-20 md:px-8 md:py-24 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
      <div className="max-w-sm">
        <h2 className="site-h2 [font-size:clamp(1.75rem,2.8vw,2.25rem)]">Safe for your students.</h2>
        <Link
          href="/trust"
          className="mt-4 inline-block border-b-2 border-veradic pb-0.5 text-base font-bold text-veradic transition-colors hover:border-ink hover:text-ink"
        >
          How we protect student data
        </Link>
      </div>
      <dl className="m-0 grid flex-1 gap-x-10 gap-y-7 sm:grid-cols-2 lg:max-w-2xl">
        {TRUST.map((t) => (
          <div key={t.title} className="border-t-2 border-ink pt-3">
            <dt className="text-base font-extrabold">{t.title}</dt>
            <dd className="m-0 mt-1 text-[15px] leading-relaxed text-ink-soft">{t.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
