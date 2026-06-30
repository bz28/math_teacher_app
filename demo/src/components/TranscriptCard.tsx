import { useState } from "react";
import MathText from "./MathText";
import type { DispositionKey, Scenario } from "../lib/integrity-set";

const DISPOSITION_LABEL: Record<DispositionKey, string> = {
  pass: "Understood",
  needs_practice: "Needs practice",
  tutor_pivot: "Got tutored",
  flag_for_review: "Review",
};

function DispositionPill({ kind }: { kind: DispositionKey }) {
  return (
    <span className={`it-pill it-pill-${kind}`}>
      <span className="it-pill-dot" />
      {DISPOSITION_LABEL[kind]}
    </span>
  );
}

export default function TranscriptCard({
  scenario,
  defaultOpen = false,
}: {
  scenario: Scenario;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const match = scenario.gold === scenario.predicted;

  return (
    <article className="it-card">
      <header className="it-card-head">
        <span className="it-qnum mono">S{scenario.n}</span>
        <span className="it-label">{scenario.label}</span>
        <span className="it-problem mono">
          <MathText>{scenario.problem}</MathText>
        </span>
      </header>

      <p className="it-persona">{scenario.persona}</p>

      <div className="it-thread">
        {scenario.turns.map((t, i) => (
          <div key={i} className={`it-turn it-turn-${t.speaker}${t.probe ? " it-turn-probe" : ""}`}>
            <span className="it-turn-who">{t.speaker === "ai" ? "AI" : "Student"}</span>
            <div className="it-turn-body">
              {t.probe && <span className="it-probe-tag">conceptual probe</span>}
              <MathText>{t.text}</MathText>
            </div>
          </div>
        ))}
      </div>

      <div className="it-verdict-row">
        <div className="it-verdict-pair">
          <span className="it-verdict-axis">Gold</span>
          <DispositionPill kind={scenario.gold} />
          <span className="it-verdict-arrow">{match ? "=" : "≠"}</span>
          <span className="it-verdict-axis">Predicted</span>
          <DispositionPill kind={scenario.predicted} />
        </div>
        <span className={`it-match ${match ? "ok" : "miss"}`}>{match ? "✓ match" : "✗ miss"}</span>
      </div>

      <button className="it-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Show"} the AI's reasoning
        <span className={`it-chevron ${open ? "open" : ""}`}>›</span>
      </button>

      {open && (
        <div className="it-reasoning">
          <div className="it-reasoning-block">
            <div className="it-reasoning-label">Verdict reasoning · verbatim</div>
            <div className="it-reasoning-body it-quote">{scenario.reasoning}</div>
          </div>
          <div className="it-reasoning-block">
            <div className="it-reasoning-label">Why this is the right call</div>
            <div className="it-reasoning-body">{scenario.whyRight}</div>
          </div>
        </div>
      )}
    </article>
  );
}
