import "katex/dist/katex.min.css";
import StatCard from "../components/StatCard";
import MathText from "../components/MathText";
import HeroBlock from "../components/demo/HeroBlock";
import FlowStep from "../components/demo/FlowStep";
import { loadTeacherDaySet } from "../lib/teacher-day";

const g = loadTeacherDaySet();

// The story runs: hero → setup flow (01–02, the morning queue and landing on
// the exact student) → ★ the insight→action loop (the differentiator, pulled
// out as the centerpiece) → payoff. Mirrors GradingSet / GenerationSet's
// structure and aesthetic; the only bespoke piece is the moment.
//
// The moment is the customer-pitch climax, so legibility is the whole point: a
// teacher has to READ it on a screen-share. We render it as crisp HTML, not
// tiny screenshots — the struggle signal (a real ranked row) and the one-click
// pre-titled reteach as two compact text panels (the insight), then the
// problems the AI writes on the spot as the large, vector-sharp centerpiece
// (the fix). Seeing the problem and fixing it are the same motion — and a
// teacher can actually read the problems.

const m = g.moment;
const sig = m.signalRow;
const fix = m.fix;
const missedPct = Math.round((sig.missed / sig.total) * 100);

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

          {/* The insight: the struggle signal → the one-click pre-titled
              reteach, rendered as crisp text so both read at presentation
              scale (the screenshots were illegible side-by-side at ~360px). */}
          <div className="td-signal">
            <div className="td-signal-card">
              <span className="td-signal-step mono">{m.signal.step}</span>
              <h3 className="td-signal-label">{m.signal.label}</h3>
              <div className="td-struggle-row">
                <div className="td-struggle-line">
                  <span className="td-struggle-concept">{sig.concept}</span>
                  <span className="td-struggle-count mono">
                    {sig.missed} of {sig.total} missed
                  </span>
                </div>
                <div className="td-struggle-bar">
                  <span style={{ width: `${missedPct}%` }} />
                </div>
              </div>
              <p className="td-signal-sub">{m.signal.sub}</p>
            </div>

            <span className="td-signal-arrow" aria-hidden="true">
              →
            </span>

            <div className="td-signal-card">
              <span className="td-signal-step mono">{m.bridge.step}</span>
              <h3 className="td-signal-label">{m.bridge.label}</h3>
              <div className="td-reteach-title">
                <span className="td-reteach-tick" aria-hidden="true">
                  ↻
                </span>
                {m.reteachTitle}
              </div>
              <p className="td-signal-sub">{m.bridge.sub}</p>
            </div>
          </div>

          {/* The fix: the problems the AI writes on the spot — the centerpiece,
              rendered as vector-crisp HTML so a teacher can actually READ a few
              of them. */}
          <div className="td-fix">
            <header className="td-fix-head">
              <div>
                <span className="td-fix-step mono">{m.action.step}</span>
                <h3 className="td-fix-label">{m.action.label}</h3>
              </div>
              <span className="td-fix-pill mono">{fix.count} problems generated</span>
            </header>
            <ol className="td-fix-grid">
              {fix.problems.map((p) => (
                <li key={p.n} className="td-fix-card">
                  <header className="td-fix-card-head">
                    <span className="td-fix-n mono">
                      {p.n} / {fix.count}
                    </span>
                    <h4 className="td-fix-title">{p.title}</h4>
                  </header>
                  <div className="td-fix-q">
                    <MathText>{p.question}</MathText>
                  </div>
                  <div className="td-fix-answer">
                    <span className="td-fix-answer-label">Answer</span>
                    <MathText>{p.answer}</MathText>
                  </div>
                </li>
              ))}
            </ol>
            <p className="td-fix-foot mono">{fix.foot}</p>
          </div>

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
