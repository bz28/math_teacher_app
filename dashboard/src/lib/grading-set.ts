// AI-grading golden-set data seam.
//
// Sibling to lib/integrity-set.ts. The GradingSet page renders entirely from the
// shape returned by loadGradingSet(). Today that's a bundled, hand-authored
// snapshot (src/data/grading.json) — a live-captured walkthrough of the real
// grading product, with one illustrative seeded student (the 73% receipt). The
// seam is deliberate: if we ever wire a live grading benchmark, loadGradingSet()
// becomes an API fetch returning the SAME shape and the page doesn't change.
// Keep it stable.

import raw from "../data/grading.json";

// Structurally identical to integrity-set's Hero / FlowShot so the shared demo
// components (HeroBlock, FlowStep) accept this data unchanged.
export type Hero = {
  eyebrow: string;
  headline: string;
  subhead: string;
  triplet: string[];
  cue: string;
};

export type FlowShot = { src: string; title: string; caption: string };

export type Moment = {
  step: string;
  eyebrow: string;
  title: string;
  body: string;
  sell: string;
  note: string;
  shot: string;
};

export type PayoffPoint = { title: string; body: string };

export type Payoff = {
  eyebrow: string;
  title: string;
  lead: string;
  points: PayoffPoint[];
  closing: string;
};

export type ByNumber = { value: string; label: string; sub: string };

export type GradingSet = {
  meta: {
    title: string;
    subtitle: string;
    framing: string;
    capturedAt: string;
    model: string;
    source: string;
  };
  hero: Hero;
  flowSetup: FlowShot[];
  moment: Moment;
  flowResolution: FlowShot[];
  payoff: Payoff;
  byNumbers: ByNumber[];
};

export function loadGradingSet(): GradingSet {
  return raw as unknown as GradingSet;
}
