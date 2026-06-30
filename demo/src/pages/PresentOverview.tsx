import { Link } from "react-router-dom";
import StatCard from "../components/StatCard";
import HeroBlock from "../components/demo/HeroBlock";
import FlowSpine from "../components/demo/FlowSpine";
import BrowserFrame from "../components/demo/BrowserFrame";
import RoiCalculator from "../components/demo/RoiCalculator";
import { loadDemoHub } from "../lib/demo-hub";

const h = loadDemoHub();

// The present-mode home base. Same value-prop, flow spine, use-case tiles, ROI
// and ink payoff as the in-dashboard DemoHub — but every tile leads INTO present
// mode (/present/<story>) rather than the admin /golden-set/* pages, so the
// founder never falls back into the admin chrome mid-pitch. Content and copy
// are reused verbatim; only the destinations are remapped. The card `key`
// (integrity | grading | generation | teacher-day) maps 1:1 to the route.

export default function PresentOverview() {
  return (
    <div className="it-demo it-page">
      <HeroBlock hero={h.hero} />

      {/* ── THE FLOW SPINE — one connected workflow (day in the life) ─ */}
      <FlowSpine flow={h.flow} />

      {/* ── THE CORE USE CASES — big entry tiles into present mode ─ */}
      <section className="it-section">
        <div className="it-section-head">
          <span className="eyebrow">{h.useCases.eyebrow}</span>
          <h2>{h.useCases.title}</h2>
          <p className="it-section-sub">{h.useCases.sub}</p>
        </div>

        <div className="dh-cards">
          {h.useCases.cards.map((card) => (
            <Link className="dh-card" to={`/present/${card.key}`} key={card.key}>
              <div className="dh-card-shot">
                <BrowserFrame src={card.shot} alt={card.title} />
              </div>
              <div className="dh-card-body">
                <span className="dh-card-tag">{card.tag}</span>
                <h3 className="dh-card-title">{card.title}</h3>
                <p className="dh-card-benefit">{card.benefit}</p>
                <span className="dh-card-cta">
                  {card.cta}
                  <span className="dh-card-cta-arrow" aria-hidden="true">→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="it-framing dh-framing">{h.meta.framing}</div>
      </section>

      {/* ── THE ROI — the platform business case (reused) ────────── */}
      <section className="it-section it-worth">
        <div className="it-section-head">
          <span className="eyebrow">{h.roi.eyebrow}</span>
          <h2>{h.roi.title}</h2>
          <p className="it-section-sub">{h.roi.sub}</p>
        </div>

        <RoiCalculator />

        <div className="it-worth-strip">
          <h3 className="it-proof-h">By the numbers</h3>
          <div className="stat-grid gs-stats it-worth-stats">
            {h.roi.byNumbers.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
            ))}
          </div>
        </div>
      </section>

      {/* ── THE CLOSE — full-bleed ink payoff ────────────────────── */}
      <section className="it-payoff">
        <div className="it-payoff-inner">
          <span className="it-payoff-eyebrow">{h.payoff.eyebrow}</span>
          <h2 className="it-payoff-title">{h.payoff.title}</h2>
          <p className="it-payoff-lead">{h.payoff.lead}</p>
          <div className="it-payoff-points">
            {h.payoff.points.map((p, i) => (
              <div key={p.title} className="it-payoff-point">
                <span className="it-payoff-num mono">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="it-payoff-point-title">{p.title}</h3>
                <p className="it-payoff-point-body">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="it-payoff-closing">{h.payoff.closing}</p>
        </div>
      </section>
    </div>
  );
}
