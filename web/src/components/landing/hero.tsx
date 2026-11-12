import { ButtonLink } from "@/components/site/button-link";

/**
 * The hero: the argument on the left, a student's homework page on the
 * right. The page is the whole idea of the design: real handwritten work,
 * the teacher's red pen on it, and a green note where Veradic asked the
 * student to explain a step.
 *
 * The student is Jordan, not Maya: Maya is the student in the
 * understanding-check demo further down, who can't explain this same
 * problem. Two students, one homework, two outcomes.
 *
 * Static on purpose. The understanding check and the homework flow below
 * carry the page's motion.
 */
export function Hero() {
  return (
    <section className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-[72px] gap-y-14 px-4 pb-20 pt-12 md:px-8 md:pb-[104px] md:pt-[72px]">
      <div className="min-w-0 flex-[1.15_1_480px]">
        <h1 className="site-h1">
          Your students already have AI. Give them one that&rsquo;s on your side.
        </h1>
        <p className="mt-7 max-w-[31em] text-lg leading-[1.55] text-ink-soft md:text-xl">
          Veradic checks who really understands their homework, grades it by
          your rules, and gives every student more practice on the problems
          they missed. You approve every grade.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <ButtonLink href="/demo">Book a 20-minute demo</ButtonLink>
          <ButtonLink href="#integrity" variant="underline">
            Watch a homework get checked
          </ButtonLink>
        </div>
      </div>

      <div className="min-w-0 flex-[1_1_460px] py-3 sm:pb-[84px]">
        {/* Capped so the note overlaps the page by the same amount at
            every width, instead of drifting off to the column's edge. */}
        <div className="relative max-w-[640px]">
          <HomeworkPage />
          <VeradicNote />
        </div>
      </div>
    </section>
  );
}

/** One line of handwriting on the ruled sheet. */
function Line({ children, indent = false, small = false }: { children: React.ReactNode; indent?: boolean; small?: boolean }) {
  return (
    <p
      className={`m-0 font-hand leading-[34px] ${small ? "text-[17px] text-ink-soft" : "text-[22px] text-pencil sm:text-[25px]"} ${indent ? "pl-7 sm:pl-9" : ""}`}
    >
      {children}
    </p>
  );
}

function HomeworkPage() {
  return (
    <figure
      className="ruled-paper relative m-0 max-w-[470px] -rotate-[1.2deg] rounded-[4px] py-[26px] pl-[60px] pr-5 shadow-[0_2px_0_rgba(0,0,0,0.04),0_30px_60px_-30px_rgba(29,38,51,0.45)] sm:pl-[74px] sm:pr-[30px]"
    >
      {/* The red margin line. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-[44px] w-[2px] bg-margin-line sm:left-[56px]" />
      <figcaption className="sr-only">
        Jordan&rsquo;s Algebra II homework. Problem 4 is circled correct. On
        problem 5 the teacher&rsquo;s pen takes off a point: distribute the 2.
      </figcaption>
      <div aria-hidden="true">
        <Line small>Jordan P. &mdash; Alg II, HW 5.2</Line>
        <Line>4)&nbsp; 3x + 7 = 22</Line>
        <Line indent>3x = 15</Line>
        <Line indent>
          {/* The teacher's circle: slightly uneven, as a pen draws it. */}
          <span className="rounded-[50%_45%_50%_48%] border-[2.5px] border-redpen px-2.5">x = 5</span>
        </Line>
        <Line>5)&nbsp; 2(x &minus; 4) = 10</Line>
        <Line indent>2x &minus; 4 = 10</Line>
        <Line indent>
          x = 7{" "}
          <span className="ml-3 text-[19px] font-bold text-redpen sm:ml-[18px] sm:text-[22px]">&minus;1 distribute the 2</span>
        </Line>
        {/* Two blank lines, as a real page has: the space Veradic's note
            sits over on wide screens, so it never covers the work. */}
        <Line>&nbsp;</Line>
        <Line>&nbsp;</Line>
      </div>
    </figure>
  );
}

/**
 * Veradic's note, laid over the blank lines at the foot of the page, so it
 * never covers the work it is about. In the flow (pulled up) on phones,
 * pinned to the page's corner from sm up.
 */
function VeradicNote() {
  return (
    <aside
      aria-label="Veradic's question to Jordan"
      className="on-dark relative ml-auto mt-[-64px] w-[252px] max-w-full rounded-[10px] bg-veradic px-4 py-3.5 text-[#F2F7F4] shadow-[0_18px_40px_-18px_rgba(14,82,56,0.7)] sm:absolute sm:-bottom-[72px] sm:right-0 sm:mt-0"
    >
      <p className="m-0 text-xs font-bold text-veradic-tint">Veradic asked Jordan</p>
      <p className="m-0 mt-1.5 text-[15px] leading-[1.4]">x = 5 is right. How did you get from 22 to 15?</p>
      <p className="m-0 mt-2.5 font-hand text-[19px] leading-[1.25] text-white">took 7 off both sides</p>
      <p className="m-0 mt-2.5 text-[12.5px] font-bold text-veradic-tint">Explained it. Grade drafted for you.</p>
    </aside>
  );
}
