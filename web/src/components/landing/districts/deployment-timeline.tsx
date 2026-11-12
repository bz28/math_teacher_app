type Step = { title: string; desc: string };

const STEPS: Step[] = [
  {
    title: "We create your school account.",
    desc: "We handle the initial setup. You give us your school name and the teachers who'll be invited.",
  },
  {
    title: "Teachers receive invites.",
    desc: "Each teacher gets a single email and a 5-minute setup. They organize their courses and sections.",
  },
  {
    title: "Students join with a 6-character code.",
    desc: "No student emails required. No district SSO integration required. Teachers share a code, students enter it.",
  },
  {
    title: "The first homework goes out.",
    desc: "Most teachers send their first checked assignment within a week, some the same day.",
  },
  {
    title: "Pilot a single classroom first, if you like.",
    desc: "Run with one teacher, one class. See the data, sign the paperwork, then expand on your timeline.",
  },
];

/**
 * How a district goes live: the argument on the left, the steps on the
 * right, numbered in the teacher's red pen like a worked list.
 */
export function DeploymentTimeline() {
  return (
    <section
      id="deployment"
      className="mx-auto flex max-w-[1200px] flex-wrap gap-x-[72px] gap-y-10 px-4 py-20 md:px-8 md:py-24"
    >
      <div className="min-w-0 flex-[1_1_360px]">
        <h2 className="site-h2">Live with students in a week.</h2>
        <p className="m-0 mt-5 text-lg leading-[1.6] text-ink-soft md:text-[19px]">
          No SSO project. No PII spreadsheet. No IT ticket.
        </p>
      </div>
      <ol className="m-0 flex min-w-0 flex-[1_1_520px] list-none flex-col gap-6 p-0">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex items-baseline gap-5">
            <span aria-hidden="true" className="w-[30px] flex-none font-hand text-[34px] leading-none text-redpen">
              {i + 1}
            </span>
            <p className="m-0 text-lg leading-[1.5]">
              <b className="font-extrabold">{step.title}</b>{" "}
              <span className="text-ink-soft">{step.desc}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
