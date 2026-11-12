import type { ReactNode } from "react";
import { subjectBreadcrumbJsonLd, subjectEducationalProgramJsonLd } from "@/lib/seo";
import { ButtonLink } from "@/components/site/button-link";
import { InkCtaBand } from "@/components/site/ink-cta-band";

/**
 * A subject page (math, physics, chemistry) in the notebook design.
 *
 * Hero: the argument on the left; on the right, a student's handwritten
 * homework with one typical mistake circled in red pen, and Veradic's
 * green question about that step. Then the four things that happen to one
 * homework problem, the courses, a short FAQ, and the dark ask.
 *
 * Every claim here is the same claim the homepage makes (understanding
 * check, grading by the class's rules, teacher approval, ungraded practice
 * from approved problems), so the subject pages never promise more than
 * the product does. Physics and chemistry are less complete than math
 * (docs/product/overview.md), and their pages say so in the FAQ.
 *
 * Static on purpose: no motion, so nothing to reduce.
 */

export interface SubjectFaq {
  q: string;
  a: string;
}

export interface SubjectPageProps {
  name: "Math" | "Physics" | "Chemistry";
  slug: "math" | "physics" | "chemistry";
  /** Plain green line above the headline, e.g. the course range. */
  kicker: string;
  headline: string;
  intro: string;
  /** The homework sheet in the hero. */
  sheet: {
    /** The printed problem, in the page's own type. */
    prompt: string;
    /** Handwritten lines, top to bottom. */
    lines: ReactNode[];
    /** Index into `lines` of the line circled in red. */
    circled: number;
    /** What a screen reader hears in place of the handwriting. */
    description: string;
  };
  /** Veradic's question about the circled line. */
  question: string;
  courses: string[];
  /** One short line under the course list (e.g. topics covered). */
  coursesNote?: string;
  faqs: SubjectFaq[];
  /** EducationalOccupationalProgram JSON-LD description. */
  programDescription: string;
}

const STEPS = [
  {
    title: "The student photographs it",
    body: "Handwriting, crossed-out lines and all. Veradic reads each step.",
  },
  {
    title: "Veradic asks about their steps",
    body: "A short check on their own work. Right answers they can’t explain are flagged for you to look at.",
  },
  {
    title: "You approve the grade",
    body: "Drafted by your class rules. Each point off names the rule, or says it was Veradic’s judgment.",
  },
  {
    title: "They practice new versions of it",
    body: "More problems like the ones they missed, only from the ones you approved. Ungraded.",
  },
];

export function SubjectPage(props: SubjectPageProps) {
  const { name, slug, programDescription } = props;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(subjectBreadcrumbJsonLd(name, slug)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(subjectEducationalProgramJsonLd(name, slug, programDescription)),
        }}
      />
      <Hero {...props} />
      <OneProblem />
      <Courses name={name} courses={props.courses} note={props.coursesNote} />
      <Faq name={name} faqs={props.faqs} />
      <InkCtaBand
        headline="Bring one class. Bring your own chapter."
        subhead="On a 20-minute call we run Veradic on a chapter you’re teaching."
        primaryLabel="Book a 20-minute demo"
        primaryHref="/demo"
      />
    </>
  );
}

function Hero({ kicker, headline, intro, sheet, question }: SubjectPageProps) {
  return (
    <section className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-[72px] gap-y-14 px-4 pb-20 pt-12 md:px-8 md:pb-[104px] md:pt-[64px]">
      <div className="min-w-0 flex-[1.1_1_460px]">
        <p className="m-0 mb-[18px] text-base font-bold text-veradic">{kicker}</p>
        <h1 className="site-h1">{headline}</h1>
        <p className="mt-7 max-w-[32em] text-lg leading-[1.55] text-ink-soft md:text-xl">{intro}</p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <ButtonLink href="/demo">Book a 20-minute demo</ButtonLink>
          <ButtonLink href="#one-problem" variant="underline">
            What happens to one problem
          </ButtonLink>
        </div>
      </div>

      <div className="min-w-0 flex-[1_1_440px] py-3 sm:pb-[64px]">
        {/* Capped so the note overlaps the sheet by the same amount at
            every width. */}
        <div className="relative max-w-[560px]">
          <HomeworkSheet {...sheet} />
          <VeradicNote question={question} line={sheet.circled + 1} />
        </div>
      </div>
    </section>
  );
}

