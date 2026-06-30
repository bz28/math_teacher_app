import BrowserFrame from "./BrowserFrame";
import TranscriptCard from "../TranscriptCard";
import type { Moment, Scenario } from "../../lib/integrity-set";

// The emotional centerpiece: the single conceptual probe. We pull the
// "smooth memorizer" scenario beside the real screenshot so the reader
// watches a confident, rehearsed answer fall apart on one question. The
// pull-quote is the student's own admission, lifted verbatim.

export default function MomentBlock({
  moment,
  scenario,
}: {
  moment: Moment;
  scenario: Scenario;
}) {
  const lastStudent = [...scenario.turns].reverse().find((t) => t.speaker === "student");

  return (
    <section className="it-moment" aria-labelledby="moment-title">
      <div className="it-moment-inner">
        <div className="it-moment-head">
          <span className="it-moment-eyebrow">
            <span className="it-moment-step mono">{moment.step}</span>
            {moment.eyebrow}
          </span>
          <h2 id="moment-title" className="it-moment-title">
            {moment.title}
          </h2>
          <p className="it-moment-body">{moment.body}</p>
        </div>

        <div className="it-moment-grid">
          <div className="it-moment-shot">
            <BrowserFrame src={moment.shot} alt={moment.title} tone="moment" />
          </div>

          <div className="it-moment-proof">
            {lastStudent && (
              <blockquote className="it-moment-quote">
                <span className="it-moment-quote-mark" aria-hidden="true">
                  &ldquo;
                </span>
                {lastStudent.text}
                <footer className="it-moment-quote-attr">{moment.quoteAttr}</footer>
              </blockquote>
            )}
            <TranscriptCard scenario={scenario} defaultOpen />
          </div>
        </div>
      </div>
    </section>
  );
}
