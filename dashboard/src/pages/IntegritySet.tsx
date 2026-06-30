import "katex/dist/katex.min.css";
import StatCard from "../components/StatCard";
import TranscriptCard from "../components/TranscriptCard";
import ConfusionMatrix from "../components/ConfusionMatrix";
import HeroBlock from "../components/demo/HeroBlock";
import FlowStep from "../components/demo/FlowStep";
import MomentBlock from "../components/demo/MomentBlock";
import { loadIntegritySet } from "../lib/integrity-set";

const it = loadIntegritySet();

// The story runs: hero → setup flow (01–02: submit, the calm chat) → ★ the
// conceptual probe (03, pulled out as MomentBlock, where a crisp HTML
// transcript carries the readable signature conversation) → resolution flow
// (04–05: ends kindly, your roster) → proof → payoff. The resolution
// FlowSteps start at index 2 so their STEP labels read 04–05, leaving 03 for
// the moment band.
const flowBefore = it.flow.slice(0, 2);
const flowAfter = it.flow.slice(2);
const memorizer = it.scenarios.find((s) => s.n === it.moment.scenario)!;

// The proof leads with the human transcripts — a clean pass, fairness to a home
// dialect, a copied answer sent to review, and a resisted injection. The cold
// ML-eval stats (confusion matrix, harm table) are demoted into the "rigor"
// expandable below, so a teacher meets the warm, legible proof first.
const proofScenarios = [1, 3, 5, 6]
  .map((n) => it.scenarios.find((s) => s.n === n))
  .filter((s): s is (typeof it.scenarios)[number] => Boolean(s));

export default function IntegritySet() {
  return (
    <div className="it-demo it-page">
      <HeroBlock hero={it.hero} />

      {/* ── THE FLOW (setup) ─────────────────────────────────────── */}
      <section id="flow" className="it-section">
        <div className="it-section-head">
          <span className="eyebrow">The walkthrough</span>
          <h2>From a photo of the homework to a graded roster</h2>
          <p className="it-section-sub">
            The real product, end to end — exactly what a student sees, then what lands on your
            desk.
          </p>
        </div>
        <ol className="it-flow">
          {flowBefore.map((shot, i) => (
            <FlowStep key={shot.src} shot={shot} index={i} />
          ))}
        </ol>
      </section>

      {/* ── ★ THE MOMENT (03 — the conceptual probe) ─────────────── */}
      <MomentBlock moment={it.moment} scenario={memorizer} />

      {/* ── THE FLOW (resolution) ────────────────────────────────── */}
      <section className="it-section">
        <ol className="it-flow">
          {flowAfter.map((shot, i) => (
            <FlowStep key={shot.src} shot={shot} index={i + 3} />
          ))}
        </ol>
      </section>

      {/* ── THE PROOF (leads with the human transcripts) ─────────── */}
      <section className="it-section it-proof">
        <div className="it-section-head">
          <span className="eyebrow">The proof</span>
          <h2>It's fair to every kid. It never calls a child a cheater.</h2>
          <p className="it-section-sub">
            Read the conversations yourself. Every transcript, verdict, and line of reasoning below
            is the system's own output, replayed verbatim from our evaluation harness.
          </p>
        </div>

        <div className="it-framing">{it.meta.framing}</div>

        <div className="it-proof-block">
          <h3 className="it-proof-h">Four conclusions — and the child is never called a cheater</h3>
          <div className="it-legend">
            {it.dispositions.map((d) => (
              <div key={d.key} className="it-legend-item">
                <span className={`it-pill it-pill-${d.key}`}>
                  <span className="it-pill-dot" />
                  {d.label}
                </span>
                <span className="it-legend-blurb">{d.blurb}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="it-proof-block">
          <h3 className="it-proof-h">The actual conversations, verbatim</h3>
          <p className="it-section-sub">
            A clean pass, a home dialect treated fairly, a copied answer sent to review, and a
            manipulation attempt that changed nothing. Open any one to read the AI's own reasoning.
          </p>
          <div className="it-grid">
            {proofScenarios.map((s) => (
              <TranscriptCard key={s.n} scenario={s} />
            ))}
          </div>
        </div>

        {/* The cold ML-eval rigor — kept honest and available, but demoted
            below the warm human proof a teacher actually responds to. */}
        <details className="it-rigor">
          <summary className="it-rigor-summary">The rigor behind it</summary>
          <div className="it-rigor-body">
            <div className="stat-grid gs-stats it-proof-stats">
              {it.meta.stats.map((s) => (
                <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
              ))}
            </div>

            <div className="it-proof-block">
              <h3 className="it-proof-h">Gold × predicted, and the harms we hold to zero</h3>
              <p className="it-section-sub">
                Across the full 22-case adversarial set. It isn't a perfect diagonal, and that's the
                honest result — every off-diagonal call is a conservative, within-band one. What's
                held to zero are the two mistakes that would actually hurt a student.
              </p>
              <ConfusionMatrix dispositions={it.dispositions} matrix={it.matrix} />
            </div>
          </div>
        </details>

        <div className="it-provenance mono">
          {it.meta.source} · model {it.meta.model} · captured {it.meta.capturedAt}
        </div>
      </section>

      {/* ── THE PAYOFF ───────────────────────────────────────────── */}
      <section className="it-payoff">
        <div className="it-payoff-inner">
          <span className="it-payoff-eyebrow">{it.payoff.eyebrow}</span>
          <h2 className="it-payoff-title">{it.payoff.title}</h2>
          <p className="it-payoff-lead">{it.payoff.lead}</p>
          <div className="it-payoff-points">
            {it.payoff.points.map((p, i) => (
              <div key={p.title} className="it-payoff-point">
                <span className="it-payoff-num mono">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="it-payoff-point-title">{p.title}</h3>
                <p className="it-payoff-point-body">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="it-payoff-closing">{it.payoff.closing}</p>
        </div>
      </section>
    </div>
  );
}
