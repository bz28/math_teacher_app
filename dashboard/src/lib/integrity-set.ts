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

export type FlowShot = { src: string; title: string; caption: string };

// A quiet, illustrative product peek shown on the right of the hero so the
// opening frame reads like a real working product instead of blank paper.
// Shared across every story for one consistent opening rhythm; content is
// always illustrative (see each peek's `foot`), never a new measured claim.
export type HeroPeekRow = {
  k: string;
  v: string;
  tone?: "good" | "warn" | "accent" | "muted";
};

export type HeroPeek = {
  label: string;
  status: { text: string; tone: "good" | "warn" | "accent" | "info" | "muted" };
  rows: HeroPeekRow[];
  foot: string;
};

export type Hero = {
  eyebrow: string;
  headline: string;
  subhead: string;
  triplet: string[];
  cue: string;
  peek?: HeroPeek;
};

export type Moment = {
  eyebrow: string;
  title: string;
  body: string;
  quoteAttr: string;
  shot: string;
  scenario: number;
};

export type PayoffPoint = { title: string; body: string };

export type Payoff = {
  eyebrow: string;
  title: string;
  lead: string;
  points: PayoffPoint[];
  closing: string;
};

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
  hero: Hero;
  moment: Moment;
  payoff: Payoff;
  dispositions: Disposition[];
  scenarios: Scenario[];
  matrix: Matrix;
  flow: FlowShot[];
};

export function loadIntegritySet(): IntegritySet {
  return raw as unknown as IntegritySet;
}
