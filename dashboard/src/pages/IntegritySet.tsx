import "katex/dist/katex.min.css";
import StatCard from "../components/StatCard";
import TranscriptCard from "../components/TranscriptCard";
import ConfusionMatrix from "../components/ConfusionMatrix";
import { loadIntegritySet } from "../lib/integrity-set";

const it = loadIntegritySet();

export default function IntegritySet() {
  return (
    <div className="gs-page it-page">
      <header className="page-header">
        <span className="eyebrow">Diagnostics · Integrity benchmark</span>
        <h1>{it.meta.title}</h1>
        <p>{it.meta.subtitle}</p>
        <p className="gs-intro">{it.meta.intro}</p>
        <div className="it-framing">{it.meta.framing}</div>
        <div className="gs-meta-line mono">
          {it.meta.source} · model {it.meta.model} · captured {it.meta.capturedAt}
        </div>
      </header>

      <div className="stat-grid gs-stats">
        {it.meta.stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>

      {/* The four conclusions */}
      <section className="gs-section">
        <h2>Four conclusions</h2>
        <p className="gs-section-sub">
          Every check ends in exactly one of these — and even at “Review,” the student only ever sees
          a warm “thanks, your work is with your teacher.” The judgment goes to the teacher; the child
          is never called a cheater.
        </p>
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
      </section>

      <hr className="hr" />

      {/* Scenarios */}
      <section className="gs-section">
        <h2>Six scenarios, with the actual reasoning</h2>
        <p className="gs-section-sub">
          Each is one run of our evaluation — the conversation, the verdict, and the AI's written
          reasoning are quoted verbatim from the system's own output. The gold label is the intended
          call; the predicted label is what the check returned.
        </p>
        <div className="it-grid">
          {it.scenarios.map((s) => (
            <TranscriptCard key={s.n} scenario={s} />
          ))}
        </div>
      </section>

      <hr className="hr" />

      {/* Confusion matrix + harm metrics */}
      <section className="gs-section">
        <h2>Gold × predicted, and the harms we hold to zero</h2>
        <p className="gs-section-sub">
          Across the full 22-case adversarial set, replayed from the system's recorded conversations.
          The two mistakes that would hurt students most — falsely accusing the honest, and
          rubber-stamping the memorizer — are held to zero.
        </p>
        <ConfusionMatrix dispositions={it.dispositions} matrix={it.matrix} />
      </section>

      <hr className="hr" />

      {/* The flow */}
      <section className="gs-section">
        <h2>The flow</h2>
        <p className="gs-section-sub">
          What the check looks like end to end — from the student's problem, through the warm chat, to
          the teacher's final call.
        </p>
        <ol className="gs-flow">
          {it.flow.map((shot, i) => (
            <li className="gs-flow-step" key={shot.src}>
              <div className="gs-flow-num mono">{String(i + 1).padStart(2, "0")}</div>
              <figure className="gs-flow-fig">
                <img src={shot.src} alt={shot.caption} loading="lazy" />
                <figcaption>{shot.caption}</figcaption>
              </figure>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
