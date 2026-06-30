// Integrity golden-set data seam.
//
// Sibling to lib/golden-set.ts. The IntegritySet page renders entirely from the
// shape returned by loadIntegritySet(). Today that's a bundled, hand-authored
// snapshot (src/data/integrity.json) — illustrative adversarial scenarios with
// the integrity check's own verbatim verdicts and reasoning, plus the measured
// metrics from our evaluation harness. The seam is deliberate: if we ever wire a
// live benchmark, loadIntegritySet() becomes an API fetch returning the SAME
// shape and the page doesn't change. Keep it stable.

import raw from "../data/integrity.json";

export type DispositionKey = "pass" | "needs_practice" | "tutor_pivot" | "flag_for_review";

export type Disposition = { key: DispositionKey; label: string; blurb: string };

export type Turn = { speaker: "ai" | "student"; text: string; probe?: boolean };

export type Scenario = {
  n: number;
  label: string;
  persona: string;
  problem: string;
  gold: DispositionKey;
  predicted: DispositionKey;
  turns: Turn[];
  reasoning: string;
  whyRight: string;
};

export type Stat = { label: string; value: string; sub: string };

export type HarmMetric = { label: string; value: string; detail: string };

export type Matrix = {
  total: number;
  counts: number[][];
  note: string;
  harm: HarmMetric[];
};

export type FlowShot = { src: string; caption: string };

export type IntegritySet = {
  meta: {
    title: string;
    subtitle: string;
    framing: string;
    intro: string;
    capturedAt: string;
    model: string;
    source: string;
    stats: Stat[];
  };
  dispositions: Disposition[];
  scenarios: Scenario[];
  matrix: Matrix;
  flow: FlowShot[];
};

export function loadIntegritySet(): IntegritySet {
  return raw as unknown as IntegritySet;
}
