import Link from "next/link";
import { Section } from "./section";

/**
 * The student side of the loop, in two sections:
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

const CARD = {
  background: "#FFFFFF",
  borderRadius: 18,
  boxShadow: "0 36px 90px -40px rgba(0,0,0,0.5)",
  border: "1px solid #ECE7DA",
} as const;

const OPTIONS = [
  { label: "(3, 2)", state: "idle" },
  { label: "(2, 3)", state: "picked-wrong" },
  { label: "(4, 3)", state: "idle" },
  { label: "(6, 0)", state: "idle" },
] as const;

function PracticeDemo() {
  return (
    <div style={CARD} className="w-full max-w-[560px] p-5 sm:p-6" role="img" aria-label="Example: a student practicing a new version of a homework problem">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-semibold text-[#23201A]">A new version of Problem 4</p>
        <p className="text-[12.5px] text-[#6B6457]">Ungraded</p>
      </div>
      <p className="mt-4 text-[16px] leading-relaxed text-[#23201A]">
        Solve the system: 2x + 3y = 12 and x &minus; y = 1
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => (
          <span
            key={o.label}
            className={`rounded-[10px] border px-3 py-2.5 text-center text-[14px] ${
              o.state === "picked-wrong"
                ? "border-[#D9B5AE] bg-[#F0D7D1]/50 font-semibold text-[#8A2317]"
                : "border-[#E4DFD2] bg-[#FBF9F3] text-[#23201A]"
            }`}
          >
            {o.label}
          </span>
        ))}
      </div>
      <p className="mt-4 rounded-[10px] bg-[#F7F5F0] px-3 py-2.5 text-[14px] leading-snug text-[#5C554C]">
        Not quite. Try again, or walk through it a step at a time.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <span className="rounded-full border border-[#E4DFD2] px-4 py-1.5 text-[13px] font-semibold text-[#5C554C]">Walk me through it</span>
        <span className="rounded-full bg-[#0E5238] px-4 py-1.5 text-[13px] font-semibold text-white">Try again</span>
      </div>
    </div>
  );
}

export function HomePractice() {
  return (
    <Section variant="alt" id="practice">
      <div className="grid items-center gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:gap-16">
        <div className="order-1 max-w-xl xl:order-2">
          <h2 className="text-display-md text-[color:var(--color-text)]">
            More practice, on exactly what they missed.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
            After each homework, students can practice new versions of its
            problems. They come only from the ones you approved, and
            they&rsquo;re ungraded, so getting one wrong is safe.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
            When the understanding check finds a gap, Veradic points the
            student to practice for that homework. You see who practiced and
            which problems they&rsquo;re still stuck on.
          </p>
        </div>
        <div className="order-2 min-w-0 xl:order-1">
          <PracticeDemo />
        </div>
      </div>
    </Section>
  );
}

type Turn = { who: "student" | "veradic"; text: string };

const CHAT: Turn[] = [
  { who: "student", text: "why multiply the second equation by 3?" },
  { who: "veradic", text: "So the y terms become 3y and −3y. Add the two equations and y cancels, leaving only x." },
  { who: "student", text: "so could I multiply by 2 and get rid of x instead?" },
  { who: "veradic", text: "Yes, then subtract instead of add. Try it and check you land on the same x and y." },
];

const PROMISES = [
  "Students can ask why at any step of a practice problem.",
  "It only talks about your class’s problems. There’s no open chat box to paste homework into.",
  "After homework, it can ask each student to explain their own thinking.",
  "You can read every understanding-check conversation.",
];

function CuriosityChat() {
  return (
    <div className="w-full max-w-[520px] rounded-[18px] border border-[#1C4030] bg-[#0B2A1E] p-5 sm:p-6" role="img" aria-label="Example: a student asking Veradic why a step works">
      <p className="text-[12.5px] text-[#6E9684]">Step 2 of 4 &mdash; multiply the second equation by 3</p>
      <div className="mt-4 space-y-3">
        {CHAT.map((t, i) =>
          t.who === "student" ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-[#F4F1E8] px-3.5 py-2 text-[14.5px] leading-snug text-[#14130F]">
              {t.text}
            </p>
          ) : (
            <p key={i} className="w-fit max-w-[85%] rounded-[14px] rounded-bl-[4px] border border-[#1C4030] bg-[#0F3526] px-3.5 py-2 text-[14.5px] leading-snug text-[#D9E8DF]">
              {t.text}
            </p>
          ),
        )}
      </div>
    </div>
  );
}

export function HomeCuriosity() {
  return (
    <section
      id="curiosity"
      className="relative w-full"
      style={{ background: "radial-gradient(125% 88% at 50% 0%, #0C3325 0%, #08231A 55%, #061812 100%)" }}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 md:px-8 md:py-24">
        <div className="grid items-center gap-12 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] xl:gap-16">
          <div className="max-w-xl">
            <h2 className="text-display-md text-[#F4F1E8]">
              They learn to ask AI why, not for the answer.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-[#8FB7A4] md:text-xl">
              Your students will use AI for the rest of their lives. Veradic is
              where they learn to use it well: to get unstuck and understand,
              not to skip the thinking.
            </p>
            <ul className="mt-8 space-y-3 border-t border-[#1C4030] pt-6">
              {PROMISES.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] leading-relaxed text-[#C9DDD2]">
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-[5px] h-3.5 w-3.5 shrink-0 text-[#7FC4A0]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5l3 3 7-7" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 xl:justify-self-end">
            <CuriosityChat />
          </div>
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
    <Section variant="default" id="trust">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
        <div className="max-w-sm">
          <h2 className="text-display-sm text-[color:var(--color-text)]">Safe for your students.</h2>
          <Link
            href="/trust"
            className="mt-4 inline-block text-[15px] font-semibold text-[color:var(--color-primary)] underline-offset-4 hover:underline"
          >
            How we protect student data
          </Link>
        </div>
        <dl className="grid flex-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:max-w-2xl">
          {TRUST.map((t) => (
            <div key={t.title}>
              <dt className="text-[15px] font-semibold text-[color:var(--color-text)]">{t.title}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-[color:var(--color-text-secondary)]">{t.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
