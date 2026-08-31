import { useSearchParams } from "react-router-dom";
import Quality from "./Quality";
import GradingQuality from "./GradingQuality";
import GenerationQuality from "./GenerationQuality";
import GoldenSet from "./GoldenSet";
import HarnessRuns from "./HarnessRuns";

/**
 * One home for "is the AI any good", replacing five sibling rail entries.
 *
 * They were indistinguishable from the nav — "Generation quality" and
 * "Generation QA" are the same words in a different order, and nothing in
 * the rail said that one was a live defect feed and the other a curated
 * regression corpus. The URLs disagreed with the labels too: Solution
 * quality lived at /quality, Generation QA at /golden-set.
 *
 * The pages themselves are unchanged and still render at their original
 * routes, so existing links and bookmarks keep working. This only gives
 * them a shared front door and a name each that says what it is.
 */

const TABS = [
  {
    key: "grading",
    label: "Grading",
    hint: "Where teachers overrode the AI's grade",
    render: () => <GradingQuality />,
  },
  {
    key: "generation",
    label: "Generation",
    hint: "Generated questions teachers had to fix",
    render: () => <GenerationQuality />,
  },
  {
    key: "solutions",
    label: "Solutions",
    hint: "Step-by-step solution pass rate",
    render: () => <Quality />,
  },
  {
    key: "evals",
    label: "Evals",
    hint: "The curated regression corpus",
    render: () => <GoldenSet />,
  },
  {
    key: "harness",
    label: "Harness",
    hint: "Automated run history",
    render: () => <HarnessRuns />,
  },
] as const;

export default function AIQuality() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const active = TABS.find((t) => t.key === requested) ?? TABS[0];

  return (
    <>
      <div className="segmented" role="tablist" aria-label="AI quality view">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active.key}
            title={t.hint}
            className={`segment${t.key === active.key ? " segment-active" : ""}`}
            // replace: flipping between tabs shouldn't stack history entries
            // that Back has to walk through one at a time.
            onClick={() => setParams({ tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {active.render()}
    </>
  );
}
