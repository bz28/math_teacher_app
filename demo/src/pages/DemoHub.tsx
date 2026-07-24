import { Link } from "react-router-dom";
import HeroBlock from "../components/demo/HeroBlock";
import RosterPeek from "../components/demo/RosterPeek";
import VideoHero from "../components/demo/VideoHero";
import FlowSpine from "../components/demo/FlowSpine";
import BrowserFrame from "../components/demo/BrowserFrame";
import RoiCalculator from "../components/demo/RoiCalculator";
import { loadDemoHub } from "../lib/demo-hub";

const h = loadDemoHub();

// The demo front door — the one page everyone lands on. The overarching promise
// (hero), the ~4-minute product film, the end-to-end flow spine that shows the
// platform is ONE simple connected workflow ("a day in your teacher's life"),
// the four deep-dive stories you can step into, the business case (ROI), and a
// school + referral close. Each use-case card opens a deep-dive
// (/{integrity,grading,generation,teacher-day}). Reuses the shipped .it-*
// editorial system.

export default function DemoHub() {
  return (
    <div className="it-demo it-page">
      {/* Quiet way out to the live marketing site. */}
      <div className="dh-site-launch">
        <a
          className="dh-site-link"
          href="https://veradicai.com"
          target="_blank"
          rel="noreferrer"
        >
          veradicai.com
          <span className="dh-site-link-arrow" aria-hidden="true">↗</span>
        </a>
      </div>

      <HeroBlock hero={h.hero} aside={<RosterPeek />} />

      {/* ── THE FILM — the ~4-minute product film, the landing centerpiece ─ */}
      <VideoHero />

      {/* ── THE FLOW SPINE — one connected workflow (day in the life) ─ */}
      <FlowSpine flow={h.flow} />

      {/* ── THE CORE USE CASES — navigable into the deep-dives ───── */}
      <section className="it-section">
        <div className="it-section-head">
          <span className="eyebrow">{h.useCases.eyebrow}</span>
          <h2>{h.useCases.title}</h2>
          <p className="it-section-sub">{h.useCases.sub}</p>
        </div>

        <div className="dh-cards">
          {h.useCases.cards.map((card) => (
            <Link className="dh-card" to={`/${card.key}`} key={card.key}>
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
