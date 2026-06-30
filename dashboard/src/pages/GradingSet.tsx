import StatCard from "../components/StatCard";
import HeroBlock from "../components/demo/HeroBlock";
import FlowStep from "../components/demo/FlowStep";
import BrowserFrame from "../components/demo/BrowserFrame";
import { loadGradingSet } from "../lib/grading-set";

const g = loadGradingSet();

// The story runs: hero → setup flow (01–02) → ★ the itemized receipt (03,
// pulled out as the centerpiece) → resolution flow (04–07) → payoff. The
// resolution FlowSteps start at index 3 so their STEP labels read 04–07,
// leaving 03 for the moment band.

export default function GradingSet() {
  return (
    <div className="it-demo it-page">
      <HeroBlock hero={g.hero} />

      {/* ── THE FLOW (setup) ─────────────────────────────────────── */}
      <section id="flow" className="it-section">
        <div className="it-section-head">
          <span className="eyebrow">The walkthrough</span>
          <h2>From a photo of the work to a graded roster</h2>
          <p className="it-section-sub">
            The real product, end to end — the class arrives already scored, with every grade sitting
            right next to the handwriting it came from.
          </p>
        </div>
        <ol className="it-flow">
          {g.flowSetup.map((shot, i) => (
            <FlowStep key={shot.src} shot={shot} index={i} />
          ))}
        </ol>
      </section>

      {/* ── ★ THE MOMENT (03 — the itemized receipt) ─────────────── */}
      <section className="it-moment it-moment-receipt" aria-labelledby="grading-moment-title">
        <div className="it-moment-inner">
          <div className="it-moment-head">
            <span className="it-moment-eyebrow">
              <span className="it-moment-step mono">{g.moment.step}</span>
              {g.moment.eyebrow}
            </span>
            <h2 id="grading-moment-title" className="it-moment-title">
              {g.moment.title}
            </h2>
            <p className="it-moment-body">{g.moment.body}</p>
          </div>

          <figure className="it-moment-figure">
            <BrowserFrame src={g.moment.shot} alt="The itemized grade receipt: 100 − 20 − 7 = 73%" tone="moment" />
          </figure>

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

      {/* ── DISCLOSURE + PROVENANCE (mirrors IntegritySet) ───────── */}
      <section className="it-section it-disclosure">
        <div className="it-framing">{g.meta.framing}</div>
        <div className="it-provenance mono">
          {g.meta.source} · model {g.meta.model} · captured {g.meta.capturedAt}
        </div>
      </section>

      {/* ── BY THE NUMBERS (grading-specific capability strip) ───── */}
      <section className="it-section it-worth">
        <div className="it-section-head">
          <span className="eyebrow">The shape of it</span>
          <h2>What you're actually getting</h2>
          <p className="it-section-sub">
            Not a measured-outcome claim — the four capability facts that make this grading you can
            trust and defend.
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
            {g.payoff.points.map((p, i) => (
              <div key={p.title} className="it-payoff-point">
                <span className="it-payoff-num mono">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="it-payoff-point-title">{p.title}</h3>
                <p className="it-payoff-point-body">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="it-payoff-closing">{g.payoff.closing}</p>
        </div>
      </section>
    </div>
  );
}