function HomeworkSheet({ prompt, lines, circled, description }: SubjectPageProps["sheet"]) {
  return (
    <figure className="ruled-paper relative m-0 max-w-[470px] -rotate-1 rounded-[4px] py-[22px] pl-[60px] pr-5 shadow-[0_2px_0_rgba(0,0,0,0.04),0_30px_60px_-30px_rgba(29,38,51,0.45)] sm:pl-[72px] sm:pr-7">
      {/* The red margin line. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-[44px] w-[2px] bg-margin-line sm:left-[54px]" />
      <figcaption className="sr-only">{description}</figcaption>
      <div aria-hidden="true">
        <p className="m-0 text-[15px] font-extrabold leading-[34px]">{prompt}</p>
        {lines.map((line, i) => (
          <p key={i} className="m-0 font-hand text-[21px] leading-[34px] text-pencil sm:text-[24px]">
            {i === circled ? (
              // The teacher's circle: slightly uneven, as a pen draws it.
              <span className="rounded-[50%_45%_50%_48%] border-[2.5px] border-redpen px-2">{line}</span>
            ) : (
              line
            )}
          </p>
        ))}
        {/* Blank lines, as a real page has: the space Veradic's note sits
            over on wide screens, so it never covers the work. */}
        <p className="m-0 leading-[34px]">&nbsp;</p>
        <p className="m-0 leading-[34px]">&nbsp;</p>
      </div>
    </figure>
  );
}

/** Veradic's question, in the flow on phones, pinned to the sheet's corner from sm up. */
function VeradicNote({ question, line }: { question: string; line: number }) {
  return (
    <aside
      aria-label="Veradic’s question to the student"
      className="on-dark relative ml-auto mt-[-56px] w-[270px] max-w-full rounded-[10px] bg-veradic px-[18px] py-4 text-[#F2F7F4] shadow-[0_18px_40px_-18px_rgba(14,82,56,0.7)] sm:absolute sm:-bottom-[40px] sm:right-0 sm:mt-0"
    >
      <p className="m-0 text-[13px] font-bold text-veradic-tint">Veradic, on line {line}</p>
      <p className="m-0 mt-1.5 text-[15.5px] leading-[1.45]">{question}</p>
    </aside>
  );
}

function OneProblem() {
  return (
    <section id="one-problem" className="scroll-mt-20 border-y border-hairline bg-white md:scroll-mt-24">
      <div className="mx-auto max-w-[1200px] px-4 py-20 md:px-8 md:py-24">
        <h2 className="site-h2 max-w-[760px]">What happens to one homework problem.</h2>
        <ol className="m-0 mt-12 grid list-none grid-cols-1 gap-9 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t-2 border-ink pt-[18px]">
              {/* The number in red pen. */}
              <span aria-hidden="true" className="block font-hand text-[34px] leading-none text-redpen">
                {i + 1}
              </span>
              <h3 className="m-0 mt-3 text-xl font-extrabold">{s.title}</h3>
              <p className="m-0 mt-2 text-base leading-relaxed text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Courses({ name, courses, note }: { name: string; courses: string[]; note?: string }) {
  return (
    <section className="mx-auto flex max-w-[1200px] flex-wrap gap-x-[72px] gap-y-10 px-4 py-20 md:px-8 md:py-24">
      <div className="min-w-0 flex-[1_1_360px]">
        <h2 className="site-h2">The courses you teach.</h2>
        <p className="m-0 mt-5 text-lg leading-relaxed text-ink-soft md:text-[19px] md:leading-[1.6]">
          Bring your own chapter. Veradic writes problems with worked
          solutions, checks them, and shows them to you before any student
          does.
        </p>
      </div>
      <div className="min-w-0 flex-[1_1_520px]">
        <ul aria-label={`${name} courses`} className="m-0 flex list-none flex-wrap gap-2.5 p-0">
          {courses.map((c) => (
            <li
              key={c}
              className="rounded-[6px] border-[1.5px] border-ink bg-white px-[18px] py-3 text-[17px] font-bold"
            >
              {c}
            </li>
          ))}
        </ul>
        {note && <p className="m-0 mt-5 text-base leading-relaxed text-ink-soft">{note}</p>}
      </div>
    </section>
  );
}

function Faq({ name, faqs }: { name: string; faqs: SubjectFaq[] }) {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-20 md:px-8 md:pb-24">
      <h2 className="site-h2 [font-size:clamp(1.75rem,2.8vw,2.25rem)]">
        Questions {name.toLowerCase()} teachers ask
      </h2>
      <dl className="m-0 mt-7 max-w-[860px] border-t-2 border-ink">
        {faqs.map((f) => (
          <div key={f.q} className="border-b border-rule py-[22px]">
            <dt className="text-lg font-extrabold">{f.q}</dt>
            <dd className="m-0 mt-2 text-[16.5px] leading-relaxed text-ink-soft">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
