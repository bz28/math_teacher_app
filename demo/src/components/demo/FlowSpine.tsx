import BrowserFrame from "./BrowserFrame";
import type { Flow } from "../../lib/demo-hub";

// The end-to-end flow spine — the centerpiece of the hub/overview. Shows the
// platform as ONE simple connected workflow ("a day in your teacher's life"),
// not four separate tools. A vertical numbered spine: each beat carries a
// legible product shot, a short title + one line, and an explicit EASE tag so
// "look how little the teacher has to do" runs as a visible through-line. The
// analytics beat (`feature`) gets a prominence treatment. Rendered identically
// on /demo (DemoHub) and /present (PresentOverview), so it lives here once.

export default function FlowSpine({ flow }: { flow: Flow }) {
  return (
    <section id="flow" className="it-section">
      <div className="it-section-head">
        <span className="eyebrow">{flow.eyebrow}</span>
        <h2>{flow.title}</h2>
        <p className="it-section-sub">{flow.sub}</p>
      </div>

      <ol className="dh-spine">
        {flow.beats.map((beat) => (
          <li
            className={`dh-spine-beat${beat.feature ? " dh-spine-beat-feature" : ""}`}
            key={beat.step}
          >
            <div className="dh-spine-rail" aria-hidden="true">
              <span className="dh-spine-node mono">{beat.step}</span>
            </div>

            <div className="dh-spine-copy">
              {beat.feature && (
                <span className="dh-spine-feature-tag">{beat.feature}</span>
              )}
              <h3 className="dh-spine-title">{beat.title}</h3>
              <p className="dh-spine-line">{beat.line}</p>
              <span className="dh-spine-ease">
                <span className="dh-spine-ease-mark" aria-hidden="true">✓</span>
                {beat.ease}
              </span>
            </div>

            <div className="dh-spine-shot">
              <BrowserFrame src={beat.shot} alt={beat.title} />
            </div>
          </li>
        ))}
      </ol>

      <p className="dh-spine-cap">{flow.cap}</p>
    </section>
  );
}
