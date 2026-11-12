import { Section } from "./section";

/**
 * Grading by the teacher's own rules — the class rubric (PRs #935–#937).
 * A teacher writes grading rules once per class; every homework inherits
 * them; each point the AI takes off says which rule it came from, or that
 * it was Veradic's own judgment; nothing reaches a student until the
 * teacher approves.
 *
 * Mirror of the integrity section: demo LEFT, argument RIGHT, so the page
 * alternates sides instead of stacking centred columns. The demo is static
 * on purpose — the integrity interview and the homework flow carry the
 * page's motion; this card just has to be legible at a glance.
 *
 * The one visual device here carries information: the rule that was
 * applied is marked in the rules list with the same green tag the
 * deduction wears, so the eye can follow a lost point back to the rule.
 */

type Rule = { text: string; points: number; applied: boolean };

const RULES: Rule[] = [
  { text: "Name the theorem you used.", points: 1, applied: true },
  { text: "Final answers need units.", points: 1, applied: false },
  { text: "Show work for full credit.", points: 2, applied: false },
];

type Deduction = { points: number; reason: string; source: "rule" | "judgment" };

const DEDUCTIONS: Deduction[] = [
  { points: 1, reason: "Name the theorem you used.", source: "rule" },
  { points: 1, reason: "Arithmetic slip: 3k is 27, not 9.", source: "judgment" },
];

const CARD = {
  background: "#FFFFFF",
  borderRadius: 18,
  boxShadow: "0 36px 90px -40px rgba(0,0,0,0.5)",
  border: "1px solid #ECE7DA",
} as const;

function SourceTag({ source }: { source: Deduction["source"] }) {
  return source === "rule" ? (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[#E6F0EA] px-2 py-0.5 text-[11.5px] font-semibold text-[#0E5238]">
      Class rule
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[#F2EFE8] px-2 py-0.5 text-[11.5px] font-semibold text-[#5C554C]">
      Veradic&rsquo;s judgment
    </span>
  );
}

function GradingDemo() {
  return (
    <div className="w-full max-w-[600px]" aria-label="Example: a class's grading rules and a draft grade that follows them" role="img">
      {/* The class's rules — written once, inherited by every homework. */}
      <div style={CARD} className="p-5 sm:p-6">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <p className="text-[15px] font-semibold text-[#23201A]">Class rules</p>
          <p className="text-[12.5px] text-[#7D7669]">Applies to every Geometry homework</p>
        </div>
        <ul className="mt-4 space-y-2">
          {RULES.map((r) => (
            <li
              key={r.text}
              className={`flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-[14px] ${
                r.applied ? "border-[#C8DCCF] bg-[#EFF4F0] text-[#0E3A28]" : "border-[#E4DFD2] bg-[#FBF9F3] text-[#23201A]"
              }`}
            >
              <span>{r.text}</span>
              <span className={`shrink-0 text-[12.5px] font-semibold ${r.applied ? "text-[#0E5238]" : "text-[#7D7669]"}`}>
                &minus;{r.points} pt
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* One draft grade made under those rules, waiting for the teacher. */}
      <div style={CARD} className="relative mt-4 p-5 sm:ml-10 sm:p-6">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[15px] font-semibold text-[#23201A]">
            Maya R.<span className="ml-2 font-normal text-[#7D7669]">Problem 3</span>
          </p>
          <p className="text-[15px] font-semibold text-[#23201A]">
            8<span className="text-[#7D7669]">/10</span>
          </p>
        </div>
        <p className="mt-1 text-[12.5px] text-[#7D7669]">Draft. Maya can&rsquo;t see it until you approve.</p>

        <ul className="mt-4 space-y-2.5">
          {DEDUCTIONS.map((d) => (
            <li key={d.reason} className="flex items-start gap-3 text-[14px] leading-snug text-[#23201A]">
              <span className="w-8 shrink-0 font-semibold text-[#8A2317]">&minus;{d.points}</span>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <span>{d.reason}</span>
                <SourceTag source={d.source} />
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="rounded-full border border-[#E4DFD2] px-4 py-1.5 text-[13px] font-semibold text-[#5C554C]">Edit</span>
          <span className="rounded-full bg-[#0E5238] px-4 py-1.5 text-[13px] font-semibold text-white">Approve</span>
        </div>
      </div>
    </div>
  );
}

export function HomeGrading() {
  return (
    <Section variant="alt" id="grading">
      <div className="grid items-center gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:gap-16">
        <div className="order-2 min-w-0 xl:order-1">
          <GradingDemo />
        </div>
        <div className="order-1 max-w-xl xl:order-2">
          <h2 className="text-display-md text-[color:var(--color-text)]">
            Graded by your rules, not the AI&rsquo;s.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
            Write your grading rules once for the class &mdash; &ldquo;name the
            theorem,&rdquo; &ldquo;units on final answers.&rdquo; Every homework
            follows them, and you can skip a rule for one assignment.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
            Each point Veradic takes off says why, and whether it came from your
            rule or its own judgment. Nothing reaches a student until you
            approve it.
          </p>
        </div>
      </div>
    </Section>
  );
}
