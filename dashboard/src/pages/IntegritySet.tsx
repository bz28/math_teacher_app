import "katex/dist/katex.min.css";
import StatCard from "../components/StatCard";
import TranscriptCard from "../components/TranscriptCard";
import ConfusionMatrix from "../components/ConfusionMatrix";
import HeroBlock from "../components/demo/HeroBlock";
import FlowStep from "../components/demo/FlowStep";
import MomentBlock from "../components/demo/MomentBlock";
import RoiCalculator from "../components/demo/RoiCalculator";
import { loadIntegritySet } from "../lib/integrity-set";

const it = loadIntegritySet();

// "By the numbers" — concrete capability facts, not measured outcomes. The two
// accuracy facts carry the adversarial-test-set qualifier verbatim so the claim
// stays honest about exactly where the number comes from.
const byNumbers: { value: string; label: string; sub: string }[] = [
  {
    value: "Every student",
    label: "Checked, not sampled",
    sub: "the whole class — not a spot-check of ~5",
  },
  {
    value: "~3 min",
    label: "Per-student check",
    sub: "a short conversation, not an interrogation",
  },
  {
    value: "10 pages",
    label: "Of handwriting, read",
    sub: "photographed work parsed end to end",
  },
  {
    value: "0",
    label: "Honest students wrongly flagged",
    sub: "on our 22-case adversarial test set",
  },
  {
    value: "Caught",
    label: "The memorizers",
    sub: "rehearsed answers — on our adversarial test set",
  },
  {
    value: "Per-problem",
    label: "Itemized grades",
    sub: "every question scored, with reasoning",
  },
];

// The 05 probe is pulled out as its own emotional beat (MomentBlock), so the
// flow walkthrough runs 01–04, climaxes on the probe, then resolves 06–10.
const flowBefore = it.flow.slice(0, 4);
const flowAfter = it.flow.slice(5);
const memorizer = it.scenarios.find((s) => s.n === it.moment.scenario)!;

// A representative spread for the proof section: a clean pass, fairness to a
// home dialect, a copied answer sent to review, and a resisted injection.
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

      {/* ── ★ THE MOMENT (05 — the conceptual probe) ─────────────── */}
      <MomentBlock moment={it.moment} scenario={memorizer} />

      {/* ── THE FLOW (resolution) ────────────────────────────────── */}
      <section className="it-section">
        <ol className="it-flow">
          {flowAfter.map((shot, i) => (
            <FlowStep key={shot.src} shot={shot} index={i + 5} />
          ))}
        </ol>
      </section>

      {/* ── THE PROOF ────────────────────────────────────────────── */}
      <section className="it-section it-proof">
        <div className="it-section-head">
          <span className="eyebrow">The proof</span>
          <h2>Held to the results that matter</h2>
          <p className="it-section-sub">
            Now the credibility. Every conversation, verdict, and line of reasoning below is the
            system's own output, replayed verbatim from our evaluation harness.
          </p>
        </div>

        <div className="it-framing">{it.meta.framing}</div>

        <div className="stat-grid gs-stats it-proof-stats">
          {it.meta.stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
          ))}
        </div>

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
          <h3 className="it-proof-h">Gold × predicted, and the harms we hold to zero</h3>
          <p className="it-section-sub">
            Across the full 22-case adversarial set. It isn't a perfect diagonal, and that's the
            honest result — every off-diagonal call is a conservative, within-band one. What's held
            to zero are the two mistakes that would actually hurt a student.
          </p>
          <ConfusionMatrix dispositions={it.dispositions} matrix={it.matrix} />
        </div>

        <div className="it-proof-block">
          <h3 className="it-proof-h">Six scenarios, with the actual reasoning</h3>
          <p className="it-section-sub">
            The gold label is the intended call; the predicted label is what the check returned.
            Open any one to read the AI's verbatim reasoning.
          </p>
          <div className="it-grid">
            {proofScenarios.map((s) => (
              <TranscriptCard key={s.n} scenario={s} />
            ))}
          </div>
        </div>

        <div className="it-provenance mono">
          {it.meta.source} · model {it.meta.model} · captured {it.meta.capturedAt}
        </div>
      </section>

      {/* ── THE MATH (ROI — your numbers) ────────────────────────── */}
      <section className="it-section it-worth">
        <div className="it-section-head">
          <span className="eyebrow">The math, your numbers</span>
          <h2>What it's worth to you</h2>
          <p className="it-section-sub">
            Veradic grades every paper and runs the understanding check; you review the slice that's
            flagged or uncertain. Drag your own class through the model below — the arithmetic is
            right there, nothing hidden.
          </p>
        </div>

        <RoiCalculator />

        <div className="it-worth-strip">
          <h3 className="it-proof-h">By the numbers</h3>
          <div className="stat-grid gs-stats it-worth-stats">
            {byNumbers.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
            ))}
          </div>
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
