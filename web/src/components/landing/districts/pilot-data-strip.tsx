import { Section } from "../section";

/**
 * The "honesty move" — a single editorial note where outcome data
 * will eventually live, signed and dated. Most ed-tech vendors fake
 * this; we'd rather show nothing real than show fabricated numbers.
 *
 * When real pilot data lands (hours saved, integrity-flag rate,
 * outcome lift), this component gets replaced with the data strip.
 * The placeholder itself is a credibility asset until then.
 */
export function PilotDataStrip() {
  return (
    <Section variant="alt" id="pilot-data">
      <div className="mx-auto max-w-3xl rounded-[--radius-lg] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] px-10 py-12 text-center md:px-14">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[color:var(--color-primary)]">
          Editorial note · Pilot data
        </p>
        <h2 className="mt-5 text-display-sm text-[color:var(--color-text)]">
          Real pilot data coming Fall 2026.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[color:var(--color-text-secondary)] md:text-lg">
          We&rsquo;re running pilots with select classrooms now. We&rsquo;ll
          publish hours-saved, integrity-flag rate, and student-outcome
          data here as it lands — with sources, sample sizes, and the
          districts who let us name them.
        </p>
        <p className="mx-auto mt-6 max-w-xl text-sm italic leading-relaxed text-[color:var(--color-text-muted)]">
          We&rsquo;d rather show you nothing than show you fabricated
          numbers.
        </p>
      </div>
    </Section>
  );
}
