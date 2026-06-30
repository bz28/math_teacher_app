import type { Hero } from "../../lib/integrity-set";

// The opening value-prop. Calm, editorial, premium — big serif headline,
// the teacher's pain named in the subhead, a three-beat of what it does,
// and a soft scroll cue into the walkthrough.

export default function HeroBlock({ hero }: { hero: Hero }) {
  return (
    <header className="it-hero">
      <span className="it-hero-eyebrow">{hero.eyebrow}</span>
      <h1 className="it-hero-headline">{hero.headline}</h1>
      <p className="it-hero-subhead">{hero.subhead}</p>

      <ul className="it-hero-triplet" aria-label="What it does">
        {hero.triplet.map((t, i) => (
          <li key={t}>
            {i > 0 && <span className="it-hero-triplet-sep" aria-hidden="true" />}
            <span>{t}</span>
          </li>
        ))}
      </ul>

      <a className="it-hero-cue" href="#flow">
        {hero.cue}
        <span className="it-hero-cue-arrow" aria-hidden="true">
          ↓
        </span>
      </a>
    </header>
  );
}
