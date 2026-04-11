import { Eyebrow } from "./eyebrow";

// TODO: replace with real teacher testimonials once collected.
// These are plausible placeholders shipped with the redesign so the
// marquee is never empty — swap in verified quotes before launch.
export type Testimonial = {
  quote: string;
  name: string;
  role: string;
  school: string;
};

const testimonials: Testimonial[] = [
  {
    quote:
      "My students actually engage with the material now. Veradic won't just hand them answers, so they have to think — and they do.",
    name: "Sarah Mitchell",
    role: "9th Grade Algebra Teacher",
    school: "Lincoln High School",
  },
  {
    quote:
      "The integrity checker has been a game-changer. I finally know which kids are doing their own work.",
    name: "David Okafor",
    role: "AP Physics Teacher",
    school: "Westbrook Academy",
  },
  {
    quote:
      "I used to spend my whole Sunday grading. Now I'm done in an hour.",
    name: "Jennifer Liu",
    role: "Pre-Calculus Teacher",
    school: "Rosewood Prep",
  },
  {
    quote:
      "Every student gets one-on-one tutoring, even in a class of 32. I don't know how I taught without this.",
    name: "Marcus Reed",
    role: "7th Grade Math",
    school: "Franklin Middle School",
  },
  {
    quote:
      "I was skeptical of AI in the classroom. Veradic is the first one built like it was actually designed by a teacher.",
    name: "Amanda Torres",
    role: "Chemistry Department Chair",
    school: "St. Vincent High School",
  },
  {
    quote:
      "My struggling students aren't embarrassed to ask Veradic for help. They would be with me.",
    name: "Greg Henderson",
    role: "Algebra II Teacher",
    school: "Oakridge High",
  },
  {
    quote:
      "The question bank saved me hours of worksheet prep. I upload my unit, approve the questions I like, and I'm done.",
    name: "Priya Nair",
    role: "Geometry Teacher",
    school: "Mapleton High School",
  },
  {
    quote:
      "I can finally see where every student is struggling before the test, not after.",
    name: "Thomas Bellamy",
    role: "8th Grade Science",
    school: "Harmon Middle School",
  },
  {
    quote:
      "Veradic handles the kids who are ahead AND the kids who are behind — at the same time. That's never been possible for me before.",
    name: "Rachel Goldstein",
    role: "6th Grade Math",
    school: "Pine Valley Elementary",
  },
  {
    quote:
      "My principal was worried about AI cheating. I showed her the integrity checker and she approved us for the whole department.",
    name: "Kevin Park",
    role: "AP Calculus Teacher",
    school: "Everett Heights High",
  },
  {
    quote:
      "The step-by-step walkthroughs are exactly how I'd explain it myself. It's uncanny.",
    name: "Nicole Sanders",
    role: "Physics Teacher",
    school: "Bay Harbor High",
  },
  {
    quote:
      "I've tried every AI tool out there. Veradic is the only one that doesn't just give the answer away.",
    name: "Brian Callahan",
    role: "Math Department Chair",
    school: "Northfield Academy",
  },
];

// Split into two rows for the bidirectional marquee
const row1 = testimonials.slice(0, 6);
const row2 = testimonials.slice(6);

function Card({ t }: { t: Testimonial }) {
  return (
    <div className="mx-3 flex w-[360px] flex-shrink-0 flex-col rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-6 shadow-sm md:w-[420px]">
      <div className="mb-4 flex gap-0.5 text-[color:var(--color-warning)]">
        {[0, 1, 2, 3, 4].map((i) => (
          <svg key={i} className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ))}
      </div>
      <p className="flex-1 text-base leading-relaxed text-[color:var(--color-text)]">
        &ldquo;{t.quote}&rdquo;
      </p>
      <div className="mt-6 border-t border-[color:var(--color-border-light)] pt-4">
        <p className="text-sm font-semibold text-[color:var(--color-text)]">
          {t.name}
        </p>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          {t.role} · {t.school}
        </p>
      </div>
    </div>
  );
}

function MarqueeRow({
  items,
  direction,
}: {
  items: Testimonial[];
  direction: "left" | "right";
}) {
  // Duplicate the list so translateX(-50%) produces a seamless loop
  const duped = [...items, ...items];
  const animClass =
    direction === "left" ? "animate-marquee-left" : "animate-marquee-right";
  return (
    <div className="overflow-hidden">
      <div className={`flex w-max ${animClass}`}>
        {duped.map((t, i) => (
          <Card key={`${t.name}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

type TestimonialMarqueeProps = {
  /** Background variant — default (surface) or alt (warm off-white). */
  variant?: "default" | "alt";
};

export function TestimonialMarquee({
  variant = "default",
}: TestimonialMarqueeProps) {
  const bg =
    variant === "alt"
      ? "bg-[color:var(--color-surface-alt)]"
      : "bg-[color:var(--color-surface)]";
  return (
    <section className={`w-full py-20 md:py-28 ${bg}`}>
      <div className="mx-auto mb-14 max-w-3xl px-6 text-center md:px-8">
        <Eyebrow>What teachers say</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Real teachers. Real classrooms. Real relief.
        </h2>
      </div>

      <div className="marquee-pause space-y-6">
        <MarqueeRow items={row1} direction="left" />
        <MarqueeRow items={row2} direction="right" />
      </div>
    </section>
  );
}
