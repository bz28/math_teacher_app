import "katex/dist/katex.min.css";
import StatCard from "../components/StatCard";
import MathText from "../components/MathText";
import HeroBlock from "../components/demo/HeroBlock";
import FlowStep from "../components/demo/FlowStep";
import { loadGenerationSet } from "../lib/generation-set";

const g = loadGenerationSet();

// The story runs: hero → setup flow (01–02) → ★ the re-derivation (03, the
// differentiator, pulled out as the centerpiece) → resolution flow (04–07) →
// payoff. Mirrors GradingSet's structure and aesthetic; the only bespoke piece
// is the moment, where instead of a single screenshot we pull a real verified
// problem out of the Golden Set and show its independent re-derivation beside
// it — the thing that makes generated problems trustworthy.

// The resolution FlowSteps start at index 3 so their STEP labels read 04–07,
// leaving 03 for the moment band.

const p = g.problem;

export default function GenerationSet() {
  return (
    <div className="it-demo it-page">
      <HeroBlock hero={g.hero} />

      {/* ── THE FLOW (setup) ─────────────────────────────────────── */}
      <section id="flow" className="it-section">
        <div className="it-section-head">
          <span className="eyebrow">The walkthrough</span>
          <h2>From your course to a ready-to-assign set</h2>
          <p className="it-section-sub">
            The real product, end to end — you hand it the material you already teach, and it hands
            back a full problem set with the writing already done.
          </p>
        </div>
        <ol className="it-flow">
          {g.flowSetup.map((shot, i) => (
            <FlowStep key={shot.src} shot={shot} index={i} />
          ))}
        </ol>
      </section>

      {/* ── ★ THE MOMENT (03 — the independent re-derivation) ────── */}
      <section className="it-moment it-moment-verify" aria-labelledby="gen-moment-title">
        <div className="it-moment-inner">
          <div className="it-moment-head it-moment-head-center">
            <span className="it-moment-eyebrow">
              <span className="it-moment-step mono">{g.moment.step}</span>
              {g.moment.eyebrow}
            </span>
            <h2 id="gen-moment-title" className="it-moment-title">
              {g.moment.title}
            </h2>
            <p className="it-moment-body">{g.moment.body}</p>
          </div>

          <div className="gen-verify">
            <article className="gen-verify-problem">
              <header className="gen-verify-problem-head">
                <span className="gen-verify-fmt mono">
                  {p.format.toUpperCase()} · {p.difficulty}
                </span>
                <span className="gen-verify-from">generated from your course</span>
              </header>
              <div className="gen-verify-q">
                <MathText>{p.question}</MathText>
              </div>
              {p.figureSvg && (
                <div className="gen-verify-fig" dangerouslySetInnerHTML={{ __html: p.figureSvg }} />
              )}
              <div className="gen-verify-answer">
                <span className="gen-verify-answer-label">Answer key</span>
                <MathText>{p.finalAnswer}</MathText>
              </div>
            </article>

            <aside className="gen-verify-check">
              <div className="gen-verify-badge">
                <span className="gen-verify-badge-tick" aria-hidden="true">
                  ✓
                </span>
                {g.moment.verifiedLabel}
              </div>
              <h3 className="gen-verify-check-h">The independent re-derivation</h3>
              <p className="gen-verify-rederiv">
                <MathText>{p.verdict.rederivation}</MathText>
              </p>
              <p className="gen-verify-src mono">
                From the hand-checked Golden Set · {g.courseName}, problem {p.n}
              </p>
            </aside>
          </div>

          <p className="it-moment-sell">{g.moment.sell}</p>
          <p className="it-moment-note">{g.moment.note}</p>
        </div>
      </section>

      {/* ── THE FLOW (resolution) ────────────────────────────────── */}
      <section className="it-section">
        <ol className="it-flow">
          {g.flowResolution.map((shot, i) => (
            <FlowStep key={shot.src} shot={shot} index={i + 3} />
          ))}
        </ol>
      </section>

      {/* ── DISCLOSURE + PROVENANCE (mirrors GradingSet) ─────────── */}
      <section className="it-section it-disclosure">
        <div className="it-framing">{g.meta.framing}</div>
        <div className="it-provenance mono">
          {g.meta.source} · model {g.meta.model} · captured {g.meta.capturedAt}
        </div>
      </section>

      {/* ── BY THE NUMBERS (generation-specific capability strip) ── */}
      <section className="it-section it-worth">
        <div className="it-section-head">
          <span className="eyebrow">The shape of it</span>
          <h2>What you're actually getting</h2>
          <p className="it-section-sub">
            Not a measured-outcome claim — the four capability facts that make this a problem set you
            can trust and hand out as-is.
          </p>
        </div>
        <div className="it-worth-strip">
          <div className="stat-grid gs-stats it-worth-stats">
            {g.byNumbers.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
            ))}
          </div>
        </div>
      </section>

      {/* ── THE PAYOFF (full-bleed ink close) ────────────────────── */}
      <section className="it-payoff">
        <div className="it-payoff-inner">
          <span className="it-payoff-eyebrow">{g.payoff.eyebrow}</span>
          <h2 className="it-payoff-title">{g.payoff.title}</h2>
          <p className="it-payoff-lead">{g.payoff.lead}</p>
          <div className="it-payoff-points it-payoff-points-4">
            {g.payoff.points.map((pt, i) => (
              <div key={pt.title} className="it-payoff-point">
                <span className="it-payoff-num mono">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="it-payoff-point-title">{pt.title}</h3>
                <p className="it-payoff-point-body">{pt.body}</p>
              </div>
            ))}
          </div>
          <p className="it-payoff-closing">{g.payoff.closing}</p>
        </div>
      </section>
    </div>
  );
}
