import BrowserFrame from "./BrowserFrame";
import type { FlowShot } from "../../lib/integrity-set";

// One beat of the product walkthrough: a big framed screenshot paired
// with a benefit-led caption. Steps alternate image side down the page
// for a magazine-feature rhythm (the `index` parity drives it in CSS).

export default function FlowStep({ shot, index }: { shot: FlowShot; index: number }) {
  return (
    <li className="it-flowstep">
      <div className="it-flowstep-copy">
        <span className="it-flowstep-num mono">{String(index + 1).padStart(2, "0")}</span>
        <h3 className="it-flowstep-title">{shot.title}</h3>
        <p className="it-flowstep-cap">{shot.caption}</p>
      </div>
      <div className="it-flowstep-shot">
        <BrowserFrame src={shot.src} alt={shot.title} />
      </div>
    </li>
  );
}
