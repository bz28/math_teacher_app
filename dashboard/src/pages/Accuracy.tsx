import { useSearchParams } from "react-router-dom";
import HandwritingTab from "./accuracy/HandwritingTab";
import GradingTab from "./accuracy/GradingTab";

// ────────────────────────────────────────────────────────────────────
// Accuracy — is the AI right? Two questions, one page, because they are
// one chain: the grade rests on the read. Each is judged by the person
// who knows for certain — the student for what their page says, the
// teacher for what it's worth — and every case opens its case file.
// ────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "handwriting", label: "Handwriting" },
  { key: "grading", label: "Grading" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const WINDOWS = [
  { hours: "168", label: "Last 7 days" },
  { hours: "720", label: "Last 30 days" },
  { hours: "2160", label: "Last 90 days" },
  { hours: "87600", label: "All time" },
];
const DEFAULT_HOURS = "2160";

export default function Accuracy() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "grading" ? "grading" : "handwriting";
  // The window lives in the URL beside the tab, so switching tabs keeps
  // it and a shared link opens the same slice.
  const hoursParam = params.get("hours");
  const hours = WINDOWS.some((w) => w.hours === hoursParam) ? hoursParam! : DEFAULT_HOURS;

  const update = (next: { tab?: Tab; hours?: string }) => {
    const p = new URLSearchParams(params);
    const t = next.tab ?? tab;
    const h = next.hours ?? hours;
    if (t === "handwriting") p.delete("tab"); else p.set("tab", t);
    if (h === DEFAULT_HOURS) p.delete("hours"); else p.set("hours", h);
    setParams(p, { replace: true });
  };

  const windowSelect = (
    <select aria-label="Window" value={hours} onChange={(e) => update({ hours: e.target.value })}>
      {WINDOWS.map((w) => <option key={w.hours} value={w.hours}>{w.label}</option>)}
    </select>
  );

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Debug</span>
        <h1>Accuracy</h1>
        <p>Does the AI read the work right, and grade it right? Judged by the student and the teacher.</p>
      </div>

      <div className="segmented" role="tablist" aria-label="Accuracy">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            className={`segment${t.key === tab ? " segment-active" : ""}`}
            onClick={() => update({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "handwriting"
        ? <HandwritingTab hours={hours} windowSelect={windowSelect} />
        : <GradingTab hours={hours} windowSelect={windowSelect} />}
    </div>
  );
}
