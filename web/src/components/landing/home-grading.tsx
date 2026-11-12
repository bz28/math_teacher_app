/**
 * Grading by the teacher's own rules — the class rubric (PRs #935–#937).
 * A teacher writes grading rules once per class; every homework inherits
 * them; each point the AI takes off says which rule it came from, or that
 * it was Veradic's own judgment; nothing reaches a student until the
 * teacher approves.
 *
 * Two objects side by side: the teacher's rules, written in red pen on an
 * index card, and the draft grade Veradic made from them. The draft follows
 * Jordan's homework from the hero: the "distribute the 2" mark there is the
 * first deduction here. The second deduction is Veradic's judgment, so the
 * card shows both sources a lost point can have.
 */

const RULES = [
  "Show the distribution — 1 pt",
  "Units on final answers — 1 pt",
  "Name the theorem — 1 pt",
];

type Deduction = { points: number; reason: string; source: string | null };

// `source` is the class rule a point came from, or null for Veradic's own
// judgment.
const DEDUCTIONS: Deduction[] = [
  { points: 1, reason: "Problem 5: distributed the 2 to x only.", source: "Show the distribution" },
  { points: 1, reason: "Problem 7: arithmetic slip, 4 × 6 is 24, not 18.", source: null },
];

function RulesCard() {
  return (
    <div className="min-w-0 flex-[1_1_240px] rotate-[0.8deg] rounded-[3px] border border-[#E8E2CF] border-t-[3px] border-t-margin-line bg-[#FFFDF6] bg-[linear-gradient(transparent_31px,#D6E4EE_31px,#D6E4EE_32px,transparent_32px)] bg-[length:100%_32px] px-[18px] pb-[18px] pt-3.5">
      <p className="m-0 text-[13px] font-extrabold leading-8">Ms. Rivera&rsquo;s rules</p>
      <ul className="m-0 list-none p-0">
        {RULES.map((r) => (
          <li key={r} className="font-hand text-[19px] leading-8 text-redpen">
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DraftGrade() {
  return (
    <div className="min-w-0 flex-[1_1_260px] rounded-[10px] border border-hairline bg-paper p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-extrabold">Jordan P. &mdash; HW 5.2</span>
        <span className="text-[22px] font-black">8/10</span>
      </div>
      <p className="m-0 mt-1 text-[13px] text-ink-soft">Draft. Jordan can&rsquo;t see it until you approve.</p>
      <ul className="m-0 mt-3.5 list-none space-y-3 p-0">
        {DEDUCTIONS.map((d) => (
          <li key={d.reason}>
            <p className="m-0 text-[14.5px] leading-[1.45]">
              <b className="text-redpen">&minus;{d.points}</b> {d.reason}
            </p>
            <p className={`m-0 mt-1 text-[12.5px] font-bold ${d.source ? "text-veradic" : "text-ink-soft"}`}>
              {d.source ? `From your rule: ${d.source}` : "Veradic’s judgment"}
            </p>
          </li>
        ))}
      </ul>
      {/* Pictures of the review buttons, not controls: this is an example. */}
      <div aria-hidden="true" className="mt-[18px] flex justify-end gap-2">
        <span className="rounded-[6px] border border-[#C9C3B3] px-3.5 py-2 text-sm font-bold">Edit</span>
        <span className="rounded-[6px] bg-veradic px-3.5 py-2 text-sm font-bold text-white">Approve</span>
      </div>
    </div>
  );
}

export function HomeGrading() {
  return (
    <section id="grading" className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-x-[72px] gap-y-12 px-4 py-20 md:px-8 md:py-[104px]">
      <div className="min-w-0 flex-[1_1_380px]">
        <h2 className="site-h2">Graded by your rules.</h2>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft md:text-[19px] md:leading-[1.6]">
          Write your grading rules once for the class &mdash; &ldquo;name the
          theorem,&rdquo; &ldquo;units on final answers.&rdquo; Every homework
          follows them, and you can skip a rule for one assignment.
        </p>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft md:text-[19px] md:leading-[1.6]">
          Each point Veradic takes off says why, and whether it came from your
          rule or its own judgment. Nothing reaches a student until you
          approve it.
        </p>
      </div>
      <div
        role="img"
        aria-label="Example: a teacher's three grading rules, and a draft grade of 8 out of 10. One point lost under the rule 'show the distribution', one for an arithmetic slip, marked as Veradic's judgment. It waits for the teacher to approve."
        className="flex min-w-0 flex-[1_1_520px] flex-wrap gap-5"
      >
        <RulesCard />
        <DraftGrade />
      </div>
    </section>
  );
}
