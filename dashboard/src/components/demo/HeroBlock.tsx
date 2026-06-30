import type { Hero } from "../../lib/integrity-set";

// The opening value-prop. Calm, editorial, premium — big serif headline,
// the teacher's pain named in the subhead, a three-beat of what it does,
// and a soft scroll cue into the walkthrough.
//
// On wide screens the hero splits two-up: the lede on the left and an
// illustrative product peek on the right (hero.peek) so the opening frame
// reads like a real working product instead of blank paper. The peek is
// optional and shared across every story for one consistent opening rhythm;
// without it the lede falls back to its original single-column layout.

export default function HeroBlock({ hero }: { hero: Hero }) {
  return (
    <header className={hero.peek ? "it-hero it-hero--split" : "it-hero"}>
      <div className="it-hero-lede">
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
      </div>

      {hero.peek && (
        <aside
          className="it-hero-peek"
          aria-label="Illustrative product preview"
        >
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
                <span className={`it-hero-peek-v ${row.tone ?? ""}`}>{row.v}</span>
              </div>
            ))}
          </div>
          <p className="it-hero-peek-foot">{hero.peek.foot}</p>
        </aside>
      )}
    </header>
  );
}
