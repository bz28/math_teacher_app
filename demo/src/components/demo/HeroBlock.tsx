import type { ReactNode } from "react";
import type { Hero } from "../../lib/integrity-set";

// The opening value-prop. Calm, editorial, premium — big serif headline,
// the pain/promise named in the subhead, an optional three-beat of what it
// does, and a soft scroll cue into the walkthrough.
//
// On wide screens the hero splits two-up: the lede on the left and a product
// peek on the right. The peek is either a caller-supplied `aside` (the front
// door passes the live roster panel) or the story's own illustrative
// `hero.peek` card — so the opening frame reads like a real working product
// instead of blank paper. Without either, the lede falls back to a single
// column.

export default function HeroBlock({
  hero,
  aside,
}: {
  hero: Hero;
  aside?: ReactNode;
}) {
  const hasAside = Boolean(aside) || Boolean(hero.peek);

  return (
    <header className={hasAside ? "it-hero it-hero--split" : "it-hero"}>
      <div className="it-hero-lede">
        <span className="it-hero-eyebrow">{hero.eyebrow}</span>
        <h1 className="it-hero-headline">{hero.headline}</h1>
        <p className="it-hero-subhead">{hero.subhead}</p>

        {hero.triplet && hero.triplet.length > 0 && (
          <ul className="it-hero-triplet" aria-label="What it does">
            {hero.triplet.map((t, i) => (
              <li key={t}>
                {i > 0 && (
                  <span className="it-hero-triplet-sep" aria-hidden="true" />
                )}
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}

        <a className="it-hero-cue" href="#flow">
          {hero.cue}
          <span className="it-hero-cue-arrow" aria-hidden="true">
            ↓
          </span>
        </a>
      </div>

      {aside ? (
        aside
      ) : hero.peek ? (
        <aside className="it-hero-peek" aria-label="Illustrative product preview">
          <div className="it-hero-peek-head">
            <span className="it-hero-peek-label">{hero.peek.label}</span>
            <span className={`it-hero-peek-status ${hero.peek.status.tone}`}>
              {hero.peek.status.text}
            </span>
          </div>
          <div className="it-hero-peek-rows">
            {hero.peek.rows.map((row) => (
              <div className="it-hero-peek-row" key={row.k}>
                <span className="it-hero-peek-k">{row.k}</span>
                <span className={`it-hero-peek-v ${row.tone ?? ""}`}>
                  {row.v}
                </span>
              </div>
            ))}
          </div>
          <p className="it-hero-peek-foot">{hero.peek.foot}</p>
        </aside>
      ) : null}
    </header>
  );
}
