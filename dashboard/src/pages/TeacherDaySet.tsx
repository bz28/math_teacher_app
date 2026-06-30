import StatCard from "../components/StatCard";
import HeroBlock from "../components/demo/HeroBlock";
import FlowStep from "../components/demo/FlowStep";
import BrowserFrame from "../components/demo/BrowserFrame";
import { loadTeacherDaySet } from "../lib/teacher-day";

const g = loadTeacherDaySet();

// The story runs: hero → setup flow (01–02, the morning queue and landing on
// the exact student) → ★ the insight→action loop (the differentiator, pulled
// out as the centerpiece) → payoff. Mirrors GradingSet / GenerationSet's
// structure and aesthetic; the only bespoke piece is the moment, where instead
// of a single screenshot we render the loop as three connected beats — the
// struggle signal (03), the pre-titled one-click reteach (04), and the ten
// problems the AI writes on the spot (05) — so the page itself shows that
// seeing the problem and fixing it are the same motion.

const m = g.moment;
const beats = [m.signal, m.bridge, m.action] as const;

export default function TeacherDaySet() {
  return (
    <div className="it-demo it-page">
      <HeroBlock hero={g.hero} />

      {/* ── THE FLOW (setup) ─────────────────────────────────────── */}
      <section id="flow" className="it-section">
        <div className="it-section-head">
          <span className="eyebrow">The walkthrough</span>
          <h2>From the morning's queue to the exact student</h2>
          <p className="it-section-sub">
            The real product, end to end — you open to who needs you across every course, and one
            click lands you in the work itself instead of a hunt through rosters.
          </p>
        </div>
        <ol className="it-flow">
          {g.flowSetup.map((shot, i) => (
            <FlowStep key={shot.src} shot={shot} index={i} />
          ))}
        </ol>
      </section>

      {/* ── ★ THE MOMENT (03→04→05 — the insight→action loop) ────── */}
      <section className="it-moment it-moment-loop" aria-labelledby="td-moment-title">
        <div className="it-moment-inner">
          <div className="it-moment-head it-moment-head-center">
            <span className="it-moment-eyebrow">
              <span className="it-moment-step mono">{m.step}</span>
              {m.eyebrow}
            </span>
            <h2 id="td-moment-title" className="it-moment-title">
              {m.title}
            </h2>
            <p className="it-moment-body">{m.body}</p>
          </div>

          <ol className="td-loop">
            {beats.map((b, i) => (
              <li key={b.src} className={`td-loop-beat td-loop-beat-${i}`}>
                {i > 0 && (
                  <span className="td-loop-arrow" aria-hidden="true">
                    →
                  </span>
                )}
                <div className="td-loop-card">
                  <header className="td-loop-card-head">
                    <span className="td-loop-step mono">{b.step}</span>
                    <h3 className="td-loop-label">{b.label}</h3>
                  </header>
                  <BrowserFrame src={b.src} alt={b.label} tone={i === 2 ? "moment" : "default"} />
                  <p className="td-loop-sub">{b.sub}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="it-moment-sell">{m.sell}</p>
          <p className="it-moment-note">{m.note}</p>
        </div>
      </section>

      {/* ── DISCLOSURE + PROVENANCE (mirrors the sibling stories) ─── */}
      <section className="it-section it-disclosure">
        <div className="it-framing">{g.meta.framing}</div>
        <div className="it-provenance mono">
          {g.meta.source} · model {g.meta.model} · captured {g.meta.capturedAt}
        </div>
      </section>

      {/* ── BY THE NUMBERS (teaching-day capability strip) ───────── */}
      <section className="it-section it-worth">
        <div className="it-section-head">
          <span className="eyebrow">The shape of it</span>
          <h2>What you're actually getting</h2>
          <p className="it-section-sub">
            Not a measured-outcome claim — the four capability facts that make this a teaching day you
            walk into already knowing.
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
