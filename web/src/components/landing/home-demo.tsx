import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

export function HomeDemo() {
  return (
    <Section variant="invert">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow variant="invert">Try it yourself</Eyebrow>
        <h2 className="mt-6 text-display-lg text-[color:var(--color-invert-text)]">
          Watch Veradic solve a real problem.
        </h2>
        <p className="mt-6 text-xl font-medium leading-snug text-[color:var(--color-invert-text-muted)] md:text-2xl">
          No glossy demo video. This is Veradic working through an actual
          problem the same way it works with your students — one guided step
          at a time.
        </p>
      </div>

      {/* TODO: replace with real animated LLM output — walk through one problem step by step
          Needed: one genuine Veradic decomposition per subject (math / physics / chemistry),
          pick the most impressive one for the homepage demo. */}
      <div className="mt-16 overflow-hidden rounded-3xl border border-white/10 bg-[color:var(--color-invert-alt)]">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
          <div className="flex gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400/60" />
            <span className="h-3 w-3 rounded-full bg-yellow-400/60" />
            <span className="h-3 w-3 rounded-full bg-green-400/60" />
          </div>
          <span className="ml-2 text-xs font-mono text-white/40">
            veradicai.com / learn
          </span>
        </div>
        <div className="grid gap-6 p-8 md:grid-cols-[1fr_1.4fr] md:gap-10 md:p-12">
          {/* Left — "problem" */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/40">
              Problem
            </p>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-5 text-base leading-relaxed text-white/90">
              A ball is thrown straight up with an initial velocity of 20 m/s.
              How long until it reaches its highest point?
            </div>
            <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-white/40">
              What a chatbot does
            </p>
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/5 p-5 text-sm leading-relaxed text-white/70">
              <span className="font-mono text-red-300">
                t = v&#8320;/g = 20/9.8 ≈ 2.04 s
              </span>
              <br />
              <span className="text-white/40">
                (Student copies the answer. Learns nothing.)
              </span>
            </div>
          </div>

          {/* Right — veradic walkthrough */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--color-primary-light)]">
              What Veradic does
            </p>
            <div className="mt-3 space-y-4">
              <StepCard
                index={1}
                label="Start with what you know"
                body="What information does the problem give you? Take a second and write it down before we do anything with it."
              />
              <StepCard
                index={2}
                label="What changes at the highest point?"
                body="Think about what the ball's velocity is at the exact moment it stops going up and starts coming down."
              />
              <StepCard
                index={3}
                label="Pick the equation"
                body="Which kinematic equation connects initial velocity, final velocity, acceleration, and time?"
              />
              <StepCard
                index={4}
                label="Solve it yourself"
                body="You've got v, v&#8320;, and a. Plug them in and solve for t. I'll check your work when you're ready."
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function StepCard({
  index,
  label,
  body,
}: {
  index: number;
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/20 text-xs font-bold text-[color:var(--color-primary-light)]">
          {index}
        </span>
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p
            className="mt-1 text-sm leading-relaxed text-white/70"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        </div>
      </div>
    </div>
  );
}
